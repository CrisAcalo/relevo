#!/usr/bin/env node
/*
 * Control mecánico de la definición de hecho (.claude/skills/definicion-de-hecho) para la rama actual.
 *   npm run check:change                      compara con main (merge-base) e incluye cambios sin commit
 *   npm run check:change -- --docs-only       solo reglas de documentación
 *   npm run check:change -- --base <ref>      otra base
 *   npm run check:change -- --no-tests-reason "<motivo>"   justifica un cambio de src/ sin pruebas
 * No ejecuta suites: exige el veredicto de qa-estudio (.qa-verdict.json) atado al commit actual.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const AREA_SUITES = [
  [/^src\/audio\/(Lofi|Generative|Hook|SongStructure|PhonkScales|MusicalArrangement|Random|SeededRandom)/, ['npm run test:lofi:e2e', 'node scripts/test-composition-state-e2e.cjs']],
  [/^src\/audio\/(AudioExporter|AudioRender|OfflineRender|RenderPolicy|OfflineVoice|AudioGraph|OrderedAudioMixer|TrackChannelGraph)/, ['npm run test:render -- --lifecycle-only', 'npm run test:production']],
  [/^src\/audio\/(Video|OfflineVideo|SoftwareH264)/, ['npm run test:video-fallback', 'npm run test:local-video']],
  [/^src\/visualizer\//, ['npm run test:visual-motion', 'npm run test:visual-neon']],
  [/^src\/project\//, ['node scripts/test-project-storage-e2e.cjs']],
  [/^src\/studio\/(StudioTransport|StudioSession)|^src\/components\/PlaybackTransport/, ['npm run test:playback']],
  [/^src\/studio\/Cover|^src\/components\/SongArtwork/, ['npm run test:cover', 'npm run test:design']],
  [/^src\/project\/ReleaseSettings|^src\/studio\/ReleaseDocuments/, ['npm run test:release', 'node scripts/test-project-storage-e2e.cjs']],
  [/^src\/project\/Catalog|^src\/studio\/(CatalogController|CompositionNovelty)|^src\/components\/ReleaseCatalog/, ['npm run test:catalog', 'node scripts/test-project-storage-e2e.cjs']],
  [/^src\/(components\/|App\.svelte|app\.css|styles\/)/, ['npm run test:design', 'npm run test:interface']],
  // Orquestación y estado del proyecto: flujos integrales del estudio.
  [/^src\/(App\.svelte|project\/(ProjectState|ProjectAutosave|ProjectRepository|ProjectStorage))/, ['node scripts/test-studio-e2e.cjs', 'node scripts/test-composition-state-e2e.cjs']],
  // Motor visual o de audio: matriz de AGENTS.md §1 (modos, formatos, Brutal, Slowed, neón, audio).
  [/^src\/(visualizer\/|components\/VisualizerCanvas|audio\/(SamplerEngine|Bass808Synth|DrumSynth|AudioEngine|AudioGraph|MixSettings|TrackChannelGraph|LofiKeys|SynthesisRecipe))/, ['npm run test:visual-motion', 'npm run test:visual-neon', 'npm run test:playback', 'node scripts/test-studio-e2e.cjs']],
];

// Colores fijos en la interfaz: deben salir de los tokens del tema (contraste por tema).
const UI_FILES = /^src\/(components\/[\w.-]+\.svelte|App\.svelte)$/;
const HARDCODED_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(\s*\d/;
function hardcodedColorLines(addedLinesByFile) {
  const found = [];
  for (const [file, lines] of Object.entries(addedLinesByFile)) {
    if (!UI_FILES.test(file)) continue;
    for (const line of lines) if (HARDCODED_COLOR.test(line)) found.push(`${file}: ${line.trim().slice(0, 100)}`);
  }
  return found;
}

function evaluate({ changed, agentsMd, verdict, head, dirty, docsOnly = false, noTestsReason = '', addedLinesByFile = {}, allowColorsReason = '' }) {
  const failures = [];
  const notes = [];
  const touches = (pattern) => changed.some((file) => pattern.test(file));
  const codeChanged = changed.filter((file) => !/^docs\//.test(file) && !/^(AGENTS|CLAUDE|CONTRIBUTING|README)\.md$/.test(file));
  if (!changed.length) return { failures: ['No hay cambios respecto a la base.'], notes, suites: [] };

  if (!docsOnly) {
    if (touches(/^src\//) && !touches(/^scripts\/test-[\w.-]+\.cjs$/)) {
      if (noTestsReason) notes.push(`Cambio en src/ sin pruebas, justificado: ${noTestsReason}`);
      else failures.push('Cambia src/ pero ninguna prueba scripts/test-*.cjs (usa --no-tests-reason "<motivo>" solo si de verdad no aplica).');
    }
    const colors = hardcodedColorLines(addedLinesByFile);
    if (colors.length) {
      if (allowColorsReason) notes.push(`${colors.length} color(es) fijo(s) en interfaz, justificado(s): ${allowColorsReason}`);
      else failures.push(`Colores fijos nuevos en la interfaz (usa tokens del tema; --allow-colors "<motivo>" solo si son colores del video o de marca): ${colors.slice(0, 4).join(' | ')}${colors.length > 4 ? ' …' : ''}`);
    }
    if (codeChanged.length && touches(/^src\//)) {
      if (dirty.length) failures.push(`Hay cambios sin commit (${dirty.slice(0, 3).join(', ')}${dirty.length > 3 ? '…' : ''}): el veredicto de QA debe corresponder a un commit.`);
      if (!verdict) failures.push('Falta .qa-verdict.json del agente qa-estudio.');
      else {
        if (verdict.commit !== head) failures.push(`El veredicto de QA es del commit ${String(verdict.commit).slice(0, 8)}, no del actual ${head.slice(0, 8)}.`);
        if (verdict.verdict !== 'aprobado') failures.push(`El veredicto de QA es "${verdict.verdict}".`);
        const failed = (verdict.suites ?? []).filter((suite) => !suite.passed);
        if (failed.length) failures.push(`Suites fallidas en el veredicto: ${failed.map((s) => s.name).join(', ')}.`);
        // Un veredicto "aprobado" con hallazgos altos es incoherente: la definición de hecho no lo admite.
        const high = (verdict.findings ?? []).filter((finding) => /^(alta|high|critica|crítica)$/i.test(String(finding.severity ?? '')));
        if (high.length) failures.push(`El veredicto tiene ${high.length} hallazgo(s) de severidad alta sin resolver: ${high.map((f) => f.file ?? '?').join(', ')}.`);
      }
    }
  }
  if (codeChanged.length && !changed.includes('docs/publishing-roadmap.md')) {
    failures.push('No se actualizó docs/publishing-roadmap.md (estado y entrada en Registro).');
  }
  for (const file of changed.filter((f) => /^docs\/decisions\/\d+-[\w.-]+\.md$/.test(f))) {
    if (!agentsMd.includes(path.basename(file))) failures.push(`La decisión ${file} no está en el índice de AGENTS.md.`);
  }
  const suites = [...new Set(AREA_SUITES.filter(([pattern]) => touches(pattern)).flatMap(([, list]) => list))];
  return { failures, notes, suites };
}

function git(args) { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }

function main() {
  const argv = process.argv.slice(2);
  const value = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const base = value('base') ?? 'main';
  const head = git(['rev-parse', 'HEAD']);
  let mergeBase;
  try { mergeBase = git(['merge-base', 'HEAD', base]); } catch { console.error(`No se pudo calcular la base con ${base}.`); process.exit(2); }
  if (mergeBase === head) {
    try { mergeBase = git(['rev-parse', 'HEAD~1']); } catch { /* primer commit */ }
  }
  const tracked = git(['diff', '--name-only', mergeBase]).split('\n').filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  const changed = [...new Set([...tracked, ...untracked])].map((f) => f.replace(/\\/g, '/'));
  const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean).map((l) => l.slice(3)).filter((f) => f !== '.qa-verdict.json');
  let verdict = null;
  try { verdict = JSON.parse(fs.readFileSync('.qa-verdict.json', 'utf8')); } catch { /* sin veredicto */ }
  const agentsMd = fs.existsSync('AGENTS.md') ? fs.readFileSync('AGENTS.md', 'utf8') : '';
  // Líneas añadidas por archivo de interfaz (incluye archivos nuevos sin seguimiento).
  const addedLinesByFile = {};
  for (const file of changed.filter((f) => UI_FILES.test(f))) {
    let lines = [];
    if (untracked.includes(file)) lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
    else lines = git(['diff', '-U0', mergeBase, '--', file]).split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
    addedLinesByFile[file] = lines;
  }
  const result = evaluate({ changed, agentsMd, verdict, head, dirty, docsOnly: argv.includes('--docs-only'), noTestsReason: value('no-tests-reason') ?? '',
    addedLinesByFile, allowColorsReason: value('allow-colors') ?? '' });

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
module.exports = { evaluate, AREA_SUITES };
