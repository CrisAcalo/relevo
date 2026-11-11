'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { GITIGNORE_LINES } = require('../lib/init.cjs');

const failures = [];
let passed = 0;

function test(name, action) {
  try {
    action();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

const relevoBin = path.resolve(__dirname, '..', 'bin', 'relevo.cjs');

function runDoctorCli(repoDir, settingsPath, args = ['--json']) {
  const env = { ...process.env };
  if (settingsPath !== undefined) {
    env.RELEVO_AGY_SETTINGS = settingsPath;
  }
  const res = spawnSync(process.execPath, [relevoBin, 'doctor', ...args], {
    cwd: repoDir,
    env,
    encoding: 'utf8',
  });

  let parsed = null;
  if (args.includes('--json')) {
    try {
      parsed = JSON.parse(res.stdout);
    } catch (e) {
      throw new Error(`Error parseando JSON de doctor: ${e.message}\nSalida stdout:\n${res.stdout}\nStderr:\n${res.stderr}`);
    }
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, parsed };
}

function writeValidSettings(settingsPath) {
  const valid = {
    toolPermission: 'always-proceed',
    permissions: {
      allow: ['command(git status)'],
      deny: [
        'command(git push)',
        'command(git commit)',
        'command(npm publish)',
        'command(npm install)',
        'command(npx)',
        'command(curl)',
      ],
    },
  };
  fs.writeFileSync(settingsPath, JSON.stringify(valid, null, 2), 'utf8');
}

function snapshotDir(dir) {
  const list = {};
  function walk(curr) {
    for (const ent of fs.readdirSync(curr, { withFileTypes: true })) {
      const full = path.join(curr, ent.name);
      const rel = path.relative(dir, full).replace(/\\/g, '/');
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile()) {
        const stat = fs.statSync(full);
        list[rel] = stat.size;
      }
    }
  }
  walk(dir);
  return list;
}

// Suite de pruebas de doctor en repositorios temporales
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relevo-doctor-test-'));

try {
  const repoDir = path.join(tmpDir, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });
  execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });

  const settingsFile = path.join(tmpDir, 'agy-settings.json');
  writeValidSettings(settingsFile);

  test('(a) sin instalar -> gate y hooks en error y código 1', () => {
    const res = runDoctorCli(repoDir, settingsFile, ['--json']);
    assert.equal(res.status, 1);
    const gateCheck = res.parsed.checks.find((c) => c.id === 'gate');
    const hooksCheck = res.parsed.checks.find((c) => c.id === 'hooks');
    assert.ok(gateCheck, 'debe incluir la comprobación gate');
    assert.equal(gateCheck.status, 'error');
    assert.ok(hooksCheck, 'debe incluir la comprobación hooks');
    assert.equal(hooksCheck.status, 'error');
  });

  test('(b) tras node bin/relevo.cjs init -> gate ok y hooks ok', () => {
    const initRes = spawnSync(process.execPath, [relevoBin, 'init'], {
      cwd: repoDir,
      encoding: 'utf8',
    });
    assert.equal(initRes.status, 0, `init falló: ${initRes.stderr}`);

    const res = runDoctorCli(repoDir, settingsFile, ['--json']);
    const gateCheck = res.parsed.checks.find((c) => c.id === 'gate');
    const hooksCheck = res.parsed.checks.find((c) => c.id === 'hooks');
    assert.equal(gateCheck.status, 'ok');
    assert.equal(hooksCheck.status, 'ok');
  });

  test('(c) settings con toolPermission: "request-review" -> agy-settings aviso', () => {
    const reqReviewSettings = path.join(tmpDir, 'settings-req-review.json');
    fs.writeFileSync(
      reqReviewSettings,
      JSON.stringify({
        toolPermission: 'request-review',
        permissions: {
          deny: ['git push', 'git commit', 'npm publish', 'npm install', 'npx', 'curl'],
        },
      }),
      'utf8'
    );
    const res = runDoctorCli(repoDir, reqReviewSettings, ['--json']);
    const agySettingsCheck = res.parsed.checks.find((c) => c.id === 'agy-settings');
    assert.equal(agySettingsCheck.status, 'aviso');
    assert.ok(agySettingsCheck.message.includes('I-01'));
  });

  test('(d) settings sin git push en deny -> agy-deny error que lo nombra', () => {
    const noPushSettings = path.join(tmpDir, 'settings-no-push.json');
    fs.writeFileSync(
      noPushSettings,
      JSON.stringify({
        toolPermission: 'always-proceed',
        permissions: {
          deny: ['git commit', 'npm publish', 'npm install', 'npx', 'curl'],
        },
      }),
      'utf8'
    );
    const res = runDoctorCli(repoDir, noPushSettings, ['--json']);
    assert.equal(res.status, 1);
    const denyCheck = res.parsed.checks.find((c) => c.id === 'agy-deny');
    assert.equal(denyCheck.status, 'error');
    assert.ok(denyCheck.message.includes('git push'));
  });

  test('(e) settings JSON inválido -> error', () => {
    const badJsonSettings = path.join(tmpDir, 'settings-bad.json');
    fs.writeFileSync(badJsonSettings, '{ esto no es json', 'utf8');
    const res = runDoctorCli(repoDir, badJsonSettings, ['--json']);
    assert.equal(res.status, 1);
    const agySettingsCheck = res.parsed.checks.find((c) => c.id === 'agy-settings');
    assert.equal(agySettingsCheck.status, 'error');
  });

  test('(f) settings con trustedWorkspaces: ["C:/secreto/ruta"] -> la salida (texto y JSON) NO contiene "secreto"', () => {
    const secretSettings = path.join(tmpDir, 'settings-secret.json');
    fs.writeFileSync(
      secretSettings,
      JSON.stringify({
        toolPermission: 'always-proceed',
        permissions: {
          deny: ['git push', 'git commit', 'npm publish', 'npm install', 'npx', 'curl'],
        },
        trustedWorkspaces: ['C:/secreto/ruta'],
      }),
      'utf8'
    );

    const jsonRes = runDoctorCli(repoDir, secretSettings, ['--json']);
    assert.ok(!jsonRes.stdout.includes('secreto'), 'la salida JSON no debe contener secretos');
    assert.ok(!jsonRes.stderr.includes('secreto'), 'stderr JSON no debe contener secretos');

    const textRes = runDoctorCli(repoDir, secretSettings, []);
    assert.ok(!textRes.stdout.includes('secreto'), 'la salida texto no debe contener secretos');
    assert.ok(!textRes.stderr.includes('secreto'), 'stderr texto no debe contener secretos');
  });

  test('(g) una skill con <<PROYECTO: -> aviso marcadores', () => {
    const skillPath = path.join(repoDir, '.claude', 'skills', 'mi-skill', 'SKILL.md');
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, '# Titulo\n<<PROYECTO: nombre>>', 'utf8');

    const res = runDoctorCli(repoDir, settingsFile, ['--json']);
    const marcadoresCheck = res.parsed.checks.find((c) => c.id === 'marcadores');
    assert.equal(marcadoresCheck.status, 'aviso');
    assert.ok(marcadoresCheck.message.includes('mi-skill/SKILL.md'));
    assert.ok(/quedan \d+ marcador\(es\)/.test(marcadoresCheck.message));

    // Limpiamos el marcador para no afectar pruebas siguientes
    fs.unlinkSync(skillPath);
  });

  test('(h) modificar una línea de la puerta instalada -> gate aviso', () => {
    const gatePath = path.join(repoDir, '.agents', 'hooks', 'permission-gate.cjs');
    const originalContent = fs.readFileSync(gatePath, 'utf8');
    fs.writeFileSync(gatePath, originalContent + '\n// cambio local\n', 'utf8');

    const res = runDoctorCli(repoDir, settingsFile, ['--json']);
    const gateCheck = res.parsed.checks.find((c) => c.id === 'gate');
    assert.equal(gateCheck.status, 'aviso');
    assert.ok(gateCheck.message.includes('relevo update'));
    assert.ok(gateCheck.message.includes('relevo update --apply --force'));

    // Restauramos el contenido original
    fs.writeFileSync(gatePath, originalContent, 'utf8');
  });

  test('(i) relevo.config.json con {"gate":{"npmScripts":5}} -> config error', () => {
    const configPath = path.join(repoDir, 'relevo.config.json');
    const originalConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : null;
    fs.writeFileSync(configPath, JSON.stringify({ gate: { npmScripts: 5 } }), 'utf8');

    const res = runDoctorCli(repoDir, settingsFile, ['--json']);
    assert.equal(res.status, 1);
    const configCheck = res.parsed.checks.find((c) => c.id === 'config');
    assert.equal(configCheck.status, 'error');
    assert.ok(configCheck.message.includes('gate.npmScripts'));

    // Restauramos
    if (originalConfig !== null) {
      fs.writeFileSync(configPath, originalConfig, 'utf8');
    } else {
      fs.unlinkSync(configPath);
    }
  });

  test('(j) doctor no crea ni modifica ningún archivo (compara un listado recursivo con tamaños antes y después)', () => {
    const before = snapshotDir(repoDir);
    runDoctorCli(repoDir, settingsFile, ['--json']);
    runDoctorCli(repoDir, settingsFile, []);
    const after = snapshotDir(repoDir);
    assert.deepEqual(after, before);
  });

  test('(k) .gitignore con artifacts/ y el resto de líneas -> sin aviso de gitignore', () => {
    const gitignorePath = path.join(repoDir, '.gitignore');
    const originalGitignore = fs.readFileSync(gitignorePath, 'utf8');
    try {
      const covered = GITIGNORE_LINES.map((l) => (l === 'artifacts/agent-runs/' ? 'artifacts/' : l));
      fs.writeFileSync(gitignorePath, covered.join('\n') + '\n', 'utf8');
      const res = runDoctorCli(repoDir, settingsFile, ['--json']);
      const gitignoreCheck = res.parsed.checks.find((c) => c.id === 'gitignore');
      assert.ok(gitignoreCheck, 'debe incluir la comprobación gitignore');
      assert.equal(gitignoreCheck.status, 'ok');
    } finally {
      fs.writeFileSync(gitignorePath, originalGitignore, 'utf8');
    }
  });

  test('(l) .gitignore sin nada -> aviso que enumera las cinco (o las que haya en GITIGNORE_LINES)', () => {
    const gitignorePath = path.join(repoDir, '.gitignore');
    const originalGitignore = fs.readFileSync(gitignorePath, 'utf8');
    try {
      fs.writeFileSync(gitignorePath, '', 'utf8');
      const res = runDoctorCli(repoDir, settingsFile, ['--json']);
      const gitignoreCheck = res.parsed.checks.find((c) => c.id === 'gitignore');
      assert.ok(gitignoreCheck, 'debe incluir la comprobación gitignore');
      assert.equal(gitignoreCheck.status, 'aviso');
      for (const line of GITIGNORE_LINES) {
        assert.ok(
          gitignoreCheck.message.includes(line),
          `el mensaje debe enumerar "${line}": ${gitignoreCheck.message}`
        );
      }
    } finally {
      fs.writeFileSync(gitignorePath, originalGitignore, 'utf8');
    }
  });

  test('(m) puerta desactualizada (hash coincide con lock) -> aviso sin --force', () => {
    const gatePath = path.join(repoDir, '.agents', 'hooks', 'permission-gate.cjs');
    const lockPath = path.join(repoDir, '.agents', 'relevo.lock.json');
    const origGate = fs.readFileSync(gatePath, 'utf8');
    const origLock = fs.readFileSync(lockPath, 'utf8');

    try {
      const oldGateContent = '// puerta anterior\n';
      fs.writeFileSync(gatePath, oldGateContent, 'utf8');
      const oldHash = crypto.createHash('sha256').update(oldGateContent).digest('hex');
      const lockObj = JSON.parse(origLock);
      lockObj.files = lockObj.files || {};
      lockObj.files['.agents/hooks/permission-gate.cjs'] = oldHash;
      fs.writeFileSync(lockPath, JSON.stringify(lockObj, null, 2), 'utf8');

      const res = runDoctorCli(repoDir, settingsFile, ['--json']);
      const gateCheck = res.parsed.checks.find((c) => c.id === 'gate');
      assert.equal(gateCheck.status, 'aviso');
      assert.ok(
        gateCheck.message.includes('está desactualizada (sin cambios locales)'),
        `debe indicar desactualizada: ${gateCheck.message}`
      );
      assert.ok(
        gateCheck.message.includes('relevo update --apply"'),
        `debe recomendar relevo update --apply": ${gateCheck.message}`
      );
      assert.ok(
        !gateCheck.message.includes('--force'),
        `no debe incluir --force: ${gateCheck.message}`
      );
    } finally {
      fs.writeFileSync(gatePath, origGate, 'utf8');
      fs.writeFileSync(lockPath, origLock, 'utf8');
    }
  });

  test('(n) puerta modificada a mano sin lockfile -> aviso con --force', () => {
    const gatePath = path.join(repoDir, '.agents', 'hooks', 'permission-gate.cjs');
    const lockPath = path.join(repoDir, '.agents', 'relevo.lock.json');
    const origGate = fs.readFileSync(gatePath, 'utf8');
    const origLock = fs.readFileSync(lockPath, 'utf8');

    try {
      const oldGateContent = '// puerta anterior\n';
      fs.writeFileSync(gatePath, oldGateContent, 'utf8');
      fs.unlinkSync(lockPath);

      const res = runDoctorCli(repoDir, settingsFile, ['--json']);
      const gateCheck = res.parsed.checks.find((c) => c.id === 'gate');
      assert.equal(gateCheck.status, 'aviso');
      assert.ok(
        gateCheck.message.includes('está modificada a mano'),
        `debe indicar modificada a mano: ${gateCheck.message}`
      );
      assert.ok(
        gateCheck.message.includes('relevo update --apply --force'),
        `debe recomendar relevo update --apply --force: ${gateCheck.message}`
      );
    } finally {
      fs.writeFileSync(gatePath, origGate, 'utf8');
      fs.writeFileSync(lockPath, origLock, 'utf8');
    }
  });
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}

console.log(`\ndoctor checks: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
