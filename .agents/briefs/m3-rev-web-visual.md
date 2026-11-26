# Revisión · test/web-inventario-visual (nivel C)

No leas `.agents/reports/*`, no salgas del repo y no ejecutes nada. Responde en ≤ 10 líneas.

Diff: main...test/web-inventario-visual

Comprueba:
1. La spec no afirma nada que el arnés no compruebe: usa `assertVisualUi`, espera la pestaña seleccionada y no marca como verificado lo que depende de datos del entorno.
2. `setVisualCaptureDir` no rompe el comportamiento por defecto de `assertVisualUi` (sigue escribiendo en `docs/agentic/visual-m2` si nadie lo llama) ni la spec offline existente.
3. El gate `E2E_VISUAL` está puesto igual que en la spec existente, y las rutas/viewports son coherentes con el resto de `e2e/visual`.
4. No hay selectores frágiles por texto que puedan coincidir con varios elementos (el `getByRole("tab")` es exacto respecto de las etiquetas de `INVENTORY_TAB_LABELS`).

Salida: `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR` y hallazgos con `archivo:línea`. Marca P1/P2/P3.
