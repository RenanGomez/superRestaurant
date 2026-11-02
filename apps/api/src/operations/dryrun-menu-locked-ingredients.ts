import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPostgresSchemaVerificationSession,
  readReadOnlySchemaVerificationConfig,
  type SchemaVerificationConfig,
  type SchemaVerificationSession,
} from "./schema-verification.js";

// Read-only dry-run for menu-locked-ingredients migration:
// Evaluates the mapping of legacy string labels in `fraction_excludable_ingredient_ids`
// to modifier option IDs in `app.menu_modifier_options`.
// Always BEGIN TRANSACTION READ ONLY / ROLLBACK; never mutates state.

export interface DryrunRow {
  readonly restaurant_id: string;
  readonly fracciones_afectadas: string;
  readonly total_etiquetas: string;
  readonly etiquetas_mapeadas: string;
  readonly etiquetas_no_mapeadas: string;
  readonly etiquetas_duplicadas: string;
  readonly fracciones_sin_grupo_ingredientes: string;
}

export interface DryrunMenuLockedIngredientsResult {
  readonly rows: readonly DryrunRow[];
}

export const DRYRUN_SQL = `with unnested as (
  select
    p.restaurant_id,
    p.catalog_id,
    p.id as product_id,
    null::uuid as variant_id,
    p.fraction_extra_group_id as ingredient_group_id,
    label
  from app.menu_products p
  cross join lateral unnest(p.fraction_excludable_ingredient_ids) as label
  where p.fraction_enabled and p.fraction_extra_group_id is not null
  union all
  select
    v.restaurant_id,
    v.catalog_id,
    v.product_id,
    v.id as variant_id,
    v.fraction_extra_group_id as ingredient_group_id,
    label
  from app.menu_product_variants v
  cross join lateral unnest(v.fraction_excludable_ingredient_ids) as label
  where v.fraction_enabled and v.fraction_extra_group_id is not null
),
matches as (
  select
    u.restaurant_id,
    u.catalog_id,
    u.product_id,
    u.variant_id,
    u.ingredient_group_id,
    u.label,
    (
      select count(*)
      from app.menu_modifier_options o
      where o.restaurant_id = u.restaurant_id
        and o.catalog_id = u.catalog_id
        and o.group_id = u.ingredient_group_id
        and lower(trim(o.name)) = lower(trim(u.label))
    ) as match_count
  from unnested u
)
select
  m.restaurant_id,
  count(distinct (m.product_id::text || ':' || coalesce(m.variant_id::text, 'prod'))) as fracciones_afectadas,
  count(*) as total_etiquetas,
  count(*) filter (where m.ingredient_group_id is not null and m.match_count = 1) as etiquetas_mapeadas,
  count(*) filter (where m.ingredient_group_id is null or m.match_count = 0) as etiquetas_no_mapeadas,
  count(*) filter (where m.ingredient_group_id is not null and m.match_count > 1) as etiquetas_duplicadas,
  count(distinct (m.product_id::text || ':' || coalesce(m.variant_id::text, 'prod')))
    filter (where m.ingredient_group_id is null) as fracciones_sin_grupo_ingredientes
from matches m group by m.restaurant_id order by m.restaurant_id;`;

export async function runDryrunMenuLockedIngredients(
  config: SchemaVerificationConfig,
  createSession: (config: SchemaVerificationConfig) => SchemaVerificationSession = createPostgresSchemaVerificationSession,
): Promise<DryrunMenuLockedIngredientsResult> {
  const session = createSession(config);
  try {
    await session.connect();
    await session.query("BEGIN TRANSACTION READ ONLY;");
    const result = await session.query(DRYRUN_SQL);
    await session.query("ROLLBACK;");
    return { rows: Object.freeze(result.rows as DryrunRow[]) };
  } finally {
    await session.close();
  }
}

async function main(): Promise<void> {
  const config = readReadOnlySchemaVerificationConfig(process.env);
  const result = await runDryrunMenuLockedIngredients(config);
  process.stdout.write(`${JSON.stringify({ stage: "dryrun_menu_locked_ingredients", ...result })}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "DRYRUN_FAILED";
    process.stderr.write(`${JSON.stringify({ stage: "dryrun_menu_locked_ingredients", status: "failed", message })}\n`);
    process.exitCode = 1;
  });
}
