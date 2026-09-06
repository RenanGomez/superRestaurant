import { tabletBreakpoint } from "./theme.js";

/**
 * How the comanda screen arranges its catalog and draft panes.
 *
 * `columns` is the tablet arrangement: the two panes sit side by side, each
 * one fills its column, and each one scrolls its own list.
 *
 * `stacked` is the phone arrangement, and it exists because sharing height is
 * what broke there. Stacked panes that both carry `flexGrow: 1`/`flexBasis: 0`
 * split whatever the header and the notice left over — on a 390×844 viewport
 * that is a few pixels each, so the catalog list resolves to `clientHeight: 0`
 * and its products spill out behind the draft pane, which then answers the
 * taps meant for them. Stacked therefore gives the single scroller to the
 * screen: the panes keep their natural height and none of them nests a
 * scroller, because a nested one inside an auto-height parent collapses to
 * zero for exactly the same reason.
 */
export type OrderDraftLayout = "columns" | "stacked";

/** The arrangement one viewport width can actually operate. */
export function orderDraftLayout(width: number): OrderDraftLayout {
  return width >= tabletBreakpoint ? "columns" : "stacked";
}

/** True when the screen itself is the scroller, rather than each pane. */
export function screenOwnsScroller(layout: OrderDraftLayout): boolean {
  return layout === "stacked";
}

/** True when a pane scrolls its own list. Never true while the screen scrolls. */
export function paneOwnsScroller(layout: OrderDraftLayout): boolean {
  return !screenOwnsScroller(layout);
}

/**
 * The box of one pane per arrangement. A pane may claim a flex share of its
 * parent only where the parent has a height to give it; in `stacked` that
 * share is the defect itself, so the pane keeps its own height instead.
 */
export const orderDraftPaneBox = Object.freeze({
  columns: Object.freeze({ flexBasis: 0, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
  stacked: Object.freeze({ flexShrink: 0, minWidth: 0 }),
});
