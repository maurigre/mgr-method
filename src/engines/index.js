// Motores como dado (ADR-0010, decisão 4). O que o método sabe sobre cada motor deixa de
// ser ramificação por nome e passa a ser descritor consultável — é o que faz a degradação
// declarada sair de consulta, e não de `if (engine === "...")` espalhado.
//
// ESCOPO DELIBERADO: nesta fatia o descritor é consumido só pelo eixo de AGENTES. Os mapas
// de `installer.js` (diretório de skills), `hooks.js` (arquivo e evento de hook) e
// `adapters.js` (tradução de manifest) continuam onde estão — migrá-los é feature própria,
// com testes de não-regressão próprios.
//
// Dado puro, sem IO: mesmo padrão de `checkSkill` em src/validator.js.
import claudeCode from "./claude-code.js";
import copilot from "./copilot.js";

const ENGINES = { "claude-code": claudeCode, copilot };

export const ids = () => Object.keys(ENGINES).sort();

export function get(id) {
  const engine = ENGINES[id];
  if (!engine) {
    throw new Error(`unknown engine: ${id} (expected ${ids().join(" | ")})`);
  }
  return engine;
}
