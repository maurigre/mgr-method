// Coleta interativa das respostas do `install`.
// O adaptador de prompts (`ask`) é INJETADO — o CLI passa o do @clack, os testes passam um
// stub. Assim a lógica das perguntas fica testável sem TTY, e o bin/ fica só com a cola.
import path from "node:path";
import * as catalog from "./catalog.js";
import * as engines from "./engines/index.js";
import { CONFIGURED } from "./registry.js";
import { getMessages } from "./messages.js";

export const CANCELLED = Symbol("cancelled");

// Escolhas das perguntas de modelo e origem. `skip` é o default de todas (ADR-0017): nada é
// gravado sem resposta explícita.
const OTHER_CHOICE = "other";
const SKIP_CHOICE = "skip";

function defaultEngineDescriptors() {
  return Object.fromEntries(engines.ids().map((id) => [id, engines.get(id)]));
}

// Sugere o idioma do usuário a partir do locale do ambiente (LC_ALL > LC_MESSAGES > LANG).
// `xx_YY.enc` vira `xx-YY`; ausente, `C` ou `POSIX` viram "en". Recebe o env por parâmetro
// (o núcleo não lê ambiente global; a borda passa process.env).
export function detectUserLanguage(env = {}) {
  const raw = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  const base = raw.split(/[.@]/)[0].trim();
  if (!base || base === "C" || base === "POSIX") return "en";
  return base.replaceAll("_", "-");
}

// ask: { multiselect, select, confirm, text, isCancel }
// current: valores já vindos das flags (não perguntamos o que já foi informado)
// msg: tabela de mensagens (getMessages) — injetada pela borda, como o ask
// engineDescriptors: { [id]: descritor } — `documentedModels` e `capabilities` (default: src/engines)
// configured: `readAgents(core).sources` — modelo já `configured` não é perguntado
// originRecorded: a origem já está no config — não é perguntada
// enabledIntents: intenções LIGADAS (DT-7); desligada não é perguntada (default: todas)
// flagModels: `{ [intent]: { [engine]: id } }` já dado por flag — não é perguntado
// Devolve `models: { [intent]: { [engine]: id } }` (só o que foi respondido) e `origin`
// ("greenfield" | "brownfield" | null, null quando pulada).
export async function collectInstallAnswers(ask, current = {}, {
  repo = ".",
  allSkills = false,
  env = {},
  msg = getMessages("en"),
  engineDescriptors = defaultEngineDescriptors(),
  configured = {},
  originRecorded = false,
  enabledIntents = catalog.INTENTS,
  flagModels: flagModelsOption = {},
  contextFor = null,
} = {}) {
  let flagModels = flagModelsOption;
  const out = {
    engines: current.engines?.length ? current.engines : [],
    scope: current.scope || null,
    language: current.language || null,
    architecture: current.architecture || null,
    userLanguage: current.userLanguage || null,
    projectId: current.projectId || null,
    optional: [],
    models: {},
    origin: null,
  };

  if (!out.engines.length) {
    const sel = await ask.multiselect({
      message: msg.qEngines,
      options: [
        { value: "claude-code", label: "Claude Code", hint: ".claude/skills" },
        { value: "copilot", label: "GitHub Copilot", hint: ".github/skills" },
      ],
      initialValues: ["claude-code"],
      required: true,
    });
    if (ask.isCancel(sel)) return CANCELLED;
    out.engines = sel;
  }

  if (!out.scope) {
    const s = await ask.select({
      message: msg.qScope,
      options: [
        { value: "project", label: "project", hint: msg.scopeProjectHint },
        { value: "global", label: "global", hint: msg.scopeGlobalHint },
      ],
    });
    if (ask.isCancel(s)) return CANCELLED;
    out.scope = s;
  }

  if (!allSkills && !out.architecture) {
    const a = await ask.select({
      message: msg.qArchitecture,
      options: catalog.architectures().map((k) => ({ value: k, label: k })),
      initialValue: "hexagonal",
    });
    if (ask.isCancel(a)) return CANCELLED;
    out.architecture = a;
  }

  if (!allSkills && !out.language) {
    const l = await ask.select({
      message: msg.qLanguage,
      options: [
        ...catalog.languages().map((k) => ({ value: k, label: k })),
        { value: "outra", label: msg.langOtherLabel, hint: msg.langOtherHint },
      ],
      initialValue: catalog.languages()[0],
    });
    if (ask.isCancel(l)) return CANCELLED;
    out.language = l === "outra" ? null : l;
  }

  // Idioma da EXPERIÊNCIA (conversa e artefatos das skills) — não é a linguagem de
  // programação acima. Perguntado mesmo com --all-skills: é sobre o usuário, não sobre
  // o conjunto de skills.
  if (!out.userLanguage) {
    const detected = detectUserLanguage(env);
    const initial = detected.startsWith("en") ? "en" : detected.startsWith("pt") ? "pt-BR" : "outro";
    const ul = await ask.select({
      message: msg.qOutputLanguage,
      options: [
        { value: "en", label: "en", hint: msg.outEnHint },
        { value: "pt-BR", label: "pt-BR", hint: msg.outPtHint },
        { value: "outro", label: msg.outOtherLabel, hint: msg.outOtherHint },
      ],
      initialValue: initial,
    });
    if (ask.isCancel(ul)) return CANCELLED;
    if (ul === "outro") {
      const t = await ask.text({
        message: msg.qWhichLanguage,
        initialValue: detected,
        placeholder: detected,
      });
      if (ask.isCancel(t)) return CANCELLED;
      out.userLanguage = (t || detected).trim();
    } else {
      out.userLanguage = ul;
    }
  }

  if (!allSkills) {
    const ev = await ask.confirm({
      message: msg.qOptionalEvidence,
      initialValue: false,
    });
    if (ask.isCancel(ev)) return CANCELLED;
    if (ev) out.optional.push("evidence-capture");
  }

  if (!out.projectId) {
    const base = path.basename(path.resolve(repo));
    const pid = await ask.text({
      message: msg.qProjectId,
      initialValue: base,
      placeholder: base,
    });
    if (ask.isCancel(pid)) return CANCELLED;
    out.projectId = (pid || base).trim();
  }

  // Motores e escopo já são conhecidos aqui (respondidos ou vindos de flag): só agora o contexto das
  // perguntas de modelo e origem pode ser lido sem adivinhar (E-9).
  if (contextFor) {
    ({ flagModels = {}, configured = {}, enabledIntents = catalog.INTENTS, originRecorded = false } =
      contextFor(out.engines, out.scope));
  }

  for (const engine of out.engines) {
    const descriptor = engineDescriptors[engine];
    if (!descriptor?.capabilities?.agentModel) continue;
    for (const intent of catalog.INTENTS) {
      if (!enabledIntents.includes(intent)) continue;
      if (flagModels[intent]?.[engine]) continue;
      if (configured[intent]?.model?.[engine] === CONFIGURED) continue;
      const choice = await ask.select({
        message: msg.qModel(intent, engine),
        options: [
          ...descriptor.documentedModels.map((modelo) => ({ value: modelo, label: modelo })),
          { value: OTHER_CHOICE, label: msg.modelOtherLabel },
          { value: SKIP_CHOICE, label: msg.modelSkipLabel },
        ],
        initialValue: SKIP_CHOICE,
      });
      if (ask.isCancel(choice)) return CANCELLED;
      if (choice === SKIP_CHOICE) continue;
      let id = choice;
      if (choice === OTHER_CHOICE) {
        const typed = await ask.text({ message: msg.qModelIdentifier(intent, engine) });
        if (ask.isCancel(typed)) return CANCELLED;
        id = (typed || "").trim();
      }
      if (id) out.models[intent] = { ...out.models[intent], [engine]: id };
    }
  }

  if (!originRecorded) {
    const origin = await ask.select({
      message: msg.qOrigin,
      options: [
        { value: "greenfield", label: msg.originGreenfieldOption },
        { value: "brownfield", label: msg.originBrownfieldOption },
        { value: SKIP_CHOICE, label: msg.originSkipOption },
      ],
      initialValue: SKIP_CHOICE,
    });
    if (ask.isCancel(origin)) return CANCELLED;
    out.origin = origin === SKIP_CHOICE ? null : origin;
  }

  return out;
}

// Consentimento para remover o que o plano deixa de declarar. O `ask` e INJETADO, como em
// `collectInstallAnswers`: a borda passa o do @clack, o teste passa um stub e roda sem TTY.
//
// Os tres modos sao uma UNIAO DISCRIMINADA e nao um booleano: sem terminal e sem `-y` nao ha como
// perguntar, e ausencia de pergunta possivel nunca pode virar "sim". A borda resolve o modo UMA vez
// e passa adiante — nenhum teste de terminal novo entra no fluxo.
export const REMOVAL_ASK = "ask";
export const REMOVAL_ASSUMED = "assumed";
export const REMOVAL_NO_CONSENT = "no-consent";

export const REMOVE = "remove";
export const KEEP = "keep";

export function removalMode({ isTTY = false, yes = false } = {}) {
  if (yes) return REMOVAL_ASSUMED;
  return isTTY ? REMOVAL_ASK : REMOVAL_NO_CONSENT;
}

// Qual das quatro saidas o comando deve imprimir. E funcao PURA, e por isso existe: na borda, a
// escolha da mensagem so era alcancavel COM terminal, e nenhum teste tem terminal — a linha do
// "ficou por escolha" passava sem guarda nenhuma (achado E-4 do gate isolado de 2026-09-25).
export const OUTCOME_REMOVED = "removed";
export const OUTCOME_KEPT_BY_CHOICE = "kept-by-choice";
export const OUTCOME_KEPT_NO_CONSENT = "kept-no-consent";
export const OUTCOME_NOTHING = "nothing";

export function removalOutcome({ removed = [], abandoned = [], mode = REMOVAL_NO_CONSENT } = {}) {
  if (removed.length) return OUTCOME_REMOVED;
  if (!abandoned.length) return OUTCOME_NOTHING;
  return mode === REMOVAL_NO_CONSENT ? OUTCOME_KEPT_NO_CONSENT : OUTCOME_KEPT_BY_CHOICE;
}

export const GITIGNORE_WRITE = "write";
export const GITIGNORE_DECLINE = "decline";

// Consentimento do bloco no `.gitignore` (DT-4). Mesmo modo de `removalMode`, com outro default: o bloco
// so ACRESCENTA linhas, entao `initialValue: true`. Sem terminal e sem `-y` nao ha como perguntar: o
// arquivo nao muda (`decline`).
export async function consentToGitignore(ask, { mode = REMOVAL_NO_CONSENT, msg = getMessages("en") } = {}) {
  if (mode === REMOVAL_ASSUMED) return GITIGNORE_WRITE;
  if (mode !== REMOVAL_ASK) return GITIGNORE_DECLINE;
  const ok = await ask.confirm({ message: msg.qGitignoreBlock, initialValue: true });
  if (ask.isCancel(ok)) return CANCELLED;
  return ok ? GITIGNORE_WRITE : GITIGNORE_DECLINE;
}

export async function consentToRemove(ask, abandoned = [], { mode = REMOVAL_NO_CONSENT, msg = getMessages("en") } = {}) {
  if (!abandoned.length) return KEEP;
  if (mode === REMOVAL_ASSUMED) return REMOVE;
  if (mode !== REMOVAL_ASK) return KEEP;
  // `initialValue: false`: o default e a opcao que nao desfaz nada.
  const ok = await ask.confirm({ message: msg.confirmRemoval(abandoned.length), initialValue: false });
  if (ask.isCancel(ok)) return CANCELLED;
  return ok ? REMOVE : KEEP;
}

// Consentimento item a item (DT-11, passo 4; DT-13). `items` são caminhos RELATIVOS, como chegam do
// chamador, e `msg.confirmRemoveOne(rel)` recebe cada um. No modo `ask` pergunta UM `confirm` por item,
// na ordem, com default "não": na dúvida, nada é removido. `assumed` (-y) manda todos para `remove`;
// `no-consent` manda todos para `keep` sem perguntar. Cancelar em qualquer pergunta devolve `CANCELLED`.
// `messageOf(item)` (opcional) escolhe a pergunta de cada item, para itens de natureza diferente
// (remover x substituir); o default e `msg.confirmRemoveOne(item)`.
export async function consentEach(ask, items, { mode = REMOVAL_NO_CONSENT, msg = getMessages("en"), messageOf = (rel) => msg.confirmRemoveOne(rel) } = {}) {
  if (mode === REMOVAL_ASSUMED) return { remove: [...items], keep: [] };
  if (mode !== REMOVAL_ASK) return { remove: [], keep: [...items] };
  const remove = [];
  const keep = [];
  for (const rel of items) {
    const ok = await ask.confirm({ message: messageOf(rel), initialValue: false });
    if (ask.isCancel(ok)) return CANCELLED;
    (ok ? remove : keep).push(rel);
  }
  return { remove, keep };
}

// Saída do `update` (DT-13). Função PURA: sem IO e sem console. `divergent` lista o que ficou mantido,
// na ordem abandonadas → órfãs → sem fonte. Aceita item como string ou objeto com `name`; o nome do
// objeto é o que sai em `divergent`. `outOfReach` não entra: pasta fora de alcance não é divergência.
const nameOf = (item) => (typeof item === "string" ? item : item.name);

export function updateOutcome({ keptAbandoned = [], keptOrphans = [], keptNoSource = [], keptEntering = [] } = {}) {
  const divergent = [...keptAbandoned, ...keptOrphans, ...keptNoSource, ...keptEntering].map(nameOf);
  return { exit: divergent.length ? 1 : 0, divergent };
}
