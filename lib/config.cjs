'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  runsDir: 'artifacts/agent-runs',
  legacyRunsDirs: Object.freeze([]),
  worktreesDir: '.worktrees',
  taskBranchPrefix: 'relevo/',
  quota: Object.freeze({
    min: 0.15,
    warn: 0.3,
  }),
  gate: Object.freeze({
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
  }),
  check: Object.freeze({
    baseBranch: 'main',
    sourcePattern: '^src/',
    testPattern: '^(scripts/test-[\\w.-]+\\.cjs|test/[\\w./-]+)$',
    roadmap: null,
    decisions: null,
    verdictFile: '.qa-verdict.json',
    hardcodedColorFiles: null,
    areaSuites: Object.freeze([]),
  }),
});

function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function deepMerge(target, source) {
  const result = isPlainObject(target) ? { ...target } : {};
  if (!isPlainObject(source)) return result;
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (isPlainObject(value) && isPlainObject(target?.[key])) {
      result[key] = deepMerge(target[key], value);
    } else if (Array.isArray(value)) {
      result[key] = [...value];
    } else if (isPlainObject(value)) {
      result[key] = deepMerge({}, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function checkUnknownKeys(raw, prefix = '') {
  if (!isPlainObject(raw)) return;
  const known = {
    '': new Set(['runsDir', 'legacyRunsDirs', 'worktreesDir', 'taskBranchPrefix', 'quota', 'gate', 'check']),
    'quota': new Set(['min', 'warn']),
    'gate': new Set(['scriptsDirs', 'npmScripts', 'sensitivePaths', 'roleScopes']),
    'check': new Set(['baseBranch', 'sourcePattern', 'testPattern', 'roadmap', 'decisions', 'verdictFile', 'hardcodedColorFiles', 'areaSuites']),
    'check.decisions': new Set(['dir', 'index']),
  };
  const valid = known[prefix];
  for (const [key, val] of Object.entries(raw)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (valid && !valid.has(key)) {
      console.warn(`relevo.config.json: clave desconocida "${fullPath}"`);
    } else if (isPlainObject(val)) {
      if (prefix === '' && (key === 'quota' || key === 'gate' || key === 'check')) {
        checkUnknownKeys(val, key);
      } else if (prefix === 'check' && key === 'decisions') {
        checkUnknownKeys(val, 'check.decisions');
      }
    }
  }
}

function validateConfig(config, rawInput = config) {
  if (!isPlainObject(config)) {
    throw new Error('relevo.config.json: la configuración debe ser un objeto');
  }

  checkUnknownKeys(rawInput);

  function err(key, expected) {
    throw new Error(`relevo.config.json: ${key} debe ser ${expected}`);
  }

  function errPattern(key, pattern, message) {
    throw new Error(`relevo.config.json: ${key} contiene un patrón inválido "${pattern}": ${message}`);
  }

  if (typeof config.runsDir !== 'string' || !config.runsDir.trim()) {
    err('runsDir', 'un texto');
  }

  if (!Array.isArray(config.legacyRunsDirs) || !config.legacyRunsDirs.every((item) => typeof item === 'string')) {
    err('legacyRunsDirs', 'una lista de textos');
  }

  if (typeof config.worktreesDir !== 'string' || !config.worktreesDir.trim()) {
    err('worktreesDir', 'un texto');
  }

  if (typeof config.taskBranchPrefix !== 'string' || !config.taskBranchPrefix.trim()) {
    err('taskBranchPrefix', 'un texto');
  }

  if (!isPlainObject(config.quota)) {
    err('quota', 'un objeto');
  }
  if (typeof config.quota.min !== 'number' || Number.isNaN(config.quota.min)) {
    err('quota.min', 'un número');
  }
  if (typeof config.quota.warn !== 'number' || Number.isNaN(config.quota.warn)) {
    err('quota.warn', 'un número');
  }

  if (!isPlainObject(config.gate)) {
    err('gate', 'un objeto');
  }
  if (!Array.isArray(config.gate.scriptsDirs) || !config.gate.scriptsDirs.every((item) => typeof item === 'string')) {
    err('gate.scriptsDirs', 'una lista de textos');
  }
  if (!Array.isArray(config.gate.npmScripts) || !config.gate.npmScripts.every((item) => typeof item === 'string')) {
    err('gate.npmScripts', 'una lista de textos');
  }
  if (!Array.isArray(config.gate.sensitivePaths) || !config.gate.sensitivePaths.every((item) => typeof item === 'string')) {
    err('gate.sensitivePaths', 'una lista de textos');
  }
  if (!isPlainObject(config.gate.roleScopes)) {
    err('gate.roleScopes', 'un objeto');
  }
  for (const [role, patterns] of Object.entries(config.gate.roleScopes)) {
    if (!Array.isArray(patterns) || !patterns.every((item) => typeof item === 'string')) {
      err(`gate.roleScopes.${role}`, 'una lista de textos');
    }
    for (const pattern of patterns) {
      try {
        new RegExp(pattern);
      } catch (e) {
        errPattern(`gate.roleScopes.${role}`, pattern, e.message);
      }
    }
  }

  if (!isPlainObject(config.check)) {
    err('check', 'un objeto');
  }
  if (typeof config.check.baseBranch !== 'string') {
    err('check.baseBranch', 'un texto');
  }
  if (typeof config.check.sourcePattern !== 'string') {
    err('check.sourcePattern', 'un texto');
  }
  try {
    new RegExp(config.check.sourcePattern);
  } catch (e) {
    errPattern('check.sourcePattern', config.check.sourcePattern, e.message);
  }

  if (typeof config.check.testPattern !== 'string') {
    err('check.testPattern', 'un texto');
  }
  try {
    new RegExp(config.check.testPattern);
  } catch (e) {
    errPattern('check.testPattern', config.check.testPattern, e.message);
  }

  if (config.check.roadmap !== null && typeof config.check.roadmap !== 'string') {
    err('check.roadmap', 'un texto o null');
  }

  if (config.check.decisions !== null) {
    if (!isPlainObject(config.check.decisions)) {
      err('check.decisions', 'un objeto o null');
    }
    if (typeof config.check.decisions.dir !== 'string') {
      err('check.decisions.dir', 'un texto');
    }
    if (typeof config.check.decisions.index !== 'string') {
      err('check.decisions.index', 'un texto');
    }
  }

  if (typeof config.check.verdictFile !== 'string') {
    err('check.verdictFile', 'un texto');
  }

  if (config.check.hardcodedColorFiles !== null) {
    if (typeof config.check.hardcodedColorFiles !== 'string') {
      err('check.hardcodedColorFiles', 'un texto o null');
    }
    try {
      new RegExp(config.check.hardcodedColorFiles);
    } catch (e) {
      errPattern('check.hardcodedColorFiles', config.check.hardcodedColorFiles, e.message);
    }
  }

  if (!Array.isArray(config.check.areaSuites)) {
    err('check.areaSuites', 'una lista');
  }
  for (let i = 0; i < config.check.areaSuites.length; i++) {
    const item = config.check.areaSuites[i];
    if (!isPlainObject(item)) {
      err(`check.areaSuites[${i}]`, 'un objeto');
    }
    if (typeof item.pattern !== 'string') {
      err(`check.areaSuites[${i}].pattern`, 'un texto');
    }
    try {
      new RegExp(item.pattern);
    } catch (e) {
      errPattern(`check.areaSuites[${i}].pattern`, item.pattern, e.message);
    }
    if (!Array.isArray(item.suites) || !item.suites.every((s) => typeof s === 'string')) {
      err(`check.areaSuites[${i}].suites`, 'una lista de textos');
    }
  }

  return config;
}

function loadConfig(root) {
  const targetDir = root ?? process.cwd();
  const configFile = path.join(targetDir, 'relevo.config.json');
  if (!fs.existsSync(configFile)) {
    return structuredClone(DEFAULTS);
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (err) {
    throw new Error(`relevo.config.json: error al analizar JSON: ${err.message}`);
  }
  if (!isPlainObject(raw)) {
    throw new Error('relevo.config.json: el contenido raíz debe ser un objeto');
  }
  const merged = deepMerge(structuredClone(DEFAULTS), raw);
  validateConfig(merged, raw);
  return merged;
}

module.exports = {
  DEFAULTS,
  loadConfig,
  validateConfig,
};
