# Decisión 01: Origen y alcance de relevo (2026-11-10)

## Contexto y origen

`relevo` surge el 2026-11-10 como una extracción independiente de la arquitectura de agentes desarrollada en el proyecto "Procedural // Studio" (GeneradorMusica).

En dicho proyecto se demostró empíricamente que un modelo de razonamiento superior (Claude Code) combinado con agentes de ejecución rápida y bajo coste (como Antigravity CLI `agy` con modelos Google Gemini Flash High) permite un ciclo de desarrollo ágil y seguro, siempre que se cumplan dos principios irrenunciables:
1. **Separación estricta de responsabilidades**: Claude planifica, redacta especificaciones exactas, audita de forma independiente y realiza los commits; los agentes externos ejecutan código, pruebas, investigación y QA dentro de un carril acotado.
2. **Verificación independiente y mecánica**: quien escribe el código no emite el veredicto de calidad; nada se integra sin pruebas, mutaciones obligatorias de protecciones y control formal de la definición de hecho.

## Qué se generalizó

El núcleo de este flujo fue extraído y formalizado en `relevo` como un kit reutilizable para cualquier proyecto:
- **Orquestación y CLI**: comandos `relevo run`, `relevo watch`, `relevo quota`, `relevo check` e `relevo init` (o sus alias `npm run agent:run`, `agents`, `agents:quota`, `check:change`).
- **Aislamiento en worktrees**: cada tarea de código se ejecuta en un directorio `.worktrees/<tarea>` con ramas temporales dedicadas y dependencias enlazadas (`node_modules`), manteniendo limpio el árbol principal.
- **Puerta de permisos (`permission-gate`)**: hook que intercepta llamadas a herramientas (`PreToolUse`) para denegar operaciones destructivas, accesos de red, navegadores visibles y comandos de git que alteren la historia o el índice, restringiendo además las rutas modificables por rol (`coder`, `qa`, `docs`, `research`, `vision`, `review`).
- **Protocolo de delegación para modelos Flash**: 8 reglas obligatorias para formular encargos a modelos rápidos sin dejar margen a ambigüedades o suposiciones en tareas delicadas.
- **Roles especializados**:
  - `documentalista`: actualiza la hoja de ruta, las decisiones de arquitectura y el índice documental sobre el diff real antes de QA.
  - `qa`: agente independiente que ejecuta las pruebas del área en navegadores aislados headless, verifica tautologías, audita capturas y realiza pruebas de mutación obligatorias (sobre copias en `artifacts/qa-mutantes/`), emitiendo `.qa-verdict.json` sin tocar código.
- **Control mecánico de la definición de hecho (`relevo check`)**: validación automática del veredicto de QA atado al commit actual, rechazo de veredictos con hallazgos altos, exigencia de pruebas unitarias al tocar código y verificación de documentación y ausencia de colores fijos en UI.
- **Plantillas de skills y agentes**: plantillas de skills (`delegar-agy`, `auditar-capturas`, `e2e-headless`, `definicion-de-hecho`, `verificar-cambio`) y agentes (`qa`, `documentalista`) preparadas para instalarse en cualquier proyecto mediante marcadores estándar `<<PROYECTO: …>>`.

## Qué NO se generalizó (desacoplado a configuración)

Todo elemento propio del dominio del proyecto original fue desacoplado y delegado a la configuración del proyecto receptor (`relevo.config.json`):
- **Suites de prueba específicas**: suites de audio DSP, síntesis, Lo-fi, exportación H.264 o lienzos de visualización musical. Cada proyecto define sus suites y patrones en `check.areaSuites`.
- **Estructura y componentes de UI**: selectores de Svelte, archivos `App.svelte`, tokens de color y viewports específicos (1440×1000, 390×844). Se sustituyen por marcadores genéricos de viewport y listas configurables en `check.hardcodedColorFiles`.
- **Documentación interna**: rutas específicas como `docs/publishing-roadmap.md` o planes de hitos M1–M6. Se parametrizan a través de `check.roadmap` y `check.decisions`.
- **Comandos de servidor de desarrollo**: puertos y flags particulares se sustituyen por marcadores configurables por proyecto.

## Decisión de nombre: «relevo»

El nombre **relevo** hace referencia a la carrera de atletismo por relevos:
- Un corredor (Claude Code) arranca el tramo: analiza el problema, define la estrategia, prepara el carril (worktree) y entrega el testigo en forma de encargo milimétrico.
- El siguiente corredor (un agente especialista como `agy` en rol `coder`, `research`, `docs` o `qa`) toma el testigo y realiza su sprint a máxima velocidad y dentro de su carril delimitado por la puerta de permisos.
- El testigo vuelve a Claude, quien verifica la carrera (auditoría independiente), asegura que no se hayan infringido las reglas de la pista (definición de hecho y mutaciones) y formaliza la llegada a meta (commit e integración en la rama principal).
- Nadie corre a ciegas y nadie compite sin juez independiente: el trabajo fluye por relevos coordinados.
