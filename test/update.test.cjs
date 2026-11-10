'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { init } = require('../lib/init.cjs');
const { update } = require('../lib/update.cjs');

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

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'relevo-update-test-'));

function makeRepoWithInit() {
  const dir = fs.mkdtempSync(path.join(tmpBase, 'repo-'));
  execFileSync('git', ['init', '-b', 'main', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@relevo.local'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Relevo Test'], { cwd: dir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  init({ cwd: dir, silent: true });
  return dir;
}

function getAllFiles(dir, base = dir) {
  const map = new Map();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (entry.name === '.git') continue;
      const sub = getAllFiles(full, base);
      for (const [k, v] of sub) map.set(k, v);
    } else {
      map.set(rel, fs.readFileSync(full));
    }
  }
  return map;
}

test('(a) update sin cambios → todo "al día"', () => {
  const repo = makeRepoWithInit();
  const res = update({ cwd: repo, silent: true });

  assert.equal(res.hasError, false);
  assert.equal(res.counts.al_dia, res.results.length);
  assert.equal(res.counts.actualizable, 0);
  assert.equal(res.counts.personalizado, 0);
  assert.equal(res.counts.nuevo, 0);
  assert.equal(res.counts.error, 0);
});

test('(b) simula una plantilla nueva con templatesDir → actualizable y --apply lo actualiza y actualiza el lock', () => {
  const repo = makeRepoWithInit();
  const tmpTemplates = path.join(tmpBase, 'templates-b');
  fs.cpSync(path.join(__dirname, '..', 'templates'), tmpTemplates, { recursive: true });

  // Modificar plantilla de un agente no tocado por el usuario
  const agentTemplate = path.join(tmpTemplates, 'agents', 'qa.md');
  const nuevoContenido = '# QA actualizado en plantilla upstream\n';
  fs.writeFileSync(agentTemplate, nuevoContenido);

  // Sin apply: se reporta como actualizable pero no se toca
  const resPlan = update({ cwd: repo, templatesDir: tmpTemplates, apply: false, silent: true });
  assert.equal(resPlan.hasError, false);
  const qaEntryPlan = resPlan.results.find((r) => r.file === '.agents/plugins/relevo/agents/qa.md');
  assert.equal(qaEntryPlan.status, 'actualizable');

  const installedAgent = path.join(repo, '.agents/plugins/relevo/agents/qa.md');
  assert.notEqual(fs.readFileSync(installedAgent, 'utf8'), nuevoContenido);

  // Con apply: se actualiza el archivo y el lock
  const resApply = update({ cwd: repo, templatesDir: tmpTemplates, apply: true, silent: true });
  assert.equal(resApply.hasError, false);
  assert.equal(fs.readFileSync(installedAgent, 'utf8'), nuevoContenido);

  const lockPath = path.join(repo, '.agents/relevo.lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const expectedHash = crypto.createHash('sha256').update(nuevoContenido).digest('hex');
  assert.equal(lock.files['.agents/plugins/relevo/agents/qa.md'], expectedHash);

  // Tras actualizar, una nueva comprobación lo ve "al día"
  const resPost = update({ cwd: repo, templatesDir: tmpTemplates, silent: true });
  const qaEntryPost = resPost.results.find((r) => r.file === '.agents/plugins/relevo/agents/qa.md');
  assert.equal(qaEntryPost.status, 'al día');
});

test('(c) skill personalizada → "personalizado", --apply no la toca y crea SKILL.md.relevo-new', () => {
  const repo = makeRepoWithInit();
  const tmpTemplates = path.join(tmpBase, 'templates-c');
  fs.cpSync(path.join(__dirname, '..', 'templates'), tmpTemplates, { recursive: true });

  // El usuario personaliza una skill
  const installedSkill = path.join(repo, '.claude/skills/verificar-cambio/SKILL.md');
  const contenidoPersonalizado = '# Skill personalizada por el usuario\n';
  fs.writeFileSync(installedSkill, contenidoPersonalizado);

  // La plantilla upstream también cambia
  const templateSkill = path.join(tmpTemplates, 'skills', 'verificar-cambio', 'SKILL.md');
  const contenidoUpstream = '# Skill nueva upstream\n';
  fs.writeFileSync(templateSkill, contenidoUpstream);

  // Con apply
  const res = update({ cwd: repo, templatesDir: tmpTemplates, apply: true, silent: true });
  assert.equal(res.hasError, false);
  const entry = res.results.find((r) => r.file === '.claude/skills/verificar-cambio/SKILL.md');
  assert.equal(entry.status, 'personalizado');

  // El archivo instalado NO se toca
  assert.equal(fs.readFileSync(installedSkill, 'utf8'), contenidoPersonalizado);

  // Se crea el archivo .relevo-new al lado
  const sidecar = path.join(repo, '.claude/skills/verificar-cambio/SKILL.md.relevo-new');
  assert.ok(fs.existsSync(sidecar));
  assert.equal(fs.readFileSync(sidecar, 'utf8'), contenidoUpstream);
});

test('(d) sin lock → "personalizado"', () => {
  const repo = makeRepoWithInit();
  const tmpTemplates = path.join(tmpBase, 'templates-d');
  fs.cpSync(path.join(__dirname, '..', 'templates'), tmpTemplates, { recursive: true });

  // Borrar el archivo lock
  fs.unlinkSync(path.join(repo, '.agents/relevo.lock.json'));

  // Cambiar una plantilla
  fs.writeFileSync(path.join(tmpTemplates, 'agents', 'qa.md'), '# QA upstream\n');

  // Sin lock, cualquier diferencia se trata como "personalizado" por prudencia
  const res = update({ cwd: repo, templatesDir: tmpTemplates, apply: false, silent: true });
  const entry = res.results.find((r) => r.file === '.agents/plugins/relevo/agents/qa.md');
  assert.equal(entry.status, 'personalizado');
});

test('(e) puerta modificada → "error" y código 1, --apply no la toca, --apply --force sí', () => {
  const repo = makeRepoWithInit();
  const gatePath = path.join(repo, '.agents/hooks/permission-gate.cjs');
  const gateModificada = '// puerta manipulada\n';
  fs.writeFileSync(gatePath, gateModificada);

  // Sin apply: status error y hasError = true
  const resPlan = update({ cwd: repo, apply: false, silent: true });
  assert.equal(resPlan.hasError, true);
  const gateEntry = resPlan.results.find((r) => r.file === '.agents/hooks/permission-gate.cjs');
  assert.equal(gateEntry.status, 'error');

  // Con CLI bin/relevo.cjs update: código de salida 1
  const binPath = path.resolve(__dirname, '..', 'bin', 'relevo.cjs');
  const cliRes = spawnSync(process.execPath, [binPath, 'update'], {
    cwd: repo,
    encoding: 'utf8',
  });
  assert.equal(cliRes.status, 1);

  // Con --apply sin --force: no la toca
  const resApplyNoForce = update({ cwd: repo, apply: true, force: false, silent: true });
  assert.equal(resApplyNoForce.hasError, true);
  assert.equal(fs.readFileSync(gatePath, 'utf8'), gateModificada);

  // Con --apply --force: sí la sobrescribe
  const resApplyForce = update({ cwd: repo, apply: true, force: true, silent: true });
  assert.equal(resApplyForce.hasError, false);
  assert.notEqual(fs.readFileSync(gatePath, 'utf8'), gateModificada);

  // El lock se actualiza
  const lock = JSON.parse(fs.readFileSync(path.join(repo, '.agents/relevo.lock.json'), 'utf8'));
  const currentGateHash = crypto.createHash('sha256').update(fs.readFileSync(gatePath)).digest('hex');
  assert.equal(lock.files['.agents/hooks/permission-gate.cjs'], currentGateHash);
});

test('(f) sin --apply no se escribe ningún archivo (listado antes/después)', () => {
  const repo = makeRepoWithInit();
  const tmpTemplates = path.join(tmpBase, 'templates-f');
  fs.cpSync(path.join(__dirname, '..', 'templates'), tmpTemplates, { recursive: true });

  fs.writeFileSync(path.join(tmpTemplates, 'agents', 'documentalista.md'), '# nuevo contenido\n');

  const before = getAllFiles(repo);
  update({ cwd: repo, templatesDir: tmpTemplates, apply: false, silent: true });
  const after = getAllFiles(repo);

  assert.equal(before.size, after.size);
  for (const [file, content] of before) {
    assert.ok(after.has(file), `Archivo ${file} desaparecido`);
    assert.deepEqual(after.get(file), content, `Archivo ${file} fue modificado sin --apply`);
  }
});

test('(g) init dos veces deja el lock idéntico byte a byte', () => {
  const dir = fs.mkdtempSync(path.join(tmpBase, 'repo-g-'));
  execFileSync('git', ['init', '-b', 'main', '-q'], { cwd: dir });

  init({ cwd: dir, silent: true });
  const lock1 = fs.readFileSync(path.join(dir, '.agents/relevo.lock.json'));

  init({ cwd: dir, silent: true });
  const lock2 = fs.readFileSync(path.join(dir, '.agents/relevo.lock.json'));

  assert.deepEqual(lock1, lock2, 'El lock debe ser idéntico byte a byte tras ejecutar init dos veces');
});

test('(h) skill personalizada + plantilla sin cambios → "personalizado" con "sin novedades" y --apply NO crea .relevo-new', () => {
  const repo = makeRepoWithInit();

  const installedSkill = path.join(repo, '.claude/skills/verificar-cambio/SKILL.md');
  const contenidoPersonalizado = '# Skill personalizada con comandos del proyecto\n';
  fs.writeFileSync(installedSkill, contenidoPersonalizado);

  // Plan sin apply: detecta personalizado con "sin novedades de la plantilla"
  const resPlan = update({ cwd: repo, apply: false, silent: true });
  assert.equal(resPlan.hasError, false);
  const entryPlan = resPlan.results.find((r) => r.file === '.claude/skills/verificar-cambio/SKILL.md');
  assert.equal(entryPlan.status, 'personalizado');
  assert.equal(entryPlan.note, 'sin novedades de la plantilla');

  // Con apply: no crea .relevo-new y mantiene el contenido
  const resApply = update({ cwd: repo, apply: true, silent: true });
  assert.equal(resApply.hasError, false);
  const entryApply = resApply.results.find((r) => r.file === '.claude/skills/verificar-cambio/SKILL.md');
  assert.equal(entryApply.status, 'personalizado');
  assert.equal(entryApply.note, 'sin novedades de la plantilla');

  assert.equal(fs.readFileSync(installedSkill, 'utf8'), contenidoPersonalizado);
  const sidecar = path.join(repo, '.claude/skills/verificar-cambio/SKILL.md.relevo-new');
  assert.equal(fs.existsSync(sidecar), false);
});

test('(i) skill personalizada + plantilla nueva → --apply crea .relevo-new y un segundo update dice "sin novedades" y no vuelve a crearlo', () => {
  const repo = makeRepoWithInit();
  const tmpTemplates = path.join(tmpBase, 'templates-i');
  fs.cpSync(path.join(__dirname, '..', 'templates'), tmpTemplates, { recursive: true });

  const installedSkill = path.join(repo, '.claude/skills/verificar-cambio/SKILL.md');
  const contenidoPersonalizado = '# Skill personalizada v1\n';
  fs.writeFileSync(installedSkill, contenidoPersonalizado);

  const templateSkill = path.join(tmpTemplates, 'skills', 'verificar-cambio', 'SKILL.md');
  const contenidoUpstream = '# Skill upstream v2 con mejoras\n';
  fs.writeFileSync(templateSkill, contenidoUpstream);

  // Primer update con apply: ofrece y crea .relevo-new, actualiza lock
  const resApply1 = update({ cwd: repo, templatesDir: tmpTemplates, apply: true, silent: true });
  assert.equal(resApply1.hasError, false);
  const entry1 = resApply1.results.find((r) => r.file === '.claude/skills/verificar-cambio/SKILL.md');
  assert.equal(entry1.status, 'personalizado');
  assert.equal(entry1.note, 'plantilla nueva en .claude/skills/verificar-cambio/SKILL.md.relevo-new');

  const sidecar = path.join(repo, '.claude/skills/verificar-cambio/SKILL.md.relevo-new');
  assert.ok(fs.existsSync(sidecar));
  assert.equal(fs.readFileSync(sidecar, 'utf8'), contenidoUpstream);

  // Borramos el sidecar para comprobar si un segundo update lo vuelve a crear
  fs.unlinkSync(sidecar);

  // Segundo update: dice "sin novedades" y no vuelve a crearlo
  const resApply2 = update({ cwd: repo, templatesDir: tmpTemplates, apply: true, silent: true });
  assert.equal(resApply2.hasError, false);
  const entry2 = resApply2.results.find((r) => r.file === '.claude/skills/verificar-cambio/SKILL.md');
  assert.equal(entry2.status, 'personalizado');
  assert.equal(entry2.note, 'sin novedades de la plantilla');
  assert.equal(fs.existsSync(sidecar), false);
});

test('(j) tras (i), si el usuario borra el .relevo-new e integra el contenido nuevo a mano en su skill, update no ofrece nada', () => {
  const repo = makeRepoWithInit();
  const tmpTemplates = path.join(tmpBase, 'templates-j');
  fs.cpSync(path.join(__dirname, '..', 'templates'), tmpTemplates, { recursive: true });

  const installedSkill = path.join(repo, '.claude/skills/verificar-cambio/SKILL.md');
  fs.writeFileSync(installedSkill, '# Skill personalizada v1\n');

  const templateSkill = path.join(tmpTemplates, 'skills', 'verificar-cambio', 'SKILL.md');
  const contenidoUpstream = '# Skill upstream v2 con mejoras\n';
  fs.writeFileSync(templateSkill, contenidoUpstream);

  // Ejecutamos (i): --apply crea .relevo-new
  update({ cwd: repo, templatesDir: tmpTemplates, apply: true, silent: true });
  const sidecar = path.join(repo, '.claude/skills/verificar-cambio/SKILL.md.relevo-new');
  assert.ok(fs.existsSync(sidecar));

  // El usuario borra el .relevo-new
  fs.unlinkSync(sidecar);

  // El usuario integra el contenido a mano en su skill
  const contenidoIntegrado = '# Skill personalizada v1 + mejoras v2 integradas a mano\n';
  fs.writeFileSync(installedSkill, contenidoIntegrado);

  const resPlan = update({ cwd: repo, templatesDir: tmpTemplates, apply: false, silent: true });
  assert.equal(resPlan.hasError, false);
  const entryPlan = resPlan.results.find((r) => r.file === '.claude/skills/verificar-cambio/SKILL.md');
  assert.equal(entryPlan.status, 'personalizado');
  assert.equal(entryPlan.note, 'sin novedades de la plantilla');

  const resApply = update({ cwd: repo, templatesDir: tmpTemplates, apply: true, silent: true });
  assert.equal(resApply.hasError, false);
  assert.equal(fs.existsSync(sidecar), false);
});

test('(k) puerta modificada + plantilla sin cambios → sigue "error"', () => {
  const repo = makeRepoWithInit();
  const gatePath = path.join(repo, '.agents/hooks/permission-gate.cjs');
  const gateModificada = '// puerta manipulada por el usuario\n';
  fs.writeFileSync(gatePath, gateModificada);

  const resPlan = update({ cwd: repo, apply: false, silent: true });
  assert.equal(resPlan.hasError, true);
  const gateEntry = resPlan.results.find((r) => r.file === '.agents/hooks/permission-gate.cjs');
  assert.equal(gateEntry.status, 'error');
  assert.equal(gateEntry.note, 'la puerta de permisos no debe personalizarse; usa relevo.config.json o --force');

  const resApplyNoForce = update({ cwd: repo, apply: true, force: false, silent: true });
  assert.equal(resApplyNoForce.hasError, true);
  assert.equal(fs.readFileSync(gatePath, 'utf8'), gateModificada);
});

// Limpieza general
try {
  fs.rmSync(tmpBase, { recursive: true, force: true });
} catch { /* ignorar */ }

console.log(`\nupdate: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
