'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { taskNew, taskDone, taskList, taskIntegrate } = require('../lib/task.cjs');

const failures = [];
let passed = 0;
function test(name, action) {
  try {
    action();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'relevo-task-test-'));

function makeGitRepo(baseDir) {
  const dir = fs.mkdtempSync(path.join(baseDir, 'repo-'));
  execFileSync('git', ['init', '-b', 'main', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@relevo.local'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Relevo Test'], { cwd: dir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });

  fs.writeFileSync(path.join(dir, 'README.md'), '# test repo\n');
  const nm = path.join(dir, 'node_modules');
  fs.mkdirSync(nm);
  fs.writeFileSync(path.join(nm, 'centinela.txt'), 'centinela-ok\n');

  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'commit inicial', '-q'], { cwd: dir });
  return dir;
}

test('(a) task new demo crea .worktrees/demo, rama relevo/demo y node_modules enlazado', () => {
  const repo = makeGitRepo(tmpBase);
  const created = taskNew({ name: 'demo', cwd: repo, silent: true });

  assert.equal(created.name, 'demo');
  assert.equal(created.branch, 'relevo/demo');
  assert.ok(fs.existsSync(path.join(repo, '.worktrees', 'demo')));

  // Rama creada
  const branchOut = execFileSync('git', ['branch', '--list', 'relevo/demo'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.ok(branchOut.includes('relevo/demo'));

  // Leer node_modules/centinela.txt desde el worktree funciona
  const centinelaWorktree = path.join(repo, '.worktrees', 'demo', 'node_modules', 'centinela.txt');
  assert.ok(fs.existsSync(centinelaWorktree));
  assert.equal(fs.readFileSync(centinelaWorktree, 'utf8'), 'centinela-ok\n');
});

test('(b) task new demo otra vez → error', () => {
  const repo = makeGitRepo(tmpBase);
  taskNew({ name: 'demo', cwd: repo, silent: true });

  assert.throws(
    () => taskNew({ name: 'demo', cwd: repo, silent: true }),
    /Ya existe el directorio de trabajo/
  );
});

test('(c) nombre Demo_1 → error', () => {
  const repo = makeGitRepo(tmpBase);
  assert.throws(
    () => taskNew({ name: 'Demo_1', cwd: repo, silent: true }),
    /Nombre de tarea inválido/
  );
  assert.throws(
    () => taskNew({ name: '-invalido', cwd: repo, silent: true }),
    /Nombre de tarea inválido/
  );
  assert.throws(
    () => taskNew({ name: 'con espacios', cwd: repo, silent: true }),
    /Nombre de tarea inválido/
  );
});

test('(d) task done demo con un archivo nuevo sin commit en el worktree → error y el worktree sigue', () => {
  const repo = makeGitRepo(tmpBase);
  taskNew({ name: 'demo', cwd: repo, silent: true });

  const uncommittedFile = path.join(repo, '.worktrees', 'demo', 'archivo-nuevo.txt');
  fs.writeFileSync(uncommittedFile, 'cambio sin confirmar\n');

  assert.throws(
    () => taskDone({ name: 'demo', cwd: repo, silent: true }),
    /tiene cambios sin confirmar/
  );

  // El worktree sigue existiendo
  assert.ok(fs.existsSync(path.join(repo, '.worktrees', 'demo')));
});

test('(e) con un commit en la rama sin integrar → error', () => {
  const repo = makeGitRepo(tmpBase);
  taskNew({ name: 'demo', cwd: repo, silent: true });
  const wtDir = path.join(repo, '.worktrees', 'demo');

  fs.writeFileSync(path.join(wtDir, 'feature.txt'), 'funcionalidad nueva\n');
  execFileSync('git', ['add', 'feature.txt'], { cwd: wtDir });
  execFileSync('git', ['commit', '-m', 'nueva funcionalidad', '-q'], { cwd: wtDir });

  assert.throws(
    () => taskDone({ name: 'demo', cwd: repo, silent: true }),
    /no está integrada en "main"/
  );

  // El worktree y la rama siguen existiendo
  assert.ok(fs.existsSync(wtDir));
  const branchOut = execFileSync('git', ['branch', '--list', 'relevo/demo'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.ok(branchOut.includes('relevo/demo'));
});

test('(f) tras integrar (git merge --ff-only relevo/demo en la raíz) → task done demo borra worktree y rama, y centinela sigue existiendo', () => {
  const repo = makeGitRepo(tmpBase);
  taskNew({ name: 'demo', cwd: repo, silent: true });
  const wtDir = path.join(repo, '.worktrees', 'demo');

  fs.writeFileSync(path.join(wtDir, 'feature.txt'), 'funcionalidad integrada\n');
  execFileSync('git', ['add', 'feature.txt'], { cwd: wtDir });
  execFileSync('git', ['commit', '-m', 'integrar', '-q'], { cwd: wtDir });

  // Integrar en main
  execFileSync('git', ['merge', '--ff-only', 'relevo/demo'], { cwd: repo });

  // Cerrar tarea
  taskDone({ name: 'demo', cwd: repo, silent: true });

  // Worktree borrado
  assert.equal(fs.existsSync(wtDir), false);

  // Rama borrada
  const branchOut = execFileSync('git', ['branch', '--list', 'relevo/demo'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.equal(branchOut, '');

  // PRUEBA CRÍTICA: node_modules/centinela.txt de la raíz sigue existiendo intacto
  const centinelaRoot = path.join(repo, 'node_modules', 'centinela.txt');
  assert.ok(fs.existsSync(centinelaRoot), 'centinela.txt de la raíz debe seguir existiendo');
  assert.equal(fs.readFileSync(centinelaRoot, 'utf8'), 'centinela-ok\n');
});

test('(g) task done con --force sobre una rama sin integrar la borra y el centinela sigue existiendo', () => {
  const repo = makeGitRepo(tmpBase);
  taskNew({ name: 'forzada', cwd: repo, silent: true });
  const wtDir = path.join(repo, '.worktrees', 'forzada');

  fs.writeFileSync(path.join(wtDir, 'feature-abandonada.txt'), 'abandonar\n');
  execFileSync('git', ['add', 'feature-abandonada.txt'], { cwd: wtDir });
  execFileSync('git', ['commit', '-m', 'commit abandonado', '-q'], { cwd: wtDir });

  // Cerrar con --force
  taskDone({ name: 'forzada', force: true, cwd: repo, silent: true });

  assert.equal(fs.existsSync(wtDir), false);
  const branchOut = execFileSync('git', ['branch', '--list', 'relevo/forzada'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.equal(branchOut, '');

  // Centinela intacto
  const centinelaRoot = path.join(repo, 'node_modules', 'centinela.txt');
  assert.ok(fs.existsSync(centinelaRoot));
  assert.equal(fs.readFileSync(centinelaRoot, 'utf8'), 'centinela-ok\n');
});

test('(h) si <worktree>/node_modules es un directorio real (no enlace) → task done da error y no borra nada', () => {
  const repo = makeGitRepo(tmpBase);
  taskNew({ name: 'realdemo', cwd: repo, silent: true });
  const wtDir = path.join(repo, '.worktrees', 'realdemo');
  const wtNodeModules = path.join(wtDir, 'node_modules');

  // Quitar el symlink/junction y sustituir por un directorio real
  fs.unlinkSync(wtNodeModules);
  fs.mkdirSync(wtNodeModules);
  fs.writeFileSync(path.join(wtNodeModules, 'real.txt'), 'archivo en dir real\n');

  assert.throws(
    () => taskDone({ name: 'realdemo', force: true, cwd: repo, silent: true }),
    /es un directorio real y no un enlace/
  );

  // No borra el worktree ni la rama
  assert.ok(fs.existsSync(wtDir));
  assert.ok(fs.existsSync(path.join(wtNodeModules, 'real.txt')));
  const branchOut = execFileSync('git', ['branch', '--list', 'relevo/realdemo'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.ok(branchOut.includes('relevo/realdemo'));

  // Limpieza manual de este caso especial
  fs.rmSync(wtNodeModules, { recursive: true, force: true });
  execFileSync('git', ['worktree', 'remove', '--force', '.worktrees/realdemo'], { cwd: repo });
  execFileSync('git', ['branch', '-D', 'relevo/realdemo'], { cwd: repo });
});

test('(i) taskBranchPrefix: "tarea/" en relevo.config.json → la rama es tarea/demo', () => {
  const repo = makeGitRepo(tmpBase);
  fs.writeFileSync(path.join(repo, 'relevo.config.json'), JSON.stringify({ taskBranchPrefix: 'tarea/' }, null, 2) + '\n');

  const created = taskNew({ name: 'demo', cwd: repo, silent: true });
  assert.equal(created.branch, 'tarea/demo');

  const branchOut = execFileSync('git', ['branch', '--list', 'tarea/demo'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.ok(branchOut.includes('tarea/demo'));

  taskDone({ name: 'demo', cwd: repo, silent: true });
});

test('(j) task list muestra la tarea con su estado', () => {
  const repo = makeGitRepo(tmpBase);
  taskNew({ name: 'demo-list', cwd: repo, silent: true });

  let tasks = taskList({ cwd: repo, silent: true });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].name, 'demo-list');
  assert.equal(tasks[0].branch, 'relevo/demo-list');
  assert.equal(tasks[0].isMerged, true); // HEAD en demo-list apunta al mismo commit que main
  assert.equal(tasks[0].hasChanges, false);

  // Agregar un cambio sin confirmar
  const changeFile = path.join(repo, '.worktrees', 'demo-list', 'cambio.txt');
  fs.writeFileSync(changeFile, 'modificado\n');

  tasks = taskList({ cwd: repo, silent: true });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].hasChanges, true);

  // Limpieza
  fs.unlinkSync(changeFile);
  taskDone({ name: 'demo-list', cwd: repo, silent: true });

  tasks = taskList({ cwd: repo, silent: true });
  assert.equal(tasks.length, 0);
});

test('CLI bin/relevo.cjs task new / list / done', () => {
  const repo = makeGitRepo(tmpBase);
  const binPath = path.resolve(__dirname, '..', 'bin', 'relevo.cjs');

  // task new
  const resNew = spawnSync(process.execPath, [binPath, 'task', 'new', 'cli-task'], {
    cwd: repo,
    encoding: 'utf8',
  });
  assert.equal(resNew.status, 0, resNew.stderr);
  assert.ok(resNew.stdout.includes('cli-task'));
  assert.ok(fs.existsSync(path.join(repo, '.worktrees', 'cli-task')));

  // task list
  const resList = spawnSync(process.execPath, [binPath, 'task', 'list'], {
    cwd: repo,
    encoding: 'utf8',
  });
  assert.equal(resList.status, 0, resList.stderr);
  assert.ok(resList.stdout.includes('cli-task'));

  // task done
  const resDone = spawnSync(process.execPath, [binPath, 'task', 'done', 'cli-task'], {
    cwd: repo,
    encoding: 'utf8',
  });
  assert.equal(resDone.status, 0, resDone.stderr);
  assert.equal(fs.existsSync(path.join(repo, '.worktrees', 'cli-task')), false);
});

test('(k) cierre interrumpido: worktree desregistrado con la carpeta vacía → task done la borra y borra la rama', () => {
  const repo = makeGitRepo(tmpBase);
  taskNew({ name: 'demo', cwd: repo, silent: true });
  const wtDir = path.join(repo, '.worktrees', 'demo');
  const wtNm = path.join(wtDir, 'node_modules');
  try {
    fs.unlinkSync(wtNm);
  } catch (err) {
    if (process.platform === 'win32') {
      fs.rmdirSync(wtNm);
    } else {
      throw err;
    }
  }
  execFileSync('git', ['worktree', 'remove', '.worktrees/demo'], { cwd: repo });
  fs.mkdirSync(wtDir);

  taskDone({ name: 'demo', cwd: repo, silent: true });

  assert.equal(fs.existsSync(wtDir), false);
  const branchOut = execFileSync('git', ['branch', '--list', 'relevo/demo'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.equal(branchOut, '');

  const centinelaRoot = path.join(repo, 'node_modules', 'centinela.txt');
  assert.ok(fs.existsSync(centinelaRoot));
  assert.equal(fs.readFileSync(centinelaRoot, 'utf8'), 'centinela-ok\n');
});

test('(l) carpeta desregistrada con un archivo dentro → error y no se borra nada', () => {
  const repo = makeGitRepo(tmpBase);
  taskNew({ name: 'demo', cwd: repo, silent: true });
  const wtDir = path.join(repo, '.worktrees', 'demo');
  const wtNm = path.join(wtDir, 'node_modules');
  try {
    fs.unlinkSync(wtNm);
  } catch (err) {
    if (process.platform === 'win32') {
      fs.rmdirSync(wtNm);
    } else {
      throw err;
    }
  }
  execFileSync('git', ['worktree', 'remove', '.worktrees/demo'], { cwd: repo });
  fs.mkdirSync(wtDir);
  const restoFile = path.join(wtDir, 'resto.txt');
  fs.writeFileSync(restoFile, 'contenido\n');

  assert.throws(
    () => taskDone({ name: 'demo', cwd: repo, silent: true }),
    /ya no es un worktree registrado/
  );

  assert.ok(fs.existsSync(restoFile));
  const branchOut = execFileSync('git', ['branch', '--list', 'relevo/demo'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.ok(branchOut.includes('relevo/demo'));

  const centinelaRoot = path.join(repo, 'node_modules', 'centinela.txt');
  assert.ok(fs.existsSync(centinelaRoot));
  assert.equal(fs.readFileSync(centinelaRoot, 'utf8'), 'centinela-ok\n');
});

test('(m) carpeta borrada pero worktree registrado → task done hace prune y borra la rama', () => {
  const repo = makeGitRepo(tmpBase);
  taskNew({ name: 'demo', cwd: repo, silent: true });
  const wtDir = path.join(repo, '.worktrees', 'demo');
  const wtNm = path.join(wtDir, 'node_modules');
  try {
    fs.unlinkSync(wtNm);
  } catch (err) {
    if (process.platform === 'win32') {
      fs.rmdirSync(wtNm);
    } else {
      throw err;
    }
  }
  fs.rmSync(wtDir, { recursive: true, force: true });

  taskDone({ name: 'demo', cwd: repo, silent: true });

  const wtList = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' });
  assert.ok(!/\.worktrees\/demo/.test(wtList));

  const branchOut = execFileSync('git', ['branch', '--list', 'relevo/demo'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.equal(branchOut, '');

  const centinelaRoot = path.join(repo, 'node_modules', 'centinela.txt');
  assert.ok(fs.existsSync(centinelaRoot));
  assert.equal(fs.readFileSync(centinelaRoot, 'utf8'), 'centinela-ok\n');
});

test('(n) solo queda la rama → task done la borra', () => {
  const repo = makeGitRepo(tmpBase);
  taskNew({ name: 'demo', cwd: repo, silent: true });
  const wtDir = path.join(repo, '.worktrees', 'demo');
  const wtNm = path.join(wtDir, 'node_modules');
  try {
    fs.unlinkSync(wtNm);
  } catch (err) {
    if (process.platform === 'win32') {
      fs.rmdirSync(wtNm);
    } else {
      throw err;
    }
  }
  execFileSync('git', ['worktree', 'remove', '.worktrees/demo'], { cwd: repo });

  taskDone({ name: 'demo', cwd: repo, silent: true });

  const branchOut = execFileSync('git', ['branch', '--list', 'relevo/demo'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.equal(branchOut, '');

  const centinelaRoot = path.join(repo, 'node_modules', 'centinela.txt');
  assert.ok(fs.existsSync(centinelaRoot));
  assert.equal(fs.readFileSync(centinelaRoot, 'utf8'), 'centinela-ok\n');
});

test('(o) no existe nada → error', () => {
  const repo = makeGitRepo(tmpBase);

  assert.throws(
    () => taskDone({ name: 'demo', cwd: repo, silent: true }),
    /No existe la tarea "demo"/
  );

  const centinelaRoot = path.join(repo, 'node_modules', 'centinela.txt');
  assert.ok(fs.existsSync(centinelaRoot));
  assert.equal(fs.readFileSync(centinelaRoot, 'utf8'), 'centinela-ok\n');
});

test('(p) desregistrada con carpeta vacía y rama sin integrar → error sin --force y no se borra nada', () => {
  const repo = makeGitRepo(tmpBase);
  taskNew({ name: 'demo', cwd: repo, silent: true });
  const wtDir = path.join(repo, '.worktrees', 'demo');
  const nuevoFile = path.join(wtDir, 'nuevo.txt');
  fs.writeFileSync(nuevoFile, 'contenido nuevo\n');
  execFileSync('git', ['add', 'nuevo.txt'], { cwd: wtDir });
  execFileSync('git', ['commit', '-m', 'x', '-q'], { cwd: wtDir });

  const wtNm = path.join(wtDir, 'node_modules');
  try {
    fs.unlinkSync(wtNm);
  } catch (err) {
    if (process.platform === 'win32') {
      fs.rmdirSync(wtNm);
    } else {
      throw err;
    }
  }
  execFileSync('git', ['worktree', 'remove', '.worktrees/demo'], { cwd: repo });
  fs.mkdirSync(wtDir);

  assert.throws(
    () => taskDone({ name: 'demo', cwd: repo, silent: true }),
    /no está integrada/
  );

  assert.ok(fs.existsSync(wtDir));
  const branchOut = execFileSync('git', ['branch', '--list', 'relevo/demo'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.ok(branchOut.includes('relevo/demo'));

  const centinelaRoot = path.join(repo, 'node_modules', 'centinela.txt');
  assert.ok(fs.existsSync(centinelaRoot));
  assert.equal(fs.readFileSync(centinelaRoot, 'utf8'), 'centinela-ok\n');
});

test('(q) directorio actual dentro de la tarea → error y no se borra nada', () => {
  const repo = makeGitRepo(tmpBase);
  taskNew({ name: 'demo', cwd: repo, silent: true });
  const wtDir = path.join(repo, '.worktrees', 'demo');

  const prev = process.cwd();
  process.chdir(wtDir);
  try {
    assert.throws(
      () => taskDone({ name: 'demo', cwd: repo, silent: true }),
      /Sal de/
    );
  } finally {
    process.chdir(prev);
  }

  assert.ok(fs.existsSync(wtDir));
  const branchOut = execFileSync('git', ['branch', '--list', 'relevo/demo'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.ok(branchOut.includes('relevo/demo'));

  const centinelaRoot = path.join(repo, 'node_modules', 'centinela.txt');
  assert.ok(fs.existsSync(centinelaRoot));
  assert.equal(fs.readFileSync(centinelaRoot, 'utf8'), 'centinela-ok\n');
});

// Añadida por el auditor: el sobrante más probable tras un cierre a medias conserva el enlace a node_modules.
test('(r) carpeta desregistrada con solo el enlace node_modules → task done quita el enlace, borra la carpeta y la rama', () => {
  const repo = makeGitRepo(tmpBase);
  taskNew({ name: 'demo', cwd: repo, silent: true });
  const wtDir = path.join(repo, '.worktrees', 'demo');
  const wtNm = path.join(wtDir, 'node_modules');
  try {
    fs.unlinkSync(wtNm);
  } catch (err) {
    if (process.platform === 'win32') fs.rmdirSync(wtNm);
    else throw err;
  }
  execFileSync('git', ['worktree', 'remove', '.worktrees/demo'], { cwd: repo });
  fs.mkdirSync(wtDir);
  fs.symlinkSync(path.join(repo, 'node_modules'), wtNm, process.platform === 'win32' ? 'junction' : 'dir');
  assert.ok(fs.lstatSync(wtNm).isSymbolicLink());

  taskDone({ name: 'demo', cwd: repo, silent: true });

  assert.equal(fs.existsSync(wtDir), false);
  const branchOut = execFileSync('git', ['branch', '--list', 'relevo/demo'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.equal(branchOut, '');
  const centinelaRoot = path.join(repo, 'node_modules', 'centinela.txt');
  assert.ok(fs.existsSync(centinelaRoot));
  assert.equal(fs.readFileSync(centinelaRoot, 'utf8'), 'centinela-ok\n');
});

test('(s) tarea con un commit y base sin avanzar → taskIntegrate hace fast-forward, main contiene el commit, carpeta y rama no existen y rebased === false', () => {
  const repo = makeGitRepo(tmpBase);
  taskNew({ name: 'feat-s', cwd: repo, silent: true });
  const wtDir = path.join(repo, '.worktrees', 'feat-s');
  fs.writeFileSync(path.join(wtDir, 'archivo-s.txt'), 'contenido s\n');
  execFileSync('git', ['add', 'archivo-s.txt'], { cwd: wtDir });
  execFileSync('git', ['commit', '-m', 'commit s', '-q'], { cwd: wtDir });
  const commitHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wtDir, encoding: 'utf8' }).trim();

  const res = taskIntegrate({ name: 'feat-s', cwd: repo, silent: true, runTests: false });
  assert.equal(res.rebased, false);
  assert.equal(res.name, 'feat-s');
  assert.equal(res.branch, 'relevo/feat-s');

  const mainHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.equal(mainHead, commitHash);
  assert.ok(fs.existsSync(path.join(repo, 'archivo-s.txt')));

  assert.equal(fs.existsSync(wtDir), false);
  const branchOut = execFileSync('git', ['branch', '--list', 'relevo/feat-s'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.equal(branchOut, '');
});

test('(t) tarea con un commit en un archivo y commit nuevo en main sobre otro archivo → taskIntegrate rebasa (rebased === true) e integra', () => {
  const repo = makeGitRepo(tmpBase);
  taskNew({ name: 'feat-t', cwd: repo, silent: true });
  const wtDir = path.join(repo, '.worktrees', 'feat-t');
  fs.writeFileSync(path.join(wtDir, 'archivo-t.txt'), 'contenido t\n');
  execFileSync('git', ['add', 'archivo-t.txt'], { cwd: wtDir });
  execFileSync('git', ['commit', '-m', 'commit t', '-q'], { cwd: wtDir });

  fs.writeFileSync(path.join(repo, 'otro.txt'), 'otro en main\n');
  execFileSync('git', ['add', 'otro.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'commit en main', '-q'], { cwd: repo });

  const res = taskIntegrate({ name: 'feat-t', cwd: repo, silent: true, runTests: false });
  assert.equal(res.rebased, true);
  assert.equal(res.name, 'feat-t');
  assert.equal(res.branch, 'relevo/feat-t');

  assert.ok(fs.existsSync(path.join(repo, 'archivo-t.txt')));
  assert.ok(fs.existsSync(path.join(repo, 'otro.txt')));

  assert.equal(fs.existsSync(wtDir), false);
  const branchOut = execFileSync('git', ['branch', '--list', 'relevo/feat-t'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.equal(branchOut, '');
});

test('(u) tarea y main modifican la misma línea del mismo archivo → taskIntegrate lanza /Conflictos al rebasar/, sin rebase en curso y main no cambió', () => {
  const repo = makeGitRepo(tmpBase);
  taskNew({ name: 'feat-u', cwd: repo, silent: true });
  const wtDir = path.join(repo, '.worktrees', 'feat-u');

  fs.writeFileSync(path.join(wtDir, 'README.md'), '# conflicto desde tarea\n');
  execFileSync('git', ['add', 'README.md'], { cwd: wtDir });
  execFileSync('git', ['commit', '-m', 'conflicto en tarea', '-q'], { cwd: wtDir });

  fs.writeFileSync(path.join(repo, 'README.md'), '# conflicto desde main\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'conflicto en main', '-q'], { cwd: repo });
  const mainHeadBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

  assert.throws(
    () => taskIntegrate({ name: 'feat-u', cwd: repo, silent: true, runTests: false }),
    /Conflictos al rebasar/
  );

  const wtGitDir = execFileSync('git', ['rev-parse', '--git-dir'], { cwd: wtDir, encoding: 'utf8' }).trim();
  const absWtGitDir = path.resolve(wtDir, wtGitDir);
  assert.equal(fs.existsSync(path.join(absWtGitDir, 'rebase-merge')), false);
  assert.equal(fs.existsSync(path.join(absWtGitDir, 'rebase-apply')), false);

  const mainHeadAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.equal(mainHeadAfter, mainHeadBefore);
});

test('(v) main con un cambio sin confirmar en un archivo con seguimiento → lanza /cambios sin confirmar/', () => {
  const repo = makeGitRepo(tmpBase);
  taskNew({ name: 'feat-v', cwd: repo, silent: true });
  const wtDir = path.join(repo, '.worktrees', 'feat-v');
  fs.writeFileSync(path.join(wtDir, 'v.txt'), 'v\n');
  execFileSync('git', ['add', 'v.txt'], { cwd: wtDir });
  execFileSync('git', ['commit', '-m', 'v', '-q'], { cwd: wtDir });

  fs.writeFileSync(path.join(repo, 'README.md'), '# modificado sin commit\n');

  assert.throws(
    () => taskIntegrate({ name: 'feat-v', cwd: repo, silent: true, runTests: false }),
    /cambios sin confirmar/
  );
});

// Añadida por el auditor: integrar desde otra rama del repositorio principal movería esa rama, no la base.
test('(z) el repositorio principal en otra rama → lanza /Integra desde la rama main/ y no integra', () => {
  const repo = makeGitRepo(tmpBase);
  taskNew({ name: 'feat-z', cwd: repo, silent: true });
  const wtDir = path.join(repo, '.worktrees', 'feat-z');
  fs.writeFileSync(path.join(wtDir, 'z.txt'), 'z\n');
  execFileSync('git', ['add', 'z.txt'], { cwd: wtDir });
  execFileSync('git', ['commit', '-m', 'z', '-q'], { cwd: wtDir });
  execFileSync('git', ['checkout', '-q', '-b', 'otra'], { cwd: repo });

  assert.throws(
    () => taskIntegrate({ name: 'feat-z', cwd: repo, silent: true, runTests: false }),
    /Integra desde la rama main/
  );
  assert.equal(fs.existsSync(path.join(repo, 'z.txt')), false);
  assert.ok(fs.existsSync(wtDir));
});

test('(w) runTests: true con relevo.config.json del repo de prueba con {"check":{"testCommand":["node","-e","process.exit(1)"]}} → lanza /Las pruebas fallan/ y main no cambió', () => {
  const repo = makeGitRepo(tmpBase);
  fs.writeFileSync(
    path.join(repo, 'relevo.config.json'),
    JSON.stringify({ check: { testCommand: ['node', '-e', 'process.exit(1)'] } }, null, 2) + '\n'
  );
  execFileSync('git', ['add', 'relevo.config.json'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'config testCommand', '-q'], { cwd: repo });
  const mainHeadBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

  taskNew({ name: 'feat-w', cwd: repo, silent: true });
  const wtDir = path.join(repo, '.worktrees', 'feat-w');
  fs.writeFileSync(path.join(wtDir, 'w.txt'), 'w\n');
  execFileSync('git', ['add', 'w.txt'], { cwd: wtDir });
  execFileSync('git', ['commit', '-m', 'w', '-q'], { cwd: wtDir });

  assert.throws(
    () => taskIntegrate({ name: 'feat-w', cwd: repo, silent: true, runTests: true }),
    /Las pruebas fallan/
  );

  const mainHeadAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  assert.equal(mainHeadAfter, mainHeadBefore);
});

test('(x) repo de prueba con sourcePattern "^README\\.md$" y commit que toca README.md sin veredicto → taskIntegrate lanza /relevo check no pasa/', () => {
  const repo = makeGitRepo(tmpBase);
  fs.writeFileSync(
    path.join(repo, 'relevo.config.json'),
    JSON.stringify({ check: { sourcePattern: '^README\\.md$' } }, null, 2) + '\n'
  );
  execFileSync('git', ['add', 'relevo.config.json'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'config sourcePattern', '-q'], { cwd: repo });

  taskNew({ name: 'feat-x', cwd: repo, silent: true });
  const wtDir = path.join(repo, '.worktrees', 'feat-x');
  fs.writeFileSync(path.join(wtDir, 'README.md'), '# README modificado\n');
  execFileSync('git', ['add', 'README.md'], { cwd: wtDir });
  execFileSync('git', ['commit', '-m', 'modifica README', '-q'], { cwd: wtDir });

  assert.throws(
    () => taskIntegrate({ name: 'feat-x', cwd: repo, silent: true, runTests: false }),
    /relevo check no pasa/
  );
});

// Añadida por el auditor: el ciclo ligero integra sin veredicto pasando --sin-qa a relevo check.
test('(y) taskIntegrate con noQaReason pasa --sin-qa a check: sin motivo falla, con motivo integra', () => {
  const repo = makeGitRepo(tmpBase);
  fs.writeFileSync(path.join(repo, 'relevo.config.json'), JSON.stringify({ check: { sourcePattern: '^lib/' } }, null, 2) + '\n');
  // Como en un proyecto real: sin esto, el enlace node_modules del worktree cuenta como cambio sin commit.
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
  execFileSync('git', ['add', 'relevo.config.json', '.gitignore'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'config', '-q'], { cwd: repo });
  taskNew({ name: 'ligera', cwd: repo, silent: true });
  const wtDir = path.join(repo, '.worktrees', 'ligera');
  fs.mkdirSync(path.join(wtDir, 'lib'));
  fs.mkdirSync(path.join(wtDir, 'test'));
  fs.writeFileSync(path.join(wtDir, 'lib', 'a.cjs'), "'use strict';\n");
  fs.writeFileSync(path.join(wtDir, 'test', 'a.test.cjs'), "'use strict';\n");
  execFileSync('git', ['add', 'lib/a.cjs', 'test/a.test.cjs'], { cwd: wtDir });
  execFileSync('git', ['commit', '-m', 'cambio ligero', '-q'], { cwd: wtDir });

  assert.throws(() => taskIntegrate({ name: 'ligera', cwd: repo, silent: true, runTests: false }), /relevo check no pasa/);
  const result = taskIntegrate({ name: 'ligera', cwd: repo, silent: true, runTests: false, noQaReason: 'cambio trivial' });
  assert.equal(result.rebased, false);
  assert.ok(fs.existsSync(path.join(repo, 'lib', 'a.cjs')));
  assert.equal(fs.existsSync(wtDir), false);
});

// Limpieza general
try {
  fs.rmSync(tmpBase, { recursive: true, force: true });
} catch { /* ignorar */ }

console.log(`\ntask: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;