import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MENU_TAB,
  isMenuTab,
  MENU_TAB_LABELS,
  MENU_TAB_STORAGE_KEY,
  MENU_TABS,
  menuTabHref,
  parseMenuTab,
  readStoredMenuTab,
  resolveMenuTab,
  writeStoredMenuTab,
} from "./menu-tabs.js";

test("MENU_TABS contains all four required sections", () => {
  assert.deepEqual(MENU_TABS, ["categorias", "productos", "modificadores", "tamanos"]);
  assert.equal(DEFAULT_MENU_TAB, "categorias");
  for (const tab of MENU_TABS) {
    assert.equal(typeof MENU_TAB_LABELS[tab], "string");
    assert.ok(MENU_TAB_LABELS[tab].length > 0);
  }
});

test("isMenuTab validates tab strings", () => {
  assert.equal(isMenuTab("categorias"), true);
  assert.equal(isMenuTab("productos"), true);
  assert.equal(isMenuTab("modificadores"), true);
  assert.equal(isMenuTab("tamanos"), true);

  assert.equal(isMenuTab(""), false);
  assert.equal(isMenuTab("other"), false);
  assert.equal(isMenuTab(123), false);
  assert.equal(isMenuTab(null), false);
  assert.equal(isMenuTab(undefined), false);
});

test("parseMenuTab parses valid tab strings and ignores case or whitespace", () => {
  assert.equal(parseMenuTab("categorias"), "categorias");
  assert.equal(parseMenuTab("PRODUCTOS"), "productos");
  assert.equal(parseMenuTab("  modificadores  "), "modificadores");
  assert.equal(parseMenuTab("tamanos"), "tamanos");

  assert.equal(parseMenuTab("invalid"), undefined);
  assert.equal(parseMenuTab(""), undefined);
  assert.equal(parseMenuTab(null), undefined);
  assert.equal(parseMenuTab(undefined), undefined);
  assert.equal(parseMenuTab(42), undefined);
});

test("resolveMenuTab falls back to default or custom fallback", () => {
  assert.equal(resolveMenuTab("productos"), "productos");
  assert.equal(resolveMenuTab("unknown"), "categorias");
  assert.equal(resolveMenuTab(undefined), "categorias");
  assert.equal(resolveMenuTab("invalid", "modificadores"), "modificadores");
});

test("menuTabHref generates URLs setting or updating the tab query parameter", () => {
  assert.equal(menuTabHref("categorias"), "/app/menu?tab=categorias");
  assert.equal(menuTabHref("productos"), "/app/menu?tab=productos");
  assert.equal(menuTabHref("modificadores", "?foo=bar"), "/app/menu?foo=bar&tab=modificadores");
  assert.equal(menuTabHref("tamanos", "tab=categorias&branch=centro"), "/app/menu?tab=tamanos&branch=centro");

  const searchParams = new URLSearchParams("menuStatus=published&tab=productos");
  assert.equal(menuTabHref("categorias", searchParams), "/app/menu?menuStatus=published&tab=categorias");

  const recordParams = { menuError: "invalid_draft", tab: "productos" };
  assert.equal(menuTabHref("modificadores", recordParams), "/app/menu?menuError=invalid_draft&tab=modificadores");
});

test("readStoredMenuTab and writeStoredMenuTab safely interact with storage", () => {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
  };

  assert.equal(readStoredMenuTab(mockStorage), null);

  writeStoredMenuTab(mockStorage, "productos");
  assert.equal(store.get(MENU_TAB_STORAGE_KEY), "productos");
  assert.equal(readStoredMenuTab(mockStorage), "productos");

  writeStoredMenuTab(mockStorage, "tamanos");
  assert.equal(readStoredMenuTab(mockStorage), "tamanos");

  // Invalid value stored in storage defaults to null
  store.set(MENU_TAB_STORAGE_KEY, "corrupt_data");
  assert.equal(readStoredMenuTab(mockStorage), null);

  // Handles null / undefined storage
  assert.equal(readStoredMenuTab(null), null);
  assert.equal(readStoredMenuTab(undefined), null);
  assert.doesNotThrow(() => writeStoredMenuTab(null, "categorias"));
  assert.doesNotThrow(() => writeStoredMenuTab(undefined, "categorias"));

  // Storage that throws does not bubble exceptions
  const throwingStorage = {
    getItem(): string {
      throw new Error("SecurityError: access denied");
    },
    setItem(): void {
      throw new Error("QuotaExceededError");
    },
  };

  assert.equal(readStoredMenuTab(throwingStorage), null);
  assert.doesNotThrow(() => writeStoredMenuTab(throwingStorage, "categorias"));
});
