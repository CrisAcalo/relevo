'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function codexUserConfigPath(env = process.env) {
  if (env && env.RELEVO_CODEX_CONFIG !== undefined && env.RELEVO_CODEX_CONFIG !== null && env.RELEVO_CODEX_CONFIG !== '') {
    return env.RELEVO_CODEX_CONFIG;
  }
  return path.join(os.homedir(), '.codex', 'config.toml');
}

function checkInstalled(content) {
  const lines = content.split(/\r?\n/);
  let state = 0; // 0: buscando [[hooks.PreToolUse]], 1: vio [[hooks.PreToolUse]], 2: dentro del primer [[hooks.PreToolUse.hooks]]

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (state === 0) {
      if (line === '[[hooks.PreToolUse]]') {
        state = 1;
      }
    } else if (state === 1) {
      if (line === '[[hooks.PreToolUse.hooks]]') {
        state = 2;
      } else if (line.startsWith('[')) {
        return false;
      }
    } else if (state === 2) {
      if (line.startsWith('[')) {
        return false;
      }
      if (/^command\s*=\s*(['"])node \.agents\/hooks\/permission-gate\.cjs\1$/.test(line)) {
        return true;
      }
    }
  }
  return false;
}

function checkTrusted(content, root) {
  const expected1 = (path.join(root, '.codex', 'config.toml') + ':pre_tool_use:0:0')
    .replace(/\\/g, '/')
    .toLowerCase();
  const expectedResolved = (path.join(path.resolve(root), '.codex', 'config.toml') + ':pre_tool_use:0:0')
    .replace(/\\/g, '/')
    .toLowerCase();
  let expected2 = null;
  try {
    expected2 = (path.join(fs.realpathSync.native(root), '.codex', 'config.toml') + ':pre_tool_use:0:0')
      .replace(/\\/g, '/')
      .toLowerCase();
  } catch {}

  const lines = content.split(/\r?\n/);
  let inTargetTable = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('[')) {
      inTargetTable = false;

      let clave = null;
      if (line.startsWith("[hooks.state.'") && line.endsWith("']") && line.length >= 16) {
        clave = line.slice(14, -2);
      } else if (line.startsWith('[hooks.state."') && line.endsWith('"]') && line.length >= 16) {
        clave = line.slice(14, -2).replace(/\\\\/g, '\\');
      }

      if (clave !== null) {
        const normalizedClave = clave.replace(/\\/g, '/').toLowerCase();
        if (
          normalizedClave === expected1 ||
          normalizedClave === expectedResolved ||
          (expected2 !== null && normalizedClave === expected2)
        ) {
          inTargetTable = true;
        }
      }
    } else if (inTargetTable) {
      if (line.startsWith('trusted_hash')) {
        return true;
      }
    }
  }
  return false;
}

function codexHookStatus(root, env = process.env) {
  let installed = false;
  let trusted = false;

  try {
    const projectConfig = path.join(root, '.codex', 'config.toml');
    if (fs.existsSync(projectConfig)) {
      const content = fs.readFileSync(projectConfig, 'utf8');
      installed = checkInstalled(content);
    }
  } catch {
    installed = false;
  }

  try {
    const userConfigFile = codexUserConfigPath(env);
    if (fs.existsSync(userConfigFile)) {
      const userContent = fs.readFileSync(userConfigFile, 'utf8');
      trusted = checkTrusted(userContent, root);
    }
  } catch {
    trusted = false;
  }

  return { installed, trusted };
}

module.exports = {
  codexUserConfigPath,
  codexHookStatus,
};
