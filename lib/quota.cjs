#!/usr/bin/env node
/*
 * Cupos de uso de los proveedores de agentes. Hoy: Antigravity (`agy -p /usage`), que no consume tokens.
 *   npm run agents:quota            tabla legible
 *   npm run agents:quota -- --json  JSON normalizado
 * Guarda la última lectura en artifacts/agent-runs/.quota.json para el panel y el lanzador.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { projectRoot } = require('./root.cjs');
const ROOT = projectRoot();
const CACHE = path.join(ROOT, 'artifacts/agent-runs/.quota.json');

/** Convierte la respuesta de `/usage` en { groups: [{ id, name, models, buckets: [{ id, window, remaining, resetAt }] }] }. */
function parseAgyUsage(raw) {
  const data = raw?.command?.data;
  if (!data || !Array.isArray(data.groups)) throw new Error('Respuesta de /usage sin grupos de cupo.');
  return {
    provider: 'agy',
    readAt: new Date().toISOString(),
    groups: data.groups.map((group) => ({
      id: /argon/i.test(group.name) ? 'argon' : /claude|gpt/i.test(group.name) ? 'third-party' : /gemini/i.test(group.name) ? 'gemini' : String(group.name),
      name: group.name,
      models: group.description ?? '',
      buckets: (group.buckets ?? []).map((bucket) => ({
        id: bucket.id,
        window: bucket.window,
        remaining: typeof bucket.remaining_fraction === 'number' ? bucket.remaining_fraction : null,
        resetAt: bucket.reset_time ?? null,
      })),
    })),
  };
}

/** Grupo de cupo al que pertenece un modelo de agy. */
function quotaGroupForModel(model) {
  if (/argon/i.test(model ?? '')) return 'argon';
  if (/claude|gpt/i.test(model ?? '')) return 'third-party';
  return 'gemini';
}

/** Menor fracción restante del grupo (la ventana más restrictiva). */
function remainingFor(quota, groupId) {
  const group = quota?.groups?.find((g) => g.id === groupId);
  const values = (group?.buckets ?? []).map((b) => b.remaining).filter((v) => typeof v === 'number');
  return values.length ? Math.min(...values) : null;
}

function fetchAgyQuota(timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    execFile('agy', ['-p', '/usage', '--output-format', 'json'], { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout) => {
      if (error) { reject(new Error('No se pudo consultar el cupo de agy: ' + error.message)); return; }
      try {
        const quota = parseAgyUsage(JSON.parse(stdout.trim().split('\n').pop()));
        fs.mkdirSync(path.dirname(CACHE), { recursive: true });
        fs.writeFileSync(CACHE, JSON.stringify(quota, null, 2));
        resolve(quota);
      } catch (parseError) { reject(parseError); }
    });
  });
}

function readCachedQuota() {
  try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return null; }
}

const pct = (value) => (value == null ? '—' : `${Math.round(value * 100)} %`);
const when = (iso) => {
  if (!iso) return '—';
  const ms = Date.parse(iso) - Date.now();
  if (!(ms > 0)) return 'ya';
  const h = Math.floor(ms / 3600000);
  return h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h ${Math.floor((ms % 3600000) / 60000)} min`;
};

async function main() {
  const quota = await fetchAgyQuota();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(quota, null, 2)); return; }
  console.log('Cupos de Antigravity (agy) · ' + new Date(quota.readAt).toLocaleString('es'));
  for (const group of quota.groups) {
    for (const bucket of group.buckets) {
      const low = bucket.remaining != null && bucket.remaining < 0.15;
      console.log(`  ${group.name.padEnd(24)} ${String(bucket.window).padEnd(7)} queda ${pct(bucket.remaining).padStart(5)}   se renueva en ${when(bucket.resetAt)}${low ? '   ⚠ bajo' : ''}`);
    }
  }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { parseAgyUsage, quotaGroupForModel, remainingFor, fetchAgyQuota, readCachedQuota, CACHE };
