/**
 * Index of the element that must receive focus when Tab / Shift+Tab is pressed inside a modal, or `null` when the
 * browser's natural order is already inside the dialog. `current` is the index of the focused element within the
 * dialog's focusable list, or `-1` when focus sits outside it.
 */
export function trapFocusIndex(count: number, current: number, shift: boolean): number | null {
  if (count <= 0) return null;
  if (current < 0) return shift ? count - 1 : 0;
  if (shift && current === 0) return count - 1;
  if (!shift && current === count - 1) return 0;
  return null;
}
