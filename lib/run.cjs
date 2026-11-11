#!/usr/bin/env node
/*
 * Lanzador común de agentes de código. Crea artifacts/agent-runs/<NN>-<tarea>/ con:
 *   brief.md (encargo), meta.json (proveedor, modelo, rol, carpeta, rama, tiempos, salida),
 *   events.ndjson (eventos del CLI), stderr.log.
 *
 *   npm run agent:run -- --provider agy --role coder --model gemini-3.8-flash-high \
 *     --task a5-cover --cwd .worktrees/a5-cover --brief ruta/encargo.md
 *
 * Opciones: --mode plan (agy), --conversation <id> (agy), --agent <nombre> (agy),
 *           --sandbox <modo> (codex, por defecto workspace-write), --timeout <segundos> (por defecto 3000).
 * Nunca añade flags que desactiven permisos o sandbox del proveedor.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { PROVIDERS } = require('./providers.cjs');
const { RUNS_DIR, ROOT, ROLES, reserveRunNumber } = require('./runs.cjs');
const { canonical } = require('./root.cjs');
const { loadConfig } = require('./config.cjs');
const { fetchAgyQuota, quotaGroupForModel, remainingFor } = require('./quota.cjs');
const config = loadConfig(ROOT);

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    options[key] = value;
  }
  return options;
}

function fail(message) { console.error('agent:run · ' + message); process.exit(2); }

const options = parseArgs(process.argv.slice(2));
const provider = PROVIDERS[options.provider];
if (!provider) fail(`--provider debe ser uno de: ${Object.keys(PROVIDERS).join(', ')}`);
if (!options.task || !/^[a-z0-9][a-z0-9-]*$/i.test(options.task)) fail('--task es obligatorio (letras, números y guiones)');
if (!options.brief || !fs.existsSync(options.brief)) fail('--brief debe apuntar a un archivo con el encargo');
if (options.role && !ROLES[options.role]) fail(`--role debe ser uno de: ${Object.keys(ROLES).join(', ')}`);
const optionNames = process.argv.slice(2).filter((arg) => arg.startsWith('-')).map((arg) => arg.split('=')[0]);
if (optionNames.some((name) => /dangerously|bypass|skip-permissions/i.test(name))) fail('no se permiten flags que desactiven permisos o sandbox');
if (provider.id === 'codex' && options.sandbox !== undefined && options.sandbox !== 'read-only' && options.sandbox !== 'workspace-write') {
  fail('--sandbox de Codex debe ser read-only o workspace-write; no se permite desactivar el sandbox');
}

const MIN_QUOTA = config.quota.min;
const WARN_QUOTA = config.quota.warn;

async function main() {
// Siempre desde el repositorio principal: desde un worktree, --cwd se resolvería mal y los
// registros de la ejecución se perderían al borrar el worktree (2026-11-10).
const wtDir = config.worktreesDir.replace(/^[\\/]+|[\\/]+$/g, '');
const wtRegex = new RegExp(`[\\\\/]${wtDir.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}[\\\\/]`);
if (wtRegex.test(ROOT + path.sep)) fail('ejecuta el lanzador desde la raíz del repositorio principal, no desde un worktree');
const requested = path.resolve(ROOT, options.cwd ?? '.');
if (!fs.existsSync(requested) || !fs.statSync(requested).isDirectory()) fail(`--cwd no existe: ${path.relative(ROOT, requested) || requested}`);
const cwd = canonical(requested);
const inside = path.relative(ROOT, cwd);
if (inside.startsWith('..') || path.isAbsolute(inside)) fail('--cwd debe estar dentro del repositorio');

// Cupo antes de lanzar: con poco cupo, un agente puede quedarse a medias.
let quotaBefore = null;
if (provider.id === 'agy') {
  try {
    const quota = await fetchAgyQuota();
    const group = quotaGroupForModel(options.model);
    const remaining = remainingFor(quota, group);
    quotaBefore = { group, remaining, readAt: quota.readAt };
    if (remaining != null && remaining < MIN_QUOTA && !options['allow-low-quota']) {
      fail(`cupo de ${group} al ${Math.round(remaining * 100)} % (< ${MIN_QUOTA * 100} %). Usa otro modelo o --allow-low-quota con motivo explícito.`);
    }
    if (remaining != null && remaining < WARN_QUOTA) console.warn(`agent:run · aviso: cupo de ${group} al ${Math.round(remaining * 100)} %`);
  } catch (error) {
    console.warn('agent:run · aviso: no se pudo consultar el cupo (' + error.message + '); se continúa.');
  }
}
const prompt = fs.readFileSync(options.brief, 'utf8');
const number = reserveRunNumber();
const dir = path.join(RUNS_DIR, `${number}-${options.task}`);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'brief.md'), prompt);

let branch = null;
try { branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' }).trim(); } catch { /* fuera de git */ }

const timeoutSeconds = Number(options.timeout ?? 3000);
const { command, args, input } = provider.command({
  prompt, model: options.model, mode: options.mode, conversation: options.conversation, agent: options.agent,
  cwd, sandbox: options.sandbox, timeoutSeconds,
});

const meta = {
  version: 1, provider: provider.id, model: options.model ?? null, role: options.role ?? null, task: options.task,
  number, cwd: path.relative(ROOT, cwd) || '.', branch, mode: options.mode ?? null, conversation: options.conversation ?? null,
  startedAt: new Date().toISOString(), pid: null, launcherPid: process.pid, endedAt: null, exitCode: null, error: null,
  quotaBefore, quotaAfter: null,
};
const metaFile = path.join(dir, 'meta.json');
const writeMeta = () => fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
writeMeta();

const events = fs.createWriteStream(path.join(dir, 'events.ndjson'));
const errors = fs.createWriteStream(path.join(dir, 'stderr.log'));
// El rol viaja al hook de permisos (.agents/hooks/permission-gate.cjs) para limitar qué archivos puede editar.
const child = spawn(command, args, { cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, AGY_ROLE: options.role ?? '', AGY_RUN_DIR: dir } });
if (typeof input === 'string') {
  child.stdin.on('error', (err) => errors.write(`stdin: ${err.message}\n`));
  child.stdin.end(input);
} else {
  child.stdin.end();
}
meta.pid = child.pid ?? null;
writeMeta();
console.log(`agent:run · ${number}-${options.task} · ${provider.label} ${options.model ?? ''} · ${meta.cwd} · pid ${meta.pid}`);
console.log(`agent:run · seguir en vivo: npm run agents   ·   carpeta: ${path.relative(ROOT, dir)}`);

child.stdout.pipe(events);
child.stderr.pipe(errors);
let settled = false;
const finish = (code, error) => {
  if (settled) return;
  settled = true;
  meta.endedAt = new Date().toISOString();
  meta.exitCode = code;
  if (error) meta.error = error;
  writeMeta();
  const seconds = Math.round((Date.parse(meta.endedAt) - Date.parse(meta.startedAt)) / 1000);
  console.log(`agent:run · ${number}-${options.task} terminó con código ${code} en ${seconds}s`);
  process.exitCode = code === 0 ? 0 : 1;
  // Cupo después: registra cuánto consumió la tarea (diferencia aproximada; otras sesiones también consumen).
  if (quotaBefore) {
    fetchAgyQuota().then((quota) => {
      meta.quotaAfter = { group: quotaBefore.group, remaining: remainingFor(quota, quotaBefore.group), readAt: quota.readAt };
      writeMeta();
      if (quotaBefore.remaining != null && meta.quotaAfter.remaining != null) {
        console.log(`agent:run · cupo ${quotaBefore.group}: ${Math.round(quotaBefore.remaining * 100)} % → ${Math.round(meta.quotaAfter.remaining * 100)} %`);
      }
    }).catch(() => { /* sin lectura posterior */ });
  }
};
child.on('error', (error) => finish(127, `No se pudo iniciar ${command}: ${error.message}`));
child.on('close', (code) => events.end(() => errors.end(() => finish(code ?? 1))));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(); finish(130, 'Cancelado por el usuario'); });
}

main().catch((error) => fail(error.message));
