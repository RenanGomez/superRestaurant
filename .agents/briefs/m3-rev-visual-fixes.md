# Brief m3-rev-visual-fixes (revisión C · auditor visual)

Diff: main...harness/m3-visual-fixes

Revisa el PR #124. **No escribas archivos ni uses `$env:TEMP`**. No ejecutes Playwright.

Comprueba que el cambio **mide** el área real y no **relaja** el gate:

1. `insetsFromPseudo` solo acepta pseudo-elementos con contenido, `position: absolute` y
   `pointer-events` distinto de `none`; valores no px (`auto`, `calc`) caen al shorthand; no inventa
   expansión con insets positivos.
2. `effectiveTargetSize` nunca baja de 0 y no expande más allá de lo declarado; `findViolations` usa
   ese tamaño para `target-size` y sigue midiendo `width/height` del control para lo demás.
3. `assert-ui.ts`: lee `::before` y `::after` del propio control (no de ancestros), en el mismo
   `evaluate`; no altera capturas ni el resto de reglas.
4. Tests: los casos nuevos demuestran el falso positivo y que un 20×20 sin expansión **sí** falla.
5. Riesgo residual: ¿qué controles podrían ahora pasar con un hit area falso (p. ej. pseudo decorativo
   que no recibe pointer events por `pointer-events` heredado)? Anótalo como P3 si es real.

Entrega `VEREDICTO: APROBAR|CORREGIR` con P1/P2/P3, archivo y línea.
