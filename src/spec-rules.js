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
import { text } from "./ui-text.js";

export function check(parsed, file) {
  if (!parsed.format.declared) {
    return [create({
      code: "SPEC-0", severity: "warning", file,
      message: text("artifactSpec0Message"),
      remediation: text("artifactSpec0Remediation"),
      example: text("artifactSpec0Example"),
    })];
  }

  const findings = [];

  // SPEC-1 — formato declarado e nenhum critério de aceitação.
  if (!parsed.criteria.length) {
    findings.push(create({
      code: "SPEC-1", severity: "error", file,
      message: text("artifactSpec1Message"),
      remediation: text("artifactSpec1Remediation"),
      example: text("artifactSpec1Example"),
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
          ? text("artifactSpec2DuplicateMessage", criterio.id, anterior.line)
          : text("artifactSpec2CollisionMessage", criterio.id, anterior.id, anterior.line),
        remediation: text("artifactSpec2Remediation"),
        example: text("artifactSpec2Example"),
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
      message: text("artifactSpec3Message", criterio.id),
      remediation: text("artifactSpec3Remediation"),
      example: text("artifactSpec3Example"),
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
    message: text("artifactSpec4Message", faltando),
    remediation: text("artifactSpec4Remediation"),
    example: text("artifactSpec4Example"),
  })];
}
