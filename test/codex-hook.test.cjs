'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { codexUserConfigPath, codexHookStatus } = require('../lib/codex-hook.cjs');

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relevo-codex-hook-test-'));

try {
  test('codexUserConfigPath devuelve RELEVO_CODEX_CONFIG o la ruta por defecto en homedir', () => {
    assert.equal(codexUserConfigPath({ RELEVO_CODEX_CONFIG: '/custom/path/config.toml' }), '/custom/path/config.toml');
    assert.equal(codexUserConfigPath({}), path.join(os.homedir(), '.codex', 'config.toml'));
  });

  test('sin .codex/config.toml: {installed:false, trusted:false}', () => {
    const repoRoot = path.join(tmpDir, 'repo-no-config');
    fs.mkdirSync(repoRoot, { recursive: true });
    const fakeUserConfig = path.join(tmpDir, 'user-config-1.toml');
    fs.writeFileSync(fakeUserConfig, '', 'utf8');

    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: fakeUserConfig });
    assert.deepEqual(status, { installed: false, trusted: false });
  });

  // Añadida por el auditor: un .codex/config.toml propio del proyecto sin la puerta no cuenta como instalada.
  test('con un .codex/config.toml que no registra la puerta: installed:false', () => {
    const repoRoot = path.join(tmpDir, 'repo-other-hook');
    fs.mkdirSync(path.join(repoRoot, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.codex', 'config.toml'), 'model = "gpt-6-luna"\n', 'utf8');
    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: path.join(tmpDir, 'user-config-nonexistent.toml') });
    assert.equal(status.installed, false);
  });

  test('con la plantilla y sin el archivo de usuario: installed:true, trusted:false', () => {
    const repoRoot = path.join(tmpDir, 'repo-with-template');
    const codexDir = path.join(repoRoot, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, 'config.toml'), 'command = "node .agents/hooks/permission-gate.cjs"\n', 'utf8');

    const nonExistentUserConfig = path.join(tmpDir, 'user-config-nonexistent.toml');
    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: nonExistentUserConfig });
    assert.deepEqual(status, { installed: true, trusted: false });
  });

  test('con la clave [hooks.state.\'<root con \\ y en otra capitalización>\\.codex\\config.toml:pre_tool_use:0:0\'] en el archivo de usuario: trusted:true', () => {
    const repoRoot = path.join(tmpDir, 'repo-trusted');
    const codexDir = path.join(repoRoot, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, 'config.toml'), 'command = "node .agents/hooks/permission-gate.cjs"\n', 'utf8');

    const rootAltered = repoRoot.replace(/\//g, '\\').toUpperCase();
    const fakeUserConfig = path.join(tmpDir, 'user-config-trusted.toml');
    fs.writeFileSync(
      fakeUserConfig,
      `[hooks.state.'${rootAltered}\\.codex\\config.toml:pre_tool_use:0:0']\n`
    );

    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: fakeUserConfig });
    assert.equal(status.installed, true);
    assert.equal(status.trusted, true);
  });

  test('con la clave de otro proyecto: trusted:false', () => {
    const repoRoot = path.join(tmpDir, 'repo-other');
    const codexDir = path.join(repoRoot, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, 'config.toml'), 'command = "node .agents/hooks/permission-gate.cjs"\n', 'utf8');

    const fakeUserConfig = path.join(tmpDir, 'user-config-other.toml');
    fs.writeFileSync(
      fakeUserConfig,
      `[hooks.state.'C:\\Proyectos\\OtroProyecto\\.codex\\config.toml:pre_tool_use:0:0']\n`
    );

    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: fakeUserConfig });
    assert.equal(status.installed, true);
    assert.equal(status.trusted, false);
  });
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}

console.log(`\ncodex hook: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
