import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANCELLED, KEEP, OUTCOME_KEPT_BY_CHOICE, OUTCOME_KEPT_NO_CONSENT, OUTCOME_NOTHING, OUTCOME_REMOVED,
  REMOVE, REMOVAL_ASK, REMOVAL_ASSUMED, REMOVAL_NO_CONSENT,
  consentToRemove, removalMode, removalOutcome,
} from "../src/prompts.js";
import { getMessages } from "../src/messages.js";
import { CLASS_ARCHITECTURE, CLASS_LANGUAGE, CLASS_OPTIONAL, skillClass } from "../src/catalog.js";

const MSG = getMessages("en");
const UMA = [{ name: "junit-clean", dir: ".claude/skills", path: ".claude/skills/junit-clean", class: "language" }];

const espiao = (resposta) => {
  const chamadas = [];
  return {
    chamadas,
    confirm: async (opcoes) => { chamadas.push(opcoes); return resposta; },
    isCancel: (valor) => valor === CANCELLED,
  };
};

test("removalMode: terminal sem -y pergunta, -y assume, sem terminal e sem -y nao ha consentimento", () => {
  assert.equal(removalMode({ isTTY: true, yes: false }), REMOVAL_ASK);
  assert.equal(removalMode({ isTTY: true, yes: true }), REMOVAL_ASSUMED);
  assert.equal(removalMode({ isTTY: false, yes: true }), REMOVAL_ASSUMED);
  assert.equal(removalMode({ isTTY: false, yes: false }), REMOVAL_NO_CONSENT);
  assert.equal(removalMode(), REMOVAL_NO_CONSENT, "sem argumento, o default e o que nao apaga nada");
});

test("aceite remove, e a pergunta abre na opcao que nao desfaz nada", async () => {
  const ask = espiao(true);
  assert.equal(await consentToRemove(ask, UMA, { mode: REMOVAL_ASK, msg: MSG }), REMOVE);
  assert.equal(ask.chamadas.length, 1);
  assert.equal(ask.chamadas[0].initialValue, false);
  assert.equal(ask.chamadas[0].message, MSG.confirmRemoval(1));
});

test("recusa mantem tudo em disco", async () => {
  assert.equal(await consentToRemove(espiao(false), UMA, { mode: REMOVAL_ASK, msg: MSG }), KEEP);
});

test("cancelamento devolve o CANCELLED que a borda ja trata", async () => {
  assert.equal(await consentToRemove(espiao(CANCELLED), UMA, { mode: REMOVAL_ASK, msg: MSG }), CANCELLED);
});

test("negativo: o modo assumido NAO toca no ask", async () => {
  const ask = espiao(false);
  assert.equal(await consentToRemove(ask, UMA, { mode: REMOVAL_ASSUMED, msg: MSG }), REMOVE);
  assert.deepEqual(ask.chamadas, [], "o -y ja e o consentimento; perguntar de novo seria pergunta sem terminal");
});

test("negativo: sem consentimento possivel NAO toca no ask e NAO remove", async () => {
  const ask = espiao(true);
  assert.equal(await consentToRemove(ask, UMA, { mode: REMOVAL_NO_CONSENT, msg: MSG }), KEEP);
  assert.deepEqual(ask.chamadas, [], "ausencia de pergunta possivel nunca pode virar sim");
});

test("lista vazia nao pergunta nada", async () => {
  const ask = espiao(true);
  assert.equal(await consentToRemove(ask, [], { mode: REMOVAL_ASK, msg: MSG }), KEEP);
  assert.deepEqual(ask.chamadas, []);
});

test("removalOutcome escolhe a saida das quatro sem depender de terminal", () => {
  assert.equal(removalOutcome({ removed: ["/x"], abandoned: UMA, mode: REMOVAL_ASK }), OUTCOME_REMOVED);
  assert.equal(removalOutcome({ removed: [], abandoned: UMA, mode: REMOVAL_ASK }), OUTCOME_KEPT_BY_CHOICE);
  assert.equal(removalOutcome({ removed: [], abandoned: UMA, mode: REMOVAL_NO_CONSENT }), OUTCOME_KEPT_NO_CONSENT);
  assert.equal(removalOutcome({ removed: [], abandoned: [], mode: REMOVAL_ASK }), OUTCOME_NOTHING);
  assert.equal(removalOutcome(), OUTCOME_NOTHING, "sem argumento, nada aconteceu e nada e anunciado");
});

test("removalOutcome com -y e lista mantida vazia nao anuncia manutencao nenhuma", () => {
  assert.equal(removalOutcome({ removed: [], abandoned: [], mode: REMOVAL_ASSUMED }), OUTCOME_NOTHING);
});

test("cinco de uma vez cabem numa pergunta so", async () => {
  const cinco = ["arch-hexagonal", "junit-clean", "evidence-capture", "arch-onion", "arch-clean"]
    .map((nome) => ({ name: nome, dir: ".claude/skills", path: `.claude/skills/${nome}`, class: "unclassified" }));
  const ask = espiao(true);
  assert.equal(await consentToRemove(ask, cinco, { mode: REMOVAL_ASK, msg: MSG }), REMOVE);
  assert.equal(ask.chamadas.length, 1, "uma pergunta para o conjunto todo, nunca uma por skill");
  assert.equal(ask.chamadas[0].message, MSG.confirmRemoval(5));
});

test("a razao de cada classe vem da fonte, nas duas tabelas, e nunca cai no neutro", () => {
  for (const idioma of ["en", "pt-BR"]) {
    const msg = getMessages(idioma);
    const neutro = msg.removalReason("x", "classe-que-nao-existe");
    for (const [skill, classe] of [["arch-hexagonal", CLASS_ARCHITECTURE], ["junit-clean", CLASS_LANGUAGE], ["evidence-capture", CLASS_OPTIONAL]]) {
      assert.equal(classe, skillClass(skill));
      assert.notEqual(msg.removalReason(skill, classe), neutro.replace("x", skill),
        `${idioma}/${classe}: chave literal desacoplada da constante cairia no fallback em silencio`);
    }
    assert.equal(msg.removalReason("spec-create", skillClass("spec-create")), neutro.replace("x", "spec-create"));
  }
});
