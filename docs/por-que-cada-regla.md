# Por qué existe cada regla

Cada regla de la puerta de permisos (`lib/permission-gate.cjs`), de `relevo check` (`lib/check-change.cjs`), del lanzador y del flujo, con lo que protege y su origen. **Incidente** enlaza a [incidentes.md](incidentes.md); **preventiva** significa que se puso antes de que fallara nada, por el riesgo evidente. Antes de quitar o relajar una regla, leer su fila.

## Puerta de permisos

Decisiones posibles: `allow` (se ejecuta), `deny` (se bloquea con el motivo) y `ask` (fuera de la lista segura: decide la configuración del CLI). **Con `toolPermission: "always-proceed"`, `ask` se ejecuta**: por ejemplo, el `Copy-Item` del procedimiento de mutación de QA no está en la lista segura y funciona. Por eso todo lo peligroso debe ser `deny`, nunca `ask`; las peticiones `ask` quedan en `gate.log` para que la auditoría las revise.

| Regla | Qué protege | Origen |
|---|---|---|
| Git que modifica índice, historial, ramas, configuración o remotos (`push`, `commit`, `merge`, `rebase`, `reset`, `checkout`, `switch`, `restore`, `tag`, `remote`, `add`, `rm`, `mv`, `stash`, `cherry-pick`, `revert`, `am`, `apply`, `clean`, `worktree`, `update-ref`, `symbolic-ref`, `update-index`, `read-tree`, `commit-tree`, `config`, `fetch`, `pull`, `clone`, `submodule`, `init`, `gc`, `prune`, `reflog`, `filter-branch`, `filter-repo`, `notes`, `replace`, y borrar, mover, copiar, forzar o cambiar el upstream de ramas con opciones cortas, compuestas o largas) → `deny` a todos los roles | Que solo Claude, tras auditar, cambie el historial; que un agente no deje un rebase a medias, no publique nada ni cambie los hooks o la configuración de git | Incidentes I-07 e I-08 (A5b); subcomandos añadidos, R-04 |
| `npm install/ci/uninstall/update/publish/link/exec` (con sus alias, como `add`, `rm`, `remove`, `un`, `up` o `x`; también `npm.cmd` y con opciones antes del subcomando, como `npm --prefix . install`), `npx`, `pnpm`, `yarn` → `deny` | Dependencias no auditadas, código de paquetes descargado y ejecutado, publicación accidental, mezcla de gestores de paquetes | Preventiva; en el origen, además, el autor eligió un único gestor (npm); variantes, R-04 |
| Red (`curl`, `wget`, `Invoke-WebRequest`, `irm`, `ssh`, `scp`) → `deny` | Exfiltración de código o secretos y descargas no auditadas durante una tarea de código | Preventiva (comprobada en I-01: `curl` denegado) |
| Borrados recursivos (`rm -r…`/`-fr`/`--recursive`; `Remove-Item`, `ri`, `del`, `erase`, `rd` o `rmdir` con `-r…` o `/s` en cualquier posición; `Format-Volume`) → `deny` | Pérdida de trabajo o del worktree; los artefactos los limpia Claude | Preventiva; alias y orden de opciones, R-04 |
| Ejecución dinámica o cambios de sistema (`Invoke-Expression`, `iex`, `Add-Type`, `Set-ExecutionPolicy`, `reg add`, `setx`) → `deny` | Que un agente esquive la política construyendo el comando en tiempo de ejecución o cambie el sistema | Preventiva |
| Navegadores visibles (`chrome`, `msedge`, `firefox` sin `--headless`) y herramientas `browser_*` → `deny` | Ventanas que interrumpen al usuario y perfiles reales con sus sesiones; las pruebas de interfaz van headless | Preventiva; regla de origen del proyecto (todo E2E headless con perfil propio) |
| Rutas sensibles (`gate.sensitivePaths`, por defecto `.env` y `artifacts/.cache`) → `deny` | Claves reales y perfiles de navegador con cookies | Preventiva |
| Forma canónica (`canonicalCommand`): cada regla `deny` se comprueba sobre el comando original y sobre una forma sin extensiones de ejecutable (`.exe`, `.cmd`, `.bat`, `.ps1`), sin opciones globales de git (`-C`, `-c`, `--git-dir`, `--no-pager`…), sin comillas y sin espacios repetidos. Nunca se usa para permitir | Que una variante del mismo comando (`npm.cmd install`, `git -C . commit`, `& "git.exe" push`) esquive una regla `deny` y, con `always-proceed`, se ejecute | Incidente R-04 |
| Redirecciones (`>`), subexpresiones (`$(…)`, comillas invertidas), `../..` o rutas absolutas fuera del repositorio → `ask` | Escrituras y lecturas que la lista segura no puede razonar | Preventiva; la parte de rutas absolutas, incidente R-02 |
| Lista segura → `allow`: comandos de solo lectura, `git status/diff/log/show/rev-parse/ls-files/blame/grep`, `git branch` solo para listar, `node <gate.scriptsDirs>/…`, `npm`/`npm.cmd` con `gate.npmScripts` | Que el agente pueda inspeccionar y verificar sin bloquearse | Incidente I-01 (sin esto, el agente se paraba en cada comando); `npm.cmd`, I-05 |
| Ámbito de edición por rol (`AGY_ROLE` + `gate.roleScopes`): `docs` solo documentación; `qa` veredicto, artefactos, copias `.qa-bak` y la mutación temporal; `vision`, `research` y `review` solo artefactos; `coder` sin restricción. La configuración se combina por rol: redefinir un rol no cambia los demás y solo `null` quita la restricción de un rol | Que cada agente toque solo lo de su papel; un agente de QA no "arregla" el código que evalúa | Incidente I-08; combinación por rol, R-06 |
| Configuración inválida → `deny` todo | Que un error de sintaxis en `relevo.config.json` no abra la puerta | Preventiva (fallo cerrado) |
| Clave `__proto__` en cualquier nivel de `relevo.config.json` → configuración inválida, en `loadConfig` y en la puerta | Que `relevo doctor` y la puerta discrepen: al copiarla, la combinación con los valores por defecto cambiaba el prototipo y perdía la clave (un rol `__proto__` desaparecía y `{"__proto__":"x"}` se daba por válido) | Incidente R-07 |
| Registro de cada decisión en `.agents/hooks/gate.log` | Que el auditor vea qué intentó el agente, incluido lo denegado | Preventiva; parte de la auditoría |

Límite conocido: la puerta compara texto. Un comando envuelto de otra forma puede esquivarla; no es un sandbox. La forma canónica cierra las variantes habituales, pero no todas: por ejemplo, `Start-Process git -ArgumentList push` sigue en `ask` (denegar `Start-Process` rompería el arranque de servidores de prueba) y una ruta escapada con acentos graves de PowerShell también. Se acepta porque trabaja junto con el worktree, la configuración global de agy y la auditoría de Claude, que revisa los `ask` en `gate.log`.

## `relevo check`

No ejecuta suites: comprueba que el ciclo se cumplió.

| Regla | Qué protege | Origen |
|---|---|---|
| Sin cambios respecto a la base → fallo | Comprobar una rama vacía por error | Preventiva |
| Cambia código fuente (`check.sourcePattern`) sin ninguna prueba (`check.testPattern`) → fallo, salvo `--no-tests-reason` | Cambios sin pruebas que los respalden | Preventiva; definición de hecho del origen |
| Cambios sin commit → fallo | Que el veredicto de QA corresponda exactamente al código que se integra | Preventiva |
| Falta el veredicto, es de otro commit, es "rechazado" o tiene suites fallidas → fallo | Integrar algo que QA no aprobó, o aprobó en otra versión | Preventiva; el veredicto está atado al commit, por eso el cierre de documentación va después de integrar |
| Veredicto e índice de decisiones se leen de la raíz del worktree actual, no de la principal | Que `check` dé «Falta el veredicto» con uno válido en el worktree, acepte un veredicto de otra tarea copiado a la raíz principal o no vea una decisión añadida al índice en la rama | Incidente R-05 |
| "Aprobado" con hallazgos de severidad alta → fallo | Veredictos incoherentes | Incidente I-12 (A3) |
| Colores fijos nuevos en interfaz (`check.hardcodedColorFiles`) → fallo, salvo `--allow-colors` | Contrastes que solo funcionan en un tema | Incidente I-13 |
| Código cambiado sin actualizar `check.roadmap` → fallo | Que el estado documentado se desfase del código | Incidente I-10 (A5); petición del autor de documentar siempre lo hecho y lo pendiente |
| Decisión nueva fuera de `check.decisions.index` → fallo | Decisiones vinculantes que nadie encuentra | Preventiva; en el origen, el índice de `AGENTS.md` es lo único que los agentes leen siempre (I-06) |
| `--docs-only` | Revisar solo documentación sin exigir QA de código | Preventiva |
| Suites sugeridas por área (`check.areaSuites`) | Que QA ejecute las E2E del área tocada y no solo las unitarias | Preventiva; en el origen, cambios de interfaz que pasaban las unitarias y rompían flujos |

## Lanzador (`relevo run`)

| Regla | Qué protege | Origen |
|---|---|---|
| Rechaza flags `dangerously`, `bypass` o `skip-permissions` | Desactivar permisos o sandbox del proveedor | Incidente I-02 |
| Raíz del repositorio principal calculada con git; `--cwd` debe existir y estar dentro | Rutas mal resueltas y registros perdidos al borrar un worktree | Incidentes I-20 y R-01 |
| Consulta el cupo y rechaza por debajo de `quota.min` (15 %) salvo `--allow-low-quota`; avisa por debajo de `quota.warn` (30 %) | Agentes que se quedan a medias sin cupo | Incidente I-22 |
| Guarda encargo, metadatos, eventos y errores en `runsDir/<NN>-<tarea>/` | Poder auditar y repetir cualquier ejecución | Preventiva; el panel solo cuenta esas carpetas (I-18) |
| Pasa `AGY_ROLE` y `AGY_RUN_DIR` al agente | Que la puerta aplique el ámbito del rol | Incidente I-08 |

## Comandos de mantenimiento (`doctor`, `task`, `update`) y veredicto

| Regla | Qué protege | Origen |
|---|---|---|
| `doctor` solo lee, y de la configuración global de agy solo `toolPermission` y `permissions.deny`; nunca imprime otras claves | Que un diagnóstico filtre rutas personales (`trustedWorkspaces`) o modifique algo | Preventiva |
| `doctor` exige en `deny` al menos `git push`, `git commit`, `npm publish`, `npm install`, `npx` y `curl` | Que falte la primera capa de permisos sin que nadie lo note | Incidentes I-01 e I-02; la capa 1 no estaba documentada al extraer relevo |
| `doctor` decide el `.gitignore` con `git check-ignore`, no comparando líneas | Avisos falsos cuando una regla más amplia ya cubre la ruta | Hallazgo de auditoría al construir relevo |
| `task done` borra primero el enlace de `node_modules` con `unlink` o `rmdir` sin recursión, y se detiene si es un directorio real | Que cerrar una tarea borre el `node_modules` del repositorio principal a través de la junction | Preventiva; probada con 1.001 archivos reales |
| `task done` exige rama integrada y worktree sin cambios (salvo `--force`) | Perder trabajo no integrado | Preventiva |
| git siempre con argumentos en lista y comprobando el código de salida | Rebases o borrados a medias que pasan desapercibidos | Incidente I-07 |
| `update` usa el registro de instalación como base de una fusión a tres bandas y nunca sobrescribe lo personalizado | Perder los marcadores `<<PROYECTO: …>>` que el usuario rellenó; ofrecer la misma plantilla para siempre | Incidente R-03; `init --force` sobrescribe |
| `update` trata como error una puerta modificada | Que alguien relaje la política editando la puerta en lugar de la configuración | Preventiva; la puerta debe ser idéntica a la de relevo |
| Esquema estricto de `.qa-verdict.json` | Que un campo mal escrito (`"veredicto"`) o una severidad `"High"` se cuele como aprobado | Preventiva; refuerza I-12 |

## Flujo

| Regla | Qué protege | Origen |
|---|---|---|
| Claude planifica y audita; los agentes ejecutan; quien escribe el código no emite el veredicto | Autoaprobación | Decisión inicial del autor; I-12 |
| Encargos precisos para Flash (las 8 reglas: rutas exactas, invariantes copiados, contrato decidido, pruebas enumeradas que fallen sin el cambio, pasos pequeños, prohibiciones, evidencia pegada, decisiones visibles) | Que un modelo rápido rellene huecos con suposiciones | Incidentes I-09, I-13, I-14; petición del autor de usar Flash también en lo delicado |
| "Si algo no coincide, detente y repórtalo" | Que el agente siga adelante sobre un encargo equivocado | Incidente I-16 |
| Auditoría propia (barrido sobre datos reales) además de ejecutar las pruebas | Pruebas que pasan sin probar lo que dicen | Incidentes I-09 e I-14 |
| Documentalista antes de QA | Documentación ausente o desfasada | Incidente I-10 |
| Mutaciones obligatorias en QA con el procedimiento `.qa-bak` | Pruebas que no protegen nada; mutaciones irrecuperables | Incidentes I-11, I-12, I-15 |
| Correcciones con un agente nuevo | Coste de reenviar historiales largos | Incidente I-17 |
| Segunda revisión visual tras cada corrección de interfaz; capturas con el elemento a la vista | Correcciones de interfaz sin comprobar; capturas que no muestran lo auditado | Incidente I-21 |
| Contraste calculado, nunca estimado; texto de capturas contrastado con el código | Falsos positivos y fallos reales que pasan | Incidente I-13 |
| Análisis de capturas en un agente `vision`, no en Claude | Coste de tokens de imágenes en el contexto de Claude | Petición del autor |
| Nunca canalizar `rebase`, `merge` ni `commit`; conflictos los resuelve Claude | Rebases a medias | Incidente I-07 |
| Orden de cierre: veredicto sobre HEAD → `check` → fast-forward → cierre de documentación en la rama principal | Que el veredicto deje de corresponder al commit integrado | Preventiva; consecuencia de atar el veredicto al commit |
| Sin push ni publicación salvo petición explícita | Publicar sin que el autor lo decida | Regla del autor |
| `AGENTS.md` y `CLAUDE.md` por debajo de 20.000 bytes | Reglas truncadas | Incidente I-06 |
| Sin `--sandbox` ni `-i` con agy | Worktrees rotos; bloqueo esperando confianza | Incidentes I-03 e I-04 |
