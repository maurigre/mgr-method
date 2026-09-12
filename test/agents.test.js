import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS, INTENTS } from "../src/catalog.js";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const corpoDe = (intent) =>
  readFileSync(path.join(RAIZ, "agents", `${AGENTS[intent].agent}.md`), "utf8");

// Os agentes quebram linha em ~95 colunas, e uma frase partida no meio é a MESMA frase. Exigir
// linha única transformaria convenção de wrap em falha de teste — o texto é o contrato, não o
// layout. Mesma razão do `semQuebras` em test/skills-fallback.test.js.
const semQuebras = (texto) => texto.replace(/\s+/g, " ");

// A restrição central do ADR-0017: agente não conversa, então nenhum dos corpos pode instruir o
// agente a perguntar. A negação ("never ask the user anything") é o oposto disso, e casar pela
// palavra `ask` acusaria justamente a frase que protege a regra — foi o que a primeira versão
// desta checagem fez. O que se procura é a INSTRUÇÃO de perguntar, no imperativo.
const INSTRUCAO_DE_PERGUNTAR = [
  /\bAskUserQuestion\b/,
  /^\s*\d+\.\s+.*\bask the (user|human)\b/im,
  /\bask the (user|human) (to|which|what|whether|for)\b/i,
  /\bwait for the (user|human)\b/i,
  /\bconfirm with the (user|human)\b/i,
];

test("os agentes novos existem para as duas intenções que esta fatia acrescenta", () => {
  assert.deepEqual(INTENTS, ["drafting", "execution", "review"]);
  assert.equal(AGENTS.drafting.agent, "mgr-draft");
  assert.equal(AGENTS.execution.agent, "mgr-task");
  for (const intent of INTENTS) assert.ok(corpoDe(intent).length > 0, intent);
});

test("nenhum agente instrui o agente a perguntar ao humano", () => {
  for (const intent of INTENTS) {
    const corpo = corpoDe(intent);
    for (const padrao of INSTRUCAO_DE_PERGUNTAR) {
      assert.doesNotMatch(corpo, padrao, `${intent}: agente não conversa (ADR-0017)`);
    }
  }
});

test("os dois agentes novos DECLARAM que nunca perguntam, e por quê", () => {
  for (const intent of ["drafting", "execution"]) {
    const corpo = semQuebras(corpoDe(intent));
    assert.match(corpo, /never ask the user anything/,
      `${intent}: a promessa é explícita, não subentendida`);
    assert.match(corpo, /\*\*You never ask\.\*\*/, `${intent}: a restrição tem entrada própria`);
    assert.match(corpo, /checkpoints? belongs? to the skill|checkpoints belong to the skill/i,
      `${intent}: diz de quem é o checkpoint que ele não pode segurar`);
  }
});

test("os dois agentes novos dizem que não veem a conversa", () => {
  for (const intent of ["drafting", "execution"]) {
    assert.match(semQuebras(corpoDe(intent)), /cannot see the conversation/,
      `${intent}: é o custo declarado no ADR-0017, e o agente precisa saber dele`);
  }
});

test("todo agente do catálogo viaja no tarball publicado", () => {
  const saida = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const arquivos = JSON.parse(saida)[0].files.map((arquivo) => arquivo.path);
  // Derivado do catálogo, nunca escrito à mão: acrescentar uma intenção sem publicar o agente
  // dela quebra aqui. É a mesma classe de defeito que deixou a 0.7.0-beta.8 sem `agents/`.
  const faltando = INTENTS
    .map((intent) => `agents/${AGENTS[intent].agent}.md`)
    .filter((arquivo) => !arquivos.includes(arquivo));
  assert.deepEqual(faltando, [], "agente que não viaja no pacote não chega ao projeto do usuário");
});

test("todo agente carrega o marcador de idioma de saída", () => {
  for (const intent of INTENTS) {
    assert.match(corpoDe(intent), /\{\{MGR_USER_LANGUAGE\}\}/,
      `${intent}: sem o marcador, o agente responde no idioma que quiser`);
  }
});

test("nenhum agente traz frontmatter no fonte — ele é gerado por motor", () => {
  for (const intent of INTENTS) {
    assert.doesNotMatch(corpoDe(intent), /^---\n/,
      `${intent}: o frontmatter sai do agentFrontmatter, que sabe o que cada motor suporta`);
  }
});
