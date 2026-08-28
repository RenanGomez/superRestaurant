# ADR-010 — opción A: stack propio NestJS + PostgreSQL (scaffold ejecutable)

Este directorio es un thin slice aislado para ADR-010; no es una aplicación POS, una migración de producto ni una selección de arquitectura. Usa `pg@8.23.0` y `@types/pg@8.23.1`, ambas MIT, verificadas contra npm el 2026-08-26. Redis, BullMQ y Socket.IO no se añaden: no son necesarios para evaluar este gate mínimo y añadirlos no demostraría sus propiedades.

La única base que puede tocar el runner es una PostgreSQL desechable indicada por `ADR010_DATABASE_URL`. La migración crea y el reset destruye exclusivamente el esquema `adr010_a`; aun así, el runner exige `ADR010_RUN_OPTION_A=1` para impedir ejecuciones accidentales. Nunca configure esta URL en web, mobile o KDS.

## Thin slice y propiedades que realmente implementa

`migrations/0001_adr010_a_thin_slice.sql` contiene los fixtures 2×2 del harness y las tablas mínimas de orden, línea, snapshot, auditoría, idempotencia, sesión revocable y cursor KDS. `OwnStackPostgresAdr010Adapter` implementa `Adr010Adapter` exclusivamente mediante PostgreSQL; no hay adaptador ni fallback en memoria.

La función `adr010_a.create_order` es la única mutación de orden de este slice. Dentro de la misma transacción re-lee y bloquea la sesión, comprueba restaurante/sucursal y revocación, inserta orden/líneas/snapshots/auditoría/evento KDS y fuerza rollback cuando se pide el fallo de prueba. La restricción única `(restaurant_id, branch_id, idempotency_key)` serializa reintentos concurrentes. Las lecturas y la recuperación KDS siempre reciben el scope y lo incluyen en SQL.

La clase Nest `OwnStackCriticalOrderService` representa la frontera de aplicación: recibe un principal de servidor y rechaza un scope distinto antes de delegar al adapter. El principal todavía no procede de un login/refresh real: `issueSession` persiste una sesión de prueba para que el harness pueda comprobar scope y revocación con una base real. Por tanto, este código no demuestra una implementación de Auth de producto ni debe recibir score por ese hecho.

## Frontera única de escritura

El harness siempre deja este gate pendiente de inspección humana. La afirmación verificable es:

| Entidad | Camino declarado |
| --- | --- |
| Order | `OwnStackCriticalOrderService → OwnStackPostgresAdr010Adapter.createOrder → adr010_a.create_order` |
| Payment | No se implementa en este thin slice; no existe escritura autorizada aún. |
| CashMovement | No se implementa en este thin slice; no existe escritura autorizada aún. |

El revisor debe ejecutar el comando que expone `writeFrontierInspection()` y examinar migración y adapter antes de marcar este gate. Una lista declarada por el propio adapter nunca es evidencia suficiente.

## Ejecución opt-in contra PostgreSQL

1. Copia `.env.example` a `.env` local, completa una URL de una base PostgreSQL aislada y mantén el archivo fuera de Git.
2. Carga estas variables solo en la sesión de terminal que controlará el spike.
3. Ejecuta los gates reales.

En PowerShell:

```powershell
$env:ADR010_RUN_OPTION_A = '1'
$env:ADR010_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/adr010_option_a'
pnpm --filter @super-restaurant/adr-010-spike test:option-a:gates
```

El runner aplica la migración, ejecuta todos los gates comunes y luego puede eliminar `adr010_a` durante el gate de migración/restore. No se ejecuta en CI normal. Guarde su salida, versión de PostgreSQL, URL sin contraseña, identificador de migración y resultados de fallo inducido fuera de Git, bajo `evidence/` o en el sistema de CI autorizado.

Aunque las comprobaciones PostgreSQL anteriores concluyan, el runner termina deliberadamente con estado `2` y `eligibleForAdr010Go: false`: `issueSession` es un doble de prueba, no login/refresh ni derivación de un principal autenticado. Su salida puede aportar evidencia remota para aislamiento, transacción, idempotencia, recuperación, migración y restore, pero nunca convierte A en GO ni satisface Auth o la inspección humana de frontera.

## Evidencia reproducible

Los comandos estáticos requeridos por el harness son:

```sh
pnpm install --frozen-lockfile
pnpm --filter @super-restaurant/adr-010-spike lint
pnpm --filter @super-restaurant/adr-010-spike typecheck
pnpm --filter @super-restaurant/adr-010-spike test
pnpm --filter @super-restaurant/adr-010-spike build
```

Los tests con etiqueta `[preflight/non-evidence]` comprueban configuración, tipos y texto SQL solamente. No aplican la migración, no abren PostgreSQL y no prueban aislamiento, atomicidad, concurrencia, recuperación KDS, revocación, migración ni backup/restore. No puntúan la opción A.

## Brechas deliberadas y NO-GO actual

No hay Docker, PostgreSQL ni Redis locales disponibles para esta sesión, así que no se ejecutó el runner ni se produjo evidencia de ninguno de los gates remotos. El backup del adapter es un respaldo lógico de las filas reales del esquema, adecuado para el gate del spike pero no un procedimiento de desastre de producción. Además faltan Auth/login/refresh reales, roles y políticas definitivas, una prueba de restore independiente y la inspección humana de frontera. En consecuencia A no tiene score, ni GO/NO-GO positivo, ni autorización para convertirse en infraestructura productiva.
