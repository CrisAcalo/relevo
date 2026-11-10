'use strict';
/*
 * Raíz del repositorio principal del proyecto que usa relevo, aunque se ejecute desde un worktree:
 * el directorio padre de `git rev-parse --git-common-dir`. Sin git, el directorio actual.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** Ruta absoluta canónica: separador del sistema y nombres largos (no 8.3 como CRISAC~1). */
function canonical(p) {
  const resolved = path.resolve(p);
  try { return fs.realpathSync.native(resolved); } catch { return resolved; }
}

function projectRoot(cwd = process.cwd()) {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    // git devuelve '/' también en Windows: path.resolve normaliza al separador del sistema.
    return canonical(path.dirname(common));
  } catch {
    return canonical(cwd);
  }
}

module.exports = { projectRoot, canonical };
