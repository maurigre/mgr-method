// Medição de token a partir dos transcripts (ADR-0017). Puro parsing mais leitura de arquivo:
// nenhuma decisão de política mora aqui.
//
// O ADR exige que a medição prove DUAS coisas, porque uma sozinha esconde a outra: o contexto de
// conversa tem de cair E o token total tem de ficar abaixo de um teto. Agente não compartilha
// contexto, então trocar conversa longa por vários agentes pode encolher a janela e **aumentar** o
// custo — medir só a conversa contaria a economia escondendo o gasto.
import { existsSync, readFileSync } from "node:fs";

// Cada registro `assistant` do transcript traz `message.usage`. Os campos vêm da plataforma; o
// que este módulo decide é quais entram no total.
const usoDe = (registro) => registro?.message?.usage;

// Uma linha inválida não derruba a medição. Transcript é arquivo que outro processo está
// escrevendo: a última linha pode estar pela metade no instante da leitura, e abortar por isso
// perderia a medida inteira por um byte.
function registros(caminho) {
  if (!caminho || !existsSync(caminho)) return [];
  const lidos = [];
  for (const linha of readFileSync(caminho, "utf8").split("\n")) {
    if (!linha.trim()) continue;
    try { lidos.push(JSON.parse(linha)); } catch { /* linha pela metade: ignora e segue */ }
  }
  return lidos;
}

// Soma de um transcript só. `cacheRead` fica FORA do total de propósito: leitura de cache não
// custa o mesmo que token novo, e somá-la inflaria o número até a comparação perder sentido.
function somar(caminho) {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let ultimoInput = 0;
  for (const registro of registros(caminho)) {
    const uso = usoDe(registro);
    if (!uso) continue;
    input += uso.input_tokens ?? 0;
    output += uso.output_tokens ?? 0;
    cacheRead += uso.cache_read_input_tokens ?? 0;
    ultimoInput = uso.input_tokens ?? ultimoInput;
  }
  return { input, output, cacheRead, ultimoInput, total: input + output };
}

// A medição de um fluxo: a conversa principal mais o transcript de cada agente que ela subiu.
//
// `conversationContext` é o `input_tokens` do ÚLTIMO registro da conversa — o tamanho que a janela
// alcançou, que é o número que diz se a conversa encolheu. Somar os `input_tokens` daria outra
// coisa: o acumulado de todas as chamadas, que cresce mesmo com a janela estável.
export function summarize({ conversation, agents = [] } = {}) {
  const daConversa = somar(conversation);
  const dosAgentes = agents.map(somar);

  const total = daConversa.total + dosAgentes.reduce((soma, um) => soma + um.total, 0);
  const cacheRead = daConversa.cacheRead + dosAgentes.reduce((soma, um) => soma + um.cacheRead, 0);

  return {
    total,
    // Reportado à parte, nunca somado. Quem quiser o número com cache soma os dois e diz que somou.
    cacheRead,
    conversationContext: daConversa.ultimoInput,
    conversationTotal: daConversa.total,
    agentsTotal: dosAgentes.reduce((soma, um) => soma + um.total, 0),
    agentsCounted: dosAgentes.length,
  };
}

// Veredito contra o teto DECLARADO pelo autor. Sem teto, não há reprovação: a RN-7 exige medir, e
// nunca exigiu punir. Publicar um teto padrão seria número sem base, e o ADR-0017 rejeitou isso.
export const OVER_BUDGET = "over-budget";
export const WITHIN_BUDGET = "within-budget";
export const NO_BUDGET = "no-budget";

export function verdict(medicao, budget) {
  if (budget === undefined || budget === null) return NO_BUDGET;
  return medicao.total > budget ? OVER_BUDGET : WITHIN_BUDGET;
}
