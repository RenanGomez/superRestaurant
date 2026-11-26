# PROHIBIDO salir del repositorio: no leas C:\Users\Emmanuel G\agent-harness ni plantillas externas, no busques REPORT-TEMPLATE. No escribas archivos. Solo git show y lectura de rutas dentro del repo.

# REGLA DURA: no escribas archivos ni uses `$env:TEMP`/`>`. Lee con `git show`. No ejecutes Playwright ni PostgreSQL.

# Brief m3-rev-e2e-journey-final (revisión B · journey 13 final)

Diff: 615a24d9...harness/m3-e2e-journey

Revisa el PR #123 ya corregido. El orquestador lo ejecutó contra el stack local: **1 test, verde,
1.7 min**. No repitas esa ejecución.

Comprueba:

1. **Ningún fallo de inventario puede terminar en verde:** `waitForMovement` falla con mensaje
   (runId, almacén, saldo observado); los únicos `test.skip` son catálogo inexistente/sin producto,
   cuenta sin permiso de inventario y turno ausente; no hay `waitForTimeout` como sincronización.
2. **Almacén predeterminado:** `ensureDefaultWarehouse` reutiliza el default, o promueve/crea
   `Almacén principal`; el saldo se compara **en ese** almacén; no se deja más de un default.
3. **Receta restaurada:** se guarda la versión activa previa y se re-publica en `cleanup`, registrado
   antes de escribir; si no había receta previa se avisa y se documenta.
4. **Plan de venta canónico:** usa `effectiveHalvesSetup`/`pickHalfFlavor`/`buildLineFraction` de
   `src/lib/line-halves.ts` y el fixture manda `fraction` para productos con mitades; no hay
   matemática de precios en el test; `pizzaPlan` sigue cubriendo V2.
5. **Limpieza acotada:** barridos por nombre con `runId`, proveedor registrado aunque se pierda la
   respuesta, cancelación de la venta si quedó sin cobrar.
6. Aserciones vacuas restantes y cualquier riesgo de contaminar el catálogo real.

Entrega `VEREDICTO: APROBAR|CORREGIR` con P1/P2/P3, archivo y línea.
