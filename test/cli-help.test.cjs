'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

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

const bin = path.resolve(__dirname, '../bin/relevo.cjs');

for (const cmd of ['init', 'update', 'task', 'run']) {
  test(`relevo ${cmd} --help muestra el uso sin ejecutar el comando`, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `relevo-help-${cmd}-`));
    try {
      execFileSync('git', ['init', '-q'], { cwd: tmp, stdio: 'ignore' });
      const res = spawnSync(process.execPath, [bin, cmd, '--help'], {
        cwd: tmp,
        encoding: 'utf8',
      });
      assert.equal(res.status, 0, `esperaba status 0 pero fue ${res.status} (stderr: ${res.stderr})`);
      const output = (res.stdout || '') + (res.stderr || '');
      assert.ok(output.includes(`relevo ${cmd}`), `esperaba que la salida contuviera 'relevo ${cmd}', pero fue:\n${output}`);
      const files = fs.readdirSync(tmp).filter((f) => f !== '.git');
      assert.deepEqual(files, [], `el directorio debe seguir sin archivos aparte de .git, pero tiene: ${files.join(', ')}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

test('relevo --help sale con estado 0 y lista los 8 comandos', () => {
  const res = spawnSync(process.execPath, [bin, '--help'], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, `esperaba status 0 pero fue ${res.status} (stderr: ${res.stderr})`);
  const output = (res.stdout || '') + (res.stderr || '');
  const commands = ['init', 'run', 'watch', 'quota', 'check', 'doctor', 'task', 'update'];
  for (const cmd of commands) {
    assert.ok(output.includes(`relevo ${cmd}`), `esperaba que la salida contuviera 'relevo ${cmd}', pero fue:\n${output}`);
  }
});

console.log(`\ncli help: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
