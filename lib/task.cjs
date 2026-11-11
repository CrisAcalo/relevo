'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { projectRoot, canonical } = require('./root.cjs');
const { loadConfig } = require('./config.cjs');

const TASK_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;

function validateTaskName(name) {
  if (typeof name !== 'string' || !TASK_NAME_REGEX.test(name)) {
    throw new Error(`Nombre de tarea inválido "${name ?? ''}". Debe cumplir ${TASK_NAME_REGEX}`);
  }
}

function taskNew({ name, from, cwd = process.cwd(), silent = false } = {}) {
  validateTaskName(name);

  const root = projectRoot(cwd);
  const config = loadConfig(root);
  const worktreesDir = path.resolve(root, config.worktreesDir);
  const targetPath = path.resolve(worktreesDir, name);
  const branch = `${config.taskBranchPrefix}${name}`;
  const targetRel = path.relative(root, targetPath).replace(/\\/g, '/');

  if (fs.existsSync(targetPath)) {
    throw new Error(`Ya existe el directorio de trabajo para la tarea "${name}": ${targetRel}`);
  }

  const existingBranch = execFileSync('git', ['branch', '--list', branch], { cwd: root, encoding: 'utf8' }).trim();
  if (existingBranch) {
    throw new Error(`Ya existe la rama "${branch}" para la tarea "${name}"`);
  }

  const ref = from || 'HEAD';
  execFileSync('git', ['worktree', 'add', targetRel, '-b', branch, ref], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const rootNodeModules = path.join(root, 'node_modules');
  let hasNodeModules = false;
  try {
    hasNodeModules = fs.statSync(rootNodeModules).isDirectory();
  } catch {}

  if (hasNodeModules) {
    const targetNodeModules = path.join(targetPath, 'node_modules');
    const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
    try {
      fs.symlinkSync(rootNodeModules, targetNodeModules, symlinkType);
    } catch (err) {
      // Si falla la creación del enlace, deshace el worktree y la rama y muestra el error.
      try {
        execFileSync('git', ['worktree', 'remove', '--force', targetRel], { cwd: root, stdio: 'ignore' });
      } catch {}
      try {
        execFileSync('git', ['branch', '-D', branch], { cwd: root, stdio: 'ignore' });
      } catch {}
      throw new Error(`Error al crear el enlace a node_modules: ${err.message}`);
    }
  }

  if (!silent) {
    console.log(`relevo task new · tarea "${name}" creada en ${targetRel} (rama: ${branch})`);
  }

  return { name, path: targetPath, relativePath: targetRel, branch };
}

function isRegisteredWorktree(root, targetPath) {
  let out = '';
  try {
    out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return false;
  }

  const exists = fs.existsSync(targetPath);
  const norm = (p) => path.resolve(p).replace(/\\/g, '/');
  const format = (p) => {
    const res = exists ? canonical(p) : norm(p);
    const normalized = res.replace(/\\/g, '/');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };

  const targetKey = format(targetPath);

  for (const line of out.split(/\r?\n/)) {
    if (!line.startsWith('worktree ')) continue;
    const wtPath = line.slice('worktree '.length).trim();
    if (!wtPath) continue;
    if (format(wtPath) === targetKey) {
      return true;
    }
  }
  return false;
}

function taskDone({ name, force = false, cwd = process.cwd(), silent = false } = {}) {
  validateTaskName(name);

  const root = projectRoot(cwd);
  const config = loadConfig(root);
  const worktreesDir = path.resolve(root, config.worktreesDir);
  const targetPath = path.resolve(worktreesDir, name);
  const branch = `${config.taskBranchPrefix}${name}`;
  const targetRel = path.relative(root, targetPath).replace(/\\/g, '/');

  const canonCwd = canonical(process.cwd());
  const canonTarget = canonical(targetPath);
  const rel = path.relative(
    process.platform === 'win32' ? canonTarget.toLowerCase() : canonTarget,
    process.platform === 'win32' ? canonCwd.toLowerCase() : canonCwd
  );
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new Error(`Sal de "${targetRel}" antes de cerrar la tarea: una carpeta que es el directorio actual de un proceso no se puede borrar.`);
  }

  const dirExists = fs.existsSync(targetPath);
  const registered = isRegisteredWorktree(root, targetPath);
  let branchExists = false;
  try {
    const branchOut = execFileSync('git', ['branch', '--list', branch], { cwd: root, encoding: 'utf8' }).trim();
    branchExists = branchOut.length > 0;
  } catch {}

  if (!dirExists && !registered && !branchExists) {
    throw new Error(`No existe la tarea "${name}": ni ${targetRel}, ni un worktree registrado, ni la rama ${branch}`);
  }

  if (!force) {
    // Comprobar cambios sin confirmar
    if (dirExists && registered) {
      const status = execFileSync('git', ['status', '--porcelain'], { cwd: targetPath, encoding: 'utf8' }).trim();
      if (status) {
        const changes = status.split(/\r?\n/).filter((line) => {
          const trimmed = line.trim();
          if (!trimmed) return false;
          const r = trimmed.slice(2).trim();
          return r !== 'node_modules' && r !== 'node_modules/' && !r.endsWith('/node_modules') && !r.endsWith('/node_modules/');
        });
        if (changes.length > 0) {
          throw new Error(`El worktree de la tarea "${name}" tiene cambios sin confirmar`);
        }
      }
    }

    // Comprobar si la rama está integrada en check.baseBranch
    if (branchExists) {
      const baseBranch = config.check.baseBranch;
      const mergedOut = execFileSync('git', ['branch', '--merged', baseBranch], { cwd: root, encoding: 'utf8' });
      const mergedBranches = mergedOut.split(/\r?\n/).map((l) => l.replace(/^[*+]\s+/, '').trim()).filter(Boolean);
      if (!mergedBranches.includes(branch)) {
        throw new Error(`La rama "${branch}" no está integrada en "${baseBranch}"`);
      }
    }
  }

  // Carpeta que quedó sin registrar (dirExists && !registered)
  if (dirExists && !registered) {
    const entries = fs.readdirSync(targetPath);
    let ok = false;
    if (entries.length === 0) {
      ok = true;
    } else if (entries.length === 1 && entries[0] === 'node_modules') {
      const nmPath = path.join(targetPath, 'node_modules');
      let st = null;
      try {
        st = fs.lstatSync(nmPath);
      } catch {}
      if (st && st.isSymbolicLink()) {
        ok = true;
      }
    }
    if (!ok) {
      throw new Error(`"${targetRel}" ya no es un worktree registrado pero contiene archivos; revísalo y bórralo a mano (relevo no borra de forma recursiva).`);
    }
  }

  // Orden de borrado:
  // (1) si <worktree>/node_modules es un enlace, bórralo con fs.unlinkSync o fs.rmdirSync (win32) sin recursive.
  if (dirExists) {
    const targetNodeModules = path.join(targetPath, 'node_modules');
    let nmStat = null;
    try {
      nmStat = fs.lstatSync(targetNodeModules);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    if (nmStat) {
      if (nmStat.isSymbolicLink()) {
        try {
          fs.unlinkSync(targetNodeModules);
        } catch (unlinkErr) {
          if (process.platform === 'win32') {
            fs.rmdirSync(targetNodeModules);
          } else {
            throw unlinkErr;
          }
        }
      } else if (nmStat.isDirectory()) {
        throw new Error(`"${targetNodeModules}" es un directorio real y no un enlace; no se eliminará`);
      } else {
        fs.unlinkSync(targetNodeModules);
      }
    }
  }

  // (2) Worktree
  if (registered && dirExists) {
    const wtArgs = ['worktree', 'remove'];
    if (force) wtArgs.push('--force');
    wtArgs.push(targetRel);
    try {
      execFileSync('git', wtArgs, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      const stderrText = err.stderr ? err.stderr.toString('utf8').trim() : '';
      const detalle = stderrText || err.message;
      throw new Error(`No se pudo eliminar el worktree ${targetRel}: ${detalle}. Si otro proceso (una terminal o un editor) tiene abierta esa carpeta, ciérralo y repite "relevo task done ${name}": el comando retoma un cierre interrumpido.`);
    }
  } else if (registered && !dirExists) {
    execFileSync('git', ['worktree', 'prune'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  } else if (!registered && dirExists) {
    fs.rmdirSync(targetPath);
  }

  // (3) Rama: si branchExists, git branch -d (o -D con --force)
  if (branchExists) {
    const branchArgs = ['branch', force ? '-D' : '-d', branch];
    execFileSync('git', branchArgs, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  }

  const summary = `relevo task done · tarea "${name}" cerrada (worktree ${targetRel} y rama ${branch} eliminados)`;
  if (!silent) {
    console.log(summary);
  }

  return { name, path: targetPath, relativePath: targetRel, branch, summary };
}

function taskList({ cwd = process.cwd(), silent = false } = {}) {
  const root = projectRoot(cwd);
  const config = loadConfig(root);
  const worktreesDir = path.resolve(root, config.worktreesDir);
  const tasks = [];

  if (!fs.existsSync(worktreesDir)) {
    if (!silent) console.log('relevo task list · no hay tareas activas');
    return tasks;
  }

  const baseBranch = config.check.baseBranch;
  let mergedBranches = [];
  try {
    const mergedOut = execFileSync('git', ['branch', '--merged', baseBranch], { cwd: root, encoding: 'utf8' });
    mergedBranches = mergedOut.split(/\r?\n/).map((l) => l.replace(/^[*+]\s+/, '').trim()).filter(Boolean);
  } catch {}

  for (const entry of fs.readdirSync(worktreesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const taskName = entry.name;
    const taskPath = path.join(worktreesDir, taskName);
    const branch = `${config.taskBranchPrefix}${taskName}`;
    const isMerged = mergedBranches.includes(branch);

    let hasChanges = false;
    try {
      const status = execFileSync('git', ['status', '--porcelain'], { cwd: taskPath, encoding: 'utf8' }).trim();
      if (status) {
        const lines = status.split(/\r?\n/).filter((line) => {
          const trimmed = line.trim();
          if (!trimmed) return false;
          const rel = trimmed.slice(2).trim();
          return rel !== 'node_modules' && rel !== 'node_modules/' && !rel.endsWith('/node_modules') && !rel.endsWith('/node_modules/');
        });
        hasChanges = lines.length > 0;
      }
    } catch {}

    tasks.push({
      name: taskName,
      path: taskPath,
      branch,
      isMerged,
      hasChanges,
    });
  }

  if (!silent) {
    if (tasks.length === 0) {
      console.log('relevo task list · no hay tareas activas');
    } else {
      console.log(`relevo task list · ${tasks.length} tarea(s):`);
      for (const t of tasks) {
        const integrada = t.isMerged ? 'sí' : 'no';
        const cambios = t.hasChanges ? 'sí' : 'no';
        console.log(`  ${t.name} (rama: ${t.branch}) · integrada: ${integrada} · cambios: ${cambios}`);
      }
    }
  }

  return tasks;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const action = args[0];
  try {
    if (action === 'new') {
      const name = args[1];
      const fromIdx = args.indexOf('--from');
      const from = fromIdx !== -1 && fromIdx + 1 < args.length ? args[fromIdx + 1] : undefined;
      taskNew({ name, from });
    } else if (action === 'done') {
      const name = args[1];
      const force = args.includes('--force');
      taskDone({ name, force });
    } else if (action === 'list') {
      taskList();
    } else {
      console.error('Uso: relevo task new <nombre> [--from <ref>] | task done <nombre> [--force] | task list');
      process.exit(1);
    }
  } catch (err) {
    console.error(`relevo task · error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  TASK_NAME_REGEX,
  validateTaskName,
  taskNew,
  taskDone,
  taskList,
};
