/*
 * Proveedores de agentes de código: cómo se lanzan y cómo se traducen sus eventos a un formato común.
 * Cada parser recibe un evento JSON crudo y llama a métodos de `run` (ver runs.cjs):
 *   run.init({ model, conversation, cwd }), run.step(index, patch), run.say(text, meta),
 *   run.think(meta), run.usage({ total, cached }), run.finish({ status, response, denied })
 */
'use strict';

const oneLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

// ── Clasificación común de herramientas ───────────────────────────────────
function classifyTool(name) {
  if (/^(read_file|view_file|list_dir|read_resource)$/.test(name)) return 'read';
  if (/^(grep_search|find_by_name)$/.test(name)) return 'search';
  if (/(write|replace|sed_file|notebook_edit|file_change)/.test(name)) return 'edit';
  if (/^(search_web|read_url_content|web_search)$/.test(name)) return 'web';
  if (/^(run_command|send_command_input|command_execution)$/.test(name)) return 'run';
  if (/^(manage_task|command_status|wait|wait_5_seconds|schedule|todo_list)$/.test(name)) return 'wait';
  if (/subagent/.test(name)) return 'agent';
  return 'other';
}

function describeAgyTool(name, info = {}) {
  const p = info.parameters ?? {};
  if (p.CommandLine) return p.CommandLine;
  if (name === 'search_web') return '“' + oneLine(p.Query ?? p.query ?? '') + '”';
  if (p.Url || p.url) return String(p.Url ?? p.url).replace(/^https?:\/\//, '');
  const target = p.Path ?? p.AbsolutePath ?? p.TargetFile ?? p.FilePath ?? p.SearchPath ?? p.DirectoryPath;
  if (target) {
    const range = p.StartLine ? ` :${p.StartLine}-${p.EndLine ?? ''}` : '';
    const needle = p.Query ? `  “${oneLine(p.Query)}”` : p.Pattern ? `  “${oneLine(p.Pattern)}”` : '';
    return { path: target, suffix: range + needle };
  }
  if (p.Action) return `${p.Action}${p.TaskId ? ' ' + p.TaskId : ''}`;
  const first = Object.entries(p).find(([, value]) => typeof value === 'string');
  return first ? `${first[0]}: ${first[1]}` : '';
}

// ── Antigravity CLI (agy --output-format stream-json) ─────────────────────
const agy = {
  id: 'agy',
  label: 'Antigravity',
  verified: true,
  detect: (event) => event?.event === 'init' || Boolean(event?.step_update) || event?.event === 'result',
  command({ prompt, model, mode, conversation, agent, timeoutSeconds }) {
    const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--print-timeout', `${timeoutSeconds}s`];
    if (model) args.push('--model', model);
    if (mode) args.push('--mode', mode);
    if (conversation) args.push('--conversation', conversation);
    if (agent) args.push('--agent', agent);
    args.push('-p=');
    const input = JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n';
    return { command: 'agy', args, input };
  },
  createParser() {
    const pending = new Map();
    return (event, run) => {
      if (event.event === 'init') {
        run.init({ model: event.init?.model, conversation: event.conversation_id, cwd: event.init?.cwd });
        return;
      }
      if (event.event === 'result') {
        const r = event.result ?? {};
        run.usage({ total: r.usage?.total_tokens, cached: r.usage?.cache_read_tokens, absolute: true });
        run.finish({ status: r.status === 'SUCCESS' ? 'ok' : 'error', response: r.response, denied: r.denied_actions });
        return;
      }
      const u = event.step_update;
      if (!u) return;
      if (u.step_type === 'agent_response') {
        if (u.text_delta) pending.set(u.step_index, (pending.get(u.step_index) ?? '') + u.text_delta);
        if (u.state === 'DONE') {
          run.usage({ total: u.usage?.total_tokens, cached: u.usage?.cache_read_tokens });
          const text = pending.get(u.step_index) ?? '';
          pending.delete(u.step_index);
          if (oneLine(text)) run.say(text, { seconds: u.duration_seconds });
          else run.think({ seconds: u.duration_seconds, reasoning: u.usage?.thinking_tokens });
        }
        return;
      }
      if (u.step_type !== 'tool') return;
      const name = u.tool_name ?? u.tool_info?.name ?? 'tool';
      const described = describeAgyTool(name, u.tool_info);
      const patch = { kind: classifyTool(name), tool: name };
      if (typeof described === 'string') patch.detail = described; else { patch.path = described.path; patch.detail = described.suffix; }
      if (u.state === 'DONE') Object.assign(patch, { ok: true, seconds: u.duration_seconds, output: u.tool_info?.output });
      else if (u.state && u.state !== 'ACTIVE') Object.assign(patch, { ok: false, state: u.state });
      run.step(`agy:${u.step_index}`, patch);
    };
  },
};

// ── OpenAI Codex CLI (codex exec --json) ──────────────────────────────────
// Esquema según la documentación de codex exec --json; pendiente de validar con una ejecución real.
const codex = {
  id: 'codex',
  label: 'Codex',
  verified: false,
  detect: (event) => typeof event?.type === 'string' && /^(thread|turn|item)\.|^error$/.test(event.type),
  command({ prompt, model, cwd, sandbox = 'workspace-write' }) {
    const args = ['exec', '--json', '-s', sandbox];
    if (model) args.push('-m', model);
    if (cwd) args.push('-C', cwd);
    args.push(prompt);
    return { command: 'codex', args };
  },
  createParser() {
    let anonymous = 0;
    return (event, run) => {
      const item = event.item ?? {};
      switch (event.type) {
        case 'thread.started': run.init({ conversation: event.thread_id }); return;
        case 'turn.completed':
          run.usage({ total: (event.usage?.input_tokens ?? 0) + (event.usage?.output_tokens ?? 0), cached: event.usage?.cached_input_tokens });
          return;
        case 'turn.failed': run.finish({ status: 'error', response: event.error?.message }); return;
        case 'error': run.note(event.message ?? 'error', false); return;
        case 'item.started':
        case 'item.updated':
        case 'item.completed': break;
        default: return;
      }
      const done = event.type === 'item.completed';
      if (item.type === 'agent_message') { if (done) run.say(item.text ?? ''); return; }
      if (item.type === 'reasoning') { if (done) run.think({ text: item.text }); return; }
      const patch = { tool: item.type };
      if (item.type === 'command_execution') Object.assign(patch, { kind: 'run', detail: item.command, output: item.aggregated_output });
      else if (item.type === 'file_change') Object.assign(patch, { kind: 'edit', detail: (item.changes ?? []).map((c) => `${c.kind ?? ''} ${c.path}`).join(', ') });
      else if (item.type === 'web_search') Object.assign(patch, { kind: 'web', detail: '“' + oneLine(item.query) + '”' });
      else if (item.type === 'mcp_tool_call') Object.assign(patch, { kind: 'other', detail: `${item.server ?? ''}/${item.tool ?? ''}` });
      else if (item.type === 'todo_list') Object.assign(patch, { kind: 'wait', detail: `${(item.items ?? []).filter((t) => t.completed).length}/${(item.items ?? []).length} tareas` });
      else Object.assign(patch, { kind: 'other', detail: item.type });
      if (done) {
        const failed = item.status === 'failed' || (item.type === 'command_execution' && item.exit_code != null && item.exit_code !== 0);
        Object.assign(patch, { ok: !failed, state: failed ? `exit ${item.exit_code ?? 'error'}` : undefined });
      }
      run.step(`codex:${item.id ?? `anon-${anonymous++}`}`, patch);
    };
  },
};

const PROVIDERS = { agy, codex };

function detectProvider(event) {
  return Object.values(PROVIDERS).find((provider) => provider.detect(event)) ?? null;
}

module.exports = { PROVIDERS, detectProvider, classifyTool, oneLine };
