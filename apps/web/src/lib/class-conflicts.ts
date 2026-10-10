/**
 * Static guard for Tailwind class composition. Tailwind does not resolve same-group conflicts by the
 * order of classes in the attribute, so `bg-surface ... bg-accent` renders whichever rule the generated
 * stylesheet emits last (white text on a white background was the visible symptom). This module scans
 * source text for string and template literals that carry two utilities of the same group and variant
 * (background color, text color, text size, border color), expanding `${name}` references to
 * same-file `const name = "..."` strings and treating each branch of an inline ternary separately.
 * Use the variants from `ui-classes.ts` instead of layering colors over a base.
 */

export const THEME_COLORS: ReadonlySet<string> = new Set([
  "bg", "surface", "text", "text-muted", "accent", "accent-hover", "accent-soft", "border", "error", "error-bg",
  "success", "success-bg", "selected", "nav", "white", "black", "transparent", "current", "inherit",
  "category-1", "category-2", "category-3", "category-4", "category-5", "category-6", "category-7", "category-8",
]);

const CLASS_TOKEN = /^((?:[a-z0-9-]+:)*)!?(bg|text|border)-(.+)$/;
const TEXT_SIZE = /^(xs|sm|base|lg|xl|[2-9]xl|\[\d[^\]]*\])$/;
const MAX_COMBINATIONS = 64;

export interface ClassConflict {
  readonly line: number;
  readonly kind: "conflict" | "unresolved-base";
  readonly group: string;
  readonly classes: readonly string[];
}

interface Literal {
  readonly line: number;
  /** Alternating static text and `${...}` expressions; even indexes are text. */
  readonly parts: readonly { readonly text: string; readonly expr?: string }[];
}

/** The conflict group of a single class (`hover:bg-accent` -> `hover:bg`), or undefined when it is not a themed color or size. */
export function classGroup(token: string): string | undefined {
  const match = CLASS_TOKEN.exec(token);
  if (match === null) return undefined;
  const prefix = match[1] ?? "";
  const kind = match[2] ?? "";
  const rest = (match[3] ?? "").split("/")[0] ?? "";
  if (kind === "text" && TEXT_SIZE.test(rest)) return `${prefix}text-size`;
  if (THEME_COLORS.has(rest)) return `${prefix}${kind}-color`;
  return undefined;
}

/** Same-group conflicts inside one flat class string. */
export function conflictsIn(classString: string): { readonly group: string; readonly classes: readonly string[] }[] {
  const byGroup = new Map<string, Set<string>>();
  for (const token of classString.split(/\s+/)) {
    if (token === "") continue;
    const group = classGroup(token);
    if (group === undefined) continue;
    byGroup.set(group, (byGroup.get(group) ?? new Set<string>()).add(token));
  }
  return [...byGroup].filter(([, classes]) => classes.size > 1).map(([group, classes]) => ({ group, classes: [...classes] }));
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source.charCodeAt(i) === 10) line += 1;
  return line;
}

/** Collect every string/template literal (also those nested inside `${}`), skipping comments. */
function collectLiterals(source: string): Literal[] {
  const literals: Literal[] = [];
  const skipComment = (i: number): number => {
    if (source[i] === "/" && source[i + 1] === "/") { const end = source.indexOf("\n", i); return end === -1 ? source.length : end; }
    if (source[i] === "/" && source[i + 1] === "*") { const end = source.indexOf("*/", i + 2); return end === -1 ? source.length : end + 2; }
    return i;
  };
  const readQuoted = (start: number): number => {
    const quote = source[start];
    let i = start + 1;
    // Quoted strings never span lines; this keeps a stray apostrophe in JSX text from desyncing the scan.
    while (i < source.length && source[i] !== quote && source[i] !== "\n") i += source[i] === "\\" ? 2 : 1;
    literals.push({ line: lineOf(source, start), parts: [{ text: source.slice(start + 1, i) }] });
    return i + 1;
  };
  const readTemplate = (start: number): number => {
    const parts: { text: string; expr?: string }[] = [];
    let text = "";
    let i = start + 1;
    while (i < source.length && source[i] !== "`") {
      if (source[i] === "\\") { text += source.slice(i, i + 2); i += 2; continue; }
      if (source[i] === "$" && source[i + 1] === "{") {
        parts.push({ text });
        text = "";
        const exprStart = i + 2;
        i = readCode(exprStart, true);
        parts.push({ text: "", expr: source.slice(exprStart, i - 1) });
        continue;
      }
      text += source[i];
      i += 1;
    }
    parts.push({ text });
    literals.push({ line: lineOf(source, start), parts });
    return i + 1;
  };
  /** Scans code until the matching `}` when `inExpr`, returning the index after it. */
  const readCode = (start: number, inExpr: boolean): number => {
    let depth = 0;
    let i = start;
    while (i < source.length) {
      const skipped = skipComment(i);
      if (skipped !== i) { i = skipped; continue; }
      const ch = source[i];
      if (ch === "\"" || ch === "'") { i = readQuoted(i); continue; }
      if (ch === "`") { i = readTemplate(i); continue; }
      if (inExpr && ch === "{") depth += 1;
      if (inExpr && ch === "}") { if (depth === 0) return i + 1; depth -= 1; }
      i += 1;
    }
    return i;
  };
  readCode(0, false);
  return literals;
}

function collectConstStrings(literalsSource: string): Map<string, string> {
  const consts = new Map<string, string>();
  const pattern = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\$]|\\.)*)`)\s*;/g;
  for (const match of literalsSource.matchAll(pattern)) consts.set(match[1] ?? "", match[2] ?? match[3] ?? "");
  return consts;
}

function stringLiteralsIn(expression: string): string[] {
  return [...expression.matchAll(/"([^"\\]*)"|'([^'\\]*)'/g)].map((match) => match[1] ?? match[2] ?? "");
}

/** Scan one source file's text; returns every composition that stacks two utilities of the same group. */
export function findClassConflicts(source: string): ClassConflict[] {
  const consts = collectConstStrings(source);
  const found: ClassConflict[] = [];
  for (const literal of collectLiterals(source)) {
    const staticText = literal.parts.map((part) => part.text).join(" ");
    let combinations: string[] = [""];
    for (const part of literal.parts) {
      let alternatives: string[];
      if (part.expr === undefined) alternatives = [part.text];
      else {
        const name = part.expr.trim();
        const known = consts.get(name);
        alternatives = known !== undefined ? [known] : ["", ...stringLiteralsIn(part.expr)];
      }
      combinations = combinations.flatMap((prefix) => alternatives.map((alternative) => `${prefix} ${alternative}`)).slice(0, MAX_COMBINATIONS);
    }
    for (const combined of combinations) {
      for (const conflict of conflictsIn(combined)) found.push({ line: literal.line, kind: "conflict", ...conflict });
    }
    const first = literal.parts[0];
    const second = literal.parts[1];
    if (first !== undefined && second?.expr !== undefined && first.text.trim() === "" && /^[A-Za-z_$][\w$]*$/.test(second.expr.trim())
      && !consts.has(second.expr.trim())) {
      const colored = staticText.split(/\s+/).filter((token) => classGroup(token)?.endsWith("-color") === true);
      if (colored.length > 0) found.push({ line: literal.line, kind: "unresolved-base", group: "composed-on-base", classes: colored });
    }
  }
  const seen = new Set<string>();
  return found.filter((entry) => {
    const key = `${entry.line}|${entry.kind}|${entry.group}|${entry.classes.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
