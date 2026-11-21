begin;

-- Z2 (docs/architecture/DELIVERY_ZONES_V2.md §3, §4, §7, §10): replace the postal-code coverage
-- axis with SEPOMEX settlements while keeping postal codes/localities as legacy compatibility.
-- This is a NEW migration; 20260927000100_delivery_zones.sql is already applied and is never edited.
--
-- app.settlements is a global, tenant-free catalog (it carries no restaurant_id by design) and is
-- still server-only: RLS is enabled/forced with no policies and no grants to public/anon/
-- authenticated/service_role/app_api. Reads go through app_private.search_settlements.
--
-- The seed rows are the byte-for-byte contents of supabase/seed-data/navojoa-settlements.csv
-- (568 rows after Z0's deduplication), embedded because a SQL migration cannot read a workspace
-- file at apply time. `name` is the CSV `etiqueta` (the human label that disambiguates repeated
-- colonias by type/postal code); `normalized_name` is derived from that same label by
-- app_private.normalize_settlement_name so the table CHECK always holds. If the CSV changes, the
-- values block below must be regenerated; the post-insert guard fails the migration otherwise.

create function app_private.normalize_settlement_name(p_value text)
returns text language sql immutable strict set search_path = '' as $function$
  select pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(
        pg_catalog.lower(
          pg_catalog.regexp_replace(
            pg_catalog.normalize(p_value, 'NFD'),
            '[' || pg_catalog.chr(768) || '-' || pg_catalog.chr(879) || ']',
            '',
            'g'
          )
        ),
        '[^a-z0-9]+',
        ' ',
        'g'
      ),
      ' +',
      ' ',
      'g'
    )
  )
$function$;

revoke all on function app_private.normalize_settlement_name(text) from public, anon, authenticated, service_role, app_api;

comment on function app_private.normalize_settlement_name(text) is
  'Stable name normalization for the SEPOMEX catalog: NFD decomposition, combining marks removed, lowercase, every run of non-alphanumerics collapsed to one space, trimmed. Mirrors tools/sepomex/normalize-settlements.mjs (same output for Spanish accents, ñ, digits).';

-- Deterministic settlement id: SHA-256 of "postalCode|normalizedName|settlementType" reshaped to a
-- UUID with the exact nibble choice used by apps/api deterministicQuoteId (version 5, variant 8..b),
-- so re-seeding the same CSV never creates new rows.
create function app_private.settlement_id(p_postal_code text, p_normalized_name text, p_settlement_type text)
returns uuid language sql immutable strict set search_path = '' as $function$
  with digest as (
    select pg_catalog.sha256(pg_catalog.convert_to(
      p_postal_code || '|' || p_normalized_name || '|' || p_settlement_type, 'UTF8'
    )) as bytes
  )
  select (
    pg_catalog.substr(pg_catalog.encode(bytes, 'hex'), 1, 8) || '-' ||
    pg_catalog.substr(pg_catalog.encode(bytes, 'hex'), 9, 4) || '-5' ||
    pg_catalog.substr(pg_catalog.encode(bytes, 'hex'), 14, 3) || '-' ||
    pg_catalog.to_hex((pg_catalog.get_byte(bytes, 8) & 3) | 8) ||
    pg_catalog.substr(pg_catalog.encode(bytes, 'hex'), 18, 3) || '-' ||
    pg_catalog.substr(pg_catalog.encode(bytes, 'hex'), 21, 12)
  )::uuid
  from digest
$function$;

revoke all on function app_private.settlement_id(text, text, text) from public, anon, authenticated, service_role, app_api;

comment on function app_private.settlement_id(text, text, text) is
  'Deterministic UUID for a SEPOMEX settlement row (same construction as apps/api deterministicQuoteId). Stable across re-seeds.';

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
  constraint settlements_type_valid check (
    settlement_type = pg_catalog.btrim(settlement_type)
    and pg_catalog.char_length(settlement_type) between 1 and 80
    and settlement_type !~ '[[:cntrl:]]'
  ),
  constraint settlements_municipality_valid check (
    municipality = pg_catalog.btrim(municipality)
    and pg_catalog.char_length(municipality) between 1 and 120
    and municipality !~ '[[:cntrl:]]'
  ),
  constraint settlements_state_valid check (
    state = pg_catalog.btrim(state)
    and pg_catalog.char_length(state) between 1 and 120
    and state !~ '[[:cntrl:]]'
  ),
  constraint settlements_country_valid check (country_code ~ '^[A-Z]{2}$'),
  constraint settlements_catalog_version_valid check (
    catalog_version = pg_catalog.btrim(catalog_version)
    and pg_catalog.char_length(catalog_version) between 1 and 80
  ),
  constraint settlements_unique unique (postal_code, normalized_name, settlement_type)
);

create index settlements_name_prefix_idx
  on app.settlements (normalized_name text_pattern_ops);
create index settlements_postal_code_idx
  on app.settlements (postal_code, normalized_name);

alter table app.settlements enable row level security;
alter table app.settlements force row level security;
revoke all on app.settlements from public, anon, authenticated, service_role, app_api;

comment on table app.settlements is
  'Global SEPOMEX settlement catalog for the pilot city (Navojoa, Sonora). No restaurant_id because the data is public; tenant isolation lives in app.delivery_zone_settlements and app.customer_addresses. Server-only: RLS forced, zero grants, reads through app_private.search_settlements.';

insert into app.settlements (
  id, postal_code, name, normalized_name, settlement_type, municipality, state, country_code, catalog_version
)
select
  app_private.settlement_id(row_value.cp, app_private.normalize_settlement_name(row_value.etiqueta), row_value.tipo),
  row_value.cp,
  row_value.etiqueta,
  app_private.normalize_settlement_name(row_value.etiqueta),
  row_value.tipo,
  row_value.municipio,
  row_value.estado,
  'MX',
  'sepomex-2026-11-navojoa'
from (values
    ('85220', 'Benito Juárez (La Granja)', 'Congregación', 'Navojoa', 'Sonora'),
    ('85220', 'Bulabampo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85220', 'Choacalle', 'Ejido', 'Navojoa', 'Sonora'),
    ('85220', 'Cucajaqui', 'Ejido', 'Navojoa', 'Sonora'),
    ('85220', 'El Dique', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85220', 'El Sabinito de Tesia (Tesia y Sus Anexos)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85220', 'Estación Masiaca', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85220', 'Felipe Ángeles', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85220', 'Guacaporo (Bacaporo)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85220', 'Huebampo', 'Ejido', 'Navojoa', 'Sonora'),
    ('85220', 'Huiribis', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85220', 'Jopopaco', 'Congregación', 'Navojoa', 'Sonora'),
    ('85220', 'La Finca', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85220', 'Las Amapas (Rancho el Jito)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85220', 'Las Flores', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85220', 'Los González', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85220', 'Los Mochócolis', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85220', 'Masiaca', 'Estación', 'Navojoa', 'Sonora'),
    ('85220', 'Piedra Baya', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85220', 'Presa Nueva', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85220', 'Sahuaro', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85220', 'San Jose Masiaca', 'Congregación', 'Navojoa', 'Sonora'),
    ('85220', 'San Josecito', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85220', 'San Pedrito', 'Congregación', 'Navojoa', 'Sonora'),
    ('85222', 'Adolfo de la Huerta', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85222', 'Agua Nueva', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85222', 'Hacienda San Antonio', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85222', 'Huasaguari', 'Congregación', 'Navojoa', 'Sonora'),
    ('85222', 'Jusibampito', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85222', 'La Aguja', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85222', 'La Esmeralda', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85222', 'Las Milpas', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85222', 'Las Víboras', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85222', 'Planta NOROTOSA', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85222', 'Rancho Atalaya', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85222', 'Rancho Nuevo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85222', 'San Antonio', 'Congregación', 'Navojoa', 'Sonora'),
    ('85222', 'Teachive', 'Congregación', 'Navojoa', 'Sonora'),
    ('85222', 'Torocoba (ranchería, 85222)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85222', 'Yopari', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Alfredo Karam', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Álvarez Hermanos (congregación)', 'Congregación', 'Navojoa', 'Sonora'),
    ('85223', 'Álvarez Hermanos (ejido)', 'Ejido', 'Navojoa', 'Sonora'),
    ('85223', 'Álvarez Hermanos (ranchería)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Amador Almada', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Bacabachi', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Bacabachi (La Granja)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Brecha Colosio', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Buayums', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Campo de Walter Almada (Sahuaribo)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Campo Girasol', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Canuto Aguilar (Campo Canuto)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'El Reparo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'El Saneal', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'El Saneal (La Granja)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Federico Yépiz', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Francisco I. Madero Dos', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Jitotaila', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'La Esperanza', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'La Esquina Valdez (Puente Valdez)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'La Jaula', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'La Potable (congregación)', 'Congregación', 'Navojoa', 'Sonora'),
    ('85223', 'La Potable (ranchería)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Las Bombas (ranchería, 85223)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Las Caballerizas (Campo Ruiz)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Luis Echeverría', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Macías (ejido)', 'Ejido', 'Navojoa', 'Sonora'),
    ('85223', 'Macías (ranchería)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Pilinque', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Plano Oriente', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Puente San Ignacio', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'San Juan (La Noria)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'San Martín Chuachora', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85223', 'Tiqui Torres', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'ABC Guayparín', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'ABC los Jitos', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Agropecuaria Boza', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Alejo Aguilera', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Antonio Rosales (Las Ánimas)', 'Ejido', 'Navojoa', 'Sonora'),
    ('85224', 'Arturo Almada', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Bachoco', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Bórquez', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Café Edna', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Campo Bojórquez', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Campo Chacón', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Campo Chacón II', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Campo de Jesés Almada', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Campo Jesés Down', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Campo Roberto Rosas', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Campo Saenz', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Campo Santa Mónica', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Capetamaya (ejido)', 'Ejido', 'Navojoa', 'Sonora'),
    ('85224', 'Capetamaya (ranchería)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Capetamaya Granja Rosita (La Rosita)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Casa Blanca (ranchería, 85224)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Chirajobampo', 'Congregación', 'Navojoa', 'Sonora'),
    ('85224', 'Compuerta Treinta y Ocho', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'DER Agrícola', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Dilot', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Ejido Etchojoa Némero Uno', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Ejido Etchojoa Número Uno', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Ejido Primero de Abril', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'El Abajeño [Restaurante]', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'El Barrial', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'El Ciano Kilómetro Nueve', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'El Ciclón [Avícola]', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'El Cuatro', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'El Falcón Granja', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'El Milagro', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'El Papalote', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Empaque Chacón', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Germán Corral', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Godínez', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Jesús Almada', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'La Casita Granja', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'La Huerta', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'La Pitahaya', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Lolita', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Los Bórquez', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Los Pinos (ranchería, 85224)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Martínez', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Mazolay', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Molino de Almada', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Nacapél', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Norisina', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Octaciano Sáinz', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Oficina de las Ánimas', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Pedro Almada', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Planta de Alimentos Cacharamba (Persamo)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Ramon Zazueta', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Rancho de los Gonzáles', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Rodolfo Rosas', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Salido', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Santa Ana [Restaurante]', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Santa Isabel (ranchería, 85224)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Saucobe', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Sinahuisa', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Tetacruz', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Torocoba (ranchería, 85224)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Tres Jitos (Los Carrazco)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Veintisiete', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Yépiz Rosas', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85224', 'Yorimayo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85225', 'Agropecuaria Marsam', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85225', 'Algodonera Ucamayo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85225', 'Hipódromo del Noroeste', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85225', 'Industrias Agrícolas del Mayo', 'Ejido', 'Navojoa', 'Sonora'),
    ('85225', 'Las Palmas', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85225', 'Once de Mayo (Los Hoyones)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85225', 'Petroquimica del Golfo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85225', 'Ramiro González', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85225', 'Rubén Valenzuela', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85225', 'Sapomora (Granja Sapomora)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85225', 'Valle Verde [Motel]', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85225', 'Zapochopo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', '5 de junio', 'Congregación', 'Navojoa', 'Sonora'),
    ('85226', 'Agrolacteos del Sur de Sonora', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Aldegundo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Arreola (Campo la Huerta)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Buenavista (poblado comunal)', 'Poblado comunal', 'Navojoa', 'Sonora'),
    ('85226', 'Cabrito a la Maya', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Campo Aguadulce', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Campo de Guillermo Giesecke', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Campo de Remigio González', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Campo San Francisco', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Campo Valenzuela', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Campo Zazueta', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Chinotahueca (congregación)', 'Congregación', 'Navojoa', 'Sonora'),
    ('85226', 'Chinotahueca (ejido)', 'Ejido', 'Navojoa', 'Sonora'),
    ('85226', 'Chinotahueca (ranchería)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Cohuibampo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Colegio del Pacífico', 'Congregación', 'Navojoa', 'Sonora'),
    ('85226', 'Don Juan [Restaurante]', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'El Barrial (Ejido San Ignacio)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'El Barrial Kilómetro Doce', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'El Jopo', 'Congregación', 'Navojoa', 'Sonora'),
    ('85226', 'El Jopo (Aguilar Ramírez)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Guadalupe', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Hacienda Don Pepe', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Héctor Arreola', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Jupacobe', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Kilómetro Catorce', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'La Bomba', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Las Carolinas (Cahurara) [Huerta]', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Las Dos Palmas', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Los Arvizu (Campo Arvizu)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Los Parosis (Epifanio Zazueta)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Los Pinos (ranchería, 85226)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Manuel Godínez', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Navarro', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Navojoa', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Parosis Dos', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Planta Ada', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Porcarit', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Robinson', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'San Gerardo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'San José (ejido)', 'Ejido', 'Navojoa', 'Sonora'),
    ('85226', 'San José (ranchería, 85226)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'San José Chinotahueca', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'San José Huerta Sandoval', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'San Pancho', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Santa Anita', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Santa Isabel (ranchería, 85226)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Sicoma', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Sicoma (Bachoco)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85226', 'Zapomora', 'Congregación', 'Navojoa', 'Sonora'),
    ('85227', 'Aquimulato', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'Batayaqui', 'Congregación', 'Navojoa', 'Sonora'),
    ('85227', 'Casa Blanca (ranchería, 85227)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'Cascabel (Casbel)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'Chinobampo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'El Bachivo', 'Ejido', 'Navojoa', 'Sonora'),
    ('85227', 'El Chilicote', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'El Ranchito (ejido)', 'Ejido', 'Navojoa', 'Sonora'),
    ('85227', 'El Ranchito (ranchería, 85227)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'El Tecolote (ranchería, 85227)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'El Viejo Batayaqui', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'Etchomocha', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'Industrias SONMEX', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'Junelancahui (Joconas)', 'Ejido', 'Navojoa', 'Sonora'),
    ('85227', 'Jusibampo (ranchería, 85227)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'La Campana', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'La Fortuna', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'Las Chivas', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'Los Cuatro', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'Masubampo (Nasubampo)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'Miguel Hidalgo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'Porcina Cocutec', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'Porcina San Alfonso', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'Rancho la Soledad', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'San José (ranchería, 85227)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'San Juan (ranchería, 85227)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85227', 'Singapur', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Algodonera', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Bacerán', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Camargo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Cohuirimpo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Cutataila (El Bayado)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Daniel Camacho', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Dósali', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'El Bajío (ranchería)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'El Cumbro', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'El Recodo', 'Congregación', 'Navojoa', 'Sonora'),
    ('85228', 'Familia Ozuna Ayala (San Ignacio)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Fertilizantes e Insumos', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Francisco Clemen', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Jijica', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Kowicarit', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Kutantaka', 'Congregación', 'Navojoa', 'Sonora'),
    ('85228', 'La Huerta (Once)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Las Tierritas', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Los Pozos de los Nachuquis', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'MUSA', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Nachuquis (San Antonio Nachuquis)', 'Hacienda', 'Navojoa', 'Sonora'),
    ('85228', 'Punta de la Laguna', 'Ejido', 'Navojoa', 'Sonora'),
    ('85228', 'Rancho Del Padre', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Santa Isabel (ranchería, 85228)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Sibolibampo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Tesotahueca', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Torovene', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85228', 'Unión de Crédito Agrícola del Noroeste', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'Autoservicio Mas', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'Bemelabampo', 'Congregación', 'Navojoa', 'Sonora'),
    ('85229', 'Chihuahuita', 'Congregación', 'Navojoa', 'Sonora'),
    ('85229', 'Corrales Angelita', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'Corrales la Quince', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'El Árbol Caído [Restaurante]', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'El Arbolón', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'El Campito', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'El Dátil', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'El Limón', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'El Mezquital de Abajo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'El Molino', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'El Pilar (Pilares)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'El Pisi', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'El Rancho', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'El Sabino (ranchería, 85229)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'El Sauz', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'El Tobogán', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'Fertinal (Carco)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'Gas Periférico', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'Hacienda San Gerardo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'Huerta Aguilera', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'J y J Machinery', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'Javier Lagarda', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'Josomteco', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'La Cuchilla de los Bahuises', 'Congregación', 'Navojoa', 'Sonora'),
    ('85229', 'La Quince', 'Congregación', 'Navojoa', 'Sonora'),
    ('85229', 'Ladrillera', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'LICONSA', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'Los Aguacates [Huerta]', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'Los Briseño', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'Los Limones (poblado comunal)', 'Poblado comunal', 'Navojoa', 'Sonora'),
    ('85229', 'Margarita (ejido)', 'Ejido', 'Navojoa', 'Sonora'),
    ('85229', 'Margarita (ranchería, 85229)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'Periférico Chihuahuita', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'Porcina Pedro', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'Quinta Angelina', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'Santa Anita (Granja)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'Santa María (ranchería, 85229)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'Siviral', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85229', 'Valle Hermoso la Huerta', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85230', 'Bahuises', 'Congregación', 'Navojoa', 'Sonora'),
    ('85230', 'Cemix', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85230', 'Establo San Juan', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85230', 'Guaymitas', 'Congregación', 'Navojoa', 'Sonora'),
    ('85230', 'Industrias Porcícola Balmar', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85230', 'La Cruz', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85230', 'Ladrilleras Tetaboca', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85230', 'Napobampo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85230', 'Santa Bárbara (ranchería)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85230', 'Tetaboca (ranchería)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85230', 'Valle Buey', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85230', 'Valle Hermoso', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85230', 'Zona de Tolerancia', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85232', 'Agropecuaria Tecorahui', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85232', 'Alinsumos', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85232', 'Babójori', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85232', 'Basiabampo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85232', 'El Dolar', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85232', 'El Pollín', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85232', 'El Tori', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85232', 'Gabriel Leyva Solano', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85232', 'Las Iguanas', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85232', 'Los Cuates', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85232', 'Margarita (ranchería, 85232)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85232', 'San Martín', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Agiabampo (ranchería, 85233)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Alejandra', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Caseta de Cobro', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'El Ranchito (ranchería, 85233)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'El Retiro (ejido)', 'Ejido', 'Navojoa', 'Sonora'),
    ('85233', 'El Retiro (ranchería)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Elsa', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Engorda Campoy', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Enrique Orozco', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Esperancita (ejido)', 'Ejido', 'Navojoa', 'Sonora'),
    ('85233', 'Esperancita (ranchería)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Estación de FFCC Sección Dieciocho', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Estación Velderráin', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Etchohuaquila', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Eugenia', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Fundición', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Gabriela', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Genes', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Granja Sonqui (La Tuna)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Guadalupe de Juárez', 'Hacienda', 'Navojoa', 'Sonora'),
    ('85233', 'Guadalupe Sonqui', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Jostahueca', 'Congregación', 'Navojoa', 'Sonora'),
    ('85233', 'La Bombita', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'La Choya', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'La Lágrima', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'La Sandía', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Las Cachimbas', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Loma Linda', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Los Batequis', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Los Buhitos', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Los Magueyes', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Musuabampo', 'Ejido', 'Navojoa', 'Sonora'),
    ('85233', 'San Francisco (ranchería)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'San Germán', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'San Ricardo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Santa María del Buaraje', 'Congregación', 'Navojoa', 'Sonora'),
    ('85233', 'Siete Leguas', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Susana', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Tamazula', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85233', 'Tesopobampo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Arroyo Cocoraque (Ladrillera)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Avícola Sonqui', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Bachoco Veinticinco Diecisiete', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Bloque 1624', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Bloque Mil Seiscientos Veintiséis', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Buáraje Viejo', 'Ejido', 'Navojoa', 'Sonora'),
    ('85234', 'Campo Antonio Zazueta (Las Ruinas)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Campo Arvizu', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Campo Cuauhtémoc', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Campo del Gringo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Campo Ignacio Pablos', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Campo José Gastélum', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Che Guevara', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Ejido Revolución Mexicana', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'El Gachupín', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'El Invernadero', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'El Sifón', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Feriva', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'GenioKowi', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Joaquín Amaro', 'Congregación', 'Navojoa', 'Sonora'),
    ('85234', 'La Laguna Mondaca', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'La Pastera', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Lamberto Arvizu', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Licenciado Miguel de la Madrid Hurtado', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Miguel de la Madrid Dos (ejido)', 'Ejido', 'Navojoa', 'Sonora'),
    ('85234', 'Miguel de la Madrid Dos (ranchería)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Miguel de la Madrid Uno', 'Ejido', 'Navojoa', 'Sonora'),
    ('85234', 'Oviáchic', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Planta de Aguamonia', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85234', 'Tres Arbolitos', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'Altamira', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'Barebampo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'Casa Blanca (ranchería, 85235)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'Cuchujaqui', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'El Chapulín', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'El Core', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'Graciano Sánchez (Yorigibe)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'Jaitaca', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'Jijiri', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'Juan Diego', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'Jusibampo (ranchería, 85235)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'La Ensenada', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'La Labor de Santa Rosa', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'La Pera', 'Ejido', 'Navojoa', 'Sonora'),
    ('85235', 'La Perita', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'Las Lajas', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'Las Pilas Tesia (Las Pilas y Anexos)', 'Congregación', 'Navojoa', 'Sonora'),
    ('85235', 'Palo Blanco', 'Congregación', 'Navojoa', 'Sonora'),
    ('85235', 'Paskolabampo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'Ranchería', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'Rancho Jaitaca', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'Rancho las Granjas', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'Rancho Ojeda', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'Santa María (ranchería, 85235)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'Santa Rosa', 'Hacienda', 'Navojoa', 'Sonora'),
    ('85235', 'Tetapache', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85235', 'Tierra Blanca (congregación)', 'Congregación', 'Navojoa', 'Sonora'),
    ('85236', 'Ada', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85236', 'Bacame Nuevo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85236', 'Buenos Aires (ejido)', 'Ejido', 'Navojoa', 'Sonora'),
    ('85236', 'Buenos Aires (ranchería, 85236)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85236', 'Campo Gilberto Barceló', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85236', 'Campo Rodrigo Siqueiros', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85236', 'Corrales de Jaime Campos', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85236', 'Ejido Ignacio Pesqueira', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85236', 'El Bajío (ejido)', 'Ejido', 'Navojoa', 'Sonora'),
    ('85236', 'La Batalla', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85236', 'Las Muletas', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85236', 'Linda Vista', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85236', 'Navomora', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85236', 'Pozo Dulce', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85236', 'Pueblo Mayo', 'Pueblo', 'Navojoa', 'Sonora'),
    ('85236', 'Raymundo López', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85236', 'Valle Verde', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85236', 'Vista Hermosa', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85237', 'Barrio Cantúa', 'Barrio', 'Navojoa', 'Sonora'),
    ('85237', 'Barrio Corral', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85237', 'Camoa', 'Pueblo', 'Navojoa', 'Sonora'),
    ('85237', 'El Sabino (ranchería, 85237)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85237', 'El Tablón', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85237', 'El Tecolote (ranchería, 85237)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85237', 'Las Bombas (ranchería, 85237)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85237', 'Las Pilas', 'Estación', 'Navojoa', 'Sonora'),
    ('85237', 'Santa Bárbara (hacienda)', 'Hacienda', 'Navojoa', 'Sonora'),
    ('85237', 'Siquisiva', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85237', 'Tres Hermanos', 'Hacienda', 'Navojoa', 'Sonora'),
    ('85238', 'Avícola San Carlos II', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85238', 'Caza y Pesca Club de Tiro', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85238', 'Chivucu', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85238', 'El Alamito', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85238', 'El Mezquital de Tesia', 'Ejido', 'Navojoa', 'Sonora'),
    ('85238', 'El Rancho Sahueso', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85238', 'El Zapote', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85238', 'La Laguna de Tesia', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85238', 'Las Guásimas (El Japonés)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85238', 'Las Guásimas Rancho', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85238', 'Las Hurracas', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85238', 'Los Álamos [Avícola]', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85238', 'Los Limones (ejido)', 'Ejido', 'Navojoa', 'Sonora'),
    ('85238', 'Molino Julio Graff', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85238', 'Porcina San Carlos Cuatro', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85238', 'Porcina San Carlos Tres', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85238', 'San Francisco (congregación)', 'Congregación', 'Navojoa', 'Sonora'),
    ('85238', 'Santa Isabel (ranchería, 85238)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85238', 'Sibacobe', 'Congregación', 'Navojoa', 'Sonora'),
    ('85238', 'Tesia', 'Pueblo', 'Navojoa', 'Sonora'),
    ('85238', 'Tetaboca (La Pedrera)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85239', 'Agiabampo (ranchería, 85239)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85239', 'Ajiabampo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85239', 'Almacenadora de Navojoa', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85239', 'Buenos Aires (ranchería, 85239)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85239', 'Buiyacusi', 'Congregación', 'Navojoa', 'Sonora'),
    ('85239', 'Capohuiza', 'Congregación', 'Navojoa', 'Sonora'),
    ('85239', 'El Taste', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85239', 'El Triunfo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85239', 'Empaque de Juan Carlos Cuevas', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85239', 'Fitosanitaria (Estación Cuarentenaria)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85239', 'La Galerita', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85239', 'Las Pilitas', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85239', 'Loma Del Refugio', 'Congregación', 'Navojoa', 'Sonora'),
    ('85239', 'Los Ángeles', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85239', 'Mezquital de Buiyacusi', 'Congregación', 'Navojoa', 'Sonora'),
    ('85239', 'Rancho Agiabampo', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85239', 'Rosales (ranchería)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85239', 'San Juan (ranchería, 85239)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85239', 'Tori Kowi', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85239', 'Tucure de Abajo (Tucure Nuevo)', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85239', 'Vivajimari', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85239', 'Yorentamehua', 'Ranchería', 'Navojoa', 'Sonora'),
    ('85800', 'Estadio Viejo', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85800', 'Navojoa Centro', 'Colonia', 'Navojoa', 'Sonora'),
    ('85810', 'Buenavista', 'Colonia', 'Navojoa', 'Sonora'),
    ('85810', 'Pueblo Nuevo', 'Colonia', 'Navojoa', 'Sonora'),
    ('85820', 'Constitución', 'Colonia', 'Navojoa', 'Sonora'),
    ('85820', 'Tierra Blanca', 'Colonia', 'Navojoa', 'Sonora'),
    ('85823', 'Camino Real', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85823', 'Campestre', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85825', 'Los Arcos', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85825', 'Villa Lourdes', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85826', 'Hacienda Vieja', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85826', 'San Ignacio Cohuirimpo', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85826', 'Santa Fe', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85827', 'Tetanchopo', 'Colonia', 'Navojoa', 'Sonora'),
    ('85830', 'Álamo', 'Residencial', 'Navojoa', 'Sonora'),
    ('85830', 'Reforma', 'Colonia', 'Navojoa', 'Sonora'),
    ('85830', 'Villa del Sol', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85835', 'Los Naranjos', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85835', 'Mezquital de Pueblo Viejo', 'Colonia', 'Navojoa', 'Sonora'),
    ('85835', 'Residencial La Huerta', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85840', 'Aviación', 'Colonia', 'Navojoa', 'Sonora'),
    ('85840', 'CTM Obrera', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85840', 'Hidalgo', 'Colonia', 'Navojoa', 'Sonora'),
    ('85840', 'Moderna', 'Colonia', 'Navojoa', 'Sonora'),
    ('85840', 'Nogalitos', 'Colonia', 'Navojoa', 'Sonora'),
    ('85843', 'La Herradura', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85843', 'Residencial Santa María', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85845', 'Pueblo Viejo', 'Pueblo', 'Navojoa', 'Sonora'),
    ('85850', 'Allende', 'Colonia', 'Navojoa', 'Sonora'),
    ('85850', 'Miravalle', 'Colonia', 'Navojoa', 'Sonora'),
    ('85850', 'Mocuzari', 'Colonia', 'Navojoa', 'Sonora'),
    ('85850', 'Rosales', 'Colonia', 'Navojoa', 'Sonora'),
    ('85860', 'Beltrones (ampliación)', 'Ampliación', 'Navojoa', 'Sonora'),
    ('85860', 'Beltrones', 'Colonia', 'Navojoa', 'Sonora'),
    ('85860', 'Deportiva', 'Colonia', 'Navojoa', 'Sonora'),
    ('85860', 'Itson', 'Colonia', 'Navojoa', 'Sonora'),
    ('85864', 'Brisas del Valle', 'Colonia', 'Navojoa', 'Sonora'),
    ('85864', 'FOVISSSTE', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85870', 'Juárez', 'Colonia', 'Navojoa', 'Sonora'),
    ('85870', 'Santa Bárbara (fraccionamiento)', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85874', 'Aeropuerto', 'Colonia', 'Navojoa', 'Sonora'),
    ('85874', 'La Joya', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85874', 'Las Bugambilias', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85874', 'Los Laureles', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85874', 'Villa Dorada', 'Colonia', 'Navojoa', 'Sonora'),
    ('85880', 'Armando López Nogales', 'Colonia', 'Navojoa', 'Sonora'),
    ('85880', 'Francisco Villa', 'Colonia', 'Navojoa', 'Sonora'),
    ('85880', 'Girasoles', 'Colonia', 'Navojoa', 'Sonora'),
    ('85880', 'Jacarandas', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85880', 'Jacarandas II', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85880', 'Jacarandas III', 'Colonia', 'Navojoa', 'Sonora'),
    ('85880', 'La Guadalupana', 'Colonia', 'Navojoa', 'Sonora'),
    ('85880', 'Tierra y Libertad', 'Colonia', 'Navojoa', 'Sonora'),
    ('85890', 'Arboledas', 'Colonia', 'Navojoa', 'Sonora'),
    ('85890', 'Indeur', 'Colonia', 'Navojoa', 'Sonora'),
    ('85890', 'INFONAVIT', 'Unidad habitacional', 'Navojoa', 'Sonora'),
    ('85890', 'Minas de Arena', 'Colonia', 'Navojoa', 'Sonora'),
    ('85890', 'Rosario Ruelas', 'Colonia', 'Navojoa', 'Sonora'),
    ('85890', 'Sonora', 'Colonia', 'Navojoa', 'Sonora'),
    ('85890', 'Sonora Ayuntamiento', 'Colonia', 'Navojoa', 'Sonora'),
    ('85890', 'Sonora Progresista', 'Colonia', 'Navojoa', 'Sonora'),
    ('85890', 'SOP', 'Colonia', 'Navojoa', 'Sonora'),
    ('85890', 'Zona Urbana Ejidal', 'Colonia', 'Navojoa', 'Sonora'),
    ('85893', '16 de junio', 'Colonia', 'Navojoa', 'Sonora'),
    ('85894', 'Misioneros', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85894', 'Misioneros Del Sur', 'Fraccionamiento', 'Navojoa', 'Sonora'),
    ('85894', 'Privada del Pedregal', 'Colonia', 'Navojoa', 'Sonora'),
    ('85894', 'Tepeyac', 'Colonia', 'Navojoa', 'Sonora'),
    ('85894', 'Tetaboca', 'Colonia', 'Navojoa', 'Sonora'),
    ('85895', '16 de septiembre', 'Colonia', 'Navojoa', 'Sonora'),
    ('85895', 'Nueva Generación', 'Colonia', 'Navojoa', 'Sonora'),
    ('85895', 'Parque Industrial', 'Parque industrial', 'Navojoa', 'Sonora')
) as row_value(cp, etiqueta, tipo, municipio, estado);

do $seed_guard$
declare
  v_rows bigint;
  v_distinct bigint;
begin
  select count(*), count(distinct id) into v_rows, v_distinct from app.settlements;
  if v_rows <> 568 or v_distinct <> 568 then
    raise exception using errcode = '55000',
      message = pg_catalog.format('SETTLEMENTS_SEED_INVALID: expected 568 rows, found % (%)', v_rows, v_distinct);
  end if;
  if exists (
    select 1 from app.settlements
    where municipality <> 'Navojoa' or state <> 'Sonora' or country_code <> 'MX'
  ) then
    raise exception using errcode = '55000', message = 'SETTLEMENTS_SEED_OUT_OF_SCOPE';
  end if;
end
$seed_guard$;

-- Branch geographic identity: address city/state/country derive from the Branch, never from the
-- client and never from a Branch postal code (the delivery postal code comes from the settlement).
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

comment on column app.branches.locality is
  'Branch city; defines the settlement catalog scope together with region.';
comment on column app.branches.region is
  'Branch state; defines the settlement catalog scope together with locality.';
comment on column app.branches.country_code is
  'ISO 3166-1 alpha-2 country for addresses served by this Branch.';

-- Zone <-> settlement membership, exactly analogous to app.delivery_zone_postal_codes: it only
-- ever contains rows for active, non-deleted zones, so an unconditional unique on
-- (restaurant_id, branch_id, settlement_id) is correct and a settlement can be reassigned after
-- deactivating its previous zone.
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
  constraint delivery_zone_settlements_unique
    unique (restaurant_id, branch_id, settlement_id)
);

create index delivery_zone_settlements_zone_idx
  on app.delivery_zone_settlements (restaurant_id, branch_id, zone_id);

alter table app.delivery_zone_settlements enable row level security;
alter table app.delivery_zone_settlements force row level security;
revoke all on app.delivery_zone_settlements from public, anon, authenticated, service_role, app_api;

comment on table app.delivery_zone_settlements is
  'Server-only membership index: exactly the settlements currently claimed by an active, non-deleted delivery zone in a Branch. Maintained only by app_private.upsert_delivery_zone; enforces one active zone per settlement per Branch.';

-- Coverage is now "settlementIds OR postalCodes" (localities are legacy and never match). The old
-- CHECK could not see the membership table, so the writer enforces the invariant instead; keeping
-- the old check would reject every settlement-only zone.
alter table app.delivery_zones drop constraint delivery_zones_coverage_nonempty;

-- Customer address: settlementId is authoritative; the text fields remain a readable snapshot.
alter table app.customer_addresses
  add column settlement_id uuid references app.settlements (id) on delete restrict,
  add column settlement_outside_catalog boolean not null default false,
  add constraint customer_addresses_settlement_exclusive
    check (settlement_id is null or settlement_outside_catalog = false),
  add constraint customer_addresses_outside_needs_text
    check (settlement_outside_catalog = false or neighborhood is not null),
  add constraint customer_addresses_outside_has_no_postal_code
    check (settlement_outside_catalog = false or postal_code is null);

alter table app.customer_fulfillment_snapshots
  add column settlement_id uuid references app.settlements (id) on delete restrict,
  add column settlement_outside_catalog boolean not null default false,
  add constraint customer_fulfillment_settlement_exclusive
    check (settlement_id is null or settlement_outside_catalog = false),
  add constraint customer_fulfillment_outside_needs_text
    check (settlement_outside_catalog = false or neighborhood is not null),
  add constraint customer_fulfillment_outside_has_no_postal_code
    check (settlement_outside_catalog = false or postal_code is null);

-- SQL-side revalidation, independent of the API: a settlement-linked row may not invent a postal
-- code, city, state or country, and a Branch-scoped snapshot may only use its Branch's catalog.
create function app_private.enforce_customer_address_settlement()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_settlement app.settlements%rowtype;
  v_locality text;
  v_region text;
begin
  if new.settlement_outside_catalog then
    if new.settlement_id is not null or new.neighborhood is null or new.postal_code is not null then
      raise exception using errcode = '23514', message = 'CUSTOMER_ADDRESS_OUTSIDE_CATALOG_INVALID';
    end if;
    return new;
  end if;
  if new.settlement_id is null then return new; end if;

  select * into v_settlement from app.settlements where id = new.settlement_id;
  if not found then
    raise exception using errcode = '23514', message = 'CUSTOMER_ADDRESS_SETTLEMENT_UNKNOWN';
  end if;
  if new.postal_code is not null and new.postal_code <> v_settlement.postal_code then
    raise exception using errcode = '23514', message = 'CUSTOMER_ADDRESS_POSTAL_CODE_MISMATCH';
  end if;
  if new.locality is not null and new.locality <> v_settlement.municipality then
    raise exception using errcode = '23514', message = 'CUSTOMER_ADDRESS_LOCALITY_MISMATCH';
  end if;
  if new.region is not null and new.region <> v_settlement.state then
    raise exception using errcode = '23514', message = 'CUSTOMER_ADDRESS_REGION_MISMATCH';
  end if;
  if new.country_code is not null and new.country_code <> v_settlement.country_code then
    raise exception using errcode = '23514', message = 'CUSTOMER_ADDRESS_COUNTRY_MISMATCH';
  end if;
  if new.validation_branch_id is not null then
    select locality, region into v_locality, v_region
    from app.branches where restaurant_id = new.restaurant_id and id = new.validation_branch_id;
    if not found or v_locality is distinct from v_settlement.municipality
      or v_region is distinct from v_settlement.state then
      raise exception using errcode = '23514', message = 'CUSTOMER_ADDRESS_SETTLEMENT_OUT_OF_BRANCH';
    end if;
  end if;
  return new;
end
$function$;

create trigger customer_addresses_enforce_settlement
before insert or update on app.customer_addresses
for each row execute function app_private.enforce_customer_address_settlement();

alter function app_private.enforce_customer_address_settlement() owner to postgres;
revoke all on function app_private.enforce_customer_address_settlement() from public, anon, authenticated, service_role, app_api;

create function app_private.enforce_customer_fulfillment_settlement()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_settlement app.settlements%rowtype;
  v_locality text;
  v_region text;
begin
  if new.settlement_outside_catalog then
    if new.settlement_id is not null or new.neighborhood is null or new.postal_code is not null then
      raise exception using errcode = '23514', message = 'CUSTOMER_FULFILLMENT_OUTSIDE_CATALOG_INVALID';
    end if;
    return new;
  end if;
  if new.settlement_id is null then return new; end if;

  select * into v_settlement from app.settlements where id = new.settlement_id;
  if not found then
    raise exception using errcode = '23514', message = 'CUSTOMER_FULFILLMENT_SETTLEMENT_UNKNOWN';
  end if;
  select locality, region into v_locality, v_region
  from app.branches where restaurant_id = new.restaurant_id and id = new.branch_id;
  if not found or v_locality is distinct from v_settlement.municipality
    or v_region is distinct from v_settlement.state then
    raise exception using errcode = '23514', message = 'CUSTOMER_FULFILLMENT_SETTLEMENT_OUT_OF_BRANCH';
  end if;
  if new.postal_code is not null and new.postal_code <> v_settlement.postal_code then
    raise exception using errcode = '23514', message = 'CUSTOMER_FULFILLMENT_POSTAL_CODE_MISMATCH';
  end if;
  if new.locality <> v_settlement.municipality then
    raise exception using errcode = '23514', message = 'CUSTOMER_FULFILLMENT_LOCALITY_MISMATCH';
  end if;
  if new.region is not null and new.region <> v_settlement.state then
    raise exception using errcode = '23514', message = 'CUSTOMER_FULFILLMENT_REGION_MISMATCH';
  end if;
  if new.country_code <> v_settlement.country_code then
    raise exception using errcode = '23514', message = 'CUSTOMER_FULFILLMENT_COUNTRY_MISMATCH';
  end if;
  return new;
end
$function$;

create trigger customer_fulfillment_snapshots_enforce_settlement
before insert or update on app.customer_fulfillment_snapshots
for each row execute function app_private.enforce_customer_fulfillment_settlement();

alter function app_private.enforce_customer_fulfillment_settlement() owner to postgres;
revoke all on function app_private.enforce_customer_fulfillment_settlement() from public, anon, authenticated, service_role, app_api;

-- Current manual delivery-fee authorization per draft/address snapshot. The row is the authorization
-- in force; app.capture_delivery_manual_fee_events is the append-only audit journal.
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
    check (received_at >= authorized_at),
  constraint capture_delivery_manual_fees_fingerprint_valid
    check (command_fingerprint ~ '^[0-9a-f]{64}$')
);

alter table app.capture_delivery_manual_fees enable row level security;
alter table app.capture_delivery_manual_fees force row level security;
revoke all on app.capture_delivery_manual_fees from public, anon, authenticated, service_role, app_api;

comment on table app.capture_delivery_manual_fees is
  'Server-only current manual delivery-fee authorization for one capture draft/address snapshot. Only deliveries.manage roles; eligibility requires a resolved, not-covered address. The journal is the audit.';

create table app.capture_delivery_manual_fee_events (
  event_id uuid primary key,
  restaurant_id uuid not null,
  branch_id uuid not null,
  capture_draft_id uuid not null,
  address_snapshot_ref uuid not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  actor_membership_id uuid not null,
  device_id uuid not null,
  operation text not null,
  expected_version bigint not null,
  result_version bigint not null,
  fee_minor bigint not null,
  currency_code text not null,
  reason text not null,
  role_code text not null,
  authorized_at timestamptz not null,
  received_at timestamptz not null default pg_catalog.clock_timestamp(),
  idempotency_key uuid not null,
  command_fingerprint text not null,
  constraint capture_delivery_manual_fee_events_capture_fk
    foreign key (restaurant_id, branch_id, capture_draft_id)
    references app.capture_drafts (restaurant_id, branch_id, id) on delete restrict,
  constraint capture_delivery_manual_fee_events_snapshot_fk
    foreign key (restaurant_id, branch_id, address_snapshot_ref)
    references app.customer_fulfillment_snapshots (restaurant_id, branch_id, id) on delete restrict,
  constraint capture_delivery_manual_fee_events_membership_fk
    foreign key (restaurant_id, branch_id, actor_membership_id, actor_id)
    references app.memberships (restaurant_id, branch_id, id, user_id) on delete restrict,
  constraint capture_delivery_manual_fee_events_idempotency_unique
    unique (actor_id, restaurant_id, branch_id, idempotency_key),
  constraint capture_delivery_manual_fee_events_operation_valid
    check (operation in ('manual_fee.authorized','manual_fee.updated','manual_fee.revoked')),
  constraint capture_delivery_manual_fee_events_version_valid check (
    expected_version between 0 and 9007199254740990
    and result_version = expected_version + 1
    and ((operation = 'manual_fee.authorized') = (expected_version = 0))
  ),
  constraint capture_delivery_manual_fee_events_fee_valid
    check (fee_minor between 0 and 9007199254740991),
  constraint capture_delivery_manual_fee_events_currency_valid
    check (currency_code ~ '^[A-Z]{3}$'),
  constraint capture_delivery_manual_fee_events_reason_valid check (
    reason = pg_catalog.btrim(reason)
    and pg_catalog.char_length(reason) between 1 and 500
    and reason !~ '[[:cntrl:]]'
  ),
  constraint capture_delivery_manual_fee_events_role_valid
    check (role_code in ('owner','admin','manager','supervisor')),
  constraint capture_delivery_manual_fee_events_fingerprint_valid
    check (command_fingerprint ~ '^[0-9a-f]{64}$')
);

alter table app.capture_delivery_manual_fee_events enable row level security;
alter table app.capture_delivery_manual_fee_events force row level security;
revoke all on app.capture_delivery_manual_fee_events from public, anon, authenticated, service_role, app_api;

comment on table app.capture_delivery_manual_fee_events is
  'Server-only append-only journal and audit for manual delivery-fee authorizations: authorized, updated and system-revoked. Fingerprint binds the command, actor and scope.';

-- Zone-to-wire constructor now carries settlementIds. It reads the membership table, so it can no
-- longer be IMMUTABLE; it is STABLE and stays server-only (no direct grant).
create or replace function app_private.delivery_zone_to_jsonb(p_zone app.delivery_zones)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'zoneId', p_zone.id::text,
    'restaurantId', p_zone.restaurant_id::text,
    'branchId', p_zone.branch_id::text,
    'name', p_zone.name,
    'postalCodes', to_jsonb(p_zone.postal_codes),
    'localities', to_jsonb(p_zone.localities),
    'settlementIds', coalesce((
      select pg_catalog.jsonb_agg(claimed.settlement_id::text order by claimed.settlement_id)
      from app.delivery_zone_settlements claimed
      where claimed.restaurant_id = p_zone.restaurant_id
        and claimed.branch_id = p_zone.branch_id
        and claimed.zone_id = p_zone.id
    ), '[]'::jsonb),
    'feeMinor', p_zone.fee_minor,
    'currency', p_zone.currency_code,
    'active', p_zone.active,
    'version', p_zone.version,
    'updatedAt', pg_catalog.to_char(p_zone.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
$function$;

alter function app_private.delivery_zone_to_jsonb(app.delivery_zones) owner to postgres;
revoke all on function app_private.delivery_zone_to_jsonb(app.delivery_zones) from public, anon, authenticated, service_role, app_api;

-- Quote feed: same active-only scope, plus settlementIds so the domain matcher can use IDs.
create or replace function app_private.list_active_delivery_zones_for_quote(p_restaurant_id uuid, p_branch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_zones jsonb;
begin
  if p_restaurant_id is null or p_branch_id is null then
    return pg_catalog.jsonb_build_object('status','rejected');
  end if;

  select coalesce(pg_catalog.jsonb_agg(z.row_json order by z.id), '[]'::jsonb)
  into v_zones
  from (
    select dz.id, pg_catalog.jsonb_build_object(
      'zoneId', dz.id::text,
      'restaurantId', dz.restaurant_id::text,
      'branchId', dz.branch_id::text,
      'name', dz.name,
      'postalCodes', to_jsonb(dz.postal_codes),
      'localities', to_jsonb(dz.localities),
      'settlementIds', coalesce((
        select pg_catalog.jsonb_agg(claimed.settlement_id::text order by claimed.settlement_id)
        from app.delivery_zone_settlements claimed
        where claimed.restaurant_id = dz.restaurant_id
          and claimed.branch_id = dz.branch_id
          and claimed.zone_id = dz.id
      ), '[]'::jsonb),
      'feeMinor', dz.fee_minor,
      'currency', dz.currency_code
    ) as row_json
    from app.delivery_zones dz
    where dz.restaurant_id = p_restaurant_id and dz.branch_id = p_branch_id
      and dz.deleted_at is null and dz.active
  ) z;

  return pg_catalog.jsonb_build_object('schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', p_restaurant_id::text, 'branchId', p_branch_id::text),
    'zones', v_zones);
end
$function$;

alter function app_private.list_active_delivery_zones_for_quote(uuid,uuid) owner to postgres;
revoke all on function app_private.list_active_delivery_zones_for_quote(uuid,uuid) from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.list_active_delivery_zones_for_quote(uuid,uuid) to app_api;

-- Upsert now accepts and maintains settlementIds alongside the legacy postal code membership.
create or replace function app_private.upsert_delivery_zone(p_actor_id uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_restaurant uuid;
  v_branch uuid;
  v_zone uuid;
  v_event uuid;
  v_device uuid;
  v_member uuid;
  v_expected bigint;
  v_occurred timestamptz;
  v_observed timestamptz;
  v_fingerprint text;
  v_name text;
  v_postal_codes text[];
  v_localities text[];
  v_settlement_ids uuid[];
  v_branch_locality text;
  v_branch_region text;
  v_fee bigint;
  v_currency text;
  v_active boolean;
  v_reason text;
  v_operation text;
  v_stored app.delivery_zone_command_events%rowtype;
  v_current app.delivery_zones%rowtype;
  v_result jsonb;
  v_keys text[] := array[
    'schemaVersion','scope','zoneId','expectedVersion','eventId','idempotencyKey','deviceId',
    'occurredAt','name','postalCodes','localities','settlementIds','feeMinor','currency','active','reason'
  ];
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_command, v_keys)
    or not app_private.jsonb_has_exact_keys(p_command -> 'scope', array['restaurantId','branchId'])
    or p_command -> 'schemaVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_command -> 'expectedVersion') is distinct from 'number'
    or not coalesce(p_command ->> 'expectedVersion' ~ '^(0|[1-9][0-9]*)$', false)
    or not coalesce(p_command ->> 'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    or pg_catalog.jsonb_typeof(p_command -> 'name') is distinct from 'string'
    or pg_catalog.char_length(pg_catalog.btrim(p_command ->> 'name')) not between 1 and 80
    or p_command ->> 'name' <> pg_catalog.btrim(p_command ->> 'name')
    or p_command ->> 'name' ~ '[[:cntrl:]]'
    or pg_catalog.jsonb_typeof(p_command -> 'postalCodes') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_command -> 'localities') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_command -> 'settlementIds') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_command -> 'feeMinor') is distinct from 'number'
    or not coalesce(p_command ->> 'feeMinor' ~ '^(0|[1-9][0-9]*)$', false)
    or pg_catalog.jsonb_typeof(p_command -> 'currency') is distinct from 'string'
    or p_command ->> 'currency' !~ '^[A-Z]{3}$'
    or pg_catalog.jsonb_typeof(p_command -> 'active') is distinct from 'boolean'
    or (p_command -> 'reason' <> 'null'::jsonb and (
      pg_catalog.jsonb_typeof(p_command -> 'reason') is distinct from 'string'
      or pg_catalog.char_length(pg_catalog.btrim(p_command ->> 'reason')) not between 1 and 500
      or p_command ->> 'reason' ~ '[[:cntrl:]]'
    ))
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    v_restaurant := (p_command #>> '{scope,restaurantId}')::uuid;
    v_branch := (p_command #>> '{scope,branchId}')::uuid;
    v_zone := (p_command ->> 'zoneId')::uuid;
    v_event := (p_command ->> 'eventId')::uuid;
    v_device := (p_command ->> 'deviceId')::uuid;
    v_expected := (p_command ->> 'expectedVersion')::bigint;
    v_occurred := (p_command ->> 'occurredAt')::timestamptz;
    select array_agg(pg_catalog.btrim(value::text)) into v_postal_codes
      from pg_catalog.jsonb_array_elements_text(p_command -> 'postalCodes') as value;
    select array_agg(pg_catalog.btrim(value::text)) into v_localities
      from pg_catalog.jsonb_array_elements_text(p_command -> 'localities') as value;
    select array_agg(distinct value::uuid) into v_settlement_ids
      from pg_catalog.jsonb_array_elements_text(p_command -> 'settlementIds') as value;
    v_fee := (p_command ->> 'feeMinor')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range
    or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  v_currency := p_command ->> 'currency';
  v_active := (p_command ->> 'active')::boolean;
  v_reason := case when p_command -> 'reason' = 'null'::jsonb then null else pg_catalog.btrim(p_command ->> 'reason') end;
  v_name := pg_catalog.btrim(p_command ->> 'name');
  v_postal_codes := coalesce(v_postal_codes, '{}');
  v_localities := coalesce(v_localities, '{}');
  v_settlement_ids := coalesce(v_settlement_ids, '{}');

  if v_restaurant is null or v_branch is null or v_zone is null or v_event is null or v_device is null
    or v_expected not between 0 and 9007199254740990 or v_occurred is null
    or p_command ->> 'occurredAt' is distinct from pg_catalog.to_char(v_occurred at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    -- A zone must be identifiable: at least one settlement or one legacy postal code. localities
    -- alone are inert by contract and cannot make a zone valid.
    or (pg_catalog.cardinality(v_postal_codes) = 0 and pg_catalog.cardinality(v_settlement_ids) = 0)
    or exists (select 1 from pg_catalog.unnest(v_postal_codes) v where v = '' or pg_catalog.char_length(v) > 20 or v ~ '[[:cntrl:]]')
    or exists (select 1 from pg_catalog.unnest(v_localities) v where v = '' or pg_catalog.char_length(v) > 120 or v ~ '[[:cntrl:]]')
    or pg_catalog.cardinality(v_postal_codes) <> (select count(distinct v) from pg_catalog.unnest(v_postal_codes) v)
    or pg_catalog.cardinality(v_localities) <> (select count(distinct v) from pg_catalog.unnest(v_localities) v)
    or (not v_active and v_reason is null)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  v_operation := case when v_expected = 0 then 'delivery_zone.created' else 'delivery_zone.updated' end;

  select m.id into v_member from app.memberships m
    join app.branches b on b.id = m.branch_id and b.restaurant_id = m.restaurant_id
    join app.restaurants r on r.id = m.restaurant_id
    join app.membership_role_grants g on g.membership_id = m.id
    where m.user_id = p_actor_id and m.restaurant_id = v_restaurant and m.branch_id = v_branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null
      and g.revoked_at is null and g.role_code in ('owner','admin','manager')
    order by g.role_code limit 1 for share of m, b, r, g;
  if v_member is null then return pg_catalog.jsonb_build_object('status','denied'); end if;

  select locality, region into v_branch_locality, v_branch_region
  from app.branches where restaurant_id = v_restaurant and id = v_branch;
  if v_branch_locality is null or v_branch_region is null then
    return pg_catalog.jsonb_build_object('status','conflict');
  end if;
  if exists (
    select 1 from pg_catalog.unnest(v_settlement_ids) requested(id)
    left join app.settlements s on s.id = requested.id
    where s.id is null or s.municipality <> v_branch_locality or s.state <> v_branch_region
  ) then
    return pg_catalog.jsonb_build_object('status','rejected');
  end if;

  v_fingerprint := encode(pg_catalog.sha256(convert_to(
    v_operation || ':' || p_command::text || ':' || p_actor_id::text, 'UTF8')), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'delivery-zone-command:' || p_actor_id::text || ':' || v_restaurant::text || ':' || v_branch::text
      || ':' || (p_command ->> 'idempotencyKey'), 0));

  select * into v_stored from app.delivery_zone_command_events where actor_id = p_actor_id
    and restaurant_id = v_restaurant and branch_id = v_branch and idempotency_key = p_command ->> 'idempotencyKey';
  if found then
    if v_stored.operation <> v_operation or v_stored.command_fingerprint <> v_fingerprint then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
    return pg_catalog.jsonb_build_object('schemaVersion', 1, 'zone', v_stored.result_zone, 'replayed', true);
  end if;

  if exists (select 1 from app.delivery_zone_command_events where event_id = v_event) then
    return pg_catalog.jsonb_build_object('status','conflict');
  end if;

  v_observed := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  if v_expected = 0 then
    if exists (select 1 from app.delivery_zones where restaurant_id = v_restaurant and branch_id = v_branch and id = v_zone) then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
    begin
      insert into app.delivery_zones (
        id, restaurant_id, branch_id, name, postal_codes, localities, fee_minor, currency_code,
        active, version, created_at, created_by, updated_at, updated_by
      ) values (
        v_zone, v_restaurant, v_branch, v_name, v_postal_codes, v_localities, v_fee, v_currency,
        v_active, 1, v_observed, p_actor_id, v_observed, p_actor_id
      );
      if v_active and pg_catalog.cardinality(v_postal_codes) > 0 then
        insert into app.delivery_zone_postal_codes (restaurant_id, branch_id, zone_id, postal_code)
        select v_restaurant, v_branch, v_zone, code from pg_catalog.unnest(v_postal_codes) code;
      end if;
      if v_active and pg_catalog.cardinality(v_settlement_ids) > 0 then
        insert into app.delivery_zone_settlements (restaurant_id, branch_id, zone_id, settlement_id)
        select v_restaurant, v_branch, v_zone, settlement_id from pg_catalog.unnest(v_settlement_ids) settlement_id;
      end if;
    exception when unique_violation then
      return pg_catalog.jsonb_build_object('status','conflict');
    end;
    select * into v_current from app.delivery_zones where restaurant_id = v_restaurant and branch_id = v_branch and id = v_zone;
  else
    select * into v_current from app.delivery_zones
      where restaurant_id = v_restaurant and branch_id = v_branch and id = v_zone for update;
    if not found or v_current.version <> v_expected or v_current.deleted_at is not null then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
    begin
      update app.delivery_zones set
        name = v_name, postal_codes = v_postal_codes, localities = v_localities, fee_minor = v_fee,
        currency_code = v_currency, active = v_active, version = v_expected + 1,
        updated_at = v_observed, updated_by = p_actor_id
        where restaurant_id = v_restaurant and branch_id = v_branch and id = v_zone;
      delete from app.delivery_zone_postal_codes where restaurant_id = v_restaurant and branch_id = v_branch and zone_id = v_zone;
      delete from app.delivery_zone_settlements where restaurant_id = v_restaurant and branch_id = v_branch and zone_id = v_zone;
      if v_active and pg_catalog.cardinality(v_postal_codes) > 0 then
        insert into app.delivery_zone_postal_codes (restaurant_id, branch_id, zone_id, postal_code)
        select v_restaurant, v_branch, v_zone, code from pg_catalog.unnest(v_postal_codes) code;
      end if;
      if v_active and pg_catalog.cardinality(v_settlement_ids) > 0 then
        insert into app.delivery_zone_settlements (restaurant_id, branch_id, zone_id, settlement_id)
        select v_restaurant, v_branch, v_zone, settlement_id from pg_catalog.unnest(v_settlement_ids) settlement_id;
      end if;
    exception when unique_violation then
      return pg_catalog.jsonb_build_object('status','conflict');
    end;
    select * into v_current from app.delivery_zones where restaurant_id = v_restaurant and branch_id = v_branch and id = v_zone;
  end if;

  v_result := app_private.delivery_zone_to_jsonb(v_current);

  insert into app.delivery_zone_command_events (
    event_id, restaurant_id, branch_id, zone_id, actor_id, actor_membership_id, device_id,
    operation, idempotency_key, command_fingerprint, expected_version, result_version,
    result_zone, reason, occurred_at, received_at
  ) values (
    v_event, v_restaurant, v_branch, v_zone, p_actor_id, v_member, v_device, v_operation,
    p_command ->> 'idempotencyKey', v_fingerprint, v_expected, v_expected + 1, v_result, v_reason,
    v_occurred, v_observed
  );

  return pg_catalog.jsonb_build_object('schemaVersion', 1, 'zone', v_result, 'replayed', false);
end
$function$;

alter function app_private.upsert_delivery_zone(uuid,jsonb) owner to postgres;
revoke all on function app_private.upsert_delivery_zone(uuid,jsonb) from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.upsert_delivery_zone(uuid,jsonb) to app_api;

-- Branch context grows additively with the geographic identity used by addresses and messages.
create or replace function app_private.read_branch_operational_context(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'roles', pg_catalog.array_agg(distinct role_grant.role_code order by role_grant.role_code)::text[],
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object(
      'branchId', branch.id,
      'restaurantId', restaurant.id
    ),
    'timeZone', restaurant.time_zone,
    'branchName', branch.name,
    'locality', branch.locality,
    'region', branch.region,
    'countryCode', branch.country_code
  )
  from app.memberships as membership
  join app.restaurants as restaurant
    on restaurant.id = membership.restaurant_id
   and restaurant.disabled_at is null
  join app.branches as branch
    on branch.id = membership.branch_id
   and branch.restaurant_id = membership.restaurant_id
   and branch.disabled_at is null
  join app.membership_role_grants as role_grant
    on role_grant.membership_id = membership.id
   and role_grant.revoked_at is null
  where membership.user_id = p_actor_id
    and membership.restaurant_id = p_restaurant_id
    and membership.branch_id = p_branch_id
    and membership.revoked_at is null
  group by branch.id, restaurant.id, restaurant.time_zone, branch.name, branch.locality, branch.region, branch.country_code;
$function$;

alter function app_private.read_branch_operational_context(uuid, uuid, uuid) owner to postgres;
revoke all on function app_private.read_branch_operational_context(uuid, uuid, uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.read_branch_operational_context(uuid, uuid, uuid) to app_api;

comment on function app_private.read_branch_operational_context(uuid, uuid, uuid) is
  'Returns roles, authoritative IANA time zone and Branch geographic identity (name/locality/region/countryCode) for one active actor/Restaurant/Branch membership.';

-- Address writer: accepts optional settlementId/settlementOutsideCatalog, resolves the catalog and
-- fills the derived text fields server-side. The client never decides postal code or city.
create or replace function app_private.mutate_customer_directory(p_actor_id uuid, p_operation text, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  restaurant uuid;
  branch uuid;
  customer uuid;
  entity uuid;
  event uuid;
  device uuid;
  member uuid;
  expected bigint;
  occurred timestamptz;
  observed timestamptz;
  fingerprint text;
  current_customer app.customers%rowtype;
  current_address app.customer_addresses%rowtype;
  stored app.customer_command_events%rowtype;
  result_record jsonb;
  field_name text;
  max_length integer;
  field_value jsonb;
  latitude integer;
  longitude integer;
  legacy_address_keys text[] := array['label','streetLine','unit','neighborhood','locality','region','countryCode','postalCode','references','instructions','coordinates'];
  v_settlement_id uuid;
  v_settlement_outside boolean;
  v_settlement app.settlements%rowtype;
  v_branch_locality text;
  v_branch_region text;
  v_branch_country text;
  v_neighborhood text;
  v_locality text;
  v_region text;
  v_country text;
  v_postal_code text;
  common_keys text[] := array['schemaVersion','scope','customerId','expectedVersion','eventId','deviceId','idempotencyKey','occurredAt'];
begin
  if p_actor_id is null or p_operation is null or p_operation not in ('customer.profile_saved','customer.address_saved','customer.address_validated')
    or not app_private.jsonb_has_exact_keys(p_command,
      case p_operation
        when 'customer.profile_saved' then common_keys || array['displayName','phones']
        when 'customer.address_saved' then common_keys || array['addressId','address']
        else common_keys || array['addressId'] end)
    or not app_private.jsonb_has_exact_keys(p_command -> 'scope', array['restaurantId','branchId'])
    or p_command -> 'schemaVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_command -> 'expectedVersion') is distinct from 'number'
    or not coalesce(p_command ->> 'expectedVersion' ~ '^(0|[1-9][0-9]*)$', false)
    or not coalesce(p_command ->> 'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;
  begin
    restaurant := (p_command #>> '{scope,restaurantId}')::uuid;
    branch := (p_command #>> '{scope,branchId}')::uuid;
    customer := (p_command ->> 'customerId')::uuid;
    entity := case when p_operation = 'customer.profile_saved' then customer else (p_command ->> 'addressId')::uuid end;
    event := (p_command ->> 'eventId')::uuid;
    device := (p_command ->> 'deviceId')::uuid;
    expected := (p_command ->> 'expectedVersion')::bigint;
    occurred := (p_command ->> 'occurredAt')::timestamptz;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or customer is null or entity is null or event is null or device is null
    or expected not between 0 and 9007199254740990 or occurred is null
    or p_command ->> 'occurredAt' is distinct from pg_catalog.to_char(occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    or (p_operation = 'customer.address_validated' and expected = 0)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  if p_operation = 'customer.profile_saved' then
    if pg_catalog.jsonb_typeof(p_command -> 'displayName') is distinct from 'string'
      or char_length(p_command ->> 'displayName') not between 1 and 120
      or p_command ->> 'displayName' <> btrim(p_command ->> 'displayName')
      or p_command ->> 'displayName' ~ '[[:cntrl:]]'
      or pg_catalog.jsonb_typeof(p_command -> 'phones') is distinct from 'array'
      or pg_catalog.jsonb_array_length(p_command -> 'phones') > 20
      or exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'phones') as phone
        where not app_private.jsonb_has_exact_keys(phone,array['contactId','label','displayValue'])
          or not coalesce(phone ->> 'contactId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
          or pg_catalog.jsonb_typeof(phone -> 'label') is distinct from 'string'
          or char_length(phone ->> 'label') not between 1 and 40 or phone ->> 'label' <> btrim(phone ->> 'label') or phone ->> 'label' ~ '[[:cntrl:]]'
          or pg_catalog.jsonb_typeof(phone -> 'displayValue') is distinct from 'string'
          or char_length(phone ->> 'displayValue') not between 1 and 80 or phone ->> 'displayValue' <> btrim(phone ->> 'displayValue')
          or phone ->> 'displayValue' !~ '^[+0-9 ().-]+$'
          or pg_catalog.translate(phone ->> 'displayValue',' ().-','') !~ '^\+?[0-9]{1,20}$')
      or (select count(*) from pg_catalog.jsonb_array_elements(p_command -> 'phones')) is distinct from
        (select count(distinct phone ->> 'contactId') from pg_catalog.jsonb_array_elements(p_command -> 'phones') as phone)
    then return pg_catalog.jsonb_build_object('status','rejected'); end if;
  elsif p_operation = 'customer.address_saved' then
    -- settlementId/settlementOutsideCatalog are additive, optional keys: a legacy client that never
    -- sends them keeps working, while the API sends the new shape. The text fields are revalidated
    -- against the catalog and Branch below; the client is never authoritative for them.
    if not (
      app_private.jsonb_has_exact_keys(p_command -> 'address', legacy_address_keys)
      or app_private.jsonb_has_exact_keys(p_command -> 'address', legacy_address_keys || array['settlementId'])
      or app_private.jsonb_has_exact_keys(p_command -> 'address', legacy_address_keys || array['settlementOutsideCatalog'])
      or app_private.jsonb_has_exact_keys(p_command -> 'address', legacy_address_keys || array['settlementId','settlementOutsideCatalog'])
    )
      or pg_catalog.jsonb_typeof(p_command #> '{address,label}') is distinct from 'string'
      or char_length(p_command #>> '{address,label}') not between 1 and 40
      or p_command #>> '{address,label}' <> btrim(p_command #>> '{address,label}')
      or p_command #>> '{address,label}' ~ '[[:cntrl:]]'
    then return pg_catalog.jsonb_build_object('status','rejected'); end if;
    if coalesce(p_command #> '{address,settlementId}', 'null'::jsonb) <> 'null'::jsonb then
      if pg_catalog.jsonb_typeof(p_command #> '{address,settlementId}') is distinct from 'string'
        or not coalesce(p_command #>> '{address,settlementId}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
      then return pg_catalog.jsonb_build_object('status','rejected'); end if;
    end if;
    if coalesce(p_command #> '{address,settlementOutsideCatalog}', 'null'::jsonb) <> 'null'::jsonb
      and pg_catalog.jsonb_typeof(p_command #> '{address,settlementOutsideCatalog}') is distinct from 'boolean'
    then return pg_catalog.jsonb_build_object('status','rejected'); end if;
    for field_name,max_length in select * from (values
      ('streetLine',200),('unit',200),('neighborhood',200),('locality',200),('region',200),('postalCode',200),('references',500),('instructions',500)
    ) as limits(name,maximum) loop
      field_value := p_command -> 'address' -> field_name;
      if field_value <> 'null'::jsonb and (pg_catalog.jsonb_typeof(field_value) is distinct from 'string'
        or char_length(field_value #>> '{}') not between 1 and max_length
        or field_value #>> '{}' <> btrim(field_value #>> '{}') or field_value #>> '{}' ~ '[[:cntrl:]]')
      then return pg_catalog.jsonb_build_object('status','rejected'); end if;
    end loop;
    if p_command #> '{address,countryCode}' <> 'null'::jsonb
      and (pg_catalog.jsonb_typeof(p_command #> '{address,countryCode}') is distinct from 'string'
        or p_command #>> '{address,countryCode}' !~ '^[A-Z]{2}$')
    then return pg_catalog.jsonb_build_object('status','rejected'); end if;
    if p_command #> '{address,coordinates}' <> 'null'::jsonb then
      if not app_private.jsonb_has_exact_keys(p_command #> '{address,coordinates}',array['latitudeE6','longitudeE6'])
        or pg_catalog.jsonb_typeof(p_command #> '{address,coordinates,latitudeE6}') is distinct from 'number'
        or pg_catalog.jsonb_typeof(p_command #> '{address,coordinates,longitudeE6}') is distinct from 'number'
        or not coalesce(p_command #>> '{address,coordinates,latitudeE6}' ~ '^-?(0|[1-9][0-9]*)$',false)
        or not coalesce(p_command #>> '{address,coordinates,longitudeE6}' ~ '^-?(0|[1-9][0-9]*)$',false)
      then return pg_catalog.jsonb_build_object('status','rejected'); end if;
      begin
        latitude := (p_command #>> '{address,coordinates,latitudeE6}')::integer;
        longitude := (p_command #>> '{address,coordinates,longitudeE6}')::integer;
      exception when numeric_value_out_of_range then return pg_catalog.jsonb_build_object('status','rejected'); end;
      if latitude not between -90000000 and 90000000 or longitude not between -180000000 and 180000000
      then return pg_catalog.jsonb_build_object('status','rejected'); end if;
    end if;
  end if;

  select m.id into member from app.memberships as m
    join app.branches as b on b.id = m.branch_id and b.restaurant_id = m.restaurant_id
    join app.restaurants as r on r.id = m.restaurant_id
    join app.membership_role_grants as g on g.membership_id = m.id
    where m.user_id = p_actor_id and m.restaurant_id = restaurant and m.branch_id = branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null and g.revoked_at is null
      and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
    order by g.role_code limit 1 for share of m,b,r,g;
  if member is null then return pg_catalog.jsonb_build_object('status','denied'); end if;

  if p_operation = 'customer.address_saved' then
    v_settlement_id := case when coalesce(p_command #> '{address,settlementId}', 'null'::jsonb) = 'null'::jsonb
      then null else (p_command #>> '{address,settlementId}')::uuid end;
    v_settlement_outside := coalesce((p_command #>> '{address,settlementOutsideCatalog}')::boolean, false);
    v_neighborhood := p_command #>> '{address,neighborhood}';
    v_locality := p_command #>> '{address,locality}';
    v_region := p_command #>> '{address,region}';
    v_country := p_command #>> '{address,countryCode}';
    v_postal_code := p_command #>> '{address,postalCode}';
    select locality, region, country_code into v_branch_locality, v_branch_region, v_branch_country
    from app.branches where restaurant_id = restaurant and id = branch;
    if v_settlement_id is not null then
      if v_settlement_outside then
        return pg_catalog.jsonb_build_object('status','rejected');
      end if;
      select * into v_settlement from app.settlements where id = v_settlement_id;
      if not found
        or v_settlement.municipality <> v_branch_locality
        or v_settlement.state <> v_branch_region
      then return pg_catalog.jsonb_build_object('status','rejected'); end if;
      -- Any text supplied alongside the settlement must agree with it; the server then fills the
      -- authoritative values so a forged postal code/city can never be persisted.
      if (v_neighborhood is not null and v_neighborhood <> v_settlement.name)
        or (v_postal_code is not null and v_postal_code <> v_settlement.postal_code)
        or (v_locality is not null and v_locality <> v_settlement.municipality)
        or (v_region is not null and v_region <> v_settlement.state)
        or (v_country is not null and v_country <> v_settlement.country_code)
      then return pg_catalog.jsonb_build_object('status','rejected'); end if;
      v_neighborhood := v_settlement.name;
      v_postal_code := v_settlement.postal_code;
      v_locality := v_settlement.municipality;
      v_region := v_settlement.state;
      v_country := v_settlement.country_code;
    elsif v_settlement_outside then
      if v_neighborhood is null or v_postal_code is not null then
        return pg_catalog.jsonb_build_object('status','rejected');
      end if;
      v_locality := v_branch_locality;
      v_region := v_branch_region;
      v_country := v_branch_country;
    end if;
  end if;

  fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_operation || ':' || p_command::text || ':' || p_actor_id::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'customer-command:' || p_actor_id::text || ':' || restaurant::text || ':' || branch::text || ':' || (p_command ->> 'idempotencyKey'),0));
  select * into stored from app.customer_command_events where actor_id = p_actor_id and restaurant_id = restaurant
    and branch_id = branch and idempotency_key = (p_command ->> 'idempotencyKey')::uuid;
  if found then
    if stored.operation <> p_operation or stored.command_fingerprint <> fingerprint
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    return pg_catalog.jsonb_build_object('status','replayed','record',stored.result_record);
  end if;

  begin
    if p_operation = 'customer.profile_saved' then
      if expected = 0 then
        observed := date_trunc('milliseconds',pg_catalog.clock_timestamp());
        insert into app.customers (id,restaurant_id,display_name,version,created_at,updated_at,created_by,updated_by)
          values (customer,restaurant,p_command ->> 'displayName',1,observed,observed,p_actor_id,p_actor_id)
          returning * into current_customer;
      else
        select * into current_customer from app.customers where restaurant_id = restaurant and id = customer for update;
        if not found or current_customer.version <> expected or current_customer.deleted_at is not null
        then return pg_catalog.jsonb_build_object('status','conflict'); end if;
        observed := greatest(date_trunc('milliseconds',pg_catalog.clock_timestamp()),current_customer.updated_at);
        update app.customers set display_name = p_command ->> 'displayName',version = expected + 1,
          updated_at = observed,updated_by = p_actor_id where restaurant_id = restaurant and id = customer
          returning * into current_customer;
      end if;
      update app.customer_phones set deleted_at = observed,updated_at = observed
        where restaurant_id = restaurant and customer_id = customer and deleted_at is null
          and not exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'phones') as phone
            where (phone ->> 'contactId')::uuid = contact_id);
      insert into app.customer_phones (restaurant_id,customer_id,contact_id,label,display_value,normalized_value,created_at,updated_at,deleted_at)
        select restaurant,customer,(phone ->> 'contactId')::uuid,phone ->> 'label',phone ->> 'displayValue',
          pg_catalog.translate(phone ->> 'displayValue',' ().-',''),observed,observed,null
        from pg_catalog.jsonb_array_elements(p_command -> 'phones') as phone
        on conflict (restaurant_id,customer_id,contact_id) do update set label = excluded.label,
          display_value = excluded.display_value,normalized_value = excluded.normalized_value,
          updated_at = excluded.updated_at,deleted_at = null;
      result_record := pg_catalog.jsonb_build_object('schemaVersion',1,'restaurantId',restaurant::text,'customerId',customer::text,
        'displayName',current_customer.display_name,'phones',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'contactId',phone ->> 'contactId','label',phone ->> 'label','displayValue',phone ->> 'displayValue',
          'normalizedValue',pg_catalog.translate(phone ->> 'displayValue',' ().-','')) order by ordinality)
          from pg_catalog.jsonb_array_elements(p_command -> 'phones') with ordinality as item(phone,ordinality)),'[]'::jsonb),
        'version',current_customer.version,
        'createdAt',pg_catalog.to_char(current_customer.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt',pg_catalog.to_char(current_customer.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'deletedAt',null);
    elsif p_operation = 'customer.address_saved' then
      perform 1 from app.customers where restaurant_id = restaurant and id = customer and deleted_at is null for share;
      if not found then return pg_catalog.jsonb_build_object('status','conflict'); end if;
      if expected = 0 then
        observed := date_trunc('milliseconds',pg_catalog.clock_timestamp());
        insert into app.customer_addresses (id,restaurant_id,customer_id,label,street_line,unit,neighborhood,locality,region,country_code,
          postal_code,references_text,instructions,latitude_e6,longitude_e6,settlement_id,settlement_outside_catalog,
          version,created_at,updated_at,created_by,updated_by)
        values (entity,restaurant,customer,p_command #>> '{address,label}',p_command #>> '{address,streetLine}',p_command #>> '{address,unit}',
          v_neighborhood,v_locality,v_region,v_country,
          v_postal_code,p_command #>> '{address,references}',p_command #>> '{address,instructions}',latitude,longitude,
          v_settlement_id,v_settlement_outside,
          1,observed,observed,p_actor_id,p_actor_id) returning * into current_address;
      else
        select * into current_address from app.customer_addresses where restaurant_id = restaurant and customer_id = customer and id = entity for update;
        if not found or current_address.version <> expected or current_address.deleted_at is not null
        then return pg_catalog.jsonb_build_object('status','conflict'); end if;
        observed := greatest(date_trunc('milliseconds',pg_catalog.clock_timestamp()),current_address.updated_at);
        update app.customer_addresses set label=p_command #>> '{address,label}',street_line=p_command #>> '{address,streetLine}',
          unit=p_command #>> '{address,unit}',neighborhood=v_neighborhood,locality=v_locality,
          region=v_region,country_code=v_country,postal_code=v_postal_code,
          references_text=p_command #>> '{address,references}',instructions=p_command #>> '{address,instructions}',latitude_e6=latitude,longitude_e6=longitude,
          settlement_id=v_settlement_id,settlement_outside_catalog=v_settlement_outside,
          validation_branch_id=null,validation_event_id=null,validated_by=null,validation_device_id=null,validated_at=null,
          version=expected+1,updated_at=observed,updated_by=p_actor_id
          where restaurant_id=restaurant and customer_id=customer and id=entity returning * into current_address;
      end if;
    else
      select * into current_address from app.customer_addresses where restaurant_id=restaurant and customer_id=customer and id=entity for update;
      if not found or current_address.version <> expected or current_address.deleted_at is not null
      then return pg_catalog.jsonb_build_object('status','conflict'); end if;
      if current_address.street_line is null or current_address.locality is null or current_address.country_code is null
      then return pg_catalog.jsonb_build_object('status','rejected'); end if;
      observed := greatest(date_trunc('milliseconds',pg_catalog.clock_timestamp()),current_address.updated_at);
      update app.customer_addresses set validation_branch_id=branch,validation_event_id=event,validated_by=p_actor_id,
        validation_device_id=device,validated_at=observed,version=expected+1,updated_at=observed,updated_by=p_actor_id
        where restaurant_id=restaurant and customer_id=customer and id=entity returning * into current_address;
    end if;

    if p_operation <> 'customer.profile_saved' then
      result_record := pg_catalog.jsonb_build_object('schemaVersion',1,'restaurantId',restaurant::text,'customerId',customer::text,
        'addressId',entity::text,'address',pg_catalog.jsonb_build_object('label',current_address.label,'streetLine',current_address.street_line,
          'unit',current_address.unit,'neighborhood',current_address.neighborhood,'locality',current_address.locality,'region',current_address.region,
          'countryCode',current_address.country_code,'postalCode',current_address.postal_code,'references',current_address.references_text,
          'instructions',current_address.instructions,'settlementId',current_address.settlement_id,
          'settlementOutsideCatalog',current_address.settlement_outside_catalog,
          'coordinates',case when current_address.latitude_e6 is null then null else
            pg_catalog.jsonb_build_object('latitudeE6',current_address.latitude_e6,'longitudeE6',current_address.longitude_e6) end),
        'validation',case when current_address.validation_branch_id is null then null else pg_catalog.jsonb_build_object(
          'branchId',current_address.validation_branch_id::text,'eventId',current_address.validation_event_id::text,
          'actorId',current_address.validated_by::text,'deviceId',current_address.validation_device_id::text,
          'validatedAt',pg_catalog.to_char(current_address.validated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) end,
        'version',current_address.version,
        'createdAt',pg_catalog.to_char(current_address.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt',pg_catalog.to_char(current_address.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'deletedAt',null);
    end if;

    insert into app.customer_command_events (event_id,restaurant_id,branch_id,customer_id,entity_kind,entity_id,
      actor_id,actor_membership_id,device_id,operation,idempotency_key,command_fingerprint,expected_version,result_version,
      result_record,occurred_at,received_at)
    values (event,restaurant,branch,customer,case when p_operation='customer.profile_saved' then 'profile' else 'address' end,entity,
      p_actor_id,member,device,p_operation,(p_command ->> 'idempotencyKey')::uuid,fingerprint,expected,expected+1,result_record,occurred,observed);
  exception when unique_violation then return pg_catalog.jsonb_build_object('status','conflict');
  end;
  return pg_catalog.jsonb_build_object('status','applied','record',result_record);
end
$function$;

alter function app_private.mutate_customer_directory(uuid,text,jsonb) owner to postgres;
revoke all on function app_private.mutate_customer_directory(uuid,text,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.mutate_customer_directory(uuid,text,jsonb) to app_api;

-- Fulfillment snapshot writer copies the resolved settlement facts into the immutable snapshot.
create or replace function app_private.set_capture_fulfillment(p_actor_id uuid,p_command jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  restaurant uuid;branch uuid;capture uuid;event uuid;device uuid;member uuid;lease uuid;party uuid;address uuid;snapshot uuid;
  expected bigint;address_version bigint;occurred timestamptz;observed timestamptz;fingerprint text;result_record jsonb;
  current_capture app.capture_drafts%rowtype;current_address app.customer_addresses%rowtype;stored app.capture_command_events%rowtype;
begin
  if p_actor_id is null or not app_private.jsonb_has_exact_keys(p_command,array['schemaVersion','scope','captureDraftId','expectedVersion','eventId','idempotencyKey','deviceId','occurredAt','attentionLeaseId','customerSnapshotRef','addressId','expectedAddressVersion'])
    or not app_private.jsonb_has_exact_keys(p_command->'scope',array['restaurantId','branchId']) or p_command->'schemaVersion' is distinct from '1'::jsonb
    or not coalesce(p_command->>'expectedVersion'~'^[1-9][0-9]*$',false) or not coalesce(p_command->>'idempotencyKey'~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
    or not ((p_command->'addressId'='null'::jsonb and p_command->'expectedAddressVersion'='null'::jsonb) or (jsonb_typeof(p_command->'addressId')='string' and jsonb_typeof(p_command->'expectedAddressVersion')='number' and coalesce(p_command->>'expectedAddressVersion'~'^[1-9][0-9]*$',false)))
  then return jsonb_build_object('status','rejected');end if;
  begin
    restaurant:=(p_command#>>'{scope,restaurantId}')::uuid;branch:=(p_command#>>'{scope,branchId}')::uuid;capture:=(p_command->>'captureDraftId')::uuid;
    event:=(p_command->>'eventId')::uuid;device:=(p_command->>'deviceId')::uuid;lease:=(p_command->>'attentionLeaseId')::uuid;party:=(p_command->>'customerSnapshotRef')::uuid;
    address:=(p_command->>'addressId')::uuid;expected:=(p_command->>'expectedVersion')::bigint;address_version:=(p_command->>'expectedAddressVersion')::bigint;occurred:=(p_command->>'occurredAt')::timestamptz;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then return jsonb_build_object('status','rejected');end;
  if restaurant is null or branch is null or capture is null or event is null or device is null or lease is null or party is null or expected not between 1 and 9007199254740990 or occurred is null
    or p_command#>>'{scope,restaurantId}' is distinct from restaurant::text or p_command#>>'{scope,branchId}' is distinct from branch::text
    or p_command->>'occurredAt' is distinct from to_char(occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    or (address is not null and address_version not between 1 and 9007199254740991) then return jsonb_build_object('status','rejected');end if;
  select m.id into member from app.memberships m join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id join app.restaurants r on r.id=m.restaurant_id
    join app.membership_role_grants g on g.membership_id=m.id where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null
      and g.revoked_at is null and g.role_code in('owner','admin','manager','supervisor','cashier','waiter') order by g.role_code limit 1 for share of m,b,r,g;
  if member is null then return jsonb_build_object('status','denied');end if;
  fingerprint:=encode(sha256(convert_to('capture.fulfillment_changed:'||p_command::text||':'||p_actor_id::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('capture-command:'||p_actor_id::text||':'||restaurant::text||':'||branch::text||':'||(p_command->>'idempotencyKey'),0));
  select * into stored from app.capture_command_events where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch and idempotency_key=p_command->>'idempotencyKey';
  if found then if stored.operation<>'capture.fulfillment_changed' or stored.command_fingerprint<>fingerprint then return jsonb_build_object('status','conflict');end if;return jsonb_build_object('status','replayed','record',stored.result_capture);end if;
  select * into current_capture from app.capture_drafts where restaurant_id=restaurant and branch_id=branch and id=capture for update;
  if not found or current_capture.version<>expected or current_capture.status<>'draft' or current_capture.customer_snapshot_id is distinct from party or current_capture.customer_id is null
    then return jsonb_build_object('status','conflict');end if;
  if address is not null then select * into current_address from app.customer_addresses where restaurant_id=restaurant and customer_id=current_capture.customer_id and id=address and deleted_at is null for share;
    if not found or current_address.version<>address_version or current_address.validation_branch_id is distinct from branch or current_address.validated_at is null
      or current_address.street_line is null or current_address.locality is null or current_address.country_code is null then return jsonb_build_object('status','conflict');end if;end if;
  observed:=greatest(date_trunc('milliseconds',clock_timestamp()),current_capture.updated_at);
  if current_capture.attention_status<>'claimed' or current_capture.owner_membership_id is distinct from member or current_capture.attention_lease_id is distinct from lease or current_capture.attention_lease_expires_at<=observed
    then return jsonb_build_object('status','conflict');end if;
  select result_capture into result_record from app.capture_command_events where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture and result_version=expected;
  if not found then raise exception using errcode='55000',message='CAPTURE_JOURNAL_CURRENT_VERSION_MISSING';end if;
  snapshot:=case when address is null then null else gen_random_uuid() end;
  result_record:=jsonb_set(result_record,'{detail}',(result_record->'detail')||jsonb_build_object('version',expected+1,'updatedAt',to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'fulfillmentSnapshotRef',snapshot::text));
  begin
    if address is not null then insert into app.customer_fulfillment_snapshots(id,restaurant_id,branch_id,customer_id,address_id,party_snapshot_id,label,street_line,unit,neighborhood,locality,region,country_code,postal_code,references_text,instructions,latitude_e6,longitude_e6,settlement_id,settlement_outside_catalog,validation_event_id,validated_by,validation_device_id,validated_at,created_at,created_by)
      values(snapshot,restaurant,branch,current_capture.customer_id,address,party,current_address.label,current_address.street_line,current_address.unit,current_address.neighborhood,current_address.locality,current_address.region,current_address.country_code,current_address.postal_code,current_address.references_text,current_address.instructions,current_address.latitude_e6,current_address.longitude_e6,current_address.settlement_id,current_address.settlement_outside_catalog,current_address.validation_event_id,current_address.validated_by,current_address.validation_device_id,current_address.validated_at,observed,p_actor_id);end if;
    update app.capture_drafts set fulfillment_snapshot_id=snapshot,version=expected+1,updated_at=observed,updated_by=p_actor_id where restaurant_id=restaurant and branch_id=branch and id=capture;
    insert into app.capture_command_events(event_id,restaurant_id,branch_id,capture_draft_id,actor_id,actor_membership_id,device_id,operation,idempotency_key,command_fingerprint,expected_version,result_version,result_capture,occurred_at,received_at)
      values(event,restaurant,branch,capture,p_actor_id,member,device,'capture.fulfillment_changed',p_command->>'idempotencyKey',fingerprint,expected,expected+1,result_record,occurred,observed);
  exception when unique_violation then return jsonb_build_object('status','conflict');end;
  return jsonb_build_object('status','applied','record',result_record);
end $function$;

alter function app_private.set_capture_fulfillment(uuid,jsonb) owner to postgres;
revoke all on function app_private.set_capture_fulfillment(uuid,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.set_capture_fulfillment(uuid,jsonb) to app_api;

-- Prefix/postal-code search for the colonia autocomplete. Global catalog, Branch-scoped results,
-- operational membership required.
create function app_private.search_settlements(p_actor_id uuid, p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_restaurant uuid;
  v_branch uuid;
  v_branch_name text;
  v_locality text;
  v_region text;
  v_country text;
  v_query text;
  v_postal_code text;
  v_limit integer;
  v_settlements jsonb;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_request, array['schemaVersion','scope','query','postalCode','limit'])
    or not app_private.jsonb_has_exact_keys(p_request -> 'scope', array['restaurantId','branchId'])
    or p_request -> 'schemaVersion' is distinct from '1'::jsonb
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    v_restaurant := (p_request #>> '{scope,restaurantId}')::uuid;
    v_branch := (p_request #>> '{scope,branchId}')::uuid;
  exception when invalid_text_representation then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if v_restaurant is null or v_branch is null then
    return pg_catalog.jsonb_build_object('status','rejected');
  end if;

  if pg_catalog.jsonb_typeof(p_request -> 'limit') is distinct from 'number'
    or not coalesce(p_request ->> 'limit' ~ '^(0|[1-9][0-9]*)$', false)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;
  v_limit := (p_request ->> 'limit')::integer;
  if v_limit not between 1 and 50 then
    return pg_catalog.jsonb_build_object('status','rejected');
  end if;

  if (p_request -> 'query' = 'null'::jsonb) = (p_request -> 'postalCode' = 'null'::jsonb) then
    return pg_catalog.jsonb_build_object('status','rejected');
  end if;
  if p_request -> 'query' <> 'null'::jsonb then
    if pg_catalog.jsonb_typeof(p_request -> 'query') is distinct from 'string' then
      return pg_catalog.jsonb_build_object('status','rejected');
    end if;
    v_query := app_private.normalize_settlement_name(p_request ->> 'query');
    if pg_catalog.char_length(v_query) not between 2 and 40 then
      return pg_catalog.jsonb_build_object('status','rejected');
    end if;
  else
    v_postal_code := p_request ->> 'postalCode';
    if v_postal_code is null or v_postal_code !~ '^[0-9]{5}$' then
      return pg_catalog.jsonb_build_object('status','rejected');
    end if;
  end if;

  if not exists (
    select 1 from app.memberships m
    join app.branches b on b.restaurant_id = m.restaurant_id and b.id = m.branch_id
    join app.restaurants r on r.id = m.restaurant_id
    join app.membership_role_grants g on g.membership_id = m.id
    where m.user_id = p_actor_id and m.restaurant_id = v_restaurant and m.branch_id = v_branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null
      and g.revoked_at is null
      and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  ) then return pg_catalog.jsonb_build_object('status','denied'); end if;

  select name, locality, region, country_code into v_branch_name, v_locality, v_region, v_country
  from app.branches where restaurant_id = v_restaurant and id = v_branch;
  if v_branch_name is null then
    return pg_catalog.jsonb_build_object('status','denied');
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'settlementId', s.id::text,
    'name', s.name,
    'postalCode', s.postal_code,
    'settlementType', s.settlement_type,
    'municipality', s.municipality,
    'state', s.state,
    'countryCode', s.country_code
  ) order by s.normalized_name, s.postal_code, s.settlement_type, s.id), '[]'::jsonb)
  into v_settlements
  from (
    select candidate.*
    from app.settlements candidate
    where candidate.municipality = v_locality and candidate.state = v_region
      and (
        (v_query is not null and candidate.normalized_name like v_query || '%')
        or (v_postal_code is not null and candidate.postal_code = v_postal_code)
      )
    order by
      case when v_query is not null and candidate.normalized_name = v_query then 0 else 1 end,
      candidate.normalized_name,
      candidate.postal_code,
      candidate.settlement_type,
      candidate.id
    limit v_limit
  ) s;

  return pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', v_restaurant::text, 'branchId', v_branch::text),
    'branch', pg_catalog.jsonb_build_object(
      'name', v_branch_name,
      'locality', v_locality,
      'region', v_region,
      'countryCode', v_country
    ),
    'settlements', v_settlements
  );
end
$function$;

alter function app_private.search_settlements(uuid,jsonb) owner to postgres;
revoke all on function app_private.search_settlements(uuid,jsonb) from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.search_settlements(uuid,jsonb) to app_api;

-- System revocation when the draft, its channel or its address snapshot changes. The journal row is
-- written before the current authorization row is removed; every removed authorization is audited.
create function app_private.revoke_capture_delivery_manual_fee_on_capture_change()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_fee app.capture_delivery_manual_fees%rowtype;
  v_fingerprint text;
begin
  if old.fulfillment_snapshot_id is not distinct from new.fulfillment_snapshot_id
    and old.fulfillment_channel is not distinct from new.fulfillment_channel
    and old.status is not distinct from new.status then
    return null;
  end if;
  for v_fee in
    select * from app.capture_delivery_manual_fees
    where restaurant_id = new.restaurant_id and branch_id = new.branch_id and capture_draft_id = new.id
  loop
    v_fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      'manual_fee.revoked:' || v_fee.capture_draft_id::text || ':' || v_fee.address_snapshot_ref::text
        || ':' || v_fee.version::text, 'UTF8')), 'hex');
    insert into app.capture_delivery_manual_fee_events (
      event_id, restaurant_id, branch_id, capture_draft_id, address_snapshot_ref,
      actor_id, actor_membership_id, device_id, operation, expected_version, result_version,
      fee_minor, currency_code, reason, role_code, authorized_at, received_at,
      idempotency_key, command_fingerprint
    ) values (
      pg_catalog.gen_random_uuid(), v_fee.restaurant_id, v_fee.branch_id, v_fee.capture_draft_id,
      v_fee.address_snapshot_ref, v_fee.actor_id, v_fee.actor_membership_id, v_fee.device_id,
      'manual_fee.revoked', v_fee.version, v_fee.version + 1, v_fee.fee_minor, v_fee.currency_code,
      'Revocada automáticamente: cambió el borrador, el canal o el snapshot de dirección.',
      v_fee.role_code, v_fee.authorized_at,
      greatest(pg_catalog.clock_timestamp(), v_fee.authorized_at),
      pg_catalog.gen_random_uuid(), v_fingerprint
    );
    delete from app.capture_delivery_manual_fees
    where restaurant_id = v_fee.restaurant_id and branch_id = v_fee.branch_id
      and capture_draft_id = v_fee.capture_draft_id and address_snapshot_ref = v_fee.address_snapshot_ref;
  end loop;
  return null;
end
$function$;

alter function app_private.revoke_capture_delivery_manual_fee_on_capture_change() owner to postgres;
revoke all on function app_private.revoke_capture_delivery_manual_fee_on_capture_change()
  from public, anon, authenticated, service_role, app_api;

create trigger capture_drafts_revoke_delivery_manual_fee
after update of fulfillment_snapshot_id, fulfillment_channel, status on app.capture_drafts
for each row execute function app_private.revoke_capture_delivery_manual_fee_on_capture_change();

comment on function app_private.revoke_capture_delivery_manual_fee_on_capture_change() is
  'Invalidates the current manual delivery fee (journaling manual_fee.revoked and deleting the row) when the capture leaves delivery/draft or changes its address snapshot.';

-- Authorize/update the current manual fee. Manager-tier + supervisor only; requires a resolved,
-- not-covered address snapshot; CAS by expectedVersion; idempotent by actor+scope+key+fingerprint.
create function app_private.set_capture_delivery_manual_fee(p_actor_id uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_restaurant uuid;
  v_branch uuid;
  v_capture uuid;
  v_snapshot uuid;
  v_event uuid;
  v_device uuid;
  v_expected bigint;
  v_occurred timestamptz;
  v_received timestamptz;
  v_fee bigint;
  v_currency text;
  v_reason text;
  v_idempotency uuid;
  v_fingerprint text;
  v_operation text;
  v_member uuid;
  v_role text;
  v_current app.capture_delivery_manual_fees%rowtype;
  v_stored app.capture_delivery_manual_fee_events%rowtype;
  v_draft app.capture_drafts%rowtype;
  v_address app.customer_fulfillment_snapshots%rowtype;
  v_covered boolean := false;
  v_result_version bigint;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_command, array[
      'schemaVersion','scope','captureDraftId','addressSnapshotRef','expectedVersion','feeMinor',
      'currency','reason','eventId','idempotencyKey','deviceId','occurredAt'])
    or not app_private.jsonb_has_exact_keys(p_command -> 'scope', array['restaurantId','branchId'])
    or p_command -> 'schemaVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_command -> 'expectedVersion') is distinct from 'number'
    or not coalesce(p_command ->> 'expectedVersion' ~ '^(0|[1-9][0-9]*)$', false)
    or pg_catalog.jsonb_typeof(p_command -> 'feeMinor') is distinct from 'number'
    or not coalesce(p_command ->> 'feeMinor' ~ '^(0|[1-9][0-9]*)$', false)
    or pg_catalog.jsonb_typeof(p_command -> 'currency') is distinct from 'string'
    or p_command ->> 'currency' !~ '^[A-Z]{3}$'
    or pg_catalog.jsonb_typeof(p_command -> 'reason') is distinct from 'string'
    or pg_catalog.char_length(pg_catalog.btrim(p_command ->> 'reason')) not between 1 and 500
    or p_command ->> 'reason' <> pg_catalog.btrim(p_command ->> 'reason')
    or p_command ->> 'reason' ~ '[[:cntrl:]]'
    or not coalesce(p_command ->> 'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    v_restaurant := (p_command #>> '{scope,restaurantId}')::uuid;
    v_branch := (p_command #>> '{scope,branchId}')::uuid;
    v_capture := (p_command ->> 'captureDraftId')::uuid;
    v_snapshot := (p_command ->> 'addressSnapshotRef')::uuid;
    v_event := (p_command ->> 'eventId')::uuid;
    v_device := (p_command ->> 'deviceId')::uuid;
    v_expected := (p_command ->> 'expectedVersion')::bigint;
    v_fee := (p_command ->> 'feeMinor')::bigint;
    v_occurred := (p_command ->> 'occurredAt')::timestamptz;
    v_idempotency := (p_command ->> 'idempotencyKey')::uuid;
  exception when invalid_text_representation or numeric_value_out_of_range
    or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  v_currency := p_command ->> 'currency';
  v_reason := pg_catalog.btrim(p_command ->> 'reason');

  if v_restaurant is null or v_branch is null or v_capture is null or v_snapshot is null
    or v_event is null or v_device is null or v_expected not between 0 and 9007199254740990
    or v_occurred is null
    or p_command ->> 'occurredAt' is distinct from pg_catalog.to_char(v_occurred at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  -- deliveries.manage = owner/admin/manager/supervisor; cashier/waiter/kitchen never.
  select m.id, granted.role_code into v_member, v_role
  from app.memberships m
  join app.branches b on b.id = m.branch_id and b.restaurant_id = m.restaurant_id
  join app.restaurants r on r.id = m.restaurant_id
  join lateral (
    select g.role_code from app.membership_role_grants g
    where g.membership_id = m.id and g.revoked_at is null
      and g.role_code in ('owner','admin','manager','supervisor')
    order by case g.role_code
      when 'owner' then 1 when 'admin' then 2 when 'manager' then 3 when 'supervisor' then 4 else 5 end
    limit 1
  ) granted on true
  where m.user_id = p_actor_id and m.restaurant_id = v_restaurant and m.branch_id = v_branch
    and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null
  for share of m, b, r;
  if v_member is null then return pg_catalog.jsonb_build_object('status','denied'); end if;

  v_fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'capture.delivery_manual_fee:' || p_command::text || ':' || p_actor_id::text, 'UTF8')), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'capture-command:' || p_actor_id::text || ':' || v_restaurant::text || ':' || v_branch::text
      || ':' || v_idempotency::text, 0));

  select * into v_stored from app.capture_delivery_manual_fee_events
  where actor_id = p_actor_id and restaurant_id = v_restaurant and branch_id = v_branch
    and idempotency_key = v_idempotency;
  if found then
    if v_stored.command_fingerprint <> v_fingerprint then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'manualFee', pg_catalog.jsonb_build_object(
        'eventId', v_stored.event_id::text,
        'captureDraftId', v_stored.capture_draft_id::text,
        'addressSnapshotRef', v_stored.address_snapshot_ref::text,
        'feeMinor', v_stored.fee_minor,
        'currency', v_stored.currency_code,
        'reason', v_stored.reason,
        'role', v_stored.role_code,
        'actorId', v_stored.actor_id::text,
        'authorizedAt', pg_catalog.to_char(v_stored.authorized_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'version', v_stored.result_version
      ),
      'replayed', true
    );
  end if;

  select * into v_draft from app.capture_drafts
  where restaurant_id = v_restaurant and branch_id = v_branch and id = v_capture for update;
  if not found or v_draft.status <> 'draft' or v_draft.fulfillment_channel <> 'delivery'
    or v_draft.fulfillment_snapshot_id is distinct from v_snapshot then
    return pg_catalog.jsonb_build_object('status','conflict');
  end if;

  select * into v_address from app.customer_fulfillment_snapshots
  where restaurant_id = v_restaurant and branch_id = v_branch and id = v_snapshot for share;
  if not found then
    return pg_catalog.jsonb_build_object('status','missing');
  end if;

  if v_address.settlement_id is not null then
    select exists (
      select 1 from app.delivery_zone_settlements dzs
      join app.delivery_zones dz
        on dz.restaurant_id = dzs.restaurant_id and dz.branch_id = dzs.branch_id and dz.id = dzs.zone_id
      where dzs.restaurant_id = v_restaurant and dzs.branch_id = v_branch
        and dzs.settlement_id = v_address.settlement_id
        and dz.deleted_at is null and dz.active
    ) into v_covered;
    if v_covered then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
  elsif v_address.settlement_outside_catalog then
    v_covered := false;
  else
    -- Unresolved legacy text is not eligible: the address must be resolved first.
    return pg_catalog.jsonb_build_object('status','rejected');
  end if;

  if v_expected = 0 then
    if exists (
      select 1 from app.capture_delivery_manual_fees
      where restaurant_id = v_restaurant and branch_id = v_branch
        and capture_draft_id = v_capture and address_snapshot_ref = v_snapshot
    ) then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
    v_operation := 'manual_fee.authorized';
    v_result_version := 1;
  else
    select * into v_current from app.capture_delivery_manual_fees
    where restaurant_id = v_restaurant and branch_id = v_branch
      and capture_draft_id = v_capture and address_snapshot_ref = v_snapshot for update;
    if not found or v_current.version <> v_expected then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
    v_operation := 'manual_fee.updated';
    v_result_version := v_expected + 1;
  end if;

  v_received := greatest(pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()), v_occurred);

  begin
    if v_expected = 0 then
      insert into app.capture_delivery_manual_fees (
        restaurant_id, branch_id, capture_draft_id, address_snapshot_ref, version,
        authorization_event_id, actor_id, actor_membership_id, device_id, fee_minor, currency_code,
        reason, role_code, authorized_at, received_at, idempotency_key, command_fingerprint
      ) values (
        v_restaurant, v_branch, v_capture, v_snapshot, 1, v_event, p_actor_id, v_member, v_device,
        v_fee, v_currency, v_reason, v_role, v_occurred, v_received, v_idempotency, v_fingerprint
      );
    else
      update app.capture_delivery_manual_fees set
        version = v_result_version, authorization_event_id = v_event, actor_id = p_actor_id,
        actor_membership_id = v_member, device_id = v_device, fee_minor = v_fee,
        currency_code = v_currency, reason = v_reason, role_code = v_role,
        authorized_at = v_occurred, received_at = v_received,
        idempotency_key = v_idempotency, command_fingerprint = v_fingerprint
        where restaurant_id = v_restaurant and branch_id = v_branch
          and capture_draft_id = v_capture and address_snapshot_ref = v_snapshot;
    end if;
  exception when unique_violation then
    return pg_catalog.jsonb_build_object('status','conflict');
  end;

  insert into app.capture_delivery_manual_fee_events (
    event_id, restaurant_id, branch_id, capture_draft_id, address_snapshot_ref,
    actor_id, actor_membership_id, device_id, operation, expected_version, result_version,
    fee_minor, currency_code, reason, role_code, authorized_at, received_at,
    idempotency_key, command_fingerprint
  ) values (
    v_event, v_restaurant, v_branch, v_capture, v_snapshot, p_actor_id, v_member, v_device,
    v_operation, case when v_operation = 'manual_fee.authorized' then 0 else v_expected end,
    v_result_version, v_fee, v_currency, v_reason, v_role, v_occurred, v_received,
    v_idempotency, v_fingerprint
  );

  -- Force a fresh quote/payment intent so no stale delivery fee survives the authorization.
  delete from app.capture_delivery_quotes
  where restaurant_id = v_restaurant and branch_id = v_branch and capture_draft_id = v_capture;
  delete from app.capture_payment_intents
  where restaurant_id = v_restaurant and branch_id = v_branch and capture_draft_id = v_capture;

  return pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'manualFee', pg_catalog.jsonb_build_object(
      'eventId', v_event::text,
      'captureDraftId', v_capture::text,
      'addressSnapshotRef', v_snapshot::text,
      'feeMinor', v_fee,
      'currency', v_currency,
      'reason', v_reason,
      'role', v_role,
      'actorId', p_actor_id::text,
      'authorizedAt', pg_catalog.to_char(v_occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'version', v_result_version
    ),
    'replayed', false
  );
end
$function$;

alter function app_private.set_capture_delivery_manual_fee(uuid,jsonb) owner to postgres;
revoke all on function app_private.set_capture_delivery_manual_fee(uuid,jsonb) from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.set_capture_delivery_manual_fee(uuid,jsonb) to app_api;

comment on function app_private.set_capture_delivery_manual_fee(uuid,jsonb) is
  'Authorizes or updates the manual delivery fee for one draft/address snapshot. deliveries.manage only; requires a resolved not-covered address; CAS by expectedVersion; idempotent by actor+scope+key+fingerprint; clears the draft quote and payment intent to force requoting.';

create function app_private.read_capture_delivery_manual_fee(p_actor_id uuid, p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_restaurant uuid;
  v_branch uuid;
  v_capture uuid;
  v_snapshot uuid;
  v_fee app.capture_delivery_manual_fees%rowtype;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_request, array['schemaVersion','scope','captureDraftId','addressSnapshotRef'])
    or not app_private.jsonb_has_exact_keys(p_request -> 'scope', array['restaurantId','branchId'])
    or p_request -> 'schemaVersion' is distinct from '1'::jsonb
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;
  begin
    v_restaurant := (p_request #>> '{scope,restaurantId}')::uuid;
    v_branch := (p_request #>> '{scope,branchId}')::uuid;
    v_capture := (p_request ->> 'captureDraftId')::uuid;
    v_snapshot := (p_request ->> 'addressSnapshotRef')::uuid;
  exception when invalid_text_representation then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if v_restaurant is null or v_branch is null or v_capture is null or v_snapshot is null then
    return pg_catalog.jsonb_build_object('status','rejected');
  end if;
  if not exists (
    select 1 from app.memberships m
    join app.branches b on b.restaurant_id = m.restaurant_id and b.id = m.branch_id
    join app.restaurants r on r.id = m.restaurant_id
    join app.membership_role_grants g on g.membership_id = m.id
    where m.user_id = p_actor_id and m.restaurant_id = v_restaurant and m.branch_id = v_branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null
      and g.revoked_at is null
      and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  ) then return pg_catalog.jsonb_build_object('status','denied'); end if;

  select * into v_fee from app.capture_delivery_manual_fees
  where restaurant_id = v_restaurant and branch_id = v_branch
    and capture_draft_id = v_capture and address_snapshot_ref = v_snapshot;
  if not found then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'scope', pg_catalog.jsonb_build_object('restaurantId', v_restaurant::text, 'branchId', v_branch::text),
      'manualFee', null
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', v_restaurant::text, 'branchId', v_branch::text),
    'manualFee', pg_catalog.jsonb_build_object(
      'eventId', v_fee.authorization_event_id::text,
      'captureDraftId', v_fee.capture_draft_id::text,
      'addressSnapshotRef', v_fee.address_snapshot_ref::text,
      'feeMinor', v_fee.fee_minor,
      'currency', v_fee.currency_code,
      'reason', v_fee.reason,
      'role', v_fee.role_code,
      'actorId', v_fee.actor_id::text,
      'authorizedAt', pg_catalog.to_char(v_fee.authorized_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'version', v_fee.version
    )
  );
end
$function$;

alter function app_private.read_capture_delivery_manual_fee(uuid,jsonb) owner to postgres;
revoke all on function app_private.read_capture_delivery_manual_fee(uuid,jsonb) from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.read_capture_delivery_manual_fee(uuid,jsonb) to app_api;

-- Confirmation now accepts a not-covered quote only when it carries a manual-fee override that
-- still matches the live authorization, compares the frozen charge against the effective fee, and
-- writes manualFee into the order charge and settlement facts into the order snapshot.
create or replace function app_private.confirm_capture_draft_v3(
  p_actor_id uuid,
  p_command jsonb,
  p_order jsonb,
  p_order_audits jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  restaurant uuid; branch uuid; capture uuid; requested_order_id uuid; member uuid;
  expected bigint; fingerprint text; catalog uuid; catalog_currency text;
  stored app.capture_command_events%rowtype;
  repeat_plan app.capture_repeat_order_plans%rowtype;
  stored_quote app.capture_delivery_quotes%rowtype;
  stored_intent app.capture_payment_intents%rowtype;
  current_fulfillment_snapshot uuid; current_channel text;
  fulfillment_change_version bigint; plan_change_version bigint;
  frozen_quote jsonb; frozen_intent jsonb;
  old_result jsonb; mutation_result jsonb; result_record jsonb; base_order jsonb;
  line_record record; item jsonb; expected_snapshot jsonb; expected_modifiers jsonb; expected_note jsonb;
  product app.menu_products%rowtype; line_variant_id uuid; variant_record app.menu_product_variants%rowtype;
  line_index bigint; item_count integer; write_status text;
  line_fraction jsonb; fraction_group_ids uuid[]; fraction_modifiers jsonb; fraction_breakdown jsonb;
  fraction_price bigint; slot_price bigint; slot_index integer; slot_value jsonb; fraction_name text;
  flavor_option app.menu_modifier_options%rowtype; extra_option app.menu_modifier_options%rowtype;
  extra_text text; label_text text;
  fr_enabled boolean; fr_flavor_group uuid; fr_extra_group uuid; fr_labels text[]; fr_locked uuid[]; fr_base bigint;
  line_pizza jsonb; pizza_input jsonb; pizza_result jsonb; pizza_modifiers jsonb;
  v_manual_fee app.capture_delivery_manual_fees%rowtype;
  v_effective_fee bigint;
  v_settlement_id uuid;
  v_settlement_outside boolean;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_command,array[
      'schemaVersion','scope','captureDraftId','expectedVersion','eventId','idempotencyKey','deviceId','occurredAt',
      'attentionLeaseId','orderId','shiftId','tableId','currency','timeZone'
    ])
    or not app_private.jsonb_has_exact_keys(p_command->'scope',array['restaurantId','branchId'])
    or p_command->'schemaVersion' is distinct from '2'::jsonb
    or not coalesce(p_command->>'expectedVersion' ~ '^[1-9][0-9]*$',false)
    or not coalesce(p_command->>'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
    or not coalesce(p_command->>'currency' ~ '^[A-Z]{3}$',false)
    or pg_catalog.char_length(p_command->>'timeZone') not between 1 and 100
    or (p_order is null) is distinct from (p_order_audits is null)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    restaurant := (p_command#>>'{scope,restaurantId}')::uuid;
    branch := (p_command#>>'{scope,branchId}')::uuid;
    capture := (p_command->>'captureDraftId')::uuid;
    requested_order_id := (p_command->>'orderId')::uuid;
    expected := (p_command->>'expectedVersion')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or capture is null or requested_order_id is null
    or expected not between 1 and 9007199254740990
    or p_command#>>'{scope,restaurantId}' is distinct from restaurant::text
    or p_command#>>'{scope,branchId}' is distinct from branch::text
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  select membership.id into member
  from app.memberships membership
  join app.branches b on b.id=membership.branch_id and b.restaurant_id=membership.restaurant_id
  join app.restaurants r on r.id=membership.restaurant_id
  join app.membership_role_grants grant_record on grant_record.membership_id=membership.id
  where membership.user_id=p_actor_id and membership.restaurant_id=restaurant and membership.branch_id=branch
    and membership.revoked_at is null and b.disabled_at is null and r.disabled_at is null
    and grant_record.revoked_at is null
    and grant_record.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  order by grant_record.role_code limit 1 for share of membership,b,r,grant_record;
  if member is null then return pg_catalog.jsonb_build_object('status','denied'); end if;

  fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'capture.confirmed.v3:'||p_command::text||':'||p_actor_id::text
  ,'UTF8'
  )),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'capture-command:'||p_actor_id::text||':'||restaurant::text||':'||branch::text||':'||(p_command->>'idempotencyKey'),0
  ));
  select * into stored from app.capture_command_events
  where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch
    and idempotency_key=p_command->>'idempotencyKey';
  if found then
    if stored.operation<>'capture.confirmed' or stored.command_fingerprint<>fingerprint
      or stored.capture_draft_id<>capture or stored.expected_version<>expected
      or stored.result_capture#>>'{detail,confirmedOrderId}' is distinct from requested_order_id::text
      or not exists (
        select 1 from app.orders confirmed
        join app.order_operational_shifts shift_link on shift_link.restaurant_id=confirmed.restaurant_id
          and shift_link.branch_id=confirmed.branch_id and shift_link.order_id=confirmed.id
        join app.order_fulfillment_snapshots frozen on frozen.restaurant_id=confirmed.restaurant_id
          and frozen.branch_id=confirmed.branch_id and frozen.order_id=confirmed.id
          and frozen.capture_draft_id=capture
        where confirmed.restaurant_id=restaurant and confirmed.branch_id=branch and confirmed.id=requested_order_id
          and shift_link.shift_id=(p_command->>'shiftId')::uuid
      )
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    return pg_catalog.jsonb_build_object('status','replayed','record',stored.result_capture);
  end if;
  if p_order is null then return pg_catalog.jsonb_build_object('status','pending'); end if;

  -- H23: deliveryCharge is an optional key here, exactly like tableId -- the codec omits it
  -- entirely when null (same optional-key convention as orderDiscount/tip) rather than always
  -- writing an explicit null, because persist_order_mutation's later item-add/state-change
  -- mutations require the persisted aggregate outside items/status to stay byte-for-byte
  -- identical; always re-adding the key here would break that equality against every order
  -- persisted without it (every non-delivery order, and every order confirmed before H13).
  if pg_catalog.jsonb_typeof(p_order)<>'object' or pg_catalog.jsonb_typeof(p_order_audits)<>'array'
    or not (
      app_private.jsonb_has_exact_keys(p_order,array[
        'schemaVersion','orderId','restaurantId','branchId','channel','currency','timeZone','status','items'
      ])
      or app_private.jsonb_has_exact_keys(p_order,array[
        'schemaVersion','orderId','restaurantId','branchId','channel','currency','timeZone','status','items','deliveryCharge'
      ])
      or app_private.jsonb_has_exact_keys(p_order,array[
        'schemaVersion','orderId','restaurantId','branchId','channel','tableId','currency','timeZone','status','items'
      ])
      or app_private.jsonb_has_exact_keys(p_order,array[
        'schemaVersion','orderId','restaurantId','branchId','channel','tableId','currency','timeZone','status','items','deliveryCharge'
      ])
    )
    or p_order->>'schemaVersion'<>'1'
    or p_order->>'restaurantId' is distinct from restaurant::text
    or p_order->>'branchId' is distinct from branch::text
    or p_order->>'orderId' is distinct from requested_order_id::text
    or p_order->>'currency' is distinct from p_command->>'currency'
    or p_order->>'timeZone' is distinct from p_command->>'timeZone'
    or p_order->>'status'<>'draft'
    or pg_catalog.jsonb_typeof(p_order->'items')<>'array'
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  item_count := pg_catalog.jsonb_array_length(p_order->'items');
  if pg_catalog.jsonb_array_length(p_order_audits)<>item_count+1
    or p_order_audits->0->>'operation'<>'order.created'
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  select * into repeat_plan from app.capture_repeat_order_plans plan
  where plan.restaurant_id=restaurant and plan.branch_id=branch and plan.capture_draft_id=capture for update;

  if not found then
    if item_count<>0 then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  else
    if (repeat_plan.plan_kind='repeat' and repeat_plan.applied_capture_version<>expected)
      or (repeat_plan.plan_kind='repeat' and repeat_plan.customer_id::text is distinct from repeat_plan.selection_plan->>'customerId')
      or pg_catalog.jsonb_array_length(repeat_plan.selection_plan->'lines')<>item_count
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;

    select head.catalog_id,catalog_record.currency into catalog,catalog_currency
    from app.menu_catalog_heads head
    join app.menu_catalogs catalog_record on catalog_record.restaurant_id=head.restaurant_id
      and catalog_record.id=head.catalog_id and catalog_record.version=head.version
    where head.restaurant_id=restaurant for share of head,catalog_record;
    if not found or catalog_currency is distinct from p_command->>'currency' then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;

    for line_record in
      select line.value, line.ordinality
      from pg_catalog.jsonb_array_elements(repeat_plan.selection_plan->'lines') with ordinality line(value,ordinality)
      order by line.ordinality
    loop
      begin
        select product_record.* into product
        from app.menu_products product_record
        join app.menu_categories category on category.restaurant_id=product_record.restaurant_id
          and category.catalog_id=product_record.catalog_id and category.id=product_record.category_id
        where product_record.restaurant_id=restaurant and product_record.catalog_id=catalog
          and product_record.id=(line_record.value->>'productId')::uuid
          and product_record.active and category.active;
      exception when invalid_text_representation then
        return pg_catalog.jsonb_build_object('status','conflict');
      end;
      if not found then return pg_catalog.jsonb_build_object('status','conflict'); end if;

      -- Catalog sizes: a sized product must name one active variant of this exact catalog release;
      -- a variant on a product without it, an inactive one, or a missing one on a sized product is
      -- a conflict. The frozen unit price below always comes from this catalog row, never the client.
      line_variant_id := null;
      variant_record := null;
      if pg_catalog.jsonb_typeof(line_record.value->'variantId')='string' then
        begin
          line_variant_id := (line_record.value->>'variantId')::uuid;
        exception when invalid_text_representation then
          return pg_catalog.jsonb_build_object('status','conflict');
        end;
        select variant_row.* into variant_record from app.menu_product_variants variant_row
        where variant_row.restaurant_id=restaurant and variant_row.catalog_id=catalog
          and variant_row.product_id=product.id and variant_row.id=line_variant_id and variant_row.active;
        if not found then return pg_catalog.jsonb_build_object('status','conflict'); end if;
      elsif exists (
        select 1 from app.menu_product_variants variant_row
        where variant_row.restaurant_id=restaurant and variant_row.catalog_id=catalog
          and variant_row.product_id=product.id and variant_row.active
      ) then return pg_catalog.jsonb_build_object('status','conflict');
      end if;

      -- Half-and-half: only a product with fractions enabled may be split. The setup is the
      -- product's own when it has one (any size, or no size), otherwise the legacy one of the chosen
      -- size. Its flavor and ingredient groups are priced by the fraction rules below and must
      -- arrive with empty selections.
      line_fraction := null;
      fraction_group_ids := '{}'::uuid[];
      if line_record.value ? 'fraction' then
        line_fraction := line_record.value->'fraction';
        if product.fraction_enabled or product.fraction_flavor_group_id is not null
          or product.fraction_extra_group_id is not null
          or pg_catalog.cardinality(product.fraction_excludable_ingredient_ids)>0
          or pg_catalog.cardinality(product.fraction_locked_ingredient_option_ids)>0
        then
          fr_enabled := product.fraction_enabled;
          fr_flavor_group := product.fraction_flavor_group_id;
          fr_extra_group := product.fraction_extra_group_id;
          fr_labels := product.fraction_excludable_ingredient_ids;
          fr_locked := product.fraction_locked_ingredient_option_ids;
        else
          fr_enabled := coalesce(variant_record.fraction_enabled,false);
          fr_flavor_group := variant_record.fraction_flavor_group_id;
          fr_extra_group := variant_record.fraction_extra_group_id;
          fr_labels := coalesce(variant_record.fraction_excludable_ingredient_ids,'{}'::text[]);
          fr_locked := coalesce(variant_record.fraction_locked_ingredient_option_ids,'{}'::uuid[]);
        end if;
        -- Base price of a half: the size price, or the product price without sizes.
        fr_base := coalesce(variant_record.unit_price_minor,product.unit_price_minor);
        if not fr_enabled or fr_flavor_group is null
          or not app_private.jsonb_has_exact_keys(line_fraction,array['geometry','slots'])
          or line_fraction->>'geometry' is distinct from 'halves'
          or pg_catalog.jsonb_typeof(line_fraction->'slots') is distinct from 'array'
          or pg_catalog.jsonb_array_length(line_fraction->'slots')<>2
          or (line_fraction->'slots'->0->'flavorOptionId'='null'::jsonb
            and line_fraction->'slots'->1->'flavorOptionId'='null'::jsonb)
        then return pg_catalog.jsonb_build_object('status','conflict'); end if;
        fraction_group_ids := pg_catalog.array_remove(array[fr_flavor_group,fr_extra_group],null);
      end if;

      -- Pizza V2 (plan schemaVersion 2): priced by the versioned halves rule from the catalog release.
      -- The line names half-a's product and size; the base and extra groups of that product are priced
      -- by the rule and must arrive with empty selections, exactly like the legacy fraction groups.
      line_pizza := null;
      pizza_modifiers := '[]'::jsonb;
      if line_record.value ? 'pizza' then
        if line_record.value ? 'fraction' or product.pizza_mode is null
        then return pg_catalog.jsonb_build_object('status','conflict'); end if;
        line_pizza := line_record.value->'pizza';
        if line_pizza->>'ruleVersion' = 'pizza-halves-v1' then
          return pg_catalog.jsonb_build_object('status','conflict','reason','rule_version_legacy');
        elsif line_pizza->>'ruleVersion' is distinct from 'pizza-halves-v2' then
          return pg_catalog.jsonb_build_object('status','conflict','reason','rule_version_unknown');
        end if;
        fraction_group_ids := pg_catalog.array_remove(
          array[product.base_group_id] || product.extra_group_ids, null
        );
        pizza_input := app_private.build_pizza_halves_input_v2(restaurant,catalog,catalog_currency,line_record.value);
        if pizza_input is null then return pg_catalog.jsonb_build_object('status','conflict'); end if;
        if not app_private.pizza_quantities_valid(restaurant,catalog,line_record.value)
        then return pg_catalog.jsonb_build_object('status','conflict','reason','pizza_quantity_invalid'); end if;
        pizza_result := app_private.pizza_halves_price_v2(pizza_input);
        if pizza_result ? 'issues' then
          return pg_catalog.jsonb_build_object('status','conflict','reason',pizza_result->'issues'->0->>'code');
        end if;
        -- Every charge (free ones at zero) and every removal becomes a frozen modifier; the line total is
        -- the base price plus these amounts, which equals the rule's total.
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'modifierId','pizza-'||(charge.value->>'role')||':'
            ||(case when pg_catalog.jsonb_array_length(charge.value->'fractions')=2 then 'both'
               else charge.value->'fractions'->>0 end)||':'||(charge.value->>'optionId'),
          'name',charge.value->>'name',
          'groupId',case charge.value->>'role' when 'ingredient' then 'pizza-ingredient' else 'pizza-extra' end,
          'groupName',(charge.value->>'role')||':'
            ||(case when pg_catalog.jsonb_array_length(charge.value->'fractions')=2 then 'both'
               else charge.value->'fractions'->>0 end),
          'groupCatalogVersion',catalog::text,
          'unitPrice',charge.value->'amount',
          'quantity',1
        ) order by charge.ordinality),'[]'::jsonb) into pizza_modifiers
        from pg_catalog.jsonb_array_elements(pizza_result->'charges') with ordinality charge(value,ordinality);
        pizza_modifiers := pizza_modifiers||coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'modifierId','exclude:'||(pizza_half.value->>'fraction')||':'||removed.value,
            'name','Sin '||removed_option.name,
            'groupId','fraction-exclusion','groupName','exclude:'||(pizza_half.value->>'fraction'),
            'groupCatalogVersion',catalog::text,
            'unitPrice',pg_catalog.jsonb_build_object('amountMinor',0,'currency',catalog_currency),
            'quantity',1
          ) order by pizza_half.ordinality,removed.ordinality)
          from pg_catalog.jsonb_array_elements(pizza_result->'halves') with ordinality pizza_half(value,ordinality)
          cross join lateral pg_catalog.jsonb_array_elements_text(pizza_half.value->'removedIngredientOptionIds')
            with ordinality removed(value,ordinality)
          join app.menu_products removed_product on removed_product.restaurant_id=restaurant
            and removed_product.catalog_id=catalog and removed_product.id=(pizza_half.value->>'productId')::uuid
          join app.menu_modifier_options removed_option on removed_option.restaurant_id=restaurant
            and removed_option.catalog_id=catalog and removed_option.group_id=removed_product.base_group_id
            and removed_option.id=removed.value::uuid
        ),'[]'::jsonb);
      end if;

      if exists (
        select 1 from app.menu_modifier_groups catalog_group
        left join lateral (
          select requested.value from pg_catalog.jsonb_array_elements(line_record.value->'modifierGroups') requested(value)
          where requested.value->>'groupId'=catalog_group.id::text
        ) requested_group on true
        where catalog_group.restaurant_id=restaurant and catalog_group.catalog_id=catalog
          and exists (select 1 from app.menu_product_modifier_groups assigned
            where assigned.restaurant_id=catalog_group.restaurant_id and assigned.catalog_id=catalog_group.catalog_id
              and assigned.group_id=catalog_group.id and assigned.product_id=product.id)
          and not (catalog_group.id = any(fraction_group_ids))
          and (not catalog_group.active or requested_group.value is null)
      ) or exists (
        select 1 from pg_catalog.jsonb_array_elements(line_record.value->'modifierGroups') requested_group(value)
        left join app.menu_modifier_groups catalog_group on catalog_group.restaurant_id=restaurant
          and catalog_group.catalog_id=catalog
          and exists (select 1 from app.menu_product_modifier_groups assigned
            where assigned.restaurant_id=catalog_group.restaurant_id and assigned.catalog_id=catalog_group.catalog_id
              and assigned.group_id=catalog_group.id and assigned.product_id=product.id)
          and catalog_group.id=(requested_group.value->>'groupId')::uuid
        where catalog_group.id is null
          or (catalog_group.id = any(fraction_group_ids)
            and pg_catalog.jsonb_array_length(requested_group.value->'selections')<>0)
          or (not (catalog_group.id = any(fraction_group_ids)) and (not catalog_group.active
            or (select coalesce(pg_catalog.sum((selection.value->>'quantity')::integer),0)
                from pg_catalog.jsonb_array_elements(requested_group.value->'selections') selection(value))
              not between catalog_group.minimum_quantity and catalog_group.maximum_quantity))
      ) or exists (
        select 1 from pg_catalog.jsonb_array_elements(line_record.value->'modifierGroups') requested_group(value)
        cross join lateral pg_catalog.jsonb_array_elements(requested_group.value->'selections') selection(value)
        left join app.menu_modifier_options option_record on option_record.restaurant_id=restaurant
          and option_record.catalog_id=catalog and option_record.group_id=(requested_group.value->>'groupId')::uuid
          and option_record.id=(selection.value->>'optionId')::uuid
        where option_record.id is null or not option_record.active
          or (option_record.maximum_quantity is not null
            and (selection.value->>'quantity')::integer>option_record.maximum_quantity)
      ) then return pg_catalog.jsonb_build_object('status','conflict'); end if;

      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'modifierId',option_record.id::text,
        'name',option_record.name,
        'groupId',catalog_group.id::text,
        'groupName',catalog_group.name,
        'groupCatalogVersion',catalog::text,
        'unitPrice',pg_catalog.jsonb_build_object('amountMinor',option_record.unit_price_minor,'currency',catalog_currency),
        'quantity',(selection.value->>'quantity')::integer
      ) order by catalog_group.display_order,catalog_group.id,option_record.id),'[]'::jsonb) into expected_modifiers
      from pg_catalog.jsonb_array_elements(line_record.value->'modifierGroups') requested_group(value)
      cross join lateral pg_catalog.jsonb_array_elements(requested_group.value->'selections') selection(value)
      join app.menu_modifier_groups catalog_group on catalog_group.restaurant_id=restaurant
        and catalog_group.catalog_id=catalog
        and exists (select 1 from app.menu_product_modifier_groups assigned
          where assigned.restaurant_id=catalog_group.restaurant_id and assigned.catalog_id=catalog_group.catalog_id
            and assigned.group_id=catalog_group.id and assigned.product_id=product.id)
        and catalog_group.id=(requested_group.value->>'groupId')::uuid
      join app.menu_modifier_options option_record on option_record.restaurant_id=restaurant
        and option_record.catalog_id=catalog and option_record.group_id=catalog_group.id
        and option_record.id=(selection.value->>'optionId')::uuid;

      fraction_modifiers := '[]'::jsonb;
      fraction_breakdown := '[]'::jsonb;
      fraction_price := 0;
      if line_fraction is not null then
        begin
          for slot_index in 0..1 loop
            slot_value := line_fraction->'slots'->slot_index;
            fraction_name := case slot_index when 0 then 'half-a' else 'half-b' end;
            if not app_private.jsonb_has_exact_keys(slot_value,array['fraction','flavorOptionId','extraOptionIds','excludedIngredientIds'])
              or slot_value->>'fraction' is distinct from fraction_name
              or pg_catalog.jsonb_typeof(slot_value->'extraOptionIds') is distinct from 'array'
              or pg_catalog.jsonb_typeof(slot_value->'excludedIngredientIds') is distinct from 'array'
              or pg_catalog.jsonb_array_length(slot_value->'extraOptionIds')>5
              or (pg_catalog.jsonb_array_length(slot_value->'extraOptionIds')>0 and fr_extra_group is null)
              or (slot_value->'flavorOptionId'='null'::jsonb and fr_extra_group is null)
              or (select pg_catalog.count(distinct extra_value.value)<>pg_catalog.count(*)
                  from pg_catalog.jsonb_array_elements_text(slot_value->'extraOptionIds') extra_value(value))
              or (select pg_catalog.count(distinct label_value.value)<>pg_catalog.count(*)
                  from pg_catalog.jsonb_array_elements_text(slot_value->'excludedIngredientIds') label_value(value))
            then return pg_catalog.jsonb_build_object('status','conflict'); end if;

            if slot_value->'flavorOptionId'='null'::jsonb then
              -- A half built ingredient by ingredient costs the base price and is frozen without a flavor.
              slot_price := fr_base;
              fraction_price := greatest(fraction_price,slot_price);
              fraction_breakdown := fraction_breakdown||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'fraction',fraction_name,'flavorOptionId','custom',
                'flavorName','Armada','amountMinor',slot_price
              ));
            else
              select option_record.* into flavor_option
              from app.menu_modifier_options option_record
              join app.menu_modifier_groups option_group on option_group.restaurant_id=option_record.restaurant_id
                and option_group.catalog_id=option_record.catalog_id and option_group.id=option_record.group_id
              where option_record.restaurant_id=restaurant and option_record.catalog_id=catalog
                and option_record.group_id=fr_flavor_group
                and option_record.id=(slot_value->>'flavorOptionId')::uuid
                and option_record.active and option_group.active;
              if not found then return pg_catalog.jsonb_build_object('status','conflict'); end if;
              -- A flavor priced at zero takes the base price; the greater half sets the unit price.
              slot_price := case when flavor_option.unit_price_minor=0 then fr_base
                else flavor_option.unit_price_minor end;
              fraction_price := greatest(fraction_price,slot_price);
              fraction_breakdown := fraction_breakdown||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'fraction',fraction_name,'flavorOptionId',flavor_option.id::text,
                'flavorName',flavor_option.name,'amountMinor',slot_price
              ));
            end if;

            for extra_text in
              select extra_value.value from pg_catalog.jsonb_array_elements_text(slot_value->'extraOptionIds')
                with ordinality extra_value(value,ordinality) order by extra_value.ordinality
            loop
              select option_record.* into extra_option
              from app.menu_modifier_options option_record
              join app.menu_modifier_groups option_group on option_group.restaurant_id=option_record.restaurant_id
                and option_group.catalog_id=option_record.catalog_id and option_group.id=option_record.group_id
              where option_record.restaurant_id=restaurant and option_record.catalog_id=catalog
                and option_record.group_id=fr_extra_group
                and option_record.id=extra_text::uuid
                and option_record.active and option_group.active;
              if not found then return pg_catalog.jsonb_build_object('status','conflict'); end if;
              -- A half carries half the extra's price, rounded up to the minor unit.
              fraction_modifiers := fraction_modifiers||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'modifierId','extra:'||fraction_name||':'||extra_option.id::text,
                'name',extra_option.name,'groupId','fraction-extra','groupName','extra:'||fraction_name,
                'groupCatalogVersion',catalog::text,
                'unitPrice',pg_catalog.jsonb_build_object(
                  'amountMinor',(extra_option.unit_price_minor+1)/2,'currency',catalog_currency
                ),
                'quantity',1
              ));
            end loop;

            for label_text in
              select label_value.value from pg_catalog.jsonb_array_elements_text(slot_value->'excludedIngredientIds')
                with ordinality label_value(value,ordinality) order by label_value.ordinality
            loop
              if label_text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
                select * into extra_option
                from app.menu_modifier_options
                where restaurant_id = restaurant and catalog_id = catalog
                  and group_id = fr_extra_group and id = label_text::uuid
                  and active;
                if not found or (label_text::uuid = any(fr_locked)) then
                  return pg_catalog.jsonb_build_object('status','conflict');
                end if;
                fraction_modifiers := fraction_modifiers||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                  'modifierId','exclude:'||fraction_name||':'||label_text,
                  'name','Sin '||extra_option.name,'groupId','fraction-exclusion','groupName','exclude:'||fraction_name,
                  'groupCatalogVersion',catalog::text,
                  'unitPrice',pg_catalog.jsonb_build_object('amountMinor',0,'currency',catalog_currency),
                  'quantity',1
                ));
              else
                if not (label_text = any(fr_labels))
                then return pg_catalog.jsonb_build_object('status','conflict'); end if;
                fraction_modifiers := fraction_modifiers||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                  'modifierId','exclude:'||fraction_name||':'||label_text,
                  'name','Sin '||label_text,'groupId','fraction-exclusion','groupName','exclude:'||fraction_name,
                  'groupCatalogVersion',catalog::text,
                  'unitPrice',pg_catalog.jsonb_build_object('amountMinor',0,'currency',catalog_currency),
                  'quantity',1
                ));
              end if;
            end loop;
          end loop;
        exception when invalid_text_representation or invalid_parameter_value then
          return pg_catalog.jsonb_build_object('status','conflict');
        end;
      end if;

      expected_snapshot := pg_catalog.jsonb_build_object(
        'catalogVersion',catalog::text,'productId',product.id::text,'name',product.name,
        'stationId',product.station_id,'unit',product.unit,
        'unitPrice',pg_catalog.jsonb_build_object(
          'amountMinor',case when line_pizza is not null then (pizza_result#>>'{basePrice,amountMinor}')::bigint
            when line_fraction is not null then fraction_price
            else coalesce(variant_record.unit_price_minor,product.unit_price_minor) end,
          'currency',catalog_currency
        ),
        'modifiers',expected_modifiers||fraction_modifiers||pizza_modifiers
      );
      if line_fraction is not null then
        expected_snapshot := expected_snapshot||pg_catalog.jsonb_build_object(
          'geometry','halves','fractionBreakdown',fraction_breakdown
        );
      end if;
      if line_pizza is not null then
        expected_snapshot := expected_snapshot||pg_catalog.jsonb_build_object(
          'geometry','halves','pizzaHalves',pizza_result
        );
      end if;
      if coalesce(variant_record.sku,product.sku) is not null then
        expected_snapshot := expected_snapshot||pg_catalog.jsonb_build_object('sku',coalesce(variant_record.sku,product.sku));
      end if;
      if variant_record.id is not null then
        expected_snapshot := expected_snapshot||pg_catalog.jsonb_build_object(
          'variantId',variant_record.id::text,'variantName',variant_record.name
        );
      end if;
      if product.tax_id is not null then
        expected_snapshot := expected_snapshot||pg_catalog.jsonb_build_object('tax',pg_catalog.jsonb_build_object(
          'taxId',product.tax_id,'name',product.tax_name,'taxRuleVersion',product.tax_rule_version,
          'rate',pg_catalog.jsonb_build_object(
            'numerator',product.tax_rate_numerator::text,'denominator',product.tax_rate_denominator::text
          ),'inclusion',product.tax_inclusion
        ));
      end if;

      if line_record.value ? 'note' then
        expected_note := line_record.value->'note';
      else
        expected_note := 'null'::jsonb;
      end if;

      item := p_order#>array['items',(line_record.ordinality-1)::text];
      if item is null
        or not app_private.jsonb_has_exact_keys(item,array[
          'orderItemId','snapshot','quantity','restaurantId','branchId','status','note'
        ])
        or not coalesce(item->>'orderItemId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
        or item->>'quantity' is distinct from line_record.value->>'quantity'
        or item->>'restaurantId' is distinct from restaurant::text
        or item->>'branchId' is distinct from branch::text
        or item->>'status'<>'pending'
        or item->'snapshot' is distinct from expected_snapshot
        or item->'note' is distinct from expected_note
      then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    end loop;
  end if;

  -- Freeze the delivery quote and payment intent, if any.
  select fulfillment_snapshot_id, fulfillment_channel into current_fulfillment_snapshot, current_channel
  from app.capture_drafts
  where restaurant_id=restaurant and branch_id=branch and id=capture for share;

  select * into stored_quote from app.capture_delivery_quotes
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture for share;
  -- Defense in depth: clear_capture_delivery_quote_for_channel already deletes this row the
  -- instant fulfillment_snapshot_id changes, so this should never actually find a mismatch; it
  -- exists purely to fail closed rather than freeze an inconsistent quote/address pairing.
  if found and stored_quote.quote->>'addressSnapshotRef' is distinct from current_fulfillment_snapshot::text then
    return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_quote_stale');
  end if;
  frozen_quote := case when found then stored_quote.quote else null end;

  -- H10: a delivery capture can never confirm without a live, coverage-eligible quote. This is
  -- deliberately stricter than the staleness check above, which only guards against an
  -- address/snapshot mismatch; here we also require the frozen quote to still be in-date and
  -- actually cover the address. H14: expiry is judged against the server's own clock
  -- (clock_timestamp()), not the client-supplied occurredAt -- a client can't extend a quote's
  -- life by lying about when its command "occurred".
  if current_channel = 'delivery' then
    if frozen_quote is null then
      return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_quote_missing');
    end if;
    if frozen_quote->>'coverageStatus' = 'not_covered' then
      if pg_catalog.jsonb_typeof(frozen_quote->'override') is distinct from 'object'
        or (frozen_quote->'override' ? 'kind' and frozen_quote#>>'{override,kind}' is distinct from 'manual_fee') then
        return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_quote_not_covered');
      end if;
      select * into v_manual_fee from app.capture_delivery_manual_fees
      where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture
        and address_snapshot_ref=current_fulfillment_snapshot for share;
      if not found
        or v_manual_fee.fee_minor is distinct from (frozen_quote#>>'{override,feeMinor}')::bigint
        or v_manual_fee.reason is distinct from frozen_quote#>>'{override,reason}'
        or v_manual_fee.role_code is distinct from frozen_quote#>>'{override,role}'
        or v_manual_fee.actor_id::text is distinct from frozen_quote#>>'{override,actorId}'
        or pg_catalog.to_char(v_manual_fee.authorized_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          is distinct from frozen_quote#>>'{override,overriddenAt}'
        or (frozen_quote->'override' ? 'eventId'
          and v_manual_fee.authorization_event_id::text is distinct from frozen_quote#>>'{override,eventId}')
        or (frozen_quote->'override' ? 'currency'
          and v_manual_fee.currency_code is distinct from frozen_quote#>>'{override,currency}')
      then
        return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_manual_fee_stale');
      end if;
    elsif pg_catalog.jsonb_typeof(frozen_quote->'override')='object' then
      return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_quote_override_not_authorized');
    elsif (frozen_quote->>'expiresAt')::timestamptz <= clock_timestamp() then
      return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_quote_expired');
    end if;
    -- H13: the Order's frozen delivery charge must be exactly the server's own frozen quote --
    -- never relaxed to "close enough", and never trusted from the client without this check. The
    -- API is expected to materialize it from this same quote, but a stale API read (the quote
    -- moved between the API's workspace read and this transaction) must surface as a conflict,
    -- not silently persist a mismatched charge.
    v_effective_fee := case when pg_catalog.jsonb_typeof(frozen_quote->'override')='object'
      then (frozen_quote#>>'{override,feeMinor}')::bigint else (frozen_quote->>'feeMinor')::bigint end;
    if p_order->'deliveryCharge' is null or pg_catalog.jsonb_typeof(p_order->'deliveryCharge')<>'object'
      or not (
        app_private.jsonb_has_exact_keys(p_order->'deliveryCharge',array['amount','quoteId'])
        or app_private.jsonb_has_exact_keys(p_order->'deliveryCharge',array['amount','quoteId','manualFee'])
      )
      or pg_catalog.jsonb_typeof(p_order#>'{deliveryCharge,amount}')<>'object'
      or not app_private.jsonb_has_exact_keys(p_order#>'{deliveryCharge,amount}',array['amountMinor','currency'])
      or (p_order#>'{deliveryCharge,amount,amountMinor}')::text::numeric is distinct from v_effective_fee::numeric
      or p_order#>>'{deliveryCharge,amount,currency}' is distinct from p_order->>'currency'
      or p_order#>>'{deliveryCharge,quoteId}' is distinct from frozen_quote->>'quoteId'
    then
      return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_charge_mismatch');
    end if;
    if pg_catalog.jsonb_typeof(frozen_quote->'override')='object' then
      if p_order#>'{deliveryCharge,manualFee}' is distinct from pg_catalog.jsonb_build_object(
        'eventId', v_manual_fee.authorization_event_id::text,
        'actorId', v_manual_fee.actor_id::text,
        'role', v_manual_fee.role_code,
        'reason', v_manual_fee.reason,
        'authorizedAt', pg_catalog.to_char(v_manual_fee.authorized_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) then
        return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_manual_fee_stale');
      end if;
    elsif p_order#>'{deliveryCharge,manualFee}' is not null
      and p_order#>'{deliveryCharge,manualFee}' <> 'null'::jsonb then
      return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_manual_fee_stale');
    end if;
  -- H23: the key is optional (see the shape check above), so a non-delivery order may omit it
  -- entirely -- that must be accepted exactly like an explicit null, never rejected.
  elsif (p_order ? 'deliveryCharge') and p_order->'deliveryCharge' is distinct from 'null'::jsonb then
    return pg_catalog.jsonb_build_object('status','rejected');
  end if;

  -- Staleness is decided from the actual facts that could have invalidated the intent since it
  -- was set, not from whether ANY unrelated mutation (e.g. delivery instructions) advanced the
  -- draft's version: the selection/repeat plan's change history (H16: read from the command
  -- journal, not repeat_plan.applied_capture_version -- that row is shared by both plan kinds,
  -- but replace_capture_selection_plan DELETES it outright when the selection is cleared to zero
  -- lines, which would otherwise silently reset "the plan's version" to null/0 and hide a real,
  -- intent-invalidating change; capture.selection_replaced/capture.order_repeated are logged
  -- unconditionally, including on that clearing delete, so this is immune to it), the frozen
  -- quote's applied_capture_version, and the version at which the fulfillment/address snapshot
  -- itself last changed (capture.fulfillment_changed). A payment intent set before any of those
  -- moved on is still valid, even if the draft's overall version advanced for an unrelated
  -- reason in between.
  select max(events.result_version) into fulfillment_change_version
  from app.capture_command_events events
  where events.restaurant_id=restaurant and events.branch_id=branch and events.capture_draft_id=capture
    and events.operation='capture.fulfillment_changed';

  select max(events.result_version) into plan_change_version
  from app.capture_command_events events
  where events.restaurant_id=restaurant and events.branch_id=branch and events.capture_draft_id=capture
    and events.operation in ('capture.selection_replaced','capture.order_repeated');

  select * into stored_intent from app.capture_payment_intents
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture for share;
  if not found then
    frozen_intent := null;
  elsif coalesce(plan_change_version,0) > stored_intent.applied_capture_version
    or coalesce(stored_quote.applied_capture_version,0) > stored_intent.applied_capture_version
    or coalesce(fulfillment_change_version,0) > stored_intent.applied_capture_version
  then
    return pg_catalog.jsonb_build_object('status','conflict','reason','payment_intent_stale');
  else
    frozen_intent := stored_intent.intent;
  end if;

  begin
    base_order := pg_catalog.jsonb_set(p_order,'{items}','[]'::jsonb,false);
    old_result := app_private.confirm_capture_draft(p_actor_id,p_command,base_order,p_order_audits->0);
    if old_result->>'status'='denied' then
      write_status := 'denied';
      raise exception using errcode='P5100',message='CAPTURE_CONFIRMATION_ATOMIC_ABORT';
    end if;
    if old_result->>'status'<>'applied' then
      write_status := 'conflict';
      raise exception using errcode='P5100',message='CAPTURE_CONFIRMATION_ATOMIC_ABORT';
    end if;
    result_record := old_result->'record';

    if item_count>0 then
      for line_index in 1..item_count loop
        mutation_result := app_private.persist_order_mutation(
          p_actor_id,
          line_index,
          pg_catalog.jsonb_set(p_order,'{items}',(
            select pg_catalog.jsonb_agg(prefix.value order by prefix.ordinality)
            from pg_catalog.jsonb_array_elements(p_order->'items') with ordinality prefix(value,ordinality)
            where prefix.ordinality<=line_index
          ),false),
          p_order_audits->line_index::integer
        );
        if mutation_result->>'status'='forbidden' then
          write_status := 'denied';
          raise exception using errcode='P5100',message='CAPTURE_CONFIRMATION_ATOMIC_ABORT';
        end if;
        if mutation_result->>'status'<>'saved' then
          write_status := 'conflict';
          raise exception using errcode='P5100',message='CAPTURE_CONFIRMATION_ATOMIC_ABORT';
        end if;
      end loop;
    end if;

    -- Additive: the stored snapshot is written as schemaVersion 1 (parseOrderFulfillmentSnapshotV1's
    -- exact key set). Merging deliveryQuote/paymentIntent without also bumping schemaVersion to 2
    -- would leave an object with 12 keys claiming to be schemaVersion 1, which every V1 parser
    -- (an exact-keys match) then rejects outright. schemaVersion 2 is parseOrderFulfillmentSnapshotV2's
    -- contract (shared-types): identical to V1 plus these two nullable fields, nothing else changes.
    select settlement_id, settlement_outside_catalog into v_settlement_id, v_settlement_outside
    from app.customer_fulfillment_snapshots
    where restaurant_id=restaurant and branch_id=branch and id=current_fulfillment_snapshot;

    update app.order_fulfillment_snapshots
    set snapshot = pg_catalog.jsonb_set(
      snapshot || pg_catalog.jsonb_build_object(
        'schemaVersion', 2, 'deliveryQuote', frozen_quote, 'paymentIntent', frozen_intent
      ),
      '{fulfillmentSnapshot}',
      case when pg_catalog.jsonb_typeof(snapshot->'fulfillmentSnapshot')='object'
        then (snapshot->'fulfillmentSnapshot') || pg_catalog.jsonb_build_object(
          'settlementId', v_settlement_id::text,
          'settlementOutsideCatalog', coalesce(v_settlement_outside, false)
        )
        else snapshot->'fulfillmentSnapshot' end
    )
    where restaurant_id=restaurant and branch_id=branch and order_id=requested_order_id
      and capture_draft_id=capture;
    if not found then raise exception using errcode='55000',message='CAPTURE_CONFIRMATION_SNAPSHOT_MISSING'; end if;

    update app.capture_command_events set command_fingerprint=fingerprint
    where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch
      and idempotency_key=p_command->>'idempotencyKey' and operation='capture.confirmed'
      and capture_draft_id=capture and expected_version=expected;
    if not found then raise exception using errcode='55000',message='CAPTURE_CONFIRMATION_EVENT_MISSING'; end if;
  exception when sqlstate 'P5100' then
    return pg_catalog.jsonb_build_object('status',write_status);
  end;

  return pg_catalog.jsonb_build_object('status','applied','record',result_record);
end
$function$;

-- Backfill helpers. They are idempotent and exposed without grants only for the rollback verifier.
create function app_private.backfill_delivery_zone_settlements()
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_inserted bigint := 0;
  v_conflicts bigint := 0;
  v_empty_postal_codes bigint := 0;
begin
  with candidates as (
    select dz.restaurant_id, dz.branch_id, dz.id as zone_id, s.id as settlement_id
    from app.delivery_zones dz
    join app.branches b on b.restaurant_id = dz.restaurant_id and b.id = dz.branch_id
    join app.delivery_zone_postal_codes dpc
      on dpc.restaurant_id = dz.restaurant_id and dpc.branch_id = dz.branch_id and dpc.zone_id = dz.id
    join app.settlements s
      on s.postal_code = dpc.postal_code and s.municipality = b.locality and s.state = b.region
    where dz.active and dz.deleted_at is null
  ), inserted as (
    insert into app.delivery_zone_settlements (restaurant_id, branch_id, zone_id, settlement_id)
    select restaurant_id, branch_id, zone_id, settlement_id from candidates
    on conflict do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  select count(*) into v_conflicts
  from app.delivery_zones dz
  join app.delivery_zone_postal_codes dpc
    on dpc.restaurant_id = dz.restaurant_id and dpc.branch_id = dz.branch_id and dpc.zone_id = dz.id
  join app.branches b on b.restaurant_id = dz.restaurant_id and b.id = dz.branch_id
  join app.settlements s
    on s.postal_code = dpc.postal_code and s.municipality = b.locality and s.state = b.region
  where dz.active and dz.deleted_at is null
    and not exists (
      select 1 from app.delivery_zone_settlements claimed
      where claimed.restaurant_id = dz.restaurant_id and claimed.branch_id = dz.branch_id
        and claimed.zone_id = dz.id and claimed.settlement_id = s.id
    )
    and exists (
      select 1 from app.delivery_zone_settlements other
      where other.restaurant_id = dz.restaurant_id and other.branch_id = dz.branch_id
        and other.settlement_id = s.id
    );

  select count(*) into v_empty_postal_codes
  from app.delivery_zones dz
  where dz.active and dz.deleted_at is null
    and pg_catalog.cardinality(dz.postal_codes) > 0
    and not exists (
      select 1 from app.delivery_zone_postal_codes dpc
      join app.branches b on b.restaurant_id = dz.restaurant_id and b.id = dz.branch_id
      join app.settlements s
        on s.postal_code = dpc.postal_code and s.municipality = b.locality and s.state = b.region
      where dpc.restaurant_id = dz.restaurant_id and dpc.branch_id = dz.branch_id and dpc.zone_id = dz.id
    );

  return pg_catalog.jsonb_build_object(
    'inserted', v_inserted,
    'conflicts', v_conflicts,
    'postalCodesWithoutSettlements', v_empty_postal_codes
  );
end
$function$;

alter function app_private.backfill_delivery_zone_settlements() owner to postgres;
revoke all on function app_private.backfill_delivery_zone_settlements() from public, anon, authenticated, service_role, app_api;

create function app_private.backfill_customer_address_settlements()
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_resolved bigint := 0;
  v_ambiguous bigint := 0;
  v_unknown bigint := 0;
  v_postal_code_mismatch bigint := 0;
  v_record record;
  v_candidate app.settlements%rowtype;
  v_count integer;
  v_matched uuid;
begin
  for v_record in
    select a.restaurant_id, a.customer_id, a.id, a.neighborhood, a.postal_code
    from app.customer_addresses a
    where a.deleted_at is null and a.settlement_id is null and a.settlement_outside_catalog = false
      and a.neighborhood is not null
    order by a.restaurant_id, a.customer_id, a.id
  loop
    select count(*), min(id::text)::uuid into v_count, v_matched
    from app.settlements
    where normalized_name = app_private.normalize_settlement_name(v_record.neighborhood)
      and municipality = 'Navojoa' and state = 'Sonora';

    if v_count = 0 then
      v_unknown := v_unknown + 1;
      continue;
    elsif v_count > 1 then
      if v_record.postal_code is null then
        v_ambiguous := v_ambiguous + 1;
        continue;
      end if;
      select count(*), min(id::text)::uuid into v_count, v_matched
      from app.settlements
      where normalized_name = app_private.normalize_settlement_name(v_record.neighborhood)
        and municipality = 'Navojoa' and state = 'Sonora'
        and postal_code = v_record.postal_code;
      if v_count <> 1 then
        v_ambiguous := v_ambiguous + 1;
        continue;
      end if;
    end if;

    select * into v_candidate from app.settlements where id = v_matched;
    if v_record.postal_code is not null and v_record.postal_code <> v_candidate.postal_code then
      v_postal_code_mismatch := v_postal_code_mismatch + 1;
      continue;
    end if;

    update app.customer_addresses
    set settlement_id = v_candidate.id,
        postal_code = coalesce(v_record.postal_code, v_candidate.postal_code),
        locality = coalesce(locality, v_candidate.municipality),
        region = coalesce(region, v_candidate.state),
        country_code = coalesce(country_code, v_candidate.country_code),
        updated_at = pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
    where restaurant_id = v_record.restaurant_id and customer_id = v_record.customer_id
      and id = v_record.id and settlement_id is null;
    v_resolved := v_resolved + 1;
  end loop;

  return pg_catalog.jsonb_build_object(
    'resolved', v_resolved,
    'ambiguous', v_ambiguous,
    'unknown', v_unknown,
    'postalCodeMismatch', v_postal_code_mismatch
  );
end
$function$;

alter function app_private.backfill_customer_address_settlements() owner to postgres;
revoke all on function app_private.backfill_customer_address_settlements() from public, anon, authenticated, service_role, app_api;

do $backfill$
begin
  raise notice 'delivery_zone_settlements backfill: %', app_private.backfill_delivery_zone_settlements();
  raise notice 'customer_addresses settlements backfill: %', app_private.backfill_customer_address_settlements();
end
$backfill$;

commit;
