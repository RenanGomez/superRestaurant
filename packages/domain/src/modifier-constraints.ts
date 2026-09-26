import { DomainError, InvalidSnapshotError } from "./errors.js";

export type ModifierConstraintKind = "requires" | "excludes" | "enables" | "requires_group";

export interface ModifierConstraintOptionReference {
  readonly groupId: string;
  readonly optionId: string;
}

export interface ModifierConstraintGroupCatalog {
  readonly groupId: string;
  readonly optionIds: readonly string[];
}

export interface ModifierOptionConstraint {
  readonly id: string;
  readonly kind: Exclude<ModifierConstraintKind, "requires_group">;
  readonly source: ModifierConstraintOptionReference;
  readonly target: ModifierConstraintOptionReference;
}

export interface ModifierGroupConstraint {
  readonly id: string;
  readonly kind: "requires_group";
  readonly source: ModifierConstraintOptionReference;
  readonly targetGroupId: string;
}

export type ModifierConstraint = ModifierOptionConstraint | ModifierGroupConstraint;

export interface ModifierConstraintCatalog {
  readonly restaurantId: string;
  readonly catalogVersion: string;
  readonly groups: readonly ModifierConstraintGroupCatalog[];
  readonly constraints: readonly ModifierConstraint[];
}

export interface ModifierConstraintSelectionState {
  readonly selectedOptions: readonly ModifierConstraintOptionReference[];
  /** Groups whose own minimum/maximum rules have already been satisfied. */
  readonly completedGroupIds: readonly string[];
}

export type ModifierConstraintIssueCode =
  | "required_option_missing"
  | "excluded_option_selected"
  | "option_not_enabled"
  | "required_group_incomplete";

export interface ModifierConstraintIssue {
  readonly code: ModifierConstraintIssueCode;
  readonly constraintId: string;
  readonly source: ModifierConstraintOptionReference;
  readonly target: ModifierConstraintOptionReference | Readonly<{ groupId: string }>;
}

export interface ModifierConstraintResolution {
  readonly valid: boolean;
  /** Canonical detached copy; invalid selections are never removed implicitly. */
  readonly selectedOptions: readonly ModifierConstraintOptionReference[];
  readonly completedGroupIds: readonly string[];
  readonly issues: readonly ModifierConstraintIssue[];
}

export interface ValidatedModifierConstraintCatalog extends ModifierConstraintCatalog {
  readonly groups: readonly Readonly<ModifierConstraintGroupCatalog>[];
  readonly constraints: readonly Readonly<ModifierConstraint>[];
}

export function validateModifierConstraintCatalog(
  value: ModifierConstraintCatalog,
): ValidatedModifierConstraintCatalog {
  return atConstraintBoundary("modifier constraint catalog", () => {
    const catalog = normalizeCatalog(value);
    assertText(catalog.restaurantId, "constraint restaurantId");
    assertText(catalog.catalogVersion, "constraint catalogVersion");
    const groups = validateGroups(catalog.groups);
    const known = buildKnownOptionKeys(groups);
    const groupIds = new Set(groups.map((group) => group.groupId));
    const ruleIds = new Set<string>();
    const semanticKeys = new Set<string>();

    for (const constraint of catalog.constraints) {
      assertText(constraint.id, "constraint id");
      if (ruleIds.has(constraint.id) || !known.has(referenceKey(constraint.source))) {
        throw new InvalidSnapshotError("modifier constraint catalog");
      }
      ruleIds.add(constraint.id);
      const targetKey = constraint.kind === "requires_group"
        ? constraint.targetGroupId
        : referenceKey(constraint.target);
      if (
        (constraint.kind === "requires_group" && !groupIds.has(constraint.targetGroupId))
        || (constraint.kind !== "requires_group" && !known.has(targetKey))
        || (constraint.kind !== "requires_group" && referenceKey(constraint.source) === targetKey)
      ) throw new InvalidSnapshotError("modifier constraint catalog");
      const semanticKey = `${constraint.kind}\u0000${referenceKey(constraint.source)}\u0000${targetKey}`;
      if (semanticKeys.has(semanticKey)) throw new InvalidSnapshotError("modifier constraint catalog");
      semanticKeys.add(semanticKey);
    }

    assertNoDirectContradictions(catalog.constraints);
    assertRequiresAcyclic(catalog.constraints, known);
    return deepFreeze({ ...catalog, groups });
  });
}

export function resolveModifierConstraints(
  catalogValue: ModifierConstraintCatalog,
  stateValue: ModifierConstraintSelectionState,
): ModifierConstraintResolution {
  return atConstraintBoundary("modifier constraint selection", () => {
    const catalog = validateModifierConstraintCatalog(catalogValue);
    const state = normalizeState(stateValue);
    const selectedOptions = validateUniqueReferences(state.selectedOptions, "selected constraint option");
    const completedGroupIds = validateUniqueIds(state.completedGroupIds, "completed constraint group id");
    const known = buildKnownOptionKeys(catalog.groups);
    const knownGroups = new Set(catalog.groups.map((group) => group.groupId));
    if (
      selectedOptions.some((reference) => !known.has(referenceKey(reference)))
      || completedGroupIds.some((id) => !knownGroups.has(id))
    ) throw new InvalidSnapshotError("modifier constraint selection");
    const selected = new Set(selectedOptions.map(referenceKey));
    const completed = new Set(completedGroupIds);
    const issues: ModifierConstraintIssue[] = [];

    for (const constraint of catalog.constraints) {
      const sourceSelected = selected.has(referenceKey(constraint.source));
      if (constraint.kind === "requires" && sourceSelected && !selected.has(referenceKey(constraint.target))) {
        issues.push(optionIssue("required_option_missing", constraint));
      } else if (constraint.kind === "excludes" && sourceSelected && selected.has(referenceKey(constraint.target))) {
        issues.push(optionIssue("excluded_option_selected", constraint));
      } else if (
        constraint.kind === "enables"
        && selected.has(referenceKey(constraint.target))
        && !sourceSelected
      ) {
        issues.push(optionIssue("option_not_enabled", constraint));
      } else if (
        constraint.kind === "requires_group"
        && sourceSelected
        && !completed.has(constraint.targetGroupId)
      ) {
        issues.push(deepFreeze({
          code: "required_group_incomplete" as const,
          constraintId: constraint.id,
          source: { ...constraint.source },
          target: { groupId: constraint.targetGroupId },
        }));
      }
    }

    issues.sort((left, right) => compareCodeUnits(left.constraintId, right.constraintId));
    return deepFreeze({
      completedGroupIds: [...completedGroupIds].sort(compareCodeUnits),
      issues,
      selectedOptions: [...selectedOptions].sort(compareReferences),
      valid: issues.length === 0,
    });
  });
}

function optionIssue(
  code: Exclude<ModifierConstraintIssueCode, "required_group_incomplete">,
  constraint: ModifierOptionConstraint,
): ModifierConstraintIssue {
  return deepFreeze({
    code,
    constraintId: constraint.id,
    source: { ...constraint.source },
    target: { ...constraint.target },
  });
}

function validateGroups(values: readonly ModifierConstraintGroupCatalog[]): readonly Readonly<ModifierConstraintGroupCatalog>[] {
  const groupIds = new Set<string>();
  const optionKeys = new Set<string>();
  return Object.freeze(values.map((group) => {
    assertText(group.groupId, "constraint group id");
    if (groupIds.has(group.groupId)) throw new InvalidSnapshotError("constraint group id");
    groupIds.add(group.groupId);
    const optionIds = validateUniqueIds(group.optionIds, "constraint option id");
    if (optionIds.length === 0) throw new InvalidSnapshotError("constraint group options");
    for (const optionId of optionIds) {
      const key = referenceKey({ groupId: group.groupId, optionId });
      if (optionKeys.has(key)) throw new InvalidSnapshotError("constraint option reference");
      optionKeys.add(key);
    }
    return deepFreeze({ groupId: group.groupId, optionIds });
  }));
}

function assertNoDirectContradictions(constraints: readonly ModifierConstraint[]): void {
  const excludes = new Set(constraints
    .filter((rule): rule is ModifierOptionConstraint => rule.kind === "excludes")
    .flatMap((rule) => [
      `${referenceKey(rule.source)}\u0000${referenceKey(rule.target)}`,
      `${referenceKey(rule.target)}\u0000${referenceKey(rule.source)}`,
    ]));
  for (const rule of constraints) {
    if (
      rule.kind === "requires"
      && excludes.has(`${referenceKey(rule.source)}\u0000${referenceKey(rule.target)}`)
    ) throw new InvalidSnapshotError("modifier constraint contradiction");
  }
}

function assertRequiresAcyclic(constraints: readonly ModifierConstraint[], known: ReadonlySet<string>): void {
  const edges = new Map([...known].map((key) => [key, [] as string[]]));
  for (const rule of constraints) {
    if (rule.kind === "requires") edges.get(referenceKey(rule.source))!.push(referenceKey(rule.target));
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visiting.has(key)) throw new InvalidSnapshotError("modifier constraint requires cycle");
    if (visited.has(key)) return;
    visiting.add(key);
    for (const target of edges.get(key) ?? []) visit(target);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of known) visit(key);
}

function normalizeCatalog(value: unknown): ModifierConstraintCatalog {
  const record = asPlainRecord(value, "modifier constraint catalog");
  return deepFreeze({
    catalogVersion: ownData(record, "catalogVersion", "constraint catalogVersion") as string,
    constraints: ownDataArray(record, "constraints", "modifier constraints").map(normalizeConstraint),
    groups: ownDataArray(record, "groups", "constraint groups").map(normalizeGroup),
    restaurantId: ownData(record, "restaurantId", "constraint restaurantId") as string,
  });
}

function normalizeGroup(value: unknown): ModifierConstraintGroupCatalog {
  const record = asPlainRecord(value, "modifier constraint group");
  return deepFreeze({
    groupId: ownData(record, "groupId", "constraint group id") as string,
    optionIds: ownDataArray(record, "optionIds", "constraint option ids") as readonly string[],
  });
}

function normalizeConstraint(value: unknown): ModifierConstraint {
  const record = asPlainRecord(value, "modifier constraint");
  const kind = ownData(record, "kind", "constraint kind");
  if (kind !== "requires" && kind !== "excludes" && kind !== "enables" && kind !== "requires_group") {
    throw new InvalidSnapshotError("constraint kind");
  }
  const base = {
    id: ownData(record, "id", "constraint id") as string,
    source: normalizeReference(ownData(record, "source", "constraint source")),
  };
  return kind === "requires_group"
    ? deepFreeze({ ...base, kind, targetGroupId: ownData(record, "targetGroupId", "constraint target group id") as string })
    : deepFreeze({ ...base, kind, target: normalizeReference(ownData(record, "target", "constraint target")) });
}

function normalizeState(value: unknown): ModifierConstraintSelectionState {
  const record = asPlainRecord(value, "modifier constraint selection");
  return deepFreeze({
    completedGroupIds: ownDataArray(record, "completedGroupIds", "completed constraint groups") as readonly string[],
    selectedOptions: ownDataArray(record, "selectedOptions", "selected constraint options").map(normalizeReference),
  });
}

function normalizeReference(value: unknown): ModifierConstraintOptionReference {
  const record = asPlainRecord(value, "modifier option reference");
  return Object.freeze({
    groupId: ownData(record, "groupId", "constraint reference group id") as string,
    optionId: ownData(record, "optionId", "constraint reference option id") as string,
  });
}

function validateUniqueReferences(
  values: readonly ModifierConstraintOptionReference[],
  field: string,
): readonly ModifierConstraintOptionReference[] {
  const keys = new Set<string>();
  return Object.freeze(values.map((reference) => {
    assertReference(reference);
    const key = referenceKey(reference);
    if (keys.has(key)) throw new InvalidSnapshotError(field);
    keys.add(key);
    return Object.freeze({ ...reference });
  }));
}

function validateUniqueIds(values: readonly string[], field: string): readonly string[] {
  const ids = new Set<string>();
  return Object.freeze(values.map((value) => {
    assertText(value, field);
    if (ids.has(value)) throw new InvalidSnapshotError(field);
    ids.add(value);
    return value;
  }));
}

function buildKnownOptionKeys(groups: readonly ModifierConstraintGroupCatalog[]): ReadonlySet<string> {
  return new Set(groups.flatMap((group) => group.optionIds.map((optionId) => referenceKey({
    groupId: group.groupId,
    optionId,
  }))));
}

function assertReference(reference: ModifierConstraintOptionReference): void {
  assertText(reference.groupId, "constraint reference group id");
  assertText(reference.optionId, "constraint reference option id");
}

function referenceKey(reference: ModifierConstraintOptionReference): string {
  assertReference(reference);
  return `${reference.groupId}\u0000${reference.optionId}`;
}

function asPlainRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new InvalidSnapshotError(field);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new InvalidSnapshotError(field);
  return value as Record<string, unknown>;
}

function ownData(record: Record<string, unknown>, key: string, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new InvalidSnapshotError(field);
  return descriptor.value;
}

function ownDataArray(record: Record<string, unknown>, key: string, field: string): readonly unknown[] {
  const value = ownData(record, key, field);
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new InvalidSnapshotError(field);
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (length === undefined || !("value" in length) || !Number.isSafeInteger(length.value) || length.value < 0) {
    throw new InvalidSnapshotError(field);
  }
  const items: unknown[] = [];
  for (let index = 0; index < length.value; index += 1) {
    items.push(ownData(value as unknown as Record<string, unknown>, String(index), field));
  }
  return items;
}

function assertText(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new InvalidSnapshotError(field);
  }
}

function atConstraintBoundary<T>(field: string, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new InvalidSnapshotError(field);
  }
}

function compareReferences(left: ModifierConstraintOptionReference, right: ModifierConstraintOptionReference): number {
  return compareCodeUnits(referenceKey(left), referenceKey(right));
}

function compareCodeUnits(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value !== null && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) deepFreeze(child, seen);
    Object.freeze(value);
  }
  return value;
}
