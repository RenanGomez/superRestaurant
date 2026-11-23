#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const DEFAULT_INPUT = resolve(REPO, "data/sepomex/colonias.csv");
const DEFAULT_OUTPUT = resolve(REPO, "supabase/seed-data/navojoa-settlements.csv");

const MUNICIPIO = "Navojoa";
const ESTADO = "Sonora";
const RANGOS_CP = [
  [85800, 85899],
  [85200, 85299],
];

export function normalizeName(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRows(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return { header: [], rows: [], lineNumbers: [] };
  const header = lines[0].split(",").map((cell) => cell.trim());
  const rows = [];
  const lineNumbers = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(",").map((cell) => cell.trim());
    rows.push(cells);
    lineNumbers.push(i + 1);
  }
  return { header, rows, lineNumbers };
}

function cpOutOfRange(cp) {
  const n = Number(cp);
  return !RANGOS_CP.some(([lo, hi]) => n >= lo && n <= hi);
}

export function buildSettlements(text) {
  const { rows, lineNumbers } = parseRows(text);
  const invalid = [];
  const outOfRange = [];
  const seen = new Map();
  const exactDuplicates = [];
  const records = [];
  const cps = new Set();

  rows.forEach((cells, index) => {
    const sourceLine = lineNumbers[index];
    const [coloniaRaw, cpRaw, tipoRaw] = cells;
    const colonia = (coloniaRaw ?? "").replace(/\s+/g, " ").trim();
    const cp = (cpRaw ?? "").trim();
    const tipo = (tipoRaw ?? "").replace(/\s+/g, " ").trim();

    if (cells.length !== 3) {
      invalid.push({ line: sourceLine, cp, colonia, reason: `columnas=${cells.length}` });
      return;
    }

    if (!/^\d{5}$/.test(cp) || colonia === "") {
      invalid.push({ line: sourceLine, cp, colonia, reason: colonia === "" ? "colonia vacía" : "CP inválido" });
      return;
    }

    const key = `${colonia}\u0000${cp}\u0000${tipo}`;
    if (seen.has(key)) {
      exactDuplicates.push({ line: sourceLine, cp, colonia, tipo });
      return;
    }
    seen.set(key, true);

    if (cpOutOfRange(cp)) outOfRange.push({ cp, colonia });
    cps.add(cp);
    records.push({ cp, colonia, tipo, colonia_normalizada: normalizeName(colonia), municipio: MUNICIPIO, estado: ESTADO });
  });

  records.sort(
    (a, b) =>
      a.cp.localeCompare(b.cp) ||
      a.colonia_normalizada.localeCompare(b.colonia_normalizada) ||
      a.tipo.localeCompare(b.tipo) ||
      a.colonia.localeCompare(b.colonia),
  );

  assignLabels(records);

  const report = {
    filasLeidas: rows.length,
    filasEscritas: records.length,
    duplicadosExactos: exactDuplicates.length,
    invalidas: invalid.length,
    cpsFueraDeRango: outOfRange.length,
    cpsDistintos: [...cps].sort(),
    etiquetasConSufijo: records.filter((r) => r.etiqueta !== r.colonia).length,
    detalleInvalidas: invalid,
    detalleDuplicados: exactDuplicates,
    detalleFueraDeRango: outOfRange,
  };

  return { records, report };
}

function assignLabels(records) {
  const groups = new Map();
  for (const record of records) {
    const key = record.colonia_normalizada;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  const used = new Map();
  for (const group of groups.values()) {
    const hasColonia = group.some((record) => record.tipo === "Colonia");
    const typeCounts = new Map();
    for (const record of group) {
      typeCounts.set(record.tipo, (typeCounts.get(record.tipo) ?? 0) + 1);
    }

    for (const record of group) {
      const parts = [];
      if (group.length > 1) {
        if (!(hasColonia && record.tipo === "Colonia")) parts.push(record.tipo.toLowerCase());
        if (typeCounts.get(record.tipo) > 1) parts.push(record.cp);
      }
      record.etiqueta = parts.length > 0 ? `${record.colonia} (${parts.join(", ")})` : record.colonia;

      const previous = used.get(record.etiqueta);
      if (previous) {
        throw new Error(
          `etiqueta duplicada "${record.etiqueta}" entre ${previous.cp}/${previous.tipo} y ${record.cp}/${record.tipo}`,
        );
      }
      used.set(record.etiqueta, record);
    }
  }
}

function csvCell(value) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function renderCsv(records) {
  const header = "cp,colonia,tipo,colonia_normalizada,etiqueta,municipio,estado";
  const body = records.map((r) =>
    [r.cp, r.colonia, r.tipo, r.colonia_normalizada, r.etiqueta, r.municipio, r.estado].map(csvCell).join(","),
  );
  return `${[header, ...body].join("\n")}\n`;
}

function main() {
  const input = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_INPUT;
  const output = process.argv[3] ? resolve(process.argv[3]) : DEFAULT_OUTPUT;
  const { records, report } = buildSettlements(readFileSync(input, "utf8"));
  writeFileSync(output, renderCsv(records), "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
