// Leitura pura dos argumentos da CLI. Não toca em process, console nem saída: a borda decide o
// que fazer com a flag desconhecida devolvida em `unknownFlag`.
export function parseArgs(argv, { engines }) {
  const flags = { engines: [] };
  const positional = [];
  let unknownFlag = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-y" || a === "--yes") flags.yes = true;
    else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--engine") flags.engines.push(...argv[++i].split(","));
    else if (a === "--scope") flags.scope = argv[++i];
    else if (a === "--skills-dir") flags.skillsDir = argv[++i];
    else if (a === "--language") flags.language = argv[++i];
    else if (a === "--user-language") flags.userLanguage = argv[++i];
    else if (a === "--arch") flags.arch = argv[++i];
    else if (a === "--project-id") flags.projectId = argv[++i];
    else if (a === "--all-skills") flags.allSkills = true;
    else if (a === "--trusted") flags.trusted = true;
    else if (a === "--hook") flags.hook = argv[++i];
    else if (a === "--no-hooks") flags.noHooks = true;
    else if (a === "--strict") flags.strict = true;
    else if (a === "--all") flags.all = true;
    else if (a === "--json") flags.json = true;
    else if (a === "--out") flags.out = argv[++i];
    else if (a === "--model") flags.model = argv[++i];
    else if (a === "--effort") flags.effort = argv[++i];
    else if (a === "--effort-drafting") flags.effortDrafting = argv[++i];
    else if (a === "--effort-execution") flags.effortExecution = argv[++i];
    else if (a === "--effort-review") flags.effortReview = argv[++i];
    else if (a === "--model-drafting") flags.modelDrafting = argv[++i];
    else if (a === "--model-execution") flags.modelExecution = argv[++i];
    else if (a === "--model-review") flags.modelReview = argv[++i];
    else if (a === "--origin") flags.origin = argv[++i];
    else if (a.startsWith("-")) { unknownFlag = a; break; }
    else positional.push(a);
  }
  // compat: --engine both = todos os motores recebidos
  flags.engines = flags.engines.flatMap((e) => (e === "both" ? engines : [e]));
  return { flags, positional, unknownFlag };
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
