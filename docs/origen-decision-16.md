# Flujo de desarrollo Claude + Antigravity CLI (2026-11-09)

> Vinculante para el proceso de desarrollo. Procedimiento operativo en `.claude/skills/delegar-agy/SKILL.md`.

## Decisión

- Claude Code planifica, redacta encargos, audita y hace commit. Antigravity CLI (`agy`) implementa, investiga, ejecuta QA y analiza capturas de interfaz. El autor interactúa solo con Claude Code y no aprueba permisos del agente.
- agy usa solo modelos Google: `gemini-3.8-flash-high` por defecto para todo, incluido el trabajo delicado. Argon (`gemini-4-argon-*`) tiene un cupo propio y más limitado (2026-11-09): solo si Flash High falla dos veces la misma tarea o para diseño crítico del núcleo, justificándolo antes. No usar modelos Claude ni GPT dentro de agy.
- Las capturas de interfaz se analizan en agy, no en Claude (skill `auditar-capturas`).

## Ejecución

- `agy -p … --output-format stream-json` en segundo plano; log en `artifacts/agy-runs/NN-*.ndjson`. Correcciones en la misma conversación con `--conversation <id>`. Lectura e investigación con `--mode plan`.
- Tareas de código en `.worktrees/<tarea>` (ignorado), con `node_modules` enlazado; Claude ejecuta la verificación y la auditoría antes de integrar en `main`.
- Permisos: `toolPermission: "always-proceed"` y reglas `deny` en la configuración personal de agy; `.agents/hooks/permission-gate.cjs` deniega publicación, historial, dependencias, red, borrados recursivos, `.env`, perfiles y navegadores visibles, y registra cada comando en `gate.log` (ignorado). `scripts/test-agy-permission-gate.cjs` cubre la política.
- Skills compartidas en `.claude/skills/`; agy carga `verificar-cambio`, `e2e-headless` y `auditar-capturas` vía `.agents/skills.json` (`delegar-agy` solo Claude).

## Evidencia (2026-11-09)

- `--mode auto` no está disponible en la cuenta; el `allow` de un hook no evita la confirmación base y `permissionOverrides` no tuvo efecto en `-p`. Con `request-review` todo comando se deniega en `-p`; `always-proceed` + `deny` + hook funcionó: `curl`, `npx` y `git push` denegados; lectura, `node scripts/…` y `npm run …` permitidos.
- `--sandbox` impide leer el `.git` del repositorio padre desde un worktree y no encuentra `npm` de nvm: no usarlo.
- El clasificador de Claude Code bloquea que Claude lance agy con `--dangerously-skip-permissions` o edite su configuración global: esos cambios los aplica el autor.
- Pruebas reales: análisis de captura correcto (Flash High, 76 s); investigación CSP útil pero costosa sin acotar lectura (Argon Medium, 451k tokens); prueba de entrada hostil con un falso positivo de `__proto__` detectado en auditoría y corregido en la misma conversación; división de AGENTS.md sin pérdida de líneas; QA E2E `test:playback` 9/9 con servidor detenido y sin procesos residuales.

## Roles y definición de hecho (2026-11-09)

- Ciclo por tarea, todo en la rama del worktree: codificador (agy genérico con encargo propio) → `documentalista` (solo `docs/**`, AGENTS.md y CONTRIBUTING.md) → commit de Claude → `qa-estudio` (agente independiente que verifica código, pruebas **y** documentación y emite `.qa-verdict.json` sin corregir nada) → auditoría de Claude → `npm run check:change` → integración en `main`. Si QA rechaza, la corrección vuelve al rol responsable en su misma conversación y QA repite sobre el nuevo commit.
- Primera ejecución real (A5, 2026-11-09): QA rechazó un cambio técnicamente correcto por documentación ausente y por una E2E que no demostraba la independencia del tema del editor. El orden original (documentar tras integrar) contradecía la definición de hecho y se corrigió.
- Los agentes viven en `.agents/plugins/estudio/agents/` y se usan con `--agent qa-estudio` o `--agent documentalista`. Quien escribe el código no emite el veredicto.
- La skill `definicion-de-hecho` (compartida) fija los criterios; `scripts/check-change.cjs` comprueba mecánicamente pruebas junto a `src/`, veredicto aprobado del commit actual, hoja de ruta actualizada e índice de decisiones (7 casos en `scripts/test-check-change.cjs`).

## Varios proveedores (2026-11-09)

- `scripts/agents/` separa lanzador (`run.cjs`), modelo de ejecución (`runs.cjs`), adaptadores (`providers.cjs`) y panel (`watch.cjs`). Cada ejecución guarda encargo, metadatos y eventos en `artifacts/agent-runs/<NN>-<tarea>/` (ignorado); los logs antiguos de `artifacts/agy-runs/` siguen legibles.
- Adaptador Codex (`codex exec --json`, sandbox `workspace-write`) preparado y probado con eventos sintéticos; validarlo con una ejecución real antes de usarlo. DeepSeek no tiene CLI de agente propio: requiere elegir un CLI intermedio y su adaptador.
- Ningún adaptador añade flags que desactiven permisos o sandbox; las claves de API van por variables de entorno.

## Límites

- La política compara texto y puede eludirse envolviendo comandos; no equivale a un sandbox. Se acepta para un repositorio personal con worktrees y auditoría.
- Los encargos a Argon deben acotar qué archivos puede leer.
- agy trunca cada archivo de reglas a 24.000 bytes: `AGENTS.md` y `CLAUDE.md` deben quedar por debajo de 20.000 bytes (`check:repository`).
