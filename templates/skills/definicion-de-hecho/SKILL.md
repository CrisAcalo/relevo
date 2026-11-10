---
name: definicion-de-hecho
description: The Definition of Done for any change in this repo (code, tests, verification, QA verdict and documentation). Use before declaring a task finished, when reviewing a branch, and when writing or updating project documentation after a change.
---

# Definición de hecho

Una tarea no está hecha hasta cumplir todo lo que le aplique. `npm run check:change` comprueba mecánicamente los puntos marcados con ⚙.

## 1. Código y pruebas
- ⚙ Si cambia `src/`, hay pruebas nuevas o actualizadas en `scripts/test-*.cjs` que fallarían sin el cambio. Una prueba que no puede fallar no cuenta (p. ej. `__proto__` en un literal JS no crea una clave propia).
- Determinismo, invariantes y decisiones del área respetados (`docs/decisions/` según el índice de AGENTS.md).
- ⚙ Sin colores fijos nuevos en componentes o `App.svelte`: colores desde tokens del tema (`var(--…)`), con contraste ≥ 4,5:1 medido en cada tema. Los cálculos de contraste se hacen, no se estiman.
- Sin `eval`, `new Function`, `{@html}`, `innerHTML` con datos variables, `Math.random` en renderer/compositor ni claves en el cliente.

## 2. Verificación
- ⚙ `npm run verify` en verde.
- E2E del área (mapa en la skill `verificar-cambio`; `npm run check:change` las lista) en verde, con cero `console.error`, `console.warn` y `pageerror`, navegador headless propio. Además, según lo que toque el cambio:
  - **Orquestación o estado del proyecto** (`src/App.svelte`, `src/project/ProjectState.ts`, autosave, restaurar/importar, navegación): `node scripts/test-studio-e2e.cjs` y `node scripts/test-composition-state-e2e.cjs`.
  - **Interfaz nueva o modificada**: capturas de la sección afectada en escritorio 1440×1000 y móvil 390×844, auditadas con la skill `auditar-capturas`; si `test:design` no cubre la sección nueva, la E2E de la tarea guarda esas capturas.
  - **Motor visual o de audio** (`src/visualizer/`, `src/audio/` de síntesis, mezcla o render, `VisualizerCanvas`): la matriz de AGENTS.md §1 (cinco modos, 16:9 y 9:16, Brutal, Slowed+Reverb, neón y reproducción de audio) mediante las suites del mapa.
  - **Cierre de una etapa** (A, B, C) o antes de publicar con la app: `npm run test:e2e` completo y `npm run test:production` sobre el build, registrados en la hoja de ruta.
- ⚙ Veredicto del agente `qa-estudio` en `.qa-verdict.json` para el commit actual con `"verdict": "aprobado"`. Quien escribió el código no emite el veredicto.
- Las protecciones nuevas o críticas superan una prueba de mutación: romperlas a propósito hace fallar la prueba que las cubre.

## 3. Documentación
- ⚙ `docs/publishing-roadmap.md`: estado de la tarea y entrada fechada en "Registro" con qué se hizo, cómo se verificó y qué límites quedan.
- ⚙ Decisión o contrato nuevo: archivo `docs/decisions/NN-*.md` y fila en el índice de AGENTS.md (AGENTS.md < 20.000 bytes).
- Entrega M1–M6: entrada en "Registro de avance" de `docs/studio-evolution-plan.md`.
- Comandos o suites nuevos: `CONTRIBUTING.md` y, si cambia el mapa por área, la skill `verificar-cambio`.
- Pendientes y límites honestos: lo no verificado se escribe como no verificado. No afirmar calidad comercial, aceptación de plataformas ni certificaciones.

## 4. Orden e integración
- En la rama: código → documentación (`documentalista`) → commit → veredicto de `qa-estudio` sobre ese commit → auditoría de Claude → `npm run check:change` → integración.
- Commit solo por Claude tras auditar; nunca `git push` sin petición del autor.
- Worktree y rama temporales eliminados después de integrar.
