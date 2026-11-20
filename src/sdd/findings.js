// Achado de validação de artefato (ADR-0012). Forma única para tudo que o `mgr spec validate`
// devolve, e a razão de existir é uma só: **a estrutura torna a mensagem inútil impossível**.
//
// `remediation` e `example` são obrigatórios e o construtor RECUSA quem os omita. Sem isso, a
// regra nova nasceria dizendo "revise a seção" e a ferramenta viraria ruído — a spec `cli-validate`
// do OpenSpec exige arquivo, localização, remediação específica e exemplo conforme, e essa
// exigência só se sustenta se for impossível burlá-la por distração.
//
// `message`, `remediation` e `example` entram como descritores de texto (`text(chave, ...params)`,
// ADR-0033, DT-19). O objeto devolvido mantem as mesmas chaves, com o texto em ingles canonico; a
// frase da tela vem do descritor, guardado fora do objeto.
import { InvariantError } from "../core/errors.js";
import { getMessages } from "../core/messages.js";
import { renderText } from "../core/ui-text.js";

export const SEVERITIES = ["error", "warning"];

const textoNaoVazio = (valor) => typeof valor === "string" && valor.trim().length > 0;

const descritoresDosAchados = new WeakMap();

// As tabelas saem sob demanda, e nao no topo do modulo, por causa do ciclo de import declarado em
// `src/core/errors.js`.
let tabelas = null;
const tabelasDeIdioma = () => {
  tabelas ??= [getMessages("en"), getMessages("pt-BR")];
  return tabelas;
};

const descritorValido = (descritor) => {
  if (!descritor || typeof descritor.key !== "string" || !Array.isArray(descritor.params)) return false;
  return tabelasDeIdioma().every((tabela) => Object.hasOwn(tabela, descritor.key));
};

export function create({ code, severity, file, line = null, task = null, message, remediation, example }) {
  if (!textoNaoVazio(code)) throw new InvariantError("invariantFindingNoCode", []);
  if (!SEVERITIES.includes(severity)) {
    throw new InvariantError("invariantFindingSeverityInvalid", [severity, SEVERITIES]);
  }
  if (!descritorValido(message)) throw new InvariantError("invariantFindingNoMessage", [code]);
  if (!descritorValido(remediation)) throw new InvariantError("invariantFindingNoRemediation", [code]);
  if (!descritorValido(example)) throw new InvariantError("invariantFindingNoExample", [code]);
  const [canonica] = tabelasDeIdioma();
  const achado = Object.freeze({
    code, severity, file, line, task,
    message: renderText(canonica, message),
    remediation: renderText(canonica, remediation),
    example: renderText(canonica, example),
  });
  descritoresDosAchados.set(achado, { message, remediation, example });
  return achado;
}

/** Descritores `{ message, remediation, example }` de um achado de `create`; outro objeto lanca. */
export function findingTexts(finding) {
  const descritores = descritoresDosAchados.get(finding);
  if (!descritores) throw new InvariantError("invariantArtifactFindingNotFromCreate", []);
  return descritores;
}

export const isError = (finding) => finding.severity === "error";

// Resumo por severidade, para a borda decidir exit code e rodapé sem recontar.
export function summarize(findings) {
  return {
    errors: findings.filter(isError).length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
  };
}

// Avisos isentos do `--strict`. Formato legado não reprova nem em modo estrito — vira erro só
// numa minor futura, com prazo (ADR-0012, ADR-0013). Mora aqui, e não num validador de artefato,
// porque bloqueio é propriedade do ACHADO (severidade e código), não do plano nem da spec.
export const STRICT_EXEMPT = ["PLAN-0", "SPEC-0"];

export function blocking(findings, { strict = false } = {}) {
  return findings.filter((finding) => {
    if (isError(finding)) return true;
    return strict && !STRICT_EXEMPT.includes(finding.code);
  }).length;
}
