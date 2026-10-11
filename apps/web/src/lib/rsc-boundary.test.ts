import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import ts from "typescript";
import { CheckField, Field } from "../components/field-hint.js";

/**
 * Regression guard for «Element type is invalid ... but got: undefined» on /app/caja (2026-10-11).
 * Field and CheckField are client components; Server Components (caja, deliveries, day summary, system
 * admin) pass them a control element. React hands that element to the client as an opaque RSC node, and
 * cloneElement on it breaks the server render. Server callers must pass the control as is, with the same
 * `id` on the Field and on the control. The scanners below also catch JSX tags that resolve to nothing
 * and named imports that the target module does not export, the other way this error is produced.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function parse(source: string, name = "file.tsx"): ts.SourceFile {
  return ts.createSourceFile(name, source, ts.ScriptTarget.ES2024, true, ts.ScriptKind.TSX);
}

function isClientModule(file: ts.SourceFile): boolean {
  const first = file.statements[0];
  return first !== undefined && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use client";
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function tagName(element: ts.JsxOpeningLikeElement): string {
  return element.tagName.getText();
}

function hasAttribute(element: ts.JsxOpeningLikeElement, name: string): boolean {
  return element.attributes.properties.some((property) => ts.isJsxAttribute(property) && property.name.getText() === name);
}

/** Field/CheckField usages in a Server Component that would reach the client as a clone-able element. */
export function findServerFieldMisuse(source: string): string[] {
  const file = parse(source);
  if (isClientModule(file)) return [];
  const problems: string[] = [];
  walk(file, (node) => {
    if (!ts.isJsxElement(node)) return;
    const name = tagName(node.openingElement);
    if (name !== "Field" && name !== "CheckField") return;
    const line = file.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    if (!hasAttribute(node.openingElement, "id")) problems.push(`${line}: <${name}> in a Server Component needs an explicit id (also set on its control)`);
    for (const child of node.children) {
      if (ts.isJsxExpression(child) && child.expression !== undefined && (ts.isArrowFunction(child.expression) || ts.isFunctionExpression(child.expression))) {
        problems.push(`${line}: <${name}> in a Server Component cannot take a render function`);
      }
    }
  });
  return problems;
}

function declaredNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const addBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.add(name.text);
    else for (const element of name.elements) if (ts.isBindingElement(element)) addBinding(element.name);
  };
  walk(file, (node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name !== undefined) names.add(node.name.text);
    if (ts.isVariableDeclaration(node)) addBinding(node.name);
    if (ts.isParameter(node)) addBinding(node.name);
    if (ts.isImportClause(node) && node.name !== undefined) names.add(node.name.text);
    if (ts.isNamespaceImport(node) || ts.isImportSpecifier(node)) names.add(node.name.text);
  });
  return names;
}

/** Capitalized JSX tags (`<Foo>`, `<Foo.Bar>` root) with no import or declaration in the file. */
export function findUnresolvedJsxTags(source: string): string[] {
  const file = parse(source);
  const names = declaredNames(file);
  const problems: string[] = [];
  walk(file, (node) => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return;
    const root = tagName(node).split(".")[0] ?? "";
    if (/^[A-Z]/.test(root) && !names.has(root)) problems.push(`${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}: <${root}> is not imported or declared`);
  });
  return problems;
}

function exportedNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    const exported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;
    const isDefault = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) === true;
    if (exported && isDefault) names.add("default");
    else if (exported && (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name !== undefined) names.add(statement.name.text);
    else if (exported && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
    } else if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) names.add(element.name.text);
    } else if (ts.isExportAssignment(statement)) names.add("default");
  }
  return names;
}

function resolveRelative(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (/\.(ts|tsx)$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Value (non-type) named imports from relative modules that the target does not export. */
export function findMissingNamedImports(file: string, source: string, read: (path: string) => string | undefined): string[] {
  const parsed = parse(source, file);
  const problems: string[] = [];
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith(".")) continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly || clause.namedBindings === undefined || !ts.isNamedImports(clause.namedBindings)) continue;
    const target = resolveRelative(file, specifier);
    const targetSource = target === undefined ? undefined : read(target);
    if (target === undefined || targetSource === undefined) {
      problems.push(`${specifier} does not resolve to a source file`);
      continue;
    }
    const available = exportedNames(parse(targetSource, target));
    for (const element of clause.namedBindings.elements) {
      if (element.isTypeOnly) continue;
      const imported = (element.propertyName ?? element.name).text;
      if (!available.has(imported)) problems.push(`${specifier} has no export named ${imported}`);
    }
  }
  return problems;
}

test("every Field/CheckField in a Server Component carries an explicit id and no render function", () => {
  const files = sourceFiles(join(SRC, "app"));
  assert.ok(files.length > 30, "the scan must actually find the web sources");
  const failures = files.flatMap((path) => findServerFieldMisuse(readFileSync(path, "utf8")).map((problem) => `${path}:${problem}`));
  assert.deepEqual(failures, []);
});

test("negative case: the caja form usage that crashed the server render is reported", () => {
  const broken = [
    'import { Field } from "../../../components/field-hint";',
    "export default function Page() {",
    '  return <Field className="grid" hint="h" label="Motivo"><textarea name="reason" /></Field>;',
    "}",
  ].join("\n");
  assert.equal(findServerFieldMisuse(broken).length, 1);
  const fixed = broken.replace("<Field ", '<Field id="reason" ').replace("<textarea ", '<textarea id="reason" ');
  assert.deepEqual(findServerFieldMisuse(fixed), []);
  const client = `"use client";\n${broken}`;
  assert.deepEqual(findServerFieldMisuse(client), []);
  const fn = '<Field id="x" className="" label="a">{(id) => <input id={id} />}</Field>';
  assert.equal(findServerFieldMisuse(`export const a = ${fn};`).length, 1);
});

test("every JSX component used under src/app resolves to an import or a declaration", () => {
  const failures = sourceFiles(join(SRC, "app")).flatMap((path) => findUnresolvedJsxTags(readFileSync(path, "utf8")).map((problem) => `${path}:${problem}`));
  assert.deepEqual(failures, []);
  assert.equal(findUnresolvedJsxTags("export const a = <Missing />;").length, 1);
  assert.deepEqual(findUnresolvedJsxTags('import { A } from "./a";\nexport const a = <A />;'), []);
});

test("every relative named import under src resolves to a real export (default vs named mix-ups)", () => {
  const read = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, "utf8") : undefined);
  const failures = sourceFiles(SRC).flatMap((path) => findMissingNamedImports(path, readFileSync(path, "utf8"), read).map((problem) => `${path}: ${problem}`));
  assert.deepEqual(failures, []);
  const broken = findMissingNamedImports(join(SRC, "app", "app", "caja", "x.tsx"), 'import { Nope } from "./payment-panel";', read);
  assert.deepEqual(broken, ["./payment-panel has no export named Nope"]);
});

test("Field and CheckField render the control as given and tie the label to its id", () => {
  const field = renderToString(createElement(Field, { id: "motivo", className: "grid", label: "Motivo", hint: "Ayuda", children: createElement("textarea", { id: "motivo", name: "reason" }) }));
  assert.match(field, /<label for="motivo">Motivo<\/label>/);
  assert.match(field, /<textarea id="motivo" name="reason">/);
  const check = renderToString(createElement(CheckField, { id: "ok", className: "flex", label: "Confirmo", hint: "Ayuda", children: createElement("input", { id: "ok", type: "checkbox" }) }));
  assert.match(check, /<label for="ok">Confirmo<\/label>/);
  assert.match(check, /<input id="ok" type="checkbox"\/>/);
});

test("render-function children still receive the generated or the fixed id", () => {
  const generated = renderToString(createElement(Field, { className: "grid", label: "Monto", children: (id: string) => createElement("input", { id }) }));
  const id = /<input id="([^"]+)"/.exec(generated)?.[1];
  assert.ok(id !== undefined && generated.includes(`<label for="${id}">`));
  const fixed = renderToString(createElement(Field, { id: "fijo", className: "grid", label: "Monto", children: (given: string) => createElement("input", { id: given }) }));
  assert.match(fixed, /<input id="fijo"\/>/);
});

test("field-hint never clones the element a Server Component passes in", () => {
  const source = readFileSync(join(SRC, "components", "field-hint.tsx"), "utf8");
  assert.equal(/import[^;]*\bcloneElement\b|\bcloneElement\s*\(/.test(source), false);
});
