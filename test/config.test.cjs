'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULTS, loadConfig, validateConfig } = require('../lib/config.cjs');

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

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'relevo-config-test-'));

test('sin archivo → DEFAULTS', () => {
  const emptyDir = path.join(tmpBase, 'empty');
  fs.mkdirSync(emptyDir, { recursive: true });
  const config = loadConfig(emptyDir);
  assert.deepEqual(config, DEFAULTS);
  // Debe ser una copia nueva para no mutar los defaults
  config.runsDir = 'modificado';
  assert.notEqual(DEFAULTS.runsDir, 'modificado');
});

test('fusión profunda con sustitución de listas', () => {
  const testDir = path.join(tmpBase, 'merge');
  fs.mkdirSync(testDir, { recursive: true });
  const userConfig = {
    runsDir: 'custom/runs',
    quota: { min: 0.2 },
    gate: {
      npmScripts: ['test:custom'],
    },
    check: {
      roadmap: 'docs/custom-plan.md',
    },
  };
  fs.writeFileSync(path.join(testDir, 'relevo.config.json'), JSON.stringify(userConfig));
  const config = loadConfig(testDir);

  // Sobrescrito
  assert.equal(config.runsDir, 'custom/runs');
  assert.equal(config.quota.min, 0.2);
  assert.equal(config.check.roadmap, 'docs/custom-plan.md');

  // Lista sustituida, NO concatenada
  assert.deepEqual(config.gate.npmScripts, ['test:custom']);

  // Preservados por defecto
  assert.equal(config.quota.warn, 0.3);
  assert.equal(config.worktreesDir, '.worktrees');
  assert.deepEqual(config.gate.scriptsDirs, ['scripts']);
  assert.equal(config.check.baseBranch, 'main');
});

test('tipo incorrecto → Error que nombra la clave', () => {
  const cases = [
    [{ runsDir: 123 }, 'runsDir'],
    [{ legacyRunsDirs: 'not-array' }, 'legacyRunsDirs'],
    [{ worktreesDir: null }, 'worktreesDir'],
    [{ taskBranchPrefix: 123 }, 'taskBranchPrefix'],
    [{ taskBranchPrefix: '' }, 'taskBranchPrefix'],
    [{ quota: { min: '0.1', warn: 0.3 } }, 'quota.min'],
    [{ quota: { min: 0.15, warn: false } }, 'quota.warn'],
    [{ gate: { ...DEFAULTS.gate, npmScripts: 'test' } }, 'gate.npmScripts'],
    [{ gate: { ...DEFAULTS.gate, scriptsDirs: [123] } }, 'gate.scriptsDirs'],
    [{ gate: { ...DEFAULTS.gate, sensitivePaths: 456 } }, 'gate.sensitivePaths'],
    [{ gate: { ...DEFAULTS.gate, roleScopes: { docs: 'not-array' } } }, 'gate.roleScopes.docs'],
    [{ check: { ...DEFAULTS.check, baseBranch: 123 } }, 'check.baseBranch'],
    [{ check: { ...DEFAULTS.check, sourcePattern: 456 } }, 'check.sourcePattern'],
    [{ check: { ...DEFAULTS.check, testPattern: [] } }, 'check.testPattern'],
    [{ check: { ...DEFAULTS.check, roadmap: 123 } }, 'check.roadmap'],
    [{ check: { ...DEFAULTS.check, decisions: 'invalid' } }, 'check.decisions'],
    [{ check: { ...DEFAULTS.check, decisions: { dir: 123, index: 'i' } } }, 'check.decisions.dir'],
    [{ check: { ...DEFAULTS.check, decisions: { dir: 'd', index: 123 } } }, 'check.decisions.index'],
    [{ check: { ...DEFAULTS.check, verdictFile: 999 } }, 'check.verdictFile'],
    [{ check: { ...DEFAULTS.check, hardcodedColorFiles: 123 } }, 'check.hardcodedColorFiles'],
    [{ check: { ...DEFAULTS.check, areaSuites: 'not-array' } }, 'check.areaSuites'],
    [{ check: { ...DEFAULTS.check, areaSuites: [{ pattern: 123, suites: [] }] } }, 'check.areaSuites[0].pattern'],
    [{ check: { ...DEFAULTS.check, areaSuites: [{ pattern: 'p', suites: 's' }] } }, 'check.areaSuites[0].suites'],
  ];

  for (const [override, expectedKey] of cases) {
    assert.throws(
      () => validateConfig({ ...DEFAULTS, ...override }),
      (err) => {
        const matches = err.message.includes(`relevo.config.json: ${expectedKey} debe ser`);
        if (!matches) {
          console.error(`Esperaba clave "${expectedKey}" en mensaje: "${err.message}"`);
        }
        return matches;
      },
      `Debe fallar nombrando la clave "${expectedKey}"`
    );
  }
});

test('patrón inválido ("(") → Error', () => {
  assert.throws(
    () => validateConfig({ ...DEFAULTS, check: { ...DEFAULTS.check, sourcePattern: '(' } }),
    /relevo\.config\.json: check\.sourcePattern contiene un patrón inválido "\("/
  );
  assert.throws(
    () => validateConfig({ ...DEFAULTS, check: { ...DEFAULTS.check, testPattern: '[' } }),
    /relevo\.config\.json: check\.testPattern contiene un patrón inválido "\["/
  );
  assert.throws(
    () => validateConfig({ ...DEFAULTS, check: { ...DEFAULTS.check, hardcodedColorFiles: '(' } }),
    /relevo\.config\.json: check\.hardcodedColorFiles contiene un patrón inválido "\("/
  );
  assert.throws(
    () => validateConfig({ ...DEFAULTS, check: { ...DEFAULTS.check, areaSuites: [{ pattern: '(', suites: ['s'] }] } }),
    /relevo\.config\.json: check\.areaSuites\[0\]\.pattern contiene un patrón inválido "\("/
  );
  assert.throws(
    () => validateConfig({
      ...DEFAULTS,
      gate: {
        ...DEFAULTS.gate,
        roleScopes: { docs: ['('] },
      },
    }),
    /relevo\.config\.json: gate\.roleScopes\.docs contiene un patrón inválido "\("/
  );
});

test('clave desconocida → aviso, no error', () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    const testDir = path.join(tmpBase, 'unknown-keys');
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(
      path.join(testDir, 'relevo.config.json'),
      JSON.stringify({
        unknownTop: 'valor',
        gate: { unknownGate: true },
        check: { unknownCheck: 123 },
      })
    );

    // No debe lanzar error
    const config = loadConfig(testDir);
    assert.ok(config);

    assert.ok(warnings.some((w) => w.includes('clave desconocida "unknownTop"')));
    assert.ok(warnings.some((w) => w.includes('clave desconocida "gate.unknownGate"')));
    assert.ok(warnings.some((w) => w.includes('clave desconocida "check.unknownCheck"')));
  } finally {
    console.warn = originalWarn;
  }
});

test('roleScopes se combina por rol con los valores por defecto', () => {
  const testDir = path.join(tmpBase, 'rolescopes-merge');
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(
    path.join(testDir, 'relevo.config.json'),
    JSON.stringify({
      gate: { roleScopes: { qa: ['^lib/'] } },
    })
  );
  const config = loadConfig(testDir);
  assert.deepEqual(config.gate.roleScopes.qa, ['^lib/']);
  assert.deepEqual(config.gate.roleScopes.docs, DEFAULTS.gate.roleScopes.docs);
  assert.deepEqual(config.gate.roleScopes.vision, DEFAULTS.gate.roleScopes.vision);
  assert.deepEqual(config.gate.roleScopes.research, DEFAULTS.gate.roleScopes.research);
  assert.deepEqual(config.gate.roleScopes.review, DEFAULTS.gate.roleScopes.review);
});

test('roleScopes acepta null para quitar la restricción de un rol', () => {
  const testDir = path.join(tmpBase, 'rolescopes-null');
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(
    path.join(testDir, 'relevo.config.json'),
    JSON.stringify({
      gate: { roleScopes: { qa: null } },
    })
  );
  let config;
  assert.doesNotThrow(() => {
    config = loadConfig(testDir);
  });
  assert.equal(config.gate.roleScopes.qa, null);
  assert.deepEqual(config.gate.roleScopes.docs, DEFAULTS.gate.roleScopes.docs);
});

// Limpieza
try {
  fs.rmSync(tmpBase, { recursive: true, force: true });
} catch { /* ignorar */ }

console.log(`\nconfig: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
