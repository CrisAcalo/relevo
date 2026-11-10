'use strict';
/*
 * Raíz del repositorio principal del proyecto que usa relevo, aunque se ejecute desde un worktree:
 * el directorio padre de `git rev-parse --git-common-dir`. Sin git, el directorio actual.
 */
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function projectRoot(cwd = process.cwd()) {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return path.dirname(common);
  } catch {
    return path.resolve(cwd);
  }
}

module.exports = { projectRoot };
