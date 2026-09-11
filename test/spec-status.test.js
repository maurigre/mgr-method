import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ARTIFACTS, BASIS, BLOCKED, PRESENT, READY, describe, statusAll, statusFor } from "../src/spec-status.js";

const repoCom = (arvore) => {
  const repo = mkdtempSync(path.join(tmpdir(), "mgr-st-"));
  for (const [slug, arquivos] of Object.entries(arvore)) {
    mkdirSync(path.join(repo, "specs", slug), { recursive: true });
    for (const nome of arquivos) writeFileSync(path.join(repo, "specs", slug, nome), "x");
  }
  return repo;
};

const comPresentes = (...ids) => describe(new Map(ids.map((id) => [id, `specs/x/${id}.md`])));
const porId = (resultado) => Object.fromEntries(resultado.artifacts.map((a) => [a.id, a.status]));

test("presente, pronto e bloqueado: o requires decide os dois últimos", () => {
  const { artifacts } = comPresentes("brief", "prd");
  assert.deepEqual(porId({ artifacts }), {
    brief: PRESENT, prd: PRESENT,
    spec: READY,
    plan: BLOCKED, execution: BLOCKED, completion: BLOCKED,
  });
});

test("sem nada em disco, só o primeiro está pronto", () => {
  assert.deepEqual(porId(comPresentes()), {
    brief: READY, prd: BLOCKED, spec: BLOCKED,
    plan: BLOCKED, execution: BLOCKED, completion: BLOCKED,
  }, "o brief não exige nada, então nasce pronto");
});

test("com tudo em disco, nada fica pronto nem bloqueado", () => {
  const resultado = comPresentes(...ARTIFACTS.map((a) => a.id));
  assert.ok(resultado.artifacts.every((a) => a.status === PRESENT));
  assert.deepEqual(resultado.nextReady, [], "não há artefato faltando para escrever");
});

test("um buraco no meio bloqueia o que vem depois, e não o que veio antes", () => {
  const { artifacts } = comPresentes("brief", "prd", "plan");
  assert.deepEqual(porId({ artifacts }), {
    brief: PRESENT, prd: PRESENT,
    spec: READY,
    plan: PRESENT,
    execution: READY,
    completion: BLOCKED,
  }, "o plano existe mesmo sem a spec: o estado descreve o disco, não julga a ordem");
});

test("nextReady é exatamente a lista dos ready", () => {
  const resultado = comPresentes("brief", "prd", "plan");
  const prontos = resultado.artifacts.filter((a) => a.status === READY).map((a) => a.id);
  assert.deepEqual(resultado.nextReady, prontos);
  assert.deepEqual(resultado.nextReady, ["spec", "execution"]);
});

test("o caminho vem de quem existe, e null para quem não existe", () => {
  const { artifacts } = comPresentes("brief");
  const [brief, prd] = artifacts;
  assert.equal(brief.path, "specs/x/brief.md");
  assert.equal(prd.path, null, "status já é o discriminador; o caminho ausente só acompanha");
});

// O vocabulário e o payload são contrato com o ADR-0015. Estes dois testes FALHAM se alguém
// acrescentar a palavra ou o campo que a decisão rejeitou por não ter fonte.
test("o vocabulário não tem `done`", () => {
  const resultado = comPresentes("brief", "prd");
  const estados = new Set(resultado.artifacts.map((a) => a.status));
  assert.ok(!estados.has("done"), "existência de arquivo não é conclusão de etapa (ADR-0015)");
  for (const estado of estados) assert.ok([PRESENT, READY, BLOCKED].includes(estado), estado);
});

test("nenhum artefato carrega `approved` nem `checkpoint`", () => {
  for (const artefato of comPresentes("brief").artifacts) {
    assert.deepEqual(Object.keys(artefato).sort(), ["id", "path", "requires", "status"],
      "aprovação de checkpoint não tem fonte mecânica; inventá-la é o que a L1.9 proíbe");
  }
});

test("a tabela canônica é a fonte da ordem, e é imutável", () => {
  assert.deepEqual(ARTIFACTS.map((a) => a.id),
    ["brief", "prd", "spec", "plan", "execution", "completion"]);
  assert.deepEqual(ARTIFACTS.map((a) => a.requires),
    [[], ["brief"], ["prd"], ["spec"], ["plan"], ["execution"]]);
  assert.throws(() => { ARTIFACTS[0].id = "outro"; }, TypeError);
  assert.equal(BASIS, "file-existence", "token estável, nunca traduzido");
});

test("statusFor resolve o caminho de cada artefato que existe", () => {
  const repo = repoCom({ demo: ["01-brief.md", "02-prd.md"] });
  const resultado = statusFor(repo, { slug: "demo" });

  assert.equal(resultado.found, true);
  assert.equal(resultado.specRoot, path.join("specs", "demo"));
  assert.equal(resultado.artifacts[0].path, path.join("specs", "demo", "01-brief.md"));
  assert.equal(resultado.artifacts[2].path, null, "a spec não existe");
  assert.deepEqual(resultado.nextReady, ["spec"]);
  assert.equal(resultado.basis, BASIS);
  assert.ok(!JSON.stringify(resultado).includes(repo), "nenhum caminho absoluto da máquina");
});

// O caso REAL: existe quatro vezes em disco, e é o achado que governou o desenho.
test("feature com handoff E completion: o arquivo é reportado, e nada afirma trabalho pendente", () => {
  const repo = repoCom({
    demo: ["01-brief.md", "02-prd.md", "03-spec.md", "04-plan.md", "05-execution.md",
           "06-completion.md", ".handoff.md"],
  });
  const resultado = statusFor(repo, { slug: "demo" });

  assert.deepEqual(resultado.handoff,
    { exists: true, path: path.join("specs", "demo", ".handoff.md") },
    "fato do arquivo: existe e onde está, nada além");
  assert.deepEqual(Object.keys(resultado.handoff).sort(), ["exists", "path"],
    "nenhum campo que afirme pendência, estágio ou task em aberto");
  assert.ok(resultado.artifacts.every((a) => a.status === PRESENT));
  assert.deepEqual(resultado.nextReady, []);
});

test("sem handoff, o campo diz que não existe em vez de sumir", () => {
  const repo = repoCom({ demo: ["01-brief.md"] });
  assert.deepEqual(statusFor(repo, { slug: "demo" }).handoff, { exists: false, path: null });
});

test("slug inexistente devolve found:false, não estrutura vazia", () => {
  const repo = repoCom({ demo: ["01-brief.md"] });
  const resultado = statusFor(repo, { slug: "nao-existe" });
  assert.equal(resultado.found, false);
  assert.equal(resultado.artifacts, undefined,
    "estrutura vazia pareceria uma feature no começo; é o oposto do que aconteceu");
});

test("statusAll devolve uma entrada por feature, em ordem estável", () => {
  const repo = repoCom({ zebra: ["01-brief.md"], alfa: ["01-brief.md", "02-prd.md"] });
  const todas = statusAll(repo);
  assert.deepEqual(todas.map((r) => r.slug), ["alfa", "zebra"]);
  assert.deepEqual(todas.map((r) => r.nextReady), [["spec"], ["prd"]]);
});

test("statusAll num repositório sem specs/ devolve vazio, sem lançar", () => {
  assert.deepEqual(statusAll(mkdtempSync(path.join(tmpdir(), "mgr-st-"))), []);
});
