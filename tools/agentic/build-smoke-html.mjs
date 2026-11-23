// Genera docs/smoke/smoke-<fecha>.html a partir de docs/smoke/smoke-<fecha>.data.json
// reutilizando la plantilla de docs/smoke/smoke-2026-11-05.html (misma UI, misma exportación).
// Uso: node tools/agentic/build-smoke-html.mjs 2026-11-21
// Regla del proyecto (AGENTS.md §23): tras cada cambio integrado se actualiza el .data.json y se regenera el HTML.
import { readFileSync, writeFileSync } from "node:fs";

const date = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
  console.error("uso: node tools/agentic/build-smoke-html.mjs AAAA-MM-DD");
  process.exit(1);
}
const tpl = readFileSync("docs/smoke/smoke-2026-11-05.html", "utf8");
const data = JSON.parse(readFileSync(`docs/smoke/smoke-${date}.data.json`, "utf8"));

const start = tpl.indexOf("const SECTIONS = [");
const end = tpl.indexOf("const STL =");
if (start < 0 || end < 0) throw new Error("plantilla sin marcadores SECTIONS/STL");
const block =
  `const SECTIONS = ${JSON.stringify(data.sections)};\n` +
  `const R2 = ${JSON.stringify(data.r2 ?? {})};\n`;

const cStart = tpl.indexOf("const CHANGES = [");
const cEnd = tpl.indexOf("const r2html =");
if (cStart < 0 || cEnd < 0) throw new Error("plantilla sin marcadores CHANGES/r2html");
const block2 =
  `const CHANGES = ${JSON.stringify(data.changes)};\n` +
  `const DECISIONS = ${JSON.stringify(data.decisions)};\n`;

let out = tpl.slice(0, start) + block + tpl.slice(end, cStart) + block2 + tpl.slice(cEnd);
out = out
  .replaceAll("sr-smoke-2026-11-05", `sr-smoke-${date}`)
  .replaceAll("smoke-2026-11-05.json", `smoke-${date}.json`)
  .replace("# Resultado smoke 2026-11-05", `# Resultado smoke ${date}`)
  .replace("Smoke superRestaurant · 2026-11-05", `Smoke superRestaurant · ${date}`)
  .replace(
    /<p class="sub">[^<]*<\/p>/,
    `<p class="sub">${data.sub}</p>`,
  );
writeFileSync(`docs/smoke/smoke-${date}.html`, out);
console.log(`docs/smoke/smoke-${date}.html generado (${out.length} bytes)`);
