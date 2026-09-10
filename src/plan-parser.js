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

const KNOWN_FIELDS = new Set(["priority", "depends_on", "files", "artifact", "done_when", "helper_skill", "status"]);

// Vocabulário FECHADO do estado da task (ADR-0014). Em inglês porque aqui o valor é IDENTIDADE,
// não prosa — a mesma regra que o ADR-0012 aplicou às chaves. `status: concluído` não pode
// funcionar pela mesma razão que `depends_on` não virou `depende_de`.
//
// Fonte única: a `PLAN-6` valida contra esta lista e o `plan-next` decide por ela. Duas listas
// divergiriam, e divergir é o defeito que este projeto já mediu duas vezes.
export const STATUS_VALUES = ["todo", "done"];
export const STATUS_DONE = "done";

// Nome do artefato e derivação de prioridade moram aqui, com o resto do conhecimento de FORMATO.
// Estavam duplicados em `plan-validator` e `plan-next`, e as duas cópias de `nivel` já divergiam
// no fallback — que é como toda duplicação começa a mentir.
export const PLAN_FILE = "04-plan.md";

// Prioridade vem do ID, nunca do campo `priority`: duas fontes divergiriam (ADR-0014). ID fora da
// forma `P<n>.<n>` vai para o fim em vez de virar `NaN` e envenenar comparação. Inalcançável pelo
// parser, que só cria task a partir de `TASK_HEADER`, e explícito de propósito.
export const priorityLevel = (id) => {
  const encontrado = String(id).match(/^P(\d+)\./);
  return encontrado ? Number(encontrado[1]) : Number.MAX_SAFE_INTEGER;
};

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
        // Ausência vale `todo`: 100% dos planos em disco não têm a chave, e ausência jamais
        // pode virar `done` — falha para o lado seguro (ADR-0014).
        status: "todo",
        // Presença é diferente de default. Quem escreve `status: todo` DECLAROU o estado, e a
        // resposta do `mgr spec next` afirma quantas tasks declararam — contar por `!== "todo"`
        // faria a ferramenta dizer "não sei o que você já fez" a um plano que diz exatamente isso.
        statusDeclared: false,
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
    // O valor entra CRU, sem normalizar: quem julga se ele é válido é a `PLAN-6`. Normalizar aqui
    // apagaria o defeito antes de alguém poder apontá-lo.
    else if (chave === "status") { atual.status = valor.trim(); atual.statusDeclared = true; }
  }

  // Tipo explícito em vez de `null` como sentinela: "formato não declarado" é decisão de
  // domínio — é o que separa "roda tudo" de "roda só consistência" — e DES-1/QUAL-1 pedem
  // tipo explícito justamente para esse caso.
  return {
    format: marcador ? { declared: true, version: Number(marcador[1]) } : { declared: false, version: 0 },
    tasks,
  };
}
