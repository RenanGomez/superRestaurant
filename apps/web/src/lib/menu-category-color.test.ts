import assert from "node:assert/strict";
import test from "node:test";
import { MENU_CATEGORY_COLORS } from "@super-restaurant/shared-types";
import { MENU_CATEGORY_COLOR_LABELS, menuCategoryColorClasses } from "./menu-category-color.js";

test("every palette token has classes and a Spanish label", () => {
  const cards = new Set<string>();
  for (const color of MENU_CATEGORY_COLORS) {
    const classes = menuCategoryColorClasses(color);
    assert.notEqual(classes, undefined, color);
    assert.match(classes?.card ?? "", /bg-\[oklch\(/u);
    assert.match(classes?.tabActive ?? "", /border-accent/u);
    assert.notEqual(MENU_CATEGORY_COLOR_LABELS[color], "");
    cards.add(classes?.card ?? "");
  }
  assert.equal(cards.size, MENU_CATEGORY_COLORS.length);
  assert.equal(Object.keys(MENU_CATEGORY_COLOR_LABELS).length, MENU_CATEGORY_COLORS.length);
});

test("no colour, hex or unknown values fall back to the automatic colour", () => {
  assert.equal(menuCategoryColorClasses(null), undefined);
  assert.equal(menuCategoryColorClasses(undefined), undefined);
  assert.equal(menuCategoryColorClasses("#ffcccc"), undefined);
  assert.equal(menuCategoryColorClasses("red"), undefined);
  assert.equal(menuCategoryColorClasses("toString"), undefined);
});
