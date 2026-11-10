'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { DEFAULTS } = require('./config.cjs');
const { canonical } = require('./root.cjs');

const GITIGNORE_LINES = [
  'artifacts/agent-runs/',
  '.worktrees/',
  '.agents/hooks/gate.log',
  '.qa-verdict.json',
  '*.qa-bak',
  '*.relevo-new',
];

function assertGitRoot(cwd) {
  let toplevel;
  try {
    toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error('relevo init: debe ejecutarse en la raíz de un repositorio git');
  }
  const resolvedTop = canonical(toplevel);
  const resolvedCwd = canonical(cwd);
  if (resolvedTop.toLowerCase() !== resolvedCwd.toLowerCase()) {
    throw new Error('relevo init: debe ejecutarse en la raíz de un repositorio git');
  }
}

function syncFile(targetRoot, relPath, expectedContent, { force = false, dryRun = false, neverOverwrite = false }) {
  const fullPath = path.join(targetRoot, relPath);
  const normalizedRel = relPath.replace(/\\/g, '/');

  if (!fs.existsSync(fullPath)) {
    if (!dryRun) {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, expectedContent, 'utf8');
    }
    return { file: normalizedRel, status: 'creado' };
  }

  const existingContent = fs.readFileSync(fullPath, 'utf8');
  if (existingContent === expectedContent) {
    return { file: normalizedRel, status: 'sin cambios' };
  }

  if (neverOverwrite || !force) {
    return { file: normalizedRel, status: 'conservado' };
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, expectedContent, 'utf8');
  }
  return { file: normalizedRel, status: 'actualizado' };
}

function syncGitignore(targetRoot, requiredLines, { dryRun = false }) {
  const fullPath = path.join(targetRoot, '.gitignore');
  const normalizedRel = '.gitignore';

  if (!fs.existsSync(fullPath)) {
    const content = requiredLines.join('\n') + '\n';
    if (!dryRun) {
      fs.writeFileSync(fullPath, content, 'utf8');
    }
    return { file: normalizedRel, status: 'creado' };
  }

  const existingContent = fs.readFileSync(fullPath, 'utf8');
  const existingLines = existingContent.split(/\r?\n/).map((l) => l.trim());
  const missing = requiredLines.filter((line) => !existingLines.includes(line.trim()));

  if (missing.length === 0) {
    return { file: normalizedRel, status: 'sin cambios' };
  }

  if (!dryRun) {
    let newContent = existingContent;
    if (newContent.length > 0 && !newContent.endsWith('\n')) {
      newContent += '\n';
    }
    newContent += missing.join('\n') + '\n';
    fs.writeFileSync(fullPath, newContent, 'utf8');
  }
  return { file: normalizedRel, status: 'actualizado' };
}

function getManagedTemplates(relevoPkgRoot, customTemplatesDir) {
  const templatesDir = customTemplatesDir || path.join(relevoPkgRoot, 'templates');
  const files = [];

  // 1. .agents/hooks/permission-gate.cjs
  let gatePath = path.join(relevoPkgRoot, 'lib', 'permission-gate.cjs');
  if (customTemplatesDir) {
    if (fs.existsSync(path.join(customTemplatesDir, 'permission-gate.cjs'))) {
      gatePath = path.join(customTemplatesDir, 'permission-gate.cjs');
    } else if (fs.existsSync(path.join(customTemplatesDir, 'lib', 'permission-gate.cjs'))) {
      gatePath = path.join(customTemplatesDir, 'lib', 'permission-gate.cjs');
    }
  }
  files.push({
    relPath: '.agents/hooks/permission-gate.cjs',
    content: fs.readFileSync(gatePath, 'utf8'),
  });

  // 2. .agents/hooks.json
  const hooksPath = path.join(templatesDir, 'agents-hooks', 'hooks.json');
  if (fs.existsSync(hooksPath)) {
    files.push({
      relPath: '.agents/hooks.json',
      content: fs.readFileSync(hooksPath, 'utf8'),
    });
  }

  // 3. Skills: templates/skills/<name>/SKILL.md → .claude/skills/<name>/SKILL.md
  const skillsDir = path.join(templatesDir, 'skills');
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        files.push({
          relPath: `.claude/skills/${entry.name}/SKILL.md`,
          content: fs.readFileSync(skillFile, 'utf8'),
        });
      }
    }
  }

  // 4. Agentes: templates/agents/*.md → .agents/plugins/relevo/agents/*.md
  const agentsDir = path.join(templatesDir, 'agents');
  if (fs.existsSync(agentsDir)) {
    for (const entry of fs.readdirSync(agentsDir)) {
      if (!entry.endsWith('.md')) continue;
      files.push({
        relPath: `.agents/plugins/relevo/agents/${entry}`,
        content: fs.readFileSync(path.join(agentsDir, entry), 'utf8'),
      });
    }
  }

  // 5. Plugin json: .agents/plugins/relevo/plugin.json
  const pluginFile = path.join(templatesDir, 'plugin.json');
  const pluginContent = fs.existsSync(pluginFile)
    ? fs.readFileSync(pluginFile, 'utf8')
    : JSON.stringify({ name: 'relevo' }, null, 2) + '\n';
  files.push({
    relPath: '.agents/plugins/relevo/plugin.json',
    content: pluginContent,
  });

  return files;
}

function init({ cwd = process.cwd(), dryRun = false, force = false, silent = false } = {}) {
  assertGitRoot(cwd);

  const relevoPkgRoot = path.resolve(__dirname, '..');
  const targetRoot = path.resolve(cwd);
  const results = [];

  // 1. relevo.config.json (nunca se sobrescribe, no se incluye en el lock)
  const configContent = JSON.stringify(DEFAULTS, null, 2) + '\n';
  results.push(syncFile(targetRoot, 'relevo.config.json', configContent, { force, dryRun, neverOverwrite: true }));

  // Archivos gestionados (se registran en .agents/relevo.lock.json)
  const managedTemplates = getManagedTemplates(relevoPkgRoot);
  const lockFiles = {};
  let existingLockFiles = {};
  const lockFilePath = path.join(targetRoot, '.agents', 'relevo.lock.json');
  if (fs.existsSync(lockFilePath)) {
    try {
      existingLockFiles = JSON.parse(fs.readFileSync(lockFilePath, 'utf8')).files || {};
    } catch {}
  }

  for (const item of managedTemplates) {
    const res = syncFile(targetRoot, item.relPath, item.content, { force, dryRun });
    results.push(res);
    const normalizedRel = item.relPath.replace(/\\/g, '/');
    if (res.status === 'creado' || res.status === 'actualizado' || res.status === 'sin cambios') {
      lockFiles[normalizedRel] = crypto.createHash('sha256').update(item.content).digest('hex');
    } else if (res.status === 'conservado' && existingLockFiles[normalizedRel]) {
      lockFiles[normalizedRel] = existingLockFiles[normalizedRel];
    }
  }

  // 2. .agents/skills.json (nunca se sobrescribe, no se incluye en el lock)
  const skillsJsonContent = JSON.stringify({ entries: [{ path: '.claude/skills', exclude: ['delegar-agy'] }] }, null, 2) + '\n';
  results.push(syncFile(targetRoot, '.agents/skills.json', skillsJsonContent, { force, dryRun, neverOverwrite: true }));

  // 3. .gitignore (no se incluye en el lock)
  results.push(syncGitignore(targetRoot, GITIGNORE_LINES, { dryRun }));

  // 4. .agents/relevo.lock.json
  const sortedFiles = {};
  for (const key of Object.keys(lockFiles).sort()) {
    sortedFiles[key] = lockFiles[key];
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(relevoPkgRoot, 'package.json'), 'utf8'));
  const lockContent = JSON.stringify({
    version: 1,
    relevo: pkg.version,
    files: sortedFiles,
  }, null, 2) + '\n';
  results.push(syncFile(targetRoot, '.agents/relevo.lock.json', lockContent, { force: true, dryRun }));

  const summary = {
    creado: results.filter((r) => r.status === 'creado').length,
    actualizado: results.filter((r) => r.status === 'actualizado').length,
    sin_cambios: results.filter((r) => r.status === 'sin cambios').length,
    conservado: results.filter((r) => r.status === 'conservado').length,
  };

  if (!silent) {
    const prefix = dryRun ? '(dry-run) ' : '';
    console.log(`relevo init · ${prefix}resumen: ${summary.creado} creados, ${summary.actualizado} actualizados, ${summary.sin_cambios} sin cambios, ${summary.conservado} conservados`);
    for (const r of results) {
      console.log(`  [${r.status}] ${r.file}`);
    }
  }

  return { results, summary };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const force = args.includes('--force');
    init({ cwd: process.cwd(), dryRun, force });
  } catch (err) {
    console.error(`relevo init · error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { init, assertGitRoot, GITIGNORE_LINES, getManagedTemplates };
