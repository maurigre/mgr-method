import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NO_BUDGET, OVER_BUDGET, WITHIN_BUDGET, summarize, verdict } from "../src/tokens.js";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = path.join(RAIZ, "test", "fixtures", "transcripts", "exemplo.jsonl");
const diretorioTemporario = () => mkdtempSync(path.join(os.tmpdir(), "mgr-tokens-"));

// A conta manual da fixture, fixada na P0.2: input+output = 213, cache_read = 7916.
const TOTAL_DA_FIXTURE = 213;
const CACHE_DA_FIXTURE = 7916;

const transcrito = (registros) => {
  const caminho = path.join(diretorioTemporario(), "t.jsonl");
  writeFileSync(caminho, registros.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  return caminho;
};
const assistente = (input, output, cacheRead = 0) => ({
  type: "assistant",
  message: { role: "assistant", usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead } },
});

test("a soma da fixture bate com a conta manual fixada na P0.2", () => {
  const medicao = summarize({ conversation: FIXTURE });
  assert.equal(medicao.total, TOTAL_DA_FIXTURE);
  assert.equal(medicao.conversationTotal, TOTAL_DA_FIXTURE);
});

test("`cache_read` é reportado à parte e NÃO entra no total", () => {
  const medicao = summarize({ conversation: FIXTURE });
  assert.equal(medicao.cacheRead, CACHE_DA_FIXTURE);
  assert.equal(medicao.total, TOTAL_DA_FIXTURE, "somar o cache daria 8129 e a comparação perderia sentido");
  assert.notEqual(medicao.total, TOTAL_DA_FIXTURE + CACHE_DA_FIXTURE);
});

test("o total soma a conversa E os agentes que ela subiu", () => {
  const agenteUm = transcrito([assistente(100, 10)]);
  const agenteDois = transcrito([assistente(200, 20)]);
  const medicao = summarize({ conversation: FIXTURE, agents: [agenteUm, agenteDois] });
  assert.equal(medicao.agentsTotal, 330);
  assert.equal(medicao.agentsCounted, 2);
  assert.equal(medicao.total, TOTAL_DA_FIXTURE + 330, "medir só a conversa esconderia o custo do agente");
});

test("o contexto de conversa é o input do ÚLTIMO registro, não a soma dos inputs", () => {
  const conversa = transcrito([assistente(10, 1), assistente(50, 1), assistente(120, 1)]);
  const medicao = summarize({ conversation: conversa });
  assert.equal(medicao.conversationContext, 120, "é o tamanho que a janela alcançou");
  assert.notEqual(medicao.conversationContext, 180, "a soma dos inputs cresce mesmo com a janela estável");
});

test("transcript de agente não mexe no contexto de conversa", () => {
  const conversa = transcrito([assistente(40, 1)]);
  const agente = transcrito([assistente(9000, 500)]);
  const medicao = summarize({ conversation: conversa, agents: [agente] });
  assert.equal(medicao.conversationContext, 40, "o agente tem janela própria");
  assert.equal(medicao.total, 41 + 9500);
});

test("arquivo ausente e linha inválida não derrubam a medição", () => {
  const quebrado = path.join(diretorioTemporario(), "quebrado.jsonl");
  writeFileSync(quebrado, `${JSON.stringify(assistente(5, 5))}\n{"metade do registro\n`, "utf8");
  assert.equal(summarize({ conversation: quebrado }).total, 10, "a linha pela metade é ignorada");
  assert.equal(summarize({ conversation: "/nao/existe.jsonl" }).total, 0);
  assert.deepEqual(summarize(), {
    total: 0, cacheRead: 0, conversationContext: 0, conversationTotal: 0, agentsTotal: 0, agentsCounted: 0,
  });
});

test("registro sem `usage` é ignorado sem quebrar", () => {
  const misto = transcrito([{ type: "user", message: { role: "user", content: "oi" } }, assistente(7, 3)]);
  assert.equal(summarize({ conversation: misto }).total, 10);
});

test("campo ausente no `usage` conta como zero, em vez de virar NaN", () => {
  // A plataforma pode não mandar todos os campos. Sem o default, uma soma com `undefined` vira
  // NaN e a medição inteira deixa de significar qualquer coisa, silenciosamente.
  const parcial = transcrito([
    { type: "assistant", message: { role: "assistant", usage: { input_tokens: 12 } } },
    { type: "assistant", message: { role: "assistant", usage: { output_tokens: 8 } } },
  ]);
  const medicao = summarize({ conversation: parcial });
  assert.equal(medicao.total, 20);
  assert.equal(medicao.cacheRead, 0);
  assert.equal(medicao.conversationContext, 12, "sem `input_tokens`, o último válido permanece");
});

test("sem teto declarado não há reprovação — medir nunca exigiu punir", () => {
  const medicao = summarize({ conversation: FIXTURE });
  assert.equal(verdict(medicao, undefined), NO_BUDGET);
  assert.equal(verdict(medicao, null), NO_BUDGET);
});

test("com teto declarado, ultrapassar reprova e ficar abaixo passa", () => {
  const medicao = summarize({ conversation: FIXTURE });
  assert.equal(verdict(medicao, TOTAL_DA_FIXTURE - 1), OVER_BUDGET);
  assert.equal(verdict(medicao, TOTAL_DA_FIXTURE), WITHIN_BUDGET, "o limite é inclusivo");
  assert.equal(verdict(medicao, TOTAL_DA_FIXTURE + 1), WITHIN_BUDGET);
});

test("teto zero é teto, não ausência de teto", () => {
  assert.equal(verdict(summarize({ conversation: FIXTURE }), 0), OVER_BUDGET);
});
