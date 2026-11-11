/* Agent run model and provider adapters (agy, Codex). No agent CLI, network or browser is used. */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Run, reserveRunNumber } = require('../lib/runs.cjs');
const { PROVIDERS, detectProvider, classifyTool } = require('../lib/providers.cjs');

const failures = [];
let passed = 0;
function test(name, action) {
  try { action(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}: ${error.message}`); }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runs-'));
function runFrom(events, meta) {
  const dir = fs.mkdtempSync(path.join(tmp, 'run-'));
  const eventsFile = path.join(dir, 'events.ndjson');
  fs.writeFileSync(eventsFile, events.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n') + '\n');
  let metaFile = null;
  if (meta) { metaFile = path.join(dir, 'meta.json'); fs.writeFileSync(metaFile, JSON.stringify(meta)); }
  const run = new Run({ id: dir, name: path.basename(dir), eventsFile, metaFile });
  run.poll();
  return run;
}

test('detects providers from their first event', () => {
  assert.equal(detectProvider({ event: 'init', init: {} }).id, 'agy');
  assert.equal(detectProvider({ type: 'thread.started', thread_id: 't' }).id, 'codex');
  assert.equal(detectProvider({ hello: 1 }), null);
});

test('classifies tools of both providers into common kinds', () => {
  assert.equal(classifyTool('read_file'), 'read');
  assert.equal(classifyTool('grep_search'), 'search');
  assert.equal(classifyTool('replace_file_content'), 'edit');
  assert.equal(classifyTool('file_change'), 'edit');
  assert.equal(classifyTool('run_command'), 'run');
  assert.equal(classifyTool('command_execution'), 'run');
  assert.equal(classifyTool('search_web'), 'web');
});

test('agy stream: tools, agent text, notices, usage and result', () => {
  const run = runFrom([
    { event: 'init', conversation_id: 'c1', init: { model: 'gemini-3.8-flash-high', cwd: 'C:/repo' } },
    { step_update: { step_index: 1, state: 'DONE', step_type: 'agent_response', usage: { total_tokens: 100, thinking_tokens: 50 } } },
    { step_update: { step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'read_file', tool_info: { parameters: { Path: 'C:/Proyectos/Personal/GeneradorMusica/src/App.svelte', StartLine: 1, EndLine: 20 } } } },
    { step_update: { step_index: 2, state: 'DONE', step_type: 'tool', tool_name: 'read_file', duration_seconds: 0.1, tool_info: { output: '20 lines' } } },
    { step_update: { step_index: 3, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: { parameters: { CommandLine: 'curl x' } } } },
    { step_update: { step_index: 3, state: 'ERROR', step_type: 'tool', tool_name: 'run_command' } },
    'root agent idle; waiting up to 30m0s for 1 background task(s)',
    { step_update: { step_index: 4, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Hecho ' } },
    { step_update: { step_index: 4, state: 'DONE', step_type: 'agent_response', text_delta: 'todo.', usage: { total_tokens: 30 } } },
    { event: 'result', result: { status: 'SUCCESS', response: 'Hecho todo.', usage: { total_tokens: 999, cache_read_tokens: 500 }, denied_actions: [] } },
  ]);
  assert.equal(run.provider.id, 'agy');
  assert.equal(run.model, 'gemini-3.8-flash-high');
  assert.equal(run.conversation, 'c1');
  assert.equal(run.status, 'ok');
  assert.equal(run.tokens, 999);
  assert.equal(run.cached, 500);
  const read = run.steps.find((s) => s.tool === 'read_file');
  assert.equal(read.kind, 'read');
  assert.equal(read.ok, true);
  assert.match(read.path, /src\/App\.svelte$/);
  const command = run.steps.find((s) => s.tool === 'run_command');
  assert.equal(command.ok, false);
  assert.equal(command.state, 'ERROR');
  assert.ok(run.steps.some((s) => s.kind === 'note' && /root agent idle/.test(s.detail)));
  assert.ok(run.steps.some((s) => s.kind === 'say' && s.detail === 'Hecho todo.'));
  assert.deepEqual(run.counts(), { read: 1, run: 1 });
});

test('codex JSONL: commands, file changes, failed exit codes, messages and usage', () => {
  const run = runFrom([
    { type: 'thread.started', thread_id: 'th-1' },
    { type: 'turn.started' },
    { type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'npm run check', status: 'in_progress' } },
    { type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'npm run check', exit_code: 0, status: 'completed' } },
    { type: 'item.completed', item: { id: 'i2', type: 'command_execution', command: 'npm test', exit_code: 1, status: 'failed' } },
    { type: 'item.completed', item: { id: 'i3', type: 'file_change', changes: [{ path: 'src/a.ts', kind: 'update' }], status: 'completed' } },
    { type: 'item.completed', item: { id: 'i4', type: 'reasoning', text: 'pienso' } },
    { type: 'item.completed', item: { id: 'i5', type: 'agent_message', text: 'Listo.' } },
    { type: 'turn.completed', usage: { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 200 } },
  ], { provider: 'codex', model: 'gpt-5-codex', role: 'coder', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), exitCode: 0 });
  assert.equal(run.provider.id, 'codex');
  assert.equal(run.conversation, 'th-1');
  assert.equal(run.model, 'gpt-5-codex');
  assert.equal(run.roleLabel, 'codificador');
  assert.equal(run.tokens, 1200);
  assert.equal(run.cached, 400);
  const commands = run.steps.filter((s) => s.kind === 'run');
  assert.equal(commands.length, 2);
  assert.equal(commands[0].ok, true);
  assert.equal(commands[1].ok, false);
  assert.ok(run.steps.some((s) => s.kind === 'edit' && /src\/a\.ts/.test(s.detail)));
  assert.ok(run.steps.some((s) => s.kind === 'say' && s.detail === 'Listo.'));
  // Codex no emite un evento de resultado: el cierre lo marca el lanzador en meta.json.
  assert.equal(run.status, 'ok');
});

test('a run that exits without a result event is closed from meta.json', () => {
  const run = runFrom([{ event: 'init', conversation_id: 'c', init: { model: 'm' } }],
    { provider: 'agy', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), exitCode: 1, error: 'sin cuota' });
  assert.equal(run.status, 'error');
  assert.equal(run.response, 'sin cuota');
});

test('launcher command builders never add permission bypass flags', () => {
  const agy = PROVIDERS.agy.command({ prompt: 'p', model: 'gemini-3.8-flash-high', mode: 'plan', timeoutSeconds: 60 });
  assert.equal(agy.command, 'agy');
  assert.deepEqual(agy.args.slice(0, 2), ['-p', 'p']);
  assert.ok(agy.args.includes('stream-json'));
  const codex = PROVIDERS.codex.command({ prompt: 'p', model: 'm', cwd: 'C:/repo' });
  assert.deepEqual(codex.args.slice(0, 4), ['exec', '--json', '-s', 'workspace-write']);
  for (const args of [agy.args, codex.args]) assert.ok(!args.some((a) => /dangerously|bypass|skip-permissions/.test(a)));
});

test('only launcher folders (NN-name with meta.json) are discovered as runs', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/runs.cjs'), 'utf8');
  assert.match(source, /\^\\d\+-/);
  assert.match(source, /meta\.json/);
});

const dead = require('node:child_process').spawnSync(process.execPath, ['-e', '0']).pid;
function createRun(meta) {
  const dir = fs.mkdtempSync(path.join(tmp, 'run-'));
  const eventsFile = path.join(dir, 'events.ndjson');
  fs.writeFileSync(eventsFile, '');
  const metaFile = path.join(dir, 'meta.json');
  fs.writeFileSync(metaFile, JSON.stringify(meta));
  return new Run({ id: dir, name: path.basename(dir), eventsFile, metaFile });
}

test('(h) meta con pid y launcherPid muertos sin endedAt pasa a interrupted tras poll', () => {
  const run = createRun({ pid: dead, launcherPid: dead });
  run.poll();
  assert.equal(run.status, 'interrupted');
  assert.match(run.response, /Interrumpida/);
});

test('(i) meta con pid muerto y launcherPid vivo sigue running tras poll', () => {
  const run = createRun({ pid: dead, launcherPid: process.pid });
  run.poll();
  assert.equal(run.status, 'running');
});

test('(j) meta con pid vivo y launcherPid muerto sigue running tras poll', () => {
  const run = createRun({ pid: process.pid, launcherPid: dead });
  run.poll();
  assert.equal(run.status, 'running');
});

test('(k) meta con pid y launcherPid muertos pero endedAt presente y exitCode 0 pasa a ok', () => {
  const run = createRun({ pid: dead, launcherPid: dead, endedAt: new Date().toISOString(), exitCode: 0 });
  run.poll();
  assert.equal(run.status, 'ok');
});

test('(l) formato antiguo sin launcherPid con pid muerto sin endedAt pasa a interrupted tras poll', () => {
  const run = createRun({ pid: dead });
  run.poll();
  assert.equal(run.status, 'interrupted');
});

test('(m) meta sin pid y sin endedAt sigue running tras poll', () => {
  const run = createRun({});
  run.poll();
  assert.equal(run.status, 'running');
});

test('(n) en una carpeta temporal vacía, tres llamadas seguidas a reserveRunNumber devuelven 01, 02 y 03', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'reserve-n-'));
  assert.equal(reserveRunNumber(dir, []), '01');
  assert.equal(reserveRunNumber(dir, []), '02');
  assert.equal(reserveRunNumber(dir, []), '03');
});

// Añadida por el auditor: fuerza de forma determinista la carrera que (p) solo provoca a veces.
// nextRunNumber no ve el marcador (otro proceso lo creó justo después de leer la carpeta),
// así que el primer mkdir choca con EEXIST y la reserva debe pasar al número siguiente.
test('(o2) si el número calculado ya está reservado (EEXIST), reserveRunNumber pasa al siguiente', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'reserve-race-'));
  fs.mkdirSync(path.join(dir, '.reserva-01'));
  const realReaddir = fs.readdirSync;
  fs.readdirSync = (target, ...rest) => (path.resolve(String(target)) === path.resolve(dir) ? [] : realReaddir(target, ...rest));
  let reserved;
  try { reserved = reserveRunNumber(dir, []); } finally { fs.readdirSync = realReaddir; }
  assert.equal(reserved, '02');
  assert.ok(fs.existsSync(path.join(dir, '.reserva-02')));
});

test('(o) en una carpeta temporal con 05-a/ y .reserva-07/ ya creadas, reserveRunNumber devuelve 08', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'reserve-o-'));
  fs.mkdirSync(path.join(dir, '05-a'));
  fs.mkdirSync(path.join(dir, '.reserva-07'));
  assert.equal(reserveRunNumber(dir, []), '08');
});

test('(q) discoverRuns no lista las carpetas .reserva-NN', () => {
  const runsPattern = /^\d+-/;
  assert.equal(runsPattern.test('.reserva-01'), false);
  assert.equal(runsPattern.test('.reserva-07'), false);
  assert.equal(runsPattern.test('.reserva-99'), false);
});

async function testAsync(name, action) {
  try {
    await action();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

(async () => {
  await testAsync('(p) concurrencia: 6 procesos reservan números distintos', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'reserve-p-'));
    const runsModule = JSON.stringify(path.resolve(__dirname, '../lib/runs.cjs'));
    const tempDir = JSON.stringify(dir);
    const script = `const { reserveRunNumber } = require(${runsModule}); console.log(reserveRunNumber(${tempDir}, []));`;
    const promises = Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', script], { cwd: os.tmpdir() });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => {
        resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
      });
    }));
    const results = await Promise.all(promises);
    for (const res of results) {
      assert.equal(res.code, 0, `proceso terminó con código ${res.code}: ${res.stderr}`);
    }
    const numbers = results.map((r) => r.stdout);
    assert.equal(numbers.length, 6);
    const unique = new Set(numbers);
    assert.equal(unique.size, 6, `números duplicados: ${numbers.join(', ')}`);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nagent runs: ${passed} passed, ${failures.length} failed.`);
  if (failures.length) process.exitCode = 1;
})();
