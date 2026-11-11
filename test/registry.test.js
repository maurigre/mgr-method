import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  addRegistry, CONFIGURED, configPath, DEFAULT, fetchIndex, ORIGINS, RESERVED_AGENT_KEYS, listRegistries, readAgents, readConfig, readDetectionMode,
  readLawsPreamble, removeRegistry, requestOf, writeAgentPolicies, writeAgentPolicy, writeOrigin, resolve, validateIndex, writeConfig,
} from "../src/registry.js";
import { AGENTS, INTENTS, REVIEW_GATE } from "../src/catalog.js";
import { fileURLToPath } from "node:url";
import { tempDir } from "../scripts/lib/tmp.mjs";

const diretorioTemporario = () => tempDir("mgr-registry-");

const INDEX_URL = "https://raw.githubusercontent.com/maurigre/mgr-registry/main/index.json";

const indexFixture = () => ({
  indexVersion: 1,
  registry: "mgr",
  generatedAt: "2026-07-20T00:00:00.000Z",
  categories: {
    language: [{
      name: "@mgr/junit-clean",
      version: "1.0.0",
      description: "Standardizes Java unit tests with JUnit 5.",
      checksum: `sha256-${"a".repeat(64)}`,
      files: [{ path: "SKILL.md", url: "https://raw.example/junit-clean/SKILL.md", sha256: "b".repeat(64) }],
    }],
  },
});

const fetchStub = (body, { ok = true, status = 200 } = {}) => async () => ({
  ok,
  status,
  json: async () => {
    if (typeof body === "string") throw new SyntaxError("Unexpected token");
    return body;
  },
});

test("config de registries: add/list/remove persistem em .mgr-core/config.json", () => {
  const core = diretorioTemporario();
  assert.deepEqual(readConfig(core), { registries: [] });

  addRegistry(core, { name: "mgr", url: INDEX_URL, trusted: true });
  addRegistry(core, { name: "empresa", url: "https://registry.empresa.dev/index.json" });
  assert.ok(existsSync(configPath(core)));
  assert.deepEqual(listRegistries(core), [
    { name: "mgr", url: INDEX_URL, trusted: true },
    { name: "empresa", url: "https://registry.empresa.dev/index.json", trusted: false },
  ]);

  removeRegistry(core, "empresa");
  assert.deepEqual(listRegistries(core).map((registry) => registry.name), ["mgr"]);
  assert.match(readFileSync(configPath(core), "utf8"), /"registries"/);
});

test("addRegistry valida nome, url e duplicidade", () => {
  const core = diretorioTemporario();
  assert.throws(() => addRegistry(core, { name: "MGR", url: INDEX_URL }), /invalid registry name/);
  assert.throws(() => addRegistry(core, { name: "mgr", url: "ftp://x" }), /invalid registry url/);
  addRegistry(core, { name: "mgr", url: INDEX_URL });
  assert.throws(() => addRegistry(core, { name: "mgr", url: INDEX_URL }), /registry already configured/);
});

test("removeRegistry de nome não configurado é erro explícito", () => {
  assert.throws(() => removeRegistry(diretorioTemporario(), "ghost"), /registry not configured: ghost/);
});

test("writeConfig preserva campos desconhecidos do config", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], detectionMode: "suggest" });
  addRegistry(core, { name: "mgr", url: INDEX_URL });
  removeRegistry(core, "mgr");
  assert.equal(readConfig(core).detectionMode, "suggest");
});

test("validateIndex aceita index gerado válido", () => {
  assert.deepEqual(validateIndex(indexFixture()), []);
});

test("validateIndex reprova cada regra com mensagem específica", () => {
  const valid = indexFixture();
  const entry = valid.categories.language[0];
  const cases = [
    [{ ...valid, indexVersion: 2 }, /unsupported "indexVersion"/],
    [{ ...valid, registry: "" }, /"registry" must be a non-empty string/],
    [{ indexVersion: 1, registry: "mgr" }, /"categories" must be an object/],
    [{ ...valid, categories: { language: [{ ...entry, name: "junit" }] } }, /invalid "name"/],
    [{ ...valid, categories: { language: [{ ...entry, checksum: "md5-x" }] } }, /"checksum" must be "sha256-<hex>"/],
    [{ ...valid, categories: { language: [{ ...entry, files: [] }] } }, /"files" must be a non-empty array/],
  ];
  for (const [invalid, expected] of cases) {
    const problems = validateIndex(invalid);
    assert.ok(problems.some((problem) => expected.test(problem)), `${expected} em ${JSON.stringify(problems)}`);
  }
  assert.deepEqual(validateIndex(null), ["index must be a JSON object"]);
});

test("fetchIndex devolve o index válido e falha com erro específico", async () => {
  const index = await fetchIndex(INDEX_URL, { fetchImpl: fetchStub(indexFixture()) });
  assert.equal(index.registry, "mgr");

  await assert.rejects(
    fetchIndex(INDEX_URL, { fetchImpl: fetchStub(indexFixture(), { ok: false, status: 404 }) }),
    /registry index unavailable: .*HTTP 404/,
  );
  await assert.rejects(
    fetchIndex(INDEX_URL, { fetchImpl: fetchStub("not-json") }),
    /registry index is not valid JSON/,
  );
  await assert.rejects(
    fetchIndex(INDEX_URL, { fetchImpl: fetchStub({ indexVersion: 1 }) }),
    /invalid registry index/,
  );
});

test("resolve encontra a skill pelo scope e devolve entrada + origem", async () => {
  const registries = [{ name: "mgr", url: INDEX_URL, trusted: true }];
  const { entry, category, origin } = await resolve("@mgr/junit-clean", registries, { fetchImpl: fetchStub(indexFixture()) });
  assert.equal(entry.version, "1.0.0");
  assert.equal(category, "language");
  assert.equal(origin.name, "mgr");
});

test("resolve falha com registry não configurado ou skill ausente", async () => {
  await assert.rejects(
    resolve("@ghost/skill", [{ name: "mgr", url: INDEX_URL }], { fetchImpl: fetchStub(indexFixture()) }),
    /registry not configured for scope "@ghost"/,
  );
  await assert.rejects(
    resolve("@mgr/unknown", [{ name: "mgr", url: INDEX_URL }], { fetchImpl: fetchStub(indexFixture()) }),
    /skill not found in registry "mgr": @mgr\/unknown/,
  );
});

test("readDetectionMode: ausente é suggest, manual é aceito, auto é recusado com o motivo", () => {
  const core = diretorioTemporario();
  assert.equal(readDetectionMode(core), "suggest", "sem config, o default de D03");

  writeConfig(core, { registries: [], detectionMode: "manual" });
  assert.equal(readDetectionMode(core), "manual");

  writeConfig(core, { registries: [], detectionMode: "suggest" });
  assert.equal(readDetectionMode(core), "suggest");

  writeConfig(core, { registries: [], detectionMode: "auto" });
  assert.throws(() => readDetectionMode(core), /"auto" is not available yet.*mgr audit/s);

  writeConfig(core, { registries: [], detectionMode: "sugerir" });
  assert.throws(() => readDetectionMode(core), /invalid detectionMode: "sugerir"/);
});

test("o modo de detecção convive com os registries no mesmo config", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], detectionMode: "manual" });
  addRegistry(core, { name: "mgr", url: INDEX_URL });
  assert.equal(readDetectionMode(core), "manual", "addRegistry preserva o modo");
  assert.deepEqual(listRegistries(core).map((registry) => registry.name), ["mgr"]);
});

test("gate ausente no config vale o default do catálogo", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [] });
  assert.deepEqual(readAgents(core).policies.review, REVIEW_GATE.defaults);
});

test("override parcial do gate completa o default em vez de substituí-lo", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], reviewGate: { effort: "high" } });
  const { policies: { review: gate } } = readAgents(core);
  assert.equal(gate.effort, "high");
  assert.equal(gate.enabled, true, "o que não foi sobrescrito vem do default");
  assert.deepEqual(gate.model, {}, "o default não publica identificador de modelo");
});

test("gate desligado é lido como desligado", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], reviewGate: { enabled: false } });
  assert.equal(readAgents(core).policies.review.enabled, false);
});

test("enabled que não é booleano reprova", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], reviewGate: { enabled: "sim" } });
  assert.throws(() => readAgents(core), /invalid reviewGate\.enabled: "sim"/);
});

test("should name reviewGate when the read refuses an invalid alias", () => {
  const apelido = diretorioTemporario();
  writeConfig(apelido, { registries: [], reviewGate: { enabled: "sim" } });
  assert.throws(() => readAgents(apelido), { message: 'invalid reviewGate.enabled: "sim" (expected true | false)' });
  const chaveNova = diretorioTemporario();
  writeConfig(chaveNova, { registries: [], agents: { review: { enabled: "sim" } } });
  assert.throws(() => readAgents(chaveNova), { message: 'invalid agents.review.enabled: "sim" (expected true | false)' });
  const ambas = diretorioTemporario();
  writeConfig(ambas, { registries: [], reviewGate: { enabled: false }, agents: { review: { effort: "extreme" } } });
  assert.throws(() => readAgents(ambas), { message: 'invalid agents.review.effort: "extreme" (expected low | medium | high | xhigh | max | inherit)' });
});

test("effort fora da escala reprova com o valor na mensagem", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], reviewGate: { effort: "extreme" } });
  assert.throws(() => readAgents(core), /invalid reviewGate\.effort: "extreme"/);
});

test("effort xhigh é aceito depois da emenda ao ADR-0004", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], reviewGate: { effort: "xhigh" } });
  assert.equal(readAgents(core).policies.review.effort, "xhigh");
});

test("model como string ensina a forma de mapa em vez de só recusar", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], reviewGate: { model: "opus" } });
  assert.throws(() => readAgents(core), /expected a map of engine to model.*claude-code/s);
});

test("model com motor desconhecido reprova nomeando o motor", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], reviewGate: { model: { cursor: "opus" } } });
  assert.throws(() => readAgents(core), /unknown engine: cursor/);
});

test("identificador de modelo do usuário passa verbatim, sem lista fechada", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], reviewGate: { model: { copilot: "claude-sonnet-5" } } });
  const { policies: { review: gate } } = readAgents(core);
  assert.equal(gate.model.copilot, "claude-sonnet-5", "o identificador passa como foi escrito");
  assert.equal(gate.model["claude-code"], undefined,
    "nenhum default é inventado para o motor que o autor não nomeou");
});

test("model vazio para um motor reprova", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], reviewGate: { model: { "claude-code": "" } } });
  assert.throws(() => readAgents(core), /invalid reviewGate\.model\.claude-code/);
});

test("reviewGate que não é objeto reprova", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], reviewGate: "max" });
  assert.throws(() => readAgents(core), /invalid reviewGate: "max"/);
});

test("o gate sobrevive ao addRegistry, como o modo de detecção", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], reviewGate: { effort: "high" } });
  addRegistry(core, { name: "mgr", url: INDEX_URL });
  assert.equal(readAgents(core).policies.review.effort, "high");
});

test("preâmbulo ausente no config vale ligado", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [] });
  assert.deepEqual(readLawsPreamble(core), { enabled: true });
});

test("preâmbulo pode ser desligado, e sobrevive ao addRegistry", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], lawsPreamble: { enabled: false } });
  assert.equal(readLawsPreamble(core).enabled, false);
  addRegistry(core, { name: "mgr", url: INDEX_URL });
  assert.equal(readLawsPreamble(core).enabled, false, "o ajuste sobrevive à escrita do config");
});

test("o interruptor do preâmbulo é independente do gate de validação", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], lawsPreamble: { enabled: false }, reviewGate: { enabled: true } });
  assert.equal(readLawsPreamble(core).enabled, false);
  assert.equal(readAgents(core).policies.review.enabled, true, "desligar um não desliga o outro");
});

test("preâmbulo com valor inválido reprova com o valor na mensagem", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], lawsPreamble: { enabled: "sim" } });
  assert.throws(() => readLawsPreamble(core), /invalid lawsPreamble\.enabled: "sim"/);

  writeConfig(core, { registries: [], lawsPreamble: true });
  assert.throws(() => readLawsPreamble(core), /invalid lawsPreamble: true/);
});

// `readAgents` — a política de todas as intenções, com `reviewGate` como apelido (ADR-0017).
const FIXTURES_AGENTS = fileURLToPath(new URL("./fixtures/agents/", import.meta.url));
const configDaFixture = (nome) => JSON.parse(readFileSync(path.join(FIXTURES_AGENTS, nome), "utf8"));

test("sem `agents` no config, cada intenção vale o default do catálogo", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [] });
  const { policies, aliasOverridden } = readAgents(core);
  assert.deepEqual(Object.keys(policies), INTENTS);
  for (const intent of INTENTS) assert.deepEqual(policies[intent], AGENTS[intent].defaults);
  assert.equal(aliasOverridden, false);
});

test("config legado só com `reviewGate` produz a MESMA política de hoje", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], ...configDaFixture("config-legado.json") });
  const { policies, aliasOverridden } = readAgents(core);
  assert.equal(policies.review.effort, "max", "o apelido foi lido e obedecido");
  // A fixture DECLARA `opus`, que era o default antigo. Hoje isso é valor configurado, não default:
  // o catálogo deixou de publicar identificador de modelo (ADR-0017, emenda ao ADR-0010).
  assert.equal(policies.review.model["claude-code"], "opus", "o que o config legado escreveu vale");
  assert.deepEqual(REVIEW_GATE.defaults.model, {}, "e o default, este sim, não publica nada");
  assert.equal(aliasOverridden, false, "sem `agents.review`, o apelido não está sendo sobreposto");
});

test("com as duas chaves, `agents` vence E o conflito volta para a borda avisar", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], ...configDaFixture("config-conflito.json") });
  const { policies, aliasOverridden } = readAgents(core);
  assert.equal(policies.review.model["claude-code"], "opus", "`agents.review` vence o `reviewGate`");
  assert.equal(policies.review.effort, "max");
  assert.equal(aliasOverridden, true, "resolver em silêncio seria escolher pelo autor sem lhe dizer");
  assert.equal(readAgents(core).sources.review.effort, CONFIGURED, "o apelido foi escrito pelo autor");
});

test("as três intenções da fixture de conflito chegam com a política declarada", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], ...configDaFixture("config-conflito.json") });
  const { policies } = readAgents(core);
  assert.equal(policies.drafting.model["claude-code"], "opus");
  assert.equal(policies.drafting.effort, "high");
  assert.equal(policies.execution.model["claude-code"], "haiku");
  assert.equal(policies.execution.effort, "low");
});

test("override parcial de uma intenção não apaga o default do outro motor", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { execution: { model: { copilot: "gpt-5" } } } });
  const { policies } = readAgents(core);
  assert.equal(policies.execution.model.copilot, "gpt-5");
  assert.deepEqual(Object.keys(policies.execution.model), ["copilot"],
    "o default não traz motor nenhum, então só o escrito aparece");
  assert.equal(policies.execution.effort, "low", "o que não foi escrito vem do default");
});

test("intenção desconhecida reprova dizendo quais existem", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { revisao: {} } });
  assert.throws(() => readAgents(core), /unknown agent intent\(s\): revisao \(expected drafting \| execution \| review\)/);
});

test("a mensagem de erro nomeia o caminho REAL no config", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { drafting: { effort: "extreme" } } });
  assert.throws(() => readAgents(core), /invalid agents\.drafting\.effort: "extreme"/);
});

test("`agents` que não é objeto reprova antes de olhar intenção nenhuma", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: "opus" });
  assert.throws(() => readAgents(core), /invalid agents: "opus" \(expected an object\)/);
});

// `sources` — de onde veio cada valor (ADR-0017, CA-5).

test("sem nada configurado, toda origem é o default do catálogo", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [] });
  const { sources } = readAgents(core);
  for (const intent of INTENTS) {
    assert.equal(sources[intent].enabled, DEFAULT, intent);
    assert.equal(sources[intent].effort, DEFAULT, intent);
    assert.deepEqual(sources[intent].model, {}, `${intent}: sem modelo publicado, nada a atribuir`);
  }
});

test("valor escrito pelo autor sai como configurado, e só ele", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { drafting: { effort: "max" } } });
  const { sources } = readAgents(core);
  assert.equal(sources.drafting.effort, CONFIGURED, "foi ele quem escreveu");
  assert.equal(sources.drafting.enabled, DEFAULT, "o que não foi escrito não vira escolha dele");
  assert.deepEqual(sources.drafting.model, {}, "nenhum motor tem modelo, configurado ou default");
  assert.equal(sources.execution.effort, DEFAULT, "outra intenção não é contaminada");
});

test("a origem do `model` é POR MOTOR, porque o override é por motor", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { execution: { model: { copilot: "gpt-5" } } } });
  const { sources } = readAgents(core);
  assert.equal(sources.execution.model.copilot, CONFIGURED);
  assert.equal(sources.execution.model["claude-code"], undefined,
    "sem default publicado, o motor não escrito nem aparece");
});

test("o apelido `reviewGate` conta como CONFIGURADO", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], reviewGate: { effort: "high" } });
  const { sources } = readAgents(core);
  assert.equal(sources.review.effort, CONFIGURED,
    "chamar de default diria ao autor que ele não escolheu o que escolheu");
});

test("com as duas chaves, a origem é a de `agents`, que foi quem venceu", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], ...configDaFixture("config-conflito.json") });
  const { policies, sources } = readAgents(core);
  assert.equal(policies.review.effort, "max");
  assert.equal(sources.review.effort, CONFIGURED, "os dois foram escritos; a origem é de quem valeu");
});

test("a origem não diz nada sobre capacidade de motor — isso é do gateSummary", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [] });
  const { sources } = readAgents(core);
  // Misturar as duas faria "não configurado" e "não suportado" virarem a mesma palavra.
  const valores = new Set(Object.values(sources.review.model));
  for (const valor of valores) assert.ok([CONFIGURED, DEFAULT].includes(valor), valor);
});

// `budget` — chave reservada sob `agents` (ADR-0017). O defeito que ela conserta: o config que a
// spec e o ADR documentam derrubava `install`, `update` e `agents`.

test("o teto documentado pela spec NÃO derruba a leitura", () => {
  const core = diretorioTemporario();
  writeConfig(core, {
    registries: [],
    agents: { budget: { totalTokens: 500000 }, execution: { model: { "claude-code": "haiku" } } },
  });
  const { budget, policies } = readAgents(core);
  assert.deepEqual(budget, { totalTokens: 500000 });
  assert.equal(policies.execution.model["claude-code"], "haiku", "a intenção ao lado segue lida");
});

test("sem `budget`, o teto é ausente — e ausência NÃO é zero", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [] });
  assert.equal(readAgents(core).budget, null, "zero é um teto que reprova tudo; ausência não reprova nada");
});

test("`budget` sem `totalTokens` é objeto válido com teto ausente", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { budget: {} } });
  assert.deepEqual(readAgents(core).budget, { totalTokens: null });
});

test("teto zero é aceito, porque zero é um teto", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { budget: { totalTokens: 0 } } });
  assert.deepEqual(readAgents(core).budget, { totalTokens: 0 });
});

test("intenção desconhecida DE VERDADE continua sendo recusada", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { revisao: {} } });
  assert.throws(() => readAgents(core), /unknown agent intent\(s\): revisao/);
  assert.ok(!RESERVED_AGENT_KEYS.includes("revisao"));
});

test("`budget` malformado reprova com o caminho REAL na mensagem", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { budget: 500000 } });
  assert.throws(() => readAgents(core), /invalid agents\.budget: 500000 \(expected an object\)/);

  const outro = diretorioTemporario();
  writeConfig(outro, { registries: [], agents: { budget: { totalTokens: -1 } } });
  assert.throws(() => readAgents(outro), /invalid agents\.budget\.totalTokens: -1 \(expected a non-negative integer\)/);

  const terceiro = diretorioTemporario();
  writeConfig(terceiro, { registries: [], agents: { budget: { totalTokens: "500k" } } });
  assert.throws(() => readAgents(terceiro), /invalid agents\.budget\.totalTokens: "500k"/);
});

// `inherit` — a forma de o autor dizer "não declare este campo" (ADR-0017, pedido para os motores
// que ainda vão entrar).

test("`effort: inherit` é aceito e vira AUSÊNCIA do campo", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { review: { effort: "inherit" } } });
  const { policies } = readAgents(core);
  assert.equal(Object.hasOwn(policies.review, "effort"), false,
    "herdar é não ter valor, e quem consome já sabe omitir o que não tem");
});

test("`model: inherit` por motor vira ausência daquele motor, sem mexer nos outros", () => {
  const core = diretorioTemporario();
  writeConfig(core, {
    registries: [],
    agents: { execution: { model: { "claude-code": "inherit", copilot: "gpt-5" } } },
  });
  const { policies } = readAgents(core);
  assert.deepEqual(policies.execution.model, { copilot: "gpt-5" });
});

test("esforço fora da escala continua reprovando, e a mensagem inclui `inherit`", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { review: { effort: "extremo" } } });
  assert.throws(() => readAgents(core), /invalid agents\.review\.effort: "extremo"/);
  assert.throws(() => readAgents(core), /inherit/, "a saída ensina o valor que desliga o campo");
});

test("modelo vazio continua reprovando — vazio não é herdar", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { review: { model: { "claude-code": "" } } } });
  assert.throws(() => readAgents(core), /invalid agents\.review\.model\.claude-code: ""/);
});

// `writeAgentPolicy` — a escrita da política de uma intenção.
const configCheio = (core) => writeConfig(core, {
  registries: [{ name: "mgr", url: INDEX_URL, trusted: false }],
  lawsPreamble: { enabled: false },
  reviewGate: { effort: "high" },
  agents: { budget: { totalTokens: 900 }, execution: { model: { copilot: "gpt-5" } } },
});

test("escrever um motor NÃO apaga o modelo de outro já declarado", () => {
  const core = diretorioTemporario();
  configCheio(core);
  writeAgentPolicy(core, "execution", { model: { "claude-code": "haiku" } });
  const { policies } = readAgents(core);
  assert.deepEqual(policies.execution.model, { copilot: "gpt-5", "claude-code": "haiku" });
});

test("escrever uma intenção não altera as outras", () => {
  const core = diretorioTemporario();
  configCheio(core);
  writeAgentPolicy(core, "drafting", { model: { "claude-code": "opus" } });
  const { policies } = readAgents(core);
  assert.equal(policies.drafting.model["claude-code"], "opus");
  assert.deepEqual(policies.execution.model, { copilot: "gpt-5" }, "a vizinha ficou como estava");
  assert.deepEqual(policies.review.model, {}, "e a que ninguém tocou segue sem modelo");
});

test("as chaves vizinhas do config sobrevivem à escrita", () => {
  const core = diretorioTemporario();
  configCheio(core);
  writeAgentPolicy(core, "drafting", { effort: "max" });
  const config = readConfig(core);
  assert.equal(config.registries.length, 1, "registries");
  assert.equal(config.lawsPreamble.enabled, false, "lawsPreamble");
  assert.deepEqual(config.reviewGate, { effort: "high" }, "escrever outra intenção não toca o apelido");
  assert.deepEqual(config.agents.budget, { totalTokens: 900 }, "budget");
});

test("só o campo pedido é tocado", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { review: { model: { "claude-code": "opus" }, effort: "max" } } });
  writeAgentPolicy(core, "review", { effort: "low" });
  const { policies } = readAgents(core);
  assert.equal(policies.review.effort, "low", "o que foi pedido mudou");
  assert.equal(policies.review.model["claude-code"], "opus", "o que não foi pedido ficou");
});

test("`inherit` grava e some na leitura, nos dois campos", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { review: { model: { "claude-code": "opus" }, effort: "max" } } });
  writeAgentPolicy(core, "review", { model: { "claude-code": "inherit" }, effort: "inherit" });
  const { policies } = readAgents(core);
  assert.deepEqual(policies.review.model, {}, "o motor marcado some do mapa");
  assert.equal(Object.hasOwn(policies.review, "effort"), false, "e o campo some inteiro");
});

test("desfazer uma intenção não desfaz as outras", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: {
    drafting: { model: { "claude-code": "opus" } },
    execution: { model: { "claude-code": "haiku" } },
  } });
  writeAgentPolicy(core, "drafting", { model: { "claude-code": "inherit" } });
  const { policies } = readAgents(core);
  assert.deepEqual(policies.drafting.model, {});
  assert.equal(policies.execution.model["claude-code"], "haiku");
});

test("a escrita devolve o que passou a valer", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [] });
  const { policy } = writeAgentPolicy(core, "execution", { model: { "claude-code": "sonnet" } });
  assert.equal(policy.model["claude-code"], "sonnet");
  assert.equal(policy.effort, "low", "o que não foi escrito vem do default");
});

test("intenção desconhecida é recusada, e nada é gravado", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [] });
  assert.throws(() => writeAgentPolicy(core, "revisao", { effort: "max" }),
    /unknown agent intent: "revisao" \(expected drafting \| execution \| review\)/);
  assert.equal(Object.hasOwn(readConfig(core), "agents"), false, "config intocado");
});

test("escrita sem campo nenhum é recusada", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [] });
  assert.throws(() => writeAgentPolicy(core, "review", {}),
    /nothing to write for agents\.review/);
  assert.throws(() => writeAgentPolicy(core, "review"), /nothing to write/);
});

test("valor inválido reprova ANTES de gravar, e o config não quebra", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [] });
  assert.throws(() => writeAgentPolicy(core, "review", { effort: "extremo" }),
    /invalid agents\.review\.effort: "extremo"/);
  assert.equal(Object.hasOwn(readConfig(core), "agents"), false,
    "gravar e só descobrir na leitura seguinte deixaria o config quebrado pela mão do método");
});

test("identificador de modelo desconhecido é ACEITO — a lista é da conta", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [] });
  const { policy } = writeAgentPolicy(core, "drafting", { model: { "claude-code": "modelo-que-so-existe-na-minha-conta" } });
  assert.equal(policy.model["claude-code"], "modelo-que-so-existe-na-minha-conta");
});

test("should write the review policy on top of the whole reviewGate and remove the key", () => {
  const core = diretorioTemporario();
  writeConfig(core, {
    registries: [],
    reviewGate: { enabled: false, model: { "claude-code": "opus" }, effort: "high", nota: "x" },
  });
  const { migration } = writeAgentPolicy(core, "review", { model: { copilot: "gpt-5" } });
  const config = readConfig(core);
  assert.deepEqual(config.agents.review, {
    enabled: false, model: { "claude-code": "opus", copilot: "gpt-5" }, effort: "high", nota: "x",
  });
  assert.equal(Object.hasOwn(config, "reviewGate"), false);
  assert.deepEqual(config.registries, []);
  assert.deepEqual(migration, {
    state: "migrated",
    kept: [
      { field: "enabled", value: false },
      { field: "model.claude-code", value: "opus" },
      { field: "effort", value: "high" },
      { field: "nota", value: "x" },
    ],
    replaced: [],
  });
  const lido = readAgents(core);
  assert.equal(lido.policies.review.enabled, false);
  assert.equal(lido.aliasOverridden, false);
});

test("should let the requested field win over the same reviewGate field and report kept and replaced", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], reviewGate: { enabled: false, effort: "high" } });
  const { migration } = writeAgentPolicy(core, "review", { effort: "max" });
  assert.deepEqual(readConfig(core).agents.review, { enabled: false, effort: "max" });
  assert.deepEqual(migration, {
    state: "migrated",
    kept: [{ field: "enabled", value: false }],
    replaced: [{ field: "effort", from: "high", to: "max" }],
  });
});

test("should migrate an empty reviewGate and report nothing kept", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], reviewGate: {} });
  const { migration } = writeAgentPolicy(core, "review", { effort: "max" });
  const config = readConfig(core);
  assert.deepEqual(config.agents.review, { effort: "max" });
  assert.equal(Object.hasOwn(config, "reviewGate"), false);
  assert.deepEqual(migration, { state: "migrated", kept: [], replaced: [] });
});

test("should keep a hand-written conflict as it is when agents.review already exists", () => {
  const core = diretorioTemporario();
  const fixture = configDaFixture("config-conflito.json");
  writeConfig(core, { registries: [], ...fixture });
  const { migration } = writeAgentPolicy(core, "review", { effort: "low" });
  const config = readConfig(core);
  assert.deepEqual(config.reviewGate, fixture.reviewGate);
  assert.equal(config.agents.review.effort, "low");
  assert.equal(config.agents.review.model["claude-code"], "opus");
  assert.equal(migration.state, "none");
  assert.equal(readAgents(core).aliasOverridden, true);
});

test("should write the same bytes as before when there is no reviewGate", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { execution: { effort: "low" } } });
  const { migration } = writeAgentPolicy(core, "review", { effort: "max" });
  const esperado = JSON.stringify(
    { registries: [], agents: { execution: { effort: "low" }, review: { effort: "max" } } }, null, 2,
  ) + "\n";
  assert.equal(readFileSync(configPath(core), "utf8"), esperado);
  assert.equal(migration.state, "none");
});

const REVIEW_GATE_INVALIDOS = [
  ["max", 'invalid reviewGate: "max" (expected an object)'],
  [{ enabled: "sim" }, 'invalid reviewGate.enabled: "sim" (expected true | false)'],
  [{ effort: "extreme" }, 'invalid reviewGate.effort: "extreme" (expected low | medium | high | xhigh | max | inherit)'],
  [{ model: "opus" }, 'invalid reviewGate.model: "opus" (expected a map of engine to model, e.g. {"claude-code": "opus"})'],
];

for (const [caso, mensagem] of REVIEW_GATE_INVALIDOS) {
  test(`should refuse the invalid reviewGate ${JSON.stringify(caso)} naming it and write nothing`, () => {
    const core = diretorioTemporario();
    writeConfig(core, { registries: [], reviewGate: caso });
    const antes = readFileSync(configPath(core), "utf8");
    assert.throws(() => writeAgentPolicy(core, "review", { effort: "max" }), { message: mensagem });
    assert.equal(readFileSync(configPath(core), "utf8"), antes);
  });
}

test("should report replaced and kept fields of the reviewGate by what was requested", () => {
  const migrar = (reviewGate, pedido) => {
    const core = diretorioTemporario();
    writeConfig(core, { registries: [], reviewGate });
    return writeAgentPolicy(core, "review", pedido).migration;
  };
  assert.deepEqual(migrar({ enabled: false, effort: "high" }, { model: { "claude-code": "opus" } }), {
    state: "migrated",
    kept: [{ field: "enabled", value: false }, { field: "effort", value: "high" }],
    replaced: [],
  }, "campo não pedido fica");
  assert.deepEqual(migrar({ effort: "high" }, { effort: "max" }), {
    state: "migrated",
    kept: [],
    replaced: [{ field: "effort", from: "high", to: "max" }],
  }, "pedido diferente substitui");
  assert.deepEqual(migrar({ effort: "high" }, { effort: "high" }), {
    state: "migrated",
    kept: [{ field: "effort", value: "high" }],
    replaced: [],
  }, "pedido igual fica");
  assert.deepEqual(migrar({ model: { "claude-code": "opus" } }, { model: { "claude-code": "haiku", copilot: "gpt-5" } }), {
    state: "migrated",
    kept: [],
    replaced: [{ field: "model.claude-code", from: "opus", to: "haiku" }],
  }, "motor novo não entra em lista nenhuma");
});

const ESCRITA_SOBRE_NAO_OBJETO = [
  ["agents", { agents: "x", reviewGate: { enabled: false } }, 'invalid agents: "x" (expected an object)'],
  ["agents.review", { agents: { review: "x" } }, 'invalid agents.review: "x" (expected an object)'],
  ["agents number", { agents: 5 }, "invalid agents: 5 (expected an object)"],
];

for (const [caminho, extra, mensagem] of ESCRITA_SOBRE_NAO_OBJETO) {
  test(`should refuse to write over a non-object ${caminho} and write nothing`, () => {
    const core = diretorioTemporario();
    writeConfig(core, { registries: [], ...extra });
    const antes = readFileSync(configPath(core), "utf8");
    assert.throws(() => writeAgentPolicy(core, "review", { effort: "max" }), { message: mensagem });
    assert.equal(readFileSync(configPath(core), "utf8"), antes);
  });
}

test("should refuse an invalid requested effort over a valid reviewGate and keep the file", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], reviewGate: { enabled: false } });
  const antes = readFileSync(configPath(core), "utf8");
  assert.throws(() => writeAgentPolicy(core, "review", { effort: "extremo" }), {
    message: 'invalid agents.review.effort: "extremo" (expected low | medium | high | xhigh | max | inherit)',
  });
  assert.equal(readFileSync(configPath(core), "utf8"), antes);
});

test("should migrate an inherit effort from reviewGate", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], reviewGate: { enabled: false, effort: "inherit" } });
  const { migration } = writeAgentPolicy(core, "review", { model: { "claude-code": "opus" } });
  const config = readConfig(core);
  assert.deepEqual(config.agents.review, { enabled: false, effort: "inherit", model: { "claude-code": "opus" } });
  assert.equal(Object.hasOwn(config, "reviewGate"), false);
  assert.deepEqual(migration, {
    state: "migrated",
    kept: [{ field: "enabled", value: false }, { field: "effort", value: "inherit" }],
    replaced: [],
  });
});

test("should treat a null agents.review as absent and migrate the reviewGate when writing", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { review: null }, reviewGate: { enabled: false } });
  const { migration } = writeAgentPolicy(core, "review", { effort: "max" });
  const config = readConfig(core);
  assert.deepEqual(config.agents.review, { enabled: false, effort: "max" });
  assert.equal(Object.hasOwn(config, "reviewGate"), false);
  assert.deepEqual(migration, { state: "migrated", kept: [{ field: "enabled", value: false }], replaced: [] });
});

test("should let the write fix the invalid field it replaces", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { review: { effort: "extremo" } } });
  const { migration } = writeAgentPolicy(core, "review", { effort: "max" });
  assert.deepEqual(readConfig(core).agents.review, { effort: "max" });
  assert.deepEqual(migration, { state: "none" });
});

test("should let a model request fix the invalid model of the engine it replaces", () => {
  const vazio = diretorioTemporario();
  writeConfig(vazio, { registries: [], agents: { review: { model: { "claude-code": "" } } } });
  writeAgentPolicy(vazio, "review", { model: { "claude-code": "opus" } });
  assert.deepEqual(readConfig(vazio).agents.review, { model: { "claude-code": "opus" } });
  const nulo = diretorioTemporario();
  writeConfig(nulo, { registries: [], agents: { review: { model: null } } });
  writeAgentPolicy(nulo, "review", { model: { "claude-code": "opus" } });
  assert.deepEqual(readConfig(nulo).agents.review, { model: { "claude-code": "opus" } });
});

test("should treat a null agents.review as absent when writing without reviewGate", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { review: null } });
  const { migration } = writeAgentPolicy(core, "review", { effort: "max" });
  assert.deepEqual(readConfig(core).agents.review, { effort: "max" });
  assert.deepEqual(migration, { state: "none" });
});

test("should check the base model shape only when a model is requested", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { review: { enabled: "sim", model: "opus" } } });
  assert.throws(() => writeAgentPolicy(core, "review", { effort: "max" }), { message: 'invalid agents.review.enabled: "sim" (expected true | false)' });
});

test("should refuse an empty or repeated list of requests and write nothing", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [] });
  const antes = readFileSync(configPath(core), "utf8");
  assert.throws(() => writeAgentPolicies(core, []), { message: "nothing to write for agents (expected at least one intent)" });
  assert.throws(
    () => writeAgentPolicies(core, [["review", { model: { "claude-code": "opus" } }], ["review", { effort: "max" }]]),
    { message: 'agent intent requested twice: "review"' },
  );
  assert.equal(readFileSync(configPath(core), "utf8"), antes);
});

test("should refuse the write when an invalid field stays in the result", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { review: { effort: "extremo" } } });
  const antes = readFileSync(configPath(core), "utf8");
  assert.throws(() => writeAgentPolicy(core, "review", { model: { "claude-code": "opus" } }), {
    message: 'invalid agents.review.effort: "extremo" (expected low | medium | high | xhigh | max | inherit)',
  });
  assert.equal(readFileSync(configPath(core), "utf8"), antes);
});

test("should not report the alias as overridden when agents.review is null", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { review: null }, reviewGate: { enabled: false } });
  const { policies, aliasOverridden } = readAgents(core);
  assert.equal(aliasOverridden, false);
  assert.equal(policies.review.enabled, false);
});

test("should refuse a request of the wrong type instead of ignoring it", () => {
  assert.throws(() => requestOf({ review: "opus" }, {}, "review"), { message: 'invalid model request for review: "opus" (expected a map of engine to model)' });
  assert.throws(() => requestOf({}, { review: 5 }, "review"), { message: "invalid effort request for review: 5 (expected a level name)" });
  assert.deepEqual(requestOf({ review: {} }, { review: "" }, "review"), {});
});

test("should refuse to write any intent over a config the read refuses", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], reviewGate: { enabled: "sim" } });
  const antes = readFileSync(configPath(core), "utf8");
  assert.throws(() => writeAgentPolicy(core, "drafting", { effort: "max" }), {
    message: 'invalid reviewGate.enabled: "sim" (expected true | false)',
  });
  assert.equal(readFileSync(configPath(core), "utf8"), antes);
});

test("should refuse a non-map agents.review.model before merging", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { review: { model: "opus" } } });
  const antes = readFileSync(configPath(core), "utf8");
  assert.throws(() => writeAgentPolicy(core, "review", { model: { "claude-code": "haiku" } }), {
    message: 'invalid agents.review.model: "opus" (expected a map of engine to model, e.g. {"claude-code": "opus"})',
  });
  assert.equal(readFileSync(configPath(core), "utf8"), antes);
});

test("should name reviewGate when agents.review is null and the alias is invalid", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], agents: { review: null }, reviewGate: { enabled: "sim" } });
  assert.throws(() => readAgents(core), { message: 'invalid reviewGate.enabled: "sim" (expected true | false)' });
});

test("writeOrigin grava a origem e devolve ausente quando a chave nunca existiu", () => {
  const core = diretorioTemporario();
  const resultado = writeOrigin(core, "brownfield");
  assert.deepEqual(resultado, { antes: { estado: "ausente" }, depois: "brownfield" });
  assert.equal(readConfig(core).origin, "brownfield");
});

test("writeOrigin devolve o valor anterior quando ja havia um valido", () => {
  const core = diretorioTemporario();
  writeOrigin(core, "greenfield");
  const resultado = writeOrigin(core, "brownfield");
  assert.deepEqual(resultado.antes, { estado: "gravado", valor: "greenfield" });
  assert.equal(resultado.depois, "brownfield");
});

test("writeOrigin distingue lixo em disco de ausencia, sem devolver sentinela", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], origin: "xpto" });
  const resultado = writeOrigin(core, "greenfield");
  assert.deepEqual(resultado.antes, { estado: "invalido", valor: "xpto" },
    "ausencia e lixo sao estados diferentes, e `null` para os dois apagaria a diferenca");
});

test("writeOrigin preserva todas as outras chaves do config", () => {
  const core = diretorioTemporario();
  const antes = {
    registries: [{ name: "mgr", url: INDEX_URL, trusted: true }],
    agents: { drafting: { effort: "high" } },
    reviewGate: { enabled: true },
    detectionMode: "suggest",
    lawsPreamble: "always",
  };
  writeConfig(core, antes);
  writeOrigin(core, "brownfield");
  const depois = readConfig(core);
  for (const chave of Object.keys(antes)) {
    assert.deepEqual(depois[chave], antes[chave], chave);
  }
  assert.equal(depois.origin, "brownfield");
});

test("negativo: valor fora do vocabulario lanca e NAO toca no arquivo", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], detectionMode: "off" });
  const antes = readFileSync(configPath(core), "utf8");
  assert.throws(() => writeOrigin(core, "legacy"), /unknown project origin/);
  assert.equal(readFileSync(configPath(core), "utf8"), antes,
    "validar depois de gravar deixaria o arquivo mudado mesmo com o comando falhando");
});

test("negativo: ORIGINS tem exatamente os dois valores gravaveis", () => {
  assert.deepEqual(ORIGINS, ["greenfield", "brownfield"],
    "um terceiro valor gravavel convidaria a grava-lo como default, e default silencioso e o que a fatia proibe");
});
