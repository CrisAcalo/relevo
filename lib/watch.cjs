#!/usr/bin/env node
/*
 * Panel de agentes de código (agy, Codex…) a partir de artifacts/agent-runs/ y artifacts/agy-runs/.
 *
 *   npm run agents                 Panel en vivo. ↑↓ elegir · Enter detalle · Esc volver · a todos · q salir
 *   npm run agents -- 10           Abre directamente el detalle de una ejecución (número o parte del nombre)
 *   npm run agents -- --list       Tabla de todas las ejecuciones
 *   npm run agents -- 10 --once    Imprime el detalle y sale (también sin terminal interactiva)
 *   --all incluye ejecuciones antiguas · --frame dibuja un cuadro del panel y sale
 *
 * Solo lectura: nunca habla con los agentes ni modifica sus archivos.
 */
'use strict';
const path = require('node:path');
const { Run, discoverRuns, ROOT } = require('./runs.cjs');
const { readCachedQuota, fetchAgyQuota, remainingFor } = require('./quota.cjs');

// Cupos: se leen de la caché y se refrescan en segundo plano (consultar /usage no consume tokens).
const QUOTA_REFRESH_MS = 5 * 60 * 1000;
let quotaState = readCachedQuota();
let quotaFetching = false;
function refreshQuota(force = false) {
  const age = quotaState?.readAt ? Date.now() - Date.parse(quotaState.readAt) : Infinity;
  if (quotaFetching || (!force && age < QUOTA_REFRESH_MS)) return;
  quotaFetching = true;
  fetchAgyQuota().then((quota) => { quotaState = quota; }).catch(() => { /* se mantiene la última lectura */ }).finally(() => { quotaFetching = false; });
}

const RECENT_MS = 20 * 60 * 1000;
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const query = args.find((arg) => !arg.startsWith('--'));
const interactive = Boolean(process.stdout.isTTY && process.stdin.isTTY) && !flag('frame') && !flag('once') && !flag('list');
const colorful = Boolean(process.stdout.isTTY) || flag('color');

// ── Estilo ─────────────────────────────────────────────────────────────────
const sgr = (code) => (text) => (colorful ? `\x1b[${code}m${text}\x1b[0m` : String(text));
const st = {
  bold: sgr('1'), dim: sgr('2'), italic: sgr('3'), inverse: sgr('7'),
  gray: sgr('90'), red: sgr('31'), green: sgr('32'), yellow: sgr('33'), blue: sgr('34'), magenta: sgr('35'), cyan: sgr('36'), white: sgr('97'),
  bgBlue: sgr('44;97'), bgGreen: sgr('42;30'), bgMagenta: sgr('45;97'), bgGray: sgr('100;97'), bgCyan: sgr('46;30'), bgYellow: sgr('43;30'), bgRed: sgr('41;97'),
};
const KIND = {
  read: { label: 'LEE', color: st.blue }, search: { label: 'BUSCA', color: st.blue }, edit: { label: 'EDITA', color: st.green },
  web: { label: 'WEB', color: st.cyan }, run: { label: 'EJECUTA', color: st.yellow }, wait: { label: 'ESPERA', color: st.gray },
  agent: { label: 'SUBAGENTE', color: st.magenta }, think: { label: 'PIENSA', color: st.magenta }, say: { label: 'DICE', color: st.white },
  note: { label: 'AVISO', color: st.gray }, other: { label: 'OTRA', color: st.gray },
};
const COUNTED = ['read', 'search', 'edit', 'run', 'web', 'wait', 'agent', 'other'];
const PROVIDER_BADGE = { agy: (t) => st.bgBlue(t), codex: (t) => st.bgGreen(t), deepseek: (t) => st.bgMagenta(t) };
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

const oneLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const plain = (text) => String(text ?? '')
  .replace(/\[([^\]]*)\]\((?:file|https?):[^)]*\)/g, '$1')
  .replace(/\*\*|`/g, '')
  .replace(/^#{1,6}\s*/gm, '');
const width = () => Math.max(70, Math.min(process.stdout.columns || 120, 220));
const height = () => Math.max(20, process.stdout.rows || 40);
const duration = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
};
const tokens = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n || 0));
const shortModel = (model) => String(model ?? '').replace(/^gemini-/, '').replace(/-(low|medium|high)$/, ' $1').replace('flash', 'Flash').replace('argon', 'Argon') || 'modelo ?';
const relativePath = (p) => {
  const text = String(p ?? '').replace(/\\/g, '/');
  const brain = text.match(/antigravity-cli\/brain\/[^/]+\/(.+)$/);
  if (brain) return '~brain/' + brain[1];
  const base = path.basename(ROOT) + '/';
  const index = text.toLowerCase().indexOf(base.toLowerCase());
  return (index >= 0 ? text.slice(index + base.length) : text).replace(/^\.worktrees\/[^/]+\//, '');
};

// Construye una línea de ancho visible exacto a partir de segmentos [texto, estilo].
function line(segments, size) {
  let out = '';
  let used = 0;
  for (const [raw, style] of segments) {
    if (used >= size) break;
    let text = String(raw ?? '');
    if (used + text.length > size) text = text.slice(0, Math.max(0, size - used - 1)) + '…';
    out += style ? style(text) : text;
    used += text.length;
  }
  return out + ' '.repeat(Math.max(0, size - used));
}
const rightAlign = (left, right, size) => {
  const rightLength = right.reduce((sum, [t]) => sum + String(t).length, 0);
  return line(left, Math.max(0, size - rightLength)) + line(right, rightLength);
};
const wrap = (text, size) => {
  const out = [];
  for (const paragraph of plain(text).split(/\r?\n/)) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if ((current + ' ' + word).trim().length > size) { if (current) out.push(current); current = word.length > size ? word.slice(0, size - 1) + '…' : word; }
      else current = (current + ' ' + word).trim();
    }
    out.push(current);
  }
  return out;
};

// ── Elementos ──────────────────────────────────────────────────────────────
function statusSegment(run, frame) {
  if (run.status === 'ok') return ['✓ listo', st.green];
  if (run.status === 'error') return ['✗ falló', st.red];
  if (run.status === 'interrupted') return ['⊘ interrumpida', st.red];
  if (run.stalled) return [`! sin actividad ${duration(run.idle)}`, st.red];
  return [`${SPIN[frame % SPIN.length]} trabajando`, st.yellow];
}
function stepSegments(step) {
  const kind = KIND[step.kind] ?? KIND.other;
  const mark = step.ok === false ? ['✗ ', st.red] : step.ok === null ? ['› ', st.yellow] : ['· ', st.gray];
  let detail;
  if (step.kind === 'think') detail = [step.detail ? oneLine(step.detail) : `${tokens(step.reasoning)} tok de razonamiento`, st.dim];
  else if (step.kind === 'note') detail = [oneLine(step.detail), st.dim];
  else if (step.kind === 'say') detail = [oneLine(plain(step.detail)), null];
  else {
    const target = step.path ? relativePath(step.path) : '';
    const text = step.kind === 'run' ? '$ ' + oneLine(step.detail) : oneLine(target + (step.detail ?? ''));
    detail = [text + (step.ok === false ? `  [${step.state ?? 'error'}]` : ''), step.ok === false ? st.red : step.kind === 'run' ? st.white : null];
  }
  const time = step.seconds != null ? (step.seconds < 10 ? step.seconds.toFixed(1) : String(Math.round(step.seconds))) + 's' : step.ok === null ? '…' : '';
  return { left: [mark, [kind.label.padEnd(10), kind.color], detail], right: time ? [[' ' + time, st.dim]] : [] };
}
function activityBar(run, size) {
  const counts = run.counts();
  const total = COUNTED.reduce((sum, kind) => sum + (counts[kind] ?? 0), 0);
  if (!total) return [['░'.repeat(size), st.gray]];
  // Reparto por restos mayores: cada tipo presente recibe al menos una celda y la barra suma exactamente `size`.
  const present = COUNTED.filter((kind) => counts[kind]);
  const cells = present.map((kind) => ({ kind, exact: (counts[kind] / total) * size }));
  for (const c of cells) c.n = Math.max(1, Math.floor(c.exact));
  let used = cells.reduce((sum, c) => sum + c.n, 0);
  for (const c of [...cells].sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)))) {
    if (used >= size) break;
    c.n++; used++;
  }
  while (used > size) { const biggest = cells.reduce((a, b) => (b.n > a.n ? b : a)); biggest.n--; used--; }
  return cells.map((c) => ['█'.repeat(c.n), KIND[c.kind].color]);
}
function counters(run) {
  const counts = run.counts();
  const out = [];
  for (const kind of COUNTED) {
    const n = counts[kind] ?? 0;
    if (!n) continue;
    out.push([KIND[kind].label + ' ', KIND[kind].color], [String(n) + '  ', st.bold]);
  }
  return out.length ? out : [['sin acciones todavía', st.dim]];
}

function card(run, size, selected, bodyRows, frame) {
  const border = selected ? st.cyan : st.gray;
  const inner = size - 4;
  const badgeStyle = PROVIDER_BADGE[run.providerId] ?? st.bgGray;
  const badge = ` ${run.provider?.label ?? run.providerId} `;
  const role = run.roleLabel ? ` ${run.roleLabel} ` : '';
  const title = ` ${run.name} `;
  const titleRoom = size - 4 - badge.length - role.length;
  const fill = Math.max(1, titleRoom - Math.min(title.length, titleRoom));
  const top = border('╭─') + (selected ? st.bold : (t) => t)(line([[title, selected ? st.cyan : st.white]], Math.min(title.length, titleRoom)))
    + border('─'.repeat(fill)) + badgeStyle(badge) + (role ? st.bgGray(role) : '') + border('─╮');
  const row = (content) => border('│ ') + content + border(' │');
  const lines = [top];
  const location = run.meta.cwd && run.meta.cwd !== '.' ? `${run.meta.cwd}${run.meta.branch ? ' (' + run.meta.branch + ')' : ''}` : run.meta.branch ?? '';
  lines.push(row(rightAlign(
    [statusSegment(run, frame), ['   ' + duration(run.elapsed), st.white], ['   ' + tokens(run.tokens) + ' tok', st.white], ['   ' + shortModel(run.model), st.gray]],
    location ? [['  ' + location, st.dim]] : [], inner)));
  const barSize = Math.min(24, Math.max(10, Math.floor(inner / 5)));
  lines.push(row(line([...activityBar(run, barSize), ['  ', null], ...counters(run)], inner)));
  lines.push(row(line([['─'.repeat(inner), st.gray]], inner)));
  const body = [];
  if (run.status !== 'running' && (run.response || run.denied.length)) {
    const text = wrap(run.response, inner - 2).filter((l) => l && !/^-{3,}$/.test(l));
    for (const l of text.slice(-Math.max(1, bodyRows - (run.denied.length ? 1 : 0)))) body.push(line([['  ' + l, null]], inner));
    if (run.denied.length) body.push(line([[`  ✗ acciones denegadas: ${run.denied.length}`, st.red]], inner));
  } else {
    const visible = run.steps.filter((s) => s.kind !== 'result' && !(s.kind === 'think' && (s.reasoning ?? 0) < 1000 && !s.detail));
    const busy = visible.at(-1)?.ok === null;
    const thinking = run.status === 'running' && !busy && run.idle > 15000;
    const rows = visible.slice(-(bodyRows - (thinking ? 1 : 0)));
    for (const step of rows) { const s = stepSegments(step); body.push(rightAlign(s.left, s.right, inner)); }
    if (!run.model && !rows.length) body.push(line([['  arrancando…', st.dim]], inner));
    else if (thinking) body.push(line([[`◌ pensando… ${duration(run.idle)} sin eventos`, st.magenta]], inner));
  }
  while (body.length < bodyRows) body.push(' '.repeat(inner));
  for (const content of body.slice(0, bodyRows)) lines.push(row(content));
  lines.push(border('╰' + '─'.repeat(size - 2) + '╯'));
  return lines;
}

// ── Estado del panel ───────────────────────────────────────────────────────
const runs = new Map();
let frame = 0;
let selectedIndex = 0;
let showAll = flag('all');
let view = 'dashboard';
let detailRun = null;
let scroll = 0;
let follow = true;

function refresh() {
  for (const descriptor of discoverRuns()) if (!runs.has(descriptor.id)) runs.set(descriptor.id, new Run(descriptor));
  for (const run of runs.values()) run.poll();
}
function shownRuns() {
  return [...runs.values()]
    .filter((run) => showAll || run.status === 'running' || Date.now() - run.lastWrite < RECENT_MS)
    .sort((a, b) => (a.status === 'running') !== (b.status === 'running') ? (a.status === 'running' ? -1 : 1) : b.lastWrite - a.lastWrite);
}

function quotaLine(W) {
  if (!quotaState) return line([[quotaFetching ? '  cupos: consultando…' : '  cupos: sin datos (npm run agents:quota)', st.dim]], W);
  const segs = [['  cupos agy  ', st.dim]];
  const show = (label, groupId) => {
    const group = quotaState.groups?.find((g) => g.id === groupId);
    if (!group) return;
    const parts = group.buckets.map((b) => `${b.window === 'weekly' ? 'semana' : b.window} ${b.remaining == null ? '—' : Math.round(b.remaining * 100) + '%'}`);
    const min = remainingFor(quotaState, groupId);
    const color = min == null ? st.gray : min < 0.15 ? st.red : min < 0.3 ? st.yellow : st.green;
    segs.push([label + ' ', st.bold], [parts.join(' · ') + '    ', color]);
  };
  show('Gemini', 'gemini');
  show('Argon', 'argon');
  const age = Math.round((Date.now() - Date.parse(quotaState.readAt)) / 60000);
  segs.push([`(hace ${age} min)`, st.dim]);
  return line(segs, W);
}

function renderDashboard() {
  const W = width(), H = height();
  const list = shownRuns();
  selectedIndex = Math.min(selectedIndex, Math.max(0, list.length - 1));
  const working = list.filter((r) => r.status === 'running').length;
  const done = list.filter((r) => r.status === 'ok').length;
  const failed = list.filter((r) => r.status === 'error' || r.status === 'interrupted').length;
  const totalTokens = list.reduce((sum, r) => sum + r.tokens, 0);
  const clock = new Date().toLocaleTimeString('es', { hour12: false });
  const out = [];
  out.push(st.inverse(rightAlign(
    [[' AGENTES ', st.bold], [`  ${SPIN[frame % SPIN.length]} ${working} trabajando`, null], [`   ✓ ${done} listos`, null], [`   ✗ ${failed} fallidos`, null], [`   ${tokens(totalTokens)} tok`, null], [showAll ? '   · todos' : '   · recientes', null]],
    [[clock + ' ', null]], W)));
  out.push(quotaLine(W));
  if (!list.length) {
    out.push(line([['  No hay agentes activos ni recientes.', st.dim]], W));
    out.push(line([['  Pulsa a para ver todos, o lanza uno con npm run agent:run.', st.dim]], W));
  } else {
    const columns = W >= 150 && list.length > 1 ? 2 : 1;
    const cardWidth = columns === 2 ? Math.floor((W - 1) / 2) : W;
    const rowsOfCards = Math.ceil(list.length / columns);
    const available = H - 4;
    const perCard = Math.max(7, Math.floor(available / Math.max(1, Math.min(rowsOfCards, 3))));
    const bodyRows = Math.max(2, Math.min(10, perCard - 5));
    const maxCardRows = Math.max(1, Math.floor(available / (bodyRows + 5)));
    const firstRow = Math.max(0, Math.floor(selectedIndex / columns) - maxCardRows + 1);
    for (let r = firstRow; r < Math.min(rowsOfCards, firstRow + maxCardRows); r++) {
      const cards = [];
      for (let c = 0; c < columns; c++) {
        const index = r * columns + c;
        if (index < list.length) cards.push(card(list[index], cardWidth, index === selectedIndex, bodyRows, frame));
      }
      for (let i = 0; i < cards[0].length; i++) out.push(cards.map((lines) => lines[i]).join(' '));
    }
    if (rowsOfCards > firstRow + maxCardRows) out.push(line([[`  … ${list.length - (firstRow + maxCardRows) * columns} más abajo`, st.dim]], W));
  }
  while (out.length < H - 1) out.push('');
  out.length = H - 1;
  out.push(st.dim(line([[' ↑↓ elegir   Enter detalle   a todos/recientes   q salir   ·   artifacts/agent-runs/', null]], W)));
  return out;
}

function detailLines(run, W) {
  const out = [];
  const steps = run.steps.filter((s) => !(s.kind === 'think' && (s.reasoning ?? 0) < 1000 && !s.detail));
  for (const step of steps) {
    if (step.kind === 'result') continue;
    const s = stepSegments(step);
    out.push(' ' + rightAlign(s.left, s.right, W - 2));
  }
  if (run.status !== 'running') {
    out.push('');
    const ok = run.status === 'ok';
    out.push(line([[ok ? ' ✓ Terminado' : ' ✗ Falló', ok ? st.green : st.red], [`  ·  ${duration(run.elapsed)}  ·  ${tokens(run.tokens)} tokens (${tokens(run.cached)} en caché)`, st.dim]], W));
    if (run.denied.length) out.push(line([[`   acciones denegadas: ${JSON.stringify(run.denied)}`, st.red]], W));
    if (run.response) {
      out.push(st.gray('─'.repeat(W)));
      for (const l of wrap(run.response, W - 4)) out.push('  ' + l);
    }
  } else if (run.idle > 15000) out.push(line([[` ◌ pensando… ${duration(run.idle)} sin eventos`, st.magenta]], W));
  return out;
}
function detailHeader(run, W) {
  const badgeStyle = PROVIDER_BADGE[run.providerId] ?? st.bgGray;
  return [
    st.inverse(rightAlign([[` ${run.name} `, st.bold]], [[new Date().toLocaleTimeString('es', { hour12: false }) + ' ', null]], W)),
    ' ' + badgeStyle(` ${run.provider?.label ?? run.providerId} `) + (run.roleLabel ? st.bgGray(` ${run.roleLabel} `) : '') + ' '
      + line([statusSegment(run, frame), [`   ${duration(run.elapsed)}   ${tokens(run.tokens)} tok   ${shortModel(run.model)}`, st.gray]], W - 30),
    ' ' + line([[`carpeta ${run.meta.cwd ?? relativePath(run.cwd) ?? '?'}${run.meta.branch ? '  ·  rama ' + run.meta.branch : ''}${run.conversation ? '  ·  conversación ' + run.conversation : ''}`, st.dim]], W - 2),
    ' ' + line([...activityBar(run, 24), ['  ', null], ...counters(run)], W - 2),
    st.gray('─'.repeat(W)),
  ];
}
function renderDetail() {
  const W = width(), H = height();
  const header = detailHeader(detailRun, W);
  const body = detailLines(detailRun, W);
  const room = H - header.length - 1;
  const maxScroll = Math.max(0, body.length - room);
  if (follow) scroll = maxScroll;
  scroll = Math.max(0, Math.min(scroll, maxScroll));
  const out = [...header, ...body.slice(scroll, scroll + room)];
  while (out.length < H - 1) out.push('');
  out.push(st.dim(line([[` Esc volver   ↑↓ PgUp PgDn desplazar   Fin seguir en vivo${follow ? ' (activo)' : ''}   q salir`, null]], W)));
  return out;
}

// ── Modos ──────────────────────────────────────────────────────────────────
function resolveQuery(text) {
  refresh();
  const all = [...runs.values()];
  const exact = all.filter((run) => run.name.startsWith(text));
  const partial = all.filter((run) => run.name.toLowerCase().includes(text.toLowerCase()));
  const pick = (exact.length ? exact : partial).sort((a, b) => b.lastWrite - a.lastWrite)[0];
  if (!pick) { console.error(`No encuentro una ejecución que coincida con "${text}".`); process.exit(1); }
  return pick;
}

function printTable() {
  refresh();
  const list = [...runs.values()].sort((a, b) => a.startedAt - b.startedAt);
  if (!list.length) { console.log('No hay ejecuciones registradas.'); return; }
  const W = Math.min(width(), 140);
  console.log(st.bold(line([[' Ejecución', null]], 30) + line([['Proveedor', null]], 13) + line([['Rol', null]], 15) + line([['Modelo', null]], 18) + line([['Estado', null]], 16) + line([['Duración', null]], 10) + 'Tokens'));
  console.log(st.gray('─'.repeat(W)));
  for (const run of list) {
    console.log(line([[' ' + run.name, null]], 30) + line([[run.provider?.label ?? run.providerId, null]], 13) + line([[run.roleLabel || '—', st.gray]], 15)
      + line([[shortModel(run.model), st.gray]], 18) + line([statusSegment(run, 0)], 16) + line([[duration(run.elapsed), null]], 10) + tokens(run.tokens));
  }
}

function printDetailOnce(run) {
  const W = width();
  for (const l of [...detailHeader(run, W), ...detailLines(run, W)]) console.log(l);
}

function startInteractive() {
  const stdin = process.stdin;
  const restore = () => {
    try { stdin.setRawMode(false); } catch { /* ignore */ }
    process.stdout.write('\x1b[?25h\x1b[?1049l');
    process.exit(0);
  };
  process.on('SIGINT', restore);
  process.on('SIGTERM', restore);
  process.stdout.write('\x1b[?1049h\x1b[?25l');
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  const draw = () => {
    refresh();
    refreshQuota();
    frame++;
    const lines = view === 'detail' && detailRun ? renderDetail() : renderDashboard();
    process.stdout.write('\x1b[H' + lines.map((l) => l + '\x1b[K').join('\n') + '\x1b[J');
  };
  stdin.on('data', (key) => {
    if (key === 'q' || key === '\x03') return restore();
    if (view === 'dashboard') {
      const list = shownRuns();
      const columns = width() >= 150 && list.length > 1 ? 2 : 1;
      if (key === '\x1b[A') selectedIndex = Math.max(0, selectedIndex - columns);
      else if (key === '\x1b[B') selectedIndex = Math.min(list.length - 1, selectedIndex + columns);
      else if (key === '\x1b[D') selectedIndex = Math.max(0, selectedIndex - 1);
      else if (key === '\x1b[C') selectedIndex = Math.min(list.length - 1, selectedIndex + 1);
      else if (key === 'a') { showAll = !showAll; selectedIndex = 0; }
      else if ((key === '\r' || key === '\n') && list[selectedIndex]) { detailRun = list[selectedIndex]; view = 'detail'; follow = true; }
    } else {
      const page = Math.max(1, height() - 8);
      if (key === '\x1b' || key === '\x1b[D' || key === '\x7f') { view = 'dashboard'; detailRun = null; }
      else if (key === '\x1b[A') { follow = false; scroll -= 1; }
      else if (key === '\x1b[B') { scroll += 1; }
      else if (key === '\x1b[5~') { follow = false; scroll -= page; }
      else if (key === '\x1b[6~') { scroll += page; }
      else if (key === '\x1b[F' || key === '\x1b[4~' || key === 'f') follow = true;
      else if (key === '\x1b[H' || key === '\x1b[1~') { follow = false; scroll = 0; }
    }
    draw();
  });
  process.stdout.on('resize', draw);
  draw();
  setInterval(draw, 500);
}

if (flag('list')) printTable();
else if (query && !interactive) printDetailOnce(resolveQuery(query));
else if (!interactive) { refresh(); process.stdout.write(renderDashboard().join('\n') + '\n'); }
else {
  if (query) { detailRun = resolveQuery(query); view = 'detail'; }
  startInteractive();
}
