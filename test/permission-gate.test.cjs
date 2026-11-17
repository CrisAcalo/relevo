/* Antigravity (agy) repository permission gate. No agent, network or browser is used. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const gatePath = path.resolve(__dirname, '../lib/permission-gate.cjs');
const { decide, decideCodex, DEFAULTS_GATE, canonicalCommand } = require(gatePath);
const { DEFAULTS } = require('../lib/config.cjs');
const B = String.fromCharCode(92);
// Entorno explícito: la prueba no debe depender del AGY_ROLE del proceso que la ejecuta (p. ej. un agente con rol qa).
const run = (command, name = 'run_command') => decide({
  toolCall: { name, args: { CommandLine: command } },
  workspacePaths: ['C:/Proyectos/Personal/GeneradorMusica'],
}, {}).decision;

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
  assert.equal(edit('docs', root + 'README.md'), 'allow');
  assert.equal(edit('docs', root + 'package.json'), 'deny');
  assert.equal(edit('docs', root + 'src/App.svelte', 'write_to_file'), 'deny');
  // QA: solo veredicto y artefactos (mutantes en artifacts/qa-mutantes); nunca código, pruebas, package.json ni docs
  assert.equal(edit('qa', root + '.qa-verdict.json', 'write_to_file'), 'allow');
  assert.equal(edit('qa', root + 'src/x.ts'), 'deny');
  assert.equal(edit('qa', root + 'src/x.ts', 'write_to_file'), 'deny');
  assert.equal(edit('qa', root + 'src/audio/PcmWav.ts.qa-bak', 'write_to_file'), 'deny');
  assert.equal(edit('qa', root + 'scripts/build.cjs'), 'deny');
  assert.equal(edit('qa', root + 'test/x.test.cjs'), 'deny');
  assert.equal(edit('qa', root + 'lib/x.cjs'), 'deny');
  assert.equal(edit('qa', root + 'artifacts/qa-mutantes/x', 'write_to_file'), 'allow');
  assert.equal(edit('qa', root + 'artifacts/qa-mutantes/demo/src/x.ts'), 'allow');
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

test('la ruta absoluta del proyecto original ya NO se trata como interna cuando la puerta está instalada en otro repo; rutas internas sí', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-repo-'));
  const hooksDir = path.join(tempRepo, '.agents', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const tempGatePath = path.join(hooksDir, 'permission-gate.cjs');
  fs.copyFileSync(gatePath, tempGatePath);
  const { decide: tempDecide } = require(tempGatePath);

  // La ruta del proyecto original ahora es externa al tempRepo -> ask
  const oldRepoCommand = 'Get-Content C:' + B + 'Proyectos' + B + 'Personal' + B + 'GeneradorMusica' + B + 'src' + B + 'x.ts';
  const oldRepoRes = tempDecide({ toolCall: { name: 'run_command', args: { CommandLine: oldRepoCommand } } }, {});
  assert.equal(oldRepoRes.decision, 'ask');

  // Una ruta dentro de tempRepo sí se permite
  const internalCommand = 'Get-Content ' + path.join(tempRepo, 'src', 'x.ts');
  const internalRes = tempDecide({ toolCall: { name: 'run_command', args: { CommandLine: internalCommand } } }, {});
  assert.equal(internalRes.decision, 'allow');

  // Limpieza
  fs.rmSync(tempRepo, { recursive: true, force: true });
});

test('npmScripts: ["test"] permite npm test y deja en ask npm run build', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-npm-'));
  const hooksDir = path.join(tempRepo, '.agents', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const tempGatePath = path.join(hooksDir, 'permission-gate.cjs');
  fs.copyFileSync(gatePath, tempGatePath);
  const { decide: tempDecide } = require(tempGatePath);

  fs.writeFileSync(path.join(tempRepo, 'relevo.config.json'), JSON.stringify({
    gate: { npmScripts: ['test'] },
  }));

  const testRes = tempDecide({ toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } } }, {});
  assert.equal(testRes.decision, 'allow');

  const buildRes = tempDecide({ toolCall: { name: 'run_command', args: { CommandLine: 'npm run build' } } }, {});
  assert.equal(buildRes.decision, 'ask');

  fs.rmSync(tempRepo, { recursive: true, force: true });
});

test('scriptsDirs: ["tools"] permite node tools/a.cjs y deja en ask node scripts/a.cjs', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-scripts-'));
  const hooksDir = path.join(tempRepo, '.agents', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const tempGatePath = path.join(hooksDir, 'permission-gate.cjs');
  fs.copyFileSync(gatePath, tempGatePath);
  const { decide: tempDecide } = require(tempGatePath);

  fs.writeFileSync(path.join(tempRepo, 'relevo.config.json'), JSON.stringify({
    gate: { scriptsDirs: ['tools'] },
  }));

  const toolsRes = tempDecide({ toolCall: { name: 'run_command', args: { CommandLine: 'node tools/a.cjs' } } }, {});
  assert.equal(toolsRes.decision, 'allow');

  const scriptsRes = tempDecide({ toolCall: { name: 'run_command', args: { CommandLine: 'node scripts/a.cjs' } } }, {});
  assert.equal(scriptsRes.decision, 'ask');

  fs.rmSync(tempRepo, { recursive: true, force: true });
});

test('roleScopes personalizado aplica', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-roles-'));
  const hooksDir = path.join(tempRepo, '.agents', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const tempGatePath = path.join(hooksDir, 'permission-gate.cjs');
  fs.copyFileSync(gatePath, tempGatePath);
  const { decide: tempDecide } = require(tempGatePath);

  fs.writeFileSync(path.join(tempRepo, 'relevo.config.json'), JSON.stringify({
    gate: { roleScopes: { customRole: ['^custom/'] } },
  }));

  const allowedEdit = tempDecide({
    toolCall: { name: 'replace_file_content', args: { Path: path.join(tempRepo, 'custom/file.txt') } },
  }, { AGY_ROLE: 'customRole' });
  assert.equal(allowedEdit.decision, 'allow');

  const deniedEdit = tempDecide({
    toolCall: { name: 'replace_file_content', args: { Path: path.join(tempRepo, 'src/file.txt') } },
  }, { AGY_ROLE: 'customRole' });
  assert.equal(deniedEdit.decision, 'deny');

  fs.rmSync(tempRepo, { recursive: true, force: true });
});

test('configuración inválida → deny', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-invalid-'));
  const hooksDir = path.join(tempRepo, '.agents', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const tempGatePath = path.join(hooksDir, 'permission-gate.cjs');
  fs.copyFileSync(gatePath, tempGatePath);
  const { decide: tempDecide } = require(tempGatePath);

  fs.writeFileSync(path.join(tempRepo, 'relevo.config.json'), '{ invalid json');

  const res = tempDecide({ toolCall: { name: 'run_command', args: { CommandLine: 'git status' } } }, {});
  assert.equal(res.decision, 'deny');
  assert.ok(res.reason.includes('Configuración inválida en relevo.config.json'));

  fs.writeFileSync(path.join(tempRepo, 'relevo.config.json'), JSON.stringify({
    gate: { npmScripts: 123 },
  }));
  const res2 = tempDecide({ toolCall: { name: 'run_command', args: { CommandLine: 'git status' } } }, {});
  assert.equal(res2.decision, 'deny');

  fs.rmSync(tempRepo, { recursive: true, force: true });
});

test('los valores por defecto de la puerta coinciden con DEFAULTS.gate de lib/config.cjs', () => {
  assert.deepEqual(DEFAULTS_GATE, DEFAULTS.gate);
});

test('variantes de comandos prohibidos se deniegan (forma canónica)', () => {
  for (const command of [
    'npm.cmd install lodash', 'npm.cmd i lodash', 'npm.cmd ci', 'npx.cmd vite',
    'git.exe push', 'git.exe commit -m x', 'git -C . commit -m x', 'git -C .worktrees/x push origin main',
    'git -c user.name=x commit -m x', 'git --git-dir=.git --work-tree=. reset --hard', 'git --no-pager -C . checkout main',
    'git -C "C:/a b" push', 'git update-ref -d HEAD', 'git symbolic-ref HEAD refs/heads/x',
    'git config core.hooksPath x', 'git config --global user.name x', 'git fetch origin', 'git pull',
    'git clone https://example.com/x.git', 'git submodule update', 'git init', 'git gc --prune=now',
    'git reflog expire --all', 'git filter-branch', 'git notes add', 'git replace a b', 'git read-tree HEAD',
    'git update-index --assume-unchanged a', 'ri -r x', 'ri x -Recurse', 'Remove-Item -Path x -Recurse',
    'del /q /s x', 'erase /s x', 'rd /s /q x', 'rmdir /q /s x', 'cmd /c rd /s /q x',
    'rm -fr dist', 'rm -r -f x', 'rm --recursive x',
    '& "git.exe" push', '& "git" push', '"C:/Program Files/Git/cmd/git.exe" push',
    "& 'git' commit -m x", 'npm --prefix . install x', 'npm.cmd --silent install x',
    'npm --registry=https://r.example install x', 'npm.cmd -g install x',
    // Exige la segunda pasada de canonicalCommand: programa entre comillas seguido de opciones globales de git.
    '"C:/Program Files/Git/cmd/git.exe" -C . push',
    'git branch --delete feature', 'git branch --move old new', 'git branch --force main HEAD~1',
    'git branch -r -d origin/feature', 'git branch -rd x', 'git branch --copy a b', 'git branch -u origin/main',
    'git branch --set-upstream-to=origin/main', 'git -C . branch --delete x',
    'npm add lodash', 'npm remove lodash', 'npm rm lodash', 'npm un lodash', 'npm.cmd add x', 'npm r x', 'npm up', 'npm x vite',
    'git -C. push', 'git -cuser.name=x push',
  ]) {
    assert.equal(run(command), 'deny', command);
    assert.equal(decide({
      toolCall: { name: 'run_command', args: { CommandLine: command } },
      workspacePaths: ['C:/Proyectos/Personal/GeneradorMusica'],
    }, { AGY_ROLE: 'coder' }).decision, 'deny', command);
  }
});

test('la forma canónica no deniega lectura ni verificación', () => {
  for (const command of [
    'git status --short', 'git diff --stat', 'git log --oneline -5', 'git show HEAD', 'git branch',
    'Get-ChildItem -Recurse src', 'Get-Content README.md -Raw', 'Get-Content docs/rd.md',
    'npm.cmd run check', 'npm run test:unit',
    'git branch -a', 'git branch -vv', 'git branch --show-current', 'git branch -r', 'git branch --list', 'npm test',
  ]) {
    assert.equal(run(command), 'allow', command);
  }
  for (const command of [
    'git -C . status', 'Copy-Item src/a.ts artifacts/qa-mutantes/t/src/a.ts', 'Copy-Item -Recurse src artifacts/qa-mutantes/t/src',
    'Remove-Item artifacts/qa-mutantes/t/src/a.ts', 'echo digit -C x', 'Select-String -Path src -Pattern config',
    'npm --version',
    'git branch nueva', 'git branch --merged main', 'npm run release -- --dry-run',
  ]) {
    assert.notEqual(run(command), 'deny', command);
  }
});

test('canonicalCommand normaliza ejecutables y opciones globales de git', () => {
  assert.equal(canonicalCommand('git -C . commit -m x'), 'git commit -m x');
  assert.equal(canonicalCommand('git --no-pager -C "C:/a b" push'), 'git push');
  assert.equal(canonicalCommand('git.exe -c user.name=x push'), 'git push');
  assert.equal(canonicalCommand('npm.cmd   install   lodash'), 'npm install lodash');
  assert.equal(canonicalCommand('git status'), 'git status');
  assert.equal(canonicalCommand('git commit -c x'), 'git commit -c x');
  assert.equal(canonicalCommand('& "git.exe" push'), '& git push');
  assert.equal(canonicalCommand('git -C. push'), 'git push');
  assert.equal(canonicalCommand('git -cuser.name=x push'), 'git push');
});

test('la copia instalada en .agents/hooks es idéntica a lib/permission-gate.cjs', () => {
  const libGate = fs.readFileSync(path.resolve(__dirname, '../lib/permission-gate.cjs'), 'utf8');
  const hookGate = fs.readFileSync(path.resolve(__dirname, '../.agents/hooks/permission-gate.cjs'), 'utf8');
  assert.equal(hookGate, libGate);
});

test('la forma canónica nunca sirve para permitir', () => {
  for (const command of [
    'git -C . status',
    'git.exe status',
    'git --no-pager log',
    '"git" status',
  ]) {
    assert.equal(run(command), 'ask', command);
  }
});

test('git branch solo se permite para listar', () => {
  for (const command of [
    'git branch nueva',
    'git branch --merged main',
    'git -C. status',
  ]) {
    assert.equal(run(command), 'ask', command);
  }
});

function edit(tempDecide, tempRepo, rel, role) {
  return tempDecide({
    toolCall: { name: 'replace_file_content', args: { Path: path.join(tempRepo, rel) } },
  }, { AGY_ROLE: role }).decision;
}

test('redefinir un rol en roleScopes no quita la restricción de los demás', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-r1-'));
  const hooksDir = path.join(tempRepo, '.agents', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const tempGatePath = path.join(hooksDir, 'permission-gate.cjs');
  fs.copyFileSync(gatePath, tempGatePath);
  const { decide: tempDecide } = require(tempGatePath);

  fs.writeFileSync(path.join(tempRepo, 'relevo.config.json'), JSON.stringify({
    gate: { roleScopes: { qa: ['^lib/'] } },
  }));

  for (const role of ['docs', 'vision', 'research', 'review']) {
    assert.equal(edit(tempDecide, tempRepo, 'lib/x.cjs', role), 'deny', role);
  }
  assert.equal(edit(tempDecide, tempRepo, 'lib/x.cjs', 'qa'), 'allow');
  assert.equal(edit(tempDecide, tempRepo, 'lib/x.cjs', 'coder'), 'ask');

  assert.equal(edit(tempDecide, tempRepo, 'docs/a.md', 'docs'), 'allow');
  assert.equal(edit(tempDecide, tempRepo, 'artifacts/a.txt', 'vision'), 'allow');

  assert.equal(edit(tempDecide, tempRepo, 'test/x.test.cjs', 'qa'), 'deny');

  fs.rmSync(tempRepo, { recursive: true, force: true });
});

test('roleScopes: null quita la restricción de un rol y [] no permite nada', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-r2-'));
  const hooksDir = path.join(tempRepo, '.agents', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const tempGatePath = path.join(hooksDir, 'permission-gate.cjs');
  fs.copyFileSync(gatePath, tempGatePath);
  const { decide: tempDecide } = require(tempGatePath);

  fs.writeFileSync(path.join(tempRepo, 'relevo.config.json'), JSON.stringify({
    gate: { roleScopes: { qa: null, docs: [] } },
  }));

  assert.equal(edit(tempDecide, tempRepo, 'lib/x.cjs', 'qa'), 'ask');
  assert.equal(edit(tempDecide, tempRepo, 'docs/a.md', 'docs'), 'deny');
  assert.equal(edit(tempDecide, tempRepo, 'lib/x.cjs', 'vision'), 'deny');

  fs.rmSync(tempRepo, { recursive: true, force: true });
});

test('roleScopes inválido sigue denegando todo', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-r3-'));
  const hooksDir = path.join(tempRepo, '.agents', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const tempGatePath = path.join(hooksDir, 'permission-gate.cjs');
  fs.copyFileSync(gatePath, tempGatePath);
  const { decide: tempDecide } = require(tempGatePath);

  const configs = [
    { gate: { roleScopes: null } },
    { gate: { roleScopes: { qa: '^lib/' } } },
    { gate: { roleScopes: { qa: [1] } } },
    { gate: { roleScopes: { qa: ['('] } } },
  ];

  for (const cfg of configs) {
    fs.writeFileSync(path.join(tempRepo, 'relevo.config.json'), JSON.stringify(cfg));
    assert.equal(edit(tempDecide, tempRepo, 'docs/a.md', 'docs'), 'deny', JSON.stringify(cfg));
    const res = tempDecide({ toolCall: { name: 'run_command', args: { CommandLine: 'git status' } } }, {});
    assert.equal(res.decision, 'deny', JSON.stringify(cfg));
  }

  fs.rmSync(tempRepo, { recursive: true, force: true });
});

test('un rol con nombre de propiedad heredada no rompe la puerta', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-r4-'));
  const hooksDir = path.join(tempRepo, '.agents', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const tempGatePath = path.join(hooksDir, 'permission-gate.cjs');
  fs.copyFileSync(gatePath, tempGatePath);
  const { decide: tempDecide } = require(tempGatePath);

  assert.equal(edit(tempDecide, tempRepo, 'lib/x.cjs', 'constructor'), 'ask');
  assert.equal(edit(tempDecide, tempRepo, 'lib/x.cjs', 'toString'), 'ask');

  fs.rmSync(tempRepo, { recursive: true, force: true });
});

test('clave __proto__ en relevo.config.json deniega todo', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-r5-'));
  const hooksDir = path.join(tempRepo, '.agents', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const tempGatePath = path.join(hooksDir, 'permission-gate.cjs');
  fs.copyFileSync(gatePath, tempGatePath);
  const { decide: tempDecide } = require(tempGatePath);

  const configs = [
    '{"gate":{"roleScopes":{"__proto__":["^lib/"]}}}',
    '{"__proto__":{}}',
    '{"gate":{"__proto__":{"roleScopes":{}}}}',
  ];

  for (const cfg of configs) {
    fs.writeFileSync(path.join(tempRepo, 'relevo.config.json'), cfg);
    assert.equal(edit(tempDecide, tempRepo, 'lib/x.cjs', '__proto__'), 'deny', cfg);
    assert.equal(edit(tempDecide, tempRepo, 'docs/a.md', 'docs'), 'deny', cfg);
    const res = tempDecide({ toolCall: { name: 'run_command', args: { CommandLine: 'git status' } } }, {});
    assert.equal(res.decision, 'deny', cfg);
    assert.ok(res.reason && res.reason.includes('clave no permitida'), cfg);
  }

  fs.rmSync(tempRepo, { recursive: true, force: true });
});

test('constructor como rol en relevo.config.json funciona', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-r6-'));
  const hooksDir = path.join(tempRepo, '.agents', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const tempGatePath = path.join(hooksDir, 'permission-gate.cjs');
  fs.copyFileSync(gatePath, tempGatePath);
  const { decide: tempDecide } = require(tempGatePath);

  fs.writeFileSync(path.join(tempRepo, 'relevo.config.json'), '{"gate":{"roleScopes":{"constructor":["^lib/"]}}}');

  assert.equal(edit(tempDecide, tempRepo, 'lib/x.cjs', 'constructor'), 'allow');
  assert.equal(edit(tempDecide, tempRepo, 'src/x.cjs', 'constructor'), 'deny');
  assert.equal(edit(tempDecide, tempRepo, 'lib/x.cjs', 'docs'), 'deny');

  fs.rmSync(tempRepo, { recursive: true, force: true });
});

test('Start-Process y sus alias se deniegan; npm start y nombres parecidos no', () => {
  for (const command of [
    'Start-Process git -ArgumentList push',
    'Start-Process -FilePath git -ArgumentList "push","origin"',
    'saps git push',
    'start git push',
    'cmd /c start git push',
    'powershell -c "Start-Process git push"',
    'Start-Process -FilePath notepad.exe',
    "Start-Process npm.cmd -ArgumentList 'run','dev'",
    'START-PROCESS git push',
    'Get-Date; Start-Process git push',
    'cmd.exe /c "start /b git push"',
    'powershell -Command start git push',
    '(Start-Process git -PassThru)',
    // Añadidos por el auditor: el alias start lanzando algo que ninguna otra regla deniega.
    'start notepad.exe',
    'cmd /c start calc.exe',
    'cmd /k start calc.exe',
    'cmd.exe /k start calc.exe',
    'cmd /k "start calc.exe"',
    'cmd /r start calc.exe',
  ]) {
    assert.equal(run(command), 'deny', command);
  }
  for (const command of [
    // Añadidos por el auditor: start como argumento seguido de más argumentos no es el alias.
    'npm start -- --port 3000',
    'npm run start -- --host 127.0.0.1',
    'npm start',
    'npm run start',
    'npm.cmd start',
    'git log --grep start',
    'Get-Content start.md',
    'Restart-Service x',
    'node scripts/start-server.cjs',
    'Select-String -Path src -Pattern "Start-Processing"',
    'echo restart',
    'cmd /k echo start',
  ]) {
    assert.notEqual(run(command), 'deny', command);
  }
  assert.equal(run('Start-Job { git push }'), 'deny');
  assert.equal(run('Start-Job -ScriptBlock { npm.cmd install x }'), 'deny');
});

const codex = (toolName, toolInput, env = {}) => decideCodex({
  hook_event_name: 'PreToolUse',
  tool_name: toolName,
  tool_input: toolInput,
  cwd: 'C:/Proyectos/Personal/GeneradorMusica',
}, env).decision;

test('(cx-bash)', () => {
  assert.equal(codex('Bash', { command: 'git push' }), 'deny');
  assert.equal(codex('Bash', { command: 'npm.cmd install x' }), 'deny');
  assert.equal(codex('Bash', { command: 'Start-Process git push' }), 'deny');
  assert.equal(codex('Bash', { command: 'git status' }), 'allow');
});

test('(cx-patch)', () => {
  const env = { AGY_ROLE: 'docs' };
  assert.notEqual(codex('apply_patch', {
    command: '*** Begin Patch\n*** Update File: docs/a.md\n@@\n-x\n+y\n*** End Patch',
  }, env), 'deny');
  assert.equal(codex('apply_patch', {
    command: '*** Begin Patch\n*** Add File: lib/x.cjs\n+1\n*** End Patch',
  }, env), 'deny');
  assert.equal(codex('apply_patch', {
    command: '*** Begin Patch\n*** Update File: docs/a.md\n*** Move to: lib/y.cjs\n*** End Patch',
  }, env), 'deny');
  assert.equal(codex('apply_patch', {
    command: '*** Begin Patch\n*** End Patch',
  }, env), 'deny');
  assert.notEqual(codex('apply_patch', {
    command: '*** Begin Patch\n*** Add File: lib/x.cjs\n+1\n*** End Patch',
  }, { AGY_ROLE: 'coder' }), 'deny');
});

test('(cx-mcp)', () => {
  assert.equal(codex('mcp__cua_repl__js', { code: 'x' }), 'deny');
  assert.equal(codex('WebSearch', {}), 'ask');
});

test('(cx-proceso)', () => {
  const payloadCodexDeGitPush = {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git push' },
    cwd: 'C:/Proyectos/Personal/GeneradorMusica',
  };
  const env = { ...process.env, AGY_GATE_LOG: '0' };
  const resPush = spawnSync(process.execPath, [gatePath], {
    input: JSON.stringify(payloadCodexDeGitPush),
    env,
    encoding: 'utf8',
  });
  assert.equal(resPush.status, 0);
  const parsedPush = JSON.parse(resPush.stdout);
  assert.equal(parsedPush.hookSpecificOutput?.permissionDecision, 'deny');
  assert.equal(parsedPush.hookSpecificOutput?.hookEventName, 'PreToolUse');

  const payloadCodexDeGitStatus = {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git status' },
    cwd: 'C:/Proyectos/Personal/GeneradorMusica',
  };
  const resStatus = spawnSync(process.execPath, [gatePath], {
    input: JSON.stringify(payloadCodexDeGitStatus),
    env,
    encoding: 'utf8',
  });
  assert.equal(resStatus.status, 0);
  assert.equal(resStatus.stdout, '{}');

  const payloadAgy = {
    toolCall: { name: 'run_command', args: { CommandLine: 'git push' } },
  };
  const resAgy = spawnSync(process.execPath, [gatePath], {
    input: JSON.stringify(payloadAgy),
    env,
    encoding: 'utf8',
  });
  assert.equal(resAgy.status, 0);
  const parsedAgy = JSON.parse(resAgy.stdout);
  assert.equal(parsedAgy.decision, 'deny');
});

test('(sens-edit)', () => {
  const root = 'C:/Proyectos/Personal/GeneradorMusica/.worktrees/demo/';
  const repo = 'C:/Proyectos/Personal/GeneradorMusica/.worktrees/demo';
  const env = { AGY_ROLE: 'coder' };

  assert.equal(decide({
    toolCall: { name: 'write_to_file', args: { TargetFile: root + '.env' } },
    workspacePaths: [repo],
  }, env).decision, 'deny');

  const patch = (command) => decideCodex({
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { command },
    cwd: repo,
  }, env).decision;

  assert.equal(patch('*** Add File: .env'), 'deny');
  assert.equal(patch('*** Update File: config/.env.local'), 'deny');
  assert.equal(patch('*** Update File: artifacts/.cache/x'), 'deny');
  assert.notEqual(patch('*** Update File: src/env.ts'), 'deny');

  // Añadido por el auditor: un .env fuera del repositorio no tiene ruta relativa; lo protege la ruta completa.
  assert.equal(decide({
    toolCall: { name: 'write_to_file', args: { TargetFile: 'D:/otro-proyecto/.env' } },
    workspacePaths: [repo],
  }, env).decision, 'deny');
  assert.equal(patch('*** Update File: D:/otro-proyecto/.env'), 'deny');
});

test('(cx-mayus)', () => {
  assert.equal(decideCodex({
    hook_event_name: 'PreToolUse',
    tool_name: 'BASH',
    tool_input: { command: 'git push' },
    cwd: 'C:/Proyectos/Personal/GeneradorMusica',
  }).decision, 'deny');
  assert.equal(decideCodex({
    hook_event_name: 'PreToolUse',
    tool_name: 'MCP__x',
    tool_input: {},
    cwd: 'C:/Proyectos/Personal/GeneradorMusica',
  }).decision, 'deny');
});

test('(dotdot-rol)', () => {
  const repo = 'C:/Proyectos/Personal/GeneradorMusica/.worktrees/demo';
  const edit = (role, target) => decide({
    toolCall: { name: 'write_to_file', args: { TargetFile: target } },
    workspacePaths: [repo],
  }, { AGY_ROLE: role }).decision;

  assert.equal(edit('docs', repo + '/docs/../lib/x.cjs'), 'deny');
  assert.equal(edit('qa', repo + '/artifacts/../lib/x.cjs'), 'deny');
  assert.equal(edit('docs', repo + '/docs/sub/../a.md'), 'allow');
  assert.equal(edit('docs', repo + '/docs/a.md'), 'allow');
});

test('(dotdot-sensible)', () => {
  const repo = 'C:/Proyectos/Personal/GeneradorMusica/.worktrees/demo';
  const env = { AGY_ROLE: 'coder' };

  assert.equal(decide({
    toolCall: { name: 'write_to_file', args: { TargetFile: repo + '/artifacts/sub/../.cache/x' } },
    workspacePaths: [repo],
  }, env).decision, 'deny');
  assert.equal(decide({
    toolCall: { name: 'write_to_file', args: { TargetFile: repo + '/src/../.env' } },
    workspacePaths: [repo],
  }, env).decision, 'deny');
});

test('(dotdot-codex)', () => {
  const repo = 'C:/Proyectos/Personal/GeneradorMusica/.worktrees/demo';
  assert.equal(decideCodex({
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { command: '*** Update File: docs/../lib/x.cjs' },
    cwd: repo,
  }, { AGY_ROLE: 'docs' }).decision, 'deny');
});

test('(cmd-dotdot-sensible)', () => {
  const repo = 'C:/Proyectos/Personal/GeneradorMusica/.worktrees/demo';
  const env = { AGY_ROLE: 'coder' };
  const cmd = (command) => decide({
    toolCall: { name: 'run_command', args: { CommandLine: command } },
    workspacePaths: [repo],
  }, env).decision;

  assert.equal(cmd('Get-Content artifacts/./.cache/c.txt'), 'deny');
  assert.equal(cmd('Get-Content artifacts/x/../.cache/c.txt'), 'deny');
  assert.equal(cmd(String.raw`Get-Content "artifacts\x\..\.cache\c.txt"`), 'deny');
  assert.equal(cmd('Get-Content src/../.env'), 'deny');
  assert.notEqual(cmd('Get-Content src/app.js'), 'deny');
});

test('(codex-dotdot-sensible)', () => {
  const repo = 'C:/Proyectos/Personal/GeneradorMusica/.worktrees/demo';
  assert.equal(decideCodex({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'cat artifacts/x/../.cache/c.txt' },
    cwd: repo,
  }, { AGY_ROLE: 'coder' }).decision, 'deny');
});

test('(cmd-espacios-sensible)', () => {
  const repo = 'C:/Proyectos/Personal/GeneradorMusica/.worktrees/demo';
  const env = { AGY_ROLE: 'coder' };
  const cmd = (command) => decide({
    toolCall: { name: 'run_command', args: { CommandLine: command } },
    workspacePaths: [repo],
  }, env).decision;

  assert.equal(cmd("cat 'artifacts/mi carpeta/../.cache/c'"), 'deny');
  assert.equal(cmd('Get-Content "artifacts/mi carpeta/../.cache/c"'), 'deny');
  assert.equal(cmd(String.raw`cat artifacts/mi\ carpeta/../.cache/c`), 'deny');
  assert.equal(cmd('Get-Content artifacts/mi` carpeta/../.cache/c'), 'deny');
  assert.equal(cmd(String.raw`cat "artifacts\mi carpeta\..\.cache\c"`), 'deny');
});

test('(cmd-dotdot-componente)', () => {
  const repo = 'C:/Proyectos/Personal/GeneradorMusica/.worktrees/demo';
  const env = { AGY_ROLE: 'coder' };
  const cmd = (command) => decide({
    toolCall: { name: 'run_command', args: { CommandLine: command } },
    workspacePaths: [repo],
  }, env).decision;

  assert.equal(cmd('cat src/../x/../.env'), 'deny');
  assert.equal(cmd(String.raw`type ..\.env`), 'deny');
  assert.notEqual(cmd('Get-Content src/../README.md'), 'deny');
  assert.notEqual(cmd('node test/x.cjs'), 'deny');
  assert.notEqual(cmd('cat docs/cache.md'), 'deny');
  // Añadidas por el auditor: casos que la normalización por palabras no reconstruye; solo los detiene la regla de .. + hoja.
  assert.equal(cmd('cat $(echo artifacts/x)/../.cache/c'), 'deny');
  assert.equal(cmd('Get-Content (Join-Path artifacts x)/../.cache/c'), 'deny');
  // Sin .. no se aplica: una carpeta .cache cualquiera no es sensible.
  assert.notEqual(cmd('Get-Content src/.cache/c'), 'deny');
});

test('(codex-espacios-sensible)', () => {
  const repo = 'C:/Proyectos/Personal/GeneradorMusica/.worktrees/demo';
  assert.equal(decideCodex({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: "cat 'artifacts/mi carpeta/../.cache/c'" },
    cwd: repo,
  }, { AGY_ROLE: 'coder' }).decision, 'deny');
});

test('(marcador-externo)', () => {
  const repo = 'C:/Proyectos/Personal/GeneradorMusica/.worktrees/demo';
  const nombre = path.basename(path.resolve(path.dirname(gatePath), '../..'));
  const write = (target) => decide({
    toolCall: { name: 'write_to_file', args: { TargetFile: target } },
    workspacePaths: [repo],
  }, { AGY_ROLE: 'docs' }).decision;

  assert.equal(write('D:/x/' + nombre + '/docs/a.md'), 'deny');
  assert.equal(write('../../../' + nombre + '/docs/a.md'), 'deny');
  assert.equal(write(repo + '/docs/a.md'), 'allow');
  assert.equal(write('docs/a.md'), 'allow');
});

test('(cmd-dotdot-delimitadores)', () => {
  const repo = 'C:/Proyectos/Personal/GeneradorMusica/.worktrees/demo';
  const env = { AGY_ROLE: 'coder' };
  const cmd = (command) => decide({
    toolCall: { name: 'run_command', args: { CommandLine: command } },
    workspacePaths: [repo],
  }, env).decision;

  assert.equal(cmd('cat $DIR/../.cache;echo ok'), 'deny');
  assert.equal(cmd('Get-Content (Join-Path artifacts a)/../.cache|Select-Object -First 1'), 'deny');
  assert.equal(cmd('cat --file=artifacts/../.cache;echo ok'), 'deny');
  assert.equal(cmd("cat 'artifacts/mi carpeta'/../.cache;echo ok"), 'deny');
  assert.equal(cmd('cat ../.env&&echo'), 'deny');
  assert.equal(cmd('(cat ../.env)'), 'deny');

  assert.notEqual(cmd('cat docs/my.cache.md'), 'deny');
  assert.notEqual(cmd('cat ../x.envrc'), 'deny');
  assert.notEqual(cmd('Get-Content src/../README.md;echo ok'), 'deny');
  // Añadidas por el auditor: controles con .. que fijan los límites de la hoja y del segmento.
  assert.notEqual(cmd('cat ../my.cache'), 'deny');
  assert.notEqual(cmd('cat ../.envrc'), 'deny');
  assert.notEqual(cmd('cat src/a..b/.cache/c'), 'deny');
});

test('gate.commands: prefijos de comandos permitidos y rechazo de valores inválidos', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-commands-'));
  const hooksDir = path.join(tempRepo, '.agents', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const tempGatePath = path.join(hooksDir, 'permission-gate.cjs');
  fs.copyFileSync(gatePath, tempGatePath);
  const { decide: tempDecide } = require(tempGatePath);

  // Sin configuración, go test ./... queda en ask.
  const sinConfig = tempDecide({ toolCall: { name: 'run_command', args: { CommandLine: 'go test ./...' } } }, {});
  assert.equal(sinConfig.decision, 'ask');

  fs.writeFileSync(path.join(tempRepo, 'relevo.config.json'), JSON.stringify({
    gate: { commands: ['go test', 'go vet', 'go -C servidor test'] },
  }));

  const cases = [
    ['go test ./...', 'allow'],
    ['go vet ./internal/...', 'allow'],
    ['go -C servidor test ./...', 'allow'],
    ['GO TEST ./...', 'allow'],
    ['go run .', 'ask'],
    ['go get x', 'ask'],
    ['go', 'ask'],
    ['go testx', 'ask'],
    ['go -C otra test ./...', 'ask'],
    ['go test ./... ; go run .', 'ask'],
    ['go test ./... && git push', 'deny'],
    ['go test ./... > salida.txt', 'ask'],
    ['go test ./... ; cat .env', 'deny'],
  ];

  for (const [command, expected] of cases) {
    const res = tempDecide({ toolCall: { name: 'run_command', args: { CommandLine: command } } }, {});
    assert.equal(res.decision, expected, `Esperaba ${expected} para "${command}" pero fue ${res.decision}`);
  }

  const invalidCommands = [
    ['go'],
    ['go test; rm x'],
    ['go $(x)'],
    [''],
    [5],
    'go test',
  ];

  for (const invalid of invalidCommands) {
    fs.writeFileSync(path.join(tempRepo, 'relevo.config.json'), JSON.stringify({
      gate: { commands: invalid },
    }));
    const res = tempDecide({ toolCall: { name: 'run_command', args: { CommandLine: 'git status' } } }, {});
    assert.equal(res.decision, 'deny', `Esperaba deny para git status con commands=${JSON.stringify(invalid)}`);
    assert.ok(res.reason.includes('gate.commands'), `La razón debe nombrar gate.commands: "${res.reason}"`);
  }

  fs.rmSync(tempRepo, { recursive: true, force: true });
});

test('la puerta divide los segmentos también en & solo y en saltos de línea', () => {
  const cases = [
    ['cat README.md & Remove-Item lib/x.cjs', 'ask'],
    ["cat README.md\nRemove-Item lib/x.cjs", 'ask'],
    ["cat README.md\r\nRemove-Item lib/x.cjs", 'ask'],
    ['cat README.md & git status', 'allow'],
    ["cat README.md\ngit status", 'allow'],
  ];

  for (const [command, expected] of cases) {
    const res = run(command);
    assert.equal(res, expected, `Esperaba ${expected} para "${command.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}" pero fue ${res}`);
  }
});

test('la puerta divide los segmentos en & solo y en saltos de línea con gate.commands', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-commands-segments-'));
  const hooksDir = path.join(tempRepo, '.agents', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const tempGatePath = path.join(hooksDir, 'permission-gate.cjs');
  fs.copyFileSync(gatePath, tempGatePath);
  const { decide: tempDecide } = require(tempGatePath);

  fs.writeFileSync(path.join(tempRepo, 'relevo.config.json'), JSON.stringify({
    gate: { commands: ['go test'] },
  }));

  const cases = [
    ['go test ./... & Remove-Item x', 'ask'],
    ["go test ./...\nRemove-Item x", 'ask'],
  ];

  for (const [command, expected] of cases) {
    const res = tempDecide({ toolCall: { name: 'run_command', args: { CommandLine: command } } }, {});
    assert.equal(res.decision, expected, `Esperaba ${expected} para "${command.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}" pero fue ${res.decision}`);
  }

  fs.rmSync(tempRepo, { recursive: true, force: true });
});

test('la puerta divide los segmentos también en \\r solo', () => {
  const cases = [
    ["cat README.md\rRemove-Item lib/x.cjs", 'ask'],
    ["git status\rRemove-Item lib/x.cjs", 'ask'],
    ["cat README.md\rgit status", 'allow'],
  ];

  for (const [command, expected] of cases) {
    const res = run(command);
    assert.equal(res, expected, `Esperaba ${expected} para "${command.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}" pero fue ${res}`);
  }
});

test('la puerta rechaza comandos formados solo por separadores', () => {
  const cases = [
    [';', 'ask'],
    ['&', 'ask'],
    [' ; & ', 'ask'],
  ];

  for (const [command, expected] of cases) {
    const res = run(command);
    assert.equal(res, expected, `Esperaba ${expected} para "${command.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}" pero fue ${res}`);
  }
});

test('la puerta divide los segmentos en \\r solo con gate.commands', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-commands-cr-'));
  const hooksDir = path.join(tempRepo, '.agents', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const tempGatePath = path.join(hooksDir, 'permission-gate.cjs');
  fs.copyFileSync(gatePath, tempGatePath);
  const { decide: tempDecide } = require(tempGatePath);

  fs.writeFileSync(path.join(tempRepo, 'relevo.config.json'), JSON.stringify({
    gate: { commands: ['go test'] },
  }));

  const cases = [
    ["go test ./...\rRemove-Item x", 'ask'],
  ];

  for (const [command, expected] of cases) {
    const res = tempDecide({ toolCall: { name: 'run_command', args: { CommandLine: command } } }, {});
    assert.equal(res.decision, expected, `Esperaba ${expected} para "${command.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}" pero fue ${res.decision}`);
  }

  fs.rmSync(tempRepo, { recursive: true, force: true });
});

console.log(`\nagy permission gate: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
