# relevo

**relevo** es un kit de delegación, ejecución y auditoría de agentes de código para proyectos desarrollados con **Claude Code**.

Extraído del proyecto «Procedural // Studio» (GeneradorMusica), relevo permite que Claude Code actúe como director técnico (planifica, redacta encargos exactos, audita de forma independiente y hace commit) mientras delega la implementación, investigación, pruebas y control de calidad a agentes CLI de otros proveedores (hoy Antigravity CLI `agy` con modelos Google Gemini Flash High y Argon; adaptador para OpenAI Codex preparado).

Los agentes trabajan en **worktrees aislados** con **permisos acotados por rol**, y nada se integra en la rama principal sin verificación mecánica independiente.

---

## Para quién es

- Para desarrolladores que utilizan Claude Code como interfaz principal y desean delegar tareas pesadas, iterativas o de código a modelos rápidos y económicos (como Gemini Flash High) sin arriesgar la estabilidad del repositorio.
- Para proyectos que requieren una separación formal entre quien escribe el código y quien emite el veredicto de calidad (QA independiente).
- Para quienes necesitan ejecutar agentes de fondo sin sufrir bloqueos manuales por confirmación de permisos en bucle ni otorgar acceso total sin supervisión.

---

## Requisitos

- **Node.js** ≥ 22.12
- **git**
- **Claude Code**
- Un CLI de agente compatible:
  - **Antigravity CLI (`agy`)** (verificado y recomendado).
  - **OpenAI Codex CLI (`codex`)** (adaptador implementado, pendiente de validar con una ejecución real).

---

## Instalación

Actualmente el kit se encuentra en fase de desarrollo (v0.1.0):

1. Clona este repositorio:
   ```bash
   git clone <url-repositorio-relevo>
   ```

2. Inicializa relevo en el proyecto destino:
   ```bash
   node <ruta-a-relevo>/bin/relevo.cjs init
   ```
   *(Copia las plantillas de skills a `.claude/skills/` y agentes a `.agents/plugins/relevo/agents/`, configurando además el hook de permisos).*

3. *(Opcional)* Enlace global mediante npm:
   ```bash
   # Dentro de la carpeta de relevo:
   npm link

   # En tu proyecto:
   relevo init
   ```

---

## Comandos del kit

Los comandos se ejecutan mediante el ejecutable `relevo` (o vía scripts en `package.json` si defines los alias):

| Comando | Alias npm sugerido | Descripción |
|---|---|---|
| `relevo run` | `npm run agent:run` | Lanza una tarea de agente con rol, modelo y encargo en segundo plano. |
| `relevo watch` | `npm run agents` | Monitor interactivo en terminal para seguir a los agentes en vivo. |
| `relevo quota` | `npm run agents:quota` | Consulta los cupos disponibles de los proveedores sin gastar tokens. |
| `relevo check` | `npm run check:change` | Control mecánico de la definición de hecho sobre la rama actual. |
| `relevo init` | — | Inicializa relevo y copia las plantillas al proyecto actual. |

---

## Configuración (`relevo.config.json`)

El comportamiento de relevo se adapta a cada proyecto mediante el archivo `relevo.config.json` en la raíz del repositorio:

| Clave | Descripción | Valor por defecto |
|---|---|---|
| `runsDir` | Carpeta donde se almacenan metadatos y eventos de cada ejecución | `artifacts/agent-runs` |
| `worktreesDir` | Carpeta donde se crean los worktrees de las tareas | `.worktrees` |
| `quota.min` | Umbral mínimo de cupo para permitir el lanzamiento de un agente | `0.15` |
| `quota.warn` | Umbral de advertencia de cupo bajo | `0.3` |
| `gate.scriptsDirs` | Directorios de scripts de verificación autorizados en el gate | `scripts` |
| `gate.npmScripts` | Scripts npm autorizados para ejecución por agentes en el gate | `check`, `verify`, `build`, `dev`, `preview`, `test`, `test:*`, `check:*` |
| `gate.sensitivePaths` | Patrones de rutas sensibles protegidas contra lectura/escritura | `.env`, `artifacts/.cache` |
| `gate.roleScopes` | Diccionario de patrones (expresiones regulares) de archivos modificables según cada rol; los roles sin entrada (p. ej. `coder`) no tienen restricción de rutas | `docs`, `qa`, `vision`, `research`, `review` |
| `check.baseBranch` | Rama base contra la que se comparan los cambios | `main` |
| `check.sourcePattern` | Patrón de archivos de código que exigen pruebas unitarias | `^src/` |
| `check.testPattern` | Patrón de archivos de pruebas admitidos para cubrir código | `^(scripts/test-[\w.-]+\.cjs|test/[\w./-]+)$` |
| `check.roadmap` | Ruta al archivo de hoja de ruta / estado del proyecto | `null` (desactivado) |
| `check.decisions.dir` | Directorio donde residen los registros de decisiones | `null` (desactivado) |
| `check.decisions.index` | Archivo que contiene el índice de decisiones | `null` (desactivado) |
| `check.verdictFile` | Nombre del archivo de veredicto generado por el agente de QA | `.qa-verdict.json` |
| `check.hardcodedColorFiles` | Patrón de archivos de UI donde se prohíben colores fijos sin tokens | `null` (desactivado) |
| `check.areaSuites` | Lista de asociaciones entre patrones de archivos y suites de prueba E2E | `[]` |

---

## Ciclo de una tarea

El flujo de trabajo sigue un orden riguroso por relevos:

```text
[Claude] Redacta encargo preciso y prepara worktree
   │
   ▼
[Agente: coder] Implementa código y pruebas unitarias en .worktrees/<tarea>
   │
   ▼
[Claude] Auditoría independiente (inspección de diff, pruebas y barrido propio)
   │
   ▼
[Agente: documentalista] Actualiza documentación (roadmap, decisiones, índice)
   │
   ▼
[Claude] Commit de código y documentación en la rama de la tarea
   │
   ▼
[Agente: qa] Verificación headless, auditoría de capturas y mutaciones (.qa-bak) -> .qa-verdict.json
   │
   ▼
[Claude] Auditoría del veredicto y control mecánico con `relevo check`
   │
   ▼
[Claude] Integración fast-forward en la rama principal
   │
   ▼
[Claude] Commit de cierre documental en la rama principal y limpieza de worktree
```

1. **Encargo**: Claude formula un encargo cerrado con contratos, invariantes, archivos tocados y pruebas esperadas (aplicando las 8 reglas para modelos Flash).
2. **Codificador**: El agente ejecuta en segundo plano con permisos acotados en su propio worktree.
3. **Auditoría de Claude**: Claude no confía en el resumen del agente; ejecuta sus propias pruebas y verifica que no existan aserciones tautológicas.
4. **Documentalista**: Se actualizan las decisiones y hojas de ruta reflejando el diff real.
5. **Commit**: Claude genera el commit en la rama de trabajo.
6. **QA con mutaciones**: El agente `qa` (independiente de quien programó) ejecuta las suites, aplica mutaciones temporales obligatorias con procedimiento seguro `.qa-bak` para comprobar que las pruebas realmente detectan fallos, y emite `.qa-verdict.json`.
7. **Check mecánico**: `relevo check` valida que el veredicto esté atado al HEAD actual, que no existan hallazgos altos y que la documentación esté al día.
8. **Integración y cierre**: Integración limpia en la rama principal, commit de cierre y eliminación del worktree.

---

## Roles y permisos de edición

La puerta de permisos (`permission-gate`) intercepta las acciones del agente y limita qué archivos puede modificar según su rol:

| Rol | Ámbito de modificación permitido |
|---|---|
| `coder` | Archivos de código y pruebas del proyecto según el encargo (sin restricción de ámbito interno de repositorio). |
| `qa` | Exclusivamente `.qa-verdict.json`, carpeta `artifacts/` y archivos temporales `.qa-bak` durante el procedimiento de mutación en código o scripts. |
| `docs` | Exclusivamente `docs/**`, `AGENTS.md`, `CONTRIBUTING.md` (o los configurados en el proyecto). No puede tocar código. |
| `vision` | Exclusivamente la carpeta `artifacts/` (guardado de informes de auditoría visual). |
| `research` | Exclusivamente la carpeta `artifacts/` (informes y notas de investigación). |
| `review` | Exclusivamente `artifacts/` y `.qa-verdict.json`. |

Todos los roles tienen denegado por política:
- Comandos de git que modifiquen el índice, historial o ramas (`commit`, `push`, `rebase`, `merge`, `checkout`, etc.).
- Modificación o instalación de dependencias (`npm install`, `npx`, etc.).
- Comandos de red directos (`curl`, `wget`, `Invoke-WebRequest`, etc.).
- Borrados recursivos (`rm -rf`, `Remove-Item -Recurse`, etc.).
- Ejecución dinámica no auditada (`eval`, `Invoke-Expression`, etc.).
- Navegadores visibles (exige modo headless).
- Acceso a archivos sensibles (`.env`, perfiles de navegador).

---

## Panel en vivo y consulta de cupos

### Panel de seguimiento (`relevo watch`)
Permite supervisar en tiempo real a todos los agentes activos o recientes:
- Tarjetas informativas por agente con proveedor, rol, modelo, duración y tokens consumidos.
- Desglose de acciones (lecturas, búsquedas, ediciones, comandos, pausas).
- Navegación por teclado: `↑`/`↓` para seleccionar agente, `Enter` para ver el log detallado paso a paso, `Esc` para regresar, `q` para salir.
- Modo no interactivo para scripts o CI: `relevo watch --once` o `relevo watch --list`.

### Consulta de cupos (`relevo quota`)
Permite consultar los cupos restantes del proveedor sin consumir tokens de contexto ni realizar inferencias:
- Diferencia entre grupos de modelos (ej. Gemini Flash/Pro y Argon).
- Bloquea lanzamientos si el cupo cae por debajo de `quota.min` (por defecto 15 %).
- Permite forzar el lanzamiento bajo cupo bajo únicamente con justificación explícita (`--allow-low-quota`).

---

## Seguridad y límites

1. **La política compara texto**: La puerta de permisos analiza sintácticamente las llamadas a herramientas y comandos. No sustituye a un sandbox hermético de sistema operativo; su propósito es prevenir errores accidentales y acotar el comportamiento de agentes autónomos en repositorios de confianza.
2. **Sin flags de bypass**: Ningún comando ni lanzador añade flags que desactiven el sandbox o los permisos (`--dangerously-skip-permissions`, `--bypass`, etc.). Si se detectan en los argumentos, la ejecución es abortada.
3. **Claves de API seguras**: Las credenciales de proveedores se gestionan exclusivamente mediante variables de entorno en la sesión del usuario, nunca en archivos del repositorio.
4. **Configuración global del CLI**: Las opciones globales de configuración del agente (como `toolPermission: "always-proceed"` en agy) son gestionadas directamente por el usuario; Claude Code no modifica archivos fuera del espacio de trabajo.

---

## Decisiones

- [01 · Origen, alcance y nombre](docs/decisions/01-origen-y-alcance.md)
- [02 · Flujo Claude + agentes](docs/decisions/02-flujo-claude-agentes.md)

---

## Estado del proyecto

- **Versión**: 0.1.0 (en desarrollo activo, no publicado en registro público).
- **Adaptadores**:
  - `agy` (Antigravity CLI): Validado y operativo en producción con modelos Gemini Flash High y Argon.
  - `codex` (OpenAI Codex CLI): Adaptador implementado según especificación de eventos JSONL (`codex exec --json`); pendiente de validación con una ejecución real.
