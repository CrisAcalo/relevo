# Por qué existe cada regla

Cada regla de la puerta de permisos (`lib/permission-gate.cjs`), de `relevo check` (`lib/check-change.cjs`), del lanzador y del flujo, con lo que protege y su origen. **Incidente** enlaza a [incidentes.md](incidentes.md); **preventiva** significa que se puso antes de que fallara nada, por el riesgo evidente. Antes de quitar o relajar una regla, leer su fila.

## Puerta de permisos

Decisiones posibles: `allow` (se ejecuta), `deny` (se bloquea con el motivo) y `ask` (fuera de la lista segura: decide la configuración del CLI). **Con `toolPermission: "always-proceed"`, `ask` se ejecuta**: por ejemplo, el `Copy-Item` del procedimiento de mutación de QA no está en la lista segura y funciona. Por eso todo lo peligroso debe ser `deny`, nunca `ask`; las peticiones `ask` quedan en `gate.log` para que la auditoría las revise.

| Regla | Qué protege | Origen |
|---|---|---|
| Git que modifica índice, historial o ramas (`push`, `commit`, `merge`, `rebase`, `reset`, `checkout`, `switch`, `restore`, `tag`, `remote`, `add`, `rm`, `mv`, `stash`, `cherry-pick`, `revert`, `am`, `apply`, `clean`, `worktree`, borrar o mover ramas) → `deny` a todos los roles | Que solo Claude, tras auditar, cambie el historial; que un agente no deje un rebase a medias ni publique nada | Incidentes I-07 e I-08 (A5b) |
| `npm install/ci/uninstall/update/publish/link/exec`, `npx`, `pnpm`, `yarn` → `deny` | Dependencias no auditadas, código de paquetes descargado y ejecutado, publicación accidental, mezcla de gestores de paquetes | Preventiva; en el origen, además, el autor eligió un único gestor (npm) |
| Red (`curl`, `wget`, `Invoke-WebRequest`, `irm`, `ssh`, `scp`) → `deny` | Exfiltración de código o secretos y descargas no auditadas durante una tarea de código | Preventiva (comprobada en I-01: `curl` denegado) |
| Borrados recursivos (`rm -r…`, `Remove-Item -Recurse`, `rmdir /s`, `del /s`, `Format-Volume`) → `deny` | Pérdida de trabajo o del worktree; los artefactos los limpia Claude | Preventiva |
| Ejecución dinámica o cambios de sistema (`Invoke-Expression`, `iex`, `Add-Type`, `Set-ExecutionPolicy`, `reg add`, `setx`) → `deny` | Que un agente esquive la política construyendo el comando en tiempo de ejecución o cambie el sistema | Preventiva |
| Navegadores visibles (`chrome`, `msedge`, `firefox` sin `--headless`) y herramientas `browser_*` → `deny` | Ventanas que interrumpen al usuario y perfiles reales con sus sesiones; las pruebas de interfaz van headless | Preventiva; regla de origen del proyecto (todo E2E headless con perfil propio) |
| Rutas sensibles (`gate.sensitivePaths`, por defecto `.env` y `artifacts/.cache`) → `deny` | Claves reales y perfiles de navegador con cookies | Preventiva |
| Redirecciones (`>`), subexpresiones (`$(…)`, comillas invertidas), `../..` o rutas absolutas fuera del repositorio → `ask` | Escrituras y lecturas que la lista segura no puede razonar | Preventiva; la parte de rutas absolutas, incidente R-02 |
| Lista segura → `allow`: comandos de solo lectura, `git status/diff/log/show/branch/rev-parse/ls-files/blame/grep`, `node <gate.scriptsDirs>/…`, `npm`/`npm.cmd` con `gate.npmScripts` | Que el agente pueda inspeccionar y verificar sin bloquearse | Incidente I-01 (sin esto, el agente se paraba en cada comando); `npm.cmd`, I-05 |
| Ámbito de edición por rol (`AGY_ROLE` + `gate.roleScopes`): `docs` solo documentación; `qa` veredicto, artefactos, copias `.qa-bak` y la mutación temporal; `vision`, `research` y `review` solo artefactos; `coder` sin restricción | Que cada agente toque solo lo de su papel; un agente de QA no "arregla" el código que evalúa | Incidente I-08 |
| Configuración inválida → `deny` todo | Que un error de sintaxis en `relevo.config.json` no abra la puerta | Preventiva (fallo cerrado) |
| Registro de cada decisión en `.agents/hooks/gate.log` | Que el auditor vea qué intentó el agente, incluido lo denegado | Preventiva; parte de la auditoría |

Límite conocido: la puerta compara texto. Un comando envuelto de otra forma puede esquivarla; no es un sandbox. Se acepta porque trabaja junto con el worktree, la configuración global de agy y la auditoría de Claude.

## `relevo check`

No ejecuta suites: comprueba que el ciclo se cumplió.

| Regla | Qué protege | Origen |
|---|---|---|
| Sin cambios respecto a la base → fallo | Comprobar una rama vacía por error | Preventiva |
| Cambia código fuente (`check.sourcePattern`) sin ninguna prueba (`check.testPattern`) → fallo, salvo `--no-tests-reason` | Cambios sin pruebas que los respalden | Preventiva; definición de hecho del origen |
| Cambios sin commit → fallo | Que el veredicto de QA corresponda exactamente al código que se integra | Preventiva |
| Falta el veredicto, es de otro commit, es "rechazado" o tiene suites fallidas → fallo | Integrar algo que QA no aprobó, o aprobó en otra versión | Preventiva; el veredicto está atado al commit, por eso el cierre de documentación va después de integrar |
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

## Pendiente detectado al escribir este documento

- El motivo de denegación de navegadores visibles menciona `scripts/lib/browser.cjs`, un archivo del proyecto de origen: debería ser genérico o configurable.
- El comentario inicial de `lib/permission-gate.cjs` dice que con `ask` "decide el humano"; con `always-proceed` no es así (ver arriba). Corregir el comentario.
