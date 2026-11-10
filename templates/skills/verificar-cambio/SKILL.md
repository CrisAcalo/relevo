---
name: verificar-cambio
description: Choose and run the right verification suites for a change in this repo. Use before declaring any code change done or before auditing a delegated change.
---

> Plantilla de relevo: rellena los marcadores <<PROYECTO: …>> al instalarla.

# Verificar un cambio

Fuente completa: `<<PROYECTO: guía de contribución / comandos, ej. CONTRIBUTING.md>>` y el archivo del área en `<<PROYECTO: directorio de decisiones, ej. docs/decisions/>>`. Aquí el mapa rápido configurado para el proyecto.

## Siempre

```bash
<<PROYECTO: comando de verificación general, ej. npm run verify>>
```
Higiene del repositorio, tipos, unitarias y build. Debe terminar sin errores.

## Según el área tocada (además de la verificación general)

Configurado en `check.areaSuites` de `relevo.config.json`. Mapa de referencia:

| Área | Rutas afectadas | Comandos |
|---|---|---|
| <<PROYECTO: Área 1 (ejemplo: Núcleo y lógica)>> | <<PROYECTO: src/core/**>> | <<PROYECTO: npm run test:unit>> |
| <<PROYECTO: Área 2 (ejemplo: Interfaz / UI)>> | <<PROYECTO: src/ui/**>> | <<PROYECTO: npm run test:ui, npm run test:e2e>> |
| <<PROYECTO: Área 3 (ejemplo: Persistencia / API)>> | <<PROYECTO: src/storage/**>> | <<PROYECTO: npm run test:storage>> |
| Puerta de permisos de relevo | lib/permission-gate.cjs, test/permission-gate.test.cjs | npm.cmd test (o npm test) |

Los E2E requieren el servidor de desarrollo (ver skill `e2e-headless`).

## Criterios

- Cero `console.error`, `console.warn` y `pageerror` en pruebas E2E.
- No debilitar asserts, añadir tolerancias artificiales ni saltar pruebas para obtener verde.
- Cambios visuales: capturas en los viewports definidos (`<<PROYECTO: viewports de escritorio y móvil>>`), desplazando el elemento a la vista (`scrollIntoView`) y con aserción explícita de visibilidad.
- Contraste calculado, nunca estimado: tokens del tema y medición computada en pruebas automáticas.
- Reportar exactamente qué se ejecutó, qué pasó y qué no se pudo cubrir.
