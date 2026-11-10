#!/usr/bin/env node
'use strict';
/*
 * relevo: Claude planifica y audita; agentes de otros proveedores ejecutan.
 *   relevo run --provider agy --role coder --model <m> --task <t> --cwd <dir> --brief <archivo>
 *   relevo watch [--once | --list | <NN>]
 *   relevo quota [--json]
 *   relevo check            (definición de hecho mecánica sobre la rama actual)
 */
const path = require('node:path');
const COMMANDS = { run: 'run.cjs', watch: 'watch.cjs', quota: 'quota.cjs', check: 'check-change.cjs' };
const [command, ...rest] = process.argv.slice(2);
if (!COMMANDS[command]) {
  console.error(`relevo · comando desconocido "${command ?? ''}". Usa: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(2);
}
// Proceso hijo con la terminal heredada: cada módulo conserva su `require.main` y el panel sigue siendo interactivo.
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'lib', COMMANDS[command]), ...rest], { stdio: 'inherit' });
process.exit(result.status ?? 1);
