# Registro de incidentes

Cada regla de relevo nació de un fallo real. Este registro conserva el **síntoma**, la **causa** y la **regla que lo evita**, para que nadie retire una regla sin saber qué protege. Las tareas (A3, A5, A7a…) son del proyecto de origen, GeneradorMusica; los incidentes R* ocurrieron construyendo relevo.

Formato: síntoma observado → causa comprobada → regla resultante (dónde vive).

## Permisos de agy (2026-11-09)

### I-01 · El agente pedía permiso para cada comando
- **Síntoma:** con agy en `--mode accept-edits`, cada comando de terminal esperaba confirmación humana; un agente en segundo plano quedaba bloqueado y el autor tenía que aprobar en bucle, justo lo que quería evitar ("solo interactúo con el chat de Claude Code").
- **Causa:** `--mode auto` no está disponible en la cuenta; un `allow` devuelto por un hook no evita la confirmación base de agy; `permissionOverrides` en la configuración no tuvo efecto con `-p`; con `toolPermission: "request-review"` todo comando se **deniega** en `-p` (no hay nadie para aprobar).
- **Regla:** `toolPermission: "always-proceed"` + reglas `deny` en la configuración global de agy (la aplica el usuario) + la puerta de permisos del repositorio como segunda capa. Comprobado con un agente real: `curl`, `npx` y `git push` denegados; lectura, scripts del repositorio y `npm run …` permitidos. (decisión 02; `lib/permission-gate.cjs`)

### I-02 · Claude no puede desactivar los permisos ni editar la configuración global
- **Síntoma:** el clasificador de Claude Code bloqueó lanzar agy con `--dangerously-skip-permissions` y editar `~/.gemini/antigravity-cli/settings.json`.
- **Causa:** es un control de seguridad deliberado de Claude Code, no un error.
- **Regla:** ningún adaptador añade flags que desactiven permisos o sandbox (el lanzador rechaza `dangerously|bypass|skip-permissions`); los cambios de configuración global los aplica el usuario. (`lib/run.cjs`, `lib/providers.cjs`)

### I-03 · `--sandbox` rompía el worktree
- **Síntoma:** con `--sandbox`, el agente no podía leer el `.git` del repositorio padre desde un worktree ni encontraba el `npm` instalado con nvm.
- **Causa:** el sandbox restringe el acceso fuera de la carpeta de trabajo; el `.git` de un worktree es un archivo que apunta al repositorio principal.
- **Regla:** no usar `--sandbox` con agy; el aislamiento lo dan el worktree, la puerta y la auditoría. (decisión 02; skill `delegar-agy`)

### I-04 · `-i` pedía confianza por carpeta
- **Síntoma:** en modo interactivo (`-i`) agy pide confirmar la confianza en cada carpeta nueva, lo que bloquea un agente en segundo plano.
- **Regla:** ejecutar siempre con `-p` y `--output-format stream-json`, nunca `-i`. (skill `delegar-agy`)

### I-05 · `npm` bloqueado en PowerShell
- **Síntoma:** los comandos `npm …` de los agentes fallaban en Windows.
- **Causa:** en PowerShell, `npm` resuelve a `npm.ps1`, bloqueado por la política de ejecución de scripts.
- **Regla:** los encargos piden `npm.cmd`; la puerta acepta `npm` y `npm.cmd`. (`lib/permission-gate.cjs`, plantillas de encargo)

### I-06 · Archivos de reglas truncados
- **Síntoma:** agy leía `AGENTS.md` incompleto (56 KB).
- **Causa:** agy trunca cada archivo de reglas a 24.000 bytes.
- **Regla:** `AGENTS.md` y `CLAUDE.md` por debajo de 20.000 bytes; las decisiones van a archivos separados con un índice. (decisión 02, Límites)

## Integración y git (2026-11-09)

### I-07 · Una tubería ocultó un conflicto de rebase (A5b)
- **Síntoma:** el flujo siguió adelante sobre un rebase a medias; hubo que terminarlo a mano (`rebase --quit`, `branch -f`).
- **Causa:** la salida de `git rebase` se pasó por `| tail`: el código de salida que se comprobó fue el de `tail`, no el de git.
- **Regla:** nunca canalizar `rebase`, `merge` ni `commit`; comprobar el código de salida y `git status` antes de lanzar el siguiente agente. Los conflictos los resuelve Claude. (skill `delegar-agy`, Integración segura)

### I-08 · El documentalista se salió de su rol (A5b)
- **Síntoma:** el agente de documentación editó `package.json` e hizo `git add`, lo que contribuyó al conflicto de I-07.
- **Causa:** la puerta no distinguía roles: cualquier agente podía editar cualquier archivo y usar git de escritura.
- **Regla:** ámbito de edición por rol (`AGY_ROLE`, `gate.roleScopes`) y git de escritura (`add`, `commit`, `rebase`, `merge`, `reset`, `checkout`, `stash`, `worktree`…) denegado a **todos** los roles. Probado con un agente real. (`lib/permission-gate.cjs`)

## Calidad y QA

### I-09 · Prueba vacía de entrada hostil (2026-11-09)
- **Síntoma:** una prueba de "entrada hostil con `__proto__`" pasaba siempre.
- **Causa:** `__proto__` en un literal de objeto JS no crea una clave propia: la prueba no ejercitaba lo que decía.
- **Regla:** la auditoría busca pruebas vacías o tautológicas y asserts que no pueden fallar; el auditor ejecuta las pruebas él mismo. (skill `delegar-agy`, Auditoría)

### I-10 · QA rechazó un cambio correcto por documentación ausente (A5, 2026-11-09)
- **Síntoma:** el primer QA real rechazó un cambio técnicamente correcto: faltaba la documentación.
- **Causa:** el orden original documentaba después de integrar, contra la definición de hecho.
- **Regla:** el documentalista trabaja en la rama **antes** de QA, y QA verifica también la documentación. (decisión 02, ciclo)

### I-11 · Mutación sobre un archivo sin seguimiento (2026-11-09)
- **Síntoma:** tras una prueba de mutación, `git checkout` no pudo restaurar el archivo mutado; se recuperó de una copia.
- **Causa:** el archivo era nuevo (sin seguimiento en git): no hay versión a la que volver.
- **Regla:** procedimiento seguro de mutación: copiar a `<archivo>.qa-bak`, mutar, ejecutar, restaurar **desde la copia**, comparar y confirmar con `git status`. (agente `qa`; `.qa-bak` en el ámbito de QA y en `.gitignore`)

### I-12 · QA aprobó con un hallazgo alto (A3, 2026-11-10)
- **Síntoma:** el veredicto decía "aprobado" aunque una mutación del orden de la cadena no la detectaba ninguna prueba.
- **Causa:** nada impedía un veredicto incoherente.
- **Regla:** con cualquier hallazgo alto el veredicto es "rechazado", y `relevo check` rechaza un "aprobado" que contenga hallazgos de severidad alta. (agente `qa`; `lib/check-change.cjs`)

### I-13 · Contraste estimado en lugar de calculado (2026-11-10)
- **Síntoma:** el análisis de capturas de agy dio un contraste de ~3,8:1 que en realidad era 4,68:1 (cumplía), **no vio** el fallo real (el mismo rojo fijo daba 3,35–3,76:1 en tema claro) y propuso "arreglar" un problema de un texto que no existía.
- **Causa:** el contraste se estimó a ojo sobre la imagen y el texto se leyó de la captura sin contrastarlo con el código.
- **Regla:** los contrastes se **calculan** con el par exacto de colores; el texto que se cita de una captura se contrasta con el código. `relevo check` rechaza colores fijos nuevos en los archivos de interfaz (`check.hardcodedColorFiles`). (skill `auditar-capturas`; `lib/check-change.cjs`)

### I-14 · Una prueba excluía casos en silencio (A7a, 2026-11-10)
- **Síntoma:** la prueba exhaustiva de acordes pasaba, pero un barrido propio del auditor encontró 24 combinaciones rotas.
- **Causa:** la prueba limitaba la inversión máxima con `Math.min(…)` y nunca probaba esos casos.
- **Regla:** ningún caso se excluye de una prueba sin declararlo; si una combinación no puede funcionar, se prohíbe explícitamente en el código y en la interfaz. El auditor escribe su propio barrido, no solo ejecuta las pruebas del agente. (skill `delegar-agy`, Auditoría)

### I-15 · Mutación sin detectar que revelaba código muerto (A7b, 2026-11-10)
- **Síntoma:** quitar la función que conservaba el foco no hacía fallar ninguna prueba; QA rechazó.
- **Causa:** la función sobraba para el teclado (el nodo ya se conservaba) y en los botones de la barra quitaba el foco e impedía repetir la acción con Intro.
- **Regla:** ante una mutación no detectada, comprobar primero si el código protegido es necesario; la prueba nueva debe fallar con una mutación que rompa el comportamiento real (aquí, recrear los nodos). (skill `delegar-agy`)

### I-16 · El encargo estaba mal, y el agente se detuvo (A7a y A7b, 2026-11-10)
- **Síntoma:** en A7a un ejemplo del encargo tenía mal la inversión; en A7b el encargo afirmaba que quitar la clave del bucle rompía el foco. En ambos casos el agente se detuvo y lo reportó en lugar de suponer.
- **Regla:** todo encargo incluye "si algo no coincide, detente y repórtalo"; el auditor verifica la objeción y corrige el encargo. Es el comportamiento deseado. (skill `delegar-agy`, regla 7)

## Herramientas

### I-17 · Continuar una conversación salía carísimo (A5, 2026-11-09)
- **Síntoma:** una corrección pequeña de una prueba consumió unos 787.000 tokens.
- **Causa:** `--conversation <id>` reenvía todo el historial de la conversación anterior.
- **Regla:** las correcciones van a un agente **nuevo** con un encargo preciso; solo se continúa una conversación si la corrección necesita su contexto. (decisión 02)

### I-18 · El panel mostraba carpetas de evidencia como ejecuciones (2026-11-10)
- **Síntoma:** `watch` listaba como agentes carpetas de capturas guardadas en la carpeta de ejecuciones.
- **Regla:** solo cuentan como ejecución las carpetas `NN-<tarea>` con `meta.json`. (`lib/runs.cjs`; prueba en `test/agent-runs.test.cjs`)

### I-19 · El servidor de desarrollo no se detectaba o moría (2026-11-10)
- **Síntoma:** el script de la línea base E2E no veía Vite listo y, al lanzarlo sin separarlo, el servidor se cerraba.
- **Causa:** la línea "Local" de Vite llega con códigos de color ANSI que rompían la búsqueda; sin separar del proceso padre, Vite recibía su cierre.
- **Regla:** comprobar que el servidor responde con una petición, no leyendo su salida; arrancarlo separado (`< /dev/null`) y detener solo el propio. Si el auditor ya tiene un servidor corriendo, el encargo lo dice y el agente no arranca otro. (skill `e2e-headless`)

### I-20 · Agente lanzado desde un worktree (2026-11-10)
- **Síntoma:** el agente terminó con código 127 sin llegar a ejecutarse.
- **Causa:** lanzado desde dentro de un worktree, `--cwd` se resolvió contra la carpeta equivocada.
- **Regla:** el lanzador calcula la raíz del repositorio principal (`git --git-common-dir`) y rechaza un `--cwd` que no existe o que queda fuera del repositorio. (`lib/root.cjs`, `lib/run.cjs`)

### I-21 · Capturas móviles sin el elemento auditado (A3, Exportar, A7a, A7b)
- **Síntoma:** cuatro veces, la captura móvil mostraba la parte superior de la página y no la sección que se quería auditar.
- **Regla:** antes de cada captura, desplazar el elemento a la vista y **afirmar** que está dentro de la ventana; tras cada corrección de interfaz, una segunda revisión visual que confirme punto por punto cada hallazgo anterior. (skills `auditar-capturas` y `delegar-agy`)

### I-22 · Argon agotado
- **Síntoma:** el cupo semanal de Argon bajó al 8–9 % mientras Gemini seguía alto.
- **Causa:** Argon tiene un cupo propio, separado y más pequeño.
- **Regla:** Flash High por defecto incluso en tareas delicadas, con encargos muy precisos; Argon solo justificado. `relevo run` consulta el cupo y rechaza lanzar por debajo del 15 % salvo `--allow-low-quota`. (`lib/quota.cjs`, `lib/run.cjs`, `quota.min`)

## Construyendo relevo (2026-11-10)

### R-01 · El lanzador rechazaba su propio worktree
- **Síntoma:** el primer `relevo run` respondió "--cwd debe estar dentro del repositorio" con un worktree válido.
- **Causa:** git devuelve la raíz con `/` y el lanzador la comparaba con `startsWith` contra una ruta de Windows con `\`; además, el directorio temporal llegaba como `CRISAC~1` (nombre corto 8.3).
- **Regla:** las rutas se normalizan con `fs.realpathSync.native` y la pertenencia se comprueba con `path.relative`. (`lib/root.cjs`; `test/root.test.cjs`)

### R-02 · Ruta absoluta del proyecto de origen dentro de la puerta
- **Síntoma:** la puerta trataba como "interna" cualquier ruta bajo `C:/Proyectos/Personal/GeneradorMusica`, también instalada en otro repositorio.
- **Regla:** las rutas absolutas se permiten solo dentro del repositorio donde está instalada la puerta, de su repositorio principal si es un worktree, o de `workspacePaths`. Comprobado con 2.096 llamadas reales: ninguna denegación se relajó. (`lib/permission-gate.cjs`; `test/permission-gate.test.cjs`)

### R-03 · `update` habría ofrecido la misma plantilla para siempre (auditoría, 2026-11-10)
- **Síntoma:** en la primera versión de `relevo update`, una skill con sus marcadores rellenados se informaba como "personalizado" y `--apply` escribía `.relevo-new` en cada ejecución, aunque la plantilla no hubiera cambiado; y tras integrar a mano una plantilla nueva, se volvía a ofrecer.
- **Causa:** la decisión comparaba solo plantilla e instalado, sin usar el registro de instalación como base común.
- **Regla:** fusión a tres bandas con la base en `.agents/relevo.lock.json`; al ofrecer una plantilla nueva, la base pasa a esa plantilla. Detectado por el auditor leyendo el código, antes de usarlo en un proyecto real. (`lib/update.cjs`; casos h–k de `test/update.test.cjs`)

### R-04 · Variantes de comandos prohibidos esquivaban la puerta (auditoría, 2026-11-10)
- **Síntoma:** comandos equivalentes a otros denegados devolvían `ask` y, con `always-proceed`, se habrían ejecutado: `npm.cmd install lodash`, `git -C . commit`, `git -c user.name=x commit`, `git.exe push`, `& "git.exe" push`, `npm --prefix . install x`, `ri -r x`, `del /q /s x`; y subcomandos como `git update-ref`, `git config core.hooksPath` o `git fetch` no estaban en la lista.
- **Causa:** las reglas `deny` comparaban el texto literal del comando, sin contemplar extensiones de ejecutable, opciones globales de git, comillas, alias de PowerShell ni el orden de las opciones. Los propios encargos piden `npm.cmd` (I-05), justo la forma que no se detectaba.
- **Regla:** cada regla `deny` se comprueba también sobre la forma canónica del comando (`canonicalCommand`, dos pasadas: con y sin comillas), que nunca se usa para permitir; se ampliaron los subcomandos de git y los patrones de npm y de borrado recursivo. Detectado por Claude al revisar la puerta e implementado por dos agentes `coder` (la segunda ronda, tras el barrido del auditor); la auditoría añadió el caso que exige la segunda pasada. (`lib/permission-gate.cjs`; pruebas P1-P5 de `test/permission-gate.test.cjs`) La primera versión la rechazó QA: `git branch --delete/--move/--force` devolvían `allow` (ya ocurría antes, aunque la documentación decía que estaba protegido), y los alias de npm (`add`, `rm`, `un`) y las opciones compactas (`git -C.`) devolvían `ask`; se corrigieron en una tercera ronda, con `git branch` limitado a listar en la lista segura.

### R-05 · `check` no encontraba el veredicto del worktree (2026-11-10)
- **Síntoma:** al cerrar la tarea `gate-normalizar`, `relevo check` ejecutado en `.worktrees/gate-normalizar` respondió «Falta .qa-verdict.json» con un veredicto válido en la raíz del worktree; hubo que copiarlo a la raíz principal para cerrar el ciclo.
- **Causa:** `check` leía el veredicto y el índice de decisiones de `projectRoot()` (la raíz del repositorio principal), mientras la plantilla de QA escribe el veredicto en la raíz del worktree. El índice tenía el mismo fallo: se leía el de la rama principal y no se veía una decisión añadida en la rama.
- **Regla:** veredicto e índice se leen de `git rev-parse --show-toplevel`; la configuración sigue en la raíz principal. (`lib/check-change.cjs`; pruebas de worktree en `test/check-change.test.cjs`)
