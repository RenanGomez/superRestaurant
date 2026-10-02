# web-order-actions-r10 (addendum; hallazgo Codex ronda 9, log `.claude/runs/web-order-actions/review-r9.log`)

## Tarea
web-order-actions-r10 · capa: L1 (`implementer-claude`, mismo escritor) · riesgo: bajo · nivel B (`apps/api/src/orders.ts` sendToKitchen). Sin SQL ni contrato.

## Objetivo
[P2] `orders.ts:483-490`: con versión avanzada, si otro actor canceló todas las líneas listadas, la rama devuelve `replayed: true` aunque no se envió nada.

## Criterios de aceptación
- [ ] Refinar la rama `stored.version > expectedVersion`: `replayed: true` sólo si la orden no es `draft` **y cada línea listada está en `sent`, `preparing`, `ready` o `delivered`** (es decir, verificablemente enviada). Si alguna línea listada está `pending` o `cancelled`, `conflict` sin persistir.
- [ ] Pruebas: (a) tercero cancela todas las líneas listadas tras capturar la versión → `conflict`; (b) la prueba de replay completado sigue devolviendo `replayed: true`; (c) mezcla una enviada por este comando y otra cancelada por un tercero → `conflict`.
- [ ] Comentario de cabecera ajustado. Puertas `pnpm --filter @super-restaurant/api test && typecheck && lint`. Commit `fix(api): …`.

## Archivos de entrada
- C:\tmp\sr-wt\web-order-actions\apps\api\src\orders.ts (425-510), apps\api\src\orders.test.ts (560-800).

## Invariantes
Un comando nunca reporta éxito por trabajo que no hizo; reintento no duplica; contratos intactos; sin SQL.

## Formato de salida
Resumen, hash, resultado final de cada puerta, riesgos.
