---
name: delegar-agy
description: Delegate coding, research, QA or screenshot analysis to the Antigravity CLI (agy) with Google models, then audit the result. Use whenever implementation, investigation, test writing, test triage or UI image review is needed in this repo; Claude plans and audits, agy executes.
---

# Delegar en agy y auditar

Claude planifica, redacta el encargo, audita y hace commit. agy ejecuta. El usuario no aprueba permisos del agente: solo habla con Claude.

## Modelos (solo Google)

| Trabajo | Modelo |
|---|---|
| Por defecto para todo, incluido trabajo delicado: código, migraciones, concurrencia, render, tests, QA, docs, capturas | `gemini-3.8-flash-high` |
| Excepción: Flash High falló dos veces la misma tarea, o diseño crítico del núcleo (determinismo del render, concurrencia de persistencia) | `gemini-4-argon-medium` (`-high` solo si Argon Medium también falla) |

**Argon tiene un cupo propio, separado y más limitado que Flash** (indicación del autor, 2026-11-09). No usarlo nunca para documentación, QA, capturas, investigación general ni correcciones acotadas. Acotar siempre qué archivos puede leer. Antes de lanzar Argon, decir en el chat por qué Flash no basta.

Nunca `claude-*` ni `gpt-oss-*` dentro de agy.

## Preparar una tarea de código

```bash
git worktree add .worktrees/<tarea> -b agy/<tarea> HEAD
```
```powershell
New-Item -ItemType Junction -Path ".worktrees\<tarea>\node_modules" -Target "$PWD\node_modules"
```

`.worktrees/` está en `.gitignore`. El hook `.agents/` viaja con la rama.

## Ejecutar (siempre en segundo plano, headless)

Usar el lanzador común (crea `artifacts/agent-runs/<NN>-<tarea>/` con `brief.md`, `meta.json`, `events.ndjson`, `stderr.log`):

```bash
npm run agent:run -- --provider agy --role coder --model gemini-3.8-flash-high --task <tarea> --cwd .worktrees/<tarea> --brief <encargo.md>
```

Roles: `coder`, `qa`, `docs`, `research`, `vision`, `review`. El lanzador rechaza flags que desactiven permisos o sandbox. Proveedores: `agy` (verificado) y `codex` (adaptador preparado, sin validar con una ejecución real; usa `-s workspace-write`). Para otro proveedor (p. ej. DeepSeek vía un CLI de agente) añadir su adaptador en `scripts/agents/providers.cjs` y casos en `scripts/test-agent-runs.cjs`; claves solo por variables de entorno, nunca en el repositorio.

- Sin `--sandbox` (rompe el `.git` del worktree y el `npm` de nvm) y sin `-i` (pide confianza por carpeta).
- Lectura/investigación: añadir `--mode plan`. En ese modo agy no puede escribir en el repo y deja informes en `~/.gemini/antigravity-cli/brain/<conversation_id>/`: copiarlos desde ahí, o usar el modo normal si el encargo debe crear un archivo en `artifacts/`.
- Ronda de corrección: misma conversación con `--conversation <conversation_id>` (sale en el evento `init`/`result`) solo si la corrección necesita el contexto previo. Continuar una conversación larga reenvía todo su historial (A5: 787k tokens para una corrección de una prueba); para correcciones acotadas, un agente nuevo con encargo preciso es más barato.
- En agy, el último evento es `{"event":"result","result":{status,response,usage,duration_seconds}}`; el lanzador registra además `endedAt` y `exitCode` en `meta.json` para cualquier proveedor.
- Bitácora de comandos y decisiones del hook: `.worktrees/<tarea>/.agents/hooks/gate.log`.
- Para que el autor vea el trabajo en vivo, abrir una pestaña de Terminal con `npm run agents` (alias `agy:watch`): tarjetas por agente con proveedor, rol, estado, duración, tokens, carpeta/rama, barra y contadores por tipo de acción y últimos pasos o conclusión; dos columnas en terminales anchas. Teclado: ↑↓ elegir, Enter detalle, Esc volver, a todos/recientes, q salir. Detalle directo: `npm run agents -- <NN>`; tabla: `-- --list`; `--once` imprime sin interfaz.
- Agentes en paralelo: cada uno con su propio log `NN-<tarea>.ndjson` (números distintos) y, si escriben código, su propio worktree. Nunca dos agentes de código en el mismo worktree ni sobre los mismos archivos.

## Plantilla de encargo

```
Objetivo: <una frase>.
Archivos que puedes modificar: <lista>. No toques: <lista>.
Lee solo: <archivos o carpetas>; no leas node_modules salvo <archivo concreto>.
Criterios de aceptación: <comprobables>.
Verificación: ejecuta <comandos> y reporta su salida.
Si un comando es denegado por la política del repo, no intentes rodearlo.
Entrega en <=N líneas: cambios, resultados, riesgos o dudas.
Guarda informes largos en artifacts/agy-runs/<archivo>.md (no en ~/.gemini).
```

## Encargos para tareas delicadas con Flash (obligatorio)

Delicado = persistencia/migraciones, concurrencia, render/exportación/determinismo, seguridad, cálculos (contraste, códigos, DSP). Flash rinde bien si el encargo no deja huecos que rellenar con suposiciones. Antes de lanzar, Claude:

1. **Lee él mismo el código afectado** y escribe en el encargo las rutas exactas, los nombres de funciones/tipos y los fragmentos o líneas relevantes (`archivo:línea`). No pedir "busca dónde se hace X" en tareas delicadas.
2. **Copia los invariantes literalmente** desde `docs/decisions/` (no los resume) en una sección "Contratos que NO pueden cambiar", con la consecuencia verificable de romperlos.
3. **Define el contrato exacto**: firmas, tipos, valores por defecto, unidades, umbrales y casos límite con valores concretos. Si hay una elección de diseño, la toma Claude y la escribe; no se delega.
4. **Enumera las pruebas una por una** con entradas y resultado esperado, y exige que cada una falle con el código anterior (o sin la protección). Pide vectores fijos calculados antes del cambio cuando se preserve comportamiento.
5. **Divide en pasos pequeños** y, si la tarea es grande, en dos ejecuciones: primero `--mode plan` (plan con archivos, funciones y pruebas, sin código) que Claude revisa y corrige; después la implementación con ese plan adjunto.
6. **Prohíbe explícitamente**: refactors fuera del alcance, cambiar textos/selectores existentes, tolerancias que oculten fallos, valores estimados en lugar de calculados, y afirmar resultados sin pegarlos.
7. **Exige evidencia**: para cada verificación, el comando exacto y su salida real resumida (pasadas/fallidas). "Si algo no está claro o el código no coincide con el encargo, detente y repórtalo en lugar de suponer."
8. **Pide decisiones visibles**: el agente lista en su entrega toda decisión que tomó por su cuenta, para que la auditoría la revise.

Errores reales que estas reglas previenen (2026-11-09): prueba de `__proto__` vacía; propiedad oculta no enumerable para pasar datos; respaldo que vaciaba la comprobación de conflictos; contraste estimado en vez de calculado; "arreglo" de un problema inexistente leído mal de una captura.

## Cupos antes de elegir modelo

`npm run agents:quota` muestra los cupos de agy (no consume tokens): Gemini (Flash/Pro) con ventana semanal y de 5 h, y **Argon con cupo semanal propio**. `npm run agent:run` consulta el cupo, rechaza lanzar si el grupo del modelo está por debajo del 15 % (salvo `--allow-low-quota`, con motivo explícito en el chat) y registra en `meta.json` el cupo antes y después de cada tarea. El panel `npm run agents` lo muestra en la cabecera.

## Integración segura (Claude)

- Nunca canalizar `git rebase`, `git merge` ni `git commit` (`| tail`, `| grep`): el código de salida se pierde y el flujo sigue sobre un rebase a medias (2026-11-09, A5b). Comprobar el código de salida y `git status` antes de lanzar el siguiente agente.
- Con conflictos, los resuelve Claude, nunca un agente. El hook deniega a todos los roles `git add/stash/checkout/restore/reset/rebase/merge/commit/cherry-pick/worktree/clean`.
- El rol (`--role`) limita qué archivos puede editar el agente: `docs` solo documentación, `qa` veredicto/artefactos/mutaciones temporales, `vision` y `research` solo `artifacts/`. El lanzador lo pasa en `AGY_ROLE` y `gate.log` registra rol y decisión.

## Auditoría obligatoria antes de aceptar

1. `git -C .worktrees/<tarea> status --short` y `git diff`: solo los archivos permitidos.
2. Ejecutar yo mismo las verificaciones; no confiar en el resumen de agy.
3. Buscar pruebas vacías o tautológicas (p. ej. `__proto__` en literales JS no crea clave propia), asserts que no pueden fallar, mocks que ocultan el código real.
4. Revisar `gate.log` por comandos denegados o inesperados.
5. Contrastar con CLAUDE.md y el archivo de `docs/decisions/` del área (índice en AGENTS.md).
6. Si falla: corrección concreta y verificable a la misma conversación. Si pasa: copiar/merge a `main`, `npm run verify`, commit solo si el usuario lo pidió, borrar worktree y rama.

## Permisos (no los cambia Claude)

`~/.gemini/antigravity-cli/settings.json` usa `toolPermission: "always-proceed"` con reglas `deny`; `.agents/hooks/permission-gate.cjs` añade otra capa de denegación (probada por `scripts/test-agy-permission-gate.cjs`). El clasificador de Claude Code bloquea que Claude edite esa configuración global o use `--dangerously-skip-permissions`: pedir al usuario que aplique cambios ahí.
