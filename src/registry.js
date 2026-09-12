// Registries de skills plugáveis (ADR-0005): config em `.mgr-core/config.json` (lista
// `registries[]` {name, url, trusted}) + fetch/validação do index e resolução de skill.
// O config é arquivo próprio — o manifest.json continua sendo só estado de instalação.
// O fetch é INJETADO (mesmo padrão do adaptador de prompts): o núcleo não abre rede em
// teste; a borda passa o fetch global.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EFFORT_LEVELS, parseSkillName } from "./plugin.js";
import { AGENTS, INHERIT, INTENTS, LAWS_SHARED } from "./catalog.js";
import * as engines from "./engines/index.js";

export const CONFIG_NAME = "config.json";

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CHECKSUM_RE = /^sha256-[0-9a-f]{64}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export const configPath = (coreDir) => path.join(coreDir, CONFIG_NAME);

export function readConfig(coreDir) {
  const file = configPath(coreDir);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { registries: [] };
}

export function writeConfig(coreDir, config) {
  mkdirSync(coreDir, { recursive: true });
  const dest = configPath(coreDir);
  writeFileSync(dest, JSON.stringify(config, null, 2) + "\n", "utf8");
  return dest;
}

export function listRegistries(coreDir) {
  return readConfig(coreDir).registries;
}

export function addRegistry(coreDir, { name, url, trusted = false }) {
  if (!KEBAB_RE.test(name || "")) {
    throw new Error(`invalid registry name: ${JSON.stringify(name)} (kebab-case, it is the "@name" scope of the skills)`);
  }
  if (!/^https?:\/\//.test(url || "")) {
    throw new Error(`invalid registry url: ${JSON.stringify(url)} (expected the http(s) URL of the registry index.json)`);
  }
  const config = readConfig(coreDir);
  if (config.registries.some((registry) => registry.name === name)) {
    throw new Error(`registry already configured: ${name} (remove it first to change the URL)`);
  }
  config.registries.push({ name, url, trusted });
  writeConfig(coreDir, config);
  return config.registries;
}

export function removeRegistry(coreDir, name) {
  const config = readConfig(coreDir);
  const remaining = config.registries.filter((registry) => registry.name !== name);
  if (remaining.length === config.registries.length) {
    throw new Error(`registry not configured: ${name}`);
  }
  writeConfig(coreDir, { ...config, registries: remaining });
  return remaining;
}

// Valida a forma do index (gerado pelo registry a partir dos manifests — ADR-0005).
// Devolve lista de problemas, vazia = válido (mesmo contrato do validateManifest).
export function validateIndex(index) {
  if (!index || typeof index !== "object" || Array.isArray(index)) return ["index must be a JSON object"];
  const problems = [];
  if (index.indexVersion !== 1) problems.push(`unsupported "indexVersion": ${JSON.stringify(index.indexVersion)} (expected 1)`);
  if (typeof index.registry !== "string" || index.registry === "") problems.push('"registry" must be a non-empty string');
  if (!index.categories || typeof index.categories !== "object" || Array.isArray(index.categories)) {
    problems.push('"categories" must be an object mapping category to skill entries');
    return problems;
  }
  for (const [category, entries] of Object.entries(index.categories)) {
    if (!Array.isArray(entries)) { problems.push(`category "${category}" must be an array`); continue; }
    for (const entry of entries) {
      const id = entry?.name ?? `<entry in ${category}>`;
      try { parseSkillName(entry?.name); } catch { problems.push(`${id}: invalid "name"`); }
      if (typeof entry?.version !== "string") problems.push(`${id}: missing "version"`);
      if (typeof entry?.description !== "string") problems.push(`${id}: missing "description"`);
      if (!CHECKSUM_RE.test(entry?.checksum || "")) problems.push(`${id}: "checksum" must be "sha256-<hex>"`);
      const files = entry?.files;
      const validFiles = Array.isArray(files) && files.length > 0 && files.every(
        (file) => typeof file?.path === "string" && /^https?:\/\//.test(file?.url || "") && SHA256_RE.test(file?.sha256 || ""),
      );
      if (!validFiles) problems.push(`${id}: "files" must be a non-empty array of {path, url, sha256}`);
    }
  }
  return problems;
}

// Baixa e valida o index de um registry. `fetchImpl` injetado pela borda.
export async function fetchIndex(url, { fetchImpl }) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`registry index unavailable: ${url} (HTTP ${response.status})`);
  }
  let index;
  try {
    index = await response.json();
  } catch {
    throw new Error(`registry index is not valid JSON: ${url}`);
  }
  const problems = validateIndex(index);
  if (problems.length) {
    throw new Error(`invalid registry index at ${url}: ${problems.join("; ")}`);
  }
  return index;
}

// Resolve `@registry/skill` na lista de registries configurados: encontra o registry pelo
// scope do nome, baixa o index e devolve a entrada da skill com a origem.
export async function resolve(name, registries, { fetchImpl }) {
  const { registry: scope } = parseSkillName(name);
  const origin = registries.find((registry) => registry.name === scope);
  if (!origin) {
    throw new Error(`registry not configured for scope "@${scope}": run \`mgr registry add ${scope} <index-url>\` first`);
  }
  const index = await fetchIndex(origin.url, { fetchImpl });
  for (const [category, entries] of Object.entries(index.categories)) {
    const entry = entries.find((candidate) => candidate.name === name);
    if (entry) return { entry, category, origin };
  }
  throw new Error(`skill not found in registry "${scope}": ${name}`);
}

// Modo de detecção do projeto (ADR-0009), guardado no mesmo config dos registries.
// Ausente = `suggest`, o default de D03.
export const DETECTION_MODES = ["manual", "suggest"];
export const DEFAULT_DETECTION_MODE = "suggest";

export function readDetectionMode(coreDir) {
  const mode = readConfig(coreDir).detectionMode;
  if (mode === undefined) return DEFAULT_DETECTION_MODE;
  // `auto` está no vocabulário de D03 mas depende do `mgr audit` para existir: instalar sem
  // confirmação humana precisa de uma base de auditoria que ainda não temos. Tratar como
  // `suggest` em silêncio seria mentir sobre a política de segurança que o usuário configurou.
  if (mode === "auto") {
    throw new Error('detectionMode "auto" is not available yet: installing without human confirmation depends on `mgr audit`, which is not implemented');
  }
  if (!DETECTION_MODES.includes(mode)) {
    throw new Error(`invalid detectionMode: ${JSON.stringify(mode)} (expected ${DETECTION_MODES.join(" | ")})`);
  }
  return mode;
}

// Gate de validação (ADR-0010), guardado no mesmo config dos registries. Vai aqui e não no
// manifest.json porque o manifest é reescrito inteiro a cada install, enquanto o writeConfig
// preserva campos desconhecidos — é o que faz o ajuste sobreviver ao `update`.
// Ausente = ligado no default do catálogo. Override PARCIAL completa o default, não o substitui.
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Resolve UMA política de agente: default do catálogo completado pelo que o usuário escreveu.
//
// Extraída de `readReviewGate` quando a política deixou de ser uma só (ADR-0017). O `label` existe
// para a mensagem de erro nomear o caminho REAL no config — `reviewGate` ou `agents.<intenção>` —
// em vez de um nome genérico que o autor não acharia no arquivo.
function resolvePolicy(label, defaults, configured) {
  if (configured === undefined) return { ...defaults };
  if (!isPlainObject(configured)) {
    throw new Error(`invalid ${label}: ${JSON.stringify(configured)} (expected an object)`);
  }

  // O merge é de DOIS níveis por causa do `model`: override parcial COMPLETA o default, não o
  // substitui. Merge raso faria `{"copilot": "x"}` apagar o default do claude-code em silêncio.
  const policy = { ...defaults, ...configured };
  if (configured.model !== undefined && isPlainObject(configured.model)) {
    policy.model = { ...defaults.model, ...configured.model };
  }

  if (typeof policy.enabled !== "boolean") {
    throw new Error(`invalid ${label}.enabled: ${JSON.stringify(policy.enabled)} (expected true | false)`);
  }
  // `inherit` não é um nível de esforço: é a forma de o autor dizer "não declare este campo", e o
  // agente herda o da sessão. Existe porque `effort` TEM default — sem um valor para desligá-lo,
  // não haveria como recusar a declaração. O `model` não precisa disso para o caso comum, já que o
  // default dele não publica nada, mas aceita pela mesma razão e com a mesma palavra.
  if (policy.effort !== INHERIT && !EFFORT_LEVELS.includes(policy.effort)) {
    throw new Error(`invalid ${label}.effort: ${JSON.stringify(policy.effort)} (expected ${[...EFFORT_LEVELS, INHERIT].join(" | ")})`);
  }

  // `model` é mapa por motor — mesma forma do mgr-manifest.json. String é o erro provável de
  // quem escreve à mão, então a mensagem ensina a forma em vez de só recusar.
  const model = policy.model;
  if (!isPlainObject(model)) {
    throw new Error(`invalid ${label}.model: ${JSON.stringify(model)} (expected a map of engine to model, e.g. {"claude-code": "opus"})`);
  }
  for (const [engine, value] of Object.entries(model)) {
    engines.get(engine);
    // O VALOR não é validado contra lista fechada, de propósito: os identificadores são da
    // plataforma (e no copilot, da conta) e mudam sem o método saber. Lista nossa envelheceria
    // e passaria a recusar modelo válido. Quem valida é a plataforma, que avisa e substitui.
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`invalid ${label}.model.${engine}: ${JSON.stringify(value)} (expected a non-empty model name)`);
    }
  }

  // NORMALIZA a herança para ausência. Quem consome — `gateSummary`, `agentFrontmatter` — já sabe
  // omitir o que não tem valor; traduzir aqui evita ensinar a mesma regra a cada consumidor, e é o
  // que faz `inherit` significar a mesma coisa em qualquer motor, inclusive nos que ainda não
  // existem.
  if (policy.effort === INHERIT) delete policy.effort;
  policy.model = Object.fromEntries(
    Object.entries(policy.model).filter(([, valor]) => valor !== INHERIT),
  );

  return policy;
}

// A política de TODAS as intenções (ADR-0017). Fonte única: `agents` no mesmo config, com
// `reviewGate` como APELIDO de `agents.review` para nenhuma instalação existente quebrar.
//
// Quando as duas chaves existem, `agents.review` vence e o conflito volta em `aliasOverridden`
// para a BORDA avisar. Resolver em silêncio seria escolher pelo autor sem lhe dizer — e ele
// escreveu os dois valores justamente porque achava que os dois valiam.
// Escreve a política de UMA intenção, preservando tudo o mais (ADR-0017; esta fatia).
//
// O merge do `model` é de DOIS NÍVEIS, pela mesma razão do `resolvePolicy`: declarar um motor não
// pode apagar o outro que o autor já tinha escrito. E só o campo pedido é tocado — passar `model`
// não mexe no `effort`, e vice-versa.
//
// A validação é a MESMA da leitura, rodada aqui antes de gravar: escrever um valor inválido e só
// descobrir na próxima leitura deixaria o config quebrado com a mão do próprio método.
export function writeAgentPolicy(coreDir, intent, { model, effort } = {}) {
  if (!INTENTS.includes(intent)) {
    throw new Error(`unknown agent intent: ${JSON.stringify(intent)} (expected ${INTENTS.join(" | ")})`);
  }
  if (model === undefined && effort === undefined) {
    throw new Error(`nothing to write for agents.${intent} (expected model, effort, or both)`);
  }

  const config = readConfig(coreDir);
  const agents = { ...(config.agents ?? {}) };
  const escrita = { ...(agents[intent] ?? {}) };
  if (model !== undefined) escrita.model = { ...(escrita.model ?? {}), ...model };
  if (effort !== undefined) escrita.effort = effort;

  // Valida ANTES de gravar, e devolve o que passou a valer — é o que a borda relata.
  const policy = resolvePolicy(`agents.${intent}`, AGENTS[intent].defaults, escrita);
  agents[intent] = escrita;
  writeConfig(coreDir, { ...config, agents });
  return policy;
}

// De onde veio cada valor da política: o que o autor escreveu, ou o default do catálogo.
//
// Existe porque a saída do `mgr agents` tem de dizer a ORIGEM, não só o valor — sem isso o autor
// não distingue "o método escolheu por mim" de "eu escolhi isto", e as duas frases levam a ações
// diferentes. O `model` é conferido POR MOTOR, porque o override é por motor.
//
// O que o motor não sustenta NÃO é decidido aqui: isso é capacidade, vem do `gateSummary`, e
// misturar as duas faria "não configurado" e "não suportado" virarem a mesma palavra.
export const CONFIGURED = "configured";
export const DEFAULT = "default";

function sourcesOf(defaults, escrita) {
  const origem = (campo) => (escrita !== undefined && escrita[campo] !== undefined ? CONFIGURED : DEFAULT);
  const modelEscrito = isPlainObject(escrita?.model) ? escrita.model : undefined;
  const motores = new Set([...Object.keys(defaults.model), ...Object.keys(modelEscrito ?? {})]);
  return {
    enabled: origem("enabled"),
    effort: origem("effort"),
    model: Object.fromEntries([...motores].map((motor) =>
      [motor, modelEscrito?.[motor] !== undefined ? CONFIGURED : DEFAULT])),
  };
}

// Chaves sob `agents` que NÃO são intenção. Existe porque o `budget` é documentado pela spec e
// pelo ADR-0017 e era recusado como "intenção desconhecida": quem escrevesse o teto exatamente
// como a documentação ensina derrubava `install`, `update` e `agents`. Defeito achado pelo gate
// isolado e reproduzido.
export const RESERVED_AGENT_KEYS = Object.freeze(["budget"]);

// O teto de token do fluxo (ADR-0017). Ausente é ausência de teto, e ausência de teto NÃO é zero:
// zero é um teto que reprova tudo, e confundir os dois faria a medição reprovar quem não pediu.
function resolveBudget(configured) {
  if (configured === undefined) return null;
  if (!isPlainObject(configured)) {
    throw new Error(`invalid agents.budget: ${JSON.stringify(configured)} (expected an object)`);
  }
  const total = configured.totalTokens;
  if (total === undefined) return { totalTokens: null };
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(`invalid agents.budget.totalTokens: ${JSON.stringify(total)} (expected a non-negative integer)`);
  }
  return { totalTokens: total };
}

export function readAgents(coreDir) {
  const config = readConfig(coreDir);
  const configured = config.agents;
  if (configured !== undefined && !isPlainObject(configured)) {
    throw new Error(`invalid agents: ${JSON.stringify(configured)} (expected an object)`);
  }

  const desconhecidas = Object.keys(configured ?? {})
    .filter((chave) => !INTENTS.includes(chave) && !RESERVED_AGENT_KEYS.includes(chave));
  if (desconhecidas.length) {
    throw new Error(`unknown agent intent(s): ${desconhecidas.join(", ")} (expected ${INTENTS.join(" | ")})`);
  }
  const budget = resolveBudget(configured?.budget);

  const policies = {};
  const sources = {};
  for (const intent of INTENTS) {
    // `review` é a única que tem apelido, e o apelido só vale quando a chave nova não fala dela.
    const doApelido = intent === "review" ? config.reviewGate : undefined;
    const escrita = configured?.[intent] ?? doApelido;
    policies[intent] = resolvePolicy(`agents.${intent}`, AGENTS[intent].defaults, escrita);
    // O apelido conta como CONFIGURADO: quem escreveu `reviewGate` escolheu aquele valor, e
    // chamá-lo de default diria ao autor que ele não escolheu o que escolheu.
    sources[intent] = sourcesOf(AGENTS[intent].defaults, escrita);
  }

  return {
    policies,
    sources,
    budget,
    aliasOverridden: config.reviewGate !== undefined && configured?.review !== undefined,
  };
}

// Preâmbulo das leis no hook de sessão (ADR-0011). Interruptor PRÓPRIO, separado do --no-hooks:
// desligar o preâmbulo não desliga a detecção de skills, e vice-versa. Ausente = LIGADO — o hook
// já é instalado por padrão, e um default desligado entregaria valor a ninguém que não
// configurasse.
export const LAWS_PREAMBLE_DEFAULTS = { enabled: true };

export function readLawsPreamble(coreDir) {
  const configured = readConfig(coreDir).lawsPreamble;
  if (configured === undefined) return { ...LAWS_PREAMBLE_DEFAULTS };
  if (!isPlainObject(configured)) {
    throw new Error(`invalid lawsPreamble: ${JSON.stringify(configured)} (expected an object)`);
  }
  const preamble = { ...LAWS_PREAMBLE_DEFAULTS, ...configured };
  if (typeof preamble.enabled !== "boolean") {
    throw new Error(`invalid lawsPreamble.enabled: ${JSON.stringify(preamble.enabled)} (expected true | false)`);
  }
  return preamble;
}

// Caminho da fonte de leis anunciado no preâmbulo quando não há referência resolvida.
export const lawsFallbackRef = () => LAWS_SHARED;
