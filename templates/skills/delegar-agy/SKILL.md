---
name: delegar-agy
description: Delegate coding, research, QA or screenshot analysis to the Antigravity CLI (agy) with Google models, then audit the result. Use whenever implementation, investigation, test writing, test triage or UI image review is needed; Claude plans and audits, agy executes.
---

> Plantilla de relevo: rellena los marcadores <<PROYECTO: …>> al instalarla.

# Delegar en agy y auditar

Claude planifica, redacta el encargo, audita y hace commit. agy ejecuta. El usuario no aprueba permisos del agente: solo habla con Claude.

## Modelos (solo Google)

| Trabajo | Modelo |
|---|---|
| Por defecto para todo, incluido trabajo delicado: código, migraciones, concurrencia, render, tests, QA, docs, capturas | `gemini-3.8-flash-high` |
| Excepción: Flash High falló dos veces la misma tarea, o diseño crítico del núcleo (determinismo, concurrencia, seguridad) | `gemini-4-argon-medium` (`-high` solo si Argon Medium también falla) |

**Argon tiene un cupo propio, separado y más limitado que Flash**. No usarlo nunca para documentación, QA, capturas, investigación general ni correcciones acotadas. Acotar siempre qué archivos puede leer. Antes de lanzar Argon, decir en el chat por qué Flash no basta.

Nunca `claude-*` ni `gpt-oss-*` dentro de agy.

## Preparar una tarea de código

```bash
relevo task new <tarea>          # worktree .worktrees/<tarea>, rama relevo/<tarea>, node_modules enlazado
relevo task integrate <tarea>    # al terminar: rebase si hace falta, pruebas, check, fast-forward y cierre
```

`.worktrees/` debe estar en `.gitignore` (configurable en `worktreesDir`). La configuración de hooks `.agents/` viaja con la rama o se hereda del proyecto. No encadenar a mano rebase, check, merge y limpieza: lo hace `relevo task integrate`.

## Ciclo según el riesgo

| Ciclo | Cuándo | Pasos |
|---|---|---|
| **Ligero** | Documentación, o código acotado con pruebas fuera de las zonas críticas | `coder` (código, pruebas y documentación en un encargo) → auditoría con mutaciones → `relevo task integrate <tarea> --sin-qa "<motivo>"` |
| **Completo** | Zonas críticas o cambios grandes | Lo anterior + QA independiente; `relevo task integrate <tarea>` |

Zonas críticas (siempre ciclo completo): <<PROYECTO: zonas críticas, ej. autenticación, permisos, pagos, migraciones, borrado de datos>>. Tareas independientes, en paralelo por defecto.

## Ejecutar (siempre en segundo plano, headless)

El lanzador se ejecuta **SIEMPRE desde la raíz del repositorio principal, nunca desde un worktree**; `--cwd` debe existir y apuntar a la carpeta de trabajo (el lanzador lo rechaza en ambos casos si no se cumple).

Usar el lanzador común (crea `artifacts/agent-runs/<NN>-<tarea>/` con `brief.md`, `meta.json`, `events.ndjson`, `stderr.log`, configurable en `runsDir`):

```bash
relevo run --provider agy --role coder --model gemini-3.8-flash-high --task <tarea> --cwd .worktrees/<tarea> --brief <encargo.md>
```
*(o `npm run agent:run` si el proyecto define ese alias).*

Roles: `coder`, `qa`, `docs`, `research`, `vision`, `review`. El lanzador rechaza flags que desactiven permisos o sandbox. Proveedores: `agy` (verificado) y `codex` (adaptador preparado, sin validar con una ejecución real; usa `-s workspace-write`). Para otro proveedor, añadir su adaptador en `lib/providers.cjs`; claves de API únicamente por variables de entorno, nunca en el repositorio.

- Sin `--sandbox` en agy (rompe el `.git` del worktree y el `npm` de entornos bajo gestores de versiones como nvm) y sin `-i` (pide confirmación por carpeta).
- Lectura/investigación: añadir `--mode plan`. En ese modo agy no puede escribir en el repo y deja informes en `~/.gemini/antigravity-cli/brain/<conversation_id>/`: copiarlos desde ahí, o usar el modo normal si el encargo debe crear un archivo en `artifacts/`.
- **Rondas de corrección**: las correcciones van a un **agente NUEVO con un encargo preciso** (lista de hallazgos verificados y cambios exactos), no a la misma conversación. Continuar una conversación larga reenvía todo su historial acumulado, disparando el consumo de tokens y contexto. Solo se continúa una conversación previa (`--conversation <conversation_id>`) si la corrección necesita estrictamente su contexto previo no reproducible en el encargo.
- En agy, el último evento es `{"event":"result","result":{status,response,usage,duration_seconds}}`; el lanzador registra además `endedAt` y `exitCode` en `meta.json` para cualquier proveedor.
- Bitácora de comandos y decisiones del hook: `.worktrees/<tarea>/.agents/hooks/gate.log` (o en la raíz de la ejecución).
- Para que el usuario vea el trabajo en vivo, abrir una terminal con `relevo watch` (o `npm run agents`): tarjetas por agente con proveedor, rol, estado, duración, tokens, carpeta/rama, barra y contadores por tipo de acción y últimos pasos o conclusión. Teclado: ↑↓ elegir, Enter detalle, Esc volver, a todos/recientes, q salir. Detalle directo: `relevo watch <NN>`; tabla: `relevo watch --list`; `--once` imprime sin interfaz interactiva.
- Agentes en paralelo: cada uno con su propio log y carpeta `artifacts/agent-runs/<NN>-<tarea>/` (números distintos) y, si escriben código, su propio worktree. Nunca dos agentes de código en el mismo worktree ni sobre los mismos archivos.
- **El paralelismo lo dan los agentes, no sesiones de Claude Code**: varias tareas a la vez = varios `relevo run` lanzados desde esta misma sesión, cada uno en su worktree (`relevo task new <tarea>`). No abrir sesiones de Claude Code aparte para tareas del flujo. Si existe alguna, sigue estas mismas reglas y se resuelve sola, sin esperar al usuario. Tareas que tocan los mismos archivos no se lanzan a la vez.

## Plantilla de encargo

```
Objetivo: <una frase>.
Archivos que puedes modificar: <lista>. No toques: <lista>.
Lee solo: <archivos o carpetas>; no leas node_modules salvo <archivo concreto>.
Criterios de aceptación: <comprobables>.
Verificación: ejecuta <comandos> y reporta su salida.
Si un comando es denegado por la política del repo, no intentes rodearlo.
Si algo no está claro o el código contradice el encargo, detente y repórtalo en lugar de suponer.
Entrega en <=N líneas: cambios, resultados, decisiones propias tomadas, riesgos o dudas.
Guarda informes largos en artifacts/agent-runs/<NN>-<tarea>/<archivo>.md (no en ~/.gemini).
```

## Encargos para tareas delicadas con Flash (obligatorio)

Delicado = persistencia/migraciones, concurrencia, render/exportación/determinismo, seguridad, cálculos (contraste, finanzas, DSP, lógica central). Flash rinde bien si el encargo no deja huecos que rellenar con suposiciones. Antes de lanzar, Claude:

1. **Lee él mismo el código afectado** y escribe en el encargo las rutas exactas, los nombres de funciones/tipos y los fragmentos o líneas relevantes (`archivo:línea`). No pedir "busca dónde se hace X" en tareas delicadas.
2. **Copia los invariantes literalmente** desde las decisiones del proyecto (`<<PROYECTO: directorio de decisiones, ej. docs/decisions/>>`) en una sección "Contratos que NO pueden cambiar", con la consecuencia verificable de romperlos.
3. **Define el contrato exacto**: firmas, tipos, valores por defecto, unidades, umbrales y casos límite con valores concretos. Si hay una elección de diseño, la toma Claude y la escribe; no se delega.
4. **Enumera las pruebas una por una** con entradas y resultado esperado, y exige que cada una falle con el código anterior (o sin la protección). Pide vectores fijos calculados antes del cambio cuando se preserve comportamiento.
5. **Divide en pasos pequeños** y, si la tarea es grande, en dos ejecuciones: primero `--mode plan` (plan con archivos, funciones y pruebas, sin código) que Claude revisa y corrige; después la implementación con ese plan adjunto.
6. **Prohíbe explícitamente**: refactors fuera del alcance, cambiar textos/selectores existentes, tolerancias que oculten fallos, valores estimados en lugar de calculados, y afirmar resultados sin pegarlos.
7. **Exige evidencia**: para cada verificación, el comando exacto y su salida real resumida (pasadas/fallidas). Un agente que se detiene y reporta una contradicción del encargo es el comportamiento deseado; el auditor verifica la objeción y corrige el encargo.
8. **Pide decisiones visibles**: el agente lista en su entrega toda decisión que tomó por su cuenta, para que la auditoría la revise.

## Cupos antes de elegir modelo

`relevo quota` (o `npm run agents:quota`) muestra los cupos de agy (no consume tokens): Gemini (Flash/Pro) y Argon con cupo semanal propio. `relevo run` consulta el cupo, rechaza lanzar si el grupo del modelo está por debajo del límite mínimo (por defecto 15 %, configurable en `quota.min`, salvo `--allow-low-quota` con motivo explícito) y emite aviso si está bajo aviso (por defecto 30 %, configurable en `quota.warn`). Registra en `meta.json` el cupo antes y después de cada tarea. El panel `relevo watch` lo muestra en la cabecera.

## Integración segura (Claude)

- **Claude hace los commits del ciclo** (código, documentación, cierre); nunca hace push salvo petición explícita del usuario.
- **Integración autónoma**: cuando el ciclo se cumple (auditoría propia con mutaciones, veredicto de QA aprobado sobre el commit exacto que se integra, `relevo check` y pruebas en verde), Claude integra con `relevo task integrate <tarea>` sin pedir aprobación. Un rebase sin conflictos conserva el veredicto si el parche es idéntico (lo comprueba `relevo check`); si cambió, repetir verificación y QA. Preguntar al usuario solo si QA rechaza dos veces la misma tarea, si hace falta una decisión de diseño que el encargo no cubre, si algo no cuadra o antes de una acción hacia fuera (push, publicación).
- Nunca canalizar `git rebase`, `git merge` ni `git commit` (`| tail`, `| grep`): el código de salida se pierde y el flujo sigue sobre una operación a medias. Comprobar siempre el código de salida y `git status` antes de lanzar el siguiente paso.
- Con conflictos, los resuelve Claude, nunca un agente. La puerta de permisos deniega a todos los roles comandos de git que modifiquen el índice, historial o ramas.
- El rol (`--role`) limita qué archivos puede editar el agente: `docs` solo documentación, `qa` solo veredicto y `artifacts/` (las mutaciones, sobre copias en `artifacts/qa-mutantes/`), `vision` y `research` solo `artifacts/`. El lanzador lo pasa en `AGY_ROLE` y el gate registra rol y decisión en `gate.log`.

## Auditoría obligatoria antes de aceptar

1. `git -C .worktrees/<tarea> status --short` y `git diff`: verificar que solo se tocaron los archivos permitidos por el encargo y rol.
2. **Auditoría independiente**: además de ejecutar las pruebas del proyecto, el auditor escribe su propio barrido (p. ej. pruebas de propiedades sobre datos reales generados, casos límite no contemplados) y no acepta ciegamente el resumen del agente.
3. Buscar pruebas vacías o tautológicas, asserts que no pueden fallar, mocks que ocultan el código real y tolerancias artificiales.
4. Si una mutación de QA no hace fallar ninguna prueba, antes de añadir una prueba comprobar si el código protegido es realmente necesario o si se trata de código muerto/prescindible.
5. Revisar `gate.log` por comandos denegados o inesperados.
6. Contrastar con las convenciones del repositorio y las decisiones del área (`<<PROYECTO: directorio de decisiones, ej. docs/decisions/>>`).
7. **Correcciones**: enviar un encargo preciso con los hallazgos verificados y cambios exactos a un agente NUEVO (no a la misma conversación). Solo continuar conversación si es indispensable conservar su contexto.
8. **Revisión visual de segunda vuelta**: tras cada corrección de interfaz, realizar una segunda revisión visual de las capturas nuevas (rol `vision` con la skill `auditar-capturas`) que verifique, punto por punto, si cada hallazgo anterior está resuelto.
9. **Orden de cierre**:
   1. Veredicto aprobado de QA sobre el HEAD de la rama (`.qa-verdict.json`).
   2. Control mecánico: `relevo check` (o `npm run check:change`).
   3. Integración fast-forward en la rama principal (`<<PROYECTO: rama base, ej. main>>`).
   4. Commit de cierre de documentación en la rama principal (el veredicto está atado al commit del código, por eso el cierre documental finaliza en la rama principal tras integrar).
   5. Eliminación de worktree y rama de la tarea.

## Permisos (no los cambia Claude)

La configuración de usuario del CLI (ej. `toolPermission: "always-proceed"` con reglas `deny`) la aplica el usuario; la puerta de permisos (`.agents/hooks/permission-gate.cjs` o `lib/permission-gate.cjs`) añade la capa de control por rol y seguridad del repositorio. El clasificador de Claude Code bloquea que Claude edite esa configuración global o use flags de omisión de permisos: solicitar al usuario que aplique cualquier cambio global necesario.
