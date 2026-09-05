/**
 * Visual tokens for the mobile client.
 *
 * Contrast ratios against `surface` (#ffffff): text 15.9:1, textMuted 7.4:1,
 * accent 7.0:1, danger 6.0:1 — all above the WCAG AA threshold for body text.
 * Touch targets are never smaller than 44 px, and primary actions use 48 px.
 */
export const colors = Object.freeze({
  accent: "#12489a",
  accentText: "#ffffff",
  background: "#f4f5f7",
  border: "#c9cfd8",
  danger: "#a1231c",
  dangerSurface: "#fdeceb",
  disabled: "#5b6472",
  focus: "#0b3a7d",
  info: "#12489a",
  infoSurface: "#e8eef9",
  surface: "#ffffff",
  text: "#14181f",
  textMuted: "#4b5461",
});

export const spacing = Object.freeze({ lg: 24, md: 16, sm: 8, xl: 32, xs: 4 });

export const radius = Object.freeze({ card: 12, control: 10 });

export const touchTarget = Object.freeze({ minimum: 44, primary: 48 });

/** Width at which the layout switches to the two-column tablet arrangement. */
export const tabletBreakpoint = 768;

export const typography = Object.freeze({
  body: Object.freeze({ fontSize: 16, lineHeight: 24 }),
  caption: Object.freeze({ fontSize: 14, lineHeight: 20 }),
  heading: Object.freeze({ fontSize: 24, lineHeight: 32 }),
  subheading: Object.freeze({ fontSize: 18, lineHeight: 26 }),
});
