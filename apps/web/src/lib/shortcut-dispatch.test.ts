import assert from "node:assert/strict";
import test from "node:test";
import { ariaKeyShortcut, dispatchShortcut, type ShortcutKey, type ShortcutTable } from "./shortcut-dispatch.js";

const event: ShortcutKey = { key: "n", code: "KeyN", ctrlKey: false, metaKey: false, altKey: true, shiftKey: false,
  targetTag: "BODY", targetIsEditable: false };
const bare = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as const;
const altShift = { ctrlKey: false, metaKey: false, altKey: true, shiftKey: true } as const;
const ctrl = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false } as const;
const capture: ShortcutTable = { capture: ariaKeyShortcut("capture") };
const draft: ShortcutTable = { search: ariaKeyShortcut("search") };
const reset: ShortcutTable = { reset: ariaKeyShortcut("reset") };
const layers: ShortcutTable = { reset: ariaKeyShortcut("reset"), dismiss: ariaKeyShortcut("dismiss") };

test("Alt+N opens capture, also from an editable control", () => {
  assert.equal(dispatchShortcut(event, capture), "capture");
  assert.equal(dispatchShortcut({ ...event, key: "N" }, capture), "capture");
  assert.equal(dispatchShortcut({ ...event, key: "Dead", code: "KeyN" }, capture), "capture");
  assert.equal(dispatchShortcut({ ...event, targetTag: "INPUT" }, capture), "capture");
  assert.equal(dispatchShortcut({ ...event, targetTag: "DIV", targetIsEditable: true }, capture), "capture");
  assert.equal(dispatchShortcut(event, draft), undefined);
});

test("Ctrl+K and Alt+K focus search only when search is available", () => {
  assert.equal(dispatchShortcut({ ...event, ...ctrl, key: "k", code: "KeyK" }, draft), "search");
  assert.equal(dispatchShortcut({ ...event, key: "k", code: "KeyK" }, draft), "search");
  assert.equal(dispatchShortcut({ ...event, key: "Dead", code: "KeyK" }, draft), "search");
  assert.equal(dispatchShortcut({ ...event, ...ctrl, key: "k", code: "KeyK" }, capture), undefined);
});

test("single letters and slash never fire, even in an input", () => {
  for (const targetTag of ["BODY", "input", "DIV"]) {
    assert.equal(dispatchShortcut({ ...event, ...bare, key: "n", code: "KeyN", targetTag }, capture), undefined);
    assert.equal(dispatchShortcut({ ...event, ...bare, key: "r", code: "KeyR", targetTag }, reset), undefined);
    assert.equal(dispatchShortcut({ ...event, ...bare, key: "/", code: "Slash", targetTag }, draft), undefined);
  }
});

test("Alt+Shift+R resets when reset is available, including from an input", () => {
  assert.equal(dispatchShortcut({ ...event, ...altShift, key: "r", code: "KeyR" }, reset), "reset");
  assert.equal(dispatchShortcut({ ...event, ...altShift, key: "R", code: "KeyR" }, reset), "reset");
  assert.equal(dispatchShortcut({ ...event, ...altShift, key: "Dead", code: "KeyR" }, reset), "reset");
  assert.equal(dispatchShortcut({ ...event, ...altShift, key: "r", code: "KeyR", targetTag: "INPUT" }, reset), "reset");
  assert.equal(dispatchShortcut({ ...event, ...altShift, key: "r", code: "KeyR" }, capture), undefined);
});

test("Alt+R alone no longer resets", () => {
  assert.equal(dispatchShortcut({ ...event, key: "r", code: "KeyR" }, reset), undefined);
  assert.equal(dispatchShortcut({ ...event, ctrlKey: true, key: "r", code: "KeyR" }, reset), undefined);
  assert.equal(dispatchShortcut({ ...event, ...altShift, ctrlKey: true, key: "r", code: "KeyR" }, reset), undefined);
});

test("Escape dismisses the open layer and never resets it", () => {
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "Escape", code: "Escape" }, layers), "dismiss");
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "Escape", code: "Escape", targetTag: "INPUT" }, layers), "dismiss");
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "Unidentified", code: "Escape" }, layers), "dismiss");
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "Escape", code: "Escape" }, reset), undefined);
  assert.equal(dispatchShortcut({ ...event, key: "Escape", code: "Escape", altKey: true }, layers), undefined);
});

test("aria strings document the shortcuts", () => {
  assert.equal(ariaKeyShortcut("capture"), "Alt+N");
  assert.equal(ariaKeyShortcut("search"), "Control+K Alt+K");
  assert.equal(ariaKeyShortcut("reset"), "Alt+Shift+R");
  assert.equal(ariaKeyShortcut("dismiss"), "Escape");
});

test("Alt and Ctrl shortcuts still fire while typing in an editable control", () => {
  for (const targetTag of ["input", "textarea", "select"]) {
    const inInput = { ...event, targetTag };
    assert.equal(dispatchShortcut(inInput, capture), "capture");
    assert.equal(dispatchShortcut({ ...inInput, ...ctrl, key: "k", code: "KeyK" }, draft), "search");
    assert.equal(dispatchShortcut({ ...inInput, key: "k", code: "KeyK" }, draft), "search");
    assert.equal(dispatchShortcut({ ...inInput, ...bare, key: "Escape", code: "Escape" }, layers), "dismiss");
  }
  assert.equal(dispatchShortcut({ ...event, targetTag: "DIV", targetIsEditable: true }, capture), "capture");
  assert.equal(dispatchShortcut({ ...event, targetTag: "DIV", targetIsEditable: true, ...bare, key: "Escape", code: "Escape" }, layers), "dismiss");
});

test("extra modifiers and unknown keys are ignored", () => {
  assert.equal(dispatchShortcut({ ...event, ctrlKey: true }, capture), undefined);
  assert.equal(dispatchShortcut({ ...event, metaKey: true }, capture), undefined);
  assert.equal(dispatchShortcut({ ...event, shiftKey: true }, capture), undefined);
  assert.equal(dispatchShortcut({ ...event, ...bare, key: "?" }, capture), undefined);
});
