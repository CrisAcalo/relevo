'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { agentForRole } = require('../lib/run.cjs');

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relevo-run-agent-test-'));

try {
  const projectDir = path.join(tmpDir, 'project');
  const agentsDir = path.join(projectDir, '.agents', 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(path.join(agentsDir, 'qa.md'), '# QA\n', 'utf8');
  fs.writeFileSync(path.join(agentsDir, 'documentalista.md'), '# Docs\n', 'utf8');

  const emptyDir = path.join(tmpDir, 'empty');
  fs.mkdirSync(emptyDir, { recursive: true });

  test('rol qa con el archivo presente → "qa"', () => {
    assert.equal(agentForRole('qa', projectDir), 'qa');
  });

  test('rol docs con el archivo presente → "documentalista"', () => {
    assert.equal(agentForRole('docs', projectDir), 'documentalista');
  });

  test('rol coder → undefined', () => {
    assert.equal(agentForRole('coder', projectDir), undefined);
  });

  test('rol qa sin el archivo → undefined', () => {
    assert.equal(agentForRole('qa', emptyDir), undefined);
  });

  test('con un explicitAgent → ese agente', () => {
    assert.equal(agentForRole('qa', emptyDir, 'custom-agent'), 'custom-agent');
    assert.equal(agentForRole('qa', projectDir, 'mi-agente'), 'mi-agente');
    assert.equal(agentForRole('coder', projectDir, 'otro-agente'), 'otro-agente');
  });
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}

console.log(`\nrun agent: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
