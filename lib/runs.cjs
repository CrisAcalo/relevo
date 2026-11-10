/*
 * Modelo común de una ejecución de agente y descubrimiento de ejecuciones.
 * Formato actual:  artifacts/agent-runs/<NN>-<tarea>/{meta.json, events.ndjson, brief.md, stderr.log}
 * Formato antiguo: artifacts/agy-runs/<NN>-<tarea>.ndjson (solo agy, sin metadatos).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { PROVIDERS, detectProvider, oneLine } = require('./providers.cjs');

const { projectRoot } = require('./root.cjs');
const { loadConfig } = require('./config.cjs');
const ROOT = projectRoot();
const config = loadConfig(ROOT);
const RUNS_DIR = path.resolve(ROOT, config.runsDir);
const LEGACY_DIRS = (config.legacyRunsDirs ?? []).map((dir) => path.resolve(ROOT, dir));
const LEGACY_DIR = LEGACY_DIRS[0] ?? path.resolve(ROOT, 'artifacts/agy-runs');
const STALLED_MS = 10 * 60 * 1000;

const ROLES = {
  coder: 'codificador', qa: 'QA', docs: 'documentación', research: 'investigación', vision: 'capturas', review: 'revisión',
};

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

class Run {
  constructor({ id, name, eventsFile, metaFile }) {
    this.id = id;
    this.name = name;
    this.eventsFile = eventsFile;
    this.metaFile = metaFile;
    this.meta = (metaFile && readJson(metaFile)) || {};
    this.provider = this.meta.provider ? PROVIDERS[this.meta.provider] ?? null : null;
    this.parser = this.provider?.createParser() ?? null;
    this.offset = 0;
    this.buffer = '';
    this.steps = [];
    this.byKey = new Map();
    this.status = 'running';
    this.tokens = 0;
    this.cached = 0;
    this.response = '';
    this.denied = [];
    this.model = this.meta.model;
    this.cwd = this.meta.cwd;
    this.lastEventAt = 0;
    this.sequence = 0;
    const stat = fs.existsSync(eventsFile) ? fs.statSync(eventsFile) : null;
    this.startedAt = this.meta.startedAt ? Date.parse(this.meta.startedAt) : stat ? stat.birthtimeMs || stat.ctimeMs : Date.now();
    this.lastWrite = stat ? stat.mtimeMs : this.startedAt;
  }

  // API usada por los parsers de proveedores
  init({ model, conversation, cwd }) {
    if (model) this.model = model;
    if (conversation) this.conversation = conversation;
    if (cwd) this.cwd = cwd;
  }
  add(step) {
    step.at = Date.now();
    step.seq = this.sequence++;
    this.steps.push(step);
    return step;
  }
  step(key, patch) {
    let step = this.byKey.get(key);
    if (!step) { step = this.add({ ok: null, ...patch }); this.byKey.set(key, step); }
    else for (const [field, value] of Object.entries(patch)) if (value !== undefined) step[field] = value;
    return step;
  }
  say(text, meta = {}) { this.add({ kind: 'say', detail: text, ok: true, ...meta }); }
  think(meta = {}) { this.add({ kind: 'think', detail: meta.text ?? '', ok: true, seconds: meta.seconds, reasoning: meta.reasoning ?? 0 }); }
  note(text, ok = true) { this.add({ kind: 'note', detail: text, ok }); }
  usage({ total, cached, absolute = false }) {
    if (absolute) { if (total != null) this.tokens = total; if (cached != null) this.cached = cached; return; }
    this.tokens += total ?? 0;
    this.cached += cached ?? 0;
  }
  finish({ status, response, denied }) {
    this.status = status;
    if (response) this.response = String(response).trim();
    if (denied?.length) this.denied = denied;
    this.add({ kind: 'result', ok: status === 'ok' });
  }

  get roleLabel() { return ROLES[this.meta.role] ?? this.meta.role ?? ''; }
  get providerId() { return this.provider?.id ?? this.meta.provider ?? '?'; }
  get elapsed() {
    const end = this.status === 'running' ? Date.now() : this.meta.endedAt ? Date.parse(this.meta.endedAt) : this.lastWrite;
    return end - this.startedAt;
  }
  get idle() { return Date.now() - this.lastWrite; }
  get stalled() { return this.status === 'running' && this.idle > STALLED_MS && !this.processAlive; }
  get processAlive() {
    if (!this.meta.pid || this.meta.endedAt) return false;
    try { process.kill(this.meta.pid, 0); return true; } catch { return false; }
  }
  get actions() { return this.steps.filter((step) => !['think', 'say', 'note', 'result'].includes(step.kind)); }
  counts() {
    const counts = {};
    for (const step of this.actions) counts[step.kind] = (counts[step.kind] ?? 0) + 1;
    return counts;
  }

  poll() {
    if (this.metaFile) {
      const meta = readJson(this.metaFile);
      if (meta) this.meta = meta;
    }
    let stat;
    try { stat = fs.statSync(this.eventsFile); } catch { this.checkExit(); return false; }
    this.lastWrite = stat.mtimeMs;
    if (stat.size < this.offset) { this.offset = 0; this.buffer = ''; }
    if (stat.size > this.offset) {
      const fd = fs.openSync(this.eventsFile, 'r');
      const chunk = Buffer.alloc(stat.size - this.offset);
      fs.readSync(fd, chunk, 0, chunk.length, this.offset);
      fs.closeSync(fd);
      this.offset = stat.size;
      this.buffer += chunk.toString('utf8');
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop();
      for (const line of lines) this.ingest(line);
    }
    this.checkExit();
    return true;
  }
  ingest(line) {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); } catch { this.note(oneLine(line)); return; }
    if (!this.parser) {
      this.provider = detectProvider(event);
      this.parser = this.provider?.createParser() ?? null;
    }
    this.lastEventAt = Date.now();
    if (this.parser) this.parser(event, this);
  }
  checkExit() {
    // El proceso terminó sin evento de resultado (cancelado, sin cuota, error del CLI).
    if (this.status !== 'running' || !this.meta.endedAt) return;
    this.status = this.meta.exitCode === 0 ? 'ok' : 'error';
    if (!this.response && this.meta.error) this.response = this.meta.error;
    this.add({ kind: 'result', ok: this.status === 'ok' });
  }
}

function discoverRuns() {
  const found = [];
  if (fs.existsSync(RUNS_DIR)) {
    for (const entry of fs.readdirSync(RUNS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+-/.test(entry.name)) continue;
      const dir = path.join(RUNS_DIR, entry.name);
      // Solo carpetas creadas por el lanzador; las de evidencias (capturas, líneas base) no son ejecuciones.
      if (!fs.existsSync(path.join(dir, 'meta.json'))) continue;
      found.push({ id: entry.name, name: entry.name, eventsFile: path.join(dir, 'events.ndjson'), metaFile: path.join(dir, 'meta.json') });
    }
  }
  for (const legacyDir of LEGACY_DIRS) {
    if (fs.existsSync(legacyDir)) {
      for (const name of fs.readdirSync(legacyDir)) {
        if (!name.endsWith('.ndjson')) continue;
        const prefix = path.basename(legacyDir) + '/';
        found.push({ id: prefix + name, name: path.basename(name, '.ndjson'), eventsFile: path.join(legacyDir, name), metaFile: null });
      }
    }
  }
  return found;
}

function nextRunNumber() {
  let max = 0;
  for (const dir of [RUNS_DIR, ...LEGACY_DIRS]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const match = name.match(/^(\d+)-/);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return max + 1;
}

module.exports = { Run, discoverRuns, nextRunNumber, RUNS_DIR, LEGACY_DIR, ROOT, ROLES };
