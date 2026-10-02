import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  estimateTokens,
  main,
  measureArtifacts,
  parseCostTable,
  readSliceArtifacts,
  resolveSlugPath,
} from "../scripts/measure-cost.mjs";

const fatiaPresente = (slug) => {
  const existe = existsSync(path.join("specs", slug));
  if (!existe) {
    console.error(
      `[declarado] fatia ${slug} ausente (specs/ e gitignored): este caso NAO foi conferido nesta execucao`,
    );
  }
  return existe;
};

test("shouldMeasureTheThreeRealSlicesWithoutInstrumentFindings", () => {
  const slugs = ["corte-regra-obrigatoria", "sec-regras-citaveis", "metodo-mede-o-custo"]
    .filter(fatiaPresente);
  for (const slug of slugs) {
    const resultado = resolveSlugPath(slug);
    assert.deepEqual(resultado.problems, []);
    assert.ok(resultado.paths.length > 0);
  }
});

test("shouldParseAWellFormedCostRecord", () => {
  const texto = `
## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas | determinado | linhas |
|---|---|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 1000 | 5 | forma | 40 |
| P0.2 | mgr-draft | claude | medium | 2000 | 3 | forma | 120 |
`;
  const { linhas, problemas } = parseCostTable(texto);
  assert.deepEqual(problemas, []);
  assert.equal(linhas.length, 2);
  const totalTokens = linhas.reduce((sum, l) => sum + l.tokens, 0);
  assert.equal(totalTokens, 3000);
});

test("shouldParseTheEightColumnTableWithBothDeterminationValues", () => {
  const texto = `
## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas | determinado | linhas |
|---|---|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 1000 | 5 | forma | 40 |
| P0.2 | mgr-draft | claude | medium | 2000 | 3 | decisao | 280 |
`;
  const { linhas, problemas } = parseCostTable(texto);
  assert.deepEqual(problemas, []);
  assert.equal(linhas[0].determinado, "forma");
  assert.equal(linhas[1].determinado, "decisao");
  assert.equal(linhas[1].linhasEntregues, 280);
});

test("shouldReportASixColumnRecordInsteadOfAcceptingIt", () => {
  const texto = `
## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas |
|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 1000 | 5 |
`;
  const { linhas, problemas } = parseCostTable(texto);
  assert.equal(problemas.length, 1);
  assert.ok(problemas[0].includes("obteve 6"));
  assert.equal(linhas.length, 0);
});

test("shouldRejectADashAsDetermination", () => {
  const texto = `
## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas | determinado | linhas |
|---|---|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 1000 | 5 | — | 40 |
`;
  const { linhas, problemas } = parseCostTable(texto);
  assert.equal(problemas.length, 1);
  assert.equal(problemas[0], 'Linha 6: \'determinado\' nao e "forma" nem "decisao": "\u2014"');
  assert.equal(linhas.length, 0);
});

test("shouldAcceptADashAsLinesDeliveredWithoutCountingItAsZero", () => {
  const texto = `
## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas | determinado | linhas |
|---|---|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 1000 | 5 | decisao | — |
`;
  const { linhas, problemas } = parseCostTable(texto);
  assert.deepEqual(problemas, []);
  assert.equal(linhas[0].linhasEntregues, "—");
  assert.notEqual(linhas[0].linhasEntregues, 0);
});

test("shouldReportLinesDeliveredThatIsNeitherIntegerNorDash", () => {
  const texto = `
## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas | determinado | linhas |
|---|---|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 1000 | 5 | forma | muitas |
`;
  const { linhas, problemas } = parseCostTable(texto);
  assert.equal(problemas.length, 1);
  assert.equal(problemas[0], "Linha 6: 'linhas' nao e inteiro nem travessao: \"muitas\"");
  assert.equal(linhas.length, 0);
});

test("shouldApplyTheCompleteL33FormulaWithTheBuffer", () => {
  const resultado = estimateTokens(53483);
  assert.equal(resultado, 16044);
  assert.notEqual(resultado, 13370);
});

test("shouldReportASliceThatDoesNotExist", () => {
  const resultado = resolveSlugPath("fatia-que-nao-existe");
  assert.equal(resultado.problems.length, 1);
  assert.match(resultado.problems[0], /Diretorio da fatia nao existe/);
});

test("shouldReportAMissingCostSection", () => {
  const texto = "## Outro cabeçalho\n\nAlgum texto";
  const { problemas } = parseCostTable(texto);
  assert.equal(problemas.length, 1);
});

test("shouldReportACostSectionWithNoDataRow", () => {
  const texto = `
## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas |
|---|---|---|---|---|---|
`;
  const { problemas } = parseCostTable(texto);
  assert.equal(problemas.length, 1);
});

test("shouldReportANonIntegerTokenCount", () => {
  const texto = `
## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas | determinado | linhas |
|---|---|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 30.717 | 5 | forma | 40 |
| P0.2 | mgr-draft | claude | medium | abc | 3 | forma | 40 |
| P0.3 | mgr-execute | gpt | high | 1000 | 2 | forma | 40 |
`;
  const { linhas, problemas } = parseCostTable(texto);
  assert.equal(problemas.length, 2);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].task, "P0.3");
});

test("shouldReportARowWithTheWrongColumnCount", () => {
  const texto = `
## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas | determinado | linhas |
|---|---|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 1000 |
`;
  const { problemas } = parseCostTable(texto);
  assert.equal(problemas.length, 1);
  assert.equal(problemas[0], "Linha 6: esperadas 8 colunas, obteve 5");
});

test("shouldReportSevenColumnsWhenTheDeterminationCellIsEmpty", () => {
  const texto = `
## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas | determinado | linhas |
|---|---|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 1000 | 5 |  | 40 |
`;
  const { linhas, problemas } = parseCostTable(texto);
  assert.equal(problemas.length, 1);
  assert.equal(problemas[0], "Linha 6: esperadas 8 colunas, obteve 7");
  assert.equal(linhas.length, 0);
});

test("shouldReportNineColumnsWithTheCountObtained", () => {
  const texto = `
## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas | determinado | linhas |
|---|---|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 1000 | 5 | forma | 40 | sobrando |
`;
  const { linhas, problemas } = parseCostTable(texto);
  assert.equal(problemas.length, 1);
  assert.equal(problemas[0], "Linha 6: esperadas 8 colunas, obteve 9");
  assert.equal(linhas.length, 0);
});

test("shouldRejectADeterminationOutsideTheVocabularyNamingTheLine", () => {
  const texto = `
## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas | determinado | linhas |
|---|---|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 1000 | 5 | talvez | 40 |
`;
  const { linhas, problemas } = parseCostTable(texto);
  assert.equal(problemas.length, 1);
  assert.equal(problemas[0], 'Linha 6: \'determinado\' nao e "forma" nem "decisao": "talvez"');
  assert.equal(linhas.length, 0);
});

test("shouldAcceptTheHeadingWithOrWithoutTheAccent", () => {
  const textoComAcento = `
## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas | determinado | linhas |
|---|---|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 1000 | 5 | forma | 40 |
`;
  const textoSemAcento = `
## Custo de comissao

| task | agente | modelo | esforço | tokens | chamadas | determinado | linhas |
|---|---|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 1000 | 5 | forma | 40 |
`;
  const { problemas: problemas1 } = parseCostTable(textoComAcento);
  const { problemas: problemas2 } = parseCostTable(textoSemAcento);
  assert.deepEqual(problemas1, []);
  assert.deepEqual(problemas2, []);
});

test("shouldCountEveryMarkdownFileOfTheSliceIncludingTheOnesSpecStatusDoesNotDeclare", () => {
  const base = mkdtempSync(path.join(tmpdir(), "mc-extras-"));
  const sliceDir = path.join(base, "fatia-com-extra");

  mkdirSync(sliceDir, { recursive: true });

  try {
    for (let i = 1; i <= 7; i++) {
      writeFileSync(
        path.join(sliceDir, `${i.toString().padStart(2, "0")}-file.md`),
        "# Content\n",
        "utf8"
      );
    }

    const resultado = resolveSlugPath("fatia-com-extra", base);
    assert.equal(resultado.paths.length, 7);
    assert.deepEqual(resultado.problems, []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("shouldCountCharactersAndNotBytesOnAccentedText", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mc-acentos-"));
  const fatia = path.join(dir, "fatia-acentuada");
  mkdirSync(fatia);
  const acentuado = "coração, ação, informação, decisão\n";
  writeFileSync(path.join(fatia, "01-brief.md"), acentuado);
  try {
    const caracteres = acentuado.length;
    const bytes = Buffer.byteLength(acentuado, "utf8");
    assert.notEqual(caracteres, bytes);
    const { paths } = resolveSlugPath("fatia-acentuada", dir);
    const { artefatos } = readSliceArtifacts(paths);
    assert.equal(artefatos[0].chars, caracteres);
    assert.notEqual(artefatos[0].chars, bytes);
    const { totalTokens } = measureArtifacts(artefatos);
    assert.equal(totalTokens, estimateTokens(caracteres));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shouldCountExtraArtifactsOnTheSpecStatusBranchToo", () => {
  if (!fatiaPresente("sec-regras-citaveis")) return;
  const comExtras = resolveSlugPath("sec-regras-citaveis");
  assert.equal(comExtras.method, "mgr spec status");
  assert.ok(comExtras.extras.length > 0);
  assert.equal(
    comExtras.paths.length,
    comExtras.canonicos.length + comExtras.extras.length,
  );
  for (const extra of comExtras.extras) {
    assert.ok(!comExtras.canonicos.includes(extra));
  }
});

test("shouldAcceptADashAsCostNotReturnedWithoutCountingItAsZero", () => {
  const texto = `
## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas | determinado | linhas |
|---|---|---|---|---|---|---|---|
| P1.1 | mgr-task | haiku | low | 1000 | 5 | forma | 40 |
| P1.3 | orquestrador | opus | — | — | — | decisao | 280 |
`;
  const { linhas, problemas } = parseCostTable(texto);
  assert.deepEqual(problemas, []);
  assert.equal(linhas.length, 2);
  assert.equal(linhas[1].tokens, "\u2014");
  assert.equal(linhas[1].chamadas, "\u2014");
  assert.notEqual(linhas[1].tokens, 0);
  assert.notEqual(linhas[1].tokens, null);
});

test("shouldDeclareTheThreeUnmeasuredParcelsInTheOutput", () => {
  if (!fatiaPresente("metodo-mede-o-custo")) return;
  const impressas = [];
  const code = main(["metodo-mede-o-custo"], (linha) => impressas.push(linha));
  const saida = impressas.join("\n");
  assert.equal(code, 0);
  assert.match(saida, /NAO medido/);
  assert.match(saida, /janela do orquestrador/);
  assert.match(saida, /retrabalho de comissao/);
  assert.match(saida, /idas e voltas com o autor/);
  assert.match(saida, /custo das COMISSOES, nunca/);
});

const montaFatia = (prefixo, plano, registro) => {
  const base = mkdtempSync(path.join(tmpdir(), prefixo));
  const fatia = path.join(base, "fatia-montada");
  mkdirSync(fatia, { recursive: true });
  writeFileSync(path.join(fatia, "01-brief.md"), "# Brief\n", "utf8");
  writeFileSync(path.join(fatia, "04-plan.md"), plano, "utf8");
  writeFileSync(path.join(fatia, "05-execution.md"), registro, "utf8");
  return base;
};

test("shouldDetectADoneTaskWithTwoHashHeadersSoTheGapCheckCanActuallyFail", () => {
  const plano = `<!-- mgr-plan-format: 1 -->
## P0.1 — primeira
- **status:** done

## P0.2 — segunda
- **status:** done
`;
  const registro = `## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas | determinado | linhas |
|---|---|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 1000 | 5 | forma | 40 |
`;
  const base = montaFatia("mc-dt7-", plano, registro);
  try {
    const impressas = [];
    const code = main(["fatia-montada"], (linha) => impressas.push(linha), base);
    const saida = impressas.join("\n");
    assert.equal(code, 0);
    assert.match(saida, /Task P0\.2 com status done mas sem linha no registro de custo/);
    assert.doesNotMatch(saida, /Task P0\.1 com status done/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("shouldKeepExitZeroAndDeclareNotMeasuredWhenEveryRecordRowIsRefused", () => {
  const plano = `<!-- mgr-plan-format: 1 -->
## P0.1 — primeira
- **status:** done

## P0.2 — segunda
- **status:** done
`;
  const registro = `## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas |
|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 30717 | 12 |
| P0.2 | mgr-task | haiku | low | 28140 | 5 |
`;
  const base = montaFatia("mc-recusado-", plano, registro);
  try {
    const impressas = [];
    const code = main(["fatia-montada"], (linha) => impressas.push(linha), base);
    const saida = impressas.join("\n");
    assert.equal(code, 0);
    assert.match(saida, /artefato \/ comissao: nao medido/);
    assert.doesNotMatch(saida, /artefato \/ comissao: 0,0%/);
    assert.match(saida, /Registro com 2 linha\(s\) recusada\(s\)/);
    assert.doesNotMatch(saida, /Task P0\.1 com status done mas sem linha/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("shouldDeclareNotMeasuredWhenEveryRowWasDoneInTheOrchestrator", () => {
  const plano = `<!-- mgr-plan-format: 1 -->
## P0.1 — primeira
- **status:** done
`;
  const registro = `## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas | determinado | linhas |
|---|---|---|---|---|---|---|---|
| P0.1 | orquestrador | opus | — | — | — | decisao | 40 |
`;
  const base = montaFatia("mc-orq-", plano, registro);
  try {
    const impressas = [];
    const code = main(["fatia-montada"], (linha) => impressas.push(linha), base);
    const saida = impressas.join("\n");
    assert.equal(code, 0);
    assert.match(saida, /artefato \/ comissao: nao medido/);
    assert.doesNotMatch(saida, /artefato \/ comissao: 0,0%/);
    assert.doesNotMatch(saida, /TOTAL {26}0 {8}0/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("shouldPrintDeterminationAndLinesDeliveredInTheCostTable", () => {
  const plano = `<!-- mgr-plan-format: 1 -->
## P0.1 — primeira
- **status:** done

## P1.1 — segunda
- **status:** done
`;
  const registro = `## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas | determinado | linhas |
|---|---|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 1000 | 5 | forma | 40 |
| P1.1 | orquestrador | opus | — | — | — | decisao | — |
`;
  const base = montaFatia("mc-saida-", plano, registro);
  try {
    const impressas = [];
    const code = main(["fatia-montada"], (linha) => impressas.push(linha), base);
    const saida = impressas.join("\n");
    assert.equal(code, 0);
    assert.match(saida, /^ {2}task {6}agente {8}modelo {2}esforco {3}tokens chamadas {2}determinado {2}linhas$/m);
    const linhasSaida = saida.split("\n");
    const cabecalho = linhasSaida.find((l) => l.includes("determinado"));
    const dado = linhasSaida.find((l) => l.includes("forma"));
    assert.equal(cabecalho.length, dado.length);
    assert.match(saida, /forma {12}40/);
    assert.match(saida, /decisao {11}—/);
    assert.match(saida, /1 linha\(s\) sem tamanho entregue, fora do total de linhas/);
    assert.match(saida, /TOTAL.* {18}40/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("shouldKeepExitZeroWhenTheNumbersAreHighAndFindingsExist", () => {
  const plano = `<!-- mgr-plan-format: 1 -->
## P0.1 — primeira
- **status:** done
`;
  const registro = `## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas | determinado | linhas |
|---|---|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 346950 | 120 | forma | 40 |
| P9.9 | mgr-task | haiku | low | 214228 | 66 | decisao | abc |
`;
  const base = montaFatia("mc-altos-", plano, registro);
  try {
    const impressas = [];
    const code = main(["fatia-montada"], (linha) => impressas.push(linha), base);
    const saida = impressas.join("\n");
    assert.equal(code, 0);
    assert.match(saida, /346950/);
    assert.match(saida, /ACHADO/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  assert.equal(main([], () => {}), 1);
  assert.equal(main(["fatia-que-nao-existe-em-lugar-nenhum"], () => {}), 1);
});

test("shouldLogBeforeAndAfterTheSubprocess", () => {
  if (!fatiaPresente("metodo-mede-o-custo")) return;
  const registradas = [];
  resolveSlugPath("metodo-mede-o-custo", "specs", (linha) => registradas.push(linha));
  assert.equal(registradas.length, 2);
  assert.match(registradas[0], /resolvendo caminhos de metodo-mede-o-custo via mgr spec status/);
  assert.match(registradas[1], /mgr spec status devolveu status 0/);
});
