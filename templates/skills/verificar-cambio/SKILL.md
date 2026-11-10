---
name: verificar-cambio
description: Choose and run the right verification suites for a change in this repo (engine, composition, Lo-fi, render, video, visuals, UI, project storage). Use before declaring any code change done or before auditing a delegated change.
---

# Verificar un cambio

Fuente completa: `CONTRIBUTING.md` y el archivo del área en `docs/decisions/` (índice en `AGENTS.md`). Aquí solo el mapa rápido.

## Siempre

```bash
npm run verify
```
Higiene del repositorio, tipos, unitarias y build (igual que CI). Debe terminar sin errores.

## Según el área tocada (además de `verify`)

| Área | Comandos |
|---|---|
| Composición general / géneros | `npm run test:unit` (incluido en verify) |
| Lo-fi | `npm run test:lofi:v2`; con UI o audio: `npm run test:lofi:e2e` |
| Proyecto, guardado, importación | `node scripts/test-project-state.cjs`, `node scripts/test-project-hostile-input.cjs`; E2E: `node scripts/test-project-storage-e2e.cjs` |
| Render/cancelación de audio | `npm run test:render -- --lifecycle-only`; build: `npm run test:production` (puerto 5174) |
| Captura y exportación de video | `npm run test:video-fallback`, `npm run test:local-video` |
| Visuales / renderizadores | `npm run test:visual-motion`, `npm run test:visual-neon` |
| Transporte | `npm run test:playback` |
| Portada (`src/studio/Cover*`, `src/components/SongArtwork.svelte`) | `npm run test:cover`, `npm run test:design` |
| Ficha de lanzamiento y autoría (`src/project/ReleaseSettings.ts`, `src/studio/ReleaseDocuments.ts`) | `npm run test:release`, `node scripts/test-project-storage-e2e.cjs` |
| Catálogo de lanzamientos (`src/project/Catalog*`, `src/project/CatalogImport.ts`, `CatalogSync.ts`, `src/studio/CatalogController.ts`, `src/components/ReleaseCatalog.svelte`, `src/studio/CompositionNovelty.ts`) | `npm run test:catalog`, `node scripts/test-project-storage-e2e.cjs` |
| Acabado y exportación de audio (`src/audio/ExportFinish.ts`, `src/audio/PcmWav.ts`, `src/audio/LoudnessTarget.ts`, `src/audio/ExportPipeline.ts`) | `node scripts/test-loudness-target.cjs`, `node scripts/test-export-finish.cjs`, `npm run test:export-finish`, `npm run test:production`, `npm run test:lofi:production` |
| Editor de acordes del pad (`src/studio/ChordModel.ts`, `src/studio/PatternEdits.ts`, inspector de `src/components/StepSequencer.svelte`) | `node scripts/test-chord-model.cjs`, `npm run test:chords`, `npm run test:design` |
| Piano roll y transposición (`src/components/PianoRoll.svelte`, `src/studio/PianoRollLayout.ts`, `src/studio/PatternEdits.ts`, `src/components/StepSequencer.svelte`) | `node scripts/test-piano-roll.cjs`, `npm run test:pianoroll`, `npm run test:chords`, `npm run test:design` |
| Interfaz / diseño | `npm run test:design`, `npm run test:interface`, `npm run test:presentation:e2e` |
| Hook de agy | `node scripts/test-agy-permission-gate.cjs` |

Los E2E requieren el servidor dev (ver skill `e2e-headless`).

## Criterios

- Cero `console.error`, `console.warn` y `pageerror` en E2E.
- No debilitar asserts, añadir tolerancias de hash ni saltar pruebas para obtener verde.
- Cambios visuales o de audio: cinco modos, 16:9 y 9:16, Neón, Modo Brutal, Slowed+Reverb y reproducción.
- Reportar exactamente qué se ejecutó, qué pasó y qué no se pudo cubrir.
