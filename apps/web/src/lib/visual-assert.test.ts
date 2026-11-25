import assert from "node:assert/strict";
import test from "node:test";

import {
  assertVisualSnapshot,
  findViolations,
  MIN_TARGET_PX,
  type VisualControl,
  type VisualSnapshot,
  type VisualViolation,
} from "./visual-assert.js";

function control(overrides: Partial<VisualControl> = {}): VisualControl {
  return { name: "Guardar", width: 44, height: 44, visible: true, ...overrides };
}

function snapshot(overrides: Partial<VisualSnapshot> = {}): VisualSnapshot {
  return {
    viewportWidth: 1280,
    viewportHeight: 800,
    scrollWidth: 1280,
    controls: [control()],
    consoleErrors: [],
    networkFailures: [],
    dialogCalls: [],
    focusedOutline: "outline: 2px solid rgb(0, 0, 0); box-shadow: none",
    ...overrides,
  };
}

function rules(violations: readonly VisualViolation[]): string[] {
  return violations.map((violation) => violation.rule);
}

test("acepta un snapshot sin violaciones", () => {
  assert.deepEqual(findViolations(snapshot()), []);
  assert.doesNotThrow(() => assertVisualSnapshot(snapshot()));
});

test("MIN_TARGET_PX es 44", () => {
  assert.equal(MIN_TARGET_PX, 44);
});

test("acepta controles visibles de exactamente 44×44", () => {
  assert.deepEqual(findViolations(snapshot({ controls: [control({ width: 44, height: 44 })] })), []);
});

test("falla con un control visible de 43 px de alto", () => {
  const violations = findViolations(snapshot({ controls: [control({ height: 43 })] }));
  assert.deepEqual(rules(violations), ["target-size"]);
  assert.match(violations[0]?.message ?? "", /44×43px/);
});

test("ignora controles ocultos para el tamaño", () => {
  assert.deepEqual(
    findViolations(snapshot({ controls: [control({ width: 10, height: 10, visible: false })] })),
    [],
  );
});

test("falla con un control visible sin nombre accesible", () => {
  const violations = findViolations(snapshot({ controls: [control({ name: "   " })] }));
  assert.deepEqual(rules(violations), ["accessible-name"]);
});

test("ignora controles ocultos para el nombre accesible", () => {
  assert.deepEqual(
    findViolations(snapshot({ controls: [control({ name: "", visible: false })] })),
    [],
  );
});

test("acepta scrollWidth igual al viewport", () => {
  assert.deepEqual(findViolations(snapshot({ viewportWidth: 1280, scrollWidth: 1280 })), []);
});

test("falla si hay desbordamiento horizontal", () => {
  const violations = findViolations(snapshot({ viewportWidth: 390, scrollWidth: 391 }));
  assert.deepEqual(rules(violations), ["horizontal-overflow"]);
  assert.match(violations[0]?.message ?? "", /391px > viewport 390px/);
});

test("falla con errores de consola", () => {
  const violations = findViolations(snapshot({ consoleErrors: ["TypeError: boom"] }));
  assert.deepEqual(rules(violations), ["console-error"]);
});

test("falla con fallos de red", () => {
  const violations = findViolations(snapshot({ networkFailures: ["500 GET /api/v1/health"] }));
  assert.deepEqual(rules(violations), ["network-failure"]);
});

test("falla con diálogos nativos", () => {
  const violations = findViolations(snapshot({ dialogCalls: ["confirm"] }));
  assert.deepEqual(rules(violations), ["native-dialog"]);
});

test("acepta foco visible con outline", () => {
  assert.deepEqual(
    findViolations(snapshot({ focusedOutline: "outline: 2px solid rgb(1, 2, 3); box-shadow: none" })),
    [],
  );
});

test("acepta foco visible solo con box-shadow", () => {
  assert.deepEqual(
    findViolations(
      snapshot({ focusedOutline: "outline: none; box-shadow: rgb(0, 0, 0) 0px 0px 0px 2px" }),
    ),
    [],
  );
});

test("falla si focusedOutline es null", () => {
  const violations = findViolations(snapshot({ focusedOutline: null }));
  assert.deepEqual(rules(violations), ["focus-visible"]);
});

test("falla si outline y box-shadow son none", () => {
  const violations = findViolations(snapshot({ focusedOutline: "outline: none; box-shadow: none" }));
  assert.deepEqual(rules(violations), ["focus-visible"]);
});

test("assertVisualSnapshot lanza un error legible con cada violación", () => {
  assert.throws(
    () =>
      assertVisualSnapshot(
        snapshot({
          controls: [control({ height: 43 })],
          consoleErrors: ["TypeError: boom"],
          dialogCalls: ["alert"],
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Violaciones visuales \(3\)/);
      assert.match(error.message, /\[target-size\]/);
      assert.match(error.message, /\[console-error\]/);
      assert.match(error.message, /\[native-dialog\]/);
      return true;
    },
  );
});
