// Achado de validação de artefato (ADR-0012). Forma única para tudo que o `mgr spec validate`
// devolve, e a razão de existir é uma só: **a estrutura torna a mensagem inútil impossível**.
//
// `remediation` e `example` são obrigatórios e o construtor RECUSA quem os omita. Sem isso, a
// regra nova nasceria dizendo "revise a seção" e a ferramenta viraria ruído — a spec `cli-validate`
// do OpenSpec exige arquivo, localização, remediação específica e exemplo conforme, e essa
// exigência só se sustenta se for impossível burlá-la por distração.
export const SEVERITIES = ["error", "warning"];

const textoNaoVazio = (valor) => typeof valor === "string" && valor.trim().length > 0;

export function create({ code, severity, file, line = null, task = null, message, remediation, example }) {
  if (!textoNaoVazio(code)) throw new Error("finding sem `code`");
  if (!SEVERITIES.includes(severity)) {
    throw new Error(`finding com severidade inválida: ${JSON.stringify(severity)} (use ${SEVERITIES.join(" | ")})`);
  }
  if (!textoNaoVazio(message)) throw new Error(`finding ${code} sem \`message\``);
  if (!textoNaoVazio(remediation)) {
    throw new Error(`finding ${code} sem \`remediation\`: todo achado diz o que fazer, nunca só o que está errado`);
  }
  if (!textoNaoVazio(example)) {
    throw new Error(`finding ${code} sem \`example\`: todo achado mostra a forma conforme`);
  }
  return Object.freeze({ code, severity, file, line, task, message, remediation, example });
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
