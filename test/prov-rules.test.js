import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../src/provenance.js";
import { check } from "../src/prov-rules.js";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const FIXTURES = path.join(RAIZ, "test", "fixtures", "provenance");

const achados = (nome, { closed = false } = {}) =>
  check(parse(readFileSync(path.join(FIXTURES, nome), "utf8")), nome, { repo: RAIZ, closed });

const codigos = (lista) => lista.map((f) => f.code);
const doTipo = (lista, code) => lista.filter((f) => f.code === code);

test("PROV-1: as seis etiquetas malformadas da fixture são apontadas, e nenhuma válida é", () => {
  const encontrados = doTipo(achados("etiquetas.md"), "PROV-1");
  assert.equal(encontrados.length, 6);
  for (const finding of encontrados) {
    assert.equal(finding.severity, "error");
    assert.match(finding.message, /etiqueta malformada/);
  }
});

test("PROV-2: arquivo que sumiu e linha além do fim são os dois apontados", () => {
  const encontrados = doTipo(achados("etiquetas.md"), "PROV-2");
  assert.equal(encontrados.length, 2);
  assert.ok(encontrados.every((f) => f.severity === "error"));
  assert.ok(encontrados.some((f) => /não existe em disco/.test(f.message)), "o arquivo que sumiu");
  assert.ok(encontrados.some((f) => /linha\(s\), e a etiqueta aponta/.test(f.message)), "a linha além do fim");
});

test("PROV-4: o caminho que escapa da raiz é apontado, e NÃO como PROV-2", () => {
  const encontrados = doTipo(achados("etiquetas.md"), "PROV-4");
  assert.equal(encontrados.length, 1);
  assert.equal(encontrados[0].severity, "error");
  assert.match(encontrados[0].message, /escapa da raiz/);
  assert.doesNotMatch(encontrados[0].remediation, /gitignored/, "a remediação da PROV-2 manda procurar o arquivo; esta, não");
});

test("ponteiro que resolve não produz achado", () => {
  const { labels } = parse("versionado [code:src/markdown.js:1]\noutro [code:src/findings.js:1]");
  assert.equal(labels.length, 2);
  assert.deepEqual(check({ labels, marks: [] }, "x.md", { repo: RAIZ }), []);
});

test("ponteiro para arquivo gitignored que existe não produz achado", () => {
  // Repositório temporário com `.gitignore` próprio. Apontar para `specs/` deste repositório
  // passaria aqui e quebraria em qualquer clone, que é exatamente o defeito que esta feature
  // existe para não repetir.
  const repo = mkdtempSync(path.join(tmpdir(), "mgr-prov-gi-"));
  writeFileSync(path.join(repo, ".gitignore"), "ignorado.md\n");
  writeFileSync(path.join(repo, "ignorado.md"), "uma linha\n");
  const parsed = parse("gitignored [code:ignorado.md:1]");
  assert.deepEqual(check(parsed, "x.md", { repo }), []);
});

test("as sete etiquetas bem formadas da fixture não produzem achado nenhum", () => {
  const validas = parse(readFileSync(path.join(FIXTURES, "etiquetas.md"), "utf8"))
    .labels.filter((l) => l.wellFormed && l.atMarkPosition && !l.pointer);
  assert.equal(validas.length, 7, "brief, user, prd, adr, quarantined, analogical-extension e TO DEFINE");
  assert.deepEqual(check({ labels: validas, marks: [] }, "x.md", { repo: RAIZ }), []);
});

test("PROV-3: só roda em feature com 06-completion.md, e só em posição de marca", () => {
  assert.deepEqual(achados("pendencias.md"), [], "feature aberta não recebe aviso de pendência");
  const fechada = doTipo(achados("pendencias.md", { closed: true }), "PROV-3");
  assert.equal(fechada.length, 4, "as quatro marcas ao fim da linha; as citadas em prosa, nenhuma");
  assert.ok(fechada.every((f) => f.severity === "warning"), "aviso, nunca erro: a RN-1 proíbe reprovar o que existe");
});

test("PROV-3: a mensagem declara o que detecta e o que NÃO distingue", () => {
  const [aviso] = doTipo(achados("pendencias.md", { closed: true }), "PROV-3");
  assert.match(aviso.message, /POSIÇÃO/, "diz que detecta posição");
  assert.match(aviso.message, /não distingue uma pendência real de uma citação que por acaso termina a linha/);
});

test("o falso positivo conhecido é apontado, e o teste o documenta como falso positivo", () => {
  const linhas = readFileSync(path.join(FIXTURES, "pendencias.md"), "utf8").split("\n");
  const numero = linhas.findIndex((linha) => linha.includes("; ela era")) + 1;
  const citacao = doTipo(achados("pendencias.md", { closed: true }), "PROV-3").find((f) => f.line === numero);
  assert.ok(citacao, "a citação que termina a linha É apontada — e não deveria ser, se a regra soubesse distinguir");
});

test("bloco cercado não produz achado; só a etiqueta de fora da cerca produz", () => {
  const encontrados = achados("cercado.md", { closed: true });
  assert.deepEqual(codigos(encontrados), ["PROV-2"]);
  assert.match(encontrados[0].message, /src\/nao-existe\.js/);
});

test("etiqueta e marca fora de posição de marca não produzem achado", () => {
  const texto = "o ponteiro [code:src/nao-existe.js:1] no meio da frase, e a marca [A DEFINIR] também.";
  assert.deepEqual(check(parse(texto), "x.md", { repo: RAIZ, closed: true }), []);
});

test("os achados saem em ordem de leitura, mesmo vindo de duas listas", () => {
  const texto = ["pendente [A DEFINIR]", "sumiu [code:src/nao-existe.js:1]", "pendente [TO DEFINE]"].join("\n");
  const encontrados = check(parse(texto), "x.md", { repo: RAIZ, closed: true });
  assert.deepEqual(encontrados.map((f) => f.line), [1, 2, 3]);
  assert.deepEqual(codigos(encontrados), ["PROV-3", "PROV-2", "PROV-3"]);
});

test("todo achado carrega remediação e exemplo — o construtor de findings recusa quem não tenha", () => {
  const encontrados = [...achados("etiquetas.md"), ...achados("pendencias.md", { closed: true })];
  assert.equal(encontrados.length, 13, "6 PROV-1, 2 PROV-2, 1 PROV-4 e 4 PROV-3");
  for (const finding of encontrados) {
    assert.ok(finding.remediation.trim().length > 0, finding.code);
    assert.ok(finding.example.trim().length > 0, finding.code);
    assert.ok(finding.line > 0, finding.code);
    assert.match(finding.file, /\.md$/, finding.code);
  }
});

test("check sem contexto não inventa feature fechada, e exige `repo` para conferir ponteiro", () => {
  assert.deepEqual(check(parse("pendente [A DEFINIR]"), "x.md"), [], "sem `closed`, nenhuma pendência é apontada");
  assert.throws(() => check(parse("sumiu [code:src/a.js:1]"), "x.md"), TypeError,
    "conferir ponteiro sem a raiz do repositório é chamada errada, não resultado silencioso");
});
