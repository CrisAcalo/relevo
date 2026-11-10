---
name: e2e-headless
description: Run this repo's browser end-to-end tests in an isolated headless Chrome with zero console incidents. Use for any UI, audio, video or visual verification that needs a real browser.
---

# E2E en navegador aislado

Regla vinculante (AGENTS.md §1): nunca abrir ventanas visibles ni usar el Chrome personal del usuario. Nada de herramientas de navegador del agente; solo los scripts del repo.

## Pasos

1. Servidor dev como tarea en segundo plano:
   ```bash
   npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
   ```
   Detectar que está listo por la línea `Local: http://127.0.0.1:5173/` de su salida. `curl` e `Invoke-WebRequest` están denegados por la política del repo.
2. Ejecutar la suite del área (ver skill `verificar-cambio`) o todo: `npm run test:e2e`.
   - `CHROME_PATH` indica el ejecutable de Chrome; `STUDIO_URL` otro servidor.
3. Detener solo la tarea del servidor que se arrancó (en agy: cancelar esa tarea de fondo) y confirmar que el puerto 5173 quedó libre.
4. Reportar desde el JSON de la suite en `artifacts/verification/<suite>/`: `passed`, `checks`, `consoleErrors`, `consoleWarnings`, `pageErrors`.

Validado con agy (Flash High): `test:playback` 9/9, cero incidencias, servidor detenido, ~3 min.

## Escribir o modificar pruebas

- Usar `scripts/lib/browser.cjs`: impone `headless: 'new'`, pipe y perfil exclusivo bajo `artifacts/.cache/isolated-browsers/`.
- Navegar con `scripts/lib/navigation.cjs` (clics, selecciones y filechooser reales). No revelar paneles ocultos por CSS/JS.
- Con controles sticky/fixed usar `clickVisibleControl`; nunca ocultar la navegación o el transporte para que pase una prueba.
- Capturar `console.error`, `console.warn` y `pageerror`; la prueba falla con cualquiera.
- Evidencias (capturas, reportes) solo en `artifacts/verification/<suite>/`.
