import assert from "node:assert/strict";
import test from "node:test";
import { ariaKeyShortcut, dispatchShortcut, type ShortcutKey, type ShortcutTable } from "./shortcut-dispatch.js";

const event: ShortcutKey = { key: "n", code: "KeyN", ctrlKey: false, metaKey: false, altKey: true,
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
  assert.equal(dispatchShortcut({ ...event, key: "Dead", code: "KeyN" }, tray), "create");
  assert.equal(dispatchShortcut(event, draft), undefined);
});

test("Ctrl+K and Alt+K focus search only when search is available", () => {
  assert.equal(dispatchShortcut({ ...event, ...ctrl, key: "k", code: "KeyK" }, draft), "search");
  assert.equal(dispatchShortcut({ ...event, key: "k", code: "KeyK" }, draft), "search");
  assert.equal(dispatchShortcut({ ...event, key: "Dead", code: "KeyK" }, draft), "search");
  assert.equal(dispatchShortcut({ ...event, ...ctrl, key: "k", code: "KeyK" }, tray), undefined);
});

test("single letters and slash never fire, even in an input", () => {
  for (const targetTag of ["BODY", "input", "DIV"]) {
    assert.equal(dispatchShortcut({ ...event, ...bare, key: "n", code: "KeyN", targetTag }, tray), undefined);
    assert.equal(dispatchShortcut({ ...event, ...bare, key: "r", code: "KeyR", targetTag }, conflict), undefined);
    assert.equal(dispatchShortcut({ ...event, ...bare, key: "/", code: "Slash", targetTag }, draft), undefined);
  }
});

test("Alt+R resets when reset is available, including from an input", () => {
  assert.equal(dispatchShortcut({ ...event, key: "r", code: "KeyR" }, conflict), "reset");
  assert.equal(dispatchShortcut({ ...event, key: "Dead", code: "KeyR" }, conflict), "reset");
  assert.equal(dispatchShortcut({ ...event, key: "r", code: "KeyR", targetTag: "INPUT" }, conflict), "reset");
  assert.equal(dispatchShortcut({ ...event, key: "r", code: "KeyR" }, tray), undefined);
});

test("aria strings document the shortcuts", () => {
  assert.equal(ariaKeyShortcut("create"), "Alt+N");
  assert.equal(ariaKeyShortcut("search"), "Control+K Alt+K");
  assert.equal(ariaKeyShortcut("reset"), "Escape Alt+R");
});

test("Escape returns to tray only for conflict or confirmed capture", () => {
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "Escape", code: "Escape" }, conflict), "reset");
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "Escape", code: "Escape" }, confirmed), "reset");
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "Escape", code: "Escape" }, draft), undefined);
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "Escape", code: "Escape" }, tray), undefined);
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "Unidentified", code: "Escape" }, conflict), "reset");
});

test("Alt and Ctrl shortcuts still fire while typing in an editable control", () => {
  for (const targetTag of ["input", "textarea", "select"]) {
    const inInput = { ...event, targetTag };
    assert.equal(dispatchShortcut(inInput, tray), "create");
    assert.equal(dispatchShortcut({ ...inInput, ...ctrl, key: "k", code: "KeyK" }, draft), "search");
    assert.equal(dispatchShortcut({ ...inInput, key: "k", code: "KeyK" }, draft), "search");
    assert.equal(dispatchShortcut({ ...inInput, ...bare, key: "Escape", code: "Escape" }, conflict), "reset");
  }
  assert.equal(dispatchShortcut({ ...event, targetTag: "DIV", targetIsEditable: true }, tray), "create");
  assert.equal(dispatchShortcut({ ...event, targetTag: "DIV", targetIsEditable: true, ...bare, key: "Escape" }, conflict), "reset");
});

test("extra modifiers and unknown keys are ignored", () => {
  assert.equal(dispatchShortcut({ ...event, ctrlKey: true }, tray), undefined);
  assert.equal(dispatchShortcut({ ...event, metaKey: true }, tray), undefined);
  assert.equal(dispatchShortcut({ ...event, key: "Escape", altKey: true }, conflict), undefined);
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "?" }, tray), undefined);
});
