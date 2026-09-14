// Motores como dado (ADR-0010, decisão 4). O que o método sabe sobre cada motor deixa de
// ser ramificação por nome e passa a ser descritor consultável — é o que faz a degradação
// declarada sair de consulta, e não de `if (engine === "...")` espalhado.
//
// O QUE JÁ MIGROU: o eixo de AGENTES (ADR-0010) e o de HOOKS (ADR-0018) — arquivo, eventos,
// matcher por evento, forma da entrada, envelope e capacidade de compactação são dado daqui.
// O QUE FALTA: os mapas de `installer.js` (diretório de skills) e `adapters.js` (tradução de
// manifest), mais a saída do hook de sessão em `detector.js`. É a outra metade da dívida que o
// ADR-0010 nomeou, e continua declarada.
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
