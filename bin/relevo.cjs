#!/usr/bin/env node
'use strict';
/*
 * relevo: Claude planifica y audita; agentes de otros proveedores ejecutan.
 *   relevo init [--dry-run] [--force] (inicializa la configuración y plantillas en un proyecto git)
 *   relevo run --provider agy --role coder --model <m> --task <t> --cwd <dir> --brief <archivo>
 *   relevo watch [--once | --list | <NN>]
 *   relevo quota [--json]
 *   relevo check            (definición de hecho mecánica sobre la rama actual)
 *   relevo doctor [--json]  (comprueba entorno, configuración global del CLI e instalación)
 *   relevo task new <nombre> [--from <ref>] | task done <nombre> [--force] | task integrate <nombre> [--sin-qa "<motivo>"] [--sin-pruebas] | task list
 *   relevo update [--apply] (actualiza lo instalado sin pisar lo personalizado)
 */
const path = require('node:path');
const COMMANDS = { init: 'init.cjs', run: 'run.cjs', watch: 'watch.cjs', quota: 'quota.cjs', check: 'check-change.cjs', doctor: 'doctor.cjs', task: 'task.cjs', update: 'update.cjs' };
const USAGE = {
  init: 'relevo init [--dry-run] [--force] (inicializa la configuración y plantillas en un proyecto git)',
  run: 'relevo run --provider agy --role coder --model <m> --task <t> --cwd <dir> --brief <archivo>',
  watch: 'relevo watch [--once | --list | <NN>]',
  quota: 'relevo quota [--json]',
  check: 'relevo check            (definición de hecho mecánica sobre la rama actual)',
  doctor: 'relevo doctor [--json]  (comprueba entorno, configuración global del CLI e instalación)',
  task: 'relevo task new <nombre> [--from <ref>] | task done <nombre> [--force] | task integrate <nombre> [--sin-qa "<motivo>"] [--sin-pruebas] | task list',
  update: 'relevo update [--apply] (actualiza lo instalado sin pisar lo personalizado)',
};

const [command, ...rest] = process.argv.slice(2);

if (command === '--help' || command === '-h' || command === 'help') {
  console.log(Object.values(USAGE).join('\n'));
  process.exit(0);
}

if (!command) {
  console.error(`relevo · comando desconocido "". Usa: ${Object.keys(COMMANDS).join(', ')}\n\n${Object.values(USAGE).join('\n')}`);
  process.exit(2);
}

if (!COMMANDS[command]) {
  console.error(`relevo · comando desconocido "${command}". Usa: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(2);
}

if (rest.includes('--help') || rest.includes('-h')) {
  console.log(USAGE[command]);
  process.exit(0);
}

// Proceso hijo con la terminal heredada: cada módulo conserva su `require.main` y el panel sigue siendo interactivo.
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'lib', COMMANDS[command]), ...rest], { stdio: 'inherit' });
process.exit(result.status ?? 1);
