#!/usr/bin/env node
/*
 * Puerta de permisos PreToolUse de Antigravity (agy) para este repositorio.
 * Lee la petición del hook por stdin e imprime {decision, reason}.
 *   allow -> inspección de solo lectura y verificación propia del proyecto
 *   deny  -> publicar, git de escritura, dependencias, red, borrados recursivos, navegadores visibles
 *   ask   -> todo lo demás; con toolPermission "always-proceed" se EJECUTA, por eso lo peligroso es deny
 * Las reglas deny se comprueban sobre el comando original y su forma canónica (canonicalCommand).
 * Claude Code audita y hace commit; agy nunca hace commit ni push.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// DEFAULTS_GATE y su validación duplican la sección gate de lib/config.cjs.
// Debe mantenerse sincronizado con lib/config.cjs.
const DEFAULTS_GATE = Object.freeze({
  scriptsDirs: Object.freeze(['scripts']),
  npmScripts: Object.freeze(['check', 'verify', 'build', 'dev', 'preview', 'test', 'test:*', 'check:*']),
  commands: Object.freeze([]),
  sensitivePaths: Object.freeze(['.env', 'artifacts/.cache']),
  roleScopes: Object.freeze({
    docs: Object.freeze(['^docs/', '^AGENTS\\.md$', '^CONTRIBUTING\\.md$', '^README\\.md$']),
    qa: Object.freeze(['^\\.qa-verdict\\.json$', '^artifacts/']),
    vision: Object.freeze(['^artifacts/']),
    research: Object.freeze(['^artifacts/']),
    review: Object.freeze(['^artifacts/', '^\\.qa-verdict\\.json$']),
  }),
});
const DEFAULT_WORKTREES_DIR = '.worktrees';

// Duplica findProtoKey de lib/config.cjs (la puerta es autocontenida): "__proto__" en
// cualquier nivel hace inválida la configuración.
function findProtoKey(value, prefix = '') {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findProtoKey(value[i], `${prefix}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (value === null || typeof value !== 'object') return null;
  for (const key of Object.keys(value)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (key === '__proto__') return fullPath;
    const found = findProtoKey(value[key], fullPath);
    if (found) return found;
  }
  return null;
}

// Combina gate.roleScopes por rol: un rol definido por el usuario sustituye solo a ese rol
// y null explícito le quita la restricción. Objeto sin prototipo: un rol como "constructor"
// o "__proto__" no puede resolver a una propiedad heredada.
function mergeRoleScopes(defaults, user) {
  const merged = Object.assign(Object.create(null), defaults);
  for (const [role, patterns] of Object.entries(user ?? {})) {
    if (patterns === null) delete merged[role];
    else merged[role] = patterns;
  }
  return merged;
}

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
  const protoKey = findProtoKey(raw);
  if (protoKey) {
    throw new Error(`clave no permitida "${protoKey}"`);
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
    if (userGate.commands !== undefined) {
      if (!Array.isArray(userGate.commands) || !userGate.commands.every((s) => typeof s === 'string')) {
        throw new Error('gate.commands debe ser una lista de textos');
      }
      const FORBIDDEN_COMMAND_CHARS = /[;&|<>`$()"'\r\n]/;
      for (const cmd of userGate.commands) {
        const trimmed = cmd.trim();
        const words = trimmed ? trimmed.split(/\s+/) : [];
        if (!trimmed || words.length < 2 || FORBIDDEN_COMMAND_CHARS.test(trimmed)) {
          throw new Error(`gate.commands contiene una entrada inválida "${cmd}"`);
        }
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
        if (patterns === null) continue;
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
      commands: Array.isArray(userGate.commands) ? userGate.commands : DEFAULTS_GATE.commands,
      sensitivePaths: Array.isArray(userGate.sensitivePaths) ? userGate.sensitivePaths : DEFAULTS_GATE.sensitivePaths,
      roleScopes: mergeRoleScopes(DEFAULTS_GATE.roleScopes, userGate.roleScopes),
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

function buildAllowedCommands(commands) {
  return (commands || []).map((entry) => entry.trim().toLowerCase().split(/\s+/));
}

function matchesCommandPrefix(segmentWords, allowedCommands) {
  return allowedCommands.some((prefix) => {
    if (segmentWords.length < prefix.length) return false;
    for (let i = 0; i < prefix.length; i++) {
      if (segmentWords[i] !== prefix[i]) return false;
    }
    return true;
  });
}

const DOTDOT_SEGMENT = /(?<![\w.-])\.\.(?![\w.-])/;

function buildSensitivePathsRegex(sensitivePaths) {
  if (!sensitivePaths.length) return /(?!)/;
  const patterns = sensitivePaths.map((p) => {
    const parts = p.split(/[\\/]+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return parts.join('[\\\\/]') + '(?:[.\\/]|\\b)';
  });
  return new RegExp(patterns.join('|'), 'i');
}

function buildSensitiveLeafRegex(sensitivePaths) {
  const leaves = sensitivePaths
    .map((p) => p.split(/[\\/]+/).filter(Boolean).pop())
    .filter(Boolean)
    .map((leaf) => leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!leaves.length) return /(?!)/;
  return new RegExp(`(?<![\\w.-])(?:${leaves.join('|')})(?![\\w.-])`, 'i');
}

function buildRoleScopes(roleScopesConfig) {
  const result = Object.create(null);
  for (const [role, patterns] of Object.entries(roleScopesConfig)) {
    if (patterns === null) continue;
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
const GIT_READ = /^git\s+(status|diff|log|show|rev-parse|ls-files|blame|grep)\b|^git\s+branch(?:\s+(?:-a|-r|-v|-vv|-l|--all|--remotes|--list|--verbose|--show-current|--merged|--no-merged|--contains|--no-contains|--points-at|--sort=\S+|--format=\S+|--color|--no-color|--column|--no-column))*\s*$/i;
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

function relativeToWorkspace(target, workspaces = [], repoRoot = '') {
  const normalized = String(target ?? '').replace(/\\/g, '/');
  for (const root of workspaces) {
    const base = String(root).replace(/\\/g, '/').replace(/\/$/, '');
    if (base && normalized.toLowerCase().startsWith(base.toLowerCase() + '/')) return normalized.slice(base.length + 1);
  }
  const normRepo = String(repoRoot ?? '').replace(/\\/g, '/').replace(/\/$/, '');
  if (normRepo && normalized.toLowerCase().startsWith(normRepo.toLowerCase() + '/')) {
    return normalized.slice(normRepo.length + 1);
  }
  if (normalized && !/^(?:[a-z]:|\/)/i.test(normalized) && normalized !== '..' && !normalized.startsWith('../')) {
    return normalized;
  }
  return null;
}

function decideEdit(payload, role, roleScopes, repoRoot, worktreesDir, sensitiveRegex) {
  const args = payload.toolCall.args ?? {};
  const target = args.Path ?? args.TargetFile ?? args.AbsolutePath ?? args.FilePath ?? args.File ?? args.path;
  const rawTarget = target;
  // Normaliza "..", "." y separadores sin resolver contra el directorio actual: path.resolve tomaría
  // "C:/…" por relativa en Linux y lo antepondría el cwd.
  const normalizedTarget = rawTarget == null ? rawTarget : path.posix.normalize(String(rawTarget).replace(/\\/g, '/'));
  let relative = relativeToWorkspace(normalizedTarget, payload.workspacePaths, repoRoot, worktreesDir);
  if (relative && (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative))) {
    relative = null;
  }
  if (sensitiveRegex.test(relative ?? '') || sensitiveRegex.test(String(normalizedTarget ?? '').replace(/\\/g, '/'))) {
    return { decision: 'deny', reason: 'Ruta sensible (.env o perfiles de navegador): no se edita.' };
  }
  const scope = roleScopes[role];
  if (!scope) return { decision: 'ask', reason: 'Edición sin restricción de rol.' };
  if (relative && scope.some((pattern) => pattern.test(relative))) return { decision: 'allow', reason: `Edición dentro del ámbito del rol ${role}.` };
  return { decision: 'deny', reason: `El rol ${role} no puede modificar ${relative ?? normalizedTarget ?? 'esa ruta'}; repórtalo en tu entrega en lugar de editarlo.` };
}

const GIT_GLOBAL_OPTIONS = /\bgit((?:\s+(?:-C|-c)\s*(?:"[^"]*"|'[^']*'|[^\s"']+)|\s+(?:--git-dir|--work-tree|--namespace|--exec-path|--config-env)(?:=|\s+)(?:"[^"]*"|'[^']*'|[^\s"']+)|\s+(?:--no-pager|--paginate|-p|-P|--bare|--no-replace-objects|--literal-pathspecs|--no-optional-locks))*)(?=\s)/gi;

// Forma canónica de un comando, solo para las reglas deny (nunca para permitir):
// quita extensiones de ejecutable, las opciones globales de git, las comillas y los espacios repetidos.
// Dos pasadas: la primera respeta los argumentos entre comillas (git -C "C:/a b" push) y la segunda,
// ya sin comillas, alcanza los programas entrecomillados (& "git.exe" push).
function canonicalCommand(command) {
  const pass = (text) => text.replace(/\b([\w-]+)\.(exe|cmd|bat|ps1)\b/gi, '$1').replace(GIT_GLOBAL_OPTIONS, 'git');
  return pass(pass(String(command ?? '')).replace(/["']/g, '')).replace(/\s+/g, ' ');
}

// Normaliza "." y ".." en cada palabra que parezca una ruta, para que las rutas sensibles no se esquiven.
function normalizePathTokens(text) {
  return String(text).replace(/"[^"]*"|'[^']*'|(?:\\ |` |[^\s'"`(),;|&])+/g, (token) => {
    if (token[0] === '"' || token[0] === "'") {
      const inner = token.slice(1, -1);
      return /[\\/]/.test(inner) ? token[0] + path.posix.normalize(inner.replace(/\\/g, '/')) + token[0] : token;
    }
    const unescaped = token.replace(/[\\`] /g, ' ');
    return /[\\/]/.test(unescaped) ? path.posix.normalize(unescaped.replace(/\\/g, '/')) : token;
  });
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
  const allowedCommands = buildAllowedCommands(gate.commands);
  const sensitiveRegex = buildSensitivePathsRegex(gate.sensitivePaths);
  const sensitiveLeafRegex = buildSensitiveLeafRegex(gate.sensitivePaths);
  const roleScopes = buildRoleScopes(gate.roleScopes);

  const tool = payload?.toolCall?.name ?? '';
  const role = String(env.AGY_ROLE ?? '').trim();
  if (/^browser_/i.test(tool)) return { decision: 'deny', reason: 'Subagente/herramientas de navegador deshabilitados: usar pruebas headless del repo.' };
  if (EDIT_TOOLS.test(tool)) return decideEdit(payload, role, roleScopes, repoRoot, worktreesDir, sensitiveRegex);
  if (tool !== 'run_command') return { decision: 'ask', reason: 'Herramienta no cubierta por la política.' };

  const command = String(payload.toolCall.args?.CommandLine ?? '').trim();
  if (!command) return { decision: 'ask', reason: 'Comando vacío.' };

  const denyRules = [
    [/\bgit\s+(push|commit|merge|rebase|reset|checkout|switch|restore|tag|remote|add|rm|mv|stash|cherry-pick|revert|am|apply|clean|worktree|update-ref|symbolic-ref|update-index|read-tree|commit-tree|config|fetch|pull|clone|submodule|init|gc|prune|reflog|filter-branch|filter-repo|notes|replace|branch\s+-[dDmMfc])\b/i,
      'Git que modifica el índice, el historial o las ramas: solo lo hace Claude tras auditar.'],
    [/\bgit\s+branch\b[^|;&]*?\s(?:-[a-z]*[dmcfu][a-z]*|--(?:delete|move|copy|force|set-upstream-to|set-upstream|unset-upstream|edit-description|track|no-track))(?=[\s=]|$)/i,
      'Git que modifica el índice, el historial o las ramas: solo lo hace Claude tras auditar.'],
    [/\bnpm(?:\s+--?[\w-]+(?:[= ](?!-)[^\s|;&]+)?)*\s+(i|in|ins|inst|insta|instal|install|isnt|isnta|isntal|isntall|add|ci|clean-install|ic|install-clean|isntall-clean|it|install-test|cit|install-ci-test|uninstall|unlink|remove|rm|r|un|update|up|upgrade|udpate|publish|link|ln|exec|x|dedupe|ddp|prune|rebuild|rb)\b|\bnpx\b|\bpnpm\b|\byarn\b/i, 'Cambios de dependencias o ejecución de paquetes no auditados.'],
    [/\b(curl|wget|invoke-webrequest|iwr|invoke-restmethod|irm|ssh|scp)\b/i, 'Acceso de red no permitido en tareas de código.'],
    [/(?:^|[\s"'(&|;])rm\s(?:[^|;&]*\s)?(?:-[a-z]*r[a-z]*|--recursive)\b/i, 'Borrado recursivo bloqueado.'],
    [/(?:^|[\s"'(&|;])(?:remove-item|ri|del|erase|rd|rmdir)\s(?:[^|;&]*\s)?(?:-r\w*|\/s)\b/i, 'Borrado recursivo bloqueado.'],
    [/\bformat-volume\b/i, 'Borrado recursivo bloqueado.'],
    [/\b(invoke-expression|iex|add-type|set-executionpolicy|reg\s+add|setx)\b/i, 'Ejecución dinámica o cambio de sistema bloqueado.'],
    [/(?:^|[\s;|&("'])(?:start-process|saps)\b|(?:^|[;|&(]\s*|\/[ckr]\s+|-c(?:ommand)?\s+["']?)start\s/i,
      'Start-Process lanza otro programa fuera de la política: ejecuta el comando directamente.'],
    [/\b(chrome|msedge|firefox)(\.exe)?\b(?![^|;]*--headless)/i, 'Navegador visible prohibido: usa las pruebas headless del proyecto.'],
    [sensitiveRegex, 'Ruta sensible (.env o perfiles de navegador).'],
  ];

  const canonical = canonicalCommand(command);
  const normCommand = normalizePathTokens(command);
  const normCanonical = normalizePathTokens(canonical);
  for (const [pattern, reason] of denyRules) {
    if (pattern.test(command) || pattern.test(canonical) || pattern.test(normCommand) || pattern.test(normCanonical)) {
      return { decision: 'deny', reason };
    }
  }
  if ([command, canonical].some((c) => DOTDOT_SEGMENT.test(c) && sensitiveLeafRegex.test(c))) {
    return { decision: 'deny', reason: 'Ruta con .. hacia una ruta sensible (gate.sensitivePaths).' };
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

  const segments = command.split(/\s*(?:\|\||&&|;|\||&|\r?\n)\s*/).filter(Boolean);
  const safe = segments.every((segment) => {
    const word = segment.split(/\s+/)[0].toLowerCase().replace(/^\((get-location|get-item)\)\.\w+$/, '$1');
    const segmentWords = segment.trim().toLowerCase().split(/\s+/);
    return READ_ONLY.has(word) || GIT_READ.test(segment) || nodeScriptRegex.test(segment) || npmRunRegex.test(segment) || matchesCommandPrefix(segmentWords, allowedCommands);
  });

  return safe
    ? { decision: 'allow', reason: 'Lectura o verificación del proyecto.' }
    : { decision: 'ask', reason: 'Comando fuera de la lista segura.' };
}

function decideCodex(payload, env = process.env, repoRootOverride = null) {
  const toolName = String(payload?.tool_name ?? '');
  const lower = toolName.toLowerCase();
  if (lower === 'bash') {
    return decide({
      toolCall: {
        name: 'run_command',
        args: { CommandLine: String(payload.tool_input?.command ?? '') },
      },
      workspacePaths: payload.cwd ? [payload.cwd] : [],
    }, env, repoRootOverride);
  }

  if (lower === 'apply_patch') {
    const text = String(payload.tool_input?.command ?? '');
    const r1 = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
    const r2 = /^\*\*\* Move to: (.+)$/gm;
    const matches = [...text.matchAll(r1), ...text.matchAll(r2)].sort((a, b) => a.index - b.index);
    const paths = matches.map((m) => m[1].trim());

    if (!paths.length) {
      return { decision: 'deny', reason: 'Parche de Codex sin rutas reconocibles.' };
    }

    for (const ruta of paths) {
      // Ruta absoluta (POSIX o con unidad de Windows) tal cual; relativa, unida al cwd de Codex. Sin path.resolve
      // por la misma razón que en decideEdit.
      const rutaPosix = ruta.replace(/\\/g, '/');
      const base = String(payload.cwd ?? process.cwd()).replace(/\\/g, '/');
      const absoluta = /^(?:\/|[A-Za-z]:\/)/.test(rutaPosix) ? path.posix.normalize(rutaPosix) : path.posix.join(base, rutaPosix);
      const res = decide({
        toolCall: { name: 'write_to_file', args: { TargetFile: absoluta } },
        workspacePaths: payload.cwd ? [payload.cwd] : [],
      }, env, repoRootOverride);
      if (res.decision === 'deny') return res;
    }

    return { decision: 'ask', reason: 'Edición de Codex dentro del ámbito.' };
  }

  if (lower.startsWith('mcp__')) {
    return {
      decision: 'deny',
      reason: 'Herramientas MCP deshabilitadas para agentes de relevo (sin control del escritorio ni navegadores): usa los comandos del proyecto.',
    };
  }

  return { decision: 'ask', reason: 'Herramienta de Codex no cubierta por la política.' };
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let result;
    let payload = {};
    let isCodex = false;
    try {
      payload = JSON.parse(input || '{}');
      isCodex = payload.hook_event_name === 'PreToolUse' && typeof payload.tool_name === 'string';
      result = isCodex ? decideCodex(payload) : decide(payload);
    } catch {
      result = { decision: 'ask', reason: 'No se pudo interpretar la petición.' };
    }

    if (process.env.AGY_GATE_LOG !== '0') {
      try {
        const logEntry = isCodex
          ? {
              at: new Date().toISOString(),
              provider: 'codex',
              conversation: payload.session_id,
              role: process.env.AGY_ROLE ?? null,
              tool: payload.tool_name,
              command: payload.tool_input?.command ?? payload.tool_input?.code,
              decision: result.decision,
            }
          : {
              at: new Date().toISOString(),
              provider: 'agy',
              conversation: payload.conversationId,
              role: process.env.AGY_ROLE ?? null,
              tool: payload.toolCall?.name,
              command: payload.toolCall?.args?.CommandLine ?? payload.toolCall?.args?.Path ?? payload.toolCall?.args?.TargetFile,
              decision: result.decision,
            };
        require('node:fs').appendFileSync(require('node:path').join(__dirname, 'gate.log'), JSON.stringify(logEntry) + '\n');
      } catch { /* Logging must never change the decision. */ }
    }

    if (isCodex) {
      if (result.decision === 'deny') {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: result.reason,
          },
        }));
      } else {
        process.stdout.write('{}');
      }
    } else {
      process.stdout.write(JSON.stringify(result));
    }
  });
}

const ROLE_SCOPES = buildRoleScopes(DEFAULTS_GATE.roleScopes);

module.exports = { decide, decideCodex, ROLE_SCOPES, DEFAULTS_GATE, canonicalCommand };
