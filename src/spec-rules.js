// Regras sobre a spec parseada (ADR-0013). Puras: recebem o parse, devolvem findings.
//
// Diferença deliberada em relação ao plano: aqui NENHUMA regra roda sem o marcador, porque todas
// dependem da presença de `CA-*`. No plano havia regras de consistência que valiam sobre os campos
// já existentes; aqui não há equivalente — exigir critério de quem nunca prometeu tê-lo seria
// acusar ausência, e as 10 specs em disco seriam reprovadas.
//
// O que estas regras NÃO verificam, de propósito: se o critério é testável de verdade, se os
// critérios cobrem a spec, se o critério é bom. As três são julgamento, não parsing — e a segunda
// é o eixo Spec do `code-analyzer`, que a L6.1 proíbe fundir com outro eixo.
import { create } from "./findings.js";

export function check(parsed, file) {
  if (!parsed.format.declared) {
    return [create({
      code: "SPEC-0", severity: "warning", file,
      message: "spec sem o marcador de formato: as regras de critério não foram aplicadas",
      remediation: "Acrescente o marcador na primeira linha para que a spec seja verificada. Sem ele, nenhuma regra roda — nenhuma spec existente é reprovada por isto.",
      example: "<!-- mgr-spec-format: 1 -->",
    })];
  }

  const findings = [];

  // SPEC-1 — formato declarado e nenhum critério de aceitação.
  if (!parsed.criteria.length) {
    findings.push(create({
      code: "SPEC-1", severity: "error", file,
      message: "spec declara o formato mas não tem nenhum critério de aceitação",
      remediation: "Uma spec sem critério de aceitação não tem como ser verificada no fechamento. Declare ao menos um, com identidade.",
      example: "- [ ] **CA-1:** o comando sai com código 1 quando o plano tem dependência inexistente",
    }));
    return findings;
  }

  // SPEC-2 — identidade duplicada. Duas coisas diferentes com o mesmo nome quebram a citação.
  //
  // A chave é o NÚMERO, não a string: `CA-1` e `CA-01` são ids diferentes e o mesmo critério para
  // quem lê. Comparar por string deixaria o par escapar aqui e também da SPEC-4, que já normaliza
  // por número — e a citação numa reprovação ficaria ambígua, que é o dano que esta regra evita.
  const vistos = new Map();
  for (const criterio of parsed.criteria) {
    const anterior = vistos.get(criterio.number);
    if (anterior) {
      findings.push(create({
        code: "SPEC-2", severity: "error", file, line: criterio.line, task: criterio.id,
        message: anterior.id === criterio.id
          ? `identidade duplicada: \`${criterio.id}\` já aparece na linha ${anterior.line}`
          : `identidade duplicada: \`${criterio.id}\` colide com \`${anterior.id}\`, na linha ${anterior.line}`,
        remediation: "A identidade existe para ser citada numa reprovação. Duas com o mesmo número tornam a citação ambígua — renumere.",
        example: "- [ ] **CA-2:** <o próximo número livre>",
      }));
    } else {
      vistos.set(criterio.number, { id: criterio.id, line: criterio.line });
    }
  }

  // SPEC-3 — critério sem corpo. Identidade sem enunciado não verifica nada.
  for (const criterio of parsed.criteria) {
    if (criterio.body) continue;
    findings.push(create({
      code: "SPEC-3", severity: "error", file, line: criterio.line, task: criterio.id,
      message: `critério \`${criterio.id}\` está vazio`,
      remediation: "Enuncie o que se observa quando o critério é cumprido. Identidade sem enunciado não verifica nada.",
      example: "- [ ] **CA-1:** os 10 planos existentes produzem zero erros",
    }));
  }

  findings.push(...checkNumbering(parsed, file));
  return findings;
}

// SPEC-4 — buraco na numeração. Aviso, não erro: numerar com folga é escolha de quem escreve, mas
// buraco costuma ser critério apagado sem renumerar — e aí a citação aponta para o nada.
function checkNumbering(parsed, file) {
  const numeros = [...new Set(parsed.criteria.map((criterio) => criterio.number))].sort((a, b) => a - b);
  if (!numeros.length) return [];

  const faltando = [];
  for (let esperado = numeros[0]; esperado < numeros[numeros.length - 1]; esperado += 1) {
    if (!numeros.includes(esperado)) faltando.push(`CA-${esperado}`);
  }
  if (!faltando.length) return [];

  return [create({
    code: "SPEC-4", severity: "warning", file, line: parsed.criteria[0].line,
    message: `buraco na numeração dos critérios: falta ${faltando.join(", ")}`,
    remediation: "Confira se um critério foi removido sem renumerar. Se o buraco é intencional, ignore este aviso.",
    example: "- [ ] **CA-1:** …\n- [ ] **CA-2:** …\n- [ ] **CA-3:** …",
  })];
}
