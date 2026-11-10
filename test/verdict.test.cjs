'use strict';

const assert = require('node:assert/strict');
const { validateVerdict } = require('../lib/verdict.cjs');

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

const validReference = {
  version: 1,
  commit: '0123456789abcdef0123456789abcdef01234567',
  branch: 'agy/a7b-piano-roll',
  verdict: 'aprobado',
  checkedAt: '2026-11-10T21:23:00.000Z',
  suites: [
    {
      name: 'verify',
      passed: true,
      console: { errors: 0, warnings: 0, pageErrors: 0 },
    },
  ],
  findings: [
    {
      severity: 'baja',
      file: 'scripts/x.cjs:743',
      detail: '…',
    },
  ],
  testReview: ['Mutación 1 …'],
  documentation: ['completa: …'],
};

test('el ejemplo de referencia de origen es válido', () => {
  const res = validateVerdict(validReference);
  assert.equal(res.ok, true);
  assert.deepEqual(res.errors, []);
});

test('un veredicto sin suites o sin branch o sin checkedAt opcionales pero con campos obligatorios es válido', () => {
  const minimal = {
    version: 1,
    commit: 'a'.repeat(40),
    verdict: 'rechazado',
    suites: [],
  };
  const res = validateVerdict(minimal);
  assert.equal(res.ok, true);
  assert.deepEqual(res.errors, []);
});

test('"veredicto" en lugar de "verdict" genera error que nombra la clave desconocida', () => {
  const { verdict: _v, ...sinVerdict } = validReference;
  const invalid = { ...sinVerdict, veredicto: 'aprobado' };
  const res = validateVerdict(invalid);
  assert.equal(res.ok, false);
  assert.ok(
    res.errors.some((e) => e.includes('clave desconocida "veredicto"')),
    `esperaba error sobre clave desconocida "veredicto", se obtuvo: ${res.errors.join('; ')}`
  );
  assert.ok(
    res.errors.some((e) => e.includes('verdict debe ser')),
    `esperaba que reportara falta de verdict`
  );
});

test('severity "High", "alta " y "critica" son rechazadas con error en la ruta', () => {
  for (const badSeverity of ['High', 'alta ', 'critica']) {
    const invalid = {
      ...validReference,
      findings: [{ severity: badSeverity, detail: 'detalle' }],
    };
    const res = validateVerdict(invalid);
    assert.equal(res.ok, false);
    assert.ok(
      res.errors.some((e) => e.includes('findings[0].severity')),
      `esperaba error en findings[0].severity con "${badSeverity}", se obtuvo: ${res.errors.join('; ')}`
    );
  }
});

test('commit con 7 caracteres o con mayúsculas genera error', () => {
  const shortCommit = { ...validReference, commit: 'a1b2c3d' };
  const resShort = validateVerdict(shortCommit);
  assert.equal(resShort.ok, false);
  assert.ok(
    resShort.errors.some((e) => e.includes('commit debe ser')),
    `esperaba error en commit corto: ${resShort.errors.join('; ')}`
  );

  const upperCommit = { ...validReference, commit: 'A'.repeat(40) };
  const resUpper = validateVerdict(upperCommit);
  assert.equal(resUpper.ok, false);
  assert.ok(
    resUpper.errors.some((e) => e.includes('commit debe ser')),
    `esperaba error en commit mayúsculas: ${resUpper.errors.join('; ')}`
  );
});

test('suites[0].passed con texto "true" en vez de booleano genera error con la ruta exacta', () => {
  const invalid = {
    ...validReference,
    suites: [{ name: 'verify', passed: 'true' }],
  };
  const res = validateVerdict(invalid);
  assert.equal(res.ok, false);
  assert.ok(
    res.errors.includes('suites[0].passed debe ser booleano'),
    `esperaba "suites[0].passed debe ser booleano", se obtuvo: ${res.errors.join('; ')}`
  );
});

test('clave extra en una suite produce error', () => {
  const invalid = {
    ...validReference,
    suites: [{ name: 'verify', passed: true, extraKey: 'invalida' }],
  };
  const res = validateVerdict(invalid);
  assert.equal(res.ok, false);
  assert.ok(
    res.errors.some((e) => e.includes('suites[0]: clave desconocida "extraKey"')),
    `esperaba error de clave extra en suites[0], se obtuvo: ${res.errors.join('; ')}`
  );
});

test('verdict: "approved" produce error', () => {
  const invalid = {
    ...validReference,
    verdict: 'approved',
  };
  const res = validateVerdict(invalid);
  assert.equal(res.ok, false);
  assert.ok(
    res.errors.some((e) => e.includes('verdict debe ser "aprobado" o "rechazado"')),
    `esperaba error en verdict: approved: ${res.errors.join('; ')}`
  );
});

test('version distinta de 1 produce error', () => {
  const invalid = { ...validReference, version: 2 };
  const res = validateVerdict(invalid);
  assert.equal(res.ok, false);
  assert.ok(res.errors.includes('version debe ser 1'));
});

test('nunca lanza con null, [], "x", 5', () => {
  for (const input of [null, [], 'x', 5, undefined, true]) {
    let res;
    assert.doesNotThrow(() => {
      res = validateVerdict(input);
    });
    assert.equal(res.ok, false);
    assert.ok(res.errors.length > 0);
  }
});

console.log(`\nverdict validation: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
