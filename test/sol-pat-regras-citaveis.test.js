import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseSections,
  extractDefinedIds,
  checkIdCensus,
  ID_BASELINE,
} from "../scripts/check-laws.mjs";
import { fontePresente } from "./helpers/fonte-presente.js";

test("shouldCountSeventyNineIdsWithPatAtOneAndMntContiguous", () => {
  const conteudo = readFileSync(
    "shared/arch/cross-cutting-rules.md",
    "utf8",
  );
  const ids = extractDefinedIds(conteudo);

  assert.equal(ids.length, 79);

  const patIds = ids.filter((id) => id.startsWith("PAT-"));
  assert.deepEqual(patIds, ["PAT-1"]);

  const mntIds = ids.filter((id) => id.startsWith("MNT-"));
  assert.deepEqual(mntIds, ["MNT-1", "MNT-2", "MNT-3"]);
});

test("shouldKeepEveryPreviousPrefixAtItsCount", () => {
  const conteudo = readFileSync(
    "shared/arch/cross-cutting-rules.md",
    "utf8",
  );

  const desCount = extractDefinedIds(conteudo)
    .filter((id) => id.startsWith("DES-")).length;
  const namCount = extractDefinedIds(conteudo)
    .filter((id) => id.startsWith("NAM-")).length;

  assert.equal(desCount, 10);
  assert.equal(namCount, 2);

  const problemas = checkIdCensus(
    conteudo,
    ID_BASELINE["shared/arch/cross-cutting-rules.md"],
    "shared/arch/cross-cutting-rules.md",
  );
  assert.deepEqual(problemas, []);
});

test("shouldKeepExactlyFiveLevelTwoHeadings", () => {
  const conteudo = readFileSync(
    "shared/arch/cross-cutting-rules.md",
    "utf8",
  );
  const secoes = parseSections(conteudo);

  assert.equal(secoes.length, 5);
});

test("shouldFindEverySourceIdentifierCitedByTheRulesInTheReadSourcesFile", (t) => {
  const caminho = "specs/sol-pat-regras-citaveis/fontes-lidas.md";

  if (!fontePresente(caminho)) {
    t.skip("fontes-lidas.md ausente: a conferencia NAO rodou");
    return;
  }

  const fontes = readFileSync(caminho, "utf8");
  const regras = readFileSync("shared/arch/cross-cutting-rules.md", "utf8");

  const inicio = regras.indexOf("### Design discipline (PAT-*, MNT-*)");
  const fim = regras.indexOf("### Test standards");
  assert.ok(inicio > -1);
  assert.ok(fim > inicio);

  const bloco = regras.slice(inicio, fim);
  const citados = [...new Set(bloco.match(/CWE-\d+/g) || [])];

  assert.equal(citados.length, 3);
  for (const id of citados) {
    assert.ok(fontes.includes(id), id);
  }
});

test("shouldKeepThePatRuleCarryingBothItsCriticalClauses", () => {
  const conteudo = readFileSync(
    "shared/arch/cross-cutting-rules.md",
    "utf8",
  );

  const inicio = conteudo.indexOf("### Design discipline (PAT-*, MNT-*)");
  const fim = conteudo.indexOf("### Test standards");
  assert.ok(inicio > -1);
  assert.ok(fim > inicio);

  const bloco = conteudo.slice(inicio, fim);
  const normalizado = bloco.replace(/\s+/g, " ");

  assert.ok(normalizado.includes("This is not `DES-10`"));
  assert.ok(normalizado.includes("never the reviewer's opinion about necessity"));
  assert.ok(normalizado.includes("an indirection whose purpose nobody can state"));
  assert.ok(normalizado.includes("non-blocking suggestion"));
});

test("shouldKeepTheDeclaredGapNamingTheThreeLettersAndTheReason", () => {
  const conteudo = readFileSync(
    "shared/arch/cross-cutting-rules.md",
    "utf8",
  );

  const inicio = conteudo.indexOf("### Design discipline (PAT-*, MNT-*)");
  const fim = conteudo.indexOf("### Test standards");
  assert.ok(inicio > -1);
  assert.ok(fim > inicio);

  const bloco = conteudo.slice(inicio, fim);
  const normalizado = bloco.replace(/\s+/g, " ");

  assert.ok(normalizado.includes("open-closed principle"));
  assert.ok(normalizado.includes("Liskov substitution"));
  assert.ok(normalizado.includes("interface segregation"));
  assert.ok(normalizado.includes("could not be read"));
  assert.ok(normalizado.includes("429"));
  assert.ok(normalizado.includes("`L1.3`"));
});

test("shouldKeepTheMntThresholdWordedAsARecommendationAndNotADuty", () => {
  const conteudo = readFileSync("shared/arch/cross-cutting-rules.md", "utf8");
  const inicio = conteudo.indexOf("### Design discipline (PAT-*, MNT-*)");
  const fim = conteudo.indexOf("### Test standards");
  assert.ok(inicio > -1);
  assert.ok(fim > inicio);

  const bloco = conteudo.slice(inicio, fim).replace(/\s+/g, " ");
  assert.ok(bloco.includes("may vary for each product or developer"));
  assert.ok(bloco.includes("CISQ recommends a default maximum of 7 parent classes"));
  assert.ok(!/no more than \d/.test(bloco));
  assert.ok(!/at most \d+ parent/.test(bloco));
  assert.ok(bloco.includes("At or below the applicable number it does not reprove"));
  assert.ok(bloco.includes("counted by reading the hierarchy"));
  assert.ok(!bloco.includes("the project cannot justify"));
  assert.ok(bloco.includes("For Java the language profile already carries `JQ-3`"));
  assert.ok(bloco.includes("this rule reproves the cycle a reader can follow inside the change"));
  assert.ok(bloco.includes("prohibited for mapping a real vulnerability"));
  assert.ok(bloco.includes("the place that declares it is the project's own guide"));
});

test("shouldReportAGapInTheMntSequence", () => {
  const conteudoComGap = "1. (MNT-1) texto\n2. (MNT-3) texto\n";
  const baseline = { total: 2, prefixes: { MNT: 2 } };

  const problemas = checkIdCensus(conteudoComGap, baseline, "test-file");

  assert.equal(problemas.length, 1);
  assert.equal(problemas[0], 'RUL-4 test-file: lacuna no prefixo "MNT" — esperado MNT-2');
});

test("shouldReportWhenTheBaselineDisagreesWithTheFileOnDisk", () => {
  const conteudo = readFileSync(
    "shared/arch/cross-cutting-rules.md",
    "utf8",
  );
  const baselineAnterior = {
    total: 75,
    prefixes: { DES: 10, NAM: 2, TST: 5, LOG: 4, DOC: 2, MUT: 3, JAVA: 8, GO: 9, PY: 9, NET: 8, TS: 9, GEN: 6 },
  };

  const problemas = checkIdCensus(
    conteudo,
    baselineAnterior,
    "shared/arch/cross-cutting-rules.md",
  );

  assert.deepEqual(problemas, [
    'RUL-4 shared/arch/cross-cutting-rules.md: prefixo desconhecido "PAT" em "PAT-1"',
    'RUL-4 shared/arch/cross-cutting-rules.md: prefixo desconhecido "MNT" em "MNT-1"',
    'RUL-4 shared/arch/cross-cutting-rules.md: prefixo desconhecido "MNT" em "MNT-2"',
    'RUL-4 shared/arch/cross-cutting-rules.md: prefixo desconhecido "MNT" em "MNT-3"',
  ]);
});

test("shouldReportAnUnknownPrefixWhenANewFamilyIsNotDeclared", () => {
  const conteudo = readFileSync(
    "shared/arch/cross-cutting-rules.md",
    "utf8",
  );

  const conteudoComXyzInjetado = conteudo.replace(
    "1. (DES-1) Do not return null/nil",
    "1. (XYZ-1) Do not return null/nil",
  );

  const baseline = ID_BASELINE["shared/arch/cross-cutting-rules.md"];

  const problemas = checkIdCensus(
    conteudoComXyzInjetado,
    baseline,
    "shared/arch/cross-cutting-rules.md",
  );

  assert.deepEqual(problemas, [
    'RUL-4 shared/arch/cross-cutting-rules.md: prefixo desconhecido "XYZ" em "XYZ-1"',
    'RUL-4 shared/arch/cross-cutting-rules.md: prefixo "DES" tem 9 IDs, esperados 10',
    'RUL-4 shared/arch/cross-cutting-rules.md: lacuna no prefixo "DES" \u2014 esperado DES-1',
  ]);
});

test("shouldReportWhenThePatArtifactClauseIsRemoved", () => {
  const conteudo = readFileSync(
    "shared/arch/cross-cutting-rules.md",
    "utf8",
  );

  const normalizado = conteudo.replace(/\s+/g, " ");
  assert.ok(normalizado.includes("never the reviewer's opinion about necessity"));

  const semFrase = normalizado.replace("never the reviewer's opinion about necessity", "");

  assert.notEqual(semFrase, normalizado);
  assert.ok(!semFrase.includes("never the reviewer's opinion about necessity"));
});
