# Zonas de entrega V2 por colonia (SEPOMEX)

Estado: especificación Z1, pendiente de aprobación de Emmanuel (2026-11-21). No implementa código.
Base: decisiones de Emmanuel del 2026-11-20 en `docs/plans/smoke-2026-11-05-r2-plan.md` §4 y el código actual de `apps/api/src/delivery-zones.ts`, `packages/domain/src/delivery-zone.ts`, `packages/domain/src/delivery-quote.ts` y `supabase/migrations/20260927000100_delivery_zones.sql`.

## 1. Problema y límite

Hoy `DeliveryZonesService.matchAddress` (`apps/api/src/delivery-zones.ts:345`) cruza la dirección sólo por `postalCode` y `locality`. La colonia (`neighborhood`) se guarda en la ficha y en el snapshot de cumplimiento, pero ninguna zona la usa. El formulario de dirección (`apps/web/src/app/app/customers/customer-editor.tsx:357`) pide localidad, estado, país y CP aunque el operador sólo conoce la colonia.

Este corte reemplaza el eje de cobertura por **asentamiento SEPOMEX**:

- catálogo SEPOMEX únicamente de Navojoa;
- la colonia se elige con autocompletado y el CP se deriva del catálogo;
- ciudad, estado y país se derivan de la sucursal;
- la zona se define por colonias (multiselección y «todas las de un CP»);
- una colonia fuera del catálogo se acepta con aviso, queda sin zona y su envío exige cuota manual autorizada.

No cambia el flujo Order/Quote/confirmación, ni los estados financieros, ni la inmutabilidad de los snapshots. No hay geocodificación, polígonos, mapas ni rutas.

## 2. Decisiones ya tomadas (Emmanuel, 2026-11-20)

1. Catálogo sólo de Navojoa; colonia con autocompletado; CP automático; ciudad, estado y país desde la sucursal.
2. Tabla de asentamientos global, de sólo lectura para clientes, sin `restaurant_id` por ser dato público.
3. Relación zona ↔ asentamiento con alcance de restaurante y sucursal; la dirección guarda `settlementId` además del texto.
4. Coincidencia: `settlementId`; luego colonia normalizada; luego CP como respaldo legado.
5. Rechazo con motivo: «La colonia X no está en ninguna zona de la sucursal Y.», «Colonia no reconocida en Navojoa.» o «Falta la colonia.».
6. Colonia fuera de SEPOMEX: texto libre con aviso; el domicilio queda «sin zona» y el envío se cobra con cuota manual fijada por supervisor, con autorización, motivo y auditoría, antes de confirmar.
7. Backfill de direcciones existentes por nombre normalizado; las ambiguas quedan sin `settlementId` y se listan para revisión.
8. La cuota de envío y su snapshot se ajustan al nuevo modelo.

## 3. Modelo de datos

Convenciones del repo: esquema `app` sólo servidor, RLS habilitado y forzado, sin privilegios directos para `public`, `anon`, `authenticated`, `service_role` ni `app_api`; toda lectura/escritura pasa por funciones `app_private` `SECURITY DEFINER` con `search_path = ''`, dueño `postgres`, ejecutables sólo por `app_api`.

### 3.1 Catálogo global de asentamientos

```sql
create table app.settlements (
  id uuid primary key,
  postal_code text not null,
  name text not null,
  normalized_name text not null,
  settlement_type text not null,
  municipality text not null,
  state text not null,
  country_code text not null default 'MX',
  catalog_version text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint settlements_postal_code_valid check (postal_code ~ '^[0-9]{5}$'),
  constraint settlements_name_valid check (
    name = pg_catalog.btrim(name)
    and pg_catalog.char_length(name) between 1 and 200
    and name !~ '[[:cntrl:]]'
  ),
  constraint settlements_normalized_valid check (
    normalized_name = app_private.normalize_settlement_name(name)
  ),
  constraint settlements_country_valid check (country_code ~ '^[A-Z]{2}$'),
  constraint settlements_unique unique (postal_code, normalized_name, settlement_type)
);

create index settlements_name_prefix_idx
  on app.settlements (normalized_name text_pattern_ops);
create index settlements_postal_code_idx
  on app.settlements (postal_code, normalized_name);
```

- `id` es determinista: SHA-256 de `postalCode|normalizedName|settlementType` reformado a UUID (mismo patrón que `deterministicQuoteId`, `apps/api/src/delivery-zones.ts:459`). Re-sembrar el mismo CSV no crea filas nuevas.
- `normalized_name` se escribe en el seed y se valida con `app_private.normalize_settlement_name(text)` (`IMMUTABLE`). Normalización: descomposición Unicode, quitar diacríticos, minúsculas, sustituir toda corrida de caracteres no alfanuméricos por un espacio, colapsar espacios y recortar. En SQL se implementa con un mapa explícito de caracteres españoles (acentos, diéresis, `ñ`); el seed falla si un nombre no se puede normalizar igual que en TS. La misma función se usa en el backfill; una prueba de paridad TS/SQL cubre al menos 30 nombres con acentos, `ñ`, guiones y abreviaturas.
- `settlement_type` conserva el tipo SEPOMEX (colonia, fraccionamiento, unidad habitacional, etc.). La unicidad incluye el tipo porque SEPOMEX puede repetir el mismo nombre con tipos distintos en el mismo CP.
- `catalog_version` (por ejemplo `sepomex-2026-11-navojoa`) permite auditar de qué corte salió cada fila. No hay borrado lógico: el catálogo se reemplaza por versión en una migración futura si cambia la fuente.

El seed (`supabase/seed-data/navojoa-settlements.csv`, producido por Z0) es la única fuente. Z2 falla de forma explícita si el archivo no existe o si una fila no valida; no inventa colonias.

### 3.2 Sucursal: ciudad, estado y país

```sql
alter table app.branches
  add column locality text not null default 'Navojoa',
  add column region text not null default 'Sonora',
  add column country_code text not null default 'MX';

alter table app.branches
  add constraint branches_locality_valid check (
    locality = pg_catalog.btrim(locality)
    and pg_catalog.char_length(locality) between 1 and 120
    and locality !~ '[[:cntrl:]]'
  ),
  add constraint branches_region_valid check (
    region = pg_catalog.btrim(region)
    and pg_catalog.char_length(region) between 1 and 120
    and region !~ '[[:cntrl:]]'
  ),
  add constraint branches_country_valid check (country_code ~ '^[A-Z]{2}$');
```

- Estos tres campos son la identidad geográfica de la sucursal y alimentan la dirección y el mensaje de rechazo. No se guarda un CP de sucursal: el CP de entrega sale del asentamiento elegido.
- El ámbito del catálogo de una sucursal queda definido por `(branches.locality, branches.region)`: sólo se aceptan asentamientos cuyo `municipality` y `state` coincidan. Con el catálogo actual eso es Navojoa/Sonora; otra ciudad exigiría sembrar su catálogo y ajustar la sucursal.
- `app_private.read_branch_operational_context` se amplía de forma aditiva con `branchName`, `locality`, `region` y `countryCode`. `BranchOperationalContextV1` los acepta como opcionales en lectura para no romper llamadas existentes; el API los emite siempre.

### 3.3 Relación zona ↔ asentamiento

```sql
create table app.delivery_zone_settlements (
  restaurant_id uuid not null,
  branch_id uuid not null,
  zone_id uuid not null,
  settlement_id uuid not null references app.settlements (id) on delete restrict,
  constraint delivery_zone_settlements_pk
    primary key (restaurant_id, branch_id, zone_id, settlement_id),
  constraint delivery_zone_settlements_zone_fk
    foreign key (restaurant_id, branch_id, zone_id)
    references app.delivery_zones (restaurant_id, branch_id, id) on delete cascade,
  -- Una colonia sólo puede pertenecer a una zona activa de la sucursal. La tabla sólo contiene
  -- filas de zonas activas y no borradas, igual que app.delivery_zone_postal_codes.
  constraint delivery_zone_settlements_unique
    unique (restaurant_id, branch_id, settlement_id)
);

create index delivery_zone_settlements_zone_idx
  on app.delivery_zone_settlements (restaurant_id, branch_id, zone_id);
```

- Se reutiliza el patrón existente de `app.delivery_zone_postal_codes`: la tabla de pertenencia contiene exclusivamente filas de zonas activas y no borradas. `app_private.upsert_delivery_zone` la mantiene en la misma transacción y la vacía al desactivar o borrar la zona. Por eso la unicidad incondicional `(restaurant_id, branch_id, settlement_id)` es correcta y una colonia puede reasignarse después de desactivar su zona anterior.
- La pertenencia al catálogo de la sucursal se valida en `upsert_delivery_zone` (no con un CHECK cruzado): `settlement.municipality = branch.locality` y `settlement.state = branch.region`. Una colonia de otra ciudad se rechaza con `invalid_settlement`.
- `postal_codes` y `localities` de `app.delivery_zones` se conservan:
  - `postal_codes` queda como **cobertura heredada** y respaldo de coincidencia cuando la dirección no tiene `settlementId`.
  - `localities` queda obsoleta: se sigue guardando/leyendo por compatibilidad, pero **no participa en la coincidencia**. Una zona con sólo `localities` nunca coincide; el editor la marca para revisión.

### 3.4 Dirección del cliente y snapshots

```sql
alter table app.customer_addresses
  add column settlement_id uuid references app.settlements (id) on delete restrict,
  add column settlement_outside_catalog boolean not null default false,
  add constraint customer_addresses_settlement_exclusive
    check (settlement_id is null or settlement_outside_catalog = false),
  add constraint customer_addresses_outside_needs_text
    check (settlement_outside_catalog = false or neighborhood is not null);

alter table app.customer_fulfillment_snapshots
  add column settlement_id uuid references app.settlements (id) on delete restrict,
  add column settlement_outside_catalog boolean not null default false,
  add constraint customer_fulfillment_settlement_exclusive
    check (settlement_id is null or settlement_outside_catalog = false),
  add constraint customer_fulfillment_outside_needs_text
    check (settlement_outside_catalog = false or neighborhood is not null);
```

- `customer_addresses` sigue guardando el texto (`neighborhood`, `postal_code`, `locality`, `region`, `country_code`) como snapshot legible y para direcciones históricas. Cuando hay asentamiento, el servidor rellena:
  - `neighborhood = settlement.name`
  - `postal_code = settlement.postal_code`
  - `locality = branch.locality`
  - `region = branch.region`
  - `country_code = branch.country_code`
- El cliente **no** es autoridad de esos valores. La UI envía `settlementId`; el API resuelve y el SQL vuelve a verificar contra `app.settlements` y `app.branches` (una escritura directa no puede inventar CP o ciudad).
- `settlement_outside_catalog = true` significa que el operador declaró explícitamente una colonia fuera de SEPOMEX. En ese caso: `settlement_id is null`, `neighborhood` es texto libre obligatorio, `postal_code is null` (no se inventa) y la dirección queda «sin zona». La base impone `settlement_id is null or settlement_outside_catalog = false`.
- Estados posibles de una dirección:
  1. `settlement_id` no nulo: resuelta por catálogo.
  2. `settlement_id` nulo y `settlement_outside_catalog = true`: fuera de catálogo aceptada.
  3. `settlement_id` nulo y `settlement_outside_catalog = false`: legado o pendiente de revisión; se intenta resolver por nombre/CP al cotizar.
- `customer_fulfillment_snapshots` es inmutable. Las columnas nuevas se llenan al crear el snapshot; **no se reescriben snapshots históricos** en el backfill. Un snapshot viejo sin `settlement_id` sigue funcionando por la vía legada de nombre/CP; al revalidar la dirección se genera un snapshot nuevo con el asentamiento.
- El snapshot congelado de la orden (`order_fulfillment_snapshots.snapshot.fulfillmentSnapshot`) añade `settlementId` y `settlementOutsideCatalog` de forma aditiva. No cambia `schemaVersion` del snapshot: los snapshots viejos no traen las claves y se leen como `null`/`false`.

### 3.5 Cuota manual de envío (autorización, motivo y auditoría)

La cuota manual no es una zona: es una autorización excepcional, versionada e idempotente para un borrador y un snapshot de dirección concretos.

```sql
create table app.capture_delivery_manual_fees (
  restaurant_id uuid not null,
  branch_id uuid not null,
  capture_draft_id uuid not null,
  address_snapshot_ref uuid not null,
  version bigint not null default 1,
  authorization_event_id uuid not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  actor_membership_id uuid not null,
  device_id uuid not null,
  fee_minor bigint not null,
  currency_code text not null,
  reason text not null,
  role_code text not null,
  authorized_at timestamptz not null,
  received_at timestamptz not null default pg_catalog.clock_timestamp(),
  idempotency_key uuid not null,
  command_fingerprint text not null,
  constraint capture_delivery_manual_fees_pk
    primary key (restaurant_id, branch_id, capture_draft_id, address_snapshot_ref),
  constraint capture_delivery_manual_fees_capture_fk
    foreign key (restaurant_id, branch_id, capture_draft_id)
    references app.capture_drafts (restaurant_id, branch_id, id) on delete restrict,
  constraint capture_delivery_manual_fees_snapshot_fk
    foreign key (restaurant_id, branch_id, address_snapshot_ref)
    references app.customer_fulfillment_snapshots (restaurant_id, branch_id, id) on delete restrict,
  constraint capture_delivery_manual_fees_membership_fk
    foreign key (restaurant_id, branch_id, actor_membership_id, actor_id)
    references app.memberships (restaurant_id, branch_id, id, user_id) on delete restrict,
  constraint capture_delivery_manual_fees_event_unique unique (authorization_event_id),
  constraint capture_delivery_manual_fees_idempotency_unique
    unique (actor_id, restaurant_id, branch_id, idempotency_key),
  constraint capture_delivery_manual_fees_fee_valid
    check (fee_minor between 0 and 9007199254740991),
  constraint capture_delivery_manual_fees_currency_valid
    check (currency_code ~ '^[A-Z]{3}$'),
  constraint capture_delivery_manual_fees_reason_valid check (
    reason = pg_catalog.btrim(reason)
    and pg_catalog.char_length(reason) between 1 and 500
    and reason !~ '[[:cntrl:]]'
  ),
  constraint capture_delivery_manual_fees_role_valid
    check (role_code in ('owner','admin','manager','supervisor')),
  constraint capture_delivery_manual_fees_version_valid
    check (version between 1 and 9007199254740991),
  constraint capture_delivery_manual_fees_timestamp_valid
    check (received_at >= authorized_at)
);
```

Además, un journal append-only `app.capture_delivery_manual_fee_events` (mismo patrón que `app.delivery_zone_command_events`) guarda cada comando aceptado: `event_id`, scope, borrador, snapshot, actor, membership, dispositivo, operación (`manual_fee.authorized` | `manual_fee.updated` | `manual_fee.revoked`), `expected_version`, `result_version`, importe, moneda, motivo, rol, `authorized_at`, `received_at`, `idempotency_key` y `command_fingerprint`. La fila actual (`capture_delivery_manual_fees`) es la autorización vigente; el journal es la auditoría.

Reglas de la autorización:

- Sólo `deliveries.manage` (owner, admin, manager, supervisor) puede fijarla; el supervisor es el mínimo, no el único. `cashier`/`waiter` no. El servidor verifica membresía activa, sucursal habilitada y restaurante habilitado; el cliente no decide permisos. `role_code` guarda el rol efectivo más alto del actor en esa sucursal (para auditoría), nunca un rol enviado por el cliente.
- Sólo se autoriza una dirección **resuelta** (con `settlementId` o `settlement_outside_catalog = true`) y **sin zona** (`not_covered`). Si la dirección ya está cubierta, se rechaza con `already_covered`; una corrección de tarifa sobre una zona cubierta es otro caso de negocio (override de precio), no esta cuota manual.
- `feeMinor` es entero en unidad menor, `>= 0` y en la moneda del restaurante. `reason` es obligatorio (1..500 caracteres). No hay doble aprobación: la autorización es del actor con `deliveries.manage`, y queda auditada con actor, membership, dispositivo, motivo e instantes.
- `expectedVersion` (0 en la primera) da CAS; la clave de idempotencia `(actor, restaurante, sucursal, idempotencyKey)` con fingerprint del comando completo evita duplicados. Un reintento idéntico devuelve el mismo resultado (`replayed: true`); la misma clave con otro contenido devuelve `conflict`.
- La autorización se invalida (se borra la fila actual y se registra `manual_fee.revoked` con motivo de sistema) cuando:
  - cambia el snapshot de dirección del borrador (incluye cambio de colonia);
  - el borrador deja de ser `delivery` o deja de ser borrador;
  - el borrador se confirma.
- Congelar la cuota: al autorizar, se borran la cotización congelada y el intento de pago del borrador (`capture_delivery_quotes`, `capture_payment_intents`) para forzar una recotización con la nueva autorización. El mismo tratamiento que ya existe cuando cambia la dirección.

### 3.6 Compatibilidad y versionado

- **No se sube `schemaVersion` de `delivery-zones` ni de `DeliveryQuoteV1`.** El cambio es aditivo y compatible en lectura:
  - `DeliveryZoneV1.settlementIds` es nuevo; los `result_zone` históricos del journal no lo traen y el parser lo normaliza a `[]`.
  - `DeliveryAddressFactsV1` añade `settlementId` y `neighborhood` opcionales; `locality` pasa a opcional/ignorada para coincidencia. Los emisores viejos siguen siendo válidos.
  - `DeliveryQuoteV1.address` gana `settlementId`/`neighborhood` opcionales; las cotizaciones históricas siguen parseando.
  - `override` cambia de forma, pero hoy **ningún camino del API produce `override` no nulo** (`quoteForCapture` siempre devuelve `override: null`); no hay datos persistidos que migrar.
- Los snapshots de orden (`order_fulfillment_snapshots`) y el agregado de orden no cambian de versión: las claves nuevas son opcionales y los datos viejos se leen con `null`/`false`.
- Si una revisión futura prefiere contratos V2 explícitos, este documento sirve de base; no es necesario para Z2-Z5.

## 4. RLS y permisos

### 4.1 Por qué `app.settlements` no tiene `restaurant_id` y aun así lleva RLS

- Es un catálogo público y único de la ciudad: la misma colonia, CP y tipo son idénticos para todos los restaurantes. Añadir `restaurant_id` duplicaría filas, daría IDs distintos a la misma colonia y rompería la normalización, el backfill y la reasignación de colonias entre zonas.
- No contiene datos personales ni datos de un tenant. El aislamiento vive en `app.delivery_zone_settlements` y en `app.customer_addresses`, que sí llevan `restaurant_id`/`branch_id`.
- RLS se habilita y se fuerza por defensa en profundidad: evita que un futuro acceso directo a la Data API lea o escriba el catálogo por accidente, y obliga a que toda lectura pase por una función `app_private` autorizada. No es una frontera de tenant porque la tabla no tiene tenants; es una frontera de **escritura y exposición**.
- Política concreta: cero grants a `public`, `anon`, `authenticated`, `service_role` y `app_api`; sin políticas de escritura. Lectura sólo mediante `app_private.search_settlements` (SECURITY DEFINER, `search_path = ''`, dueño `postgres`, grant ejecutable sólo a `app_api`). El API reautoriza `captures.read` o `customers.read` antes de llamarla.
- Si en el futuro se aprueba lectura directa de la Data API, se añadiría una política **sólo SELECT** para `authenticated` (y `anon` si se decide público), nunca INSERT/UPDATE/DELETE. No requiere predicado de tenant. Esa decisión no forma parte de Z2.

### 4.2 Matriz de permisos

| Acción | Permiso / roles | Verificación adicional |
|---|---|---|
| Buscar asentamientos (autocompletado) | `captures.read` o `customers.read` | membresía activa en la sucursal; catálogo global |
| Ver zonas | `captures.read` (cualquier rol operativo) | scope restaurante/sucursal |
| Crear/editar/desactivar zonas | `delivery_zones.manage` (owner, admin, manager) | CAS por versión, idempotencia, asentamiento en catálogo de la sucursal |
| Fijar cuota manual | `deliveries.manage` (owner, admin, manager, supervisor) | dirección sin zona y snapshot vigente; motivo; auditoría |
| Cotizar/confirmar entrega | `captures.read` / `captures.update` | la confirmación exige cotización vigente y, si no hay zona, autorización vigente |
| Revisar backfill ambiguo | `delivery_zones.manage` o consulta de runbook | lectura agregada, sin mutar snapshots |

Ningún cliente calcula dinero ni decide permisos. El servidor revalida todo.

## 5. Reglas de coincidencia

La precedencia es de **identificación**, no una cadena de reintentos: si una colonia está identificada y no tiene zona, **no** se cae al CP.

1. **`settlementId` presente** (dirección resuelta):
   - buscar la zona activa de la sucursal que contiene ese `settlementId` en `delivery_zone_settlements`;
   - si existe → `covered`, `matchedBy = "settlement"`;
   - si no existe → `not_covered`, `reason.code = "settlement_not_in_zone"`. No se prueba nombre ni CP.
2. **Sin `settlementId`, con `neighborhood`** (dirección legada o capturada sin selector):
   - normalizar el nombre;
   - resolver contra el catálogo de la sucursal (`municipality = branch.locality`, `state = branch.region`):
     - 1 candidato → tratar como ese `settlementId` y aplicar el paso 1;
     - 0 candidatos → `not_covered`, `reason.code = "settlement_unknown"`;
     - >1 candidatos y `postalCode` presente → filtrar por CP; si queda 1, aplicar el paso 1; si no, `settlement_ambiguous`;
     - >1 candidatos sin CP → `settlement_ambiguous`.
3. **Sin `settlementId` y sin resolución por nombre, con `postalCode`**:
   - buscar zona activa por `postal_codes` (cobertura heredada);
   - si existe → `covered`, `matchedBy = "postal_code"`, `reason.code = "legacy_postal_code_match"` (advertencia, no rechazo);
   - si no → `not_covered`, `reason.code = "settlement_not_in_zone"` si el nombre era reconocible pero ambiguo/CP distinto; `settlement_unknown` si el nombre no existe.
4. **Sin `settlementId`, sin `neighborhood` y sin `postalCode`** → `not_covered`, `reason.code = "settlement_missing"`.
5. **Colonia declarada fuera de catálogo** (`settlementOutsideCatalog = true`, `settlementId = null`, `postalCode = null`) → `not_covered`, `reason.code = "settlement_outside_catalog"`; exige cuota manual para confirmar.

La resolución por nombre/CP ocurre en el servidor (SQL/API), no en el dominio puro: el dominio recibe un `settlementId` ya resuelto o los hechos legados. Esto evita duplicar normalización en cada cliente y mantiene `packages/domain` sin acceso a base de datos.

### 5.1 Mensajes exactos

El servidor compone el mensaje; la UI lo muestra tal cual, sin concatenar ni reinterpretar.

| Código | Mensaje |
|---|---|
| `settlement_missing` | «Falta la colonia.» |
| `settlement_unknown` | «Colonia no reconocida en Navojoa.» |
| `settlement_ambiguous` | «La colonia X coincide con varias colonias de Navojoa. Elige una del catálogo.» |
| `settlement_not_in_zone` | «La colonia X no está en ninguna zona de la sucursal Y.» |
| `settlement_outside_catalog` | «La colonia X no está en el catálogo de Navojoa. El envío requiere cuota manual de un supervisor.» |
| `legacy_postal_code_match` | «No se reconoció la colonia; se usó el código postal como respaldo. Actualiza la dirección.» |

`X` es el nombre del asentamiento (o el texto normalizado si no existe); `Y` es `branches.name`. Los textos se escapan/recortan y no admiten caracteres de control. La sucursal y el catálogo son la autoridad del mensaje; el cliente no inventa «Navojoa».

## 6. Contrato de API

Base actual: `POST /api/v1/delivery-zones/{list|upsert|quote|match}`. Se añaden `settlements/search` y `manual-fee`. Todos los cuerpos llevan `schemaVersion: 1` y `scope` con `restaurantId`/`branchId`; el servidor autoriza el scope, nunca confía en el cliente.

### 6.1 Búsqueda por prefijo para autocompletado

`POST /api/v1/delivery-zones/settlements/search`

```ts
interface SettlementSearchRequestV1 {
  readonly schemaVersion: 1;
  readonly scope: DeliveryZoneBranchScopeV1;
  readonly query: string | null;      // prefijo de colonia; exactamente uno de query/postalCode
  readonly postalCode: string | null; // 5 dígitos; devuelve todas las colonias de ese CP
  readonly limit: number;             // 1..50; por defecto 20
}

interface SettlementSearchResultV1 {
  readonly schemaVersion: 1;
  readonly scope: DeliveryZoneBranchScopeV1;
  readonly branch: {
    readonly name: string;
    readonly locality: string;
    readonly region: string;
    readonly countryCode: string;
  };
  readonly settlements: readonly {
    readonly settlementId: string;
    readonly name: string;
    readonly postalCode: string;
    readonly settlementType: string;
    readonly municipality: string;
    readonly state: string;
    readonly countryCode: string;
  }[];
}
```

- `query` se normaliza con la misma función que el catálogo; longitud 2..40; `LIKE normalized_name || '%'` con el índice `text_pattern_ops`. Orden: coincidencia exacta, luego alfabético, luego CP. `limit` acota.
- `postalCode` exige `^[0-9]{5}$` y devuelve todas las colonias de ese CP; es la base de «seleccionar todas las de un CP».
- Devuelve sólo asentamientos del ámbito de la sucursal (`branch.locality`/`branch.region`). Nunca devuelve importes, zonas ni datos de otros restaurantes.
- Respuesta vacía es válida (`settlements: []`); la UI muestra «Sin coincidencias» y ofrece el flujo de colonia fuera de catálogo.
- Rate limit: se aplica el límite general del API; si no existe uno específico, se documenta como pendiente y se acota por `limit`/longitud. La UI hace debounce de 500 ms.

### 6.2 Validación de dirección (`match`)

Se extiende `POST /api/v1/delivery-zones/match` sin cambiar la ruta.

```ts
interface DeliveryAddressFactsV1 {
  readonly settlementId: string | null;
  readonly neighborhood: string | null;
  readonly postalCode: string | null;
  readonly locality: string | null; // legado/visual; no participa en la coincidencia
}

interface DeliveryZoneMatchResultV1 {
  // ...campos actuales...
  readonly reason: { readonly code: DeliveryMatchReasonCode; readonly message: string } | null;
  readonly matchedBy: "settlement" | "neighborhood" | "postal_code" | null;
  readonly settlement: {
    readonly settlementId: string;
    readonly name: string;
    readonly postalCode: string;
  } | null;
}
```

- `coverageStatus = "not_covered"` sigue exigiendo `zoneId = null`, `feeMinor = 0`. La cuota manual no se mezcla con `feeMinor`.
- Un `not_covered` en `match` es informativo: no impide confirmar si existe una cuota manual vigente para el borrador. La UI debe leer la cotización (`quote`) para saber si ya hay autorización y mostrar la cuota efectiva; `match` sólo explica el motivo.
- La lectura es informativa y no persiste nada, igual que hoy. La cotización vinculante sigue siendo `quote` sobre el borrador.
- Autorización: `captures.read` o `customers.read`, como hoy.
- `reason` se emite siempre (objeto o `null`); los clientes viejos que no lo esperan se actualizan en el mismo despliegue. No hay datos persistidos de `match`.

### 6.3 Cuota manual

`POST /api/v1/delivery-zones/manual-fee`

```ts
interface SetCaptureDeliveryManualFeeCommandV1 {
  readonly schemaVersion: 1;
  readonly scope: DeliveryZoneBranchScopeV1;
  readonly captureDraftId: string;
  readonly addressSnapshotRef: string;
  readonly expectedVersion: number; // 0 en la primera autorización
  readonly feeMinor: number;
  readonly currency: string;
  readonly reason: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly deviceId: string;
  readonly occurredAt: string;
}

interface SetCaptureDeliveryManualFeeResultV1 {
  readonly schemaVersion: 1;
  readonly manualFee: {
    readonly eventId: string;
    readonly captureDraftId: string;
    readonly addressSnapshotRef: string;
    readonly feeMinor: number;
    readonly currency: string;
    readonly reason: string;
    readonly role: "owner" | "admin" | "manager" | "supervisor";
    readonly actorId: string;
    readonly authorizedAt: string;
    readonly version: number;
  };
  readonly replayed: boolean;
}
```

Errores de aplicación (mapeados a HTTP, mismo patrón que el resto del API):

| Código | HTTP | Cuándo |
|---|---|---|
| `request` | 400 | forma inválida, importe/moneda/motivo inválidos |
| `authorization` | 403 | sin `deliveries.manage`, membresía inactiva o scope ajeno |
| `conflict` | 409 | `already_covered`, snapshot/borrador cambiado, versión o idempotencia en conflicto |
| `missing` | 404 | borrador o snapshot inexistente en el scope |
| `unavailable` | 503 | dependencia no disponible |

- El servidor lee el workspace del borrador y su snapshot actual; `addressSnapshotRef` debe coincidir. Si el snapshot cambió, `conflict` y la UI debe recotizar.
- Antes de autorizar, el servidor ejecuta la misma resolución/coincidencia de §5 sobre el snapshot. Sólo `not_covered` con dirección resuelta es elegible. `settlement_missing`, `settlement_unknown` o `settlement_ambiguous` se rechazan como `request` (la dirección debe resolverse primero); `settlement_outside_catalog` y `settlement_not_in_zone` son elegibles.
- El importe autorizado no se copia al cliente como verdad: la cotización (`quote`) vuelve a leer la autorización y la aplica; la confirmación vuelve a validarla contra la tabla.

### 6.4 Cotización y confirmación

`POST /api/v1/delivery-zones/quote` no cambia de ruta ni de comando. `quoteForCapture`:

1. lee el workspace y el snapshot de dirección (incluye `settlementId`, `neighborhood`, `postalCode`);
2. resuelve/coincide según §5;
3. calcula `quoteDelivery` como hoy (`coverageStatus`, `zoneId`, `feeMinor`);
4. lee la autorización manual vigente para `(restaurantId, branchId, captureDraftId, addressSnapshotRef)`;
5. si existe, aplica la cuota manual y devuelve la cotización con `override` no nulo.

```ts
interface DeliveryQuoteOverrideV1 {
  readonly kind: "manual_fee";
  readonly eventId: string;
  readonly actorId: string;
  readonly role: "owner" | "admin" | "manager" | "supervisor";
  readonly reason: string;
  readonly feeMinor: number;
  readonly promiseStart: string;
  readonly promiseEnd: string;
  readonly overriddenAt: string; // instante de la autorización, no de la recotización
}
```

- `quote.feeMinor` sigue siendo la cuota de zona (0 si no hay zona). La **cuota efectiva** es `override?.feeMinor ?? feeMinor`. `formatDeliveryQuote` ya usa esa precedencia (`apps/web/src/lib/delivery-zones.ts:37`).
- `overriddenAt` es estable (instante de la autorización), de modo que recotizar sin cambios produce el mismo `quoteId`. El cálculo de `quoteId` (`apps/api/src/delivery-zones.ts:300`) usa `deterministicQuoteId` e incluye `override` (eventId, feeMinor, role, actorId, reason, overriddenAt) además de los hechos actuales; cualquier cambio de cuota, motivo o autorización cambia el `quoteId`.
- La cotización se congela en `app.capture_delivery_quotes.quote` con el `override`. El check de forma actual no inspecciona las claves internas de `address` ni de `override`, así que no hay migración de forma; sólo se amplía el parser.
- **Confirmación** (`app_private.confirm_capture_draft_v3`):
  - permite `not_covered` **sólo** si `frozen_quote->'override'` es una cuota manual y coincide con la fila vigente de `capture_delivery_manual_fees` (eventId, feeMinor, actor, rol, motivo, `authorizedAt`, snapshot);
  - si no hay autorización vigente → `conflict` con `delivery_quote_not_covered`;
  - si la autorización no coincide → `conflict` con `delivery_manual_fee_stale`;
  - el importe de `deliveryCharge` se compara contra la **cuota efectiva**, no contra `feeMinor` (hoy compara `frozen_quote->>'feeMinor'` en `20261001000100_capture_payment_intent.sql:1007`);
  - la cotización debe seguir vigente (`expiresAt > clock_timestamp()`), sin cambios.
- Si el API recibe `delivery_quote_not_covered` al confirmar, lo traduce a un error de aplicación `manual_fee_required` (HTTP 409) con el `reason.message` de §5.1; la UI muestra el motivo y el botón «Solicitar cuota manual» sólo si el actor tiene `deliveries.manage`. Si no lo tiene, indica «Pide a un supervisor» y no permite confirmar. El cliente nunca simula la autorización.

### 6.5 Zonas: listado y upsert

`POST /api/v1/delivery-zones/upsert` añade `settlementIds` al comando y a la zona devuelta.

```ts
interface UpsertDeliveryZoneCommandV1 {
  // ...campos actuales (name, postalCodes, localities, feeMinor, currency, active, reason...)...
  readonly settlementIds: readonly string[]; // nuevo; [] en clientes viejos
}

interface DeliveryZoneV1 {
  // ...campos actuales...
  readonly settlementIds: readonly string[];
}
```

- Al menos uno de `settlementIds` o `postalCodes` debe ser no vacío. `localities` se acepta pero no cuenta para la validez ni para la coincidencia.
- Cada `settlementId` debe existir y pertenecer al catálogo de la sucursal (`municipality = branch.locality`, `state = branch.region`). IDs duplicados se deduplican; IDs de otra ciudad o inexistentes → `request`/`invalid_settlement`.
- Un asentamiento ya reclamado por otra zona activa de la sucursal → `conflict`. La pertenencia se mantiene en `delivery_zone_settlements`; al desactivar/borrar la zona se liberan las colonias.
- `expectedVersion`, `eventId`, `idempotencyKey`, fingerprint y `reason` al desactivar se conservan exactamente como hoy.
- El API normaliza `settlementIds` a `[]` cuando el comando viejo no lo trae y siempre envía la clave a SQL; el SQL exige la forma nueva. Esto permite que un cliente viejo siga guardando durante el despliegue sin tocar el esquema.
- `list` devuelve `settlementIds` (array vacío en zonas heredadas) y sigue devolviendo `postalCodes`/`localities` para la UI. El `result_zone` del journal guarda la forma nueva; los eventos viejos se leen con `settlementIds = []`.
- «Todas las de un CP» lo resuelve la UI con `settlements/search?postalCode=...` y envía la lista de IDs; el servidor no recibe una instrucción «todas» que pudiera cambiar de significado si el catálogo se actualiza.

### 6.6 Ficha de cliente y dirección

- `CustomerAddressFieldsV1` añade `settlementId: string | null` y `settlementOutsideCatalog: boolean` (opcionales en lectura; por defecto `null`/`false`).
- Guardar una dirección con `settlementId`:
  - el API resuelve el asentamiento, valida que sea del catálogo de la sucursal y rellena `neighborhood`, `postalCode`, `locality`, `region`, `countryCode`;
  - el SQL vuelve a verificar que `neighborhood`/`postalCode` correspondan al asentamiento (defensa contra escritores que no pasen por el API);
  - `settlementOutsideCatalog` debe ser `false`.
- Guardar una dirección fuera de catálogo:
  - requiere `settlementOutsideCatalog: true`, `neighborhood` no vacío y confirmación explícita en la UI (checkbox/modal propio, nunca `alert/confirm/prompt`);
  - `settlementId = null`, `postalCode = null`; el servidor rellena ciudad/estado/país desde la sucursal;
  - la respuesta incluye el aviso «Colonia fuera del catálogo. El envío requiere cuota manual de un supervisor.» y la UI lo muestra.
- `validateCustomerAddressForBranch` registra el `settlementId` en el snapshot. Validar una dirección fuera de catálogo es válido, pero deja constancia de que no tiene zona.
- Las direcciones históricas sin `settlementId` siguen editables; al guardar se les exige elegir colonia (o declararla fuera de catálogo). No se reescriben solas.

## 7. Backfill

### 7.1 Asentamientos

El insumo crudo de Z0 ya está en `data/sepomex/colonias.csv`: 567 filas más encabezado, con tres columnas (`Asentamiento/Colonia`, `Código Postal`, `Tipo de Asentamiento`). El artefacto normalizado `supabase/seed-data/navojoa-settlements.csv` (con `id`, `name`, `normalized_name`, `municipality`, `state`, `country_code`, `catalog_version`) **todavía no existe**; lo debe generar Z0 con `tools/sepomex/extract-navojoa.ts`. Z2 inserta las filas del artefacto normalizado y valida el conteo; si el archivo falta, la migración falla con un mensaje explícito. No se inventan municipio/estado: se fijan a Navojoa/Sonora en el extractor a partir del alcance de la descarga.

### 7.2 Zonas con cobertura por CP

Para cada zona activa y no borrada con `postal_codes` no vacío:

1. expandir cada CP a sus asentamientos del catálogo de la sucursal;
2. insertar en `delivery_zone_settlements` las filas que no estén ya reclamadas por otra zona activa;
3. conservar `postal_codes` como cobertura heredada;
4. reportar los CP sin asentamientos en el catálogo y las colonias en conflicto para revisión.

Las zonas con sólo `localities` no se borran ni se desactivan en la migración; se reportan y el editor obliga a añadir colonias antes de volver a guardarlas. No se inventa cobertura.

### 7.3 Direcciones existentes

Sólo se backfillean direcciones **actuales** (`app.customer_addresses`, `deleted_at is null`, `settlement_id is null`, `neighborhood` no vacío). No se tocan `customer_fulfillment_snapshots` ni órdenes: son inmutables.

Algoritmo (idempotente):

1. normalizar `neighborhood`;
2. candidatos = asentamientos del catálogo de la sucursal con `normalized_name` igual;
3. si hay 1 candidato:
   - si `postal_code` es nulo o coincide con el del candidato → asignar `settlement_id` y, si era nulo, rellenar `postal_code`;
   - si `postal_code` difiere → dejar sin `settlement_id` y listar como `postal_code_mismatch`;
4. si hay >1 candidatos y `postal_code` no nulo → filtrar por CP; si queda 1, asignar; si no, ambiguo;
5. si hay 0 candidatos → desconocido;
6. ambiguos y desconocidos quedan con `settlement_id` nulo y se listan para revisión.

Consulta de revisión (runbook; no muta datos):

```sql
select a.restaurant_id, a.customer_id, a.id as address_id,
       a.neighborhood, a.postal_code,
       count(s.id) as candidates,
       jsonb_agg(jsonb_build_object(
         'settlementId', s.id, 'name', s.name, 'postalCode', s.postal_code
       ) order by s.name) filter (where s.id is not null) as candidate_settlements
from app.customer_addresses a
left join app.settlements s
  on s.normalized_name = app_private.normalize_settlement_name(a.neighborhood)
 and s.municipality = 'Navojoa'
 and s.state = 'Sonora'
where a.deleted_at is null
  and a.settlement_id is null
  and a.neighborhood is not null
group by a.restaurant_id, a.customer_id, a.id, a.neighborhood, a.postal_code
having count(s.id) <> 1;
```

La consulta exacta se ajusta en Z2 al esquema final. Para el catálogo de esta fase el ámbito es literal (`Navojoa`/`Sonora`); cuando exista más de una ciudad, el filtro se parametriza con la ciudad/estado de la sucursal que se revisa. La dirección no guarda `branch_id`, así que el informe de Z2 se emite por restaurante y sucursal revisada. Incluye conteos: resueltas, ambiguas, desconocidas y con CP discrepante.

## 8. Impacto en dominio, cuotas y snapshots

### 8.1 Dominio puro

- `DeliveryZone` añade `settlementIds: ReadonlySet<string>`. `postalCodes` se conserva; `localities` se conserva pero `findDeliveryZone` ya no la usa.
- `DeliveryAddressFacts` pasa a `{ settlementId: string | null; neighborhood: string | null; postalCode: string | null; locality: string | null }`. La normalización/resolución de nombre no vive en el dominio; el dominio sólo compara IDs y CP.
- `findDeliveryZone` implementa la precedencia de §5. Un `settlementId` conocido sin zona devuelve `undefined` y **no** cae al CP.
- `createDeliveryZone` exige al menos un `settlementId` o un `postalCode`; una zona sólo con `localities` se acepta por compatibilidad de forma pero nunca coincide (y el editor la marca).
- `quoteDelivery` no cambia de algoritmo: sin zona, `coverageStatus = "not_covered"` y `feeMinor = 0`.
- `applyDeliveryQuoteOverride` se sustituye por `applyDeliveryManualFee` (o se renombra y restringe): exige `coverageStatus === "not_covered"`, rol `owner|admin|manager|supervisor`, motivo no vacío, importe `>= 0`, ventana válida y `overriddenAt` de la autorización. No muta `feeMinor`/ventana originales; devuelve una copia con `override`.
- Helper `deliveryQuoteEffectiveFeeMinor(quote)` (o equivalente) centraliza `override?.feeMinor ?? feeMinor`; UI, API y reportes lo usan.

### 8.2 Cuota de envío y snapshots

- **Cotización del borrador**: `capture_delivery_quotes.quote` incluye `override`; el `quoteId` determinista incorpora la autorización. Cambiar la cuota, el motivo o la autorización invalida la cotización anterior.
- **Intento de pago**: `capture_payment_intents.deliveryFeeMinor` usa la cuota efectiva; el fingerprint de líneas + cuota ya detecta staleness. Autorizar o revocar una cuota manual borra cotización e intento para forzar recotización.
- **Orden confirmada**: el agregado guarda `deliveryCharge: { amount, quoteId, manualFee }`.
  - `amount.amountMinor` = cuota efectiva.
  - `quoteId` = cotización congelada.
  - `manualFee` = `{ eventId, actorId, role, reason, authorizedAt }` o `null`.
  - `DeliveryChargeSnapshot` (`packages/domain/src/order.ts:65`) añade `manualFee` opcional; los pedidos históricos se leen con `null`.
  - El check SQL del charge (`capture_payment_intent.sql:1003`) se amplía para aceptar la clave opcional `manualFee` y comparar contra la cuota efectiva.
- **Snapshot de cumplimiento de la orden**: añade `settlementId` y `settlementOutsideCatalog`; la dirección congelada sigue siendo el texto del snapshot inmutable.
- **Resumen del día**: `deliveryFees` sigue siendo la suma de `deliveryCharge` de las órdenes pagadas; ahora incluye cuotas manuales. Si se necesita separarlas, el snapshot `manualFee` permite un desglose aditivo; no es requisito para cerrar Z2.
- **Histórico**: no se recalculan ventas ni se reescriben órdenes. Una orden vieja conserva su cuota y su snapshot; una nueva usa el modelo V2.

## 9. Pruebas obligatorias

### 9.1 Dominio (unitarias)

- Precedencia: `settlementId` cubierto; `settlementId` conocido sin zona → `not_covered` aunque un CP legado coincida; nombre único → resuelto; nombre ambiguo con CP que desambigua; ambiguo sin CP; nombre desconocido; sin datos → `settlement_missing`.
- `settlementOutsideCatalog` → `not_covered` y elegible para cuota manual.
- `createDeliveryZone`: deduplica `settlementIds`, exige asentamiento o CP, una zona sólo con `localities` no coincide.
- `applyDeliveryManualFee`: rechaza `covered`; acepta owner/admin/manager/supervisor; rechaza cashier/waiter; motivo obligatorio; importe negativo/float; ventana inválida; no muta la cuota base; `overriddenAt` estable.
- `deliveryQuoteEffectiveFeeMinor` con y sin override.
- `deterministicQuoteId` cambia si cambia cualquier hecho del override.

### 9.2 SQL (rollback-only, `supabase/tests/`)

- Catálogo: `app.settlements` no tiene `restaurant_id`; `normalized_name = normalize(name)`; unicidad `(postal_code, normalized_name, settlement_type)`; CP de 5 dígitos; RLS+FORCE y cero grants.
- Zonas: una colonia no puede estar en dos zonas activas de la misma sucursal; desactivar/borrar libera; reasignar después funciona; otra sucursal/restaurante puede usar la misma colonia; asentamiento de otra ciudad se rechaza; dos zonas con el mismo CP siguen en conflicto como hoy.
- Dirección/snapshot: `settlement_id` sólo del catálogo de la sucursal; `settlement_outside_catalog` exige `neighborhood` y prohíbe `settlement_id`; el CP/ciudad/estado/país guardados coinciden con el catálogo/sucursal.
- Cuota manual: matriz de roles (supervisor sí, cashier no); sólo `not_covered`; snapshot/borrador vigente; motivo; importe; CAS; idempotencia (replay idéntico, mismo key con otro contenido = conflicto); journal append-only; revocación al cambiar snapshot/canal/estado.
- Confirmación: `not_covered` sin autorización → `delivery_quote_not_covered`; autorización vieja/cambiada → `delivery_manual_fee_stale`; `deliveryCharge` distinto de la cuota efectiva → `delivery_charge_mismatch`; `covered` con override no autorizado se rechaza.
- Aislamiento: un actor de otro restaurante/sucursal no puede listar, editar, autorizar ni confirmar; el catálogo global no filtra datos de tenant; el backfill sólo toca direcciones del scope revisado.
- Backfill: fixture con exacto, acentuado, ambiguo, CP discrepante y desconocido produce los IDs/revisión esperados; re-ejecutar no cambia filas; snapshots y órdenes no se tocan.

### 9.3 API (contract tests)

- `settlements/search`: prefijo, CP, límite, query corta, scope ajeno, sin resultados, orden; no expone importes.
- `match`: cada código/mensaje exacto; nombre de sucursal interpolado; `feeMinor = 0` en `not_covered`; `matchedBy`; `reason = null` en cubierto.
- `manual-fee`: supervisor/manager/owner/admin aceptados; cashier/waiter 403; dirección cubierta 409 `already_covered`; snapshot viejo 409; replay idéntico; misma key con otro payload 409; importe/moneda/motivo inválidos 400.
- `quote`: devuelve `override` con la cuota autorizada; cuota efectiva; `quoteId` distinto si cambia la autorización; `feeMinor` base sigue 0 en `not_covered`.
- `upsert/list`: `settlementIds` viaja y vuelve; duplicados deduplicados; colonia reclamada en otra zona 409; colonia de otra ciudad 400; eventos viejos con `settlementIds = []` siguen parseando.
- Confirmación: pedido con cuota manual congela `manualFee` en `deliveryCharge`; el total (subtotal + envío + propina) cuadra; el intento de pago usa la cuota efectiva.

### 9.4 E2E y verificación visual

- Flujo completo en navegador real: ficha con colonia del catálogo → validar → captura → cotizar → confirmar; el envío cobrado coincide con la zona.
- Flujo fuera de catálogo: aviso + confirmación en UI → dirección sin zona → cotizar devuelve motivo → supervisor fija cuota manual → recotizar → confirmar; el pedido guarda la cuota y el motivo.
- Rechazos: cajero intenta cuota manual (sin botón y 403 en API), colonia de otra ciudad, CP legado con advertencia, dirección sin colonia.
- 390×844 y escritorio: autocompletado con debounce 500 ms, CP de sólo lectura, targets de 44 px, sin `alert/confirm/prompt`, consola limpia, mensajes del servidor mostrados tal cual.
- Gate global del repo (Node 24): `pnpm turbo run lint typecheck test build --force`.

## 10. Orden de tareas Z2-Z5

Dependencias: Z0 (CSV SEPOMEX) y Z1 (este documento) antes de Z2; Z2 antes de Z3; Z3 antes de Z4 y Z5; Z5 después de K4 (carril Clientes) y de Z3.

### Z2 · `delivery-zones-settlements-sql` (nivel A)

1. Migración nueva (nunca editar `20260927000100_delivery_zones.sql` ya aplicada):
   - `app.settlements` + seed + índices + `normalize_settlement_name`;
   - columnas de sucursal;
   - `app.delivery_zone_settlements`;
   - columnas `settlement_id`/`settlement_outside_catalog` en direcciones y snapshots;
   - `capture_delivery_manual_fees` + journal + funciones/triggers;
   - `delivery_zone_to_jsonb`, `list_delivery_zones`, `list_active_delivery_zones_for_quote` y `upsert_delivery_zone` con `settlementIds`;
   - `search_settlements` (prefijo/CP), `set_capture_delivery_manual_fee` y `read_capture_delivery_manual_fee`;
   - confirmación: cuota efectiva, `manualFee` y validación de autorización.
2. Backfill de zonas (CP→asentamientos) y de direcciones (nombre normalizado); informe de ambiguos.
3. `supabase/tests/`: invariantes, catálogo, aislamiento, idempotencia, backfill y verificador rollback-only remoto.
4. Aplicar en remoto requiere autorización explícita de Emmanuel (procedimiento de migración remota).

**Criterio de salida:** verificador rollback-only verde con la migración completa, seed cargado y backfill reproducible; sin cambios persistidos en remoto.

### Z3 · `delivery-zones-settlements-api` (nivel A por dinero)

1. `packages/domain`: tipos, precedencia, `createDeliveryZone` con `settlementIds`, `applyDeliveryManualFee`, cuota efectiva y unitarias.
2. `packages/shared-types`: `settlementIds`, hechos de dirección extendidos, `reason`/`matchedBy`/`settlement`, contratos de búsqueda y cuota manual, parsers tolerantes a datos históricos; contract tests.
3. `apps/api`: búsqueda de asentamientos, `match` con motivos, `quote` con autorización, comando `manual-fee`, upsert/list con asentamientos, resolución y llenado de dirección en `customers`, `captures` usando cuota efectiva; contract tests.
4. Reconsultar CodeGraph sobre `DeliveryAddressFacts|findDeliveryZone|DeliveryZoneV1|deliveryQuote|deliveryCharge|capture_payment_intents`.

**Criterio de salida:** contract tests y unitarias verdes; aislamiento e idempotencia probados; ninguna ruta permite a un cliente fijar la cuota sin autorización.

### Z4 · `delivery-zones-editor-ui` (nivel C, dsh)

- `/app/delivery-zones` edita cada zona con buscador de colonias (prefijo, debounce 500 ms), multiselección con chips y «seleccionar todas las de un CP».
- El CP deja de ser el campo principal; la cobertura heredada por CP se muestra como aviso y se puede convertir eligiendo colonias.
- Muestra conflictos de colonia reclamada, estados de carga/vacío/error y conserva el flujo de desactivación con motivo.
- Puertas web verdes; verificación en navegador real.

**Criterio de salida:** una zona se crea y se edita sólo con colonias; los chips y el «todas las de un CP» producen exactamente los `settlementIds` enviados; sin `alert/confirm/prompt`.

### Z5 · `address-form-settlement` (nivel C, dsh; después de K4 y Z3)

- `AddressForm` muestra calle y número, interior, colonia (combobox contra `settlements/search` con debounce 500 ms), CP de sólo lectura al elegir y referencias.
- Oculta localidad, estado, país y CP manuales; los valores derivados se muestran como texto de sólo lectura.
- Flujo de colonia fuera de catálogo con aviso y confirmación propia; guarda `settlementOutsideCatalog` y deja el domicilio sin zona.
- En Captura (`capture-customer.tsx`) y en la ficha se muestra el `reason.message` exacto de Z3; si falta cuota manual, se indica «Pide a un supervisor» y no se permite confirmar.
- Puertas web verdes; verificación en escritorio y 390×844.

**Criterio de salida:** no se puede guardar una dirección sin colonia resuelta o sin declararla fuera de catálogo; el CP/ciudad/estado/país son derivados y no editables; los motivos se ven tal cual.

## 11. Riesgos y pendientes

- El artefacto normalizado de Z0 (`supabase/seed-data/navojoa-settlements.csv`) **no existe todavía**; el insumo crudo `data/sepomex/colonias.csv` sí está (567 filas + encabezado, 3 columnas). Z2 debe fallar de forma explícita hasta que Z0 produzca el normalizado. No se verificó el conteo final del seed.
- La normalización TS/SQL debe probarse con paridad; si se desincroniza, el backfill y la búsqueda divergen.
- Los CP heredados pueden solaparse con colonias asignadas a otra zona; la coincidencia por `settlementId` gana, pero una dirección legada sin colonia puede cobrar distinto. El aviso `legacy_postal_code_match` y el backfill reducen la ventana; no la eliminan.
- La cuota manual es de un solo actor con `deliveries.manage`; si Emmanuel quiere doble autorización, es una decisión aparte.
- La consulta de revisión del backfill debe ajustarse al esquema final (la dirección no guarda `branch_id`); se documentará en el runbook de Z2.
- Cambiar la forma de `override` es seguro porque hoy no se persiste ningún `override` no nulo; si apareciera uno en datos reales, Z2 debe incluirlo en el inventario antes de aplicar.
