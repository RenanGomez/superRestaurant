# Estado del loop

Actualizado: 2026-11-26 (Ola 4 — deuda que muerde: verificadores, lecturas de compras, revisiones de M2)

- **M1:** cerrado. **M2:** cerrado formalmente, pero **no declarable al 100 %**: las revisiones de la Ola 0
  encontraron dos P1 de purga offline y un P2 de líder entre pestañas (ver deuda activa). Puertas humanas
  (dispositivo real, impresora, capturas) siguen abiertas en `docs/agentic/m2-offline-signoff.md`.
- **M3 inventario: 100 % del alcance fusionado.** Migración nueva `20261126001400` aplicada a dev con el
  protocolo §19.6 (`docs/agentic/dev-migrations-2026-11-26b.md`); `lastRemote=20261126001400`.
- **Ola 4:**
  - `debt-historical-verifiers` **DONE** (#130): los tres verificadores históricos corren desde cero
    (shared 62 previas, locked 63, capture 16 con base 27/5/36 → 35/5/41); fixtures pineados en
    `supabase/tests/historical/` para que CI no los ejecute contra el esquema completo.
  - `debt-compras-reads` **DONE** (#131): lecturas de proveedores y órdenes con `catalog.read` en servicio
    y SQL (ocho roles; `kitchen`/`courier` siguen en `42501`), escrituras intactas. 91 migraciones desde
    cero y `test:http:local` 9/9.
  - Revisiones de M2 (**5/5 con veredicto**): `o0-rev-web-leader` **CAMBIOS** (P2: seguidor sin timeout;
    el líder no tiene consumidor productivo), `o0-rev-web-purge` **CAMBIOS** (2 P1: `decideOfflinePurge`
    sin llamador y `purgeReplica` rechazando `STORAGE_LOCKED`; P2: cursor del scope),
    `o0-rev-mobile-banner` **APROBAR** (P2 de pruebas), `o0-rev-sync-p3` **APROBAR** (P2 de mapeo
    `AUTH_REVOKED`), `o0-rev-visual` **CAMBIOS** (P2: el spec de KDS offline puede dar verde falso).
  - Correcciones fusionadas: #132 (release conserva evidencia financiera rechazada), #133 (purga de
    scope con `resync_required` y sin cursor) y #134 (identidad de dispositivo de inventario estable
    por perfil), revisadas por dsh (APROBAR en #132 y #133; #134 con un P2 de documentación corregido
    en el mismo PR).
  - `o0-wire` **DONE** como cableado de pruebas (#85); el cableado productivo del líder pasa a
    `o0-leader-wire` y la purga de producción a `o0-purge-wire`.
  - `debt-device-id` **DONE** (#134): `deviceId` por perfil de navegador, decisión documentada; validar
    contra `app.sync_devices` queda como `o0-device-registry` (nivel A).
  - `debt-p3-sweep` **DONE**: `debt.md` reescrito en Activa (dueño + siguiente acción) y Archivada (fecha
    y motivo).
- **Puertas de la ola:** shared/locked/capture verdes; `verify:inventory-schema:rollback` 91 migraciones
  ok; `test:http:local` 9/9; web y API typecheck/lint/test en 0; CI verde en #130, #131 (y corriendo en
  #132/#133).
- **Puerta humana pendiente:** la prueba única del operador (D1–D7, T1–T4, seis pestañas de inventario)
  sigue sin registrarse; ninguna fila de «Día operable» pasa a DONE.
- **Siguiente ola:** `o0-purge-wire` (P1) y `o0-leader-wire` (P2) para poder declarar M2 al 100 %;
  después el arranque de M4 (`m4-metrics-catalog`, `m4-adr-014-exports`).
