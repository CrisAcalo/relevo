# Configuración global de agy (Capa 1 de permisos)

Este directorio contiene la plantilla `agy-settings.example.json` para configurar `~/.gemini/antigravity-cli/settings.json`.

## Las dos capas de seguridad de relevo

El modelo de seguridad de relevo se basa en dos capas complementarias:

1. **Capa 1 — Configuración global del CLI (`~/.gemini/antigravity-cli/settings.json`):**
   Define la política base del motor de Antigravity CLI (`agy`) en la máquina del usuario. Controla a nivel de proceso qué comandos pueden proceder de forma automática (`allow`) y cuáles están terminantemente prohibidos (`deny`), independientemente del repositorio o worktree en el que se opere.
2. **Capa 2 — Puerta de permisos del repositorio (`.agents/hooks/permission-gate.cjs`):**
   Hook `PreToolUse` autocontenido en el repositorio. Aplica reglas contextuales finas: ámbito de edición según el rol asignado (`AGY_ROLE`: `coder`, `qa`, `docs`, `vision`, etc.), protección de archivos sensibles (`.env`), verificación de pertenencia al worktree y listas de scripts de verificación permitidos.

## Aplicación manual por el usuario

Esta configuración debe ser aplicada **directamente por el usuario** en su archivo de configuración global:
- En Windows: `%USERPROFILE%\.gemini\antigravity-cli\settings.json`
- En Linux / macOS: `~/.gemini/antigravity-cli/settings.json`

> **Incidente I-02:** Claude Code bloquea de forma deliberada tanto la edición de archivos de configuración fuera del repositorio como el uso de parámetros que desactiven el sandbox o los permisos (`--dangerously-skip-permissions`). Por diseño de seguridad, Claude no puede aplicar esta configuración por ti.

## Por qué `toolPermission: "always-proceed"`

Al ejecutar agentes en segundo plano mediante `relevo run` (usando `agy -p`), no hay un operador humano frente a la terminal de agy para aprobar comandos uno a uno.

> **Incidente I-01:** Con `toolPermission: "request-review"`, agy deniega automáticamente cualquier herramienta o comando que requiera confirmación, interrumpiendo la ejecución. `toolPermission: "always-proceed"` permite que los agentes avancen de forma desatendida sin solicitar aprobaciones interactivas constantes.

## Qué ocurre con las decisiones `ask` bajo `always-proceed`

Como se detalla en `docs/por-que-cada-regla.md`:

- La puerta de permisos del repositorio clasifica las intenciones en `allow`, `deny` o `ask`.
- **Bajo `toolPermission: "always-proceed"`, lo que la puerta devuelve como `ask` se ejecuta en agy.**
- Por ejemplo, el comando `Copy-Item` requerido por el procedimiento de mutación del agente de QA no está en la lista fija de `allow`; la puerta responde `ask` y agy lo ejecuta.
- **Consecuencia de diseño:** Todo comando potencialmente destructivo o peligroso (`git push`, `git commit`, `git reset`, `npm install`, `npx`, `curl`, borrados recursivos, etc.) **debe ser `deny`**, nunca `ask`. Tanto la capa 1 (este archivo) como la capa 2 (la puerta) aseguran que lo prohibido sea bloqueado de inmediato. Todas las acciones evaluadas quedan registradas en `.agents/hooks/gate.log` para la auditoría de Claude.
