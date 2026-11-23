# Propuesta de backlog — Hito M2 «v1.1 Offline» (Fase 3)

Propuesta generada a partir de `docs/plans/plan-autonomo-100.md` (§1 M2, §2, §5.4), `AGENTS.md` (§11, §19.2), `docs/adr/ADR-004.md`, `docs/architecture/OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX.md`, `docs/architecture/OFFLINE_SYNC_CONTRACT.md`, `packages/sync-engine/src`, `docs/agentic/coverage-m1.md` (§2.6) y `TODO.md` (Fase 3).

Archivo de entradas: [`docs/agentic/m2-backlog-proposal.json`](./m2-backlog-proposal.json) (**18 ítems**: 7 nivel A en `codex`, 5 nivel B en `opencode`/`agy`, 4 nivel C en `agy`, 2 nivel D en `agy`).

> Nota de integración al congelar M2: las entradas se entregan con `"status": "pending"` según la instrucción de la tarea. Como `tools/agentic/loop-tick.ps1` y `plan-autonomo-100.md` §3.1 despachan ítems en `"ready"`, al incorporar la propuesta a `docs/agentic/backlog.json` el orquestador debe cambiar `"pending"` → `"ready"` en las entradas aprobadas.

---

## 1. Resumen por carril y nivel

| Nivel | Carril | Ítems | Alcance |
|---|---|---|---|
| **A** | `codex` (1 carril, cadena estricta por `deps`) | 7 | Contratos `shared-types` + `sync-engine`, merge determinista en `domain`, migración SQL + ledger/cursor, `POST /sync`, `POST /sync/pull` + `manual_review`, almacenamiento local cifrado en web y en mobile |
| **B** | `opencode` (hasta 4) | 4 | Failure injection en `sync-engine`, matriz de conflictos en `domain`, conflictos HTTP+PG17 con 2 dispositivos y suite Playwright `e2e:offline` |
| **B** | `agy` (hasta 3) | 1 | Caché local IndexedDB en KDS (sin PII ni dinero) + avance monotónico offline + cursor pull |
| **C** | `agy` (hasta 3) | 4 | PWA (manifest + SW), barra de conectividad + `/app/sync`, operación offline Web POS (órdenes/efectivo/ticket) y UI/flujo offline en Mobile |
| **D** | `agy` | 2 | ADR-005 de almacenamiento local y cierre documental de matriz offline + runbook M2 |

---

## 2. Orden recomendado por olas (sin solapamiento de `paths`)

Todas las tareas de carril `codex` están encadenadas linealmente (`#2 → #3 → #4 → #5 → #6 → #7 → #8`), así que nunca compiten dos ítems por el único carril `codex`. Asimismo, los carriles de un solo escritor (`supabase/migrations/`, `packages/shared-types/`, `pnpm-lock.yaml` y cada `package.json`) quedan serializados por `deps`.

| Ola | Carril `codex` (máx. 1) | Carril `agy` (máx. 3) | Carril `opencode` (máx. 4) |
|---|---|---|---|
| **1** | `m2-sync-contracts-engine` (A) | `m2-adr-005-local-storage` (D) | *(carril libre para relleno §2 / cobertura M1)* |
| **2** | `m2-sync-merge-domain` (A) | `m2-web-pwa-shell` (C) | `m2-test-sync-engine-failures` (B) |
| **3** | `m2-sync-sql-migrations` (A) | *(revisiones / relleno)* | `m2-test-sync-merge-matrix` (B) |
| **4** | `m2-api-sync-push-merge` (A) | *(revisiones / relleno)* | *(revisiones / relleno)* |
| **5** | `m2-api-sync-pull-review` (A) | *(revisiones / relleno)* | *(revisiones / relleno)* |
| **6** | `m2-web-local-storage-crypto` (A) | *(espera almacenamiento web)* | `m2-api-sync-conflicts-tests` (B) |
| **7** | `m2-mobile-local-storage-crypto` (A) | `m2-web-sync-status-ui` (C) | *(revisiones / relleno)* |
| **8** | *(cadena `codex` completada)* | `m2-web-offline-pos-cash` (C) · `m2-mobile-offline-sync-ui` (C) · `m2-kds-offline-cache` (B) | *(revisiones / relleno)* |
| **9** | — | — | `m2-e2e-offline-web` (B) |
| **10** | — | `m2-docs-offline-matrix-signoff` (D) | — |

### Criterios de salida del hito M2

1. `m2-e2e-offline-web` (`pnpm --filter @super-restaurant/web e2e:offline`) y `m2-api-sync-conflicts-tests` en verde en CI y en 3 corridas nocturnas seguidas.
2. Migraciones SQL de sync reproducibles desde cero en `pg-verify` y aplicadas al Supabase de desarrollo por lote al cerrar M2 (§0.1).
3. `docs/architecture/OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX.md` actualizado con evidencia real por cliente/operación y cero hallazgos P1 abiertos.

---

## 3. Supuestos conservadores a registrar en `docs/agentic/DECISIONS_PENDING.md`

De acuerdo con `plan-autonomo-100.md` §0.2 y `OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX.md` §7, estos supuestos permiten ejecutar M2 sin bloqueos humanos y quedan sujetos a ratificación final de Emmanuel:

| Decisión pendiente | Supuesto conservador aplicado en M2 | Impacto si se revierte |
|---|---|---|
| **ADR-005: motor de almacenamiento local web/mobile** | Web: IndexedDB con transacción atómica (nativo o Dexie, sin servidor de sync externo) + cifrado AES-GCM vía Web Crypto para datos sensibles. Mobile: `expo-sqlite` (compatible con Expo 57/RN 0.86 sin módulos nativos de alto riesgo) + clave en `expo-secure-store` y cifrado en reposo. | Cambiar de librería (p. ej. RxDB o WatermelonDB) solo reemplaza los adaptadores `DurableSyncStoragePort`; `packages/sync-engine` y el API no cambian. |
| **Topología sin servidor LAN (Fase 3B / ADR-009)** | Fase 3 es estrictamente offline por dispositivo contra nube autoritativa (`ADR-004`). Sin WAN no hay comunicación Web POS ↔ Mobile ↔ KDS; la UI lo advierte explícitamente. | Si KDS multi-dispositivo sin WAN es requisito comercial, se abre ADR-009 y Fase 3B aparte sin descartar `sync-engine`. |
| **Alcance y límites de efectivo offline y `card_manual`** | Efectivo offline habilitado solo si existe turno/caja abiertos localmente, secuencia monotónica y tope conservador por sucursal; `card_manual` offline registra referencia para conciliación posterior sin marcar `captured` integrado ni guardar PAN/CVV. Cierre de caja, reembolsos, CFDI y descuentos que exigen supervisor permanecen bloqueados offline. | Ajustar topes o habilitar cierre offline de caja requiere cambio de política en `capability-guard.ts`, pruebas de conciliación y nueva revisión de riesgo. |
| **Autorización de supervisor sin WAN** | Ninguna caché local concede autorización de supervisor; acciones que exigen supervisor (cancelación post-envío, descuento fuera de límite, reapertura) se bloquean offline y nunca se aprueban retroactivamente en silencio. | Permitir excepciones offline requeriría una ADR dedicada con PIN/firma criptográfica auditada y límites explícitos. |
| **Retención del ledger de deduplicación y tombstones** | Sin purga automática por TTL corto para eventos financieros (`Payment`, `CashMovement`) ni para casos `manual_review` abiertos; la compactación local solo elimina terminales no financieros fuera de ventana activa. | Definir una política legal de retención/archivado posterior solo agrega un job de archivo sin perder historial ya registrado. |
| **Compatibilidad de clientes atrasados (`schemaVersion`)** | `schemaVersion: "1"` fija en M2; cualquier versión desconocida o cursor expirado detiene la sincronización con `SCHEMA_UNSUPPORTED` / `RESYNC_REQUIRED` y guía al operador a actualizar o resincronizar, nunca transforma silenciosamente. | Agregar migraciones automáticas entre versiones futuras de esquema es aditivo sobre el hook de `schema-migration.ts`. |
| **Resolución de `manual_review`** | Solo roles `owner`, `admin`, `manager` y `supervisor` (`sync.manual_review.resolve`) pueden resolver casos, siempre mediante evento/asiento compensatorio con motivo obligatorio; nunca se usa LWW ni se sobreescriben hechos financieros. | Cambiar roles autorizados o SLA de revisión solo ajusta `rbac-policy.ts` y alertas operativas. |
| **Impresión offline en Web y Mobile** | Web imprime tickets/comandas offline desde navegador usando plantillas cacheadas con leyenda «Pendiente de sincronizar»; impresión Bluetooth/ESC-POS en Mobile queda supeditada a ADR-008 y piloto con hardware real. | Integrar impresora física en Mobile se acopla luego a `packages/printing` sin rehacer el outbox ni el protocolo de sync. |
