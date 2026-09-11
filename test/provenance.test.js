import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parse, checkPointer, MARK_FORMS,
  POINTER_OK, POINTER_ESCAPES_ROOT, POINTER_NO_FILE, POINTER_NO_LINE,
} from "../src/provenance.js";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const FIXTURES = path.join(RAIZ, "test", "fixtures", "provenance");
const fixture = (nome) => parse(readFileSync(path.join(FIXTURES, nome), "utf8"));

const etiqueta = (texto) => parse(texto).labels[0];
const marcas = (texto) => parse(texto).marks;

test("as oito formas da L1.10 são reconhecidas em posição de marca", () => {
  const { labels } = fixture("etiquetas.md");
  const validas = labels.filter((l) => l.wellFormed && l.atMarkPosition).map((l) => l.token);
  assert.deepEqual([...new Set(validas)].sort(), ["TO DEFINE", "adr", "analogical-extension", "brief", "code", "prd", "quarantined", "user"]);
});

test("etiqueta dentro de bloco cercado NÃO aparece", () => {
  const { labels, marks } = fixture("cercado.md");
  assert.equal(labels.length, 1, "só a etiqueta fora da cerca sobrevive");
  assert.equal(labels[0].pointer.path, "src/nao-existe.js");
  assert.equal(marks.length, 0, "as marcas da fixture estão todas dentro de cerca");
});

test("cerca de quatro crases não é fechada por uma de três", () => {
  const texto = ["````", "```", "sumiu [code:src/x.js:1]", "```", "pendente [A DEFINIR]", "````"].join("\n");
  assert.deepEqual(parse(texto), { labels: [], marks: [] });
});

test("marca no meio e no fim da linha são distinguidas", () => {
  const { marks } = fixture("pendencias.md");
  const noFim = marks.filter((m) => m.atMarkPosition);
  const noMeio = marks.filter((m) => !m.atMarkPosition);
  assert.deepEqual(noFim.map((m) => m.form).sort(), ["A CONFIRMAR", "A DEFINIR", "A DEFINIR", "TO DEFINE"]);
  assert.ok(noMeio.length >= 3, "a fixture cita as três formas em prosa");
});

test("o falso positivo conhecido está na fixture: citação que termina a linha", () => {
  // A linha vem do disco, não de um número decorado: a fixture pode crescer, e o que se afirma é
  // que ESTA frase — que conta história sobre uma marca já resolvida — ocupa posição de marca.
  const linhas = readFileSync(path.join(FIXTURES, "pendencias.md"), "utf8").split("\n");
  const numero = linhas.findIndex((linha) => linha.includes("; ela era")) + 1;
  assert.ok(numero > 0, "a fixture precisa conter a citação que termina a linha");
  const citacao = fixture("pendencias.md").marks.find((m) => m.line === numero);
  assert.equal(citacao.atMarkPosition, true, "é citação, e mesmo assim a PROV-3 vai apontar para ela");
});

test("espaço à direita não tira a marca de posição de marca", () => {
  assert.equal(marcas("o prazo [A DEFINIR]   ")[0].atMarkPosition, true);
  assert.equal(marcas("o prazo [A DEFINIR] ainda")[0].atMarkPosition, false);
});

test("as três formas de marca são reconhecidas, e `TO DEFINE` sai também como etiqueta", () => {
  assert.deepEqual(MARK_FORMS, ["TO DEFINE", "A DEFINIR", "A CONFIRMAR"]);
  const { labels, marks } = parse("sem origem [TO DEFINE]");
  assert.equal(marks.length, 1);
  assert.equal(labels.length, 1, "a L1.10 lista `TO DEFINE` entre as oito etiquetas");
  assert.equal(labels[0].wellFormed, true);
});

test("colchete fora do vocabulário não é etiqueta nem marca", () => {
  for (const texto of ["prosa [qualquer coisa]", "link [o texto](https://x.invalido)", "- [ ] tarefa", "vazio []"]) {
    assert.deepEqual(parse(texto), { labels: [], marks: [] }, texto);
  }
});

test("etiqueta malformada é detectada pela FORMA, sem tocar em disco", () => {
  for (const texto of ["[code:src/markdown.js:0]", "[code:src/markdown.js:-3]", "[code:src/markdown.js]", "[code::12]", "[adr:dezesseis]", "[prd]", "[prd: ]", "[brief:secao]", "[user:alguem]"]) {
    assert.equal(etiqueta(texto).wellFormed, false, texto);
    assert.equal(etiqueta(texto).pointer, null, texto);
  }
});

test("caminho com dois-pontos no nome é partido pelo ÚLTIMO separador", () => {
  assert.deepEqual(etiqueta("[code:src/a:b.js:12]").pointer, { path: "src/a:b.js", line: 12 });
});

test("a posição registrada aponta para a linha e a coluna do original", () => {
  const { labels } = parse(["# titulo", "", "a origem [brief]"].join("\n"));
  assert.equal(labels[0].line, 3);
  assert.equal(labels[0].column, 10);
});

test("ponteiro para arquivo versionado que existe resolve", () => {
  const { pointer } = etiqueta("[code:src/markdown.js:1]");
  assert.equal(checkPointer(RAIZ, { pointer }).outcome, POINTER_OK);
});

test("ponteiro para arquivo GITIGNORED que existe resolve — o git não é consultado", () => {
  // Repositório temporário, e NÃO um caminho real de `specs/`: apontar para conteúdo gitignored
  // deste repositório faria a suíte passar aqui e falhar em qualquer clone. É o mesmo defeito que
  // o comentário do `.gitignore` registra sobre `test/fixtures/specs/`.
  const repo = mkdtempSync(path.join(tmpdir(), "mgr-prov-gi-"));
  writeFileSync(path.join(repo, ".gitignore"), "ignorado.md\n");
  writeFileSync(path.join(repo, "ignorado.md"), "uma linha\n");
  assert.equal(checkPointer(repo, { pointer: { path: "ignorado.md", line: 1 } }).outcome, POINTER_OK);
});

test("arquivo vazio tem ZERO linhas, e qualquer ponteiro para ele falha", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "mgr-prov-vazio-"));
  writeFileSync(path.join(repo, "vazio.js"), "");
  const resultado = checkPointer(repo, { pointer: { path: "vazio.js", line: 1 } });
  assert.equal(resultado.outcome, POINTER_NO_LINE);
  assert.equal(resultado.lines, 0, "zero bytes não é uma linha vazia");
});

test("linha além do fim do arquivo falha, e a resposta diz quantas linhas existem", () => {
  const { pointer } = etiqueta("[code:src/markdown.js:99999]");
  const resultado = checkPointer(RAIZ, { pointer });
  assert.equal(resultado.outcome, POINTER_NO_LINE);
  assert.ok(resultado.lines > 0);
  assert.ok(resultado.line > resultado.lines);
});

test("a última linha do arquivo resolve, e a seguinte não — o limite é medido, não suposto", () => {
  const linhas = readFileSync(path.join(RAIZ, "src", "markdown.js"), "utf8").split("\n");
  const ultima = linhas[linhas.length - 1] === "" ? linhas.length - 1 : linhas.length;
  assert.equal(checkPointer(RAIZ, { pointer: { path: "src/markdown.js", line: ultima } }).outcome, POINTER_OK);
  assert.equal(checkPointer(RAIZ, { pointer: { path: "src/markdown.js", line: ultima + 1 } }).outcome, POINTER_NO_LINE);
});

test("arquivo que não existe falha como `no-file`", () => {
  assert.equal(checkPointer(RAIZ, { pointer: { path: "src/nao-existe.js", line: 1 } }).outcome, POINTER_NO_FILE);
});

test("diretório não é arquivo, e não derruba o comando", () => {
  assert.equal(checkPointer(RAIZ, { pointer: { path: "src", line: 1 } }).outcome, POINTER_NO_FILE);
});

test("caminho que escapa da raiz é `escapes-root`, e o disco nem é tocado", () => {
  for (const caminho of ["../fora-da-raiz.md", "/etc/hostname", "src/../../fora.md"]) {
    assert.equal(checkPointer(RAIZ, { pointer: { path: caminho, line: 1 } }).outcome, POINTER_ESCAPES_ROOT, caminho);
  }
});

test("a própria raiz não é confundida com um caminho de dentro dela", () => {
  assert.equal(checkPointer(RAIZ, { pointer: { path: ".", line: 1 } }).outcome, POINTER_NO_FILE);
});
