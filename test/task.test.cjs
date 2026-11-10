'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { taskNew, taskDone, taskList } = require('../lib/task.cjs');

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

// Limpieza general
try {
  fs.rmSync(tmpBase, { recursive: true, force: true });
} catch { /* ignorar */ }

console.log(`\ntask: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
