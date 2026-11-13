// Registries de skills plugáveis (ADR-0005): config em `.mgr-core/config.json` (lista
// `registries[]` {name, url, trusted}) + fetch/validação do index e resolução de skill.
// O config é arquivo próprio — o manifest.json continua sendo só estado de instalação.
// O fetch é INJETADO (mesmo padrão do adaptador de prompts): o núcleo não abre rede em
// teste; a borda passa o fetch global.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EFFORT_LEVELS, parseSkillName } from "./plugin.js";
import { AGENTS, INHERIT, INTENTS, LAWS_SHARED, RUNTIME_VERSIONING } from "./catalog.js";
import * as engines from "./engines/index.js";

export const CONFIG_NAME = "config.json";
export const LOCAL_CONFIG_NAME = "config.local.json";

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

// A forma do `model` (mapa por motor), com a mensagem que ensina a forma. Uma só, usada pela
// validação da política e pela base da escrita, que só confere a forma (DT-25, review isolado 4).
function modelShapeError(label, model) {
  return new Error(`invalid ${label}.model: ${JSON.stringify(model)} (expected a map of engine to model, e.g. {"claude-code": "opus"})`);
}

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
  if (!isPlainObject(model)) throw modelShapeError(label, model);
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

// Escreve a política de UMA intenção, preservando tudo o mais (ADR-0017; esta fatia).
//
// O merge do `model` é de DOIS NÍVEIS, pela mesma razão do `resolvePolicy`: declarar um motor não
// pode apagar o outro que o autor já tinha escrito. E só o campo pedido é tocado — passar `model`
// não mexe no `effort`, e vice-versa.
//
// A validação é a MESMA da leitura, rodada antes de gravar (em `writeAgentPolicies`): escrever um
// valor inválido e só descobrir na próxima leitura deixaria o config quebrado com a mão do método.
//
// Quando a política de review vinha só do apelido `reviewGate`, a escrita parte dele e o remove do
// arquivo (ADR-0031): deixá-lo ao lado de `agents.review` faria a escrita sobrepor o apelido em
// silêncio, descartando o que o autor havia declarado nele. O retorno diz o que migrou.
export function writeAgentPolicy(coreDir, intent, request = {}) {
  const { policies, migration } = writeAgentPolicies(coreDir, [[intent, request]]);
  return { policy: policies[intent], migration };
}

// Escreve os pedidos de VÁRIAS intenções numa gravação só (review isolado 4, SP-1): todos são
// aplicados sobre o config lido UMA vez, pela MESMA regra do plano (`applyRequests`), o resultado
// final é validado inteiro e só então gravado. Gravar uma intenção por vez validava estados
// intermediários: um pedido que conserta duas intenções inválidas era recusado na primeira,
// enquanto o plano, que aplica tudo junto, o aceitava. `requests` é `[[intent, { model, effort }], ...]`,
// na ordem em que as chaves entram em `agents`; lista vazia e intenção repetida são recusadas.
export function writeAgentPolicies(coreDir, requests) {
  if (!requests.length) throw new Error("nothing to write for agents (expected at least one intent)");
  assertRequestedIntents(requests);
  for (const [intent, { model, effort } = {}] of requests) {
    if (model === undefined && effort === undefined) {
      throw new Error(`nothing to write for agents.${intent} (expected model, effort, or both)`);
    }
  }

  const config = readConfig(coreDir);
  const { config: gravado, migration } = applyRequests(config, requests);
  // Valida ANTES de gravar, e devolve o que passou a valer — é o que a borda relata.
  const policies = Object.fromEntries(requests.map(([intent]) => (
    [intent, resolvePolicy(`agents.${intent}`, AGENTS[intent].defaults, gravado.agents[intent])]
  )));
  // DT-18: o config FINAL inteiro tem de passar na leitura antes de ser gravado (ex.: outra
  // intenção inválida que nenhum pedido substitui).
  agentsFromConfig(gravado);
  writeConfig(coreDir, gravado);
  return { policies, migration };
}

// `agents` tem de ser objeto: UMA recusa, com o mesmo texto, na leitura e na escrita (review isolado 6).
function assertAgentsObject(agents) {
  if (agents !== undefined && !isPlainObject(agents)) {
    throw new Error(`invalid agents: ${JSON.stringify(agents)} (expected an object)`);
  }
}

// Intenções pedidas: só as do catálogo, e cada uma uma vez — repetida, o segundo pedido apagaria o
// primeiro em silêncio. Uma regra para o plano e para a escrita.
function assertRequestedIntents(requests) {
  const vistas = new Set();
  for (const [intent] of requests) {
    if (!INTENTS.includes(intent)) {
      throw new Error(`unknown agent intent: ${JSON.stringify(intent)} (expected ${INTENTS.join(" | ")})`);
    }
    if (vistas.has(intent)) throw new Error(`agent intent requested twice: ${JSON.stringify(intent)}`);
    vistas.add(intent);
  }
}

// Os pedidos sobre o config (ADR-0031): base de `policyBaseOf`, sobreposição de `overlayRequest`,
// migração do apelido e remoção do `reviewGate`. UMA regra para o plano e para a escrita (review
// isolado 5, ST-1), para os dois não divergirem na primeira mudança. Devolve config NOVO.
function applyRequests(config, requests) {
  // `agents` que não é objeto é recusado antes de qualquer espalhamento: número e booleano sumiriam
  // em silêncio (`{ ...5 }` é `{}`), e com eles o `reviewGate` seria removido (ADR-0031).
  assertAgentsObject(config.agents);
  const agents = { ...(config.agents ?? {}) };
  let migration = { state: "none" };
  for (const [intent, request] of requests) {
    const { source, base } = policyBaseOf(config, intent, request);
    agents[intent] = overlayRequest(base, request);
    if (source === "reviewGate") migration = migrationOf(base, request);
  }
  const resultado = { ...config, agents };
  if (migration.state === "migrated") delete resultado.reviewGate;
  return { config: resultado, migration };
}

// A base de onde parte a escrita da política de UMA intenção (ADR-0031), com a precedência da leitura
// (`agentsFromConfig`): o apelido só vale quando `agents.<intent>` está ausente, e `null` conta como
// ausente nos dois lados (`??` na leitura). Chamada só por `applyRequests`, que serve o plano e a
// escrita: é assim que o plano é a política gravada.
//
// Da base própria só se valida a FORMA do que a mescla lê: o `model` tem de ser mapa quando um
// modelo é pedido (string espalhada viraria `{0: "o", ...}`; `null` conta como ausente). Valores e
// motores valem pelo resultado, validado inteiro antes de gravar: o pedido conserta o campo
// inválido que substitui (inclusive `model.<motor>`), e o campo inválido que fica é recusado.
function policyBaseOf(config, intent, { model }) {
  const propria = config.agents?.[intent];
  if (propria != null) {
    if (!isPlainObject(propria)) {
      throw new Error(`invalid agents.${intent}: ${JSON.stringify(propria)} (expected an object)`);
    }
    if (model !== undefined && propria.model != null && !isPlainObject(propria.model)) {
      throw modelShapeError(`agents.${intent}`, propria.model);
    }
    return { source: "agents", base: propria };
  }
  if (intent === "review" && config.reviewGate !== undefined) {
    // Valida com o rótulo REAL antes de mesclar: um `reviewGate` string espalhado em `{ ...base }`
    // viraria `{0: "m", ...}`, passaria na validação de `agents.review` e seria gravado.
    resolvePolicy("reviewGate", AGENTS.review.defaults, config.reviewGate);
    return { source: "reviewGate", base: config.reviewGate };
  }
  return { source: "none", base: {} };
}

// O pedido sobre a base, com o merge de dois níveis do `model`: declarar um motor não apaga o outro.
// UMA regra para a escrita e para o plano (achado ST-2 do review isolado 2), para os dois não
// divergirem na primeira mudança. `policyBaseOf` já garantiu que a base é objeto e que o `model`
// dela, se for lido, é mapa ou ausente; os valores são validados no resultado.
function overlayRequest(base, { model, effort }) {
  const sobre = { ...base };
  if (model !== undefined) sobre.model = { ...(base.model ?? {}), ...model };
  if (effort !== undefined) sobre.effort = effort;
  return sobre;
}

// O que da migração do apelido ficou e o que o pedido substituiu (ADR-0031). Na ordem em que o
// autor escreveu o `reviewGate`. Pedido igual ao valor do apelido não muda nada, então fica em
// `kept`. `model` é por motor; motor que o apelido não tinha não é campo dele e não entra em lista.
function migrationOf(alias, { model, effort }) {
  const kept = [];
  const replaced = [];
  const place = (field, from, requested) => {
    if (requested === undefined || requested === from) kept.push({ field, value: from });
    else replaced.push({ field, from, to: requested });
  };
  for (const [key, value] of Object.entries(alias)) {
    // Sem `isPlainObject` (T-5): a base já foi validada, e um `model` não objeto não chega aqui.
    if (key === "model") {
      for (const [engine, current] of Object.entries(value)) place(`model.${engine}`, current, model?.[engine]);
    } else {
      place(key, value, key === "effort" ? effort : undefined);
    }
  }
  return { state: "migrated", kept, replaced };
}

// A ORIGEM do projeto: nascido do metodo (`greenfield`) ou legado (`brownfield`). Vive no CONFIG e
// nao no manifesto porque `writeManifest` monta um objeto NOVO a cada chamada, a partir de uma lista
// fixa de campos (`src/installer.js:190-207`): campo fora daquela lista desaparece em silencio na
// execucao seguinte. Aqui, como todo escritor deste arquivo, e read-modify-write.
//
// Ausencia da chave e ORIGEM DESCONHECIDA, e NAO existe um terceiro valor gravavel: um "unknown"
// escrito convidaria a grava-lo como default, e default silencioso e exatamente o que a fatia proibe.
export const ORIGINS = ["greenfield", "brownfield"];

// Leitura da origem em três estados (DT-15). `invalid` carrega o valor cru para quem o mostrar.
export function readOrigin(coreDir) {
  const value = readConfig(coreDir).origin;
  if (value === undefined) return { state: "absent" };
  return ORIGINS.includes(value) ? { state: "recorded", origin: value } : { state: "invalid", value };
}

export function writeOrigin(coreDir, valor) {
  if (!ORIGINS.includes(valor)) {
    throw new Error(`unknown project origin: ${JSON.stringify(valor)} (expected ${ORIGINS.join(" | ")})`);
  }
  const config = readConfig(coreDir);
  // Tres casos distintos, e nenhum deles e `null` com significado de negocio: a chave nunca existiu,
  // ela tinha valor valido, ou tinha lixo que alguem escreveu a mao.
  const antes = config.origin === undefined
    ? { estado: "ausente" }
    : ORIGINS.includes(config.origin)
      ? { estado: "gravado", valor: config.origin }
      : { estado: "invalido", valor: config.origin };
  // Valida ANTES de gravar, e devolve o que passou a valer — mesma disciplina do `writeAgentPolicy`.
  writeConfig(coreDir, { ...config, origin: valor });
  return { antes, depois: valor };
}

// Escolha do time sobre versionar o runtime (DT-1, DT-2). Read-modify-write, como a origem: o que
// esta na config e preservado. Ausente e um estado proprio, e nao ha terceiro valor gravavel.
export function runtimeVersioningOf(config) {
  const value = config.runtimeVersioning;
  if (value === undefined) return { state: "absent" };
  return RUNTIME_VERSIONING.includes(value) ? { state: "recorded", value } : { state: "invalid", value };
}

export function readRuntimeVersioning(coreDir) {
  return runtimeVersioningOf(readConfig(coreDir));
}

// Valida ANTES de ler ou gravar. O `antes` tem a mesma forma do `writeOrigin`.
export function writeRuntimeVersioning(coreDir, value) {
  if (!RUNTIME_VERSIONING.includes(value)) {
    throw new Error(`unknown runtime versioning: ${JSON.stringify(value)} (expected ${RUNTIME_VERSIONING.join(" | ")})`);
  }
  const config = readConfig(coreDir);
  const atual = runtimeVersioningOf(config);
  const antes = atual.state === "absent"
    ? { estado: "ausente" }
    : atual.state === "recorded"
      ? { estado: "gravado", valor: atual.value }
      : { estado: "invalido", valor: atual.value };
  writeConfig(coreDir, { ...config, runtimeVersioning: value });
  return { antes, depois: value };
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
  return agentsFromConfig(readConfig(coreDir));
}

// `previewPlan`, abaixo: o que o install VAI gravar, calculado sem gravar (P1.2): `models` (`{ [intent]: { [engine]: id } }`)
// sobreposto em memória ao config lido, com o mesmo merge de dois níveis do `writeAgentPolicy` e a
// MESMA leitura/validação do `readAgents` (`agentsFromConfig`), para o plano que a pessoa confirma
// ser a política que será escrita. Intenção desconhecida em `models` falha como no escritor.
// `efforts` (`{ [intent]: nível }`) sobrepõe só o `effort`, com a mesma regra de intenção desconhecida;
// nível vazio não é pedido (`requestOf`), e nível fora da escala é recusado pela validação do
// `agentsFromConfig`.
// Política e migração do apelido `reviewGate` (ADR-0031) do MESMO cálculo e de UMA leitura do config
// (achado do review isolado 1, DT-17): duas leituras permitiam ao plano divergir de si mesmo.
export function previewPlan(coreDir, models = {}, efforts = {}) {
  const previa = previewOf(readConfig(coreDir), models, efforts);
  return { agents: agentsFromConfig(previa.config), reviewGateMigration: previa.migration };
}

// O pedido de UMA intenção, no critério que a escrita usa (DT-17): `model` só com ao menos uma chave,
// `effort` só string não vazia. Compartilhado por `previewOf` e `execute` para o plano ser a escrita.
// Tipo errado falha alto em vez de ser ignorado: ignorar faria o plano mostrar uma política sem o
// pedido que quem chamou acreditou ter feito.
export function requestOf(models, efforts, intent) {
  const request = {};
  const model = models?.[intent];
  if (model !== undefined) {
    if (!isPlainObject(model)) {
      throw new Error(`invalid model request for ${intent}: ${JSON.stringify(model)} (expected a map of engine to model)`);
    }
    if (Object.keys(model).length > 0) request.model = model;
  }
  const effort = efforts?.[intent];
  if (effort !== undefined) {
    if (typeof effort !== "string") {
      throw new Error(`invalid effort request for ${intent}: ${JSON.stringify(effort)} (expected a level name)`);
    }
    if (effort.length > 0) request.effort = effort;
  }
  return request;
}

// Fonte única da prévia (ADR-0031): config sobreposto e migração saem do mesmo cálculo, para o plano
// que a pessoa confirma ser a escrita. A base de cada intenção é a da escrita (`policyBaseOf`),
// sobreposta UMA vez por intenção com o pedido de `requestOf`.
function previewOf(config, models, efforts) {
  const chaves = new Set([...Object.keys(models ?? {}), ...Object.keys(efforts ?? {})]);
  const pedidos = [...chaves]
    .map((intent) => [intent, requestOf(models, efforts, intent)])
    .filter(([, request]) => Object.keys(request).length > 0);
  assertRequestedIntents(pedidos);
  if (!pedidos.length) return { config, migration: { state: "none" } };
  return applyRequests(config, pedidos);
}

// A política de TODAS as intenções (ADR-0017). Fonte única: `agents` no mesmo config, com
// `reviewGate` como APELIDO de `agents.review` para nenhuma instalação existente quebrar.
//
// Quando as duas chaves existem (`agents.review` não `null`), `agents.review` vence e o conflito volta em `aliasOverridden`
// para a BORDA avisar. Resolver em silêncio seria escolher pelo autor sem lhe dizer — e ele
// escreveu os dois valores justamente porque achava que os dois valiam.
function agentsFromConfig(config) {
  const configured = config.agents;
  assertAgentsObject(configured);

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
    // Rótulo do caminho real no config, como promete o `resolvePolicy`: o valor do apelido nomeia `reviewGate`.
    // `== null` (ADR-0031, DT-19): o `??` de `escrita` já cai no apelido quando `agents.review` é
    // `null`; o rótulo da mensagem de erro tem de acompanhar, senão nomearia o caminho errado.
    const vemDoApelido = configured?.[intent] == null && doApelido !== undefined;
    const escrita = configured?.[intent] ?? doApelido;
    policies[intent] = resolvePolicy(vemDoApelido ? "reviewGate" : `agents.${intent}`, AGENTS[intent].defaults, escrita);
    // O apelido conta como CONFIGURADO: quem escreveu `reviewGate` escolheu aquele valor, e
    // chamá-lo de default diria ao autor que ele não escolheu o que escolheu.
    sources[intent] = sourcesOf(AGENTS[intent].defaults, escrita);
  }

  return {
    policies,
    sources,
    budget,
    aliasOverridden: config.reviewGate !== undefined && configured?.review != null,
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

// Camada PESSOAL (DT-1, DT-2): `.mgr-core/config.local.json`, fora do versionamento (bloco do
// `.gitignore`, DT-4). As chaves são disjuntas da camada do time: chave do time escrita aqui é
// ignorada e avisada, e nenhum leitor de política lê este arquivo — `readAgents`, `readDetectionMode`
// e `readLawsPreamble` continuam lendo só `config.json`. A precedência é por construção.
export const PERSONAL_KEYS = Object.freeze(["projectId", "initials"]);
export const TEAM_KEYS = Object.freeze([
  "agents", "reviewGate", "origin", "registries", "detectionMode", "lawsPreamble", "architecture", "language", "userLanguage",
  "runtimeVersioning",
]);

const localConfigPath = (coreDir) => path.join(coreDir, LOCAL_CONFIG_NAME);

// Lê o arquivo pessoal como objeto. Ausente = objeto vazio. JSON inválido nomeia o ARQUIVO, porque o
// autor edita esse arquivo à mão e "not valid JSON" sem caminho não diz onde procurar.
function readLocalObject(coreDir) {
  const file = localConfigPath(coreDir);
  if (!existsSync(file)) return {};
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`, { cause: error });
  }
  if (!isPlainObject(parsed)) throw new Error(`${file} must contain a JSON object`);
  return parsed;
}

// Devolve o projectId da camada pessoal e o que foi IGNORADO nela, discriminado em duas listas para o
// chamador avisar com o nome do arquivo e da chave. `projectId` ausente não aparece na forma.
export function readPersonal(coreDir) {
  const local = readLocalObject(coreDir);
  const chaves = Object.keys(local);
  const ignoredTeam = chaves.filter((chave) => TEAM_KEYS.includes(chave));
  const ignoredUnknown = chaves.filter((chave) => !PERSONAL_KEYS.includes(chave) && !TEAM_KEYS.includes(chave));
  if (local.projectId === undefined) return { ignoredTeam, ignoredUnknown };
  if (typeof local.projectId !== "string" || local.projectId === "") {
    throw new Error(`invalid projectId in ${localConfigPath(coreDir)}: ${JSON.stringify(local.projectId)} (expected a non-empty string)`);
  }
  return { projectId: local.projectId, ignoredTeam, ignoredUnknown };
}

// Escritor do `projectId` em `config.local.json` (as `initials` têm o `writeInitials`). Read-modify-write, como `writeOrigin`: as outras chaves do
// arquivo (inclusive as de time que ele já tinha, que continuam sendo avisadas) sobrevivem à escrita.
// Se o arquivo existente for inválido, lança ANTES de gravar, para não apagar o que o autor escreveu.
export function writePersonal(coreDir, { projectId } = {}) {
  if (typeof projectId !== "string" || projectId === "") {
    throw new Error(`invalid projectId: ${JSON.stringify(projectId)} (expected a non-empty string)`);
  }
  const local = readLocalObject(coreDir);
  mkdirSync(coreDir, { recursive: true });
  const dest = localConfigPath(coreDir);
  writeFileSync(dest, JSON.stringify({ ...local, projectId }, null, 2) + "\n", "utf8");
  return dest;
}

// Iniciais da pessoa (DT-5): 2 a 4 letras minusculas, usadas so para montar o nome da branch da spec.
// `readPersonal` nao valida esta chave, para uma inicial escrita a mao nao quebrar os outros leitores.
export const INITIALS_PATTERN = /^[a-z]{2,4}$/;

// Os tres estados de um valor de iniciais, na forma do `readOrigin`. `invalid` carrega o valor cru.
const estadoDasIniciais = (value) => {
  if (value === undefined) return { state: "absent" };
  return typeof value === "string" && INITIALS_PATTERN.test(value)
    ? { state: "recorded", initials: value }
    : { state: "invalid", value };
};

export function readInitials(coreDir) {
  return estadoDasIniciais(readLocalObject(coreDir).initials);
}

// Valida ANTES de ler ou gravar. Read-modify-write, como `writePersonal`: o `projectId` e as outras
// chaves sobrevivem. Arquivo pessoal invalido lanca antes de gravar.
export function writeInitials(coreDir, valor) {
  if (typeof valor !== "string" || !INITIALS_PATTERN.test(valor)) {
    throw new Error(`invalid initials: ${JSON.stringify(valor)} (expected 2 to 4 lowercase letters a-z)`);
  }
  const local = readLocalObject(coreDir);
  mkdirSync(coreDir, { recursive: true });
  writeFileSync(localConfigPath(coreDir), JSON.stringify({ ...local, initials: valor }, null, 2) + "\n", "utf8");
  return { before: estadoDasIniciais(local.initials), after: valor };
}

// Lado "simetria" da DT-2: `projectId` escrito no config do TIME é ignorado pelo método, e este
// leitor diz quais chaves pessoais estão no lugar errado. Os avisos citam só o `projectId`: uma
// `initials` no config do time é ignorada, porque nenhum leitor de iniciais lê esse arquivo.
export function misplacedTeamKeys(coreDir) {
  const config = readConfig(coreDir);
  return PERSONAL_KEYS.filter((chave) => config[chave] !== undefined);
}

// Caminho da fonte de leis anunciado no preâmbulo quando não há referência resolvida.
export const lawsFallbackRef = () => LAWS_SHARED;
