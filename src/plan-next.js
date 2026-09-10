// A próxima ação a partir do plano (ADR-0014). Puro na decisão, com IO só na descoberta —
// o mesmo desenho do `plan-validator`, e usando a MESMA descoberta (`artifactFiles`), porque
// duplicá-la foi reprovação do gate isolado na fatia anterior.
//
// A regra deste módulo, em uma frase: ele nunca afirma progresso que o artefato não declare.
// Por isso devolve `stateDeclared` junto com a resposta — quem formata precisa poder dizer
// "não sei o que você já fez" quando o plano não diz.
import { readFileSync } from "node:fs";
import path from "node:path";
import { artifactFiles } from "./artifacts.js";
import { PLAN_FILE, STATUS_DONE, parse, priorityLevel } from "./plan-parser.js";

const concluida = (task) => task.status === STATUS_DONE;

// Pronta = não concluída E todo id do `depends_on` existe no plano E está concluído.
//
// Dependência apontando para id inexistente NÃO conta como satisfeita. Assumir que o alvo ausente
// está pronto seria inventar estado; a PLAN-1 já reprova esse plano, e a resposta manda rodar o
// validador em vez de responder por cima do defeito.
function pronta(task, porId) {
  if (concluida(task)) return false;
  return task.dependsOn.every((dependencia) => {
    const alvo = porId.get(dependencia);
    return alvo !== undefined && concluida(alvo);
  });
}

// Decisão pura. Devolve sempre a mesma forma, com `task` em `null` quando não há o que oferecer —
// nunca lança, porque "não há próxima" é resposta legítima e não erro.
export function choose(parsed) {
  const taskCount = parsed.tasks.length;
  // Conta PRESENÇA do campo, não diferença do default: `status: todo` é estado declarado.
  const stateDeclared = parsed.tasks.filter((task) => task.statusDeclared).length;
  const base = { task: null, stateDeclared, taskCount };

  if (!parsed.format.declared) return { ...base, outcome: "format-not-declared" };
  if (!taskCount) return { ...base, outcome: "no-tasks" };
  if (parsed.tasks.every(concluida)) return { ...base, outcome: "all-done" };

  const porId = new Map(parsed.tasks.map((task) => [task.id, task]));
  const candidatas = parsed.tasks
    .map((task, ordem) => ({ task, ordem }))
    .filter(({ task }) => pronta(task, porId))
    .sort((uma, outra) => priorityLevel(uma.task.id) - priorityLevel(outra.task.id) || uma.ordem - outra.ordem);

  if (!candidatas.length) {
    const bloqueadas = parsed.tasks.filter((task) => !concluida(task))
      .map((task) => ({ id: task.id, waitingFor: task.dependsOn.filter((dep) => !concluida(porId.get(dep) ?? {})) }));
    return { ...base, outcome: "nothing-ready", blocked: bloqueadas };
  }

  return { ...base, outcome: "task", task: candidatas[0].task };
}

// Descoberta e leitura. `null` em `file` quando não há plano — quem chama decide o que fazer,
// em vez de receber um palpite (DES-1).
export function nextTask(repo, { slug = null } = {}) {
  const [arquivo] = artifactFiles(repo, slug, PLAN_FILE);
  if (!arquivo) return { file: null, outcome: "no-plan", task: null, stateDeclared: 0, taskCount: 0 };
  const decisao = choose(parse(readFileSync(arquivo, "utf8")));
  return { file: path.relative(repo, arquivo), ...decisao };
}
