import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { THEME_COLORS, classGroup, conflictsIn, findClassConflicts } from "./class-conflicts.js";
import { uiButton, uiChip, uiOption, uiVariants, type UiVariant } from "./ui-classes.js";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test("no source file stacks two same-group color or size utilities in one class composition", () => {
  const files = sourceFiles(join(process.cwd(), "src"));
  assert.ok(files.length > 30, "the scan must actually find the web sources");
  const failures = files.flatMap((file) => findClassConflicts(readFileSync(file, "utf8"))
    .map((conflict) => `${file}:${conflict.line} ${conflict.kind} ${conflict.group} [${conflict.classes.join(" ")}]`));
  assert.deepEqual(failures, []);
});

test("negative case: the original tables-board composition is reported", () => {
  const broken = [
    'const button = "min-h-11 border border-border bg-surface px-4";',
    "const primary = `${button} border-accent bg-accent text-white`;",
  ].join("\n");
  const found = findClassConflicts(broken);
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((entry) => entry.group).sort(), ["bg-color", "border-color"]);
  assert.ok(found.every((entry) => entry.line === 2));
});

test("negative case: a ternary that layers a background over a base background is reported", () => {
  const broken = 'const base = "bg-surface text-text";\nconst x = <b className={`${base} ${on ? "bg-accent text-white" : ""}`} />;';
  const groups = findClassConflicts(broken).map((entry) => entry.group).sort();
  assert.deepEqual(groups, ["bg-color", "text-color"]);
});

test("negative case: two text colors, two text sizes and hover-variant clashes in one string", () => {
  assert.deepEqual(conflictsIn("text-text text-accent text-sm text-base hover:bg-bg hover:bg-accent").map((entry) => entry.group).sort(),
    ["hover:bg-color", "text-color", "text-size"]);
  assert.equal(findClassConflicts('const c = "border-border border-accent";').length, 1);
});

test("negative case: composing a color over an unresolved base is reported", () => {
  const found = findClassConflicts("const p = `${imported} bg-accent text-white`;");
  assert.deepEqual(found.map((entry) => entry.kind), ["unresolved-base"]);
});

test("THEME_COLORS covers every --color-* token defined in globals.css", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  const tokens = [...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? "");
  assert.ok(tokens.length > 10, "the theme tokens must be found");
  assert.deepEqual(tokens.filter((token) => !THEME_COLORS.has(token)), []);
});

test("negative case: success-bg, accent-soft and selected are themed colors that conflict", () => {
  assert.deepEqual(conflictsIn("bg-surface bg-success-bg").map((entry) => entry.group), ["bg-color"]);
  assert.deepEqual(conflictsIn("bg-bg bg-accent-soft").map((entry) => entry.group), ["bg-color"]);
  assert.deepEqual(conflictsIn("border-border border-selected").map((entry) => entry.group), ["border-color"]);
});

test("valid compositions are accepted", () => {
  assert.deepEqual(findClassConflicts('const a = "bg-surface text-text border-border hover:bg-bg text-sm";'), []);
  assert.deepEqual(findClassConflicts('const b = x ? "border-accent bg-accent text-white" : "border-border bg-surface text-text";'), []);
  assert.deepEqual(findClassConflicts("const c = `${layout} w-full text-left`;"), []);
  assert.equal(classGroup("border-2"), undefined);
  assert.equal(classGroup("text-[10px]"), "text-size");
  assert.equal(classGroup("bg-black/40"), "bg-color");
});

test("ui variants never conflict and selected options read white on accent", () => {
  for (const variant of Object.keys(uiVariants) as UiVariant[]) {
    assert.deepEqual(conflictsIn(uiButton(variant, "w-full text-left px-3 text-xl")), [], variant);
  }
  assert.deepEqual(conflictsIn(uiChip(true, "text-base")), []);
  assert.deepEqual(conflictsIn(uiOption(false, "min-w-24")), []);
  const selected = uiOption(true);
  assert.ok(selected.includes("bg-accent") && selected.includes("text-white") && !selected.includes("bg-surface"));
  const idle = uiOption(false);
  assert.ok(idle.includes("bg-surface") && idle.includes("text-text") && !idle.includes("text-white"));
  assert.ok(uiButton("secondary", "px-2 text-xs").includes("px-2") && !uiButton("secondary", "px-2 text-xs").includes("px-4"));
});

/** Interpolations in a className template that touch the neighbouring utility without a space (`${a}${b}`, `${a}cursor-grab`) fuse two classes into one invalid name. */
function findFusedInterpolations(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/className=\{`([^`]*)`\}/g)) {
    const template = match[1] ?? "";
    if (/\}\$\{|\}[A-Za-z[-]|[A-Za-z\]]\$\{/.test(template)) found.push(template);
  }
  return found;
}

test("no className template fuses an interpolation with the next or previous utility", () => {
  const failures = sourceFiles(join(process.cwd(), "src")).flatMap((file) => findFusedInterpolations(readFileSync(file, "utf8")).map((template) => `${file}: ${template}`));
  assert.deepEqual(failures, []);
});

test("negative case: a conditional glued to the next utility is reported, spaced ones are not", () => {
  assert.equal(findFusedInterpolations('<a className={`x ${on ? "border-dashed" : ""}${m ? "cursor-grab" : ""}`} />').length, 1);
  assert.equal(findFusedInterpolations('<a className={`x ${on ? "a" : ""}cursor-grab`} />').length, 1);
  assert.equal(findFusedInterpolations('<a className={`x ${on ? "a" : ""} cursor-grab ${m}`} />').length, 0);
});
