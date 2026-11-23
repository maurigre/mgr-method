// Motores como dado (ADR-0010, decisão 4). O que o método sabe sobre cada motor deixa de
// ser ramificação por nome e passa a ser descritor consultável — é o que faz a degradação
// declarada sair de consulta, e não de `if (engine === "...")` espalhado.
//
// O QUE JÁ MIGROU: o eixo de AGENTES (ADR-0010), o de HOOKS (ADR-0018) e o de INSTRUÇÕES
// (`instructions`, fatia sdd-apontado-na-raiz, DT-3) — arquivo, eventos, matcher por evento, forma
// da entrada, envelope, capacidade de compactação e arquivo de instrução são dado daqui.
// O diretório de SKILLS migrou em 2026-09-24, junto do de agentes: era um mapa privado em
// `installer.js`, e o `mgr doctor` precisando dele fazia um diagnóstico read-only depender do
// instalador. O QUE AINDA FALTA: `adapters.js` (tradução de manifest) e a saída do hook de sessão
// em `detector.js`. É o resto da dívida que o ADR-0010 nomeou, e continua declarada.
//
// Dado puro, sem IO: mesmo padrão de `checkSkill` em src/plugins/validator.js.
import claudeCode from "./claude-code.js";
import copilot from "./copilot.js";
import { UsageError } from "../core/errors.js";

const ENGINES = { "claude-code": claudeCode, copilot };

export const ids = () => Object.keys(ENGINES).sort();

// Motor de quem nao declarou nenhum: o padrao da pergunta, do `-y` e da instalacao do zero.
export const DEFAULT_ENGINES = Object.freeze([claudeCode.id]);

// Capacidade do motor, para decidir se uma flag de modelo ou de esforco tem onde valer. Mora aqui, com os
// descritores, e nao num modulo de perguntas: o caminho sem terminal tambem a usa.
export const supportsModel = (id) => ids().includes(id) && ENGINES[id].capabilities.agentModel === true;
export const supportsEffort = (id) => ids().includes(id) && ENGINES[id].capabilities.agentEffort === true;

export function get(id) {
  const engine = ENGINES[id];
  if (!engine) {
    throw new UsageError("unknownEngine", [id, ids()]);
  }
  return engine;
}
