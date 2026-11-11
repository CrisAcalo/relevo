'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, execSync } = require('node:child_process');
const { projectRoot } = require('./root.cjs');
const { loadConfig } = require('./config.cjs');
const { GITIGNORE_LINES } = require('./init.cjs');

const SYMBOLS = {
  ok: '✓',
  aviso: '!',
  error: '✗',
};

const REQUIRED_DENY = ['git push', 'git commit', 'npm publish', 'npm install', 'npx', 'curl'];

function findMarcadores(root) {
  const found = [];

  function checkFile(fullPath) {
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const matches = content.match(/<<PROYECTO:/g);
      if (matches && matches.length > 0) {
        const rel = path.relative(root, fullPath).replace(/\\/g, '/');
        found.push({ file: rel, count: matches.length });
      }
    } catch {}
  }

  // 1. .claude/skills/**/SKILL.md
  const skillsBase = path.join(root, '.claude', 'skills');
  if (fs.existsSync(skillsBase)) {
    function walk(dir) {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          walk(full);
        } else if (ent.isFile() && ent.name === 'SKILL.md') {
          checkFile(full);
        }
      }
    }
    walk(skillsBase);
  }

  // 2. .agents/plugins/relevo/agents/*.md
  const agentsBase = path.join(root, '.agents', 'plugins', 'relevo', 'agents');
  if (fs.existsSync(agentsBase)) {
    let entries = [];
    try {
      entries = fs.readdirSync(agentsBase, { withFileTypes: true });
    } catch {}
    for (const ent of entries) {
      const full = path.join(agentsBase, ent.name);
      if (ent.isFile() && ent.name.endsWith('.md')) {
        checkFile(full);
      }
    }
  }

  return found;
}

function toSamplePath(line) {
  const trimmed = line.trim();
  if (trimmed.endsWith('/')) {
    return `${trimmed}x`;
  }
  if (trimmed.startsWith('*.')) {
    return `x${trimmed.slice(1)}`;
  }
  if (trimmed.startsWith('*')) {
    return `x${trimmed.slice(1)}`;
  }
  return trimmed;
}

function runDoctor({ cwd = process.cwd(), env = process.env } = {}) {
  const checks = [];

  // 1. node: versión >= 22.12 -> ok; si no, error.
  const [major, minor] = process.versions.node.split('.').map(Number);
  const isNodeOk = major > 22 || (major === 22 && minor >= 12);
  if (isNodeOk) {
    checks.push({
      id: 'node',
      status: 'ok',
      message: `Node.js v${process.versions.node} (>= 22.12)`,
    });
  } else {
    checks.push({
      id: 'node',
      status: 'error',
      message: `Node.js v${process.versions.node} no cumple la versión mínima exigida (>= 22.12)`,
    });
  }

  // 2. git: git --version funciona -> ok; si no, error. Directorio actual dentro de repo git -> ok; si no, error.
  let gitInstalled = false;
  let gitVersionStr = '';
  try {
    gitVersionStr = execFileSync('git', ['--version'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    gitInstalled = true;
  } catch {
    gitInstalled = false;
  }

  let inGitRepo = false;
  if (gitInstalled) {
    try {
      const isInside = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (isInside === 'true') {
        inGitRepo = true;
      }
    } catch {
      inGitRepo = false;
    }
  }

  if (!gitInstalled) {
    checks.push({
      id: 'git',
      status: 'error',
      message: 'git no está instalado o no se puede ejecutar',
    });
  } else if (!inGitRepo) {
    checks.push({
      id: 'git',
      status: 'error',
      message: `${gitVersionStr}, pero el directorio actual no está dentro de un repositorio git`,
    });
  } else {
    checks.push({
      id: 'git',
      status: 'ok',
      message: `${gitVersionStr} (repositorio git detectado)`,
    });
  }

  // 3. agy: agy --version funciona -> ok con la versión; si no -> aviso ("relevo funciona sin agy si usas otro proveedor")
  let agyVersion = '';
  let agyOk = false;
  try {
    agyVersion = execSync('agy --version', {
      cwd,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    agyOk = true;
  } catch {
    agyOk = false;
  }

  if (agyOk) {
    checks.push({
      id: 'agy',
      status: 'ok',
      message: `${agyVersion}`,
    });
  } else {
    checks.push({
      id: 'agy',
      status: 'aviso',
      message: 'agy no disponible en PATH (relevo funciona sin agy si usas otro proveedor)',
    });
  }

  // 4. agy-settings: archivo en RELEVO_AGY_SETTINGS o ~/.gemini/antigravity-cli/settings.json
  const settingsPath = env.RELEVO_AGY_SETTINGS || path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');
  let settingsExists = false;
  let settingsRaw = null;
  let settingsParseError = null;

  if (!fs.existsSync(settingsPath)) {
    checks.push({
      id: 'agy-settings',
      status: 'aviso',
      message: `no existe el archivo de configuración global de agy (${settingsPath})`,
    });
  } else {
    settingsExists = true;
    try {
      settingsRaw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (err) {
      settingsParseError = err.message;
    }

    if (settingsParseError) {
      checks.push({
        id: 'agy-settings',
        status: 'error',
        message: `archivo de configuración de agy no es JSON válido: ${settingsParseError}`,
      });
    } else {
      // Lee SOLO toolPermission y permissions.deny; NUNCA imprime otras claves (p. ej. trustedWorkspaces)
      const toolPermission = settingsRaw?.toolPermission;
      if (toolPermission !== 'always-proceed') {
        checks.push({
          id: 'agy-settings',
          status: 'aviso',
          message: `toolPermission es "${toolPermission ?? 'indefinido'}" (se recomienda "always-proceed" para evitar bloqueos en segundo plano según I-01)`,
        });
      } else {
        checks.push({
          id: 'agy-settings',
          status: 'ok',
          message: 'toolPermission está configurado como "always-proceed"',
        });
      }
    }
  }

  // 5. agy-deny: comprueba permissions.deny para git push, git commit, npm publish, npm install, npx, curl
  if (!settingsExists) {
    checks.push({
      id: 'agy-deny',
      status: 'aviso',
      message: 'omitida porque no existe el archivo de configuración global de agy',
    });
  } else if (settingsParseError) {
    checks.push({
      id: 'agy-deny',
      status: 'error',
      message: 'no se puede comprobar permissions.deny por error en el JSON de configuración',
    });
  } else {
    const denyRules = Array.isArray(settingsRaw?.permissions?.deny) ? settingsRaw.permissions.deny : [];
    const missing = REQUIRED_DENY.filter((req) => {
      return !denyRules.some((rule) => typeof rule === 'string' && rule.toLowerCase().includes(req.toLowerCase()));
    });
    if (missing.length > 0) {
      checks.push({
        id: 'agy-deny',
        status: 'error',
        message: `faltan reglas en permissions.deny: ${missing.join(', ')}`,
      });
    } else {
      checks.push({
        id: 'agy-deny',
        status: 'ok',
        message: 'permissions.deny contiene todas las reglas obligatorias',
      });
    }
  }

  // Comprobaciones 6-10: se omiten con aviso si no se está en un repo git
  const skipProjectChecks = !inGitRepo;

  // 6. config: relevo.config.json en la raíz
  if (skipProjectChecks) {
    checks.push({
      id: 'config',
      status: 'aviso',
      message: 'omitida porque el directorio actual no está dentro de un repositorio git',
    });
  } else {
    const root = projectRoot(cwd);
    const configPath = path.join(root, 'relevo.config.json');
    if (!fs.existsSync(configPath)) {
      checks.push({
        id: 'config',
        status: 'aviso',
        message: 'relevo.config.json no existe (se usan valores por defecto)',
      });
    } else {
      try {
        loadConfig(root);
        checks.push({
          id: 'config',
          status: 'ok',
          message: 'relevo.config.json es válido',
        });
      } catch (err) {
        checks.push({
          id: 'config',
          status: 'error',
          message: err.message,
        });
      }
    }
  }

  // 7. gate: .agents/hooks/permission-gate.cjs
  if (skipProjectChecks) {
    checks.push({
      id: 'gate',
      status: 'aviso',
      message: 'omitida porque el directorio actual no está dentro de un repositorio git',
    });
  } else {
    const root = projectRoot(cwd);
    const installedGate = path.join(root, '.agents', 'hooks', 'permission-gate.cjs');
    const canonGate = path.join(__dirname, 'permission-gate.cjs');
    if (!fs.existsSync(installedGate)) {
      checks.push({
        id: 'gate',
        status: 'error',
        message: '.agents/hooks/permission-gate.cjs no existe (ejecuta relevo init)',
      });
    } else {
      const installedContent = fs.readFileSync(installedGate, 'utf8');
      const canonContent = fs.readFileSync(canonGate, 'utf8');
      const normInstalled = installedContent.replace(/\r\n/g, '\n');
      const normCanon = canonContent.replace(/\r\n/g, '\n');
      if (normInstalled === normCanon) {
        checks.push({
          id: 'gate',
          status: 'ok',
          message: '.agents/hooks/permission-gate.cjs está actualizada',
        });
      } else {
        let lock = null;
        try {
          lock = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'relevo.lock.json'), 'utf8'));
        } catch {}
        const installedHash = crypto.createHash('sha256').update(installedContent).digest('hex');
        const isOutdated = lock?.files?.['.agents/hooks/permission-gate.cjs'] === installedHash;
        checks.push({
          id: 'gate',
          status: 'aviso',
          message: isOutdated
            ? '.agents/hooks/permission-gate.cjs está desactualizada (sin cambios locales): ejecuta "relevo update --apply"'
            : '.agents/hooks/permission-gate.cjs está modificada a mano: ejecuta "relevo update --apply --force" (la puerta no se personaliza; se configura en relevo.config.json)',
        });
      }
    }
  }

  // 8. hooks: .agents/hooks.json contiene permission-gate.cjs
  if (skipProjectChecks) {
    checks.push({
      id: 'hooks',
      status: 'aviso',
      message: 'omitida porque el directorio actual no está dentro de un repositorio git',
    });
  } else {
    const root = projectRoot(cwd);
    const hooksPath = path.join(root, '.agents', 'hooks.json');
    if (fs.existsSync(hooksPath)) {
      const hooksText = fs.readFileSync(hooksPath, 'utf8');
      if (hooksText.includes('permission-gate.cjs')) {
        checks.push({
          id: 'hooks',
          status: 'ok',
          message: '.agents/hooks.json registra permission-gate.cjs',
        });
      } else {
        checks.push({
          id: 'hooks',
          status: 'error',
          message: '.agents/hooks.json no contiene permission-gate.cjs (ejecuta relevo init)',
        });
      }
    } else {
      checks.push({
        id: 'hooks',
        status: 'error',
        message: '.agents/hooks.json no existe (ejecuta relevo init)',
      });
    }
  }

  // 9. gitignore: líneas obligatorias de relevo init
  if (skipProjectChecks) {
    checks.push({
      id: 'gitignore',
      status: 'aviso',
      message: 'omitida porque el directorio actual no está dentro de un repositorio git',
    });
  } else {
    const root = projectRoot(cwd);
    const missing = [];
    let gitError = null;

    for (const req of GITIGNORE_LINES) {
      const samplePath = toSamplePath(req);
      try {
        execFileSync('git', ['check-ignore', '-q', '--no-index', samplePath], {
          cwd: root,
          stdio: ['ignore', 'ignore', 'pipe'],
          encoding: 'utf8',
        });
      } catch (err) {
        if (err.status === 1) {
          missing.push(req);
        } else {
          const msg = (err.stderr && err.stderr.trim()) || err.message || String(err);
          gitError = msg;
          break;
        }
      }
    }

    if (gitError) {
      checks.push({
        id: 'gitignore',
        status: 'aviso',
        message: `error de git: ${gitError}`,
      });
    } else if (missing.length > 0) {
      checks.push({
        id: 'gitignore',
        status: 'aviso',
        message: `faltan líneas en .gitignore: ${missing.join(', ')}`,
      });
    } else {
      checks.push({
        id: 'gitignore',
        status: 'ok',
        message: '.gitignore contiene todas las líneas de relevo',
      });
    }
  }

  // 10. marcadores: busca <<PROYECTO: en .claude/skills/**/SKILL.md y .agents/plugins/relevo/agents/*.md
  if (skipProjectChecks) {
    checks.push({
      id: 'marcadores',
      status: 'aviso',
      message: 'omitida porque el directorio actual no está dentro de un repositorio git',
    });
  } else {
    const root = projectRoot(cwd);
    const found = findMarcadores(root);
    if (found.length > 0) {
      const total = found.reduce((acc, f) => acc + f.count, 0);
      const details = found.map((f) => `${f.file} (${f.count})`).join(', ');
      checks.push({
        id: 'marcadores',
        status: 'aviso',
        message: `quedan ${total} marcador(es) <<PROYECTO: en: ${details}`,
      });
    } else {
      checks.push({
        id: 'marcadores',
        status: 'ok',
        message: 'no quedan marcadores <<PROYECTO: pendientes',
      });
    }
  }

  return checks;
}

function main() {
  const argv = process.argv.slice(2);
  const jsonMode = argv.includes('--json');
  const checks = runDoctor({ cwd: process.cwd(), env: process.env });

  if (jsonMode) {
    console.log(JSON.stringify({ checks }, null, 2));
  } else {
    let okCount = 0;
    let avisoCount = 0;
    let errorCount = 0;

    for (const c of checks) {
      if (c.status === 'ok') okCount++;
      else if (c.status === 'aviso') avisoCount++;
      else if (c.status === 'error') errorCount++;

      const sym = SYMBOLS[c.status] || '?';
      console.log(`${sym} ${c.id}: ${c.message}`);
    }

    console.log(`\nResumen: ${okCount} ok, ${avisoCount} aviso(s), ${errorCount} error(es)`);
  }

  const hasError = checks.some((c) => c.status === 'error');
  process.exitCode = hasError ? 1 : 0;
}

if (require.main === module) {
  main();
}

module.exports = { runDoctor, findMarcadores };
