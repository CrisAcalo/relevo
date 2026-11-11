'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
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

function taskIntegrate({ name, cwd = process.cwd(), silent = false, runTests = true, noQaReason = '' } = {}) {
  validateTaskName(name);

  const root = projectRoot(cwd);
  const config = loadConfig(root);
  const worktreesDir = path.resolve(root, config.worktreesDir);
  const targetPath = path.resolve(worktreesDir, name);
  const branch = `${config.taskBranchPrefix}${name}`;
  const targetRel = path.relative(root, targetPath).replace(/\\/g, '/');
  const base = config.check.baseBranch;

  const actual = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (actual !== base) {
    throw new Error(`Integra desde la rama ${base} del repositorio principal (ahora en ${actual}).`);
  }

  const rootStatus = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim();
  if (rootStatus.length > 0) {
    throw new Error('El repositorio principal tiene cambios sin confirmar; confírmalos o descártalos antes de integrar.');
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error(`No existe la tarea "${name}" en ${targetRel}.`);
  }

  const status = execFileSync('git', ['status', '--porcelain'], { cwd: targetPath, encoding: 'utf8' }).trim();
  if (status) {
    const changes = status.split(/\r?\n/).filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      const r = trimmed.slice(2).trim();
      return r !== 'node_modules' && r !== 'node_modules/' && !r.endsWith('/node_modules') && !r.endsWith('/node_modules/');
    });
    if (changes.length > 0) {
      throw new Error(`El worktree de la tarea "${name}" tiene cambios sin confirmar.`);
    }
  }

  let rebased = false;
  let isAncestor = false;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', base, branch], { cwd: root, stdio: 'ignore' });
    isAncestor = true;
  } catch {
    isAncestor = false;
  }

  if (!isAncestor) {
    try {
      execFileSync('git', ['rebase', base], { cwd: targetPath, stdio: ['ignore', 'pipe', 'pipe'] });
      rebased = true;
    } catch {
      try {
        execFileSync('git', ['rebase', '--abort'], { cwd: targetPath, stdio: 'ignore' });
      } catch {}
      throw new Error(`Conflictos al rebasar ${branch} sobre ${base}: resuélvelos en ${targetRel} y repite "relevo task integrate ${name}".`);
    }
  }

  if (runTests && config.check.testCommand) {
    let cmd = config.check.testCommand[0];
    const testArgs = config.check.testCommand.slice(1);
    let shell = false;
    if (process.platform === 'win32' && (cmd === 'npm' || cmd === 'npx')) {
      cmd = `${cmd}.cmd`;
      shell = true;
    }
    const testOptions = { cwd: targetPath, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 };
    // Con shell (npm.cmd en Windows), una sola línea ya citada: pasar argumentos sueltos con shell: true
    // está obsoleto en Node 24 (DEP0190) porque no se escapan. testCommand viene de la configuración del proyecto.
    const quote = (arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);
    const testRes = shell
      ? spawnSync([cmd, ...testArgs].map(quote).join(' '), { ...testOptions, shell: true })
      : spawnSync(cmd, testArgs, testOptions);
    if (testRes.status !== 0 || testRes.error) {
      const combined = (testRes.stdout || '') + (testRes.stderr || '');
      const lines = combined.split(/\r?\n/).filter((line) => line.trim().length > 0);
      let ultimas = lines.slice(-40).join('\n');
      if (testRes.error) {
        ultimas = ultimas ? `${ultimas}\n${testRes.error.message}` : (testRes.error.message ?? '');
      }
      throw new Error(`Las pruebas fallan en ${targetRel}; no se integra. Últimas líneas:\n${ultimas}`);
    }
    if (!silent) {
      const cmdOriginal = config.check.testCommand.join(' ');
      console.log(`relevo task integrate · pruebas: ok (${cmdOriginal})`);
    }
  }

  const checkRes = spawnSync(process.execPath, [path.join(__dirname, 'check-change.cjs'), ...(noQaReason ? ['--sin-qa', noQaReason] : [])], { cwd: targetPath, encoding: 'utf8' });
  if (checkRes.status !== 0) {
    const combined = (checkRes.stdout || '') + (checkRes.stderr || '');
    const lines = combined.trimEnd().split(/\r?\n/);
    const last15 = lines.slice(-15).join('\n');
    throw new Error(`relevo check no pasa en ${targetRel}:\n${last15}`);
  }

  try {
    execFileSync('git', ['merge', '--ff-only', branch], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    throw new Error(`No se pudo integrar ${branch} por fast-forward.`);
  }

  taskDone({ name, cwd: root, silent: true });

  if (!silent) {
    console.log(`relevo task integrate · ${branch} integrada en ${base}${rebased ? ' (tras rebase)' : ''} y tarea cerrada.`);
  }

  return { name, branch, base, rebased };
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
    } else if (action === 'integrate') {
      const name = args[1];
      const runTests = !args.includes('--sin-pruebas');
      const sinQaIdx = args.indexOf('--sin-qa');
      const noQaReason = sinQaIdx !== -1 && sinQaIdx + 1 < args.length ? args[sinQaIdx + 1] : '';
      if (sinQaIdx !== -1 && !noQaReason.trim()) throw new Error('--sin-qa exige un motivo: --sin-qa "<motivo>"');
      taskIntegrate({ name, runTests, noQaReason });
    } else if (action === 'list') {
      taskList();
    } else {
      console.error('Uso: relevo task new <nombre> [--from <ref>] | task done <nombre> [--force] | task integrate <nombre> [--sin-qa "<motivo>"] [--sin-pruebas] | task list');
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
  taskIntegrate,
};
