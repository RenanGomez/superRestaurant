# review-tables-accounts-r2 — hecha
Cambios: Revisión de sólo lectura de codex/tables-accounts-r2 (5 archivos, +91/-50 líneas).
Archivos: Ninguno modificado (sólo lectura).
Verificación: git diff --check (0 errores); lint, typecheck y 53 suites de tests web pasan; inspección de Server Actions, diálogo y API.
Riesgos/pendientes: Ninguno bloqueante. Se eliminó el botón redundante «Abrir cuenta» del detalle sin dejar órdenes borrador sin salida.
Notas: Cumple AGENTS.md §8, §10, §14 y criterios de .claude/packets/tables-accounts-r2.md. Sin `any`, LF limpio, targets ≥ 44 px.

Hallazgos:
- **P3 — apps/web/src/app/app/tables/actions.ts:121**: en `createTableOrderAction`, si se invocase con `waiterUserId !== null`, la llamada a `orders/assign-waiter` usa `crypto.randomUUID()` para `eventId` e `idempotencyKey` en vez de derivarlos del `attempt`. En la UI actual siempre se llama con `waiterUserId: null`, pero por consistencia defensiva en la Server Action exportada convendría derivar identificadores deterministas.
- **P3 — apps/web/src/app/app/tables/tables-board.tsx:207**: en `assign()`, la reconciliación de respuesta ambigua valida `result.error === "unavailable" && currentOrder?.waiterUserId === waiterUserId`. Si un reintento devolviese `conflict` habiendo aplicado previamente el cambio, muestra el error de conflicto en vez de reconciliar. Se sugiere aceptar la reconciliación si el mesero coincide.

Verificaciones:
1. Creación e idempotencia (§8, §10): `createTableOrderAction` deriva determinísticamente `eventId` e `idempotencyKey` para `orders/open` vía SHA-256. Reintentos hacen replay en PostgreSQL sin duplicar órdenes ni abrir dos veces. Ambigüedad se reconcilia con `requestOrderDetail`.
2. Diálogo de mesa (§14): Creación sin selector previo con `waiterUserId: null`, manteniéndose en el diálogo. Tarjetas individuales con asignación, reasignación y desasignación («Sin mesero»). `busyOrderId` aísla el estado «Guardando…» a la tarjeta activa. Mensajes de feedback específicos por tarjeta.
3. Detalle de orden (§8): Retirar «Abrir cuenta» no bloquea borradores. Las cuentas creadas en mesa nacen abiertas; si alguna quedara en borrador, agregar productos y «Enviar a cocina» ejecuta `draft → open` atómicamente antes de enviar las líneas. Caja no admite cobrar borradores por regla de dominio.
4. Accesibilidad e interfaz (§14): `uiButton` y `uiOption` garantizan targets ≥ 44 px (`min-h-11`). Foco atrapado con soporte de Tab y Escape; `role="dialog"`, `aria-modal`, `aria-expanded`, `aria-pressed`, `role="status"` y `role="alert"`. Textos en español, sin llamadas a `alert/confirm/prompt`.
5. Dinero y permisos (§9, §10): Ningún cálculo de dinero ni decisión de autorización en cliente; totales provistos por el servidor en `OrderDetailV1`.

VEREDICTO: APROBAR
