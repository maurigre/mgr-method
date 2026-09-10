// Regras sobre o plano parseado (ADR-0012). Puras: recebem o parse, devolvem findings.
//
// Duas famílias, e a distinção é o que protege quem já tem plano escrito:
//
//   CONSISTÊNCIA (PLAN-1, PLAN-2, PLAN-3, PLAN-6) — rodam SEMPRE, sobre os campos que existirem. Um plano
//   legado que declare `depends_on` ganha verificação de dependência de graça, sem migrar nada.
//
//   PRESENÇA (PLAN-4) — só rodam com o marcador de formato. Sem ele, exigir campo seria acusar
//   ausência de algo que o autor nunca prometeu: 3 dos 9 planos em disco são mistos e nenhum tem
//   `done_when`; inferir formato os reprovaria 35 vezes.
import { create } from "./findings.js";
import { STATUS_VALUES, priorityLevel } from "./plan-parser.js";

const MAX_FILES = 3;

// Em plano LEGADO o achado de consistência sai como AVISO, nunca como erro: a RN-2 promete que
// formato antigo degrada com warning, e o README repete a promessa. Mas a regra continua RODANDO
// — o autor vê a dependência quebrada, só não é reprovado por ela. Desligar a checagem perderia
// os 31 `depends_on` que os planos mistos já declaram.
const severidade = (parsed) => (parsed.format.declared ? "error" : "warning");

export function checkConsistency(parsed, file) {
  const findings = [];
  const gravidade = severidade(parsed);
  const ids = new Set(parsed.tasks.map((task) => task.id));

  for (const task of parsed.tasks) {
    // PLAN-1 — dependência apontando para task que não existe.
    for (const dependencia of task.dependsOn) {
      if (ids.has(dependencia)) continue;
      findings.push(create({
        code: "PLAN-1", severity: gravidade, file, line: task.line, task: task.id,
        message: `depends_on aponta para \`${dependencia}\`, que não é uma task deste plano`,
        remediation: `Corrija o id, ou crie a task \`${dependencia}\`. Ids válidos aqui: ${[...ids].join(", ")}.`,
        example: "- **depends_on:** [P0.1, P0.2]",
      }));
    }

    // PLAN-3 — granularidade: task que toca mais de 3 arquivos precisa ser quebrada.
    if (task.files.length > MAX_FILES) {
      findings.push(create({
        code: "PLAN-3", severity: gravidade, file, line: task.line, task: task.id,
        message: `task com ${task.files.length} arquivos; o teto é ${MAX_FILES}`,
        remediation: "Quebre a task antes de executar — a granularidade existe para o trabalho caber num passo revisável.",
        example: "- **files:** [src/a.js, test/a.test.js]",
      }));
    }
  }

  findings.push(...detectCycles(parsed, file, gravidade));
  findings.push(...checkStatus(parsed, file));
  return findings;
}

// PLAN-2 — ciclo no DAG, inclusive indireto (A→B→C→A). Busca em profundidade com pilha.
function detectCycles(parsed, file, gravidade) {
  const porId = new Map(parsed.tasks.map((task) => [task.id, task]));
  const estado = new Map();
  const findings = [];
  const relatados = new Set();

  const visitar = (id, caminho) => {
    if (estado.get(id) === "pronto") return;
    if (estado.get(id) === "visitando") {
      const inicio = caminho.indexOf(id);
      const ciclo = [...caminho.slice(inicio), id];
      const chave = [...ciclo].sort().join(">");
      if (relatados.has(chave)) return;
      relatados.add(chave);
      const task = porId.get(id);
      findings.push(create({
        code: "PLAN-2", severity: gravidade, file, line: task ? task.line : null, task: id,
        message: `ciclo no DAG de dependências: ${ciclo.join(" → ")}`,
        remediation: "Quebre o ciclo: uma das tasks tem de poder começar sem a outra, ou as duas são a mesma task.",
        example: "- **depends_on:** [P0.1]   (e P0.1 não depende desta)",
      }));
      return;
    }
    estado.set(id, "visitando");
    for (const dependencia of porId.get(id)?.dependsOn || []) {
      if (porId.has(dependencia)) visitar(dependencia, [...caminho, id]);
    }
    estado.set(id, "pronto");
  };

  for (const task of parsed.tasks) visitar(task.id, []);
  return findings;
}

// PRESENÇA e ORDEM. `PLAN-0` avisa que o formato não foi declarado; `PLAN-4` só roda quando foi.
export function checkPresence(parsed, file) {
  const findings = [];

  if (!parsed.format.declared) {
    findings.push(create({
      code: "PLAN-0", severity: "warning", file,
      message: "plano sem o marcador de formato: as regras de presença não foram aplicadas",
      remediation: "Acrescente o marcador na primeira linha para que o plano seja verificado por inteiro. Sem ele, só as regras de consistência valem — nenhum plano existente é reprovado por isto.",
      example: "<!-- mgr-plan-format: 1 -->",
    }));
    return findings;
  }

  for (const task of parsed.tasks) {
    const faltando = [];
    if (!task.doneWhen) faltando.push("done_when");
    if (!task.artifact) faltando.push("artifact");
    if (!faltando.length) continue;
    findings.push(create({
      code: "PLAN-4", severity: "error", file, line: task.line, task: task.id,
      message: `task sem ${faltando.join(" e sem ")}`,
      remediation: "`artifact` declara o trilho — nome, forma, assinatura e QUANTIDADE exatos (L4.3). `done_when` declara o critério observável que fecha a task.",
      example: "- **artifact:** 1 módulo com parse(text)\n- **done_when:** o teste passa e falharia sem a regra",
    }));
  }

  findings.push(...checkPriorityOrder(parsed, file));
  return findings;
}

// PLAN-6 — `status` fora do vocabulário fechado (ADR-0014). Família CONSISTÊNCIA, e não presença:
// ela julga um campo que EXISTE, em vez de cobrar um que falta. Por isso roda também em plano
// legado, que é onde um `status` escrito à mão tem mais chance de sair errado.
//
// Aviso SEMPRE, e não `gravidade`: o campo é novo, e nenhum plano escrito antes dele existir pode
// ser reprovado por causa dele — nem quando declara o formato.
//
// Ignorar o valor errado em silêncio faria o `mgr spec next` responder errado sem ninguém saber —
// que é a forma do defeito que a fatia 2 encontrou no marcador dentro de bloco cercado. O valor
// inválido já falha para o lado seguro (nunca conta como `done`); esta regra faz o autor VER.
function checkStatus(parsed, file) {
  return parsed.tasks
    .filter((task) => !STATUS_VALUES.includes(task.status))
    .map((task) => create({
      code: "PLAN-6", severity: "warning", file, line: task.line, task: task.id,
      message: `status \`${task.status}\` não é \`${STATUS_VALUES.join("` nem `")}\``,
      remediation: `O vocabulário é fechado e em inglês, como as chaves: só \`${STATUS_VALUES.join("` e `")}\`. Valor fora dele nunca conta como concluído, então a task será oferecida de novo.`,
      example: "- **status:** done",
    }));
}

// PLAN-5 — dependência fora de ordem de prioridade. Warning: às vezes é intencional, e reprovar
// julgamento de sequência seria decidir por quem planejou.
function checkPriorityOrder(parsed, file) {
  const porId = new Map(parsed.tasks.map((task) => [task.id, task]));
  const findings = [];

  for (const task of parsed.tasks) {
    for (const dependencia of task.dependsOn) {
      if (!porId.has(dependencia)) continue;
      if (!(priorityLevel(task.id) < priorityLevel(dependencia))) continue;
      findings.push(create({
        code: "PLAN-5", severity: "warning", file, line: task.line, task: task.id,
        message: `task de prioridade P${priorityLevel(task.id)} depende de \`${dependencia}\`, que é P${priorityLevel(dependencia)}`,
        remediation: "Confira se a prioridade está certa: bloqueante que espera complementar normalmente indica que uma das duas está no bloco errado.",
        example: "- **depends_on:** [P0.1]   (numa task P1.x)",
      }));
    }
  }
  return findings;
}

// Tudo junto, na ordem em que a borda consome.
export const check = (parsed, file) => [...checkConsistency(parsed, file), ...checkPresence(parsed, file)];
