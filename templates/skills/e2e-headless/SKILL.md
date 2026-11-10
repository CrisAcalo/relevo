---
name: e2e-headless
description: Run this repo's browser end-to-end tests in an isolated headless Chrome with zero console incidents. Use for any UI, interaction or visual verification that needs a real browser.
---

> Plantilla de relevo: rellena los marcadores <<PROYECTO: …>> al instalarla.

# E2E en navegador aislado

Regla vinculante: nunca abrir ventanas visibles ni usar el navegador personal del usuario. Nada de herramientas de navegador propias del agente; utilizar exclusivamente las herramientas y scripts headless del repositorio.

## Pasos

1. Servidor de desarrollo:
   - **Servidor compartido**: si el encargo indica que el servidor ya corre, el agente no arranca otro.
   - Si no está corriendo, arrancarlo como tarea en segundo plano:
     ```bash
     <<PROYECTO: comando de servidor de desarrollo, ej. npm run dev -- --host 127.0.0.1 --port 5173 --strictPort>>
     ```
     Detectar que está listo por la línea que indica la URL en su salida (ej. `Local: http://127.0.0.1:5173/`). Comandos de red directos como `curl` o `Invoke-WebRequest` están denegados por la política del repositorio.
2. Ejecutar la suite del área (ver skill `verificar-cambio`) o la suite completa:
   ```bash
   <<PROYECTO: comando de prueba E2E, ej. npm run test:e2e>>
   ```
   Variables opcionales del entorno del proyecto: `CHROME_PATH` indica el ejecutable de Chrome; `<<PROYECTO: variable de URL base, ej. APP_URL>>` indica otro servidor.
3. Si el agente arrancó el servidor en el paso 1, detener solo esa tarea de fondo y confirmar que el puerto quedó libre.
4. Reportar desde el informe/JSON de la suite en `artifacts/verification/<suite>/`: `passed`, `checks`, `consoleErrors`, `consoleWarnings`, `pageErrors`.

## Escribir o modificar pruebas

- Usar la utilidad de navegador del proyecto (`<<PROYECTO: biblioteca de navegador headless, ej. scripts/lib/browser.cjs>>`): debe imponer `headless: 'new'`, canal pipe y perfil exclusivo bajo `artifacts/.cache/isolated-browsers/`.
- Navegar con interacciones reales (clics, selecciones y subida de archivos reales). No forzar visualización revelando paneles ocultos por CSS/JS.
- Con controles sticky/fixed o elementos bajo scroll: capturas desplazando el elemento a la vista (`scrollIntoView`) y con aserción explícita de visibilidad; nunca ocultar la navegación principal para que pase una prueba.
- Capturar obligatoriamente `console.error`, `console.warn` y errores no capturados de página (`pageerror`); la prueba falla con cualquiera.
- Evidencias (capturas, reportes) guardadas exclusivamente en `artifacts/verification/<suite>/`.
