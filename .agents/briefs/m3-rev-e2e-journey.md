# Brief m3-rev-e2e-journey (revisión B · journey 13)

Diff: main...harness/m3-e2e-journey

Revisa el PR #123 (journey E2E de inventario). **No escribas archivos**: usa `git show` y lecturas
del worktree/PR; no uses `$env:TEMP` ni redirecciones (el sandbox lo rechaza). No ejecutes Playwright
ni PostgreSQL.

Comprueba:

1. **Limpieza registrada antes de actuar** y acotada al `runId`; nada de borrar datos ajenos;
   qué artefactos quedan (OC recibidas, versión de receta) y si eso es aceptable y está documentado.
2. **Siembra por API** (sin SQL), reutilizando el cliente compartido `journey-api.ts`; los métodos
   nuevos son aditivos y no cambian el contrato de los journeys 1-12.
3. **Aserciones de UI y de API**: saldo descontado, movimiento `sale_consumption`, alerta con
   déficit, margen, ajuste por UI, cancelación con `sale_reversal` y saldo repuesto. ¿Podría el test
   pasar sin la funcionalidad (aserciones vacuas, `expect` sobre conjuntos vacíos, skip silencioso)?
4. **Esperas explícitas** (sin `waitForTimeout` como sincronización), consola limpia, sin
   `alert/confirm/prompt`, y que un skip por precondición del entorno diga exactamente qué falta.
5. Riesgo de contaminar el catálogo real de desarrollo (producto/almacén existentes) y de que el
   journey sea frágil ante un catálogo sin productos vendibles.

Entrega el informe con `VEREDICTO: APROBAR|CORREGIR` y hallazgos P1/P2/P3 con archivo y línea.
