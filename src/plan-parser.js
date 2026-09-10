// Parsing do 04-plan.md (ADR-0012). Puro, sem IO — o padrão de `checkSkill` em src/validator.js.
//
// A identidade é o ID da task e a CHAVE do campo, ambos em inglês; a prosa fica no idioma do
// usuário. Cabeçalho em prosa não serve como identidade: a medição de 2026-08-31 mostrou que
// nenhum dos 9 planos em disco usa os cabeçalhos do template, porque os artefatos são escritos no
// idioma do usuário e o template é inglês canônico (ADR-0003).
//
// E o formato é DECLARADO por marcador, nunca inferido. Inferir "formato novo" pela presença de
// chave em inglês reprovaria 35 tasks: 3 dos 9 planos são mistos — usam `depends_on` em inglês ao
// lado de campos em português, e nenhum deles tem `done_when`.

import { stripFencedBlocks } from "./markdown.js";

// Linha inteira, de propósito: `<!-- mgr-plan-format: 1 -->` citado no meio de uma frase
// é documentação. Só declara o formato quem o põe sozinho numa linha.
const FORMAT_MARKER = /^[ \t]*<!--\s*mgr-plan-format:\s*(\d+)\s*-->[ \t]*$/m;
// `### P0.1 — título livre`. O ID é o que identifica; o resto do cabeçalho é prosa do usuário.
const TASK_HEADER = /^#{2,4}\s+(P\d+\.\d+)\b/;
// `- **chave:** valor` — só as chaves conhecidas entram; chave desconhecida é ignorada, não é erro.
const FIELD = /^\s*[-*]\s+\*\*([a-z_]+):\*\*\s*(.*)$/;

const KNOWN_FIELDS = new Set(["priority", "depends_on", "files", "artifact", "done_when", "helper_skill"]);

// `[a, b]` ou `a, b` ou vazio — o autor escreve à mão, então as duas formas valem.
function parseList(raw) {
  const limpo = raw.trim().replace(/^\[|\]$/g, "").trim();
  if (!limpo || limpo === "—" || limpo === "-") return [];
  return limpo.split(",").map((item) => item.trim().replace(/^`|`$/g, "")).filter(Boolean);
}

export function parse(rawText) {
  const text = stripFencedBlocks(rawText);
  const linhas = text.split("\n");
  const marcador = text.match(FORMAT_MARKER);
  const tasks = [];
  let atual = null;

  for (const [indice, linha] of linhas.entries()) {
    const cabecalho = linha.match(TASK_HEADER);
    if (cabecalho) {
      atual = {
        id: cabecalho[1],
        line: indice + 1,
        priority: "",
        dependsOn: [],
        files: [],
        artifact: "",
        doneWhen: "",
        helperSkill: "",
      };
      tasks.push(atual);
      continue;
    }
    if (!atual) continue;

    const campo = linha.match(FIELD);
    if (!campo) continue;
    const [, chave, valor] = campo;
    if (!KNOWN_FIELDS.has(chave)) continue;

    if (chave === "depends_on") atual.dependsOn = parseList(valor);
    else if (chave === "files") atual.files = parseList(valor);
    else if (chave === "priority") atual.priority = valor.trim();
    else if (chave === "artifact") atual.artifact = valor.trim();
    else if (chave === "done_when") atual.doneWhen = valor.trim();
    else if (chave === "helper_skill") atual.helperSkill = valor.trim();
  }

  // Tipo explícito em vez de `null` como sentinela: "formato não declarado" é decisão de
  // domínio — é o que separa "roda tudo" de "roda só consistência" — e DES-1/QUAL-1 pedem
  // tipo explícito justamente para esse caso.
  return {
    format: marcador ? { declared: true, version: Number(marcador[1]) } : { declared: false, version: 0 },
    tasks,
  };
}
