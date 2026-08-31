// Parsing do 03-spec.md (ADR-0013). Puro, sem IO — mesmo padrão do plan-parser.
//
// O critério de aceitação é reconhecido pelo PRÓPRIO ID, sem detectar seção. O título da seção é
// prosa e varia — "Critérios de aceitação testáveis", "7. Critérios de aceitação (testáveis)",
// "Testable acceptance criteria" — então detectá-lo reintroduziria a dependência de idioma que o
// ADR-0012 eliminou. O ID não varia, e não precisa: o validador só precisa saber que o critério
// existe, tem identidade e não está vazio; onde ele mora é irrelevante para isso.
//
// `CA-<n>` já existia no repositório antes desta feature, inventado pelo autor na
// skill-diagnosing-bugs sem que nenhuma regra pedisse.

import { stripFencedBlocks } from "./markdown.js";

// Linha inteira, de propósito: `<!-- mgr-spec-format: 1 -->` citado no meio de uma frase
// é documentação. Só declara o formato quem o põe sozinho numa linha.
const FORMAT_MARKER = /^[ \t]*<!--\s*mgr-spec-format:\s*(\d+)\s*-->[ \t]*$/m;

// Casa `**CA-1:**`, `- [ ] **CA-2 (validador):**` e variações com marcador de lista ou checkbox.
// O rótulo entre parênteses é livre: é prosa do autor, não identidade.
const CRITERION = /^\s*(?:[-*]\s+)?(?:\[[ xX]\]\s+)?\*\*(CA-(\d+))(?:\s*\([^)]*\))?:\*\*\s*(.*)$/;

export function parse(rawText) {
  const text = stripFencedBlocks(rawText);
  const marcador = text.match(FORMAT_MARKER);
  const criteria = [];

  for (const [indice, linha] of text.split("\n").entries()) {
    const encontrado = linha.match(CRITERION);
    if (!encontrado) continue;
    const [, id, numero, corpo] = encontrado;
    criteria.push({ id, number: Number(numero), line: indice + 1, body: corpo.trim() });
  }

  // Tipo explícito, nunca `null` como sentinela (DES-1/QUAL-1): "formato não declarado" é decisão
  // de domínio — é o que separa "as regras valem" de "só o aviso".
  return {
    format: marcador ? { declared: true, version: Number(marcador[1]) } : { declared: false, version: 0 },
    criteria,
  };
}
