/* Definition-of-done rules used by scripts/check-change.cjs. No git or browser is used. */
const assert = require('node:assert/strict');
const { evaluate } = require('../lib/check-change.cjs');

const failures = [];
let passed = 0;
function test(name, action) {
  try { action(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}: ${error.message}`); }
}
const head = 'a'.repeat(40);
const approved = { commit: head, verdict: 'aprobado', suites: [{ name: 'verify', passed: true }] };

const legacyCheck = {
  baseBranch: 'main',
  sourcePattern: '^src/',
  testPattern: '^(scripts/test-[\\w.-]+\\.cjs|test/[\\w./-]+)$',
  roadmap: 'docs/publishing-roadmap.md',
  decisions: { dir: 'docs/decisions', index: 'AGENTS.md' },
  verdictFile: '.qa-verdict.json',
  hardcodedColorFiles: '^src/(components/[\\w.-]+\\.svelte|App\\.svelte)$',
  areaSuites: [
    { pattern: '^src/audio/(Lofi|Generative|Hook|SongStructure|PhonkScales|MusicalArrangement|Random|SeededRandom)', suites: ['npm run test:lofi:e2e', 'node scripts/test-composition-state-e2e.cjs'] },
    { pattern: '^src/audio/(AudioExporter|AudioRender|OfflineRender|RenderPolicy|OfflineVoice|AudioGraph|OrderedAudioMixer|TrackChannelGraph)', suites: ['npm run test:render -- --lifecycle-only', 'npm run test:production'] },
    { pattern: '^src/audio/(Video|OfflineVideo|SoftwareH264)', suites: ['npm run test:video-fallback', 'npm run test:local-video'] },
    { pattern: '^src/visualizer/', suites: ['npm run test:visual-motion', 'npm run test:visual-neon'] },
    { pattern: '^src/project/', suites: ['node scripts/test-project-storage-e2e.cjs'] },
    { pattern: '^src/studio/(StudioTransport|StudioSession)|^src/components/PlaybackTransport', suites: ['npm run test:playback'] },
    { pattern: '^src/studio/Cover|^src/components/SongArtwork', suites: ['npm run test:cover', 'npm run test:design'] },
    { pattern: '^src/project/ReleaseSettings|^src/studio/ReleaseDocuments', suites: ['npm run test:release', 'node scripts/test-project-storage-e2e.cjs'] },
    { pattern: '^src/project/Catalog|^src/studio/(CatalogController|CompositionNovelty)|^src/components/ReleaseCatalog', suites: ['npm run test:catalog', 'node scripts/test-project-storage-e2e.cjs'] },
    { pattern: '^src/(components/|App\\.svelte|app\\.css|styles/)', suites: ['npm run test:design', 'npm run test:interface'] },
    { pattern: '^src/(App\\.svelte|project/(ProjectState|ProjectAutosave|ProjectRepository|ProjectStorage))', suites: ['node scripts/test-studio-e2e.cjs', 'node scripts/test-composition-state-e2e.cjs'] },
    { pattern: '^src/(visualizer/|components/VisualizerCanvas|audio/(SamplerEngine|Bass808Synth|DrumSynth|AudioEngine|AudioGraph|MixSettings|TrackChannelGraph|LofiKeys|SynthesisRecipe))', suites: ['npm run test:visual-motion', 'npm run test:visual-neon', 'npm run test:playback', 'node scripts/test-studio-e2e.cjs'] },
  ],
};

const base = { agentsMd: '| [17-cover-export.md](docs/decisions/17-cover-export.md) |', head, dirty: [], check: legacyCheck };

test('a complete change passes', () => {
  const r = evaluate({ ...base, verdict: approved, changed: ['src/studio/CoverArt.ts', 'scripts/test-cover-art.cjs', 'docs/publishing-roadmap.md', 'docs/decisions/17-cover-export.md'] });
  assert.deepEqual(r.failures, []);
  assert.ok(r.suites.includes('npm run test:cover'));
});

test('src change without tests fails unless justified', () => {
  const changed = ['src/App.svelte', 'docs/publishing-roadmap.md'];
  assert.ok(evaluate({ ...base, verdict: approved, changed }).failures.some((f) => /ninguna prueba/.test(f)));
  const justified = evaluate({ ...base, verdict: approved, changed, noTestsReason: 'solo texto de UI' });
  assert.deepEqual(justified.failures, []);
  assert.equal(justified.notes.length, 1);
});

test('missing, stale, rejected or failing QA verdicts fail', () => {
  const changed = ['src/a.ts', 'scripts/test-a.cjs', 'docs/publishing-roadmap.md'];
  assert.ok(evaluate({ ...base, verdict: null, changed }).failures.some((f) => /Falta \.qa-verdict/.test(f)));
  assert.ok(evaluate({ ...base, verdict: { ...approved, commit: 'b'.repeat(40) }, changed }).failures.some((f) => /no del actual/.test(f)));
  assert.ok(evaluate({ ...base, verdict: { ...approved, verdict: 'rechazado' }, changed }).failures.some((f) => /rechazado/.test(f)));
  assert.ok(evaluate({ ...base, verdict: { ...approved, suites: [{ name: 'test:cover', passed: false }] }, changed }).failures.some((f) => /test:cover/.test(f)));
});

test('uncommitted changes block a QA-bound check', () => {
  const r = evaluate({ ...base, dirty: ['src/a.ts'], verdict: approved, changed: ['src/a.ts', 'scripts/test-a.cjs', 'docs/publishing-roadmap.md'] });
  assert.ok(r.failures.some((f) => /sin commit/.test(f)));
});

test('roadmap and decision index are required for non-doc changes', () => {
  const r = evaluate({ ...base, agentsMd: '', verdict: approved, changed: ['scripts/tool.cjs', 'docs/decisions/18-new.md'] });
  assert.ok(r.failures.some((f) => /publishing-roadmap/.test(f)));
  assert.ok(r.failures.some((f) => /18-new\.md/.test(f)));
});

test('docs-only mode skips QA and test rules', () => {
  const r = evaluate({ ...base, verdict: null, docsOnly: true, changed: ['docs/publishing-roadmap.md', 'docs/studio-evolution-plan.md'] });
  assert.deepEqual(r.failures, []);
});

test('release modules suggest the release E2E', () => {
  const r = evaluate({ ...base, verdict: approved, changed: ['src/studio/ReleaseDocuments.ts', 'scripts/test-release-settings.cjs', 'docs/publishing-roadmap.md'] });
  assert.ok(r.suites.includes('npm run test:release'));
});

test('orchestration, catalog and engine changes suggest their integral suites', () => {
  const app = evaluate({ ...base, verdict: approved, changed: ['src/App.svelte', 'scripts/test-x.cjs', 'docs/publishing-roadmap.md'] });
  for (const suite of ['node scripts/test-studio-e2e.cjs', 'node scripts/test-composition-state-e2e.cjs', 'npm run test:design']) assert.ok(app.suites.includes(suite), suite);
  const catalog = evaluate({ ...base, verdict: approved, changed: ['src/studio/CatalogController.ts', 'scripts/test-x.cjs', 'docs/publishing-roadmap.md'] });
  assert.ok(catalog.suites.includes('npm run test:catalog'));
  const engine = evaluate({ ...base, verdict: approved, changed: ['src/audio/SamplerEngine.ts', 'scripts/test-x.cjs', 'docs/publishing-roadmap.md'] });
  for (const suite of ['npm run test:visual-neon', 'npm run test:playback']) assert.ok(engine.suites.includes(suite), suite);
});

test('new hardcoded colors in UI files fail unless justified; tokens and non-UI files pass', () => {
  const changed = ['src/components/ReleaseCatalog.svelte', 'scripts/test-x.cjs', 'docs/publishing-roadmap.md'];
  const bad = evaluate({ ...base, verdict: approved, changed, addedLinesByFile: { 'src/components/ReleaseCatalog.svelte': ['  .x { color:#ef4444; }', '  .y { background: rgba(239, 68, 68, 0.12); }'] } });
  assert.ok(bad.failures.some((f) => /Colores fijos/.test(f) && /ef4444/.test(f)));
  const tokens = evaluate({ ...base, verdict: approved, changed, addedLinesByFile: { 'src/components/ReleaseCatalog.svelte': ['  .x { color:var(--accent-red); }', '  .y { background: color-mix(in srgb, var(--accent-red) 12%, transparent); }'] } });
  assert.ok(!tokens.failures.some((f) => /Colores fijos/.test(f)));
  const justified = evaluate({ ...base, verdict: approved, changed, allowColorsReason: 'colores del video', addedLinesByFile: { 'src/components/ReleaseCatalog.svelte': ['#000'] } });
  assert.ok(!justified.failures.some((f) => /Colores fijos/.test(f)));
  const nonUi = evaluate({ ...base, verdict: approved, changed: ['src/studio/GenreExperience.ts', 'scripts/test-x.cjs', 'docs/publishing-roadmap.md'], addedLinesByFile: { 'src/studio/GenreExperience.ts': ["'#aa3039'"] } });
  assert.ok(!nonUi.failures.some((f) => /Colores fijos/.test(f)));
});

test('an approved verdict with high-severity findings fails; medium/low do not', () => {
  const changed = ['src/a.ts', 'scripts/test-a.cjs', 'docs/publishing-roadmap.md'];
  const high = evaluate({ ...base, changed, verdict: { ...approved, findings: [{ severity: 'alta', file: 'src/audio/ExportPipeline.ts:52' }] } });
  assert.ok(high.failures.some((f) => /severidad alta/.test(f) && /ExportPipeline/.test(f)));
  const medium = evaluate({ ...base, changed, verdict: { ...approved, findings: [{ severity: 'media', file: 'x' }, { severity: 'baja', file: 'y' }] } });
  assert.ok(!medium.failures.some((f) => /severidad alta/.test(f)));
});

test('no changes is reported', () => {
  assert.ok(evaluate({ ...base, verdict: approved, changed: [] }).failures.length === 1);
});

// Casos nuevos parametrizados según especificación
test('roadmap: null no exige documento', () => {
  const r = evaluate({ ...base, check: { ...legacyCheck, roadmap: null }, verdict: approved, changed: ['src/a.ts', 'scripts/test-a.cjs'] });
  assert.ok(!r.failures.some((f) => /publishing-roadmap|roadmap/i.test(f)));
});

test('roadmap: "docs/plan.md" lo exige', () => {
  const r = evaluate({ ...base, check: { ...legacyCheck, roadmap: 'docs/plan.md' }, verdict: approved, changed: ['src/a.ts', 'scripts/test-a.cjs'] });
  assert.ok(r.failures.some((f) => f.includes('No se actualizó docs/plan.md')));
});

test('decisions: null no exige índice', () => {
  const r = evaluate({ ...base, check: { ...legacyCheck, decisions: null }, agentsMd: '', verdict: approved, changed: ['scripts/tool.cjs', 'docs/decisions/18-new.md'] });
  assert.ok(!r.failures.some((f) => /decisión.*índice/i.test(f)));
});

test('hardcodedColorFiles: null no revisa colores', () => {
  const changed = ['src/components/ReleaseCatalog.svelte', 'scripts/test-x.cjs'];
  const r = evaluate({
    ...base,
    check: { ...legacyCheck, hardcodedColorFiles: null, roadmap: null },
    verdict: approved,
    changed,
    addedLinesByFile: { 'src/components/ReleaseCatalog.svelte': ['  .x { color:#ef4444; }'] },
  });
  assert.ok(!r.failures.some((f) => /Colores fijos/.test(f)));
});

test('areaSuites configurado aparece en las sugerencias', () => {
  const customSuites = [
    { pattern: '^src/custom/', suites: ['npm run test:custom:e2e'] },
  ];
  const r = evaluate({
    ...base,
    check: { ...legacyCheck, areaSuites: customSuites, roadmap: null },
    verdict: approved,
    changed: ['src/custom/feature.ts', 'scripts/test-feature.cjs'],
  });
  assert.deepEqual(r.suites, ['npm run test:custom:e2e']);
});

console.log(`\ncheck:change rules: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
