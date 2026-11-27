# Estado del loop

Actualizado: 2026-11-26 (Ola 5, segundo corte: rechazos recuperables del sync y `lastRemote=20261126001500`)

- **M1:** cerrado. **M2:** cerrado formalmente, **sin declarar al 100 %**: `o0-purge-wire` y `o0-leader-wire`
  están fusionados y probados (#138), pero falta `o0-device-registry` (validar el `deviceId` de inventario
  contra `app.sync_devices`). Puertas humanas (dispositivo real, impresora, capturas) siguen abiertas en
  `docs/agentic/m2-offline-signoff.md`.
- **M3 inventario: 100 % del alcance fusionado.** `lastRemote=20261126001400`; el preflight del 2026-11-26
  no encontró candidatas (solo la excluida `20260908000100`).
- **Ola 5, primer corte (fusionado en `main` `85f781e0`):**
  - `o0-purge-wire` **DONE** (#138): `decideOfflinePurge` lo invocan `sign_out` (`release()`) y
    `auth_revoked` (push/pull revocados o `SCOPE_REVOKED`). `sign_out` sin evidencia borra el estado del
    dispositivo; con evidencia purga la réplica, conserva el outbox y limpia todos los cursores.
    `AUTH_REVOKED` bloquea el almacén, purga la réplica (`allowLocked`) y libera el sello cuando la
    réplica ya no existe, porque un almacén bloqueado sin ruta de desbloqueo perdía la única copia de la
    evidencia financiera. `purge()` borra filas bajo el Web Lock en vez de encolar `deleteDatabase`.
  - `o0-leader-wire` **DONE** (#138): `acquireSyncLeader` resuelve con timeout y conserva la petición
    encolada; `onGranted`/`status`/`onLost` distinguen relevo, pérdida y liberación voluntaria. Nuevo
    `runtime-sync-runner`: solo el líder abre el puente, el seguidor explica por qué no sincroniza, releva
    al líder y descarta el motor al perder el lock (mismo idempotency key en el outbox).
  - `o5-visual-spec-fix` **DONE** (#139): la spec de KDS offline exige ruta y sucursal reales, sin
    `networkidle` silencioso; el auditor prueba límites por eje, `rem`/`em` con raíz de 16, `::after` y
    pseudo `static`.
- **Puertas de la ola:** web `test` (purga 22, puente 18, líder 4, runner 3, `visual-assert` con los
  casos límite), `lint`, `typecheck`, `build` y `e2e:typecheck` en 0; CI verde en #138 y #139 (Verify,
  PostgreSQL, Playwright). Verificación visual real **no** ejecutada en esta sesión.
- **Puerta humana pendiente:** la prueba única del operador (D1–D7, T1–T4, seis pestañas de inventario)
  sigue sin registrarse; ninguna fila de «Día operable» pasa a DONE.
- **Ola 5, segundo corte (fusionado en `main` `a8ef9c30`):**
  - `o5-sync-rejection-map` **DONE** (#141): `DEVICE_UNKNOWN`/`ACTOR_MISMATCH` viajan con su código, el
    motor los reintenta con backoff (scope activo, evidencia intacta, sin `manual_review`) y el puente
    re-registra el equipo. `INVALID_SCOPE` sigue revocando (P3 documentado).
  - `o5-func-comments` **DONE** (#142): migración `20261126001500` solo de comentarios, validada desde
    cero en CI y **aplicada a dev** con el protocolo §19.6 (sonda 3 sentencias `ok`, respaldo 1 391 471
    bytes/130 tablas, dry-run exacto, apply único, postcheck `upToDate` y segundo dry-run `upToDate`;
    comentarios leídos de `pg_description`). `lastRemote=20261126001500`.
  - Servidores locales levantados con `SYNC_CURSOR_SECRET` efímero (sin él la API no arranca); la sesión
    de Playwright sigue caducada y falta el login manual.
- **Siguiente ola:** `o0-device-registry` (A) con la decisión ya tomada (**derivar el `deviceId` de
  inventario por actor**, registrarlo antes de escribir y validarlo); `o5-compras-ui-read` (C) con sesión
  de Playwright viva. Plan: `docs/plans/plan-2026-11-27-ola5-m2-m4.md`.
