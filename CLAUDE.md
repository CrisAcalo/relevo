# Guía del repositorio relevo

relevo es un kit de delegación y auditoría de agentes para proyectos asistidos por Claude Code: Claude planifica, redacta encargos precisos, audita de forma independiente y hace commit; agentes externos (Antigravity CLI `agy`, Codex) implementan en worktrees con permisos acotados por rol; nada se integra sin verificación independiente.

## Comandos

- **Pruebas automáticas**:
  - En Windows: `npm.cmd test`
  - En Linux / macOS: `npm test`
- **Comandos del kit**:
  - `node bin/relevo.cjs run` (lanzador de agentes)
  - `node bin/relevo.cjs watch` (monitor en terminal interactivo)
  - `node bin/relevo.cjs quota` (consulta de cupos sin consumo de tokens)
  - `node bin/relevo.cjs check` (control mecánico de definición de hecho)

## Convenciones de código

- **CommonJS**: uso estricto de `require` y `module.exports`, con directiva `'use strict';`.
- **Cero dependencias externas**: sin dependencias de terceros en producción. Usar exclusivamente módulos nativos de Node.js con prefijo canónico `node:` (`node:fs`, `node:path`, `node:child_process`, `node:assert/strict`, etc.).
- **Compatibilidad**: Node.js ≥ 22.12. Rutas canónicas compatibles con Windows y POSIX (`canonical(p)`, normalización de separadores).
- **Idioma**: mensajes de consola, salidas de error, documentación y bitácoras en español.
- **Puerta de permisos autocontenida**: `lib/permission-gate.cjs` (y su hook asociado) debe continuar siendo un archivo independiente y autocontenido, capaz de resolver decisiones de herramientas de forma ultrarrápida sin acoplamiento a módulos secundarios.

## Seguridad

- **Sin omisión de permisos**: prohibido añadir o admitir flags que desactiven el sandbox o los controles de permisos (`--dangerously-skip-permissions`, `--bypass`, etc.). Todo intento debe abortar el proceso inmediatamente.
- **Sin ejecución dinámica**: terminantemente prohibido el uso de `eval`, `new Function` o generación dinámica arbitraria de código.
- **Credenciales**: las claves de API de los proveedores de modelos se gestionan exclusivamente mediante variables de entorno en la sesión del usuario; jamás se almacenan ni registran en archivos del repositorio.
- **Aislamiento en segundo plano**: todo proceso de agente se ejecuta headless en segundo plano sin abrir ventanas que interrumpan el escritorio del usuario.

## Flujo de trabajo de relevo

relevo se desarrolla aplicando su propio flujo:
1. Claude planifica la tarea y define contratos verificables.
2. La implementación se efectúa en un worktree aislado (`.worktrees/<tarea>`).
3. El auditor ejecuta verificaciones independientes y pruebas de mutación obligatorias antes de aceptar cualquier veredicto.
4. Se comprueba mecánicamente la definición de hecho con `node bin/relevo.cjs check` antes de la integración.
5. Si el ciclo se cumple (auditoría, QA aprobado sobre el mismo parche, `check` y pruebas en verde), Claude integra con `node bin/relevo.cjs task integrate <tarea>` **sin pedir aprobación**. Pregunta solo si QA rechaza dos veces, si falta una decisión de diseño o si algo no cuadra. El push sigue requiriendo petición explícita.
6. El paralelismo lo dan los agentes de `relevo run` lanzados desde la misma sesión, cada tarea en su worktree; no se abren sesiones de Claude Code aparte. Si existe alguna, se resuelve sola con estas reglas. Detalle en la decisión 02, «Autonomía y paralelismo».
7. Ciclo proporcional: ligero (sin QA, `task integrate --sin-qa "<motivo>"`) para documentación y cambios acotados; completo (con QA) para zonas críticas: `lib/permission-gate.cjs`, `lib/check-change.cjs`, `lib/verdict.cjs`, `lib/config.cjs` y el borrado de `lib/task.cjs`. La documentación la escribe el `coder` en el mismo encargo. Detalle en la decisión 02, «Ciclo proporcional».
