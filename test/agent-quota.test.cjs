/* Agent quota parsing and model-to-group mapping. Uses a recorded `/usage` payload; no agent CLI is called. */
const assert = require('node:assert/strict');
const { parseAgyUsage, quotaGroupForModel, remainingFor, bucketMark } = require('../lib/quota.cjs');

const failures = [];
let passed = 0;
function test(name, action) {
  try { action(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}: ${error.message}`); }
}

// Forma real devuelta por `agy -p /usage --output-format json` (2026-11-09), valores de ejemplo.
const sample = { command: { name: 'usage', data: { groups: [
  { name: 'Gemini Models', description: 'Models within this group: Gemini Flash, Gemini Pro', buckets: [
    { id: 'gemini-weekly', window: 'weekly', remaining_fraction: 0.8674, reset_time: '2026-11-16T16:53:53Z' },
    { id: 'gemini-5h', window: '5h', remaining_fraction: 0.9771, reset_time: '2026-11-10T07:53:53Z' }] },
  { name: 'Claude and GPT models', buckets: [{ id: '3p-weekly', window: 'weekly', remaining_fraction: 1 }] },
  { name: 'Gemini 4 Argon', buckets: [{ id: 'gemini-argon-wtu-weekly', window: 'weekly', remaining_fraction: 0.0846, reset_time: '2026-11-16T17:46:48Z' }] },
] } } };

test('parses groups and buckets from the /usage payload', () => {
  const quota = parseAgyUsage(sample);
  assert.deepEqual(quota.groups.map((g) => g.id), ['gemini', 'third-party', 'argon']);
  assert.equal(quota.groups[0].buckets[1].window, '5h');
  assert.equal(quota.groups[2].buckets[0].remaining, 0.0846);
});

test('maps models to their quota group', () => {
  assert.equal(quotaGroupForModel('gemini-3.8-flash-high'), 'gemini');
  assert.equal(quotaGroupForModel('gemini-4-argon-high'), 'argon');
  assert.equal(quotaGroupForModel('claude-sonnet-5-5-low'), 'third-party');
  assert.equal(quotaGroupForModel(undefined), 'gemini');
});

test('remaining uses the most restrictive window of the group', () => {
  const quota = parseAgyUsage(sample);
  assert.equal(remainingFor(quota, 'gemini'), 0.8674);
  assert.equal(remainingFor(quota, 'argon'), 0.0846);
  assert.equal(remainingFor(quota, 'missing'), null);
});

test('rejects payloads without quota groups', () => {
  assert.throws(() => parseAgyUsage({ response: 'texto' }), /sin grupos/);
});

test('bucketMark with { min: 0.15, warn: 0.3 }', () => {
  const config = { min: 0.15, warn: 0.3 };
  assert.equal(bucketMark(0.1, config), '   ⚠ bajo');
  assert.equal(bucketMark(0.15, config), '   · justo');
  assert.equal(bucketMark(0.2, config), '   · justo');
  assert.equal(bucketMark(0.3, config), '');
  assert.equal(bucketMark(null, config), '');
});

test('bucketMark with { min: 0.5, warn: 0.7 } uses config instead of fixed 15%', () => {
  assert.equal(bucketMark(0.4, { min: 0.5, warn: 0.7 }), '   ⚠ bajo');
});

// Añadida por el auditor: la tabla que imprime relevo quota usa los umbrales recibidos, no un valor fijo.
test('formatQuota marca cada ventana según los umbrales recibidos', () => {
  const { formatQuota } = require('../lib/quota.cjs');
  const quota = { readAt: new Date().toISOString(), groups: [{ name: 'Gemini Models', buckets: [{ window: 'weekly', remaining: 0.4, resetAt: null }] }] };
  const strict = formatQuota(quota, { min: 0.5, warn: 0.7 });
  assert.ok(strict[1].includes('⚠ bajo'), strict[1]);
  const lax = formatQuota(quota, { min: 0.15, warn: 0.3 });
  assert.ok(!lax[1].includes('⚠') && !lax[1].includes('· justo'), lax[1]);
});

console.log(`\nagent quota: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
