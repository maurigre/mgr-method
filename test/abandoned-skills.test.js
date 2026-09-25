import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { abandonedSkills, detectPrior, execute, keepDeclared, planInstall, splitKept, update } from "../src/installer.js";
import { CLASS_ARCHITECTURE, CLASS_LANGUAGE, CLASS_UNCLASSIFIED } from "../src/catalog.js";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";

const REPO = path.join(path.sep, "tmp", "repo-que-nao-existe-em-disco");
const DIR = path.join(REPO, ".claude", "skills");
const sempre = () => true;

const planoCom = (skills, extra = {}) => ({
  scope: "project",
  repo: REPO,
  skills,
  replaced: {},
  targets: [{ engine: "claude-code", dir: DIR, skills }],
  ...extra,
});

test("o que o plano deixa de declarar entra, com a classe de cada uma", () => {
  const prior = { skills: ["spec-init", "arch-hexagonal", "junit-clean"], skillsDirs: [".claude/skills"] };
  const saindo = abandonedSkills({ prior, plan: planoCom(["spec-init"]), exists: sempre });
  assert.deepEqual(saindo.map((s) => s.name), ["arch-hexagonal", "junit-clean"]);
  assert.deepEqual(saindo.map((s) => s.class), [CLASS_ARCHITECTURE, CLASS_LANGUAGE]);
  assert.equal(saindo[0].path, path.join(DIR, "arch-hexagonal"));
  assert.equal(saindo[0].dir, DIR);
});

test("skill que continua declarada nao entra", () => {
  const prior = { skills: ["spec-init"], skillsDirs: [".claude/skills"] };
  assert.deepEqual(abandonedSkills({ prior, plan: planoCom(["spec-init"]), exists: sempre }), []);
});

test("skillsDirs relativo e absolutizado antes de comparar com o dir do plano", () => {
  const prior = { skills: ["spec-init", "junit-clean"], skillsDirs: [".claude/skills"] };
  const saindo = abandonedSkills({ prior, plan: planoCom(["spec-init"]), exists: sempre });
  assert.equal(saindo.length, 1,
    "o manifesto grava skillsDirs RELATIVO e o plano tem o dir ABSOLUTO: sem absDir a intersecao seria vazia e a lista sairia vazia em silencio");
});

test("negativo: so nome que o manifesto anterior declarava pode sair", () => {
  const prior = { skills: ["spec-init", "junit-clean"], skillsDirs: [".claude/skills"] };
  const saindo = abandonedSkills({ prior, plan: planoCom([]), exists: sempre });
  assert.deepEqual(saindo.map((s) => s.name), ["spec-init", "junit-clean"],
    "o `exists` devolve true para QUALQUER caminho; se a origem fosse o disco a lista nao teria como parar em dois");
  assert.equal(saindo[0].class, CLASS_UNCLASSIFIED);
});

test("negativo: dir que o manifesto anterior nao listava devolve lista vazia", () => {
  const prior = { skills: ["spec-init", "junit-clean"], skillsDirs: [".github/skills"] };
  assert.deepEqual(abandonedSkills({ prior, plan: planoCom(["spec-init"]), exists: sempre }), [],
    "agir em diretorio que o manifesto anterior nunca declarou e apagar o que o metodo nao instalou");
});

test("negativo: skill cedida a plugin no replaced nao entra", () => {
  const prior = { skills: ["spec-init", "junit-clean"], skillsDirs: [".claude/skills"] };
  const plan = planoCom(["spec-init"], { replaced: { "claude-code": { "junit-clean": "@reg/junit" } } });
  assert.deepEqual(abandonedSkills({ prior, plan, exists: sempre }), []);
});

test("o filtro exists so subtrai, e so e consultado no candidato", () => {
  const prior = { skills: ["spec-init", "junit-clean"], skillsDirs: [".claude/skills"] };
  const vistos = [];
  const saindo = abandonedSkills({
    prior,
    plan: planoCom(["spec-init"]),
    exists: (alvo) => { vistos.push(alvo); return false; },
  });
  assert.deepEqual(saindo, []);
  assert.deepEqual(vistos, [path.join(DIR, "junit-clean")]);
});

test("primeira instalacao: prior nulo ou sem skills devolve lista vazia", () => {
  assert.deepEqual(abandonedSkills({ prior: null, plan: planoCom(["spec-init"]), exists: sempre }), []);
  assert.deepEqual(abandonedSkills({ prior: {}, plan: planoCom(["spec-init"]), exists: sempre }), []);
});

const repoTemporario = () => mkdtempSync(path.join(os.tmpdir(), "mgr-abandon-"));

const instala = (repo, opcoes) => execute(planInstall(["claude-code"], "project", repo, { userLanguage: "en", ...opcoes }));

const planoSeguinte = (repo, opcoes) => planInstall(["claude-code"], "project", repo, { userLanguage: "en", ...opcoes });

test("execute remove o que saiu do conjunto declarado e devolve os caminhos", () => {
  const repo = repoTemporario();
  try {
    instala(repo, { architecture: "hexagonal", language: "java" });
    const prior = detectPrior("project", repo);
    const plan = planoSeguinte(repo, { architecture: "layered" });
    const saindo = abandonedSkills({ prior, plan });
    assert.deepEqual(saindo.map((s) => s.name).sort(), ["arch-hexagonal", "junit-clean"]);
    const pedidos = [];
    const res = execute(plan, { abandoned: saindo, remove: (alvo) => pedidos.push(alvo) });
    assert.deepEqual(res.removed, saindo.map((s) => s.path));
    assert.deepEqual(pedidos, saindo.map((s) => s.path));
    assert.ok(!detectPrior("project", repo).skills.includes("arch-hexagonal"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("negativo: com a remocao falhando, o manifesto anterior fica intacto", () => {
  const repo = repoTemporario();
  try {
    instala(repo, { architecture: "hexagonal" });
    const antes = detectPrior("project", repo);
    const plan = planoSeguinte(repo, { architecture: "layered" });
    const saindo = abandonedSkills({ prior: antes, plan });
    assert.equal(saindo.length, 1);
    assert.throws(
      () => execute(plan, { abandoned: saindo, remove: () => { throw new Error("disco cheio"); } }),
      /disco cheio/,
    );
    assert.deepEqual(detectPrior("project", repo).skills, antes.skills,
      "gravar o manifesto antes de remover deixaria uma orfa, que nao tem remediacao; removendo antes, o pior estado e missing-skill, que tem");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("o update nao remove skill nenhuma", () => {
  const repo = repoTemporario();
  try {
    instala(repo, { architecture: "hexagonal", language: "java" });
    const antes = detectPrior("project", repo);
    const res = update("project", repo);
    assert.deepEqual(res.removed, [],
      "o update chama planInstall com names: man.skills, entao a diferenca e vazia por construcao");
    assert.deepEqual(detectPrior("project", repo).skills.sort(), [...antes.skills].sort());
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

const mantida = (nome, dir = DIR) => ({ name: nome, dir, path: path.join(dir, nome), class: CLASS_UNCLASSIFIED });

test("keepDeclared une o mantido ao conjunto declarado e ao target casado pelo dir", () => {
  const plan = planoCom(["spec-init"]);
  const novo = keepDeclared(plan, [mantida("junit-clean")]);
  assert.deepEqual(novo.skills, ["spec-init", "junit-clean"]);
  assert.deepEqual(novo.targets[0].skills, ["spec-init", "junit-clean"],
    "o mantido e re-sincronizado junto, e por isso nem sequer envelhece");
});

test("keepDeclared nao duplica nome que ja esta declarado", () => {
  const novo = keepDeclared(planoCom(["spec-init"]), [mantida("spec-init")]);
  assert.deepEqual(novo.skills, ["spec-init"]);
  assert.deepEqual(novo.targets[0].skills, ["spec-init"]);
});

test("keepDeclared com lista vazia devolve o conjunto de entrada", () => {
  const plan = planoCom(["spec-init", "adr-create"]);
  const novo = keepDeclared(plan, []);
  assert.deepEqual(novo.skills, plan.skills);
  assert.deepEqual(novo.targets[0].skills, plan.targets[0].skills);
});

test("keepDeclared so mexe no target cujo dir casa", () => {
  const outro = path.join(REPO, ".github", "skills");
  const plan = { ...planoCom(["spec-init"]), targets: [{ engine: "claude-code", dir: DIR, skills: ["spec-init"] }, { engine: "copilot", dir: outro, skills: ["spec-init"] }] };
  const novo = keepDeclared(plan, [mantida("junit-clean", DIR)]);
  assert.deepEqual(novo.targets[0].skills, ["spec-init", "junit-clean"]);
  assert.deepEqual(novo.targets[1].skills, ["spec-init"],
    "mexer em target que o mantido nao ocupa seria escrever skill em motor que nunca a teve");
});

test("negativo: keepDeclared nao muta o plano de entrada", () => {
  const plan = planoCom(["spec-init"]);
  keepDeclared(plan, [mantida("junit-clean")]);
  assert.deepEqual(plan.skills, ["spec-init"]);
  assert.deepEqual(plan.targets[0].skills, ["spec-init"]);
});

test("negativo: com --skills-dir, o alvo custom ainda descarta a skill cedida a plugin", () => {
  const prior = { skills: ["spec-init", "junit-clean"], skillsDirs: [".claude/skills"] };
  const plan = { ...planoCom(["spec-init"]), replaced: { "claude-code": { "junit-clean": "@reg/junit" } }, targets: [{ engine: "custom", dir: DIR, skills: ["spec-init"] }] };
  assert.deepEqual(abandonedSkills({ prior, plan, exists: sempre }), [],
    "`replaced` so e chaveado por motor real; sem unir os mapas, o alvo custom apagaria o diretorio do plugin");
});

test("negativo: manifesto do modelo antigo nao reconcilia nada", () => {
  const prior = { model: "runtime-launcher", skills: ["arch-onion"], skillsDirs: [".claude/skills"] };
  assert.deepEqual(abandonedSkills({ prior, plan: planoCom(["spec-init"]), exists: sempre }), [],
    "o que o modelo antigo declara sao lancadores, e o migrateOld ja os descarta; mante-los declarados os ressuscitaria");
});

test("splitKept separa o que o pacote ainda distribui do que ja nao distribui", () => {
  const { mantidas, semFonte } = splitKept([mantida("junit-clean"), mantida("skill-fantasma")], ["junit-clean"]);
  assert.deepEqual(mantidas.map((s) => s.name), ["junit-clean"]);
  assert.deepEqual(semFonte.map((s) => s.name), ["skill-fantasma"],
    "reconstruir nome que o pacote nao tem faria o buildSkill lancar, e a RECUSA viraria erro de instalacao");
});

test("splitKept sem lista devolve tudo como mantido quando o pacote distribui", () => {
  const { mantidas, semFonte } = splitKept([mantida("junit-clean")]);
  assert.deepEqual(mantidas.map((s) => s.name), ["junit-clean"]);
  assert.deepEqual(semFonte, []);
});
