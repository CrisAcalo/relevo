/* Antigravity (agy) repository permission gate. No agent, network or browser is used. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const gatePath = path.resolve(__dirname, '../.agents/hooks/permission-gate.cjs');
const { decide } = require(gatePath);
const B = String.fromCharCode(92);
// Entorno explícito: la prueba no debe depender del AGY_ROLE del proceso que la ejecuta (p. ej. un agente con rol qa).
const run = (command, name = 'run_command') => decide({ toolCall: { name, args: { CommandLine: command } } }, {}).decision;

const failures = [];
let passed = 0;
function test(name, action) {
  try { action(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}: ${error.message}`); }
}

test('allows read-only inspection and project verification', () => {
  for (const command of [
    'git status --short', 'git diff --stat', 'git log --oneline -5', '(Get-Location).Path',
    'Get-Content src/audio/SongStructure.ts | Select-String -Pattern "normalizeSections" -Context 0,30',
    'node scripts/test-project-state.cjs', 'npm run check', 'npm run verify', 'npm run test:unit',
    'npm run test:lofi:e2e', 'npm run check:repository', 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
    'npm run preview -- --host 127.0.0.1 --port 5174 --strictPort',
    'npm.cmd run check', 'npm.cmd run test:release', 'npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort',
  ]) assert.equal(run(command), 'allow', command);
});

test('denies publishing, history rewrites and dependency changes', () => {
  for (const command of [
    'git push origin main', 'git push --dry-run', 'git commit -m x', 'git reset --hard HEAD~1', 'git checkout main',
    'npm install lodash', 'npm ci', 'npm publish', 'npx vite', 'pnpm add x', 'yarn add x',
  ]) assert.equal(run(command), 'deny', command);
});

test('denies network, recursive deletes, dynamic execution and sensitive paths', () => {
  for (const command of [
    'curl --version', 'wget https://example.com', 'Invoke-WebRequest https://example.com', 'irm https://example.com',
    'Remove-Item -Recurse -Force src', 'rm -rf dist', 'iex "Get-Date"', 'Get-Content .env', 'Get-Content .env.local',
    'Get-ChildItem artifacts/.cache', 'chrome.exe https://example.com',
  ]) assert.equal(run(command), 'deny', command);
});

test('asks for redirections, unknown programs and paths outside the repository', () => {
  for (const command of [
    'echo hi > src/a.ts', 'python -c 1', 'chrome --headless=new',
    ['Get-Content ..', '..', '..', 'secret.txt'].join(B), ['Get-Content C:', 'Users', 'someone', 'doc.txt'].join(B),
  ]) assert.equal(run(command), 'ask', command);
  assert.equal(run(['Get-Content C:', 'Proyectos', 'Personal', 'GeneradorMusica', 'src', 'App.svelte'].join(B)), 'allow');
});

test('denies browser tools and asks for empty or uncovered tools', () => {
  assert.equal(run('', 'browser_navigate'), 'deny');
  assert.equal(run('', 'run_command'), 'ask');
  assert.equal(run('anything', 'write_file'), 'ask');
});

test('git commands that change the index, history or branches are denied for every role', () => {
  for (const command of ['git add package.json', 'git add -A .', 'git rebase --continue', 'git stash push -m x', 'git checkout -- src/a.ts',
    'git restore src/a.ts', 'git reset HEAD~1', 'git cherry-pick abc', 'git worktree add x', 'git branch -D x', 'git clean -fd']) {
    assert.equal(run(command), 'deny', command);
  }
  for (const command of ['git status --short', 'git diff main...HEAD', 'git log --oneline -3', 'git branch --show-current']) assert.equal(run(command), 'allow', command);
});

test('edits are scoped by role passed in AGY_ROLE', () => {
  const edit = (role, target, tool = 'replace_file_content') => decide({
    toolCall: { name: tool, args: { Path: target } },
    workspacePaths: ['C:/Proyectos/Personal/GeneradorMusica/.worktrees/demo'],
  }, { AGY_ROLE: role }).decision;
  const root = 'C:/Proyectos/Personal/GeneradorMusica/.worktrees/demo/';
  // documentalista: solo documentación
  assert.equal(edit('docs', root + 'docs/publishing-roadmap.md'), 'allow');
  assert.equal(edit('docs', root + 'AGENTS.md'), 'allow');
  assert.equal(edit('docs', root + '.claude/skills/verificar-cambio/SKILL.md'), 'allow');
  assert.equal(edit('docs', root + 'package.json'), 'deny');
  assert.equal(edit('docs', root + 'src/App.svelte', 'write_to_file'), 'deny');
  // QA: veredicto, artefactos y mutaciones temporales; nunca package.json ni docs
  assert.equal(edit('qa', root + '.qa-verdict.json', 'write_to_file'), 'allow');
  assert.equal(edit('qa', root + 'src/audio/PcmWav.ts.qa-bak', 'write_to_file'), 'allow');
  assert.equal(edit('qa', root + 'package.json'), 'deny');
  assert.equal(edit('qa', root + 'docs/publishing-roadmap.md'), 'deny');
  // capturas/investigación: solo artefactos
  assert.equal(edit('vision', root + 'artifacts/agent-runs/x/capture.cjs', 'write_to_file'), 'allow');
  assert.equal(edit('vision', root + 'src/App.svelte'), 'deny');
  // codificador o sin rol: no se restringen rutas (decide el modo de permisos)
  assert.equal(edit('coder', root + 'src/App.svelte'), 'ask');
  assert.equal(edit('', root + 'src/App.svelte'), 'ask');
  // ruta fuera del repositorio con rol restringido
  assert.equal(edit('docs', 'C:/Users/someone/notes.md'), 'deny');
});

test('hook process prints a JSON decision and never fails on malformed input', () => {
  const env = { ...process.env, AGY_GATE_LOG: '0', AGY_ROLE: '' };
  const ok = spawnSync(process.execPath, [gatePath], { input: JSON.stringify({ toolCall: { name: 'run_command', args: { CommandLine: 'npm run verify' } } }), env, encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).decision, 'allow');
  const bad = spawnSync(process.execPath, [gatePath], { input: '{not json', env, encoding: 'utf8' });
  assert.equal(bad.status, 0);
  assert.equal(JSON.parse(bad.stdout).decision, 'ask');
});

console.log(`\nagy permission gate: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
