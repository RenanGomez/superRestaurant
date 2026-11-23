import assert from "node:assert/strict";
import test from "node:test";

import { buildSettlements, normalizeName, renderCsv } from "./normalize-settlements.mjs";

const HEADER = "Asentamiento/Colonia,Código Postal,Tipo de Asentamiento";
const SAMPLE = [
  HEADER,
  "Beltrones,85860,Ampliación",
  "Beltrones,85860,Colonia",
  "Beltrones,85861,Colonia",
  "Beltrones,85860,Ampliación",
  ",85862,Colonia",
  "Mal CP,8586,Colonia",
  "Barrio Cantúa,85237,Barrio",
  "Fuera de rango,85000,Colonia",
].join("\r\n");

test("normalizeName quita acentos, mayúsculas y signos", () => {
  assert.equal(normalizeName("  Ampliación  "), "ampliacion");
  assert.equal(normalizeName("Barrio Cantúa"), "barrio cantua");
  assert.equal(normalizeName("Av. Juárez #5"), "av juarez 5");
  assert.equal(normalizeName(""), "");
});

test("buildSettlements valida, deduplica exactos y conserva duplicados legítimos", () => {
  const { records, report } = buildSettlements(SAMPLE);

  assert.equal(report.filasLeidas, 8);
  assert.equal(report.filasEscritas, 5);
  assert.equal(report.duplicadosExactos, 1);
  assert.equal(report.invalidas, 2);
  assert.equal(report.cpsFueraDeRango, 1);
  assert.deepEqual(report.cpsDistintos, ["85000", "85237", "85860", "85861"]);
  assert.equal(report.etiquetasConSufijo, 3);
  assert.deepEqual(
    report.detalleInvalidas.map((r) => r.reason),
    ["colonia vacía", "CP inválido"],
  );

  assert.deepEqual(
    records.map((r) => [r.cp, r.colonia, r.tipo]),
    [
      ["85000", "Fuera de rango", "Colonia"],
      ["85237", "Barrio Cantúa", "Barrio"],
      ["85860", "Beltrones", "Ampliación"],
      ["85860", "Beltrones", "Colonia"],
      ["85861", "Beltrones", "Colonia"],
    ],
  );
  assert.equal(records[1].colonia_normalizada, "barrio cantua");
  assert.equal(records[0].municipio, "Navojoa");
  assert.equal(records[0].estado, "Sonora");
});

test("buildSettlements y renderCsv son deterministas byte a byte", () => {
  const first = renderCsv(buildSettlements(SAMPLE).records);
  const second = renderCsv(buildSettlements(SAMPLE).records);
  assert.equal(first, second);
  assert.equal(
    first,
    [
      "cp,colonia,tipo,colonia_normalizada,etiqueta,municipio,estado",
      "85000,Fuera de rango,Colonia,fuera de rango,Fuera de rango,Navojoa,Sonora",
      "85237,Barrio Cantúa,Barrio,barrio cantua,Barrio Cantúa,Navojoa,Sonora",
      "85860,Beltrones,Ampliación,beltrones,Beltrones (ampliación),Navojoa,Sonora",
      "85860,Beltrones,Colonia,beltrones,Beltrones (85860),Navojoa,Sonora",
      "85861,Beltrones,Colonia,beltrones,Beltrones (85861),Navojoa,Sonora",
      "",
    ].join("\n"),
  );
});

test("etiqueta sin sufijo para Colonia y con tipo para el resto", () => {
  const sample = [
    HEADER,
    "Beltrones,85860,Ampliación",
    "Beltrones,85860,Colonia",
  ].join("\r\n");
  const { records } = buildSettlements(sample);
  const etiquetas = Object.fromEntries(records.map((r) => [r.tipo, r.etiqueta]));

  assert.equal(etiquetas.Colonia, "Beltrones");
  assert.equal(etiquetas["Ampliación"], "Beltrones (ampliación)");
});

test("etiqueta añade el CP cuando el mismo tipo se repite", () => {
  const sample = [
    HEADER,
    "Santa Isabel,85226,Ranchería",
    "Santa Isabel,85238,Ranchería",
  ].join("\r\n");
  const { records } = buildSettlements(sample);

  assert.deepEqual(
    records.map((r) => r.etiqueta),
    ["Santa Isabel (ranchería, 85226)", "Santa Isabel (ranchería, 85238)"],
  );
});

test("etiqueta única para nombres no repetidos", () => {
  const sample = [HEADER, "Barrio Cantúa,85237,Barrio"].join("\r\n");
  const { records, report } = buildSettlements(sample);

  assert.equal(records[0].etiqueta, "Barrio Cantúa");
  assert.equal(report.etiquetasConSufijo, 0);
});

test("buildSettlements falla si dos etiquetas colisionan", () => {
  const sample = [
    HEADER,
    "Beltrones,85860,Ampliación",
    "Beltrones,85860,Colonia",
    "Beltrones (ampliación),85860,Colonia",
  ].join("\r\n");

  assert.throws(() => buildSettlements(sample), /etiqueta duplicada "Beltrones \(ampliación\)"/);
});
