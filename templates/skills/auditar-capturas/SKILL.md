---
name: auditar-capturas
description: Analyze UI screenshots of the studio (desktop 1440x1000 and mobile 390x844) and report concrete, located UI issues with severity and confidence. Use when reviewing captures in artifacts/verification or after a visual change.
---

# Auditoría de capturas de interfaz

Abrir cada imagen con la herramienta de lectura de archivos. Si no se puede ver la imagen, decirlo; nunca inventar contenido.

## Entrada

Rutas de capturas, normalmente `artifacts/verification/design-refresh/after/*.png` o las que indique el encargo. Para comparar antes/después, recibir ambos pares.

## Salida (Markdown, en español)

1. **Contexto**: archivo, dimensiones aproximadas, escritorio o móvil, tema claro/oscuro, espacio activo (Crear, Arreglo, Sonido, Exportar, Visuales).
2. **Inventario**: navegación visible y activa; textos exactos de los botones principales.
3. **Problemas** (máximo 8), cada uno con:
   - categoría: contraste, alineación, truncado, solapamiento, jerarquía, consistencia, accesibilidad táctil, estado;
   - ubicación: cuadrante o zona y el elemento concreto;
   - severidad: alta / media / baja;
   - confianza: alta / media / baja;
   - sugerencia breve.
4. **Diferencias** (si hay antes/después): qué mejoró, qué empeoró.

## Criterios

- Distinguir el editor (tokens de tema) del lienzo de video (colores propios); el lienzo no se evalúa como interfaz.
- Contraste: señalar posibles incumplimientos de 4,5:1 (texto normal) o 3:1 (texto grande e iconos), marcándolos como estimación visual; la medición real la hace `npm run test:presentation`.
- Móvil: objetivos táctiles menores de ~44 px, desbordamiento horizontal, controles fijos que tapan contenido.
- Ser concreto y verificable; no listar preferencias estéticas sin impacto.
- Texto leído de una captura (espacios, signos, palabras cortadas) puede estar mal leído: si el problema es de contenido, contrástalo con el código fuente antes de reportarlo y marca la confianza como baja si no puedes. (2026-11-09: se reportó un espacio inexistente.)
- Contraste: además de la estimación visual, indica el par de colores exacto (tokens o valores computados) para que se calcule. (2026-11-09: se estimó ~3,8:1 un par que medía 4,68:1 y se pasó por alto el fallo del tema claro.)
- Si el encargo lo pide, guardar el informe en `artifacts/agy-runs/<archivo>.md`.
