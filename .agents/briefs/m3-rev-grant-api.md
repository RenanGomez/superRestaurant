# Brief m3-rev-grant-api (revisión A · foco API)

Diff: main...harness/m3-schema-grant-close

Revisa SOLO la parte de API del PR #122 (nivel A, foco contrato). No escribas archivos: usa
`git show` y lecturas del worktree/PR. No ejecutes PostgreSQL ni Playwright.

Comprueba:

1. `apps/api/src/inventory/movements.service.ts`: el SQL y el orden de parámetros del envoltorio
   coinciden exactamente con la firma `inventory_record_manual_movement(uuid,uuid,uuid,uuid,uuid,
   text,integer,text,text,uuid)`; no queda ninguna llamada al ledger crudo; el `deviceId` opcional
   viaja como null sin romper tipos.
2. Semántica perdida: `ParsedMovementRequest.compensatesMovementId` sigue aceptándose del cliente y
   ahora se ignora. Decide si es P1/P2/P3 (¿el contrato promete compensar? ¿debe rechazarse en vez
   de ignorarse?) y documenta el riesgo de un cliente que crea compensar sin efecto.
3. Mapeo de errores: los códigos `22000` nuevos del envoltorio deben llegar como `request` (400) y no
   como `unavailable` (503); revisa `sqlState`/`requestError` y que `movements.test.ts` cubra el caso.
4. Transferencias y listados no cambian de comportamiento; los mocks de las unitarias reflejan la
   nueva llamada y ninguna aserción quedó laxa.

Entrega el informe con `VEREDICTO: APROBAR|CORREGIR` y hallazgos P1/P2/P3 con archivo y línea.

## Regla de entorno

No escribas archivos ni uses \C:\Users\EMMANU~1\AppData\Local\Temp o redirecciones (el sandbox los rechaza): lee con `git show main:...` / `git show harness/m3-schema-grant-close:...` y entrega el informe solo en la respuesta.
