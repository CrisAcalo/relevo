# Comandos de relevo

`node <ruta-a-relevo>/bin/relevo.cjs <comando>` (o `relevo <comando>` con `npm link`). Se ejecutan desde la raíz del repositorio del proyecto; desde un worktree, relevo calcula la raíz principal.

| Comando | Qué hace | Escribe |
|---|---|---|
| `init [--dry-run] [--force]` | Instala en el proyecto la puerta de permisos, `hooks.json`, skills, agentes, `.agents/skills.json`, `relevo.config.json`, el registro `.agents/relevo.lock.json` y las líneas de `.gitignore`. Idempotente; nunca sobrescribe `relevo.config.json` ni `.agents/skills.json`. | Sí |
| `doctor [--json]` | Comprueba el entorno y la instalación (ver abajo). Código 1 si hay algún error. | No |
| `task new <nombre> [--from <ref>]` | Crea `<worktreesDir>/<nombre>`, la rama `<taskBranchPrefix><nombre>` y enlaza `node_modules` (junction en Windows, symlink en el resto). | Sí |
| `task done <nombre> [--force]` | Cierra la tarea: exige rama integrada en `check.baseBranch` y worktree sin cambios (salvo `--force`); borra primero el enlace de `node_modules` sin recursión, luego el worktree y la rama. | Sí |
| `task list` | Tareas abiertas con su rama, si está integrada y si tiene cambios. | No |
| `run …` | Lanza un agente (ver skill `delegar-agy`). | Registros en `runsDir` |
| `watch [--once \| --list \| <NN>]` | Panel en vivo de los agentes. | No |
| `quota [--json]` | Cupos del proveedor (agy). | Caché en `runsDir` |
| `check [--docs-only] [--base <ref>]` | Definición de hecho mecánica sobre la rama actual. | No |
| `update [--apply] [--force]` | Actualiza lo instalado sin pisar lo personalizado (ver abajo). Sin `--apply` solo muestra el plan. | Solo con `--apply` |

## `doctor`

Comprobaciones, en orden: versión de Node (≥ 22.12), git y repositorio, `agy --version` (aviso si falta: relevo funciona con otro proveedor), configuración global de agy (`RELEVO_AGY_SETTINGS` o `~/.gemini/antigravity-cli/settings.json`: aviso si falta o si `toolPermission` no es `always-proceed`; solo lee `toolPermission` y `permissions.deny` y nunca imprime otras claves, porque `trustedWorkspaces` contiene rutas personales), reglas `deny` mínimas (`git push`, `git commit`, `npm publish`, `npm install`, `npx`, `curl`), `relevo.config.json` válido, puerta instalada e idéntica a la de relevo, `hooks.json`, `.gitignore` (preguntando a git con `git check-ignore`, así una regla más amplia como `artifacts/` cuenta) y marcadores `<<PROYECTO: …>>` sin rellenar.

La primera capa de permisos (configuración global de agy) la aplica el usuario: plantilla en [templates/agy-settings.example.json](../templates/agy-settings.example.json) y explicación en [templates/agy-settings.example.md](../templates/agy-settings.example.md).

## `update`: fusión a tres bandas

Para cada archivo gestionado compara la **plantilla actual**, el **archivo instalado** y la **base**: el hash guardado en `.agents/relevo.lock.json`, que es la plantilla instalada u ofrecida por última vez.

| Situación | Estado | Con `--apply` |
|---|---|---|
| No instalado | nuevo | Se crea |
| Instalado igual a la plantilla | al día | Se alinea la base si hacía falta |
| Instalado igual a la base (el usuario no lo tocó) | actualizable | Se sobrescribe y se actualiza la base |
| Personalizado y plantilla igual a la base | personalizado, sin novedades | Nada |
| Personalizado y plantilla nueva | personalizado | Se escribe `<archivo>.relevo-new` al lado y la base pasa a la plantilla ofrecida (no se vuelve a ofrecer) |
| Sin entrada en el registro | personalizado | Como el caso anterior (prudencia) |
| Puerta de permisos distinta de la plantilla | error (código 1) | Solo `--apply --force` la sobrescribe: la puerta no se personaliza, se configura en `relevo.config.json` |

## `.qa-verdict.json`

`relevo check` valida el veredicto con un esquema estricto (`lib/verdict.cjs`): claves exactas (`version`, `commit`, `branch`, `verdict`, `checkedAt`, `suites`, `findings`, `testReview`, `documentation`), `commit` de 40 hexadecimales en minúscula, `verdict` `aprobado` o `rechazado`, suites con `name` y `passed` booleano, hallazgos con `severity` exactamente `alta`, `media` o `baja`. Un veredicto que no cumple el formato es un fallo, no se interpreta. Formato completo y ejemplo en la plantilla del agente [qa](../templates/agents/qa.md).
