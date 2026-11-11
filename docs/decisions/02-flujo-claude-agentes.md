# Decisión 02: Flujo de desarrollo Claude + Agentes de código (2026-11-10)

> Vinculante para el proceso de desarrollo. Procedimiento operativo en `.claude/skills/delegar-agy/SKILL.md`.

## Decisión

- Claude Code planifica, redacta encargos precisos, audita de forma independiente y hace commit. Agentes externos (hoy Antigravity CLI `agy` con modelos Google; adaptador Codex preparado) implementan, investigan, ejecutan QA y analizan capturas de interfaz. El usuario interactúa únicamente con Claude Code y no aprueba permisos del agente en bucle.
- agy usa solo modelos Google: `gemini-3.8-flash-high` por defecto para todo, incluido el trabajo delicado. Argon (`gemini-4-argon-*`) tiene un cupo semanal propio, separado y más limitado: solo si Flash High falla dos veces la misma tarea o para diseño crítico del núcleo, justificándolo antes en el chat y acotando los archivos que puede leer. No usar modelos Claude ni GPT dentro de agy.
- Las capturas de interfaz se analizan con un agente en rol `vision` (skill `auditar-capturas`), no en la ventana de contexto de Claude.

## Por qué

El origen de cada regla de este flujo, de la puerta de permisos, de `relevo check` y del lanzador está en [por-que-cada-regla.md](../por-que-cada-regla.md); los comandos (incluidos `doctor`, `task` y `update`) en [comandos.md](../comandos.md); los fallos reales que las motivaron, con síntoma, causa y regla resultante, en [incidentes.md](../incidentes.md).

## Ejecución

- El lanzador (`relevo run` / `npm run agent:run`) se ejecuta **SIEMPRE desde la raíz del repositorio principal, nunca desde un worktree**; `--cwd` debe existir y apuntar al worktree (el lanzador lo rechaza en ambos casos si no se cumple).
- Cada ejecución crea una carpeta dedicada en `artifacts/agent-runs/<NN>-<tarea>/` (configurable en `runsDir`) con `brief.md`, `meta.json`, `events.ndjson` y `stderr.log`.
- **Rondas de corrección**: van a un **agente NUEVO con un encargo preciso** (lista de hallazgos verificados y cambios exactos), no a la misma conversación. Continuar una conversación larga reenvía todo su historial previo, disparando el coste de contexto. Solo se continúa una conversación previa (`--conversation <id>`) si la corrección necesita estrictamente su contexto previo.
- Tareas de código en `.worktrees/<tarea>` (ignorado en `.gitignore`), con `node_modules` enlazado mediante junctions en Windows o enlaces simbólicos en POSIX; Claude ejecuta la verificación y la auditoría antes de integrar en la rama principal.
- Permisos: `toolPermission: "always-proceed"` y reglas `deny` en la configuración personal de agy; `.agents/hooks/permission-gate.cjs` (o `lib/permission-gate.cjs`) deniega publicación, alteración de historial de git, dependencias, red, borrados recursivos, `.env`, perfiles de usuario y navegadores visibles, registrando cada comando y decisión en `gate.log`. El rol (`--role`) restringe las rutas editables.
- Skills en `.claude/skills/` y agentes en `.agents/plugins/relevo/agents/`.

## Evidencia y lecciones aprendidas (2026-11-09 / 2026-11-10)

- `--mode auto` no está disponible en la cuenta de agy; el `allow` de un hook no evita la confirmación base y `permissionOverrides` no tuvo efecto en `-p`. Con `request-review` todo comando se deniega en `-p`; `always-proceed` + `deny` + hook funcionó: `curl`, `npx` y `git push` denegados; lectura, scripts del repositorio y `npm run …` permitidos.
- `--sandbox` impide leer el `.git` del repositorio padre desde un worktree y no encuentra `npm` de entornos bajo nvm: no usarlo en agy.
- El clasificador de Claude Code bloquea que Claude lance agy con `--dangerously-skip-permissions` o edite su configuración global: esos cambios los aplica el usuario.
- Hechos verificados en el proyecto original:
  - Análisis de captura de interfaz correcto (Flash High, 76 s).
  - Investigación CSP útil pero costosa sin acotar lectura (Argon Medium, 451k tokens).
  - Prueba de entrada hostil con un falso positivo de `__proto__` detectado en auditoría independiente y corregido.
  - QA E2E sin incidencias en consola, con servidor de desarrollo detenido limpiamente al finalizar.
- Un agente que se detiene y reporta una contradicción entre el encargo y el código es el comportamiento deseado; el auditor verifica la objeción y corrige el encargo.
- Si una prueba de mutación de QA no hace fallar ninguna prueba, antes de añadir una prueba se debe comprobar si el código protegido es necesario o si es código muerto prescindible (en el proyecto original, una función para conservar el foco resultó ser código muerto que estorbaba).

## Roles y definición de hecho

- **Ciclo por tarea** (en la rama del worktree):
  1. **Encargo**: Claude redacta la especificación con contratos e invariantes.
  2. **Codificador**: agente de código implementa en el worktree con permisos acotados.
  3. **Auditoría inicial de Claude**: revisión de archivos tocados, ejecución independiente de pruebas y barrido propio.
  4. **Documentalista**: agente en rol `docs` actualiza la documentación (`docs/**`, índice, hoja de ruta) a partir del diff real antes de QA.
  5. **Commit de Claude**: commit de los cambios de código y documentación en la rama.
  6. **QA independiente**: agente en rol `qa` ejecuta pruebas generales y del área en headless, realiza pruebas de mutación obligatorias (sobre copias en `artifacts/qa-mutantes/`) y emite `.qa-verdict.json` sin tocar código.
  7. **Auditoría final de Claude**: revisión de veredicto, mutaciones e informe.
  8. **Control mecánico**: `relevo check` (o `npm run check:change`) valida mecánicamente 11 reglas probadas:
     - Detección de cambios respecto a la base.
     - Cambios en código fuente acompañados de pruebas (salvo justificación explícita con `--no-tests-reason`).
     - Rechazo de veredictos inexistentes, obsoletos, rechazados o con suites fallidas.
     - Bloqueo de chequeo si hay cambios sin commit (el veredicto debe corresponder a un commit).
     - Exigencia de actualización de hoja de ruta (`check.roadmap`) e índice de decisiones (`check.decisions`).
     - Modo `--docs-only` para cambios exclusivos de documentación.
     - Sugerencia de suites por área según patrones de rutas modificadas.
     - Detección de nuevos colores fijos en archivos de interfaz (salvo `--allow-colors`).
     - Rechazo automático de veredictos aprobados que contengan hallazgos de severidad alta.
  9. **Integración fast-forward**: Claude integra la rama en la rama principal, sin pedir aprobación al usuario (ver «Autonomía y paralelismo»).
  10. **Commit de cierre de documentación**: se formaliza en la rama principal el cierre documental atado al commit integrado.
  11. **Limpieza**: eliminación del worktree y de la rama temporal.
- Claude hace los commits del ciclo; nunca hace push sin petición explícita del usuario.
- Quien escribe el código no emite el veredicto.
- Tras cada corrección de interfaz, se realiza una segunda revisión visual de las capturas nuevas (rol `vision`) confirmando punto por punto la resolución de los hallazgos.

## Autonomía y paralelismo (2026-11-10)

- **Integración autónoma.** Cuando el ciclo se cumple (auditoría propia con mutaciones, veredicto de QA aprobado sobre el commit exacto que se integra, `relevo check` y pruebas en verde), Claude integra en la rama principal y cierra la tarea con `relevo task done` **sin pedir aprobación al usuario**. Los commits en la rama de la tarea tampoco la requieren.
- **Tras un rebase el veredicto deja de valer**: el commit cambia, así que se repiten la verificación y QA sobre el nuevo HEAD antes de integrar.
- **Cuándo se pregunta al usuario**: solo si QA rechaza dos veces la misma tarea, si hace falta una decisión de diseño que el encargo no cubre, si algo no cuadra (encargo, código y resultados se contradicen) o antes de una acción hacia fuera. El push y cualquier publicación siguen requiriendo petición explícita.
- **Paralelismo con agentes, no con sesiones.** El trabajo en paralelo se hace lanzando varios agentes con `relevo run` desde la misma sesión de Claude Code, cada tarea en su worktree (`relevo task new`), y se sigue con `relevo watch`. Claude no abre sesiones de Claude Code aparte para tareas de relevo. Si existe alguna (porque el usuario la abrió), aplica estas mismas reglas y se resuelve sola, sin quedarse esperando al usuario.
- **Tareas que tocan los mismos archivos** no se lanzan a la vez. Si coinciden, se integran de una en una: la siguiente se rebasa sobre la rama principal y vuelve a pasar el ciclo.
- Origen: petición del autor, después de que tres sesiones paralelas de Claude Code se detuvieran a pedir aprobación para integrar trabajo ya aprobado por QA.

## Varios proveedores

- Separación modular en `lib/`: lanzador (`run.cjs`), modelo de ejecución (`runs.cjs`), adaptadores (`providers.cjs`), panel interactivo (`watch.cjs`) y consulta de cupos (`quota.cjs`).
- Cada ejecución guarda encargo, metadatos y eventos en `artifacts/agent-runs/<NN>-<tarea>/` (ignorado en git); los registros históricos en `artifacts/agy-runs/` se mantienen compatibles para lectura.
- Adaptador Codex (`codex exec --json`, sandbox `workspace-write`) preparado y probado con eventos sintéticos; pendiente de validar con una ejecución real.
- Ningún adaptador añade flags que desactiven permisos o sandbox; las claves de API viajan exclusivamente por variables de entorno.

## Límites

- La puerta de permisos compara texto de comandos y rutas; no constituye un sandbox hermético a nivel de sistema operativo. Se asume para entornos de desarrollo con worktrees aislados y auditoría humana/asistida.
- Los encargos a modelos de alto consumo (Argon) deben acotar explícitamente los archivos que pueden leer.
- Los archivos principales de instrucciones (ej. `AGENTS.md`, `CLAUDE.md`) deben mantenerse por debajo de 20.000 bytes para evitar el truncado automático a 24.000 bytes que aplican algunos CLIs de agente.
