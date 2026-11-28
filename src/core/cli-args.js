import { INHERIT } from "./catalog.js";
import { EFFORT_LEVELS } from "../plugin.js";

// Niveis que uma flag de esforco aceita: os do pacote mais o "herda". Fonte unica da CLI e das perguntas.
export const effortFlagLevels = Object.freeze([...EFFORT_LEVELS, INHERIT]);

// As flags que a CLI conhece: grafias, a chave em `flags` e se a flag leva valor. Fonte única do parser e
// da tabela de flags por comando (ADR-0040). `--engine` acumula: `split(",")`, e `both` vira todos os motores.
export const FLAGS = Object.freeze([
  { tokens: ["-y", "--yes"], key: "yes", value: false },
  { tokens: ["--dry-run"], key: "dryRun", value: false },
  { tokens: ["--engine"], key: "engines", value: true },
  { tokens: ["--scope"], key: "scope", value: true },
  { tokens: ["--skills-dir"], key: "skillsDir", value: true },
  { tokens: ["--language"], key: "language", value: true },
  { tokens: ["--user-language"], key: "userLanguage", value: true },
  { tokens: ["--arch"], key: "arch", value: true },
  { tokens: ["--project-id"], key: "projectId", value: true },
  { tokens: ["--all-skills"], key: "allSkills", value: false },
  { tokens: ["--trusted"], key: "trusted", value: false },
  { tokens: ["--hook"], key: "hook", value: true },
  { tokens: ["--no-hooks"], key: "noHooks", value: false },
  { tokens: ["--strict"], key: "strict", value: false },
  { tokens: ["--all"], key: "all", value: false },
  { tokens: ["--archived"], key: "archived", value: false },
  { tokens: ["--date"], key: "date", value: true },
  { tokens: ["--base"], key: "base", value: true },
  { tokens: ["--reviewer"], key: "reviewer", value: true },
  { tokens: ["--reason"], key: "reason", value: true },
  { tokens: ["--json"], key: "json", value: false },
  { tokens: ["--out"], key: "out", value: true },
  { tokens: ["--model"], key: "model", value: true },
  { tokens: ["--effort"], key: "effort", value: true },
  { tokens: ["--effort-drafting"], key: "effortDrafting", value: true },
  { tokens: ["--effort-execution"], key: "effortExecution", value: true },
  { tokens: ["--effort-review"], key: "effortReview", value: true },
  { tokens: ["--model-drafting"], key: "modelDrafting", value: true },
  { tokens: ["--model-execution"], key: "modelExecution", value: true },
  { tokens: ["--model-review"], key: "modelReview", value: true },
  { tokens: ["--origin"], key: "origin", value: true },
].map((flag) => Object.freeze({ ...flag, tokens: Object.freeze([...flag.tokens]) })));

const FLAG_BY_TOKEN = new Map(FLAGS.flatMap((flag) => flag.tokens.map((token) => [token, flag])));

// Leitura pura dos argumentos da CLI. Não toca em process, console nem saída: a borda decide o
// que fazer com a flag desconhecida devolvida em `unknownFlag`, com a primeira flag de valor que chegou sem
// valor em `missingValue` (fim da linha, ou o token seguinte começa com `--` ou é uma flag conhecida: ele não
// é consumido como valor; `- texto` é valor) e com as
// grafias reconhecidas em `seen`, na ordem da linha de comando.
export function parseArgs(argv, { engines }) {
  const flags = { engines: [] };
  const positional = [];
  const seen = [];
  let unknownFlag = null;
  let missingValue = null;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const flag = FLAG_BY_TOKEN.get(token);
    if (flag) {
      seen.push(token);
      if (!flag.value) { flags[flag.key] = true; continue; }
      const valor = argv[i + 1];
      if (valor === undefined || valor.startsWith("--") || FLAG_BY_TOKEN.has(valor)) {
        // Sem valor: anota a primeira e segue lendo, para uma flag desconhecida adiante ainda vencer (RN-7).
        // A chave fica com `undefined`, como antes; a borda recusa antes de qualquer consumidor lê-la.
        if (missingValue === null) missingValue = token;
        if (flag.key !== "engines") flags[flag.key] = undefined;
        continue;
      }
      i += 1;
      if (flag.key === "engines") flags.engines.push(...valor.split(","));
      else flags[flag.key] = valor;
    } else if (token.startsWith("-")) { unknownFlag = token; break; }
    else positional.push(token);
  }
  // compat: --engine both = todos os motores recebidos
  flags.engines = flags.engines.flatMap((e) => (e === "both" ? engines : [e]));
  return { flags, positional, unknownFlag, missingValue, seen };
}

// Flags que todo comando das duas CLIs aceita: a borda lê `--user-language` para resolver o idioma.
export const GLOBAL_FLAGS = Object.freeze(["userLanguage"]);

const INSTALL_READS = [
  "engines", "scope", "skillsDir", "language", "arch", "projectId", "allSkills", "noHooks", "origin",
  "modelDrafting", "modelExecution", "modelReview", "effortDrafting", "effortExecution", "effortReview",
  "dryRun", "yes",
];

// O que cada entrada aceita (ADR-0040). `reads`: lida com efeito. `refuses`: lida só para recusar com
// mensagem própria, e por isso nunca aparece como "aceita por". `hookMode`: com `--hook` vale o contrato
// do hook. `requiresHook`: sem `--hook` a entrada não existe (o `detect` do runtime recusa por conta própria). Cada linha vem do `arquivo:linha` registrado na spec da fatia flag-nao-usada-pelo-comando.
function entry(reads, extra = {}) {
  return Object.freeze({
    reads: Object.freeze(reads),
    refuses: Object.freeze(extra.refuses ?? []),
    hookMode: extra.hookMode === true,
    requiresHook: extra.requiresHook === true,
  });
}

const SHARED_COMMANDS = {
  precompact: entry(["hook"], { hookMode: true }),
  doctor: entry(["json"]),
  "sdd-check": entry(["json"]),
  "spec validate": entry(["all", "strict", "json"]),
  "spec next": entry(["json"], { refuses: ["all"] }),
  "spec status": entry(["all", "archived", "json"]),
  "spec archive": entry(["date"], { refuses: ["all"] }),
  "spec initials": entry(["json"]),
  "spec initials set": entry([]),
  agents: entry(["json"]),
  "agents set": entry(["model", "effort", "engines"]),
  "agents apply": entry([]),
  origin: entry(["json"]),
  "origin set": entry([]),
  "review status": entry(["json"]),
  "review external": entry(["base", "reviewer"], { refuses: ["all"] }),
  version: entry([]),
  help: entry([]),
};

export const PACKAGE_COMMANDS = Object.freeze({
  install: entry(INSTALL_READS, { refuses: ["model", "effort"] }),
  update: entry(["scope", "projectId", "yes"]),
  uninstall: entry(["scope", "yes"]),
  status: entry([]),
  list: entry([]),
  validate: entry([]),
  build: entry(["out"]),
  audit: entry(["json"]),
  tokens: entry(["json"]),
  add: entry(["scope", "engines"]),
  remove: entry(["scope"]),
  "registry add": entry(["scope", "trusted"]),
  "registry remove": entry(["scope"]),
  "registry list": entry(["scope"]),
  detect: entry(["hook"], { hookMode: true }),
  ...SHARED_COMMANDS,
  "runtime-versioning": entry(["json"]),
  "runtime-versioning set": entry([]),
  "review enable": entry(["reviewer"]),
  "review disable": entry([]),
  "review consent": entry(["reviewer"]),
  "review revoke": entry(["reviewer"]),
  "review set": entry(["model", "effort", "reviewer"]),
  "review waive": entry(["reason"], { refuses: ["all"] }),
});

export const RUNTIME_COMMANDS = Object.freeze({
  detect: entry(["hook"], { hookMode: true, requiresHook: true }),
  ...SHARED_COMMANDS,
  instructions: entry(["json"]),
  "instructions write": entry(["engines"]),
});

const ALIASES = Object.freeze({ "--version": "version", "-v": "version", "--help": "help", "-h": "help" });
const SPEC_SUBS = Object.freeze(["validate", "next", "status", "archive"]);
const SET_ONLY = Object.freeze(["origin", "runtime-versioning"]);

// O nome da entrada pelo comando e pelos posicionais, sem olhar o disco (DT-4). Sem entrada, a borda
// segue como hoje: a mensagem do próprio comando (desconhecido, ciclo de vida, subcomando inválido) vale.
const NONE = Object.freeze({ state: "none" });
const named = (name) => ({ state: "entry", name });

// Verbo opcional: sem posicional é a leitura (`command`); com o verbo, `command verbo`; outro, sem entrada.
function withOptionalVerb(command, sub, verb) {
  if (sub === undefined) return named(command);
  return sub === verb ? named(`${command} ${verb}`) : NONE;
}

function candidate(command, positional) {
  const sub = positional[0];
  if (command === undefined) return named("help");
  if (Object.hasOwn(ALIASES, command)) return named(ALIASES[command]);
  if (command === "spec") {
    if (SPEC_SUBS.includes(sub)) return named(`spec ${sub}`);
    return sub === "initials" ? withOptionalVerb("spec initials", positional[1], "set") : NONE;
  }
  if (command === "agents") return named(sub === "set" || sub === "apply" ? `agents ${sub}` : "agents");
  if (SET_ONLY.includes(command)) return withOptionalVerb(command, sub, "set");
  if (command === "instructions") return withOptionalVerb(command, sub, "write");
  if (command === "review" || command === "registry") return sub === undefined ? NONE : named(`${command} ${sub}`);
  // Nome composto só sai de argumentos separados: `"origin set"` num argumento só é comando desconhecido.
  return command.includes(" ") ? NONE : named(command);
}

export function resolveEntry(commands, command, positional, seen = []) {
  const found = candidate(command, positional);
  if (found.state === "none" || !Object.hasOwn(commands, found.name)) return NONE;
  if (commands[found.name].requiresHook && !seen.includes("--hook")) return NONE;
  return found;
}

function acceptedByOf(commands, key) {
  return Object.keys(commands).filter((name) => commands[name].reads.includes(key));
}

// Seguir ou recusar (ADR-0040). `fallback` é a tabela do pacote, usada pelo runtime quando nenhuma
// entrada dele aceita a flag: aí a mensagem aponta os comandos de ciclo de vida (`lifecycle: true`).
export function checkFlags({ commands, fallback = null, command, positional, seen }) {
  const resolved = resolveEntry(commands, command, positional, seen);
  if (resolved.state === "none") return { ok: true };
  const current = commands[resolved.name];
  if (current.hookMode && seen.includes("--hook")) return { ok: true };
  for (const token of seen) {
    const { key } = FLAG_BY_TOKEN.get(token);
    if (GLOBAL_FLAGS.includes(key) || current.reads.includes(key) || current.refuses.includes(key)) continue;
    const local = acceptedByOf(commands, key);
    if (local.length > 0 || fallback === null) {
      return { ok: false, flag: token, entry: resolved.name, acceptedBy: local, lifecycle: false };
    }
    return { ok: false, flag: token, entry: resolved.name, acceptedBy: acceptedByOf(fallback, key), lifecycle: true };
  }
  return { ok: true };
}

// Intenção de cada flag de modelo do install (DT-8). Intenção sem flag não entra em `models`.
const MODEL_FLAG_INTENTS = [
  ["modelDrafting", "drafting"],
  ["modelExecution", "execution"],
  ["modelReview", "review"],
];

// Função pura: `supportsModel(engine) → boolean` é injetado, sem import de descritor (o arquivo
// está no fecho do runtime). Valor solto (sem `=`) vale só com um único motor escolhido que
// sustenta `model` (D-12); a forma `motor=id[,motor=id]` vale sempre.
export function resolveModelFlags(flags, { engines, supportsModel }) {
  const models = {};
  const capazes = engines.filter(supportsModel);
  for (const [flagName, intent] of MODEL_FLAG_INTENTS) {
    const value = flags[flagName];
    if (value === undefined) continue;
    if (capazes.length === 0) return { ok: false, reason: "no-model-engine", intent };
    if (!value.includes("=")) {
      if (capazes.length >= 2) return { ok: false, reason: "bare-value-many-engines", intent };
      if (value === "" || value.includes(",")) {
        return { ok: false, reason: "malformed", intent, value };
      }
      models[intent] = { [capazes[0]]: value };
      continue;
    }
    const porMotor = {};
    for (const par of value.split(",")) {
      const corte = par.indexOf("=");
      const motor = par.slice(0, corte);
      const id = par.slice(corte + 1);
      if (corte <= 0 || id === "") return { ok: false, reason: "malformed", intent, value };
      if (!engines.includes(motor)) return { ok: false, reason: "engine-not-chosen", intent, engine: motor };
      // O motor citado é o culpado: a mensagem nomeia só ele, para não dizer que os outros não aceitam modelo.
      if (!supportsModel(motor)) return { ok: false, reason: "no-model-engine", intent, engine: motor };
      porMotor[motor] = id;
    }
    models[intent] = porMotor;
  }
  return { ok: true, models };
}

// Intenção de cada flag de esforço do install (DT-2), na mesma ordem das flags de modelo.
const EFFORT_FLAG_INTENTS = [
  ["effortDrafting", "drafting"],
  ["effortExecution", "execution"],
  ["effortReview", "review"],
];

// Função pura, sem motor: roda antes das perguntas. A presença é a da chave (`Object.hasOwn`), e não o
// valor: a flag sem valor no fim da linha cria a chave com `undefined` e tem de ser recusada, não ignorada.
export function checkEffortFlags(flags, { levels }) {
  if (Object.hasOwn(flags, "effort")) return { ok: false, reason: "bare-effort" };
  const efforts = {};
  for (const [flagName, intent] of EFFORT_FLAG_INTENTS) {
    if (!Object.hasOwn(flags, flagName)) continue;
    const value = flags[flagName];
    if (!levels.includes(value)) {
      const raw = value === undefined ? "" : value;
      return { ok: false, reason: "invalid-level", intent, value: raw };
    }
    efforts[intent] = value;
  }
  return { ok: true, efforts };
}

// Autoritativa: repete checkEffortFlags e exige um motor escolhido que sustente esforço. Só a intenção
// declarada entra na recusa, e a primeira na ordem de EFFORT_FLAG_INTENTS é a que aparece.
export function resolveEffortFlags(flags, { engines, supportsEffort, levels }) {
  const checked = checkEffortFlags(flags, { levels });
  if (!checked.ok) return checked;
  const intent = EFFORT_FLAG_INTENTS.find(([, name]) => Object.hasOwn(checked.efforts, name))?.[1];
  if (intent !== undefined && engines.filter(supportsEffort).length === 0) {
    return { ok: false, reason: "no-effort-engine", intent };
  }
  return { ok: true, efforts: checked.efforts };
}

// Flag vence a pergunta (RN-4): a intenção declarada por flag substitui a respondida no terminal.
export function mergeEfforts(answered, declared) {
  return { ...answered, ...declared };
}

// `--model` é do `agents set`; no install ele seria ignorado em silêncio (DT-10). Presença por chave.
export function checkBareModelFlag(flags) {
  return Object.hasOwn(flags, "model") ? { ok: false, reason: "bare-model" } : { ok: true };
}
