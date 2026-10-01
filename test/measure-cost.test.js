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

| task | agente | modelo | esforço | tokens | chamadas |
|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 1000 | 5 |
| P0.2 | mgr-draft | claude | medium | 2000 | 3 |
`;
  const { linhas, problemas } = parseCostTable(texto);
  assert.deepEqual(problemas, []);
  assert.equal(linhas.length, 2);
  const totalTokens = linhas.reduce((sum, l) => sum + l.tokens, 0);
  assert.equal(totalTokens, 3000);
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

| task | agente | modelo | esforço | tokens | chamadas |
|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 30.717 | 5 |
| P0.2 | mgr-draft | claude | medium | abc | 3 |
| P0.3 | mgr-execute | gpt | high | 1000 | 2 |
`;
  const { linhas, problemas } = parseCostTable(texto);
  assert.equal(problemas.length, 2);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].task, "P0.3");
});

test("shouldReportARowWithTheWrongColumnCount", () => {
  const texto = `
## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas |
|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 1000 |
`;
  const { problemas } = parseCostTable(texto);
  assert.equal(problemas.length, 1);
  assert.ok(problemas[0].includes("5"));
  assert.ok(problemas[0].includes("6"));
});

test("shouldAcceptTheHeadingWithOrWithoutTheAccent", () => {
  const textoComAcento = `
## Custo de comissão

| task | agente | modelo | esforço | tokens | chamadas |
|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 1000 | 5 |
`;
  const textoSemAcento = `
## Custo de comissao

| task | agente | modelo | esforço | tokens | chamadas |
|---|---|---|---|---|---|
| P0.1 | mgr-task | haiku | low | 1000 | 5 |
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

| task | agente | modelo | esforço | tokens | chamadas |
|---|---|---|---|---|---|
| P1.1 | mgr-task | haiku | low | 1000 | 5 |
| P1.3 | orquestrador | opus | — | — | — |
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

test("shouldKeepExitZeroWhenTheNumbersAreHighAndFindingsExist", () => {
  if (!fatiaPresente("metodo-mede-o-custo")) return;
  const impressas = [];
  const code = main(["metodo-mede-o-custo"], (linha) => impressas.push(linha));
  assert.equal(code, 0);
  assert.match(impressas.join("\n"), /TOTAL/);
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
