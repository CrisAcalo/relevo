'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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

const encargo = path.join(os.tmpdir(), 'relevo-bypass-encargo.md');
fs.writeFileSync(encargo, 'x');

const bypassDir = path.join(os.tmpdir(), 'bypass-dir');
fs.mkdirSync(bypassDir, { recursive: true });
const encargoEnBypassDir = path.join(bypassDir, 'encargo.md');
fs.writeFileSync(encargoEnBypassDir, 'x');

function runLauncher(extraArgs) {
  return spawnSync(
    process.execPath,
    [path.resolve(__dirname, '../lib/run.cjs'), '--provider', 'codex', '--cwd', 'no-existe-relevo-xyz', ...extraArgs],
    { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }
  );
}

test('(a) --task bypass-x --brief <encargo>', () => {
  const res = runLauncher(['--task', 'bypass-x', '--brief', encargo]);
  assert.ok(res.stderr.includes('--cwd no existe'), `esperaba que stderr contuviera '--cwd no existe', pero fue: ${res.stderr}`);
  assert.ok(!res.stderr.includes('no se permiten flags'), `esperaba que stderr no contuviera 'no se permiten flags', pero fue: ${res.stderr}`);
});

test('(b) --task t --brief <ruta en bypass-dir>', () => {
  const res = runLauncher(['--task', 't', '--brief', encargoEnBypassDir]);
  assert.ok(res.stderr.includes('--cwd no existe'), `esperaba que stderr contuviera '--cwd no existe', pero fue: ${res.stderr}`);
});

test('(c) --task t --brief <encargo> --dangerously-skip-permissions', () => {
  const res = runLauncher(['--task', 't', '--brief', encargo, '--dangerously-skip-permissions']);
  assert.ok(res.stderr.includes('no se permiten flags'), `esperaba que stderr contuviera 'no se permiten flags', pero fue: ${res.stderr}`);
});

test('(d) --task t --brief <encargo> --bypass=1', () => {
  const res = runLauncher(['--task', 't', '--brief', encargo, '--bypass=1']);
  assert.ok(res.stderr.includes('no se permiten flags'), `esperaba que stderr contuviera 'no se permiten flags', pero fue: ${res.stderr}`);
});

test('(e) --task t --brief <encargo> --sandbox danger-full-access', () => {
  const res = runLauncher(['--task', 't', '--brief', encargo, '--sandbox', 'danger-full-access']);
  assert.ok(res.stderr.includes('--sandbox de Codex debe ser'), `esperaba que stderr contuviera '--sandbox de Codex debe ser', pero fue: ${res.stderr}`);
});

test('(f) --task t --brief <encargo> --sandbox workspace-write', () => {
  const res = runLauncher(['--task', 't', '--brief', encargo, '--sandbox', 'workspace-write']);
  assert.ok(res.stderr.includes('--cwd no existe'), `esperaba que stderr contuviera '--cwd no existe', pero fue: ${res.stderr}`);
});

try {
  fs.rmSync(encargo, { force: true });
  fs.rmSync(bypassDir, { recursive: true, force: true });
} catch { /* ignorar */ }

console.log(`\nrun args: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
