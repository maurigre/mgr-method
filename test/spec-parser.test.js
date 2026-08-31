import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../src/spec-parser.js";
import { parse as parsePlan } from "../src/plan-parser.js";
import { stripFencedBlocks } from "../src/markdown.js";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const FIXTURES = path.join(RAIZ, "test", "fixtures", "specs");
const fixture = (nome) => parse(readFileSync(path.join(FIXTURES, nome), "utf8"));

test("o critério é reconhecido pelo ID, em qualquer posição, sem detectar seção", () => {
  const { criteria } = fixture("formato-1.md");
  assert.deepEqual(criteria.map((c) => c.id), ["CA-1", "CA-2", "CA-3"]);
  assert.equal(criteria[0].body, "o parser lê as duas formas reais sem quebrar.");
  assert.equal(criteria[0].number, 1);
});

test("as duas formas legadas são lidas sem quebra", () => {
  assert.equal(fixture("legado-numerado.md").format.declared, false);
  assert.equal(fixture("legado-numerado.md").criteria.length, 0, "lista numerada não tem ID");
  assert.deepEqual(fixture("legado-checkbox.md").criteria.map((c) => c.id), ["CA-1", "CA-2"]);
});

test("o rótulo entre parênteses é prosa, não identidade", () => {
  const [primeiro] = fixture("legado-checkbox.md").criteria;
  assert.equal(primeiro.id, "CA-1");
  assert.match(primeiro.body, /^`mgr validate` sai verde/);
});

test("sub-item sem ID não vira critério; indentado COM ID vira", () => {
  assert.equal(fixture("legado-checkbox.md").criteria.length, 2, "o sub-item da CA-2 não tem ID");
  const { criteria } = parse("<!-- mgr-spec-format: 1 -->\n- [ ] **CA-1:** a\n  - [ ] **CA-2:** b\n");
  assert.deepEqual(criteria.map((c) => c.id), ["CA-1", "CA-2"], "a posição é irrelevante (DT-1)");
});

test("marcador dentro de bloco cercado NÃO declara o formato", () => {
  const texto = ["# spec", "```markdown", "<!-- mgr-spec-format: 1 -->", "- [ ] **CA-1:** exemplo", "```", "texto"].join("\n");
  const { format, criteria } = parse(texto);
  assert.equal(format.declared, false, "exemplo é documentação, não conteúdo");
  assert.deepEqual(criteria, [], "critério dentro do exemplo também não conta");
});

test("marcador entre crases NÃO declara o formato", () => {
  const texto = "# spec\nO marcador `<!-- mgr-spec-format: 1 -->` vai na primeira linha.\n";
  assert.equal(parse(texto).format.declared, false);
});

test("o mesmo vale para o parser de plano — era o mesmo defeito nos dois", () => {
  const texto = ["# plano", "```markdown", "<!-- mgr-plan-format: 1 -->", "### P0.1 — exemplo", "```"].join("\n");
  const parsed = parsePlan(texto);
  assert.equal(parsed.format.declared, false);
  assert.deepEqual(parsed.tasks, [], "task dentro do exemplo não é task");
});

test("o uso legítimo do marcador continua valendo", () => {
  assert.equal(parse("<!-- mgr-spec-format: 1 -->\n# spec\n").format.declared, true);
  assert.equal(parsePlan("<!-- mgr-plan-format: 1 -->\n# plano\n").format.declared, true);
});

test("stripFencedBlocks preserva a numeração das linhas", () => {
  const limpo = stripFencedBlocks("linha1\n```\nescondida\n```\nlinha5");
  assert.equal(limpo.split("\n").length, 5);
  assert.equal(limpo.split("\n")[4], "linha5");
});

test("as specs vivas, quando existem, são lidas sem quebra e nenhuma declara por acidente", () => {
  const raizSpecs = path.join(RAIZ, "specs");
  if (!existsSync(raizSpecs)) return;
  for (const entrada of readdirSync(raizSpecs, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const arquivo = path.join(raizSpecs, entrada.name, "03-spec.md");
    if (!existsSync(arquivo)) continue;
    assert.doesNotThrow(() => parse(readFileSync(arquivo, "utf8")), entrada.name);
  }
});

// Fronteira da cerca: o valor decisivo é o par (caractere, comprimento). A primeira versão
// alternava em qualquer cerca, e por isso um `~~~` ou uma cerca interna reabria o bloco.
test("a cerca fecha só com o mesmo caractere e comprimento maior ou igual", () => {
  const comTil = ["~~~", "<!-- mgr-spec-format: 1 -->", "~~~", "- [ ] **CA-1:** real"].join("\n");
  assert.equal(parse(comTil).format.declared, false, "`~~~` também abre bloco");
  assert.equal(parse(comTil).criteria.length, 1);

  const misturado = ["```", "~~~", "<!-- mgr-spec-format: 1 -->", "```"].join("\n");
  assert.equal(parse(misturado).format.declared, false, "`~~~` não fecha bloco aberto com crase");

  const aninhado = ["````markdown", "```", "<!-- mgr-spec-format: 1 -->", "```", "````"].join("\n");
  assert.equal(parse(aninhado).format.declared, false, "cerca menor não fecha a maior");
});

test("cerca sem fechamento vale até o fim do arquivo", () => {
  const texto = ["<!-- mgr-spec-format: 1 -->", "- [ ] **CA-1:** real", "```", "- [ ] **CA-2:** exemplo"].join("\n");
  const { format, criteria } = parse(texto);
  assert.equal(format.declared, true, "o marcador está antes da cerca");
  assert.deepEqual(criteria.map((c) => c.id), ["CA-1"], "o que vem depois da cerca aberta é exemplo");
});

test("o mesmo vale para o plano: os dois parsers usam a mesma fonte", () => {
  const misturado = ["```", "~~~", "<!-- mgr-plan-format: 1 -->", "### P0.1 — a", "```"].join("\n");
  const { format, tasks } = parsePlan(misturado);
  assert.equal(format.declared, false);
  assert.equal(tasks.length, 0);
});
