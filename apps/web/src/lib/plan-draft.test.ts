import assert from "node:assert/strict";
import test from "node:test";
import { draftFromTable } from "./dining-editor.js";
import {
  applyPlanOutcome, clampPlanMove, commitPlanMove, layoutAttemptKey, movePlanTable, panelChanges, panelLayout, pendingMoveIds,
  planMoveIsConflict, planSaveCommands, rebasePlanMove, rebaseVersion, withoutMove, type PlanDraft, type PlanTable,
} from "./plan-draft.js";

const table = (tableId: string, version: number, x: number, y: number, width = 4, height = 4): PlanTable => ({ tableId, version, layout: { x, y, width, height } });
const tables = { a: table("a", 2, 0, 0), b: table("b", 5, 10, 10), c: table("c", 1, 20, 90) };

test("moving several tables accumulates in one draft and keeps each base version", () => {
  let plan: PlanDraft = {};
  plan = movePlanTable(plan, tables.a, { x: 3.4, y: 2.2 }, 4, 4);
  plan = movePlanTable(plan, tables.b, { x: 12, y: 11 }, 4, 4);
  plan = movePlanTable(plan, tables.a, { x: 4.6, y: 2.2 }, 4, 4);
  assert.deepEqual(plan.a, { baseVersion: 2, x: 4.6, y: 2.2 });
  assert.deepEqual(plan.b, { baseVersion: 5, x: 12, y: 11 });
  assert.deepEqual(pendingMoveIds(plan, tables).sort(), ["a", "b"]);
});

test("positions are clamped to the grid for the table size", () => {
  const plan = movePlanTable({}, tables.c, { x: 99, y: -5 }, 4, 4);
  assert.deepEqual(plan.c, { baseVersion: 1, x: 20, y: 0 });
});

test("committing rounds to whole cells and a move back to the saved cell leaves the draft", () => {
  let plan = movePlanTable({}, tables.a, { x: 3.6, y: 2.2 }, 4, 4);
  plan = commitPlanMove(plan, tables.a, 4, 4);
  assert.deepEqual(plan.a, { baseVersion: 2, x: 4, y: 2 });
  plan = movePlanTable(plan, tables.a, { x: 0.3, y: 0.2 }, 4, 4);
  assert.deepEqual(commitPlanMove(plan, tables.a, 4, 4), {});
  assert.deepEqual(pendingMoveIds(movePlanTable({}, tables.a, { x: 0, y: 0 }, 4, 4), tables), []);
});

test("cancelling is an empty draft and per-table removal leaves the others", () => {
  const plan = movePlanTable(movePlanTable({}, tables.a, { x: 3, y: 3 }, 4, 4), tables.b, { x: 12, y: 12 }, 4, 4);
  assert.deepEqual(Object.keys(withoutMove(plan, "a")), ["b"]);
  assert.equal(withoutMove(plan, "zzz"), plan);
});

test("pending moves of tables that no longer exist are ignored", () => {
  const plan = movePlanTable({}, table("gone", 1, 0, 0), { x: 3, y: 3 }, 4, 4);
  assert.deepEqual(pendingMoveIds(plan, tables), []);
});

test("save commands: one per moved table, saved size, base version, stable order", () => {
  let plan: PlanDraft = {};
  plan = movePlanTable(plan, tables.b, { x: 12, y: 11 }, 4, 4);
  plan = movePlanTable(plan, tables.a, { x: 3.4, y: 2.2 }, 4, 4);
  const { commands, conflicts } = planSaveCommands(plan, tables);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(commands, [
    { tableId: "a", expectedVersion: 2, layout: { x: 3, y: 2, width: 4, height: 4 } },
    { tableId: "b", expectedVersion: 5, layout: { x: 12, y: 11, width: 4, height: 4 } },
  ]);
  assert.equal(layoutAttemptKey(commands[0]!), "a:2:layout:3:2:4:4");
});

test("save commands clamp a position that does not fit the saved size", () => {
  const big = table("big", 3, 0, 0, 8, 8);
  const plan = movePlanTable({}, big, { x: 22, y: 5 }, 2, 2);
  const { commands } = planSaveCommands(plan, { big });
  assert.deepEqual(commands[0]?.layout, { x: 16, y: 5, width: 8, height: 8 });
});

test("a pending move whose base differs from the server version is a foreign conflict and is not sent", () => {
  const plan = movePlanTable({}, tables.a, { x: 5, y: 5 }, 4, 4);
  const moved = { ...tables, a: table("a", 3, 0, 0) };
  const result = planSaveCommands(plan, moved);
  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.conflicts, ["a"]);
  assert.equal(planMoveIsConflict(plan.a!, 3), true);
  assert.equal(planMoveIsConflict(plan.a!, 2), false);
});

test("outcomes: saved and conflicting moves leave the draft, retry and rejected stay", () => {
  const plan = movePlanTable(movePlanTable({}, tables.a, { x: 3, y: 3 }, 4, 4), tables.b, { x: 12, y: 12 }, 4, 4);
  assert.deepEqual(Object.keys(applyPlanOutcome(plan, "a", "saved")), ["b"]);
  assert.deepEqual(Object.keys(applyPlanOutcome(plan, "a", "conflict")), ["b"]);
  assert.equal(applyPlanOutcome(plan, "a", "retry"), plan);
  assert.equal(applyPlanOutcome(plan, "a", "rejected"), plan);
});

test("a partial save leaves only the failed table pending, with the same attempt key for a retry", () => {
  let plan = movePlanTable(movePlanTable({}, tables.a, { x: 3, y: 3 }, 4, 4), tables.b, { x: 12, y: 12 }, 4, 4);
  const first = planSaveCommands(plan, tables);
  plan = applyPlanOutcome(plan, "a", "saved");
  plan = applyPlanOutcome(plan, "b", "retry");
  const second = planSaveCommands(plan, { ...tables, a: table("a", 3, 3, 3) });
  assert.deepEqual(second.commands.map((command) => command.tableId), ["b"]);
  assert.equal(layoutAttemptKey(second.commands[0]!), layoutAttemptKey(first.commands[1]!));
});

test("rebase after an own save keeps the pending position; a foreign version stays a conflict", () => {
  const plan = movePlanTable({}, tables.a, { x: 5, y: 5 }, 4, 4);
  const rebased = rebasePlanMove(plan, "a", 2, 3);
  assert.deepEqual(rebased.a, { baseVersion: 3, x: 5, y: 5 });
  assert.deepEqual(planSaveCommands(rebased, { ...tables, a: table("a", 3, 0, 0) }).commands.map((c) => c.expectedVersion), [3]);
  const foreign = rebasePlanMove(plan, "a", 7, 8);
  assert.equal(foreign, plan);
  assert.equal(rebasePlanMove(plan, "zzz", 2, 3), plan);
  assert.equal(rebaseVersion(4, 4, 5), 5);
  assert.equal(rebaseVersion(4, 3, 5), 4);
});

test("changing the panel size clamps the pending position inside the grid", () => {
  const plan = movePlanTable({}, tables.c, { x: 20, y: 90 }, 4, 4);
  const clamped = clampPlanMove(plan, "c", 8, 8);
  assert.deepEqual(clamped.c, { baseVersion: 1, x: 16, y: 90 });
  assert.equal(clampPlanMove(plan, "c", 4, 4), plan);
  assert.equal(clampPlanMove(plan, "a", 8, 8), plan);
});

test("the panel only reports size and details, never position", () => {
  const saved = { name: "Mesa 1", capacity: 4, shape: "round", layout: { x: 2, y: 3, width: 4, height: 4 } };
  const draft = draftFromTable(saved);
  assert.deepEqual(panelChanges(saved, { ...draft, x: 9, y: 9 }), { layout: false, details: false });
  assert.deepEqual(panelChanges(saved, { ...draft, width: 5 }), { layout: true, details: false });
  assert.deepEqual(panelChanges(saved, { ...draft, name: "Otra" }), { layout: false, details: true });
});

test("the panel layout keeps the saved position, moved only as far as the new size requires", () => {
  const saved = { x: 20, y: 90, width: 4, height: 4 };
  const base = draftFromTable({ name: "M", capacity: 4, shape: "round", layout: saved });
  assert.deepEqual(panelLayout(saved, { ...base, width: 6, height: 4 }), { x: 18, y: 90, width: 6, height: 4 });
  assert.deepEqual(panelLayout({ x: 2, y: 3, width: 4, height: 4 }, { ...base, width: 6, height: 6 }), { x: 2, y: 3, width: 6, height: 6 });
});
