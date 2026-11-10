'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DEFAULTS } = require('./config.cjs');
const { canonical } = require('./root.cjs');

const GITIGNORE_LINES = [
  'artifacts/agent-runs/',
  '.worktrees/',
  '.agents/hooks/gate.log',
  '.qa-verdict.json',
  '*.qa-bak',
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

function init({ cwd = process.cwd(), dryRun = false, force = false, silent = false } = {}) {
  assertGitRoot(cwd);

  const relevoPkgRoot = path.resolve(__dirname, '..');
  const targetRoot = path.resolve(cwd);
  const results = [];

  // 1. relevo.config.json (nunca se sobrescribe)
  const configContent = JSON.stringify(DEFAULTS, null, 2) + '\n';
  results.push(syncFile(targetRoot, 'relevo.config.json', configContent, { force, dryRun, neverOverwrite: true }));

  // 2. .agents/hooks/permission-gate.cjs y .agents/hooks.json
  const gateSource = fs.readFileSync(path.join(relevoPkgRoot, 'lib', 'permission-gate.cjs'), 'utf8');
  results.push(syncFile(targetRoot, '.agents/hooks/permission-gate.cjs', gateSource, { force, dryRun }));

  const hooksSource = fs.readFileSync(path.join(relevoPkgRoot, 'templates', 'agents-hooks', 'hooks.json'), 'utf8');
  results.push(syncFile(targetRoot, '.agents/hooks.json', hooksSource, { force, dryRun }));

  // 3. Skills: cada templates/skills/<nombre>/SKILL.md → .claude/skills/<nombre>/SKILL.md
  const skillsDir = path.join(relevoPkgRoot, 'templates', 'skills');
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        const skillContent = fs.readFileSync(skillFile, 'utf8');
        results.push(syncFile(targetRoot, `.claude/skills/${entry.name}/SKILL.md`, skillContent, { force, dryRun }));
      }
    }
  }

  // 4. Agentes: templates/agents/*.md → .agents/plugins/relevo/agents/
  const agentsDir = path.join(relevoPkgRoot, 'templates', 'agents');
  if (fs.existsSync(agentsDir)) {
    for (const entry of fs.readdirSync(agentsDir)) {
      if (!entry.endsWith('.md')) continue;
      const agentContent = fs.readFileSync(path.join(agentsDir, entry), 'utf8');
      results.push(syncFile(targetRoot, `.agents/plugins/relevo/agents/${entry}`, agentContent, { force, dryRun }));
    }
  }
  const pluginJsonContent = JSON.stringify({ name: 'relevo' }, null, 2) + '\n';
  results.push(syncFile(targetRoot, '.agents/plugins/relevo/plugin.json', pluginJsonContent, { force, dryRun }));

  // 5. .agents/skills.json (nunca se sobrescribe)
  const skillsJsonContent = JSON.stringify({ entries: [{ path: '.claude/skills', exclude: ['delegar-agy'] }] }, null, 2) + '\n';
  results.push(syncFile(targetRoot, '.agents/skills.json', skillsJsonContent, { force, dryRun, neverOverwrite: true }));

  // 6. .gitignore
  results.push(syncGitignore(targetRoot, GITIGNORE_LINES, { dryRun }));

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

module.exports = { init, assertGitRoot, GITIGNORE_LINES };
