import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  orderDraftLayout,
  orderDraftPaneBox,
  paneOwnsScroller,
  screenOwnsScroller,
} from "./ui/order-draft-layout.js";
import { tabletBreakpoint } from "./ui/theme.js";

/**
 * Regression for the phone layout of the comanda screen.
 *
 * A phone viewport arranged the catalog and the draft as two flexing panes
 * over the height the header had left. Each got a handful of pixels, the
 * catalog list resolved to `clientHeight: 0`, and its products rendered
 * outside it, behind the draft pane — which then received the taps aimed at
 * them, so the composer could not be opened at all with real events.
 *
 * The cause is structural, so it is pinned structurally: which arrangement a
 * width gets, who owns the only scroller in each, and the fact that the phone
 * pane box carries no flex share to collapse.
 */
test("a phone width stacks the panes and a tablet width keeps two columns", () => {
  assert.equal(orderDraftLayout(390), "stacked");
  assert.equal(orderDraftLayout(767), "stacked");
  assert.equal(orderDraftLayout(tabletBreakpoint), "columns");
  assert.equal(orderDraftLayout(1024), "columns");
});

test("exactly one scroller exists per arrangement, and it is never nested", () => {
  // Stacked: the screen scrolls. A pane scroller nested in an auto-height
  // parent would collapse to zero for the same reason the panes did.
  assert.equal(screenOwnsScroller("stacked"), true);
  assert.equal(paneOwnsScroller("stacked"), false);
  // Columns: each pane scrolls inside the column that gave it a height.
  assert.equal(screenOwnsScroller("columns"), false);
  assert.equal(paneOwnsScroller("columns"), true);
});

test("the stacked pane box claims no share of a height it will not get", () => {
  assert.deepEqual(orderDraftPaneBox.stacked, { flexShrink: 0, minWidth: 0 });
  assert.equal("flexGrow" in orderDraftPaneBox.stacked, false);
  assert.equal("flexBasis" in orderDraftPaneBox.stacked, false);
  // The two-column arrangement still fills its column: that part was correct.
  assert.deepEqual(orderDraftPaneBox.columns, { flexBasis: 0, flexGrow: 1, flexShrink: 1, minWidth: 0 });
});

test("the screen resolves its arrangement from the width, not from a second rule", () => {
  // The decision lives in one pure module so the regression above can hold it.
  // A width comparison reintroduced in the screen would silently escape it.
  const source = readFileSync(path.join(process.cwd(), "src", "ui", "order-draft-screen.tsx"), "utf8");
  assert.equal(source.includes("tabletBreakpoint"), false);
  assert.match(source, /orderDraftLayout\(width\)/u);
});
