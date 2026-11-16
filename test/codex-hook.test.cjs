'use strict';

const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { codexUserConfigPath, codexHookStatus } = require('../lib/codex-hook.cjs');
const { parseArgs } = require('../lib/run.cjs');

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

  const validProjectConfig = '[[hooks.PreToolUse]]\nmatcher = ".*"\n\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "node .agents/hooks/permission-gate.cjs"\n';

  test('con la plantilla y sin el archivo de usuario: installed:true, trusted:false', () => {
    const repoRoot = path.join(tmpDir, 'repo-with-template');
    const codexDir = path.join(repoRoot, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, 'config.toml'), validProjectConfig, 'utf8');

    const nonExistentUserConfig = path.join(tmpDir, 'user-config-nonexistent.toml');
    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: nonExistentUserConfig });
    assert.deepEqual(status, { installed: true, trusted: false });
  });

  test('con la clave [hooks.state.\'<root con \\ y en otra capitalización>\\.codex\\config.toml:pre_tool_use:0:0\'] en el archivo de usuario: trusted:true', () => {
    const repoRoot = path.join(tmpDir, 'repo-trusted');
    const codexDir = path.join(repoRoot, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, 'config.toml'), validProjectConfig, 'utf8');

    const rootAltered = repoRoot.replace(/\//g, '\\').toUpperCase();
    const fakeUserConfig = path.join(tmpDir, 'user-config-trusted.toml');
    fs.writeFileSync(
      fakeUserConfig,
      `[hooks.state.'${rootAltered}\\.codex\\config.toml:pre_tool_use:0:0']\ntrusted_hash = "abc"\n`
    );

    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: fakeUserConfig });
    assert.equal(status.installed, true);
    assert.equal(status.trusted, true);
  });

  test('con la clave de otro proyecto: trusted:false', () => {
    const repoRoot = path.join(tmpDir, 'repo-other');
    const codexDir = path.join(repoRoot, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, 'config.toml'), validProjectConfig, 'utf8');

    const fakeUserConfig = path.join(tmpDir, 'user-config-other.toml');
    fs.writeFileSync(
      fakeUserConfig,
      `[hooks.state.'C:\\Proyectos\\OtroProyecto\\.codex\\config.toml:pre_tool_use:0:0']\ntrusted_hash = "abc"\n`
    );

    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: fakeUserConfig });
    assert.equal(status.installed, true);
    assert.equal(status.trusted, false);
  });

  // Pruebas nuevas tras hallazgos de QA
  test('trusted da false con la cabecera correcta comentada y trusted_hash debajo', () => {
    const repoRoot = path.join(tmpDir, 'repo-commented-header');
    fs.mkdirSync(path.join(repoRoot, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.codex', 'config.toml'), 'command = "node .agents/hooks/permission-gate.cjs"\n', 'utf8');

    const hookKey = (path.join(repoRoot, '.codex', 'config.toml') + ':pre_tool_use:0:0').replace(/\//g, '\\');
    const fakeUserConfig = path.join(tmpDir, 'user-config-commented-header.toml');
    fs.writeFileSync(
      fakeUserConfig,
      `# [hooks.state.'${hookKey}']\ntrusted_hash = "abc"\n`,
      'utf8'
    );

    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: fakeUserConfig });
    assert.equal(status.trusted, false);
  });

  test('trusted da false con índice :pre_tool_use:1:0', () => {
    const repoRoot = path.join(tmpDir, 'repo-index-1-0');
    fs.mkdirSync(path.join(repoRoot, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.codex', 'config.toml'), 'command = "node .agents/hooks/permission-gate.cjs"\n', 'utf8');

    const hookKey = (path.join(repoRoot, '.codex', 'config.toml') + ':pre_tool_use:1:0').replace(/\//g, '\\');
    const fakeUserConfig = path.join(tmpDir, 'user-config-index-1-0.toml');
    fs.writeFileSync(
      fakeUserConfig,
      `[hooks.state.'${hookKey}']\ntrusted_hash = "abc"\n`,
      'utf8'
    );

    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: fakeUserConfig });
    assert.equal(status.trusted, false);
  });

  test('trusted da false con la clave de <root>-otro con prefijo común', () => {
    const repoRoot = path.join(tmpDir, 'repo-prefix');
    fs.mkdirSync(path.join(repoRoot, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.codex', 'config.toml'), 'command = "node .agents/hooks/permission-gate.cjs"\n', 'utf8');

    const hookKeyOther = (path.join(repoRoot + '-otro', '.codex', 'config.toml') + ':pre_tool_use:0:0').replace(/\//g, '\\');
    const fakeUserConfig = path.join(tmpDir, 'user-config-prefix-other.toml');
    fs.writeFileSync(
      fakeUserConfig,
      `[hooks.state.'${hookKeyOther}']\ntrusted_hash = "abc"\n`,
      'utf8'
    );

    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: fakeUserConfig });
    assert.equal(status.trusted, false);
  });

  test('trusted da false con la cabecera correcta sin trusted_hash', () => {
    const repoRoot = path.join(tmpDir, 'repo-no-trusted-hash');
    fs.mkdirSync(path.join(repoRoot, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.codex', 'config.toml'), 'command = "node .agents/hooks/permission-gate.cjs"\n', 'utf8');

    const hookKey = (path.join(repoRoot, '.codex', 'config.toml') + ':pre_tool_use:0:0').replace(/\//g, '\\');
    const fakeUserConfig = path.join(tmpDir, 'user-config-no-trusted-hash.toml');
    fs.writeFileSync(
      fakeUserConfig,
      `[hooks.state.'${hookKey}']\n`,
      'utf8'
    );

    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: fakeUserConfig });
    assert.equal(status.trusted, false);
  });

  // Añadida por el auditor: la tabla aprobada tiene otras claves, pero no trusted_hash, y otra tabla posterior sí lo tiene.
  test('trusted da false si trusted_hash pertenece a otra tabla posterior', () => {
    const repoRoot = path.join(tmpDir, 'repo-hash-other-table');
    fs.mkdirSync(path.join(repoRoot, '.codex'), { recursive: true });
    const hookKey = (path.join(repoRoot, '.codex', 'config.toml') + ':pre_tool_use:0:0').replace(/\//g, '\\');
    const fakeUserConfig = path.join(tmpDir, 'user-config-hash-other-table.toml');
    fs.writeFileSync(
      fakeUserConfig,
      `[hooks.state.'${hookKey}']\nenabled = true\n\n[hooks.state.'C:\\Otro\\.codex\\config.toml:pre_tool_use:0:0']\ntrusted_hash = "sha256:x"\n`,
      'utf8'
    );
    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: fakeUserConfig });
    assert.equal(status.trusted, false);
  });

  test('trusted da true con la cabecera con comillas dobles y \\\\ escapados, más trusted_hash', () => {
    const repoRoot = path.join(tmpDir, 'repo-double-quotes');
    fs.mkdirSync(path.join(repoRoot, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.codex', 'config.toml'), 'command = "node .agents/hooks/permission-gate.cjs"\n', 'utf8');

    const hookPath = (path.join(repoRoot, '.codex', 'config.toml') + ':pre_tool_use:0:0').replace(/\//g, '\\');
    const hookKeyEscaped = hookPath.replace(/\\/g, '\\\\');
    const fakeUserConfig = path.join(tmpDir, 'user-config-double-quotes.toml');
    fs.writeFileSync(
      fakeUserConfig,
      `[hooks.state."${hookKeyEscaped}"]\ntrusted_hash = "abc"\n`,
      'utf8'
    );

    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: fakeUserConfig });
    assert.equal(status.trusted, true);
  });

  test('trusted da false con trusted_hash = ""', () => {
    const repoRoot = path.join(tmpDir, 'repo-hash-empty');
    fs.mkdirSync(path.join(repoRoot, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.codex', 'config.toml'), 'command = "node .agents/hooks/permission-gate.cjs"\n', 'utf8');

    const hookKey = (path.join(repoRoot, '.codex', 'config.toml') + ':pre_tool_use:0:0').replace(/\//g, '\\');
    const fakeUserConfig = path.join(tmpDir, 'user-config-hash-empty.toml');
    fs.writeFileSync(
      fakeUserConfig,
      `[hooks.state.'${hookKey}']\ntrusted_hash = ""\n`,
      'utf8'
    );

    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: fakeUserConfig });
    assert.equal(status.trusted, false);
  });

  test('trusted da false con trusted_hash_old = "abc"', () => {
    const repoRoot = path.join(tmpDir, 'repo-hash-old');
    fs.mkdirSync(path.join(repoRoot, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.codex', 'config.toml'), 'command = "node .agents/hooks/permission-gate.cjs"\n', 'utf8');

    const hookKey = (path.join(repoRoot, '.codex', 'config.toml') + ':pre_tool_use:0:0').replace(/\//g, '\\');
    const fakeUserConfig = path.join(tmpDir, 'user-config-hash-old.toml');
    fs.writeFileSync(
      fakeUserConfig,
      `[hooks.state.'${hookKey}']\ntrusted_hash_old = "abc"\n`,
      'utf8'
    );

    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: fakeUserConfig });
    assert.equal(status.trusted, false);
  });

  test('trusted da false con trusted_hash (sin =)', () => {
    const repoRoot = path.join(tmpDir, 'repo-hash-no-equal');
    fs.mkdirSync(path.join(repoRoot, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.codex', 'config.toml'), 'command = "node .agents/hooks/permission-gate.cjs"\n', 'utf8');

    const hookKey = (path.join(repoRoot, '.codex', 'config.toml') + ':pre_tool_use:0:0').replace(/\//g, '\\');
    const fakeUserConfig = path.join(tmpDir, 'user-config-hash-no-equal.toml');
    fs.writeFileSync(
      fakeUserConfig,
      `[hooks.state.'${hookKey}']\ntrusted_hash\n`,
      'utf8'
    );

    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: fakeUserConfig });
    assert.equal(status.trusted, false);
  });

  test('trusted da true con trusted_hash = "sha256:6dfb"', () => {
    const repoRoot = path.join(tmpDir, 'repo-hash-valid-double');
    fs.mkdirSync(path.join(repoRoot, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.codex', 'config.toml'), 'command = "node .agents/hooks/permission-gate.cjs"\n', 'utf8');

    const hookKey = (path.join(repoRoot, '.codex', 'config.toml') + ':pre_tool_use:0:0').replace(/\//g, '\\');
    const fakeUserConfig = path.join(tmpDir, 'user-config-hash-valid-double.toml');
    fs.writeFileSync(
      fakeUserConfig,
      `[hooks.state.'${hookKey}']\ntrusted_hash = "sha256:6dfb"\n`,
      'utf8'
    );

    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: fakeUserConfig });
    assert.equal(status.trusted, true);
  });

  test("trusted da true con trusted_hash='sha256:6dfb'", () => {
    const repoRoot = path.join(tmpDir, 'repo-hash-valid-single');
    fs.mkdirSync(path.join(repoRoot, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.codex', 'config.toml'), 'command = "node .agents/hooks/permission-gate.cjs"\n', 'utf8');

    const hookKey = (path.join(repoRoot, '.codex', 'config.toml') + ':pre_tool_use:0:0').replace(/\//g, '\\');
    const fakeUserConfig = path.join(tmpDir, 'user-config-hash-valid-single.toml');
    fs.writeFileSync(
      fakeUserConfig,
      `[hooks.state.'${hookKey}']\ntrusted_hash='sha256:6dfb'\n`,
      'utf8'
    );

    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: fakeUserConfig });
    assert.equal(status.trusted, true);
  });

  test('installed da false con la línea command de la puerta comentada', () => {
    const repoRoot = path.join(tmpDir, 'repo-commented-command');
    fs.mkdirSync(path.join(repoRoot, '.codex'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, '.codex', 'config.toml'),
      '[[hooks.PreToolUse]]\nmatcher = ".*"\n\n[[hooks.PreToolUse.hooks]]\ntype = "command"\n# command = "node .agents/hooks/permission-gate.cjs"\n',
      'utf8'
    );

    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: path.join(tmpDir, 'nonexistent.toml') });
    assert.equal(status.installed, false);
  });

  test('installed da false con la puerta registrada en el segundo hook y no en el primero', () => {
    const repoRoot = path.join(tmpDir, 'repo-second-hook');
    fs.mkdirSync(path.join(repoRoot, '.codex'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, '.codex', 'config.toml'),
      '[[hooks.PreToolUse]]\nmatcher = ".*"\n\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "node other.cjs"\n\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "node .agents/hooks/permission-gate.cjs"\n',
      'utf8'
    );

    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: path.join(tmpDir, 'nonexistent.toml') });
    assert.equal(status.installed, false);
  });

  test('installed da true con la plantilla real templates/codex/config.toml', () => {
    const repoRoot = path.join(tmpDir, 'repo-template-real');
    fs.mkdirSync(path.join(repoRoot, '.codex'), { recursive: true });
    const templateContent = fs.readFileSync(path.resolve(__dirname, '../templates/codex/config.toml'), 'utf8');
    fs.writeFileSync(path.join(repoRoot, '.codex', 'config.toml'), templateContent, 'utf8');

    const status = codexHookStatus(repoRoot, { RELEVO_CODEX_CONFIG: path.join(tmpDir, 'nonexistent.toml') });
    assert.equal(status.installed, true);
  });

  test('parseArgs: --clave=valor y --flag sin valor', () => {
    assert.deepEqual(
      parseArgs(['--sandbox=read-only', '--task', 't']),
      { sandbox: 'read-only', task: 't' }
    );
    assert.deepEqual(
      parseArgs(['--flag', '--task=t']),
      { flag: true, task: 't' }
    );
  });

  test('runCli con hook ajeno (trusted && !installed) y --sandbox workspace-write falla con código 2', () => {
    const tempRepo = path.join(tmpDir, 'repo-foreign-cli');
    fs.mkdirSync(path.join(tempRepo, '.codex'), { recursive: true });
    execFileSync('git', ['init'], { cwd: tempRepo, stdio: 'ignore' });

    // Registra otro hook en .codex/config.toml (installed: false)
    fs.writeFileSync(
      path.join(tempRepo, '.codex', 'config.toml'),
      '[[hooks.PreToolUse]]\nmatcher = ".*"\n\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "node other.cjs"\n',
      'utf8'
    );

    const encargo = path.join(tempRepo, 'encargo.md');
    fs.writeFileSync(encargo, 'test\n', 'utf8');

    const realRepo = fs.realpathSync.native(tempRepo);
    const hookKey = (path.join(realRepo, '.codex', 'config.toml') + ':pre_tool_use:0:0').replace(/\//g, '\\');
    const fakeUserConfig = path.join(tmpDir, 'user-config-foreign-cli.toml');
    fs.writeFileSync(fakeUserConfig, `[hooks.state.'${hookKey}']\ntrusted_hash = "abc"\n`, 'utf8');

    const res = spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, '../lib/run.cjs'),
        '--provider', 'codex',
        '--task', 't',
        '--brief', encargo,
        '--sandbox', 'workspace-write',
      ],
      {
        cwd: tempRepo,
        env: { ...process.env, RELEVO_CODEX_CONFIG: fakeUserConfig },
        encoding: 'utf8',
      }
    );

    assert.equal(res.status, 2, `status esperado 2, obtenido: ${res.status}; stderr: ${res.stderr}`);
    assert.ok(
      res.stderr.includes('Codex sin la puerta de relevo aprobada: lanza con --sandbox read-only o instala y aprueba el hook de .codex/config.toml (relevo doctor explica cómo)'),
      `stderr inesperado: ${res.stderr}`
    );
  });
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}

console.log(`\ncodex hook: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
