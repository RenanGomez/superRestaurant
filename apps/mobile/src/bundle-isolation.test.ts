import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * The verification harness and the synthetic fixtures must stay out of the app
 * that ships. This test walks the real distributable graph on disk — the Expo
 * entry plus every non-test source — and fails if any of it can reach them.
 */
const projectRoot = process.cwd();
const IMPORT_PATTERN = /(?:from|import)\s*\(?\s*["']([^"']+)["']/gu;

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/u.test(entry.name) || entry.name.endsWith(".test.ts")) return [];
    if (entry.name === "test-fixtures.ts") return [];
    return [full];
  });
}

function importsOf(file: string): readonly string[] {
  const contents = readFileSync(file, "utf8");
  return [...contents.matchAll(IMPORT_PATTERN)].map((match) => match[1] ?? "");
}

test("the shipped app never imports the harness or the synthetic fixtures", () => {
  const distributable = [path.join(projectRoot, "index.ts"), ...sourceFiles(path.join(projectRoot, "src"))];
  assert.ok(distributable.length > 8, "expected the app sources to be discovered");

  for (const file of distributable) {
    for (const specifier of importsOf(file)) {
      const relative = path.relative(projectRoot, file);
      assert.equal(specifier.includes("test-fixtures"), false, `${relative} imports ${specifier}`);
      assert.equal(specifier.includes("harness"), false, `${relative} imports ${specifier}`);
    }
  }
});

test("the harness control bar can be collapsed, accessibly, from inside the harness", () => {
  // The bar used to consume the whole column at 390x844, leaving the app with
  // no usable height, so the visual matrix could only be run by editing DOM or
  // CSS from the browser. The collapse control is what makes it reproducible,
  // so its contract is pinned here rather than left to a manual check.
  const root = readFileSync(path.join(projectRoot, "harness", "harness-root.tsx"), "utf8");

  // Operable by pointer and by keyboard, with a name and an expanded state.
  assert.match(root, /function Toggle\(/u, "the collapse control should exist");
  assert.match(root, /accessibilityLabel="Controles del arnés"/u);
  assert.match(root, /accessibilityRole="button"/u);
  assert.match(root, /accessibilityState=\{\{ expanded \}\}/u);
  // react-native-web does not translate `accessibilityState.expanded`, so the
  // ARIA prop has to be passed explicitly or the web run exposes no state.
  assert.match(root, /aria-expanded=\{expanded\}/u);
  assert.match(root, /\{\.\.\.focus\.handlers\}/u, "it should carry the shared focus ring");

  // A real 48 px target, not the 44 px minimum the other harness controls use.
  assert.match(root, /toggle: \{[^}]*minHeight: touchTarget\.primary/su);

  // Collapsing removes the scroller entirely, and it can be expanded again.
  assert.match(root, /controlsExpanded \? <ScrollView/u);
  assert.match(root, /setControlsExpanded\(\(value\) => !value\)/u);

  // Even expanded, the bar is bounded so the app keeps a column to render in.
  assert.match(root, /controlsScroll: \{[^}]*maxHeight: \d+/su);
});

test("the harness is reachable only behind the explicit Metro flag", () => {
  const metro = readFileSync(path.join(projectRoot, "metro.config.js"), "utf8");
  assert.match(metro, /MOBILE_VISUAL_HARNESS/u);
  assert.match(metro, /harnessEnabled &&/u);

  // The Expo entry resolves the real root screen; the harness only ever
  // replaces it through that flag.
  assert.match(readFileSync(path.join(projectRoot, "index.ts"), "utf8"), /\.\/src\/ui\/root\.js/u);
});
