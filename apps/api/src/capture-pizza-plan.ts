import {
  parseCaptureLineQuoteRequestV1,
  parseCaptureSelectionPlanV1,
  parseReplaceCaptureSelectionPlanCommandV1,
  type CaptureLineQuoteRequestV1,
  type CaptureSelectionLineV1,
  type CaptureSelectionPlanV1,
  type ReplaceCaptureSelectionPlanCommandV1,
} from "@super-restaurant/shared-types";

/** Version of the halves rule a V2 plan line asks for; SQL rejects every other value. */
export const CAPTURE_PIZZA_RULE_V2 = "pizza-halves-v2" as const;
export const CAPTURE_SELECTION_PLAN_SCHEMA_VERSION_V2 = 2 as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_OPTIONS_PER_ROLE = 60;

export interface CapturePizzaHalfV2 {
  readonly fraction: "half-a" | "half-b";
  readonly productId: string;
  /** `null` for a product sold without sizes, exactly like the V1 line. */
  readonly variantId: string | null;
  readonly ingredientOptionIds: readonly string[];
  readonly extraOptionIds: readonly string[];
  readonly removedIngredientOptionIds: readonly string[];
}

export interface CapturePizzaLineV2 {
  readonly ruleVersion: typeof CAPTURE_PIZZA_RULE_V2;
  readonly halves: readonly [CapturePizzaHalfV2, CapturePizzaHalfV2];
}

/** A V2 replace command: the V1-shaped envelope (pizza stripped) plus the validated pizza lines by lineId. */
export interface ReplaceCaptureSelectionPlanCommandV2 {
  readonly command: ReplaceCaptureSelectionPlanCommandV1;
  readonly pizzaByLineId: ReadonlyMap<string, CapturePizzaLineV2>;
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const own = Object.keys(value);
  if (own.length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) return undefined;
  return value as Record<string, unknown>;
}

function uuidList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_OPTIONS_PER_ROLE) return undefined;
  const ids = value.map((entry) => (typeof entry === "string" && UUID.test(entry) ? entry.toLowerCase() : undefined));
  if (ids.some((id) => id === undefined) || new Set(ids).size !== ids.length) return undefined;
  return ids as string[];
}

function parseHalf(value: unknown): CapturePizzaHalfV2 | undefined {
  const half = record(value, ["fraction", "productId", "variantId", "ingredientOptionIds", "extraOptionIds", "removedIngredientOptionIds"]);
  if (half === undefined) return undefined;
  const { fraction, productId, variantId } = half;
  if ((fraction !== "half-a" && fraction !== "half-b")
    || typeof productId !== "string" || !UUID.test(productId)
    || (variantId !== null && (typeof variantId !== "string" || !UUID.test(variantId)))) return undefined;
  const ingredientOptionIds = uuidList(half.ingredientOptionIds);
  const extraOptionIds = uuidList(half.extraOptionIds);
  const removedIngredientOptionIds = uuidList(half.removedIngredientOptionIds);
  if (ingredientOptionIds === undefined || extraOptionIds === undefined || removedIngredientOptionIds === undefined) return undefined;
  // An option is one role per half: it cannot be both an ingredient and an extra, nor added and removed.
  const all = [...ingredientOptionIds, ...extraOptionIds];
  if (new Set(all).size !== all.length || removedIngredientOptionIds.some((id) => all.includes(id))) return undefined;
  return { extraOptionIds, fraction, ingredientOptionIds, productId: productId.toLowerCase(), removedIngredientOptionIds, variantId: variantId === null ? null : variantId.toLowerCase() };
}

/** Fail-closed parse of one `pizza` object; the halves must be exactly half-a and half-b. */
export function parseCapturePizzaLineV2(value: unknown): CapturePizzaLineV2 | undefined {
  const pizza = record(value, ["ruleVersion", "halves"]);
  if (pizza === undefined || pizza.ruleVersion !== CAPTURE_PIZZA_RULE_V2 || !Array.isArray(pizza.halves) || pizza.halves.length !== 2) return undefined;
  const parsed = pizza.halves.map(parseHalf);
  const [first, second] = parsed;
  if (first === undefined || second === undefined || first.fraction === second.fraction) return undefined;
  return { halves: first.fraction === "half-a" ? [first, second] : [second, first], ruleVersion: CAPTURE_PIZZA_RULE_V2 };
}

/**
 * Parses a replace command whose plan is schemaVersion 2. Pizza lines are exclusive with `fraction`, and the
 * line product/variant must be half-a's. Anything else (including schemaVersion 1) returns undefined: V1 stays
 * on the shared parser, and unknown versions fail closed.
 */
export function parseReplaceCaptureSelectionPlanCommandV2(value: unknown): ReplaceCaptureSelectionPlanCommandV2 | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const plan = (value as { plan?: unknown }).plan;
  if (typeof plan !== "object" || plan === null || (plan as { schemaVersion?: unknown }).schemaVersion !== CAPTURE_SELECTION_PLAN_SCHEMA_VERSION_V2) return undefined;
  const rawLines = (plan as { lines?: unknown }).lines;
  if (!Array.isArray(rawLines)) return undefined;
  const pizzaRaw = new Map<string, unknown>();
  const strippedLines: unknown[] = [];
  for (const rawLine of rawLines) {
    if (typeof rawLine !== "object" || rawLine === null || Array.isArray(rawLine)) return undefined;
    const { pizza, ...rest } = rawLine as Record<string, unknown>;
    if (Object.hasOwn(rawLine, "pizza")) {
      if (Object.hasOwn(rest, "fraction") || typeof rest.lineId !== "string") return undefined;
      pizzaRaw.set(rest.lineId, pizza);
    }
    strippedLines.push(rest);
  }
  const command = parseReplaceCaptureSelectionPlanCommandV1({
    ...(value as Record<string, unknown>),
    plan: { ...(plan as Record<string, unknown>), lines: strippedLines, schemaVersion: 1 },
  });
  if (command === undefined) return undefined;
  const pizzaByLineId = new Map<string, CapturePizzaLineV2>();
  for (const line of command.plan.lines) {
    if (!pizzaRaw.has(line.lineId)) continue;
    const pizza = parseCapturePizzaLineV2(pizzaRaw.get(line.lineId));
    const halfA = pizza?.halves[0];
    if (pizza === undefined || halfA === undefined || halfA.productId !== line.productId || halfA.variantId !== line.variantId) return undefined;
    pizzaByLineId.set(line.lineId, pizza);
  }
  return { command, pizzaByLineId };
}

export type CapturePizzaByLineId = ReadonlyMap<string, CapturePizzaLineV2>;
export const NO_PIZZA_LINES: CapturePizzaByLineId = new Map();

/** A line as it travels to PostgreSQL: the V1 line plus, for a schemaVersion 2 plan, its optional `pizza`. */
export type CaptureSelectionWireLine = CaptureSelectionLineV1 & { readonly pizza?: CapturePizzaLineV2 };

export interface CaptureSelectionWirePlan {
  readonly schemaVersion: 1 | 2;
  readonly catalogVersion: string;
  readonly lines: readonly CaptureSelectionWireLine[];
}

/** What the selection-plan persistence port receives: V1 commands are assignable as they are. */
export type ReplaceCaptureSelectionPlanWireCommand = Omit<ReplaceCaptureSelectionPlanCommandV1, "plan"> & {
  readonly plan: CaptureSelectionWirePlan;
};

/** Re-attaches the validated `pizza` objects to their lines and keeps schemaVersion 2 on the wire. */
export function toWireCommand(parsed: ReplaceCaptureSelectionPlanCommandV2): ReplaceCaptureSelectionPlanWireCommand {
  return {
    ...parsed.command,
    plan: {
      catalogVersion: parsed.command.plan.catalogVersion,
      lines: parsed.command.plan.lines.map((line): CaptureSelectionWireLine => {
        const pizza = parsed.pizzaByLineId.get(line.lineId);
        return pizza === undefined ? line : { ...line, pizza };
      }),
      schemaVersion: CAPTURE_SELECTION_PLAN_SCHEMA_VERSION_V2,
    },
  };
}

/** Fail-closed parse of what the persistence port may be given: a V1 command or a validated V2 one. */
export function parseReplaceCaptureSelectionPlanWireCommand(value: unknown): ReplaceCaptureSelectionPlanWireCommand | undefined {
  const v2 = parseReplaceCaptureSelectionPlanCommandV2(value);
  return v2 === undefined ? parseReplaceCaptureSelectionPlanCommandV1(value) : toWireCommand(v2);
}

export interface StoredCaptureSelectionPlan {
  /** The plan with every `pizza` stripped; prices nothing by itself when `pizzaByLineId` is not empty. */
  readonly plan: CaptureSelectionPlanV1;
  readonly pizzaByLineId: CapturePizzaByLineId;
  readonly schemaVersion: 1 | 2;
}

/**
 * Reads a stored selection plan of schemaVersion 1 or 2. Version 1 is exactly the shared parser; version 2
 * keeps each line's validated pizza apart so the V1-shaped consumers cannot price a pizza as a whole line.
 */
export function parseStoredCaptureSelectionPlan(value: unknown): StoredCaptureSelectionPlan | undefined {
  const version = typeof value === "object" && value !== null ? (value as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (version === 1) {
    const plan = parseCaptureSelectionPlanV1(value);
    return plan === undefined ? undefined : { pizzaByLineId: NO_PIZZA_LINES, plan, schemaVersion: 1 };
  }
  if (version !== CAPTURE_SELECTION_PLAN_SCHEMA_VERSION_V2) return undefined;
  // Reuse the command parser's strip/validate pipeline with a throwaway envelope.
  const probe = parseReplaceCaptureSelectionPlanCommandV2({ plan: value, ...PLACEHOLDER_ENVELOPE });
  return probe === undefined ? undefined : { pizzaByLineId: probe.pizzaByLineId, plan: probe.command.plan, schemaVersion: 2 };
}

const PLACEHOLDER_ENVELOPE = {
  attentionLeaseId: "00000000-0000-4000-8000-000000000001",
  captureDraftId: "00000000-0000-4000-8000-000000000002",
  deviceId: "00000000-0000-4000-8000-000000000003",
  eventId: "00000000-0000-4000-8000-000000000004",
  expectedVersion: 1,
  idempotencyKey: "00000000-0000-4000-8000-000000000005",
  occurredAt: "2026-01-01T00:00:00.000Z",
  schemaVersion: 1,
  scope: { branchId: "00000000-0000-4000-8000-000000000006", restaurantId: "00000000-0000-4000-8000-000000000007" },
} as const;

export interface CaptureLineQuoteRequestWithPizza {
  readonly request: CaptureLineQuoteRequestV1;
  readonly pizza: CapturePizzaLineV2 | null;
}

/**
 * Line quote request with an optional `pizza`: the rest is the shared V1 request, untouched. The pizza must
 * be exclusive with `fraction` and its half-a must be the quoted product and size.
 */
export function parseCaptureLineQuoteRequestWithPizza(value: unknown): CaptureLineQuoteRequestWithPizza | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { pizza: rawPizza, ...rest } = value as Record<string, unknown>;
  const request = parseCaptureLineQuoteRequestV1(rest);
  if (request === undefined) return undefined;
  if (!Object.hasOwn(value, "pizza")) return { pizza: null, request };
  const pizza = parseCapturePizzaLineV2(rawPizza);
  const halfA = pizza?.halves[0];
  if (pizza === undefined || halfA === undefined || request.fraction !== null
    || halfA.productId !== request.productId || halfA.variantId !== request.variantId) return undefined;
  return { pizza, request };
}
