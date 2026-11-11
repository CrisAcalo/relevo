/* Definition-of-done rules used by scripts/check-change.cjs. No git or browser is used. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { evaluate } = require('../lib/check-change.cjs');

const failures = [];
let passed = 0;
function test(name, action) {
  try { action(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}: ${error.message}`); }
}
const head = 'a'.repeat(40);
const approved = { version: 1, commit: head, verdict: 'aprobado', suites: [{ name: 'verify', passed: true }] };

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
  const high = evaluate({ ...base, changed, verdict: { ...approved, findings: [{ severity: 'alta', file: 'src/audio/ExportPipeline.ts:52', detail: 'falla grave' }] } });
  assert.ok(high.failures.some((f) => /severidad alta/.test(f) && /ExportPipeline/.test(f)));
  const medium = evaluate({ ...base, changed, verdict: { ...approved, findings: [{ severity: 'media', file: 'x', detail: 'aviso' }, { severity: 'baja', file: 'y', detail: 'nota' }] } });
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

test('un veredicto inválido produce el fallo "El veredicto no es válido" y no el de "es de otro commit"', () => {
  const changed = ['src/a.ts', 'scripts/test-a.cjs', 'docs/publishing-roadmap.md'];
  const invalidVerdict = { commit: 'b'.repeat(40), veredicto: 'aprobado' };
  const r = evaluate({ ...base, changed, verdict: invalidVerdict });
  assert.ok(r.failures.some((f) => f.includes('El veredicto no es válido')));
  assert.ok(!r.failures.some((f) => /no del actual/.test(f)));
});

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relevo-check-wt-'));

function makeRepoWithWorktree(name, decisions = { dir: 'docs/decisions', index: 'INDICE.md' }) {
  const repo = path.resolve(tmpDir, name);
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@relevo.local'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Relevo Test'], { cwd: repo });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo });

  const relevoConfig = {
    check: {
      baseBranch: 'main',
      sourcePattern: '^lib/',
      testPattern: '^test/[\\w./-]+$',
      roadmap: null,
      decisions,
    },
  };
  fs.writeFileSync(path.join(repo, 'relevo.config.json'), JSON.stringify(relevoConfig, null, 2) + '\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.qa-verdict.json\n.worktrees/\n');
  if (decisions?.index) {
    fs.writeFileSync(path.join(repo, decisions.index), '# Decisiones\n');
  } else {
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# Agentes\n');
  }
  fs.mkdirSync(path.join(repo, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'lib', 'base.cjs'), "'use strict';\n");

  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'inicial'], { cwd: repo });

  execFileSync('git', ['worktree', 'add', '-q', '.worktrees/t', '-b', 't'], { cwd: repo });
  const wt = path.resolve(repo, '.worktrees', 't');
  return { repo, wt };
}

function runCheck(cwd) {
  const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'relevo.cjs'), 'check'], { cwd, encoding: 'utf8' });
  return { status: res.status, output: (res.stdout || '') + (res.stderr || '') };
}

test('check en un worktree lee el veredicto de la raíz del worktree', () => {
  const { repo, wt } = makeRepoWithWorktree('a');
  fs.mkdirSync(path.join(wt, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(wt, 'test'), { recursive: true });
  fs.writeFileSync(path.join(wt, 'lib', 'a.cjs'), "'use strict';\nmodule.exports = 1;\n");
  fs.writeFileSync(path.join(wt, 'test', 'a.test.cjs'), "'use strict';\n");
  execFileSync('git', ['add', '-A'], { cwd: wt });
  execFileSync('git', ['commit', '-q', '-m', 'cambio'], { cwd: wt });

  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim();
  const verdictOk = {
    version: 1,
    commit: head,
    branch: 't',
    verdict: 'aprobado',
    checkedAt: new Date().toISOString(),
    suites: [{ name: 'test', passed: true }],
    findings: [],
  };
  fs.writeFileSync(path.join(wt, '.qa-verdict.json'), JSON.stringify(verdictOk, null, 2) + '\n');

  const verdictRechazado = {
    version: 1,
    commit: head,
    branch: 't',
    verdict: 'rechazado',
    checkedAt: new Date().toISOString(),
    suites: [{ name: 'test', passed: true }],
    findings: [],
  };
  fs.writeFileSync(path.join(repo, '.qa-verdict.json'), JSON.stringify(verdictRechazado, null, 2) + '\n');

  const { status, output } = runCheck(wt);
  assert.equal(status, 0, output);
  assert.ok(output.includes('Cumple los controles'), output);
  assert.ok(!output.includes('Falta .qa-verdict.json'), output);
  assert.ok(!output.includes('rechazado'), output);
});

test('check en un worktree lee el índice de decisiones de la rama', () => {
  const { wt } = makeRepoWithWorktree('b');
  fs.mkdirSync(path.join(wt, 'docs', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(wt, 'docs', 'decisions', '01-nueva.md'), '# Nueva\n');
  fs.appendFileSync(path.join(wt, 'INDICE.md'), '- [01-nueva.md](docs/decisions/01-nueva.md)\n');
  execFileSync('git', ['add', '-A'], { cwd: wt });
  execFileSync('git', ['commit', '-q', '-m', 'decision'], { cwd: wt });

  const { status, output } = runCheck(wt);
  assert.equal(status, 0, output);
  assert.ok(!output.includes('no está en el índice'), output);
});

test('check en un worktree lee AGENTS.md de la rama cuando no hay índice configurado', () => {
  const { wt } = makeRepoWithWorktree('d', { dir: 'docs/decisions', index: '' });
  fs.mkdirSync(path.join(wt, 'docs', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(wt, 'docs', 'decisions', '01-nueva.md'), '# Nueva\n');
  fs.appendFileSync(path.join(wt, 'AGENTS.md'), '- [01-nueva.md](docs/decisions/01-nueva.md)\n');
  execFileSync('git', ['add', '-A'], { cwd: wt });
  execFileSync('git', ['commit', '-q', '-m', 'decision'], { cwd: wt });

  const { status, output } = runCheck(wt);
  assert.equal(status, 0, output);
  assert.ok(!output.includes('no está en el índice'), output);
});

test('check en un worktree sigue fallando sin veredicto en el worktree', () => {
  const { repo, wt } = makeRepoWithWorktree('c');
  fs.mkdirSync(path.join(wt, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(wt, 'test'), { recursive: true });
  fs.writeFileSync(path.join(wt, 'lib', 'a.cjs'), "'use strict';\nmodule.exports = 1;\n");
  fs.writeFileSync(path.join(wt, 'test', 'a.test.cjs'), "'use strict';\n");
  execFileSync('git', ['add', '-A'], { cwd: wt });
  execFileSync('git', ['commit', '-q', '-m', 'cambio'], { cwd: wt });

  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim();
  const verdictOk = {
    version: 1,
    commit: head,
    branch: 't',
    verdict: 'aprobado',
    checkedAt: new Date().toISOString(),
    suites: [{ name: 'test', passed: true }],
    findings: [],
  };
  fs.writeFileSync(path.join(repo, '.qa-verdict.json'), JSON.stringify(verdictOk, null, 2) + '\n');

  const { status, output } = runCheck(wt);
  assert.equal(status, 1, output);
  assert.ok(output.includes('Falta .qa-verdict.json'), output);
});

try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch { /* ignorar */ }

console.log(`\ncheck:change rules: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
