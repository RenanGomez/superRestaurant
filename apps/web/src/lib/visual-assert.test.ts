import assert from "node:assert/strict";
import test from "node:test";

import {
  assertVisualSnapshot,
  effectiveTargetSize,
  findViolations,
  insetsFromPseudo,
  mergeControlInsets,
  MIN_TARGET_PX,
  type PseudoStyle,
  type VisualControl,
  type VisualSnapshot,
  type VisualViolation,
} from "./visual-assert.js";

function pseudo(overrides: Partial<PseudoStyle> = {}): PseudoStyle {
  return {
    content: '""',
    position: "absolute",
    pointerEvents: "auto",
    inset: "-12px",
    top: "-12px",
    right: "-12px",
    bottom: "-12px",
    left: "-12px",
    ...overrides,
  };
}

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

test("acepta 20×20 con -12 px por lado: el pseudo-elemento amplía a 44×44", () => {
  const expanded = control({
    width: 20,
    height: 20,
    insetLeft: -12,
    insetTop: -12,
    insetRight: -12,
    insetBottom: -12,
  });
  assert.deepEqual(effectiveTargetSize(expanded), { width: 44, height: 44 });
  assert.deepEqual(findViolations(snapshot({ controls: [expanded] })), []);
});

test("falla con 20×20 sin expansión", () => {
  const violations = findViolations(snapshot({ controls: [control({ width: 20, height: 20 })] }));
  assert.deepEqual(rules(violations), ["target-size"]);
  assert.match(violations[0]?.message ?? "", /20×20px/);
});

test("falla si la expansión parcial no llega a 44 en ambos ejes", () => {
  const partial = control({
    width: 20,
    height: 20,
    insetLeft: -12,
    insetTop: 0,
    insetRight: -12,
    insetBottom: 0,
  });
  assert.deepEqual(effectiveTargetSize(partial), { width: 44, height: 20 });
  const violations = findViolations(snapshot({ controls: [partial] }));
  assert.deepEqual(rules(violations), ["target-size"]);
  assert.match(violations[0]?.message ?? "", /44×20px/);
});

test("insets no negativos no amplían el área", () => {
  const shrunk = control({
    width: 20,
    height: 20,
    insetLeft: 12,
    insetTop: 12,
    insetRight: 12,
    insetBottom: 12,
  });
  assert.deepEqual(effectiveTargetSize(shrunk), { width: 20, height: 20 });
  assert.deepEqual(rules(findViolations(snapshot({ controls: [shrunk] }))), ["target-size"]);
});

test("insetsFromPseudo ignora pointer-events: none", () => {
  assert.equal(insetsFromPseudo(pseudo({ pointerEvents: "none" })), null);
  const small = control({ width: 20, height: 20 });
  assert.deepEqual(rules(findViolations(snapshot({ controls: [small] }))), ["target-size"]);
});

test("insetsFromPseudo ignora pseudo-elementos sin contenido o no absolutos", () => {
  assert.equal(insetsFromPseudo(pseudo({ content: "none" })), null);
  assert.equal(insetsFromPseudo(pseudo({ content: "normal" })), null);
  assert.equal(insetsFromPseudo(pseudo({ position: "relative" })), null);
  assert.equal(insetsFromPseudo(pseudo({ position: "static" })), null);
});

test("insetsFromPseudo lee longhand y shorthand en px", () => {
  assert.deepEqual(insetsFromPseudo(pseudo()), { left: -12, top: -12, right: -12, bottom: -12 });
  assert.deepEqual(
    insetsFromPseudo(pseudo({ inset: "-12px -8px", top: "auto", right: "auto", bottom: "auto", left: "auto" })),
    { left: -8, top: -12, right: -8, bottom: -12 },
  );
  assert.deepEqual(
    insetsFromPseudo(pseudo({ top: "calc(1px + 2px)", right: "auto", bottom: "auto", left: "auto", inset: "-6px" })),
    { left: -6, top: -6, right: -6, bottom: -6 },
  );
});

test("mergeControlInsets toma la mayor expansión por lado entre ::before y ::after", () => {
  const merged = mergeControlInsets(
    { left: -6, top: -6, right: -6, bottom: -6 },
    { left: -12, top: 0, right: -10, bottom: -12 },
  );
  assert.deepEqual(merged, { left: -12, top: -6, right: -10, bottom: -12 });
  assert.deepEqual(mergeControlInsets(null, null), { left: 0, top: 0, right: 0, bottom: 0 });
});
