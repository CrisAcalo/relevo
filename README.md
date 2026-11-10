# relevo

> Claude planifica y audita; agentes de otros proveedores implementan en worktrees con permisos acotados por rol; nada se integra sin verificación independiente.

**relevo** es un kit de delegación, ejecución y auditoría de agentes de código para proyectos desarrollados con **Claude Code**. Claude Code actúa como director técnico: planifica, redacta encargos exactos, audita y hace commit. La implementación, la investigación, las pruebas y el control de calidad se delegan a agentes CLI de otros proveedores, hoy **Antigravity CLI (`agy`)** con modelos Gemini, con un adaptador para **OpenAI Codex** preparado.

Como en una carrera de relevos, cada tramo tiene su corredor y su carril: Claude entrega el testigo en forma de encargo, el agente corre dentro de su carril (un worktree y una puerta de permisos) y el testigo vuelve a Claude, que actúa de juez antes de cruzar la meta (integración en `main`).

---

## Construido con relevo

relevo se ha desarrollado aplicando su propio flujo. Claude Code planificó el kit, redactó los encargos y auditó cada entrega; agentes `agy` con **Gemini 3.8 Flash High** escribieron el código en worktrees aislados y en paralelo:

| Ejecución | Encargo | Duración | Tokens |
|---|---|---|---|
| `01-relevo-config` | `relevo.config.json`, política y `check` parametrizados, `relevo init` | 17 min | 383k |
| `02-relevo-plantillas` | Plantillas genéricas de skills y agentes, documentación | 9 min | 220k |
| `03-task-update` | `relevo task` y `relevo update` | 10 min | 363k |
| `04-doctor-veredicto` | `relevo doctor` y esquema estricto del veredicto de QA | 11 min | 280k |
| `05-update-base` | Corrección: fusión a tres bandas en `update` | 7 min | 158k |
| `06-doctor-gitignore` | Corrección: `doctor` consulta `git check-ignore` | 6 min | 189k |

En total, seis agentes en rol `coder`, aproximadamente una hora de ejecución y 1,6 millones de tokens de Flash. Las tareas se lanzaron por parejas en paralelo con `relevo run`, se siguieron con `relevo watch` y se integraron solo después de la auditoría de Claude y de `relevo check`.

Las dos últimas son rondas de corrección, y muestran el valor de la auditoría independiente: Claude encontró, leyendo el código, que la primera versión de `update` habría ofrecido la misma plantilla para siempre ([incidente R-03](docs/incidentes.md)) y que `doctor` daba avisos falsos con reglas de `.gitignore` más amplias. Cada corrección fue a un agente nuevo con un encargo preciso, no a la misma conversación. `git log --graph` muestra las ramas paralelas y su integración.

El origen del flujo es anterior: se extrajo del proyecto «Procedural // Studio», donde se validó con tareas reales de código, QA E2E, investigación y análisis de capturas (ver [decisión 01](docs/decisions/01-origen-y-alcance.md)).

---

## Para quién es

- Desarrolladores que usan Claude Code como interfaz principal y quieren delegar tareas pesadas o iterativas a modelos rápidos y económicos sin arriesgar la estabilidad del repositorio.
- Proyectos que quieren separar formalmente a quien escribe el código de quien emite el veredicto de calidad.
- Quien necesita agentes en segundo plano sin confirmar permisos en bucle y sin darles acceso total sin supervisión.

---

## Requisitos

- **Node.js** ≥ 22.12 (sin dependencias de terceros).
- **git**
- **Claude Code**
- Un CLI de agente:
  - **Antigravity CLI (`agy`)**: verificado y recomendado.
  - **OpenAI Codex CLI (`codex`)**: adaptador implementado, pendiente de validar con una ejecución real.

---

## Inicio rápido

```bash
# 1. Clona relevo y, opcionalmente, enlázalo como comando global
git clone https://github.com/CrisAcalo/relevo.git
cd relevo && npm link

# 2. En tu proyecto (un repositorio git), instala configuración, plantillas y hook de permisos
cd ../mi-proyecto
relevo init            # o: node ../relevo/bin/relevo.cjs init

# 3. Comprueba el entorno y la instalación
relevo doctor
```

`relevo init` es idempotente y crea:

| Destino | Contenido |
|---|---|
| `relevo.config.json` | Configuración del proyecto (ver abajo). |
| `.claude/skills/` | Skills `delegar-agy`, `verificar-cambio`, `definicion-de-hecho`, `e2e-headless`, `auditar-capturas`. |
| `.agents/plugins/relevo/agents/` | Agentes `qa` y `documentalista`. |
| `.agents/hooks/permission-gate.cjs` y `.agents/hooks.json` | Puerta de permisos (hook `PreToolUse` de agy). |
| `.agents/plugins/relevo/plugin.json`, `.agents/skills.json` | Registro del plugin y de las skills para agy. |
| `.agents/relevo.lock.json` | Hash de cada plantilla instalada; es la base de `relevo update`. |
| `.gitignore` | `artifacts/agent-runs/`, `.worktrees/`, `.agents/hooks/gate.log`, `.qa-verdict.json`, `*.qa-bak`, `*.relevo-new`. |

Opciones: `--dry-run` muestra lo que haría; `--force` sobrescribe las plantillas modificadas. Nunca toca `relevo.config.json` ni `.agents/skills.json`.

Después:

1. Completa los marcadores `<<PROYECTO: …>>` de las plantillas con los comandos y suites de tu proyecto (`doctor` avisa de los que queden).
2. Aplica tú mismo la configuración global de agy a partir de [templates/agy-settings.example.json](templates/agy-settings.example.json): `toolPermission: "always-proceed"` y las reglas `deny` mínimas. Es la primera capa de permisos ([explicación](templates/agy-settings.example.md)); Claude no puede ni debe editarla por ti.

### Una tarea de principio a fin

```bash
# Worktree aislado: .worktrees/mi-tarea, rama relevo/mi-tarea y node_modules enlazado
relevo task new mi-tarea

# Lanzar el agente (siempre desde la raíz del repositorio principal)
relevo run --provider agy --role coder --model gemini-3.8-flash-high \
  --task mi-tarea --cwd .worktrees/mi-tarea --brief encargos/mi-tarea.md

# Seguirlo en vivo
relevo watch

# Tras auditar y obtener el veredicto de QA, en la rama de la tarea
relevo check

# Una vez integrada la rama en main
relevo task done mi-tarea
```

---

## Comandos

| Comando | Alias npm sugerido | Descripción |
|---|---|---|
| `relevo init` | — | Instala configuración, plantillas y hook en el proyecto actual. |
| `relevo doctor` | — | Comprueba entorno, configuración global de agy e instalación; solo lee. |
| `relevo task new\|done\|list` | — | Crea, cierra y lista worktrees de tarea. |
| `relevo run` | `npm run agent:run` | Lanza un agente en segundo plano con proveedor, rol, modelo y encargo. |
| `relevo watch` | `npm run agents` | Panel interactivo para seguir a los agentes en vivo. |
| `relevo quota` | `npm run agents:quota` | Cupos restantes del proveedor sin consumir tokens. |
| `relevo check` | `npm run check:change` | Control mecánico de la definición de hecho sobre la rama actual. |
| `relevo update` | — | Actualiza lo instalado sin pisar lo personalizado. |

Referencia completa en [docs/comandos.md](docs/comandos.md).

### `relevo doctor`

Comprueba Node, git, `agy`, la configuración global de agy (`toolPermission` y reglas `deny` mínimas), `relevo.config.json`, que la puerta instalada sea idéntica a la de relevo, `hooks.json`, `.gitignore` y marcadores sin rellenar. De la configuración global solo lee esas dos claves y nunca imprime otras, porque contienen rutas personales. `--json` para scripts; código 1 si hay algún error.

### `relevo task`

- `task new <nombre> [--from <ref>]`: crea `.worktrees/<nombre>` en la rama `relevo/<nombre>` (prefijo `taskBranchPrefix`) y enlaza `node_modules` (junction en Windows, symlink en el resto).
- `task done <nombre> [--force]`: exige rama integrada en la base y worktree sin cambios; quita primero el enlace de `node_modules` sin recursión, para no borrar el del repositorio principal, y después el worktree y la rama.
- `task list`: tareas abiertas, si están integradas y si tienen cambios.

### `relevo run`

| Opción | Descripción |
|---|---|
| `--provider` | `agy` o `codex`. |
| `--role` | `coder`, `qa`, `docs`, `vision`, `research` o `review`; restringe qué archivos puede editar. |
| `--model` | Modelo del proveedor (p. ej. `gemini-3.8-flash-high`). |
| `--task` | Nombre de la tarea (letras, números y guiones). |
| `--cwd` | Worktree donde trabaja el agente; debe existir dentro del repositorio. |
| `--brief` | Archivo con el encargo. |
| `--timeout` | Segundos máximos (por defecto 3000). |
| `--mode`, `--conversation`, `--agent` | Opciones de agy (plan, continuar una conversación, agente concreto). |
| `--sandbox` | Modo de sandbox de Codex (por defecto `workspace-write`). |
| `--allow-low-quota` | Lanza aunque el cupo esté por debajo de `quota.min`; exige justificarlo. |

Cada ejecución guarda en `artifacts/agent-runs/<NN>-<tarea>/` el encargo (`brief.md`), los metadatos (`meta.json`, con cupo antes y después), los eventos del CLI (`events.ndjson`) y `stderr.log`.

### `relevo watch`

- Tarjetas por agente con proveedor, rol, modelo, duración y tokens.
- Desglose de acciones: lecturas, búsquedas, ediciones, comandos y esperas.
- Teclado: `↑`/`↓` selecciona, `Enter` abre el registro paso a paso, `Esc` vuelve, `q` sale.
- Sin interacción, para scripts: `relevo watch --list` (tabla de ejecuciones) o `relevo watch <NN> --once` (detalle de una).

### `relevo quota`

- Consulta `agy -p /usage`, que no consume tokens, y distingue grupos de cupo (Gemini, Argon, terceros).
- `relevo run` bloquea el lanzamiento por debajo de `quota.min` (15 %) y avisa por debajo de `quota.warn` (30 %).
- `--json` devuelve el resultado normalizado.

### `relevo check`

Compara la rama actual con su base (`git merge-base`) y falla si:

- Cambia código fuente (`check.sourcePattern`) sin tocar pruebas (`check.testPattern`), salvo `--no-tests-reason "<motivo>"`.
- Falta el veredicto de QA, no cumple el esquema estricto, es de otro commit, no está `aprobado`, tiene suites fallidas o hallazgos de severidad alta. El formato de `.qa-verdict.json` está en la plantilla del agente [qa](templates/agents/qa.md): una clave desconocida o una severidad `"High"` es un fallo, no se interpreta.
- Hay cambios sin commit cuando el veredicto debe corresponder a un commit.
- No se actualizó la hoja de ruta (`check.roadmap`) o una decisión nueva no aparece en su índice (`check.decisions`).
- Hay colores fijos nuevos en archivos de interfaz (`check.hardcodedColorFiles`), salvo `--allow-colors "<motivo>"`.

También sugiere las suites E2E del área tocada (`check.areaSuites`). Otras opciones: `--base <ref>` y `--docs-only`.

### `relevo update`

Fusión a tres bandas entre la plantilla actual, el archivo instalado y la base guardada en `.agents/relevo.lock.json`:

- Si no tocaste el archivo, se actualiza.
- Si lo personalizaste y hay plantilla nueva, se escribe `<archivo>.relevo-new` al lado para que la integres tú, y no se vuelve a ofrecer.
- Una puerta de permisos modificada es un error: la puerta no se personaliza, se configura en `relevo.config.json`. Solo `--apply --force` la sobrescribe.

Sin `--apply` solo muestra el plan.

---

## Ciclo de una tarea

```text
[Claude]          Encargo preciso y worktree
[coder]           Implementa código y pruebas en .worktrees/<tarea>
[Claude]          Auditoría independiente: diff, pruebas propias, barrido
[documentalista]  Actualiza documentación a partir del diff real
[Claude]          Commit en la rama de la tarea
[qa]              Pruebas headless, mutaciones (.qa-bak) → .qa-verdict.json
[Claude]          Revisión del veredicto y relevo check
[Claude]          Integración en main, cierre documental y limpieza del worktree
```

Principios del ciclo:

- **Claude no confía en el resumen del agente**: ejecuta sus propias pruebas y busca aserciones tautológicas.
- **Quien escribe el código no emite el veredicto**: el agente `qa` es otro agente.
- **Las mutaciones son obligatorias**: QA rompe a propósito el código protegido para comprobar que las pruebas lo detectan.
- **Las rondas de corrección van a un agente nuevo** con un encargo preciso, no a la misma conversación (reenviar el historial dispara el coste).
- **Claude hace los commits y nunca hace push** sin petición explícita del usuario.

El procedimiento completo, incluidas las 8 reglas para redactar encargos a modelos Flash, está en la skill [`delegar-agy`](templates/skills/delegar-agy/SKILL.md) y en la [decisión 02](docs/decisions/02-flujo-claude-agentes.md).

---

## Puerta de permisos

relevo protege con dos capas:

1. **Configuración global de agy** (la aplica el usuario): `toolPermission: "always-proceed"`, para que el agente avance sin nadie que apruebe, y reglas `deny` mínimas (`git push`, `git commit`, `npm publish`, `npm install`, `npx`, `curl`).
2. **Puerta del repositorio**: `permission-gate.cjs`, un hook `PreToolUse` de agy que recibe cada llamada a herramienta y responde `allow`, `deny` o `ask`, y registra cada decisión en `.agents/hooks/gate.log`.

> **Con `always-proceed`, `ask` se ejecuta.** Por eso todo lo peligroso es `deny`, nunca `ask`; las peticiones `ask` quedan en `gate.log` para que la auditoría las revise.

**Denegado a todos los roles:**

- git que modifica índice, historial o ramas (`commit`, `push`, `merge`, `rebase`, `checkout`, `reset`, …).
- Cambios de dependencias o ejecución de paquetes (`npm install`, `npx`, `pnpm`, `yarn`).
- Red directa (`curl`, `wget`, `Invoke-WebRequest`, `ssh`, …).
- Borrados recursivos y ejecución dinámica (`rm -rf`, `Remove-Item -Recurse`, `Invoke-Expression`, …).
- Navegadores visibles y herramientas de navegador del agente (solo headless).
- Rutas sensibles (`gate.sensitivePaths`, por defecto `.env` y `artifacts/.cache`).

**Permitido sin preguntar:** lectura e inspección, git de solo lectura, scripts de `gate.scriptsDirs` y scripts npm de `gate.npmScripts`.

**Ámbito de edición por rol** (configurable en `gate.roleScopes`):

| Rol | Puede editar |
|---|---|
| `coder` | Sin restricción de rutas. |
| `docs` | `docs/`, `AGENTS.md`, `CONTRIBUTING.md`, `README.md`. |
| `qa` | `.qa-verdict.json`, `artifacts/`, `*.qa-bak` y, para las mutaciones temporales, `src/`, `scripts/` y `test/`. |
| `review` | `artifacts/` y `.qa-verdict.json`. |
| `vision`, `research` | `artifacts/`. |

El porqué de cada regla, y el incidente real que la motivó cuando lo hubo, está en [docs/por-que-cada-regla.md](docs/por-que-cada-regla.md).

---

## Configuración (`relevo.config.json`)

Todas las claves son opcionales.

| Clave | Descripción | Por defecto |
|---|---|---|
| `runsDir` | Registros de cada ejecución | `artifacts/agent-runs` |
| `worktreesDir` | Carpeta de worktrees | `.worktrees` |
| `taskBranchPrefix` | Prefijo de las ramas que crea `relevo task new` | `relevo/` |
| `quota.min` | Cupo mínimo para lanzar | `0.15` |
| `quota.warn` | Cupo que genera aviso | `0.3` |
| `gate.scriptsDirs` | Carpetas de scripts que los agentes pueden ejecutar con `node` | `["scripts"]` |
| `gate.npmScripts` | Scripts npm permitidos (`*` como comodín final) | `check`, `verify`, `build`, `dev`, `preview`, `test`, `test:*`, `check:*` |
| `gate.sensitivePaths` | Rutas protegidas | `.env`, `artifacts/.cache` |
| `gate.roleScopes` | Expresiones regulares de rutas editables por rol; un rol sin entrada no tiene restricción | ver tabla de roles |
| `check.baseBranch` | Rama base | `main` |
| `check.sourcePattern` | Código que exige pruebas | `^src/` |
| `check.testPattern` | Archivos que cuentan como pruebas | `^(scripts/test-[\w.-]+\.cjs\|test/[\w./-]+)$` |
| `check.roadmap` | Hoja de ruta que debe actualizarse | `null` |
| `check.decisions.dir` / `.index` | Carpeta de decisiones y archivo índice | `null` |
| `check.verdictFile` | Veredicto de QA | `.qa-verdict.json` |
| `check.hardcodedColorFiles` | Archivos de interfaz sin colores fijos | `null` |
| `check.areaSuites` | `[{ "pattern": "...", "suites": ["..."] }]` | `[]` |

Ejemplo (la configuración del propio relevo):

```json
{
  "check": {
    "sourcePattern": "^(lib|bin)/",
    "testPattern": "^test/[\\w./-]+$",
    "decisions": { "dir": "docs/decisions", "index": "README.md" }
  }
}
```

---

## Seguridad y límites

1. **La puerta compara texto.** Analiza comandos y rutas; no es un sandbox de sistema operativo. Sirve para evitar errores y acotar agentes en repositorios de confianza, no para contener código hostil.
2. **Sin flags de bypass.** Ningún lanzador añade flags que desactiven permisos o sandbox (`--dangerously-skip-permissions`, `--bypass`, …); si aparecen en los argumentos, `relevo run` aborta.
3. **Credenciales solo en el entorno.** Las claves de los proveedores viven en variables de entorno de la sesión, nunca en el repositorio.
4. **La configuración global del CLI es del usuario.** Ajustes como `toolPermission: "always-proceed"` en agy los aplica el usuario; Claude no modifica archivos fuera del espacio de trabajo. `relevo doctor` comprueba que estén.
5. **Agentes headless.** Todo agente corre en segundo plano sin abrir ventanas.

---

## Desarrollo

```bash
npm test          # Windows: npm.cmd test
node bin/relevo.cjs check
```

```text
bin/relevo.cjs           punto de entrada del CLI
lib/run.cjs              lanzador de agentes
lib/providers.cjs        adaptadores agy y codex (lanzamiento y eventos)
lib/runs.cjs             modelo común de ejecución
lib/watch.cjs            panel en vivo
lib/quota.cjs            cupos
lib/check-change.cjs     definición de hecho
lib/verdict.cjs          esquema de .qa-verdict.json
lib/config.cjs           carga y validación de relevo.config.json
lib/init.cjs             instalación en un proyecto
lib/doctor.cjs           diagnóstico
lib/task.cjs             worktrees de tarea
lib/update.cjs           actualización con fusión a tres bandas
lib/permission-gate.cjs  puerta de permisos (autocontenida)
templates/               skills, agentes y hooks que instala init
test/                    pruebas (node:assert, sin dependencias)
```

Convenciones: CommonJS con `'use strict'`, solo módulos `node:`, rutas compatibles con Windows y POSIX, textos en español. Ver [CLAUDE.md](CLAUDE.md).

---

## Documentación

- [Comandos](docs/comandos.md): referencia completa, incluidos `doctor`, `task`, `update` y el formato del veredicto.
- [Por qué existe cada regla](docs/por-que-cada-regla.md): qué protege cada regla y su origen. Léelo antes de quitar o relajar una.
- [Registro de incidentes](docs/incidentes.md): los fallos reales, con síntoma, causa y regla resultante.

### Decisiones

- [01 · Origen, alcance y nombre](docs/decisions/01-origen-y-alcance.md)
- [02 · Flujo Claude + agentes](docs/decisions/02-flujo-claude-agentes.md)

---

## Estado

- **Versión 0.1.0**, en desarrollo activo; no publicada en npm.
- **`agy`**: validado en uso real con Gemini Flash High y Argon.
- **`codex`**: adaptador implementado según `codex exec --json` y probado con eventos sintéticos; falta una ejecución real.
