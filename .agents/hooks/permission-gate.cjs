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

const fs = require('node:fs');
const path = require('node:path');

// DEFAULTS_GATE y su validación duplican la sección gate de lib/config.cjs.
// Debe mantenerse sincronizado con lib/config.cjs.
const DEFAULTS_GATE = Object.freeze({
  scriptsDirs: Object.freeze(['scripts']),
  npmScripts: Object.freeze(['check', 'verify', 'build', 'dev', 'preview', 'test', 'test:*', 'check:*']),
  sensitivePaths: Object.freeze(['.env', 'artifacts/.cache']),
  roleScopes: Object.freeze({
    docs: Object.freeze(['^docs/', '^AGENTS\\.md$', '^CONTRIBUTING\\.md$', '^README\\.md$']),
    qa: Object.freeze(['^\\.qa-verdict\\.json$', '^artifacts/', '\\.qa-bak$', '^src/', '^scripts/', '^test/']),
    vision: Object.freeze(['^artifacts/']),
    research: Object.freeze(['^artifacts/']),
    review: Object.freeze(['^artifacts/', '^\\.qa-verdict\\.json$']),
  }),
});
const DEFAULT_WORKTREES_DIR = '.worktrees';

function loadGateConfig(repoRoot) {
  const configFile = path.join(repoRoot, 'relevo.config.json');
  if (!fs.existsSync(configFile)) {
    return {
      gate: DEFAULTS_GATE,
      worktreesDir: DEFAULT_WORKTREES_DIR,
    };
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (err) {
    throw new Error(`error al analizar JSON: ${err.message}`);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('el contenido raíz debe ser un objeto');
  }

  let gate = DEFAULTS_GATE;
  if (raw.gate !== undefined) {
    if (raw.gate === null || typeof raw.gate !== 'object' || Array.isArray(raw.gate)) {
      throw new Error('gate debe ser un objeto');
    }
    const userGate = raw.gate;
    if (userGate.scriptsDirs !== undefined) {
      if (!Array.isArray(userGate.scriptsDirs) || !userGate.scriptsDirs.every((s) => typeof s === 'string')) {
        throw new Error('gate.scriptsDirs debe ser una lista de textos');
      }
    }
    if (userGate.npmScripts !== undefined) {
      if (!Array.isArray(userGate.npmScripts) || !userGate.npmScripts.every((s) => typeof s === 'string')) {
        throw new Error('gate.npmScripts debe ser una lista de textos');
      }
    }
    if (userGate.sensitivePaths !== undefined) {
      if (!Array.isArray(userGate.sensitivePaths) || !userGate.sensitivePaths.every((s) => typeof s === 'string')) {
        throw new Error('gate.sensitivePaths debe ser una lista de textos');
      }
    }
    if (userGate.roleScopes !== undefined) {
      if (typeof userGate.roleScopes !== 'object' || Array.isArray(userGate.roleScopes) || userGate.roleScopes === null) {
        throw new Error('gate.roleScopes debe ser un objeto');
      }
      for (const [role, patterns] of Object.entries(userGate.roleScopes)) {
        if (!Array.isArray(patterns) || !patterns.every((p) => typeof p === 'string')) {
          throw new Error(`gate.roleScopes.${role} debe ser una lista de textos`);
        }
        for (const pattern of patterns) {
          try {
            new RegExp(pattern);
          } catch (e) {
            throw new Error(`gate.roleScopes.${role} contiene un patrón inválido "${pattern}": ${e.message}`);
          }
        }
      }
    }

    gate = {
      scriptsDirs: Array.isArray(userGate.scriptsDirs) ? userGate.scriptsDirs : DEFAULTS_GATE.scriptsDirs,
      npmScripts: Array.isArray(userGate.npmScripts) ? userGate.npmScripts : DEFAULTS_GATE.npmScripts,
      sensitivePaths: Array.isArray(userGate.sensitivePaths) ? userGate.sensitivePaths : DEFAULTS_GATE.sensitivePaths,
      roleScopes: (userGate.roleScopes && typeof userGate.roleScopes === 'object' && !Array.isArray(userGate.roleScopes))
        ? { ...userGate.roleScopes }
        : DEFAULTS_GATE.roleScopes,
    };
  }

  if (raw.worktreesDir !== undefined && (typeof raw.worktreesDir !== 'string' || !raw.worktreesDir.trim())) {
    throw new Error('worktreesDir debe ser un texto');
  }
  const worktreesDir = typeof raw.worktreesDir === 'string' && raw.worktreesDir.trim() ? raw.worktreesDir : DEFAULT_WORKTREES_DIR;

  return { gate, worktreesDir };
}

function buildNodeScriptRegex(scriptsDirs) {
  const dirs = scriptsDirs.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\\/]/g, '[\\\\/]'));
  const dirsPattern = dirs.join('|');
  return new RegExp(`^node\\s+(\\.[\\\\/])?(?:${dirsPattern})[\\\\/][\\w.\\-\\\\/]+\\.(c|m)?js(\\s+--?[\\w=.\\-:]+)*$`, 'i');
}

function buildNpmRunRegex(npmScripts) {
  const testPatterns = [];
  const otherPatterns = [];
  for (const script of npmScripts) {
    let pat;
    if (script.endsWith('*')) {
      const base = script.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      pat = `${base}[\\w:\\-]+`;
    } else {
      pat = script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    if (script === 'test' || /^test[:*]/.test(script)) {
      testPatterns.push(pat);
    } else {
      otherPatterns.push(pat);
    }
  }
  const parts = [];
  if (testPatterns.length) {
    parts.push(`(?:run\\s+)?(?:${testPatterns.join('|')})`);
  }
  if (otherPatterns.length) {
    parts.push(`run\\s+(?:${otherPatterns.join('|')})`);
  }
  const body = parts.length > 1 ? `(?:${parts.join('|')})` : parts[0] || 'run\\s+[\\w:\\-]+';
  return new RegExp(`^npm(?:\\.cmd)?\\s+${body}(\\s+--\\s+[\\w=.\\-:\\s]+)?$`, 'i');
}

function buildSensitivePathsRegex(sensitivePaths) {
  if (!sensitivePaths.length) return /(?!)/;
  const patterns = sensitivePaths.map((p) => {
    const parts = p.split(/[\\/]+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return parts.join('[\\\\/]') + '(?:[.\\/]|\\b)';
  });
  return new RegExp(patterns.join('|'), 'i');
}

function buildRoleScopes(roleScopesConfig) {
  const result = {};
  for (const [role, patterns] of Object.entries(roleScopesConfig)) {
    result[role] = patterns.map((p) => new RegExp(p));
  }
  return result;
}

const READ_ONLY = new Set([
  'get-content', 'gc', 'cat', 'type', 'select-string', 'sls', 'get-childitem', 'gci', 'ls', 'dir',
  'get-location', 'pwd', 'test-path', 'measure-object', 'select-object', 'sort-object', 'where-object',
  'get-item', 'resolve-path', 'split-path', 'join-path', 'rg', 'findstr', 'head', 'tail', 'wc', 'echo',
  'write-output', 'format-list', 'format-table', 'out-string', 'get-filehash',
]);
const GIT_READ = /^git\s+(status|diff|log|show|branch|rev-parse|ls-files|blame|grep)\b/i;
const EDIT_TOOLS = /^(edit_file|write_to_file|write_file|replace_file_content|multi_replace_file_content|sed_file|notebook_edit)$/;

function getMainRoot(repoRoot, worktreesDir = '.worktrees') {
  const normRepo = repoRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const normWd = (worktreesDir || '.worktrees').replace(/^[\\/]+|[\\/]+$/g, '').replace(/\\/g, '/');
  const escapedWd = normWd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = normRepo.match(new RegExp(`^(.*)/${escapedWd}/[^/]+$`, 'i'));
  return match ? match[1] : null;
}

function normalizePath(p) {
  return String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isInsideAny(targetPath, allowedRoots) {
  const normTarget = normalizePath(targetPath);
  for (const root of allowedRoots) {
    const normRoot = normalizePath(root);
    if (normTarget === normRoot || normTarget.startsWith(normRoot + '/')) return true;
  }
  return false;
}

function relativeToWorkspace(target, workspaces = [], repoRoot = '', worktreesDir = '.worktrees') {
  const normalized = String(target ?? '').replace(/\\/g, '/');
  for (const root of workspaces) {
    const base = String(root).replace(/\\/g, '/').replace(/\/$/, '');
    if (base && normalized.toLowerCase().startsWith(base.toLowerCase() + '/')) return normalized.slice(base.length + 1);
  }
  const normRepo = String(repoRoot ?? '').replace(/\\/g, '/').replace(/\/$/, '');
  if (normRepo && normalized.toLowerCase().startsWith(normRepo.toLowerCase() + '/')) {
    return normalized.slice(normRepo.length + 1);
  }
  // Instalada en <repo>/.agents/hooks/: el nombre de la carpeta del repositorio sirve de marcador.
  const base = path.basename(repoRoot) + '/';
  const marker = normalized.toLowerCase().indexOf(base.toLowerCase());
  if (marker < 0) return null;
  const wdPattern = new RegExp(`^${(worktreesDir || '.worktrees').replace(/^[\\/]+|[\\/]+$/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^/]+/`, 'i');
  return normalized.slice(marker + base.length).replace(wdPattern, '');
}

function decideEdit(payload, role, roleScopes, repoRoot, worktreesDir) {
  const scope = roleScopes[role];
  if (!scope) return { decision: 'ask', reason: 'Edición sin restricción de rol.' };
  const args = payload.toolCall.args ?? {};
  const target = args.Path ?? args.TargetFile ?? args.AbsolutePath ?? args.FilePath ?? args.File ?? args.path;
  const relative = relativeToWorkspace(target, payload.workspacePaths, repoRoot, worktreesDir);
  if (relative && scope.some((pattern) => pattern.test(relative))) return { decision: 'allow', reason: `Edición dentro del ámbito del rol ${role}.` };
  return { decision: 'deny', reason: `El rol ${role} no puede modificar ${relative ?? target ?? 'esa ruta'}; repórtalo en tu entrega en lugar de editarlo.` };
}

function decide(payload, env = process.env, repoRootOverride = null) {
  const repoRoot = repoRootOverride || path.resolve(__dirname, '../..');
  let loaded;
  try {
    loaded = loadGateConfig(repoRoot);
  } catch (err) {
    return { decision: 'deny', reason: `Configuración inválida en relevo.config.json: ${err.message}` };
  }

  const { gate, worktreesDir } = loaded;
  const nodeScriptRegex = buildNodeScriptRegex(gate.scriptsDirs);
  const npmRunRegex = buildNpmRunRegex(gate.npmScripts);
  const sensitiveRegex = buildSensitivePathsRegex(gate.sensitivePaths);
  const roleScopes = buildRoleScopes(gate.roleScopes);

  const tool = payload?.toolCall?.name ?? '';
  const role = String(env.AGY_ROLE ?? '').trim();
  if (/^browser_/i.test(tool)) return { decision: 'deny', reason: 'Subagente/herramientas de navegador deshabilitados: usar pruebas headless del repo.' };
  if (EDIT_TOOLS.test(tool)) return decideEdit(payload, role, roleScopes, repoRoot, worktreesDir);
  if (tool !== 'run_command') return { decision: 'ask', reason: 'Herramienta no cubierta por la política.' };

  const command = String(payload.toolCall.args?.CommandLine ?? '').trim();
  if (!command) return { decision: 'ask', reason: 'Comando vacío.' };

  const denyRules = [
    [/\bgit\s+(push|commit|merge|rebase|reset|checkout|switch|restore|tag|remote|add|rm|mv|stash|cherry-pick|revert|am|apply|clean|worktree|branch\s+-[dDmMfc])\b/i,
      'Git que modifica el índice, el historial o las ramas: solo lo hace Claude tras auditar.'],
    [/\bnpm\s+(i|install|ci|uninstall|update|publish|link|exec)\b|\bnpx\b|\bpnpm\b|\byarn\b/i, 'Cambios de dependencias o ejecución de paquetes no auditados.'],
    [/\b(curl|wget|invoke-webrequest|iwr|invoke-restmethod|irm|ssh|scp)\b/i, 'Acceso de red no permitido en tareas de código.'],
    [/\b(rm\s+-\w*r\w*|remove-item\b[^|;]*-recurse|rmdir\s+\/s|del\s+\/s|format-volume)\b/i, 'Borrado recursivo bloqueado.'],
    [/\b(invoke-expression|iex|add-type|set-executionpolicy|reg\s+add|setx)\b/i, 'Ejecución dinámica o cambio de sistema bloqueado.'],
    [/\b(chrome|msedge|firefox)(\.exe)?\b(?![^|;]*--headless)/i, 'Navegador visible prohibido: usar scripts/lib/browser.cjs (headless).'],
    [sensitiveRegex, 'Ruta sensible (.env o perfiles de navegador).'],
  ];

  for (const [pattern, reason] of denyRules) {
    if (pattern.test(command)) return { decision: 'deny', reason };
  }

  if (/[>`]|\$\(|\.\.[\\/]\.\./.test(command)) {
    return { decision: 'ask', reason: 'Redirección, subexpresión o ruta fuera del repositorio.' };
  }

  const allowedRoots = [repoRoot];
  const mainRoot = getMainRoot(repoRoot, worktreesDir);
  if (mainRoot) allowedRoots.push(mainRoot);
  if (Array.isArray(payload?.workspacePaths)) {
    allowedRoots.push(...payload.workspacePaths);
  }

  const absoluteMatches = command.match(/[a-z]:[\\/][^\s"'`|;&<>]*/gi);
  if (absoluteMatches) {
    for (const match of absoluteMatches) {
      if (!isInsideAny(match, allowedRoots)) {
        return { decision: 'ask', reason: 'Redirección, subexpresión o ruta fuera del repositorio.' };
      }
    }
  }

  const segments = command.split(/\s*(?:\|\||&&|;|\|)\s*/).filter(Boolean);
  const safe = segments.every((segment) => {
    const word = segment.split(/\s+/)[0].toLowerCase().replace(/^\((get-location|get-item)\)\.\w+$/, '$1');
    return READ_ONLY.has(word) || GIT_READ.test(segment) || nodeScriptRegex.test(segment) || npmRunRegex.test(segment);
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

const ROLE_SCOPES = buildRoleScopes(DEFAULTS_GATE.roleScopes);

module.exports = { decide, ROLE_SCOPES, DEFAULTS_GATE };
