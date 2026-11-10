---
name: definicion-de-hecho
description: The Definition of Done for any change in this repo (code, tests, verification, QA verdict and documentation). Use before declaring a task finished, when reviewing a branch, and when writing or updating project documentation after a change.
---

> Plantilla de relevo: rellena los marcadores <<PROYECTO: …>> al instalarla.

# Definición de hecho

Una tarea no está hecha hasta cumplir todo lo que le aplique. `relevo check` (o `npm run check:change`) comprueba mecánicamente los puntos marcados con ⚙.

## 1. Código y pruebas
- ⚙ Si cambia el código fuente (`<<PROYECTO: patrón de código fuente, ej. src/**>>`), hay pruebas nuevas o actualizadas en `<<PROYECTO: patrón de pruebas, ej. test/** o scripts/test-*.cjs>>` que fallarían sin el cambio. Una prueba que no puede fallar no cuenta.
- Determinismo, invariantes y decisiones del área respetados (`<<PROYECTO: directorio de decisiones, ej. docs/decisions/>>` según el índice de `<<PROYECTO: índice de decisiones, ej. AGENTS.md o CLAUDE.md>>`).
- ⚙ Sin colores fijos nuevos en archivos de interfaz (`<<PROYECTO: archivos de interfaz con colores fijos prohibidos>>`): colores desde tokens del tema (`var(--…)`), con contraste ≥ 4,5:1 medido en cada tema. Los cálculos de contraste se hacen, no se estiman. Según la configuración (`check.hardcodedColorFiles`), `relevo check` exige la ausencia de colores fijos.
- Sin `eval`, `new Function`, APIs inseguras o ejecución dinámica sin auditar, ni secretos o claves en el repositorio.

## 2. Verificación
- ⚙ Verificación general en verde (`<<PROYECTO: comando de verificación general, ej. npm run verify>>`).
- E2E del área (`<<PROYECTO: suites E2E por área>>`; mapa en la skill `verificar-cambio`; sugeridas por `relevo check` según `check.areaSuites`) en verde, con cero `console.error`, `console.warn` y `pageerror`, en navegador headless aislado propio.
- Capturas desplazando el elemento a la vista (`scrollIntoView`) y con aserción explícita de visibilidad en `<<PROYECTO: viewports de escritorio y móvil>>`, auditadas con la skill `auditar-capturas`.
- ⚙ Veredicto del agente `qa` en `.qa-verdict.json` (o el configurado en `check.verdictFile`) para el commit actual con `"verdict": "aprobado"`. Quien escribió el código no emite el veredicto. `relevo check` exige el veredicto del commit actual y rechaza un veredicto aprobado con hallazgos de severidad alta.
- Las protecciones nuevas o críticas superan una prueba de mutación obligatoria: romperlas a propósito en el código hace fallar la prueba unitaria que las cubre (procedimiento seguro `.qa-bak`). Si una mutación de QA no hace fallar ninguna prueba, antes de añadir una prueba comprobar si el código protegido es necesario o es código muerto.

## 3. Documentación
- ⚙ `<<PROYECTO: documento de estado / hoja de ruta, ej. docs/roadmap.md>>` (exigido por `relevo check` según la configuración `check.roadmap`): estado de la tarea y entrada fechada en "Registro" con qué se hizo, cómo se verificó y qué límites quedan.
- ⚙ Decisión o contrato nuevo: archivo `<<PROYECTO: directorio de decisiones, ej. docs/decisions/NN-*.md>>` y fila en el índice de `<<PROYECTO: archivo de índice de decisiones, ej. AGENTS.md>>` (exigido por `relevo check` según la configuración `check.decisions`).
- Si el proyecto mantiene un plan de entregas: entrada en el registro de avance correspondiente (`<<PROYECTO: plan de entregas si aplica>>`).
- Comandos o suites nuevos: `<<PROYECTO: guía de contribución / comandos, ej. CONTRIBUTING.md>>` y, si cambia el mapa por área, la skill `verificar-cambio`.
- Pendientes y límites honestos: lo no verificado se escribe como no verificado. No afirmar calidad comercial, aceptación de plataformas ni certificaciones sin prueba.

## 4. Orden e integración
- En la rama: código → documentación (`documentalista`) → commit → veredicto de `qa` sobre ese commit → auditoría de Claude → `relevo check` (o `npm run check:change`) → integración fast-forward → commit de cierre de documentación en la rama principal (el veredicto está atado al commit, por eso el cierre va después).
- Commit solo por Claude tras auditar; nunca `git push` sin petición del autor.
- Worktree y rama temporales eliminados después de integrar.
