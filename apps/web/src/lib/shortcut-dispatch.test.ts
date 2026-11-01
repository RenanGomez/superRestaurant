import assert from "node:assert/strict";
import test from "node:test";
import { ariaKeyShortcut, dispatchShortcut, searchFocusTarget, type ShortcutKey, type ShortcutTable } from "./shortcut-dispatch.js";

const event: ShortcutKey = { key: "n", ctrlKey: false, metaKey: false, altKey: true,
  targetTag: "BODY", targetIsEditable: false };
const bare = { ctrlKey: false, metaKey: false, altKey: false } as const;
const ctrl = { ctrlKey: true, metaKey: false, altKey: false } as const;
const tray: ShortcutTable = { create: ariaKeyShortcut("create") };
const draft: ShortcutTable = { search: ariaKeyShortcut("search") };
const conflict: ShortcutTable = { reset: ariaKeyShortcut("reset") };
const confirmed: ShortcutTable = { reset: ariaKeyShortcut("reset") };

test("Alt+N creates only when the create shortcut is available", () => {
  assert.equal(dispatchShortcut(event, tray), "create");
  assert.equal(dispatchShortcut({ ...event, key: "N" }, tray), "create");
  assert.equal(dispatchShortcut(event, draft), undefined);
});

test("Ctrl+K focuses search only when search is available", () => {
  assert.equal(dispatchShortcut({ ...event, ...ctrl, key: "k" }, draft), "search");
  assert.equal(dispatchShortcut({ ...event, ...ctrl, key: "k" }, tray), undefined);
});

test("single letters and slash never fire", () => {
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "n" }, tray), undefined);
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "r" }, conflict), undefined);
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "/" }, draft), undefined);
});

test("Alt+R resets when reset is available", () => {
  assert.equal(dispatchShortcut({ ...event, key: "r" }, conflict), "reset");
  assert.equal(dispatchShortcut({ ...event, key: "r" }, tray), undefined);
});

test("aria strings document the shortcuts", () => {
  assert.equal(ariaKeyShortcut("create"), "Alt+N");
  assert.equal(ariaKeyShortcut("search"), "Control+K");
});

test("Escape returns to tray only for conflict or confirmed capture", () => {
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "Escape" }, conflict), "reset");
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "Escape" }, confirmed), "reset");
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "Escape" }, draft), undefined);
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "Escape" }, tray), undefined);
});

test("typing in an editable control never starts another action, but Escape can reset", () => {
  for (const targetTag of ["input", "textarea", "select"]) {
    assert.equal(dispatchShortcut({ ...event, targetTag }, tray), undefined);
    assert.equal(dispatchShortcut({ ...event, ...ctrl, key: "k", targetTag }, draft), undefined);
    assert.equal(dispatchShortcut({ ...event, ...bare, key: "Escape", targetTag }, conflict), "reset");
  }
  assert.equal(dispatchShortcut({ ...event, targetTag: "DIV", targetIsEditable: true }, tray), undefined);
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "Escape", targetIsEditable: true }, conflict), "reset");
});

test("search focus target follows menu visibility", () => {
  assert.equal(searchFocusTarget(true), "menu");
  assert.equal(searchFocusTarget(false), "customer");
});

test("extra modifiers and unknown keys are ignored", () => {
  assert.equal(dispatchShortcut({ ...event, ctrlKey: true }, tray), undefined);
  assert.equal(dispatchShortcut({ ...event, metaKey: true }, tray), undefined);
  assert.equal(dispatchShortcut({ ...event, key: "Escape", altKey: true }, conflict), undefined);
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "?" }, tray), undefined);
});
