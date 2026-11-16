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

function codexHookStatus(root, env = process.env) {
  let installed = false;
  let trusted = false;

  try {
    const projectConfig = path.join(root, '.codex', 'config.toml');
    if (fs.existsSync(projectConfig)) {
      const content = fs.readFileSync(projectConfig, 'utf8');
      if (content.includes('permission-gate.cjs')) {
        installed = true;
      }
    }
  } catch {
    installed = false;
  }

  try {
    const userConfigFile = codexUserConfigPath(env);
    if (fs.existsSync(userConfigFile)) {
      const userContent = fs.readFileSync(userConfigFile, 'utf8');
      const needle1 = (path.join(root, '.codex', 'config.toml') + ':pre_tool_use:')
        .replace(/\\/g, '/')
        .toLowerCase();
      let needle2 = null;
      try {
        needle2 = (path.join(fs.realpathSync.native(root), '.codex', 'config.toml') + ':pre_tool_use:')
          .replace(/\\/g, '/')
          .toLowerCase();
      } catch {}

      const normalizedContent = userContent.replace(/\\/g, '/').toLowerCase();
      if (normalizedContent.includes(needle1) || (needle2 && normalizedContent.includes(needle2))) {
        trusted = true;
      }
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
