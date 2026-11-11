/* Definition-of-done rules used by scripts/check-change.cjs. No git or browser is used. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { evaluate, samePatch } = require('../lib/check-change.cjs');

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

test('(evaluate) con un veredicto aprobado de otro commit: verdictSamePatch: true no da fallo y deja nota; false da fallo', () => {
  const otherCommit = 'b'.repeat(40);
  const verdictOther = { ...approved, commit: otherCommit };
  const changed = ['src/a.ts', 'scripts/test-a.cjs', 'docs/publishing-roadmap.md'];

  const okRes = evaluate({ ...base, changed, verdict: verdictOther, verdictSamePatch: true });
  assert.ok(!okRes.failures.some((f) => /no del actual/.test(f)));
  assert.ok(okRes.notes.some((n) => n.includes(`El veredicto es del commit ${otherCommit.slice(0, 8)}, con el mismo parche que el actual (rebase sin cambios): vale.`)));

  const failRes = evaluate({ ...base, changed, verdict: verdictOther, verdictSamePatch: false });
  assert.ok(failRes.failures.some((f) => /no del actual/.test(f)));
});

test('(evaluate) sin veredicto y con código fuente cambiado: noQaReason no da Falta y deja nota', () => {
  const changed = ['src/a.ts', 'scripts/test-a.cjs', 'docs/publishing-roadmap.md'];
  const res = evaluate({ ...base, changed, verdict: null, noQaReason: 'cambio trivial' });
  assert.ok(!res.failures.some((f) => f.includes('Falta')));
  assert.ok(res.notes.some((n) => n.includes('Sin QA, justificado: cambio trivial')));
});

test('(samePatch) compara parches tras rebase, enmienda y hash inexistente', () => {
  const repo = fs.mkdtempSync(path.join(tmpDir, 'same-patch-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@relevo.local'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Relevo Test'], { cwd: repo });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo });

  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: repo });

  execFileSync('git', ['checkout', '-q', '-b', 'feat'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'feat.txt'), 'feature\n');
  execFileSync('git', ['add', 'feat.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'feat'], { cwd: repo });
  const oldCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

  execFileSync('git', ['checkout', '-q', 'main'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'main.txt'), 'main avanzó\n');
  execFileSync('git', ['add', 'main.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'main avanzó'], { cwd: repo });

  execFileSync('git', ['checkout', '-q', 'feat'], { cwd: repo });
  execFileSync('git', ['rebase', 'main'], { cwd: repo });
  const rebasedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

  assert.notEqual(oldCommit, rebasedCommit);
  const prevCwd = process.cwd();
  process.chdir(repo);
  try {
    assert.equal(samePatch(oldCommit, rebasedCommit, 'main', repo), true);
    assert.equal(samePatch(oldCommit, rebasedCommit, 'main'), true);

    // Si se enmienda con otro contenido
    fs.writeFileSync(path.join(repo, 'feat.txt'), 'feature modificado\n');
    execFileSync('git', ['add', 'feat.txt'], { cwd: repo });
    execFileSync('git', ['commit', '--amend', '-q', '--no-edit'], { cwd: repo });
    const amendedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

    assert.equal(samePatch(oldCommit, amendedCommit, 'main', repo), false);

    // Hash inexistente
    assert.equal(samePatch('0'.repeat(40), rebasedCommit, 'main', repo), false);

    // Añadido por el auditor: dos parches vacíos (sin cambios respecto a la base) no cuentan como el mismo parche.
    assert.equal(samePatch('main', 'main', 'main', repo), false);
  } finally {
    process.chdir(prevCwd);
  }
});

test('check en un worktree ignora la entrada node_modules que no cubre el .gitignore', () => {
  const repo = path.resolve(tmpDir, 'repo-nm');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@relevo.local'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Relevo Test'], { cwd: repo });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo });

  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(path.join(repo, 'relevo.config.json'), JSON.stringify({ check: { sourcePattern: '^lib/' } }, null, 2) + '\n');
  fs.mkdirSync(path.join(repo, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'lib', 'base.cjs'), "'use strict';\n");

  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'inicial'], { cwd: repo });

  execFileSync('git', ['worktree', 'add', '-q', '.worktrees/t', '-b', 't'], { cwd: repo });
  const wt = path.resolve(repo, '.worktrees', 't');

  fs.mkdirSync(path.join(wt, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(wt, 'test'), { recursive: true });
  fs.writeFileSync(path.join(wt, 'lib', 'a.cjs'), "'use strict';\nmodule.exports = 1;\n");
  fs.writeFileSync(path.join(wt, 'test', 'a.test.cjs'), "'use strict';\n");
  execFileSync('git', ['add', '-A'], { cwd: wt });
  execFileSync('git', ['commit', '-q', '-m', 'cambio'], { cwd: wt });

  fs.writeFileSync(path.join(wt, 'node_modules'), '');

  const res1 = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'relevo.cjs'), 'check', '--sin-qa', 'prueba'], { cwd: wt, encoding: 'utf8' });
  const out1 = (res1.stdout || '') + (res1.stderr || '');
  assert.equal(res1.status, 0, out1);
  assert.ok(!out1.includes('cambios sin commit'), out1);

  fs.writeFileSync(path.join(wt, 'lib', 'b.cjs'), "'use strict';\n");
  const res2 = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'relevo.cjs'), 'check', '--sin-qa', 'prueba'], { cwd: wt, encoding: 'utf8' });
  const out2 = (res2.stdout || '') + (res2.stderr || '');
  assert.notEqual(res2.status, 0, out2);
  assert.ok(out2.includes('cambios sin commit'), out2);

  // Añadido por el auditor: el filtro solo excluye la entrada exacta, no archivos cuyo nombre contenga node_modules.
  fs.rmSync(path.join(wt, 'lib', 'b.cjs'));
  fs.writeFileSync(path.join(wt, 'lib', 'node_modules.cjs'), "'use strict';\n");
  const res3 = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'relevo.cjs'), 'check', '--sin-qa', 'prueba'], { cwd: wt, encoding: 'utf8' });
  const out3 = (res3.stdout || '') + (res3.stderr || '');
  assert.notEqual(res3.status, 0, out3);
  assert.ok(out3.includes('cambios sin commit'), out3);

  // Añadido por el auditor: una tarea sin cambios que solo tiene el enlace sigue siendo "sin cambios".
  execFileSync('git', ['worktree', 'add', '-q', '.worktrees/vacia', '-b', 'vacia'], { cwd: repo });
  const wtVacia = path.resolve(repo, '.worktrees', 'vacia');
  fs.writeFileSync(path.join(wtVacia, 'node_modules'), '');
  const res4 = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'relevo.cjs'), 'check'], { cwd: wtVacia, encoding: 'utf8' });
  const out4 = (res4.stdout || '') + (res4.stderr || '');
  assert.ok(out4.includes('No hay cambios respecto a la base'), out4);
});

test('check en un worktree detecta cambios en node_modules con seguimiento (nm-rastreado)', () => {
  const repo = path.resolve(tmpDir, 'repo-nm-rastreado');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@relevo.local'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Relevo Test'], { cwd: repo });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo });

  fs.writeFileSync(path.join(repo, '.gitignore'), '');
  fs.writeFileSync(path.join(repo, 'relevo.config.json'), JSON.stringify({ check: { sourcePattern: '^lib/' } }, null, 2) + '\n');
  fs.mkdirSync(path.join(repo, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'lib', 'base.cjs'), "'use strict';\n");
  fs.writeFileSync(path.join(repo, 'node_modules'), 'tracked\n');

  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'inicial'], { cwd: repo });

  execFileSync('git', ['worktree', 'add', '-q', '.worktrees/t', '-b', 't'], { cwd: repo });
  const wt = path.resolve(repo, '.worktrees', 't');

  fs.mkdirSync(path.join(wt, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(wt, 'test'), { recursive: true });
  fs.writeFileSync(path.join(wt, 'lib', 'a.cjs'), "'use strict';\nmodule.exports = 1;\n");
  fs.writeFileSync(path.join(wt, 'test', 'a.test.cjs'), "'use strict';\n");
  execFileSync('git', ['add', '-A'], { cwd: wt });
  execFileSync('git', ['commit', '-q', '-m', 'cambio'], { cwd: wt });

  fs.writeFileSync(path.join(wt, 'node_modules'), 'tracked modificado preparado\n');
  execFileSync('git', ['add', 'node_modules'], { cwd: wt });

  const res1 = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'relevo.cjs'), 'check', '--sin-qa', 'x'], { cwd: wt, encoding: 'utf8' });
  const out1 = (res1.stdout || '') + (res1.stderr || '');
  assert.notEqual(res1.status, 0, out1);
  assert.ok(out1.includes('cambios sin commit'), out1);
  assert.ok(out1.includes('node_modules'), out1);

  execFileSync('git', ['checkout', 'HEAD', '--', 'node_modules'], { cwd: wt });
  fs.writeFileSync(path.join(wt, 'node_modules'), 'tracked modificado no preparado\n');

  const res2 = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'relevo.cjs'), 'check', '--sin-qa', 'x'], { cwd: wt, encoding: 'utf8' });
  const out2 = (res2.stdout || '') + (res2.stderr || '');
  assert.notEqual(res2.status, 0, out2);
  assert.ok(out2.includes('cambios sin commit'), out2);
  assert.ok(out2.includes('node_modules'), out2);
});

test('check en un worktree conserva el nombre completo del archivo modificado sin preparar (nombre-completo)', () => {
  const repo = path.resolve(tmpDir, 'repo-nombre-completo');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@relevo.local'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Relevo Test'], { cwd: repo });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo });

  fs.writeFileSync(path.join(repo, '.gitignore'), '.qa-verdict.json\n.worktrees/\n');
  fs.writeFileSync(path.join(repo, 'relevo.config.json'), JSON.stringify({ check: { sourcePattern: '^lib/' } }, null, 2) + '\n');
  fs.mkdirSync(path.join(repo, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'lib', 'base.cjs'), "'use strict';\n");

  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'inicial'], { cwd: repo });

  execFileSync('git', ['worktree', 'add', '-q', '.worktrees/t', '-b', 't'], { cwd: repo });
  const wt = path.resolve(repo, '.worktrees', 't');

  fs.mkdirSync(path.join(wt, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(wt, 'test'), { recursive: true });
  fs.writeFileSync(path.join(wt, 'lib', 'a.cjs'), "'use strict';\nmodule.exports = 1;\n");
  fs.writeFileSync(path.join(wt, 'test', 'a.test.cjs'), "'use strict';\n");
  execFileSync('git', ['add', '-A'], { cwd: wt });
  execFileSync('git', ['commit', '-q', '-m', 'cambio valido'], { cwd: wt });

  fs.writeFileSync(path.join(wt, 'lib', 'base.cjs'), "'use strict';\n// modificado sin preparar\n");

  const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'relevo.cjs'), 'check', '--sin-qa', 'x'], { cwd: wt, encoding: 'utf8' });
  const out = (res.stdout || '') + (res.stderr || '');
  assert.notEqual(res.status, 0, out);
  assert.ok(out.includes('cambios sin commit'), out);
  assert.ok(out.includes('lib/base.cjs'), out);
  assert.ok(!out.includes('(ib/base.cjs)'), out);
});

const repoSinCommits = path.resolve(tmpDir, 'repo-rama-sin-commits');
fs.mkdirSync(repoSinCommits, { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoSinCommits });
execFileSync('git', ['config', 'user.email', 'test@relevo.local'], { cwd: repoSinCommits });
execFileSync('git', ['config', 'user.name', 'Relevo Test'], { cwd: repoSinCommits });
execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repoSinCommits });

fs.writeFileSync(path.join(repoSinCommits, '.gitignore'), '.worktrees/\n');
fs.writeFileSync(
  path.join(repoSinCommits, 'relevo.config.json'),
  JSON.stringify({ check: { roadmap: 'docs/hoja.md' } }, null, 2) + '\n'
);

fs.mkdirSync(path.join(repoSinCommits, 'docs'), { recursive: true });
fs.mkdirSync(path.join(repoSinCommits, 'lib'), { recursive: true });
fs.writeFileSync(path.join(repoSinCommits, 'docs', 'hoja.md'), '# Hoja v1\n');
fs.writeFileSync(path.join(repoSinCommits, 'lib', 'x.cjs'), "'use strict';\n// v1\n");
execFileSync('git', ['add', '-A'], { cwd: repoSinCommits });
execFileSync('git', ['commit', '-q', '-m', 'inicial'], { cwd: repoSinCommits });

fs.writeFileSync(path.join(repoSinCommits, 'docs', 'hoja.md'), '# Hoja v2\n');
fs.writeFileSync(path.join(repoSinCommits, 'lib', 'x.cjs'), "'use strict';\n// v2\n");
execFileSync('git', ['add', '-A'], { cwd: repoSinCommits });
execFileSync('git', ['commit', '-q', '-m', 'segundo commit en main'], { cwd: repoSinCommits });

execFileSync('git', ['worktree', 'add', '-q', '.worktrees/t', '-b', 't'], { cwd: repoSinCommits });
const wtSinCommits = path.resolve(repoSinCommits, '.worktrees', 't');
fs.writeFileSync(path.join(wtSinCommits, 'lib', 'y.cjs'), "'use strict';\n// sin confirmar\n");

test('check en una rama sin commits no usa HEAD~1 (rama-vacia)', () => {
  const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'relevo.cjs'), 'check', '--docs-only'], { cwd: wtSinCommits, encoding: 'utf8' });
  const out = (res.stdout || '') + (res.stderr || '');
  assert.equal(res.status, 1, out);
  assert.ok(out.includes('No se actualizó docs/hoja.md'), out);
  assert.ok(!out.includes('lib/x.cjs'), out);
  const match = out.match(/(\d+) archivos cambiados/);
  assert.ok(match, out);
  assert.equal(match[1], '1', out);
});

test('check en la rama base sin cambios compara el último commit (en-base)', () => {
  const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'relevo.cjs'), 'check'], { cwd: repoSinCommits, encoding: 'utf8' });
  const out = (res.stdout || '') + (res.stderr || '');
  assert.equal(res.status, 0, out);
  const match = out.match(/(\d+) archivos cambiados/);
  assert.ok(match, out);
  assert.ok(parseInt(match[1], 10) >= 2, out);
});

try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch { /* ignorar */ }

console.log(`\ncheck:change rules: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
