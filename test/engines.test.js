import { test } from "node:test";
import assert from "node:assert/strict";
import * as engines from "../src/engines/index.js";
import { PLUGIN_ENGINES } from "../src/adapters.js";

test("copilot declara que não tem esforço por agente", () => {
  assert.equal(engines.get("copilot").capabilities.agentEffort, false);
  assert.equal(engines.get("copilot").routing, "instruction");
  assert.equal(engines.get("copilot").agentFile("mgr-review"), "mgr-review.agent.md");
});

test("claude-code declara fork e esforço por agente", () => {
  const claudeCode = engines.get("claude-code");
  assert.equal(claudeCode.capabilities.contextFork, true);
  assert.equal(claudeCode.capabilities.agentEffort, true);
  assert.equal(claudeCode.routing, "fork");
  assert.equal(claudeCode.agentFile("mgr-review"), "mgr-review.md");
});

test("todo motor suportado tem descritor", () => {
  for (const engine of PLUGIN_ENGINES) {
    assert.doesNotThrow(() => engines.get(engine), `motor sem descritor: ${engine}`);
  }
  assert.deepEqual(engines.ids(), [...PLUGIN_ENGINES].sort());
});

test("motor desconhecido reprova com o nome na mensagem", () => {
  assert.throws(() => engines.get("cursor"), /unknown engine: cursor/);
});

test("cada motor declara diretório de agente por escopo", () => {
  for (const engine of engines.ids()) {
    const { agentsDir } = engines.get(engine);
    assert.equal(typeof agentsDir.project, "string");
    assert.equal(typeof agentsDir.global, "string");
  }
});
