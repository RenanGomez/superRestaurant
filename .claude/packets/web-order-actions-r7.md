# web-order-actions-r7 (addendum; hallazgo Codex ronda 6, log `.claude/runs/web-order-actions/review-r6.log`)

## Tarea
web-order-actions-r7 · capa: L1 (`implementer-claude`, mismo escritor) · riesgo: bajo · nivel C (sólo `apps/web`).

## Objetivo
[P2] `apps/web/src/app/app/orders/actions.ts:156-161`: las acciones de orden crean una cookie `sr-device-id` ajena a la identidad de dispositivo que ya usa Capture (`captureDeviceId` en localStorage, `apps/web/src/lib/capture-workspace.ts:56`, usada por `capture-workspace.tsx:95` y `delivery-zones-editor.tsx:20`). El mismo navegador queda auditado con dos ids y, si la cookie no llega antes de un reintento, el `deviceId` cambia y rompe el replay byte-idéntico.

## Criterios de aceptación
- [ ] El panel (`order-detail-panel.tsx`) obtiene el `deviceId` una sola vez con `captureDeviceId(window.localStorage, () => crypto.randomUUID())` (mismo patrón que `delivery-zones-editor.tsx:20`, con guarda SSR) y lo pasa a cada server action junto con `eventId`, `idempotencyKey` y `occurredAt`; el mismo valor se reutiliza en cualquier reintento.
- [ ] Las server actions de `actions.ts` reciben `deviceId`, lo validan como UUID (rechazo `invalid`), lo usan en `audit()` y dejan de leer/escribir la cookie `sr-device-id` (eliminar `DEVICE_COOKIE` y `getOrCreateDeviceId`). Verificar con grep que ningún otro archivo use esa cookie; si `page.tsx` o la bandeja reexponen las acciones, ajustar firmas.
- [ ] Sin cambios en `apps/api` ni contratos. Puertas: `pnpm --filter @super-restaurant/web lint && typecheck && test && build`.
- [ ] Commit `fix(web): reuse the capture device identity for order mutations`.

## Archivos de entrada
- C:\tmp\sr-wt\web-order-actions\apps\web\src\app\app\orders\actions.ts (completo).
- C:\tmp\sr-wt\web-order-actions\apps\web\src\app\app\orders\order-detail-panel.tsx (completo).
- C:\tmp\sr-wt\web-order-actions\apps\web\src\lib\capture-workspace.ts (líneas 50-70).
- C:\tmp\sr-wt\web-order-actions\apps\web\src\app\app\delivery-zones\delivery-zones-editor.tsx (líneas 15-25): patrón a copiar.

## Invariantes
Un dispositivo = un id estable por navegador; reintento byte-idéntico; servidor revalida; sin alert/confirm/prompt.

## Fuera de alcance
Todo lo demás.

## Formato de salida
Resumen, archivos y hash, resultado final de cada puerta, riesgos.
