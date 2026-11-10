#!/usr/bin/env node
/*
 * Control mecánico de la definición de hecho (.claude/skills/definicion-de-hecho) para la rama actual.
 *   npm run check:change                      compara con main (merge-base) e incluye cambios sin commit
 *   npm run check:change -- --docs-only       solo reglas de documentación
 *   npm run check:change -- --base <ref>      otra base
 *   npm run check:change -- --no-tests-reason "<motivo>"   justifica un cambio de src/ sin pruebas
 * No ejecuta suites: exige el veredicto del agente de QA (.qa-verdict.json) atado al commit actual.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DEFAULTS, loadConfig } = require('./config.cjs');
const { validateVerdict } = require('./verdict.cjs');

const HARDCODED_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(\s*\d/;

function hardcodedColorLines(addedLinesByFile, uiFilesRegex) {
  if (!uiFilesRegex) return [];
  const found = [];
  for (const [file, lines] of Object.entries(addedLinesByFile)) {
    if (!uiFilesRegex.test(file)) continue;
    for (const line of lines) if (HARDCODED_COLOR.test(line)) found.push(`${file}: ${line.trim().slice(0, 100)}`);
  }
  return found;
}

function evaluate({
  changed,
  agentsMd = '',
  verdict = null,
  head = '',
  dirty = [],
  docsOnly = false,
  noTestsReason = '',
  addedLinesByFile = {},
  allowColorsReason = '',
  check,
  config,
}) {
  const checkConfig = check ?? config?.check ?? DEFAULTS.check;
  const failures = [];
  const notes = [];
  const touches = (pattern) => changed.some((file) => pattern.test(file));
  const codeChanged = changed.filter((file) => !/^docs\//.test(file) && !/^(AGENTS|CLAUDE|CONTRIBUTING|README)\.md$/.test(file));
  if (!changed.length) return { failures: ['No hay cambios respecto a la base.'], notes, suites: [] };

  const sourceRegex = new RegExp(checkConfig.sourcePattern ?? '^src/');
  const testRegex = new RegExp(checkConfig.testPattern ?? '^(scripts/test-[\\w.-]+\\.cjs|test/[\\w./-]+)$');
  const verdictFileName = checkConfig.verdictFile ?? '.qa-verdict.json';

  if (!docsOnly) {
    if (touches(sourceRegex) && !touches(testRegex)) {
      if (noTestsReason) notes.push(`Cambio en ${checkConfig.sourcePattern} sin pruebas, justificado: ${noTestsReason}`);
      else failures.push(`Cambia código fuente (check.sourcePattern: ${checkConfig.sourcePattern}) pero ninguna prueba (check.testPattern) (usa --no-tests-reason "<motivo>" solo si de verdad no aplica).`);
    }

    if (checkConfig.hardcodedColorFiles) {
      const uiRegex = new RegExp(checkConfig.hardcodedColorFiles);
      const colors = hardcodedColorLines(addedLinesByFile, uiRegex);
      if (colors.length) {
        if (allowColorsReason) notes.push(`${colors.length} color(es) fijo(s) en interfaz, justificado(s): ${allowColorsReason}`);
        else failures.push(`Colores fijos nuevos en la interfaz (usa tokens del tema; --allow-colors "<motivo>" solo si son colores del video o de marca): ${colors.slice(0, 4).join(' | ')}${colors.length > 4 ? ' …' : ''}`);
      }
    }

    if (codeChanged.length && touches(sourceRegex)) {
      if (dirty.length) failures.push(`Hay cambios sin commit (${dirty.slice(0, 3).join(', ')}${dirty.length > 3 ? '…' : ''}): el veredicto de QA debe corresponder a un commit.`);
      if (!verdict) failures.push(`Falta ${verdictFileName} del agente de QA.`);
      else {
        const validation = validateVerdict(verdict);
        if (!validation.ok) {
          failures.push(`El veredicto no es válido: ${validation.errors.join('; ')}`);
        } else {
          if (verdict.commit !== head) failures.push(`El veredicto de QA es del commit ${String(verdict.commit).slice(0, 8)}, no del actual ${head.slice(0, 8)}.`);
          if (verdict.verdict !== 'aprobado') failures.push(`El veredicto de QA es "${verdict.verdict}".`);
          const failed = (verdict.suites ?? []).filter((suite) => !suite.passed);
          if (failed.length) failures.push(`Suites fallidas en el veredicto: ${failed.map((s) => s.name).join(', ')}.`);
          // Un veredicto "aprobado" con hallazgos altos es incoherente: la definición de hecho no lo admite.
          const high = (verdict.findings ?? []).filter((finding) => finding.severity === 'alta');
          if (high.length) failures.push(`El veredicto tiene ${high.length} hallazgo(s) de severidad alta sin resolver: ${high.map((f) => f.file ?? '?').join(', ')}.`);
        }
      }
    }
  }

  if (checkConfig.roadmap) {
    if (codeChanged.length && !changed.includes(checkConfig.roadmap)) {
      failures.push(`No se actualizó ${checkConfig.roadmap} (estado y entrada en Registro).`);
    }
  }

  if (checkConfig.decisions && checkConfig.decisions.dir) {
    const dirEscaped = checkConfig.decisions.dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\\/]/g, '[\\\\/]');
    const decisionPattern = new RegExp(`^${dirEscaped}[\\\\/]\\d+-[\\w.-]+\\.md$`);
    const indexName = checkConfig.decisions.index || 'AGENTS.md';
    for (const file of changed.filter((f) => decisionPattern.test(f))) {
      if (!agentsMd.includes(path.basename(file))) failures.push(`La decisión ${file} no está en el índice de ${indexName}.`);
    }
  }

  const suites = [];
  if (Array.isArray(checkConfig.areaSuites)) {
    for (const item of checkConfig.areaSuites) {
      if (item && item.pattern && Array.isArray(item.suites)) {
        const pat = new RegExp(item.pattern);
        if (touches(pat)) {
          suites.push(...item.suites);
        }
      }
    }
  }

  return { failures, notes, suites: [...new Set(suites)] };
}

function git(args) { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }

function main() {
  const { projectRoot } = require('./root.cjs');
  const root = projectRoot();
  const config = loadConfig(root);
  const checkConfig = config.check;

  const argv = process.argv.slice(2);
  const value = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const base = value('base') ?? checkConfig.baseBranch ?? 'main';
  const head = git(['rev-parse', 'HEAD']);
  let mergeBase;
  try { mergeBase = git(['merge-base', 'HEAD', base]); } catch { console.error(`No se pudo calcular la base con ${base}.`); process.exit(2); }
  if (mergeBase === head) {
    try { mergeBase = git(['rev-parse', 'HEAD~1']); } catch { /* primer commit */ }
  }
  const tracked = git(['diff', '--name-only', mergeBase]).split('\n').filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  const changed = [...new Set([...tracked, ...untracked])].map((f) => f.replace(/\\/g, '/'));
  const verdictFileName = checkConfig.verdictFile ?? '.qa-verdict.json';
  const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean).map((l) => l.slice(3)).filter((f) => f !== verdictFileName);
  let verdict = null;
  const verdictPath = path.join(root, verdictFileName);
  if (fs.existsSync(verdictPath)) {
    try { verdict = JSON.parse(fs.readFileSync(verdictPath, 'utf8')); } catch { verdict = { __invalid_json__: true }; }
  }

  let agentsMd = '';
  if (checkConfig.decisions?.index) {
    const indexPath = path.join(root, checkConfig.decisions.index);
    if (fs.existsSync(indexPath)) agentsMd = fs.readFileSync(indexPath, 'utf8');
  } else if (fs.existsSync(path.join(root, 'AGENTS.md'))) {
    agentsMd = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  }

  const addedLinesByFile = {};
  if (checkConfig.hardcodedColorFiles) {
    const uiRegex = new RegExp(checkConfig.hardcodedColorFiles);
    for (const file of changed.filter((f) => uiRegex.test(f))) {
      let lines = [];
      if (untracked.includes(file)) lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
      else lines = git(['diff', '-U0', mergeBase, '--', file]).split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
      addedLinesByFile[file] = lines;
    }
  }

  const result = evaluate({
    changed,
    agentsMd,
    verdict,
    head,
    dirty,
    docsOnly: argv.includes('--docs-only'),
    noTestsReason: value('no-tests-reason') ?? '',
    addedLinesByFile,
    allowColorsReason: value('allow-colors') ?? '',
    check: checkConfig,
  });

  console.log(`check:change · base ${mergeBase.slice(0, 8)} · HEAD ${head.slice(0, 8)} · ${changed.length} archivos cambiados`);
  for (const note of result.notes) console.log('  nota: ' + note);
  if (result.suites.length) console.log('  E2E del área que QA debe haber ejecutado: ' + result.suites.join(' · '));
  if (verdict) console.log(`  veredicto QA: ${verdict.verdict} (${String(verdict.commit).slice(0, 8)}, ${verdict.checkedAt ?? 'sin fecha'})`);
  if (result.failures.length) {
    console.error('\n✗ No cumple la definición de hecho:');
    for (const failure of result.failures) console.error('  - ' + failure);
    process.exitCode = 1;
  } else console.log('\n✓ Cumple los controles mecánicos de la definición de hecho.');
}

if (require.main === module) main();
module.exports = { evaluate, AREA_SUITES: DEFAULTS.check.areaSuites };
