#!/usr/bin/env node
/*
 * Antigravity (agy) PreToolUse gate for this repository.
 * Reads the hook payload on stdin and prints {decision, reason}.
 *   allow -> read-only inspection and the project's own verification commands
 *   deny  -> publishing, pushing, dependency changes, network, destructive deletes, visible browsers
 *   ask   -> everything else (the human decides)
 * Claude Code audits and commits; agy never commits or pushes.
 */
'use strict';

const READ_ONLY = new Set([
  'get-content', 'gc', 'cat', 'type', 'select-string', 'sls', 'get-childitem', 'gci', 'ls', 'dir',
  'get-location', 'pwd', 'test-path', 'measure-object', 'select-object', 'sort-object', 'where-object',
  'get-item', 'resolve-path', 'split-path', 'join-path', 'rg', 'findstr', 'head', 'tail', 'wc', 'echo',
  'write-output', 'format-list', 'format-table', 'out-string', 'get-filehash',
]);
const GIT_READ = /^git\s+(status|diff|log|show|branch|rev-parse|ls-files|blame|grep)\b/i;
const NODE_SCRIPT = /^node\s+(\.[\\/])?scripts[\\/][\w.\-\\/]+\.(c|m)?js(\s+--?[\w=.\-:]+)*$/i;
const NPM_RUN = /^npm(?:\.cmd)?\s+(run\s+)?(check|verify|build|dev|preview|check:repository|test:[\w:\-]+|test)(\s+--\s+[\w=.\-:\s]+)?$/i;

const DENY = [
  [/\bgit\s+(push|commit|merge|rebase|reset|checkout|switch|restore|tag|remote|add|rm|mv|stash|cherry-pick|revert|am|apply|clean|worktree|branch\s+-[dDmMfc])\b/i,
    'Git que modifica el índice, el historial o las ramas: solo lo hace Claude tras auditar.'],
  [/\bnpm\s+(i|install|ci|uninstall|update|publish|link|exec)\b|\bnpx\b|\bpnpm\b|\byarn\b/i, 'Cambios de dependencias o ejecución de paquetes no auditados.'],
  [/\b(curl|wget|invoke-webrequest|iwr|invoke-restmethod|irm|ssh|scp)\b/i, 'Acceso de red no permitido en tareas de código.'],
  [/\b(rm\s+-\w*r\w*|remove-item\b[^|;]*-recurse|rmdir\s+\/s|del\s+\/s|format-volume)\b/i,'Borrado recursivo bloqueado.'],
  [/\b(invoke-expression|iex|add-type|set-executionpolicy|reg\s+add|setx)\b/i, 'Ejecución dinámica o cambio de sistema bloqueado.'],
  [/\b(chrome|msedge|firefox)(\.exe)?\b(?![^|;]*--headless)/i, 'Navegador visible prohibido: usar scripts/lib/browser.cjs (headless).'],
  [/\.env(\.|\b)|artifacts[\\/]\.cache/i, 'Ruta sensible (.env o perfiles de navegador).'],
];

// Ámbito de escritura por rol. El lanzador (scripts/agents/run.cjs) pasa el rol en AGY_ROLE.
// Rutas relativas a la raíz del worktree, con '/' como separador. Sin rol o 'coder': sin restricción de rutas.
const EDIT_TOOLS = /^(edit_file|write_to_file|write_file|replace_file_content|multi_replace_file_content|sed_file|notebook_edit)$/;
const ROLE_SCOPES = {
  docs: [/^docs\//, /^AGENTS\.md$/, /^CONTRIBUTING\.md$/, /^\.claude\/skills\/verificar-cambio\/SKILL\.md$/],
  // QA solo escribe su veredicto, artefactos y las copias/mutaciones temporales del procedimiento de mutación.
  qa: [/^\.qa-verdict\.json$/, /^artifacts\//, /\.qa-bak$/, /^src\//, /^scripts\//],
  vision: [/^artifacts\//],
  research: [/^artifacts\//],
  review: [/^artifacts\//, /^\.qa-verdict\.json$/],
};

function relativeToWorkspace(target, workspaces = []) {
  const normalized = String(target ?? '').replace(/\\/g, '/');
  for (const root of workspaces) {
    const base = String(root).replace(/\\/g, '/').replace(/\/$/, '');
    if (base && normalized.toLowerCase().startsWith(base.toLowerCase() + '/')) return normalized.slice(base.length + 1);
  }
  // Instalada en <repo>/.agents/hooks/: el nombre de la carpeta del repositorio sirve de marcador.
  const base = require('node:path').basename(require('node:path').resolve(__dirname, '../..')) + '/';
  const marker = normalized.toLowerCase().indexOf(base.toLowerCase());
  if (marker < 0) return null;
  return normalized.slice(marker + base.length).replace(/^\.worktrees\/[^/]+\//, '');
}

function decideEdit(payload, role) {
  const scope = ROLE_SCOPES[role];
  if (!scope) return { decision: 'ask', reason: 'Edición sin restricción de rol.' };
  const args = payload.toolCall.args ?? {};
  const target = args.Path ?? args.TargetFile ?? args.AbsolutePath ?? args.FilePath ?? args.File ?? args.path;
  const relative = relativeToWorkspace(target, payload.workspacePaths);
  if (relative && scope.some((pattern) => pattern.test(relative))) return { decision: 'allow', reason: `Edición dentro del ámbito del rol ${role}.` };
  return { decision: 'deny', reason: `El rol ${role} no puede modificar ${relative ?? target ?? 'esa ruta'}; repórtalo en tu entrega en lugar de editarlo.` };
}

function decide(payload, env = process.env) {
  const tool = payload?.toolCall?.name ?? '';
  const role = String(env.AGY_ROLE ?? '').trim();
  if (/^browser_/i.test(tool)) return { decision: 'deny', reason: 'Subagente/herramientas de navegador deshabilitados: usar pruebas headless del repo.' };
  if (EDIT_TOOLS.test(tool)) return decideEdit(payload, role);
  if (tool !== 'run_command') return { decision: 'ask', reason: 'Herramienta no cubierta por la política.' };

  const command = String(payload.toolCall.args?.CommandLine ?? '').trim();
  if (!command) return { decision: 'ask', reason: 'Comando vacío.' };
  for (const [pattern, reason] of DENY) if (pattern.test(command)) return { decision: 'deny', reason };
  if (/[>`]|\$\(|\.\.[\\/]\.\.|[a-z]:[\\/](?!proyectos[\\/]personal[\\/]generadormusica)/i.test(command)) {
    return { decision: 'ask', reason: 'Redirección, subexpresión o ruta fuera del repositorio.' };
  }
  const segments = command.split(/\s*(?:\|\||&&|;|\|)\s*/).filter(Boolean);
  const safe = segments.every((segment) => {
    const word = segment.split(/\s+/)[0].toLowerCase().replace(/^\((get-location|get-item)\)\.\w+$/, '$1');
    return READ_ONLY.has(word) || GIT_READ.test(segment) || NODE_SCRIPT.test(segment) || NPM_RUN.test(segment);
  });
  return safe
    ? { decision: 'allow', reason: 'Lectura o verificación del proyecto.' }
    : { decision: 'ask', reason: 'Comando fuera de la lista segura.' };
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let result;
    let payload = {};
    try { payload = JSON.parse(input || '{}'); result = decide(payload); }
    catch { result = { decision: 'ask', reason: 'No se pudo interpretar la petición.' }; }
    // Audit trail for the reviewing agent (gitignored). Set AGY_GATE_LOG=0 to disable.
    if (process.env.AGY_GATE_LOG !== '0') {
      try {
        require('node:fs').appendFileSync(require('node:path').join(__dirname, 'gate.log'), JSON.stringify({
          at: new Date().toISOString(), conversation: payload.conversationId, role: process.env.AGY_ROLE ?? null, tool: payload.toolCall?.name,
          command: payload.toolCall?.args?.CommandLine ?? payload.toolCall?.args?.Path ?? payload.toolCall?.args?.TargetFile, decision: result.decision,
        }) + '\n');
      } catch { /* Logging must never change the decision. */ }
    }
    process.stdout.write(JSON.stringify(result));
  });
}

module.exports = { decide, ROLE_SCOPES };
