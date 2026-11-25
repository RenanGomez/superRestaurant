# Brief m3-map-sale-hooks (solo lectura · mapa de ganchos de venta)

## Objetivo
Informe con el mapa exacto de dónde se confirma, cancela y reembolsa una venta en este repo, con firmas y números de línea, para diseñar el consumo de inventario de M3.

Tiempo estimado: 15 min. Solo lectura: no edites ni crees archivos del repo.

## Alcance
- Lee: `supabase/migrations/**` (solo las que definen confirmación/cancelación/caja/reembolsos), `apps/api/src/operations/**`, `apps/api/src/payments*`, `apps/api/src/cash*`, `packages/domain/src/**`.
- Prohibido: modificar archivos, `git add/commit/push`, migraciones remotas, instalar dependencias.
- Puedes usar `codegraph explore "<símbolo>"` y `rg`/`Select-String`.

## Qué responder (formato del informe)
1. **Confirmación de venta**: nombre exacto de la(s) función(es) SQL (`app_private.confirm_capture_draft_v3` y variantes), firma completa, tabla(s) que escribe, y el punto en el API que la invoca (archivo:línea, función).
2. **Ítems y modificadores persistidos**: tablas y columnas donde quedan producto, modificadores, mitades y cantidades tras confirmar (necesario para explosionar recetas). Indica si la cantidad es entera o decimal.
3. **Cancelación**: función SQL / endpoint / servicio, qué escribe, y si deja rastro del ítem cancelado (para reverso de consumo).
4. **Reembolso**: `refunds`/`payments` — función y tablas, y cómo se referencia la orden original.
5. **Caja**: `cash_movements` (o equivalente) — cómo se registra un cobro y si hay un punto único por el que pasa todo cobro.
6. **Idempotencia existente**: qué claves usa cada uno de esos flujos para no duplicar (nombre de columna y valor).
7. **Riesgos**: 3–5 bullets de dónde engancharía el consumo de inventario sin duplicar ni romper la idempotencia.

Cada afirmación con `archivo:línea` o nombre de migración. Si algo no existe, dilo explícitamente.

## Cómo verificar
```powershell
. .\tools\agentic\use-node24.ps1
codegraph explore "confirm_capture_draft_v3"
Select-String -Path supabase/migrations/*.sql -Pattern 'confirm_capture_draft' | Select-Object -First 20
Select-String -Path apps/api/src/**/*.ts -Pattern 'confirm_capture|refund|cash_movement' | Select-Object -First 40
```
Pega la salida real de al menos dos de esos comandos.

## Cierre
- Sin commits.
- Tu respuesta final ES el informe: máximo 60 líneas, con las rutas y firmas exactas y la salida real de al menos dos comandos.
- Aplica Ponytail: no propongas abstracciones nuevas; solo describe lo que existe.
