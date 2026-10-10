/** One mapping for the editor and the operating board: round is a circle/ellipse, square has near-straight corners, rectangle is softly rounded. */
export function tableShapeClass(shape: string): string {
  if (shape === "round") return "rounded-full";
  if (shape === "square") return "rounded-sm";
  return "rounded-md";
}
