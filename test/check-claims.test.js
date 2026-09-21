import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkText, checkTree, ehCodigo, ehMarkdownDistribuido, ehShell, sourceFiles,
} from "../scripts/check-claims.mjs";

const ACENTO_ALTO = String.fromCharCode(0xC0);
const ACENTO_BAIXO = String.fromCharCode(0xFF);
const E_AGUDO = String.fromCharCode(0xE9);

test("shouldReproveLiteralEscapeInDistributedMarkdown", () => {
  const [achado] = checkText("README.md", "| capacidade | descricao |\\n");
  assert.match(achado, /^CLM-1 README\.md:1: literal/,
    "foi o defeito real de 2026-09-20: dois caracteres crus no fim da linha, em texto que vai no pacote");
});

test("shouldAcceptDistributedMarkdownWithoutLiteralEscape", () => {
  assert.deepEqual(checkText("README.md", "| capacidade | descricao |\n"), [],
    "o caso negativo: o markdown correto tem a quebra de linha de verdade, nao os dois caracteres");
});

test("shouldIgnoreLiteralEscapeInMarkdownThatIsNotDistributed", () => {
  assert.deepEqual(checkText("docs/sdd/03-contracts.md", "texto com \\n aqui"), [],
    "docs/ nao viaja no pacote, e acusar o que nao chega ao usuario treina a pular o hook");
});

test("shouldReproveExitCodeReadAfterAPipe", () => {
  const [achado] = checkText(".githooks/pre-commit", "npm test | tail -1; echo $?");
  assert.match(achado, /^CLM-2 /);
  assert.match(achado, /reads the last process/,
    "e o erro que fez uma sessao inteira reportar lint verde: o status era do tail");
});

test("shouldAcceptExitCodeReadFromTheProcessItself", () => {
  assert.deepEqual(checkText(".githooks/pre-commit", "npm test > out.txt; echo $?"), [],
    "o caso negativo e a forma correta: redirecionar em vez de encanar, e ler o status do processo certo");
});

test("shouldReproveACharacterRangeWhoseLowerBoundIsNotAscii", () => {
  const [achado] = checkText("src/x.js", `const R = /[${ACENTO_ALTO}-${ACENTO_BAIXO}]/;`);
  assert.match(achado, /^CLM-3 /,
    "esta e a forma exata do erro cometido duas vezes, e o primeiro desenho do padrao NAO a pegava");
});

test("shouldReproveARangeThatStartsAccentedAndEndsAscii", () => {
  const [achado] = checkText("src/x.js", `const R = /[${ACENTO_ALTO}-z]/;`);
  assert.match(achado, /^CLM-3 /,
    "achado por mutacao: sem este caso, um padrao que so olhasse o limite SUPERIOR passava nos testes");
});

test("shouldReproveACharacterRangeWhoseUpperBoundIsNotAscii", () => {
  const [achado] = checkText("scripts/x.mjs", `grep -rlE '[A-${ACENTO_BAIXO}]' skills/`);
  assert.match(achado, /^CLM-3 /);
});

test("shouldAcceptAnEnumerationOfAccentedLetters", () => {
  assert.deepEqual(checkText("src/x.js", `const E = /[a-z${E_AGUDO}]/;`), [],
    "enumerar e a correcao que a mensagem recomenda: acusa-la seria acusar a propria saida");
});

test("shouldAcceptAnAsciiOnlyCharacterRange", () => {
  assert.deepEqual(checkText("src/x.js", "const OK = /[a-z0-9.-]+/;"), [],
    "faixa ASCII e o uso normal e nao tem nada a ver com acento");
});

test("shouldAcceptTheUrlRegexThatBrokeTheFirstDraftOfThePattern", () => {
  const real = readFileSync("src/audit.js", "utf8").split("\n").find((linha) => linha.includes("URL_EXTERNA"));
  assert.ok(real, "a linha tem de existir: ela e o caso negativo medido, nao um exemplo inventado");
  assert.deepEqual(checkText("src/audit.js", real), [],
    "o primeiro desenho do padrao acusava esta linha, e era 100% de falso positivo");
});

test("shouldScopeEachPatternToWhereItsErrorHappens", () => {
  assert.ok(ehMarkdownDistribuido("shared/charter/core-principles.md"));
  assert.ok(ehMarkdownDistribuido("README.pt-BR.md"));
  assert.ok(!ehMarkdownDistribuido("docs/sdd/02-architecture.md"));
  assert.ok(ehShell(".githooks/commit-msg"));
  assert.ok(!ehShell("src/audit.js"));
  assert.ok(ehCodigo("scripts/check-claims.mjs"));
  assert.ok(!ehCodigo("CHANGELOG.md"));
});

test("shouldFindNoPatternInThisRepositoryToday", () => {
  assert.deepEqual(checkTree("."), [],
    "check que acusa codigo legitimo treina quem usa a passar --no-verify, e ai nao ha guarda nenhum");
  assert.ok(sourceFiles(".").length > 80, "a varredura tem de alcancar a arvore, nao um punhado de arquivos");
});
