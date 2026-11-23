# Runbook — verificación offline de Fase 3 (M2)

Comandos reproducibles para comprobar el motor de sincronización, el ledger de deduplicación y el
comportamiento de conflicto de Fase 3, más los límites conocidos y el checklist de cierre de M2.

Complementa a [`docs/architecture/OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX.md`](../architecture/OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX.md)
(la política) y a [`docs/architecture/OFFLINE_SYNC_CONTRACT.md`](../architecture/OFFLINE_SYNC_CONTRACT.md)
(el contrato de envelope). El estado de cada capacidad y qué prueba la respalda se mantiene en la §8 de
la matriz.

## 1. Requisitos

- Windows con **Node 24.19.0** y **pnpm 11.19.0** en el `PATH` (son las versiones fijadas en el
  `engines` del `package.json` raíz).
- Dependencias instaladas: `pnpm install`.
- Paquetes workspace construidos cuando el comando lo requiera:
  `pnpm --filter @super-restaurant/shared-types build` y
  `pnpm --filter @super-restaurant/domain build`.
- **PostgreSQL 17 portátil** en `.cache/postgres-local/pgsql` (ignorado por Git) para las pruebas que
  crean un cluster desechable. En un worktree, enlazar `.cache` con una junction al del repositorio
  principal. Si falta, la prueba falla con `LOCAL_POSTGRES_MISSING`. Esta ruta nunca toca Supabase ni
  una base compartida y no usa `ADR010_DATABASE_URL`.

### Secreto para cursores de sincronización

Configure `SYNC_CURSOR_SECRET` únicamente en el entorno seguro del servidor API, con un valor aleatorio y estable de al menos 32 caracteres. Todas las instancias que atienden la misma API deben usar el mismo valor; el arranque falla si falta o es demasiado corto. No versionar el valor real. Al rotarlo, los cursores firmados con el valor anterior dejan de ser válidos: los clientes deben iniciar una resincronización conforme al contrato de sync.

## 2. Comandos por capa

### 2.1 Reglas de merge deterministas (dominio puro)

```
pnpm --filter @super-restaurant/domain test
```

Ejecuta `packages/domain/src/sync-merge.test.ts`, que cubre la matriz de conflicto §4.2 sin
infraestructura: líneas aditivas con recálculo en minor units, edición concurrente, disputa de mesa,
cancelación post-envío, cobro repetido con misma y distinta idempotency key, tombstones,
independencia de `occurredAt` y rechazo fail-closed de float y de eventos cross-tenant/cross-branch.

### 2.2 Motor de sincronización y failure injection

```
pnpm --filter @super-restaurant/sync-engine test
```

Ejecuta `packages/sync-engine/src/failure-injection.test.ts` y el resto de suites del motor:
caída antes/después del commit atómico, timeout post-commit con recuperación `duplicate`, push
`accepted` con pull fallido conservando `pullCursor`, lotes fuera de orden, 20 reenvíos concurrentes,
reloj manipulado, `schemaVersion` atrasada, cola grande con backoff, rechazo de PAN/CVV y bloqueo de
operaciones no habilitadas por matriz.

### 2.3 API y ledger en PostgreSQL 17 desechable

```
pnpm --filter @super-restaurant/api run test:sync-conflicts:local -- --local-disposable-only
```

Sin la bandera `--local-disposable-only` falla con `LOCAL_CONFIRMATION_REQUIRED`. Crea un cluster,
aplica todas las migraciones desde cero y lo apaga en `finally` (salida `local_cleanup`). Verifica:
registro no transferible de dispositivo, rechazo de dispositivo/actor revocados, 20 reenvíos
concurrentes con un solo efecto en ledger/receipt, `duplicate` por misma idempotency key y colisión
divergente, `LOCAL_SEQUENCE_REUSE`/`SEQUENCE_OUT_OF_ORDER`, aislamiento cross-restaurant/cross-branch,
cursor y tombstones por scope, no visibilidad entre dispositivos antes de `append_change` (sin
garantía LAN) y `manual_review` único resuelto solo por supervisor con motivo.

> **Límite actual:** esta suite usa las funciones del ledger, no el endpoint HTTP `POST /sync` /
> `POST /sync/pull`. Esos endpoints todavía no están integrados (`m2-api-sync-push-merge`,
> `m2-api-sync-pull-review`); hasta entonces, los escenarios de conflicto de §5 solo están probados en
> dominio/motor y a nivel de ledger.

### 2.4 Esquema de sync reproducible desde cero

```
pnpm --filter @super-restaurant/api run verify:sync-schema:rollback
```

Aplica `supabase/migrations/20261123000300_sync_ledger.sql` y el resto desde cero en un cluster
desechable, ejecuta los invariantes dentro de una transacción con `ROLLBACK` y hace postcheck sin
estado persistente.

### 2.5 Suite E2E offline de web

```
pnpm --filter @super-restaurant/web e2e:typecheck
pnpm --filter @super-restaurant/web e2e:offline
```

Requiere API y web locales levantados según `apps/web/e2e/` (`e2e:auth` para guardar sesión).

> **Estado actual:** `apps/web/e2e/offline.spec.ts` es todavía **informativo**: el propio archivo
> declara que el web aún no tiene soporte offline de Fase 3 y solo comprueba que la ruta se recupera al
> reconectar. No lo uses como evidencia de capacidades offline. La verificación real de PWA, caché de
> menú/mesas, orden y efectivo offline, ticket pendiente y conflicto de dos dispositivos llega con
> `m2-e2e-offline-web`.

### 2.6 Puertas globales del alcance

```
pnpm lint
pnpm typecheck
pnpm test
```

Para cambios de documentación, `git diff --check` es la verificación mínima de la §19.2 (nivel D).

## 3. Límites conocidos de plataforma y hardware

- **Sin LAN en Fase 3:** cortar WAN no permite comunicación entre Web POS, Mobile y KDS, aunque estén
  en la misma red local. No existe servidor local ni failover; eso sería Fase 3B/ADR-009.
- **PostgreSQL local desechable solo en Windows** (o con `SR_TEST_DATABASE_URL` de loopback cuando
  `CI=true`/`NODE_ENV=test`). Las suites `test:sync-conflicts:local` y `verify:sync-schema:rollback`
  fallan con `LOCAL_CONFIRMATION_REQUIRED` si no se pasa la bandera.
- **Mobile:** la verificación en dispositivo nativo (Android/iOS) no está cubierta por esta suite; si
  solo se valida en Expo web, hay que documentar la limitación. La exportación Android con Hermes ha
  fallado en algunos cortes con `spawn EPERM`; no implica un fallo de la lógica de sync.
- **KDS:** el avance local offline y la recuperación por cursor requieren `m2-kds-offline-cache`, aún
  no integrado.
- **Impresión:** el ticket offline se limita a plantillas cacheadas; la impresora física Bluetooth
  depende de `packages/printing` y hardware real (ADR-008).
- **Tarjeta:** `card_manual` solo registra evidencia para conciliación; no hay pasarela ni terminal
  integrada en Fase 3.

## 4. Checklist de prueba humana de cierre de M2

Ejecutar cuando todos los ítems de la §8.5 estén integrados y las suites de la §2 estén en verde:

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` en verde en CI.
- [ ] `pnpm --filter @super-restaurant/domain test` en verde.
- [ ] `pnpm --filter @super-restaurant/sync-engine test` en verde.
- [ ] `pnpm --filter @super-restaurant/api run test:sync-conflicts:local -- --local-disposable-only`
      en verde (con `pg-verify` de CI).
- [ ] `pnpm --filter @super-restaurant/api run verify:sync-schema:rollback` en verde.
- [ ] `pnpm --filter @super-restaurant/web e2e:offline` con aserciones reales (ya sustituido el spec
      informativo), en verde y repetido en 3 corridas nocturnas.
- [ ] Web POS: con la red cortada, menú/mesas cacheados legibles, orden local y efectivo offline
      sobreviven recarga completa; ticket muestra «Pendiente de sincronizar»; al reconectar
      sincroniza sin duplicar.
- [ ] Mobile: banner de conectividad/pendientes y cola de sync operativos; operaciones permitidas
      offline se confirman solo tras el commit local; las restringidas se bloquean con explicación.
- [ ] KDS: tickets ya recibidos visibles sin WAN con hora de última recepción; avance local
      monotónico con aviso de que otras estaciones lo verán al sincronizar; recuperación por cursor
      al reconectar.
- [ ] Dos dispositivos: líneas aditivas combinadas, edición concurrente y cancelación vs preparación
      visibles en `/app/sync` y en revisión manual, sin LWW ni doble cobro.
- [ ] UI: cero `alert`/`confirm`/`prompt`, targets ≥ 44 px, foco visible, consola limpia en escritorio
      y 390×844.
- [ ] Exclusiones confirmadas como bloqueadas: Fase 3B/LAN, tarjeta integrada, CFDI, reembolsos y
      movimientos de inventario.

## 5. Mantenimiento de este runbook

Cuando un ítem de la §8.5 de la matriz se integre, actualiza el estado correspondiente en la §8 y, si
añade un comando o cambia un límite, actualiza aquí la misma sesión (nivel D). El runbook no declara
verificado nada que no se haya ejecutado.
