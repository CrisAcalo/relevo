---
name: auditar-capturas
description: Analyze UI screenshots (desktop and mobile viewports) and report concrete, located UI issues with severity and confidence. Use when reviewing captures in artifacts/verification or after a visual change.
---

> Plantilla de relevo: rellena los marcadores <<PROYECTO: …>> al instalarla.

# Auditoría de capturas de interfaz

Abrir cada imagen con la herramienta de lectura de archivos. Si no se puede ver la imagen, decirlo; nunca inventar contenido. Las capturas de origen deben haberse tomado desplazando el elemento a la vista (`scrollIntoView`) y con aserción explícita de visibilidad.

## Entrada

Rutas de capturas, normalmente `artifacts/verification/<suite>/after/*.png` o las que indique el encargo. Para comparar antes/después, recibir ambos pares.

## Salida (Markdown, en español)

1. **Contexto**: archivo, dimensiones aproximadas, escritorio o móvil (`<<PROYECTO: viewports de escritorio y móvil (ejemplo: escritorio 1440×1000 y móvil 390×844)>>`), tema claro/oscuro, vista o sección activa (`<<PROYECTO: vistas o secciones de la aplicación>>`).
2. **Inventario**: navegación visible y activa; textos exactos de los controles y botones principales.
3. **Problemas** (máximo 8), cada uno con:
   - categoría: contraste, alineación, truncado, solapamiento, jerarquía, consistencia, accesibilidad táctil, estado;
   - ubicación: cuadrante o zona y el elemento concreto;
   - severidad: alta / media / baja;
   - confianza: alta / media / baja;
   - sugerencia breve.
4. **Diferencias** (si hay antes/después): qué mejoró, qué empeoró.
5. **Revisión de segunda vuelta tras corrección**: si esta auditoría evalúa una corrección visual previa, indicar punto por punto si cada hallazgo anterior está resuelto o persiste.

## Criterios

- Distinguir los elementos de la interfaz de usuario (que deben usar tokens de tema) de áreas de contenido especial con colores propios (`<<PROYECTO: áreas especiales o lienzos con color propio si aplica>>`).
- Contraste: señalar posibles incumplimientos de 4,5:1 (texto normal) o 3:1 (texto grande e iconos). El contraste se calcula, nunca se estima; la auditoría visual señala el par de colores exacto (tokens o valores computados) para que se calcule y valide mediante pruebas automáticas (`<<PROYECTO: suite de contraste o presentación>>`).
- Móvil: objetivos táctiles menores de ~44 px, desbordamiento horizontal, controles fijos que tapan contenido.
- Ser concreto y verificable; no listar preferencias estéticas sin impacto.
- Texto leído de una captura (espacios, signos, palabras cortadas) puede estar mal leído: si el problema es de contenido, contrástalo con el código fuente antes de reportarlo y marca la confianza como baja si no puedes. (Hecho verificado: se reportó un espacio inexistente.)
- Contraste: además de la estimación visual, indica el par de colores exacto (tokens o valores computados) para que se calcule. (Hecho verificado: se estimó ~3,8:1 un par que medía 4,68:1 y se pasó por alto el fallo del tema claro.)
- Tras cada corrección de interfaz, una segunda revisión visual de las capturas nuevas (rol vision) debe confirmar, punto por punto, si cada hallazgo anterior quedó resuelto.
- Si el encargo lo pide, guardar el informe en `artifacts/agent-runs/<NN>-<tarea>/<archivo>.md` (o la ruta configurada en `runsDir`).
