# capture-drafts-tidy — hecha
Cambios: Encabezado y tarjetas ya no muestran folio/versión/ID; folio+versión pasan a una línea gris `text-xs` al final de la sección. `refreshWorkspace` relee `detail` cuando hay `customerId`, así reaparece la tarjeta de cliente al reanudar. Nuevo `isRecoverableCaptureDraft` filtra borradores V2 sin cliente ni total; V1 se conserva porque no expone esos datos.
Archivos: apps/web/src/app/app/capture/capture-workspace.tsx, apps/web/src/lib/capture-workspace.ts, apps/web/src/lib/capture-workspace.test.ts
Faltantes (tarea B `capture-draft-list-summary`): la lista no trae cantidad de líneas (`CaptureTrayItemV2`/`CaptureDraftSummaryV1`); el resumen V1 no trae cliente ni teléfono; `totalMinor` es null también sin `catalog.read`.
Verificación (desde apps/web, corridas por separado):
```
$ corepack pnpm lint            → $ eslint ... src        (sin salida)
$ corepack pnpm typecheck       → $ tsc --noEmit ...      (sin errores)
$ corepack pnpm test            → ok 2 - only drafts with a frozen customer or a priced selection are offered as recoverable
                                  EXIT=0, "# fail 0"
```
Riesgos/pendientes: Sin verificación en navegador real (no se levantó servidor); el filtro puede ocultar un borrador con líneas si el actor carece de `catalog.read`.
