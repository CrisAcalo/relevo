'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { init, assertGitRoot } = require('../lib/init.cjs');

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

function makeGitRepo(baseDir) {
  const dir = fs.mkdtempSync(path.join(baseDir, 'repo-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'relevo-init-test-'));

test('fuera de un repositorio git → error', () => {
  const nonGitDir = fs.mkdtempSync(path.join(tmpBase, 'non-git-'));
  assert.throws(
    () => init({ cwd: nonGitDir, silent: true }),
    /relevo init: debe ejecutarse en la raíz de un repositorio git/
  );
});

test('--dry-run no crea nada', () => {
  const repo = makeGitRepo(tmpBase);
  const r = init({ cwd: repo, dryRun: true, silent: true });

  assert.ok(r.summary.creado > 0);
  assert.equal(fs.existsSync(path.join(repo, 'relevo.config.json')), false);
  assert.equal(fs.existsSync(path.join(repo, '.claude')), false);
  assert.equal(fs.existsSync(path.join(repo, '.agents')), false);
  assert.equal(fs.existsSync(path.join(repo, '.gitignore')), false);
});

test('primera ejecución crea todos los archivos; segunda ejecución → todos sin cambios e idénticos byte a byte', () => {
  const repo = makeGitRepo(tmpBase);

  // Primera ejecución
  const r1 = init({ cwd: repo, silent: true });
  assert.equal(r1.summary.creado, r1.results.length);
  assert.equal(r1.summary.actualizado, 0);
  assert.equal(r1.summary.sin_cambios, 0);
  assert.equal(r1.summary.conservado, 0);

  // Comprobar archivos clave creados
  assert.ok(fs.existsSync(path.join(repo, 'relevo.config.json')));
  assert.ok(fs.existsSync(path.join(repo, '.agents/hooks/permission-gate.cjs')));
  assert.ok(fs.existsSync(path.join(repo, '.agents/hooks.json')));
  assert.ok(fs.existsSync(path.join(repo, '.agents/skills.json')));
  assert.ok(fs.existsSync(path.join(repo, '.agents/plugins/relevo/plugin.json')));
  assert.ok(fs.existsSync(path.join(repo, '.gitignore')));
  assert.ok(fs.existsSync(path.join(repo, '.claude/skills/verificar-cambio/SKILL.md')));

  // Snapshot de contenidos byte a byte
  const snapshots = new Map();
  for (const r of r1.results) {
    const full = path.join(repo, r.file);
    snapshots.set(r.file, fs.readFileSync(full));
  }

  // Segunda ejecución
  const r2 = init({ cwd: repo, silent: true });
  assert.equal(r2.summary.sin_cambios, r2.results.length);
  assert.equal(r2.summary.creado, 0);
  assert.equal(r2.summary.actualizado, 0);
  assert.equal(r2.summary.conservado, 0);

  for (const r of r2.results) {
    const full = path.join(repo, r.file);
    const current = fs.readFileSync(full);
    assert.deepEqual(current, snapshots.get(r.file), `El archivo ${r.file} cambió en la segunda ejecución`);
  }
});

test('un SKILL.md modificado se "conserva" sin --force y se actualiza con --force', () => {
  const repo = makeGitRepo(tmpBase);
  init({ cwd: repo, silent: true });

  const skillPath = path.join(repo, '.claude/skills/verificar-cambio/SKILL.md');
  fs.writeFileSync(skillPath, '# Modificado por el usuario\n');

  // Sin force -> conservado
  const rNoForce = init({ cwd: repo, force: false, silent: true });
  const entryNoForce = rNoForce.results.find((e) => e.file.includes('verificar-cambio/SKILL.md'));
  assert.equal(entryNoForce.status, 'conservado');
  assert.equal(fs.readFileSync(skillPath, 'utf8'), '# Modificado por el usuario\n');

  // Con force -> actualizado
  const rForce = init({ cwd: repo, force: true, silent: true });
  const entryForce = rForce.results.find((e) => e.file.includes('verificar-cambio/SKILL.md'));
  assert.equal(entryForce.status, 'actualizado');
  assert.notEqual(fs.readFileSync(skillPath, 'utf8'), '# Modificado por el usuario\n');
});

test('relevo.config.json modificado no se toca ni con --force', () => {
  const repo = makeGitRepo(tmpBase);
  init({ cwd: repo, silent: true });

  const configPath = path.join(repo, 'relevo.config.json');
  const customConfig = JSON.stringify({ custom: 'valor-modificado' }, null, 2) + '\n';
  fs.writeFileSync(configPath, customConfig);

  const r = init({ cwd: repo, force: true, silent: true });
  const configEntry = r.results.find((e) => e.file === 'relevo.config.json');
  assert.equal(configEntry.status, 'conservado');
  assert.equal(fs.readFileSync(configPath, 'utf8'), customConfig);
});

test('.agents/skills.json modificado no se toca ni con --force', () => {
  const repo = makeGitRepo(tmpBase);
  init({ cwd: repo, silent: true });

  const skillsJsonPath = path.join(repo, '.agents/skills.json');
  const customSkills = JSON.stringify({ entries: [] }, null, 2) + '\n';
  fs.writeFileSync(skillsJsonPath, customSkills);

  const r = init({ cwd: repo, force: true, silent: true });
  const entry = r.results.find((e) => e.file === '.agents/skills.json');
  assert.equal(entry.status, 'conservado');
  assert.equal(fs.readFileSync(skillsJsonPath, 'utf8'), customSkills);
});

test('.gitignore existente con una de las líneas no la duplica', () => {
  const repo = makeGitRepo(tmpBase);
  const gitignorePath = path.join(repo, '.gitignore');
  fs.writeFileSync(gitignorePath, 'artifacts/agent-runs/\nnode_modules/\n');

  const r = init({ cwd: repo, silent: true });
  const gitignoreEntry = r.results.find((e) => e.file === '.gitignore');
  assert.equal(gitignoreEntry.status, 'actualizado');

  const content = fs.readFileSync(gitignorePath, 'utf8');
  const occurrences = content.split('artifacts/agent-runs/').length - 1;
  assert.equal(occurrences, 1);
  assert.ok(content.includes('node_modules/'));
  assert.ok(content.includes('.worktrees/'));
  assert.ok(content.includes('.qa-verdict.json'));
});

test('comprobación dentro de artifacts/: node bin/relevo.cjs init funciona', () => {
  const relevoRoot = path.resolve(__dirname, '..');
  const artifactsDir = path.join(relevoRoot, 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  const cliTempDir = fs.mkdtempSync(path.join(artifactsDir, 'test-init-cli-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: cliTempDir });

    const relevoBin = path.join(relevoRoot, 'bin', 'relevo.cjs');
    const res = spawnSync(process.execPath, [relevoBin, 'init'], {
      cwd: cliTempDir,
      encoding: 'utf8',
    });

    assert.equal(res.status, 0, `Falló spawnSync con salida:\n${res.stderr}\n${res.stdout}`);
    assert.ok(res.stdout.includes('relevo init · resumen:'));
    assert.ok(fs.existsSync(path.join(cliTempDir, 'relevo.config.json')));
    assert.ok(fs.existsSync(path.join(cliTempDir, '.agents/hooks/permission-gate.cjs')));
  } finally {
    fs.rmSync(cliTempDir, { recursive: true, force: true });
  }
});

test('init crea .agents/relevo.lock.json con los hashes correctos', () => {
  const repo = makeGitRepo(tmpBase);
  init({ cwd: repo, silent: true });

  const lockPath = path.join(repo, '.agents/relevo.lock.json');
  assert.ok(fs.existsSync(lockPath), 'El archivo .agents/relevo.lock.json debe existir');

  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const pkg = require('../package.json');

  assert.equal(lock.version, 1);
  assert.equal(lock.relevo, pkg.version);
  assert.ok(lock.files && typeof lock.files === 'object');

  // No debe incluir archivos excluidos
  assert.equal(lock.files['relevo.config.json'], undefined);
  assert.equal(lock.files['.agents/skills.json'], undefined);
  assert.equal(lock.files['.gitignore'], undefined);
  assert.equal(lock.files['.agents/relevo.lock.json'], undefined);

  // Debe tener al menos la puerta, hooks, skills y agentes
  const fileKeys = Object.keys(lock.files);
  assert.ok(fileKeys.length > 0);
  assert.ok(fileKeys.includes('.agents/hooks/permission-gate.cjs'));
  assert.ok(fileKeys.includes('.agents/hooks.json'));

  // Recalcular hashes reales y comprobar coincidencia
  for (const [relPath, expectedHash] of Object.entries(lock.files)) {
    const fullPath = path.join(repo, relPath);
    assert.ok(fs.existsSync(fullPath), `El archivo gestionado ${relPath} debe existir en el repositorio`);
    const content = fs.readFileSync(fullPath);
    const actualHash = crypto.createHash('sha256').update(content).digest('hex');
    assert.equal(actualHash, expectedHash, `El hash de ${relPath} debe coincidir con el del lock`);
  }
});

// Limpieza general
try {
  fs.rmSync(tmpBase, { recursive: true, force: true });
} catch { /* ignorar */ }

console.log(`\ninit: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
