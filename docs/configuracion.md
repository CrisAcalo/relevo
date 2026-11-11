# Configuración

## Lo que instala `relevo init`

`init` es idempotente. Nunca sobrescribe `relevo.config.json` ni `.agents/skills.json`; `--force` sobrescribe las plantillas modificadas y `--dry-run` muestra lo que haría.

| Destino | Contenido |
|---|---|
| `relevo.config.json` | Configuración del proyecto (ver abajo). |
| `.claude/skills/` | Skills `delegar-agy`, `verificar-cambio`, `definicion-de-hecho`, `e2e-headless`, `auditar-capturas`. |
| `.agents/plugins/relevo/` | Agentes `qa` y `documentalista` y `plugin.json`. |
| `.agents/hooks/permission-gate.cjs`, `.agents/hooks.json` | Puerta de permisos (hook `PreToolUse` de agy). |
| `.agents/skills.json` | Registro de las skills para agy. |
| `.agents/relevo.lock.json` | Hash de cada plantilla instalada; es la base de `relevo update`. |
| `.gitignore` | `artifacts/agent-runs/`, `.worktrees/`, `.agents/hooks/gate.log`, `.qa-verdict.json`, `*.qa-bak`, `*.relevo-new`. |

Después de instalar:

1. Completa los marcadores `<<PROYECTO: …>>` de las plantillas con los comandos y suites del proyecto. `relevo doctor` avisa de los que queden.
2. Aplica la configuración global de agy a partir de [agy-settings.example.json](../templates/agy-settings.example.json) ([explicación](../templates/agy-settings.example.md)). La aplica el usuario: Claude Code no edita archivos fuera del repositorio.

## `relevo.config.json`

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
| `gate.roleScopes` | Expresiones regulares de rutas editables por rol. Se combina por rol con los valores por defecto: un rol que defines sustituye solo la lista de ese rol; `null` quita la restricción de ese rol y `[]` no le permite editar nada. Un rol sin entrada (como `coder`) no tiene restricción | ver abajo |
| `check.baseBranch` | Rama base | `main` |
| `check.sourcePattern` | Código que exige pruebas | `^src/` |
| `check.testPattern` | Archivos que cuentan como pruebas | `^(scripts/test-[\w.-]+\.cjs\|test/[\w./-]+)$` |
| `check.roadmap` | Hoja de ruta que debe actualizarse | `null` |
| `check.decisions.dir` / `.index` | Carpeta de decisiones y archivo índice | `null` |
| `check.verdictFile` | Veredicto de QA | `.qa-verdict.json` |
| `check.hardcodedColorFiles` | Archivos de interfaz sin colores fijos | `null` |
| `check.areaSuites` | `[{ "pattern": "...", "suites": ["..."] }]` | `[]` |

Una clave desconocida o un valor de tipo incorrecto es un error. La clave `__proto__`, en cualquier nivel, también: al combinarla con los valores por defecto cambiaría el prototipo del objeto en lugar de crear la clave. Si `relevo.config.json` no es válido, la puerta de permisos deniega todo.

### Ámbito de edición por rol (`gate.roleScopes`)

| Rol | Puede editar por defecto |
|---|---|
| `coder` | Sin restricción de rutas. |
| `docs` | `docs/`, `AGENTS.md`, `CONTRIBUTING.md`, `README.md`. |
| `qa` | `.qa-verdict.json`, `artifacts/`, `*.qa-bak` y, para las mutaciones temporales, `src/`, `scripts/` y `test/`. |
| `review` | `artifacts/` y `.qa-verdict.json`. |
| `vision`, `research` | `artifacts/`. |

Para ampliar el ámbito de un rol, define solo ese rol; los demás conservan sus valores por defecto. Por ejemplo, `{"gate":{"roleScopes":{"qa":["^\\.qa-verdict\\.json$","^artifacts/","\\.qa-bak$","^lib/","^test/"]}}}` cambia solo `qa`. La lista sustituye a la de ese rol (no se suma), así que repite las rutas por defecto que quieras mantener. `{"qa": null}` deja a `qa` sin restricción.

### Ejemplo

La configuración del propio relevo:

```json
{
  "check": {
    "sourcePattern": "^(lib|bin)/",
    "testPattern": "^test/[\\w./-]+$",
    "decisions": { "dir": "docs/decisions", "index": "README.md" }
  }
}
```
