import assert from "node:assert/strict";
import test from "node:test";
import { ariaKeyShortcut, dispatchShortcut, type ShortcutKey, type ShortcutTable } from "./shortcut-dispatch.js";

const event: ShortcutKey = { key: "n", ctrlKey: false, metaKey: false, altKey: false,
  targetTag: "BODY", targetIsEditable: false };
const tray: ShortcutTable = { create: ariaKeyShortcut("create") };
const draft: ShortcutTable = { search: ariaKeyShortcut("search") };
const conflict: ShortcutTable = { reset: ariaKeyShortcut("reset") };
const confirmed: ShortcutTable = { reset: ariaKeyShortcut("reset") };

test("N creates only when the create shortcut is available", () => {
  assert.equal(dispatchShortcut(event, tray), "create");
  assert.equal(dispatchShortcut({ ...event, key: "N" }, tray), "create");
  assert.equal(dispatchShortcut(event, draft), undefined);
});

test("slash focuses search only when search is available", () => {
  assert.equal(dispatchShortcut({ ...event, key: "/" }, draft), "search");
  assert.equal(dispatchShortcut({ ...event, key: "/" }, tray), undefined);
});

test("Escape returns to tray only for conflict or confirmed capture", () => {
  assert.equal(dispatchShortcut({ ...event, key: "Escape" }, conflict), "reset");
  assert.equal(dispatchShortcut({ ...event, key: "Escape" }, confirmed), "reset");
  assert.equal(dispatchShortcut({ ...event, key: "Escape" }, draft), undefined);
  assert.equal(dispatchShortcut({ ...event, key: "Escape" }, tray), undefined);
});

test("typing in an editable control never starts another action, but Escape can reset", () => {
  for (const targetTag of ["input", "textarea", "select"]) {
    assert.equal(dispatchShortcut({ ...event, targetTag }, tray), undefined);
    assert.equal(dispatchShortcut({ ...event, key: "/", targetTag }, draft), undefined);
    assert.equal(dispatchShortcut({ ...event, key: "Escape", targetTag }, conflict), "reset");
  }
  assert.equal(dispatchShortcut({ ...event, targetTag: "DIV", targetIsEditable: true }, tray), undefined);
  assert.equal(dispatchShortcut({ ...event, key: "Escape", targetIsEditable: true }, conflict), "reset");
});

test("modifiers and unknown keys are ignored", () => {
  for (const modifier of ["ctrlKey", "metaKey", "altKey"] as const) {
    assert.equal(dispatchShortcut({ ...event, [modifier]: true }, tray), undefined);
    assert.equal(dispatchShortcut({ ...event, key: "Escape", [modifier]: true }, conflict), undefined);
  }
  assert.equal(dispatchShortcut({ ...event, key: "?" }, tray), undefined);
});
