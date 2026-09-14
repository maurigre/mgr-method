// Pré-compactação de contexto (ADR-0018). Duas leis do método — a L3.2, que proíbe aceitar a
// compactação automática, e a L3.4, que manda gravar hand-off perto do limite — existiam só como
// texto. Este módulo é o gatilho mecânico delas.
//
// A decisão e a PERSISTÊNCIA vivem aqui, não na borda: é a divisão que a INV-5 fixa, e é o que faz a
// regra mais cara da fatia — nunca sobrescrever hand-off existente — ter teste de mesa em vez de só
// teste por subprocesso. A borda escolhe palavra e código de saída.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { get as engineDescriptor } from "./engines/index.js";
import { slugs } from "./artifacts.js";
import { nextTask } from "./plan-next.js";
import { statusFor } from "./spec-status.js";

// Os dois gatilhos que as plataformas declaram. Qualquer outro valor é DESCONHECIDO, e desconhecido
// nunca bloqueia: bloquear por engano custa a requisição em curso do usuário.
export const MANUAL = "manual";
export const AUTO = "auto";

// Janela em que uma recusa recente libera a próxima tentativa. NÃO é medição: é escolha de desenho,
// declarada aqui. Longa o bastante para o usuário ler a mensagem e decidir; curta o bastante para
// que uma compactação horas depois volte a ser tratada como nova.
//
// Sem isto, bloquear o `manual` tiraria o `/compact` do usuário PARA SEMPRE: pedir de novo
// bloquearia de novo, e a plataforma perderia uma funcionalidade por causa do método.
export const REPEAT_WINDOW_MS = 5 * 60 * 1000;

export const ASSEMBLED = "assembled";
export const NOTHING_IN_PROGRESS = "nothing-in-progress";

/**
 * A regra de bloqueio, sobre o `compaction` de um motor. Separada de `decide` para que o estado
 * "motor sem evento" — que antigravity e deep code terão, e que motor instalado nenhum tem hoje —
 * seja afirmável com um descritor de mesa, em vez de esperar o primeiro motor desse tipo entrar.
 */
export function decideFor(compaction, { trigger, blockedAt = null, saved = false, now = Date.now() } = {}) {
  const { event, block } = compaction;
  // Sem evento no motor, este eixo não existe ali — e bloquear seria decidir sobre algo que a
  // plataforma nunca anuncia.
  if (!event) return { block: false, repeated: false };

  const naJanela = blockedAt !== null && now - blockedAt >= 0 && now - blockedAt < REPEAT_WINDOW_MS;
  // Repetição exige as três coisas juntas: recusa anterior dentro da janela, pedido humano — no
  // `auto` ninguém pediu de novo — e hand-off em disco, que é dele que a frase diz estar atual.
  const repetido = trigger === MANUAL && saved && naJanela;
  // `saved` é parte da REGRA, não da borda: bloquear sem ter gravado nada não protege coisa alguma,
  // obstruiria o usuário e prometeria um arquivo que não existe.
  const bloqueia = block !== null && trigger === MANUAL && saved && !repetido;
  // DOIS campos, e não cinco. `hasEvent`, `canBlock` e `how` existiram aqui e foram retirados pelo
  // segundo gate de fechamento: nenhum tinha consumidor de produção, e o comentário de `canBlock`
  // afirmava um — a declaração ao usuário do copilot passou a ser `notice: null` no descritor mais o
  // texto do CHANGELOG. Os três estados da compactação seguem afirmáveis onde eles moram, que é o
  // `compaction` do descritor. A FORMA do bloqueio, quando a borda precisar dela (o codex bloqueia
  // por campo de saída), sai de `compaction.block`, e não de um campo derivado sem leitor.
  return { block: bloqueia, repeated: repetido };
}

/**
 * Decide o que fazer quando o motor anuncia que vai compactar.
 *
 * Bloquear só é seguro no gatilho `manual`. A documentação do Claude Code diz, textualmente, que
 * uma compactação disparada para recuperar de erro de limite de contexto, se bloqueada, faz o erro
 * subjacente aparecer e a requisição em curso falhar. No `manual` há humano esperando e nada está
 * sendo recuperado; no `auto`, pode estar.
 *
 * **Bloqueia UMA vez.** Quem insiste dentro da janela já foi avisado e já tem o estado em disco.
 */
export const decide = ({ engine, ...resto }) => decideFor(engineDescriptor(engine).compaction, resto);

// Uma feature está EM ANDAMENTO quando sobrou task por fazer **e** alguém declarou estado no plano.
// As duas condições importam. Sem a segunda, todo plano antigo que nunca usou `status:` pareceria
// interrompido para sempre — e o hook gravaria hand-off de trabalho que terminou há meses.
const RESTA_TASK = new Set(["task", "nothing-ready"]);

const emAndamento = (repo) => slugs(repo)
  .map((slug) => ({ slug, ...nextTask(repo, { slug }) }))
  .filter(({ outcome, stateDeclared }) => RESTA_TASK.has(outcome) && stateDeclared > 0);

// Desempate por `05-execution.md` mais recente. Arquivo ausente vale 0, e não o instante atual:
// feature sem log nenhum não pode ganhar de uma que está sendo escrita agora.
function tocadaEm(repo, slug) {
  try {
    return statSync(path.join(repo, "specs", slug, "05-execution.md")).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Monta o hand-off a partir do que está EM DISCO. Não escreve: quem escreve é `persist`.
 *
 * O hook não vê a conversa. Ele conhece o repositório e o payload, não o que foi decidido e ainda
 * não escrito — e é por isso que o texto sempre carrega a seção que declara essa falta. Hand-off que
 * finge completude é pior que nenhum, porque a retomada acredita nele.
 *
 * Devolve sempre a mesma forma, com `outcome` discriminando — o padrão que `plan-next` e
 * `spec-status` já usam, e que a DES-1 pede no lugar de `null` como sentinela.
 */
export function assemble(repo, { engine, trigger, changedFiles = [], now = new Date() }) {
  const candidatas = emAndamento(repo);
  if (!candidatas.length) return { outcome: NOTHING_IN_PROGRESS };

  const ordenadas = [...candidatas].sort((uma, outra) => tocadaEm(repo, outra.slug) - tocadaEm(repo, uma.slug));
  const [escolhida] = ordenadas;
  const outras = ordenadas.slice(1).map(({ slug }) => slug);

  return {
    outcome: ASSEMBLED,
    slug: escolhida.slug,
    others: outras,
    destination: path.join("specs", escolhida.slug, ".handoff.md"),
    text: texto({ repo, escolhida, outras, engine, trigger, changedFiles, now }),
  };
}

/**
 * Grava o que `assemble` montou. **Nunca sobrescreve**: hand-off que já existe foi escrito pelo
 * agente, que via a conversa, e é mais rico que qualquer coisa que o hook monte. Sobrescrever
 * perderia informação no exato momento em que ela é mais cara — então acrescenta seção datada.
 */
export function persist(repo, { destination, text }) {
  const alvo = path.join(repo, destination);
  mkdirSync(path.dirname(alvo), { recursive: true });
  if (existsSync(alvo)) {
    appendFileSync(alvo, `\n---\n\n${text}`, "utf8");
    return { file: alvo, appended: true };
  }
  writeFileSync(alvo, text, "utf8");
  return { file: alvo, appended: false };
}

/**
 * Envelope de saída do evento de compactação, montado com o que o descritor do motor declara.
 *
 * Existe porque o stdout do evento **não chega a ninguém** no claude-code — a doc lista as quatro
 * exceções em que ele vira contexto, e a de pré-compactação não está entre elas. Texto solto ali
 * faria o método parecer avisar sem avisar, que é pior que não avisar.
 *
 * Devolve `null` onde o motor não tem canal (o copilot, cujo evento a doc classifica como
 * "notification only"). `null` é "não há por onde falar", e quem chama não imprime nada: inventar
 * saída num canal que a plataforma descarta seria afirmar uma proteção inexistente (L6.5).
 */
export function notice(engine, { message = null, deny = null } = {}) {
  const { notice: envelope } = engineDescriptor(engine).compaction;
  if (!envelope || (!message && !deny)) return null;
  return envelope({ message, deny });
}

// Carimbo da última recusa, que é o que faz o bloqueio valer UMA vez. Arquivo local de máquina, ao
// lado do config. Perdê-lo só faz a próxima recusa valer de novo, que é o lado seguro de errar.
const stampPath = (coreDir) => path.join(coreDir, "precompact.json");

export function readStamp(coreDir, engine) {
  try {
    const carimbo = JSON.parse(readFileSync(stampPath(coreDir), "utf8"));
    // Carimbo de OUTRO motor não é insistência deste. O arquivo é do projeto, e um projeto pode ter
    // dois motores instalados — sem o dono, a recusa de um viraria "você pediu de novo" no outro.
    return carimbo.engine === engine ? carimbo.blockedAt ?? null : null;
  } catch {
    return null;
  }
}

export function writeStamp(coreDir, { engine, now = Date.now() } = {}) {
  try {
    mkdirSync(coreDir, { recursive: true });
    writeFileSync(stampPath(coreDir), `${JSON.stringify({ blockedAt: now, engine })}\n`, "utf8");
    return true;
  } catch {
    // Sem carimbo, a próxima recusa vale de novo. Melhor do que derrubar o hook por causa disto.
    return false;
  }
}

const linhaDaTask = (escolhida) => (escolhida.task
  ? `**Próxima task:** \`${escolhida.task.id}\` — ${escolhida.task.artifact || "sem artefato declarado"}`
  : "**Próxima task:** nenhuma está pronta; as pendentes esperam dependência.");

// O gatilho vem do payload do motor. Ausente ou fora dos dois valores documentados, diz-se
// DESCONHECIDO em palavra — inventar um nome plausível é o que a RN-2 proíbe.
const nomeDoGatilho = (trigger) =>
  ([MANUAL, AUTO].includes(trigger) ? `\`${trigger}\`` : "desconhecido (o motor não o informou)");

// Quem pediu muda a frase: no `manual` houve intenção humana, e tratá-la como acidente contraria a
// UC-2 do PRD.
const abertura = (engine, trigger) => (trigger === MANUAL
  ? `Gravado pelo hook de pré-compactação do \`${engine}\`. **Você pediu a compactação**, e o método`
    + " pôs o estado em disco antes de ela acontecer."
  : `Gravado pelo hook de pré-compactação do \`${engine}\`, gatilho ${nomeDoGatilho(trigger)}.`
    + " **Não foi pedido por ninguém**: o motor anunciou que ia compactar, e o método pôs o estado em"
    + " disco antes.");

function texto({ repo, escolhida, outras, engine, trigger, changedFiles, now }) {
  const estado = statusFor(repo, { slug: escolhida.slug });
  const blocos = [
    `## Hand-off automático — compactação de contexto em ${now.toISOString()}`,
    "",
    abertura(engine, trigger),
    "",
    `**Feature:** \`${escolhida.slug}\` · plano em \`${escolhida.file}\``,
    `**Tasks:** ${escolhida.taskCount} no total, ${escolhida.doneCount} com \`status: done\` declarado.`,
    linhaDaTask(escolhida),
  ];
  if (estado.found) {
    blocos.push(`**Artefatos em disco:** ${estado.artifacts.map(marca).join(" ")}`);
  }
  if (outras.length) {
    blocos.push("",
      `**Havia mais de uma feature em andamento:** ${outras.map((slug) => `\`${slug}\``).join(", ")}.`
      + " Esta foi escolhida por ter o `05-execution.md` modificado mais recentemente — é desempate,"
      + " não certeza.");
  }
  if (changedFiles.length) {
    blocos.push("", "**Modificados e não commitados:**", ...changedFiles.map((arquivo) => `- \`${arquivo}\``));
  }
  blocos.push("", ...oQueNaoSeSabe());
  return `${blocos.join("\n")}\n`;
}

const marca = (artefato) => (artefato.status === "present" ? artefato.id : `-${artefato.id}`);

// Sempre presente, sem exceção. É a diferença entre um hand-off honesto e um que engana a retomada.
const oQueNaoSeSabe = () => [
  "### O que este hand-off NÃO sabe",
  "",
  "Ele foi montado por um hook, que **não vê a conversa**. O que foi decidido falando e ainda não",
  "chegou ao disco **não está aqui** — nem a razão de decisões tomadas nesta sessão, nem o que estava",
  "a meio caminho de ser escrito.",
  "",
  "**Sugestão:** abrir uma sessão nova e retomar por este arquivo, em vez de seguir numa janela já",
  "compactada. Se algo importante foi decidido e não está escrito, escreva antes de continuar.",
];
