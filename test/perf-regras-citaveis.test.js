import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  parseSections,
  extractDefinedIds,
  checkIdCensus,
  ID_BASELINE,
} from "../scripts/check-laws.mjs";

const fontePresente = (caminho) => {
  const existe = existsSync(caminho);
  if (!existe) {
    console.error(
      `[declarado] ${caminho} ausente (specs/ e gitignored): este caso NAO foi conferido nesta execucao`,
    );
  }
  return existe;
};

test("shouldCountThirtyOneIdsWithPerfContiguousFromOneToFive", () => {
  const conteudo = readFileSync(
    "shared/quality/quality-rules.md",
    "utf8",
  );
  const ids = extractDefinedIds(conteudo);

  assert.equal(ids.length, 31);

  const perfIds = ids.filter((id) => id.startsWith("PERF-"));
  assert.deepEqual(perfIds, ["PERF-1", "PERF-2", "PERF-3", "PERF-4", "PERF-5"]);
});

test("shouldKeepTheFourPreviousPrefixesAtTheirCounts", () => {
  const conteudo = readFileSync(
    "shared/quality/quality-rules.md",
    "utf8",
  );
  const ids = extractDefinedIds(conteudo);

  const qualCount = ids.filter((id) => id.startsWith("QUAL-")).length;
  const jqCount = ids.filter((id) => id.startsWith("JQ-")).length;
  const jsCount = ids.filter((id) => id.startsWith("JS-")).length;
  const secCount = ids.filter((id) => id.startsWith("SEC-")).length;

  assert.equal(qualCount, 7);
  assert.equal(jqCount, 8);
  assert.equal(jsCount, 4);
  assert.equal(secCount, 7);

  const problemas = checkIdCensus(
    conteudo,
    ID_BASELINE["shared/quality/quality-rules.md"],
    "shared/quality/quality-rules.md",
  );
  assert.deepEqual(problemas, []);
});

test("shouldKeepExactlyThreeLevelTwoHeadingsInQualityRules", () => {
  const conteudo = readFileSync(
    "shared/quality/quality-rules.md",
    "utf8",
  );
  const secoes = parseSections(conteudo);

  assert.equal(secoes.length, 3);
});

test("shouldFindEverySourceIdentifierCitedByTheRulesInTheReadSourcesFile", () => {
  const caminho = "specs/perf-regras-citaveis/fontes-lidas.md";

  if (!fontePresente(caminho)) {
    return;
  }

  const fontes = readFileSync(caminho, "utf8");
  const regras = readFileSync("shared/quality/quality-rules.md", "utf8");
  const praticas = readFileSync("shared/arch/cross-cutting-rules.md", "utf8");

  const inicioPerf = regras.indexOf("### Performance (PERF-*)");
  const fimPerf = regras.indexOf("## Language profile");
  assert.ok(inicioPerf > -1);
  assert.ok(fimPerf > inicioPerf);

  const inicioPraticas = praticas.indexOf("5. **Query that cannot use an index**");
  const fimPraticas = praticas.indexOf("## Cross-cutting anti-patterns");
  assert.ok(inicioPraticas > -1);
  assert.ok(fimPraticas > inicioPraticas);

  const texto = regras.slice(inicioPerf, fimPerf) + praticas.slice(inicioPraticas, fimPraticas);
  const citados = [...new Set([
    ...(texto.match(/CWE-\d+/g) || []),
    ...(texto.match(/API\d+:\d{4}/g) || []),
  ])];

  assert.equal(citados.length, 7);
  for (const id of citados) {
    assert.ok(fontes.includes(id), id);
  }
  assert.ok(texto.includes("Use The Index, Luke"));
  assert.ok(fontes.includes("Use The Index, Luke"));
});

test("shouldKeepTheTwoGoodPracticesWithoutAnyRuleIdentifier", () => {
  const conteudo = readFileSync(
    "shared/arch/cross-cutting-rules.md",
    "utf8",
  );

  const ids = extractDefinedIds(conteudo);
  assert.equal(ids.length, 75);

  const inicio = conteudo.indexOf("5. **Query that cannot use an index**");
  const fimReferencia = conteudo.indexOf("## Cross-cutting anti-patterns");
  assert.ok(inicio > -1);
  assert.ok(fimReferencia > inicio);

  const trechoTexto = conteudo.slice(inicio, fimReferencia);
  assert.ok(trechoTexto.includes("Instrument missing"));
  const regexComParenteses = /\([A-Z]{2,}-\d+\)/;

  assert.ok(!regexComParenteses.test(trechoTexto));
});

test("shouldKeepThePerfThresholdsWordedAsRecommendationsAndNotAsDuties", () => {
  const conteudo = readFileSync("shared/quality/quality-rules.md", "utf8");
  const inicio = conteudo.indexOf("### Performance (PERF-*)");
  const fim = conteudo.indexOf("## Language profile");
  assert.ok(inicio > -1);
  assert.ok(fim > inicio);

  const bloco = conteudo.slice(inicio, fim);
  assert.ok(bloco.includes("CISQ recommends a baseline maximum of 2"));
  assert.ok(bloco.includes("varies by product"));
  assert.ok(bloco.includes("recommended defaults that vary by product, never as absolute limits"));
  assert.ok(!/no more than \d/.test(bloco));
  assert.ok(!/at most \d+ data access/.test(bloco));
});

test("shouldKeepTheAssemblyInstructionFreeOfPrefixEnumeration", () => {
  const conteudo = readFileSync("skills/spec-init/SKILL.md", "utf8");

  assert.ok(conteudo.includes("whatever the prefix"));
  assert.ok(!conteudo.includes("SEC-"));
  assert.ok(!conteudo.includes("reading aid"));
  assert.ok(conteudo.includes("Applied by `spec-execute` while coding"));
});

test("shouldReportAGapInThePerfSequence", () => {
  const conteudoComGap = "1. (PERF-1) texto\n2. (PERF-2) texto\n3. (PERF-4) texto\n4. (PERF-5) texto\n";
  const baseline = { total: 4, prefixes: { PERF: 4 } };

  const problemas = checkIdCensus(conteudoComGap, baseline, "test-file");

  assert.equal(problemas.length, 1);
  assert.equal(problemas[0], 'RUL-4 test-file: lacuna no prefixo "PERF" \u2014 esperado PERF-3');
});

test("shouldReportWhenTheBaselineDisagreesWithTheFileOnDisk", () => {
  const conteudo = readFileSync(
    "shared/quality/quality-rules.md",
    "utf8",
  );
  const baselineAnterior = {
    total: 26,
    prefixes: { QUAL: 7, JQ: 8, JS: 4, SEC: 7 },
  };

  const problemas = checkIdCensus(
    conteudo,
    baselineAnterior,
    "shared/quality/quality-rules.md",
  );

  assert.equal(problemas.length, 5);
  assert.equal(
    problemas[0],
    'RUL-4 shared/quality/quality-rules.md: prefixo desconhecido "PERF" em "PERF-1"',
  );
});

test("shouldReportAnUnknownPrefixWhenAGoodPracticeGainsAnIdentifier", () => {
  const conteudo = readFileSync(
    "shared/arch/cross-cutting-rules.md",
    "utf8",
  );

  const conteudoComPerfInjetado = conteudo.replace(
    "1. **Automated enforcement of the dependency direction**",
    "1. (PERF-6) **Automated enforcement of the dependency direction**",
  );

  const baseline = ID_BASELINE["shared/arch/cross-cutting-rules.md"];

  const problemas = checkIdCensus(
    conteudoComPerfInjetado,
    baseline,
    "shared/arch/cross-cutting-rules.md",
  );

  assert.equal(problemas.length, 1);
  assert.equal(
    problemas[0],
    'RUL-4 shared/arch/cross-cutting-rules.md: prefixo desconhecido "PERF" em "PERF-6"',
  );
});

test("shouldReportWhenTheDeclaredGapNoteIsMissing", () => {
  const conteudo = readFileSync(
    "shared/quality/quality-rules.md",
    "utf8",
  );

  const normalizado = conteudo.replace(/\s+/g, " ");
  assert.ok(normalizado.includes("What this family does NOT cover"));
  assert.ok(normalizado.includes("projections instead of whole aggregates"));
  assert.ok(normalizado.includes("pagination on any growing collection"));
  assert.ok(normalizado.includes("non-blocking suggestion"));
  assert.ok(normalizado.includes("`L1.3`"));

  const conteudoSemFrase = conteudo.replace(
    "What this family does NOT cover, and it is named so that nobody reads the gap as permission.",
    "",
  );

  assert.ok(!conteudoSemFrase.includes("What this family does NOT cover"));
});
