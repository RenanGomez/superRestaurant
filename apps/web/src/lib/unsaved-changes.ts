/** Client-only registry of pages/layers with unsaved edits. Global shortcuts ask it before
 *  navigating away with Alt+N; each editor registers itself and clears on unmount. */
const sources = new Set<string>();

export function setUnsavedChanges(source: string, dirty: boolean): void {
  if (dirty) sources.add(source);
  else sources.delete(source);
}

export function hasUnsavedChanges(): boolean {
  return sources.size > 0;
}
