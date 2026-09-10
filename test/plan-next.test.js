import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../src/plan-parser.js";
import { choose, nextTask } from "../src/plan-next.js";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const FIXTURES = path.join(RAIZ, "test", "fixtures", "plans");
const fixture = (...partes) => choose(parse(readFileSync(path.join(FIXTURES, ...partes), "utf8")));

test("com estado declarado, devolve a primeira não concluída cujas dependências estão prontas", () => {
  const decisao = fixture("com-estado.md");
  assert.equal(decisao.outcome, "task");
  assert.equal(decisao.task.id, "P0.2");
  assert.equal(decisao.task.artifact, "1 função escolher(plano) devolvendo a task pronta");
  assert.equal(decisao.task.helperSkill, "code-analyzer", "a resposta carrega a skill que executa");
  assert.deepEqual([decisao.stateDeclared, decisao.taskCount], [1, 3]);
});

test("com tudo concluído, não devolve task nenhuma", () => {
  const decisao = fixture("tudo-concluido.md");
  assert.equal(decisao.outcome, "all-done");
  assert.equal(decisao.task, null);
  assert.deepEqual([decisao.stateDeclared, decisao.taskCount], [2, 2]);
});

test("dependência apontando para id inexistente NÃO libera a task", () => {
  const decisao = fixture("invalidos", "nada-pronto.md");
  assert.equal(decisao.outcome, "nothing-ready", "assumir que o alvo ausente está pronto seria inventar estado");
  assert.equal(decisao.task, null);
  assert.deepEqual(decisao.blocked, [
    { id: "P0.1", waitingFor: ["P9.9"] },
    { id: "P1.1", waitingFor: ["P0.1"] },
  ]);
});

test("plano sem o marcador não é reprovado: o comando só não tem o que responder", () => {
  const decisao = fixture("legado-puro.md");
  assert.equal(decisao.outcome, "format-not-declared");
  assert.equal(decisao.task, null);
});

test("sem estado declarado, ainda devolve a primeira pronta — e diz que são zero", () => {
  const decisao = fixture("formato-1.md");
  assert.equal(decisao.outcome, "task");
  assert.equal(decisao.stateDeclared, 0, "quem formata precisa poder dizer que não sabe o que já foi feito");
});

// A prioridade vem do ID. Sem isto, um plano cujo campo `priority` discorde do id teria duas
// fontes de verdade — a divergência que este projeto já mediu duas vezes.
test("a ordem vem do ID mesmo quando o campo priority discorda", () => {
  const decisao = choose(parse([
    "<!-- mgr-plan-format: 1 -->",
    "### P1.1 — declarada P0 no campo", "- **priority:** P0", "- **depends_on:** []",
    "- **artifact:** 1 x", "- **done_when:** y",
    "### P0.1 — declarada P9 no campo", "- **priority:** P9", "- **depends_on:** []",
    "- **artifact:** 1 z", "- **done_when:** w",
  ].join("\n")));
  assert.equal(decisao.task.id, "P0.1", "P0 vem antes de P1 pelo ID, não pelo campo");
});

test("empate de prioridade resolve pela ordem do arquivo", () => {
  const decisao = choose(parse([
    "<!-- mgr-plan-format: 1 -->",
    "### P0.2 — escrita primeiro", "- **depends_on:** []", "- **artifact:** 1 x", "- **done_when:** y",
    "### P0.1 — escrita depois", "- **depends_on:** []", "- **artifact:** 1 z", "- **done_when:** w",
  ].join("\n")));
  assert.equal(decisao.task.id, "P0.2");
});

test("status fora do vocabulário nunca conta como concluído", () => {
  const decisao = choose(parse([
    "<!-- mgr-plan-format: 1 -->",
    "### P0.1 — a", "- **depends_on:** []", "- **artifact:** 1 x", "- **done_when:** y",
    "- **status:** concluído",
  ].join("\n")));
  assert.equal(decisao.task.id, "P0.1", "falha para o lado seguro: reoferece, nunca pula");
  assert.equal(decisao.stateDeclared, 1, "o campo foi declarado, ainda que com valor inválido");
});

test("plano declarado e sem nenhuma task", () => {
  assert.equal(choose(parse("<!-- mgr-plan-format: 1 -->\n# vazio\n")).outcome, "no-tasks");
});

test("nextTask descobre o plano no repositório e devolve caminho relativo", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "mgr-next-"));
  mkdirSync(path.join(repo, "specs", "demo"), { recursive: true });
  writeFileSync(path.join(repo, "specs", "demo", "04-plan.md"),
    readFileSync(path.join(FIXTURES, "com-estado.md"), "utf8"));

  const decisao = nextTask(repo, { slug: "demo" });
  assert.equal(decisao.file, path.join("specs", "demo", "04-plan.md"));
  assert.equal(decisao.task.id, "P0.2");
  assert.ok(!decisao.file.startsWith(repo), "nenhum caminho absoluto da máquina na resposta");
});

test("nextTask sem plano nenhum devolve no-plan, sem lançar", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "mgr-next-"));
  const decisao = nextTask(repo, {});
  assert.equal(decisao.outcome, "no-plan");
  assert.equal(decisao.file, null);
});

// O achado mais sério do gate isolado: contar `status !== "todo"` faria a ferramenta dizer
// "não sei o que você já fez" a um plano que declara exatamente isso em toda task.
test("`status: todo` explícito é estado DECLARADO, não ausência", () => {
  const decisao = choose(parse([
    "<!-- mgr-plan-format: 1 -->",
    "### P0.1 — a", "- **artifact:** 1 x", "- **done_when:** y", "- **status:** todo",
    "### P0.2 — b", "- **artifact:** 1 z", "- **done_when:** w", "- **status:** todo",
  ].join("\n")));
  assert.deepEqual([decisao.stateDeclared, decisao.taskCount], [2, 2]);
  assert.equal(decisao.task.id, "P0.1", "declarar `todo` não conclui nada");
});
