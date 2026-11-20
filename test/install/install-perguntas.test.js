// Perguntas de modelo por intenção e motor, e de origem, do `install` (DT-7).
// O `ask` é stub injetado (TST-2: stub só na borda de terminal). Cada resposta é escolhida pela
// mensagem exata da pergunta, e pergunta inesperada derruba o teste em vez de receber valor padrão.
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectInstallAnswers, CANCELLED } from "../../src/install/prompts.js";
import { getMessages } from "../../src/core/messages.js";
import { parseArgs, resolveModelFlags } from "../../src/core/cli-args.js";

const msg = getMessages("en");

// `responder(message, tipo)` devolve a resposta; o stub registra cada chamada para a asserção.
function stubAsk(responder) {
  const chamadas = [];
  const perguntar = (tipo) => async (opcoes) => {
    chamadas.push({ tipo, ...opcoes });
    return responder(opcoes.message, tipo);
  };
  const ask = {
    multiselect: async () => { throw new Error("multiselect não deveria ser chamado"); },
    select: perguntar("select"),
    text: perguntar("text"),
    confirm: async () => { throw new Error("confirm não deveria ser chamado"); },
    isCancel: () => false,
  };
  return { ask, chamadas };
}

// Respostas que já vêm de flag: o install só pergunta modelo e origem.
const jaRespondido = (engines) => ({ engines, scope: "project", userLanguage: "en", projectId: "projeto" });
const opcoesSemDefault = { repo: ".", allSkills: true, msg };

const perguntaModelo = (intent, engine) => msg.qModel(intent, engine);

test("should offer the documented claude-code models plus other and skip with skip preselected", async () => {
  const { ask, chamadas } = stubAsk(() => "skip");
  await collectInstallAnswers(ask, jaRespondido(["claude-code"]), opcoesSemDefault);

  const modelo = chamadas.find((c) => c.message === perguntaModelo("drafting", "claude-code"));
  assert.deepEqual(
    modelo.options.map((opcao) => opcao.value),
    ["sonnet", "opus", "haiku", "fable", "other", "skip"],
  );
  assert.equal(modelo.initialValue, "skip");
  for (const chamada of chamadas.filter((c) => ![msg.qOrigin, msg.qRuntimeVersioning].includes(c.message))) {
    assert.equal(chamada.initialValue, "skip", chamada.message);
  }
});

test("should offer only other and skip for copilot", async () => {
  const { ask, chamadas } = stubAsk(() => "skip");
  await collectInstallAnswers(ask, jaRespondido(["copilot"]), opcoesSemDefault);

  const modelo = chamadas.find((c) => c.message === perguntaModelo("review", "copilot"));
  assert.deepEqual(modelo.options.map((opcao) => opcao.value), ["other", "skip"]);
  assert.equal(modelo.initialValue, "skip");
});

test("should record nothing for skip", async () => {
  const { ask } = stubAsk(() => "skip");
  const out = await collectInstallAnswers(ask, jaRespondido(["claude-code", "copilot"]), opcoesSemDefault);

  assert.deepEqual(out.models, {});
  assert.deepEqual(out.efforts, {});
  assert.equal(out.origin, null);
});

test("should record nothing for other with empty text", async () => {
  const { ask, chamadas } = stubAsk((message, tipo) => {
    if (tipo === "text") return "";
    return message === msg.qOrigin ? "skip" : "other";
  });
  const out = await collectInstallAnswers(ask, jaRespondido(["claude-code"]), opcoesSemDefault);

  assert.equal(chamadas.filter((c) => c.tipo === "text").length, 3, "um identificador por intenção");
  assert.deepEqual(out.models, {});
});

test("should record the chosen model per intent and engine", async () => {
  const { ask } = stubAsk((message) => {
    if (message === msg.qOrigin) return "brownfield";
    if (message === perguntaModelo("drafting", "claude-code")) return "opus";
    if (message === perguntaModelo("review", "claude-code")) return "other";
    return "skip";
  });
  ask.text = async () => "  meu-modelo-proprio  ";
  const out = await collectInstallAnswers(ask, jaRespondido(["claude-code"]), opcoesSemDefault);

  assert.deepEqual(out.models, {
    drafting: { "claude-code": "opus" },
    review: { "claude-code": "meu-modelo-proprio" },
  });
  assert.equal(out.origin, "brownfield");
});

test("should not ask for an intent and engine already configured", async () => {
  const configured = {
    drafting: { model: { "claude-code": "configured" } },
    execution: { model: { "claude-code": "default" } },
    review: { model: { "claude-code": "default" } },
  };
  const { ask, chamadas } = stubAsk(() => "skip");
  await collectInstallAnswers(ask, jaRespondido(["claude-code"]), { ...opcoesSemDefault, configured });

  const perguntadas = chamadas.map((c) => c.message);
  assert.ok(!perguntadas.includes(perguntaModelo("drafting", "claude-code")), "drafting já configurado");
  assert.ok(perguntadas.includes(perguntaModelo("execution", "claude-code")));
  assert.ok(perguntadas.includes(perguntaModelo("review", "claude-code")));
});

test("should not ask the origin when it is recorded", async () => {
  const { ask, chamadas } = stubAsk(() => "skip");
  const out = await collectInstallAnswers(ask, jaRespondido(["copilot"]), { ...opcoesSemDefault, originRecorded: true });

  assert.ok(!chamadas.some((c) => c.message === msg.qOrigin), "origem já registrada não é perguntada");
  assert.equal(out.origin, null);
});

// Flags de modelo do install não interativo (DT-8, D-12): valor solto só com um motor que sustenta modelo.
const soClaudeCode = (motor) => motor === "claude-code";
const todosSustentam = () => true;

test("should accept a bare model value with a single model-capable engine", () => {
  const resultado = resolveModelFlags(
    { modelDrafting: "opus" },
    { engines: ["claude-code", "copilot"], supportsModel: soClaudeCode },
  );
  assert.deepEqual(resultado, { ok: true, models: { drafting: { "claude-code": "opus" } } });
});

test("should refuse a bare model value with two model-capable engines", () => {
  const resultado = resolveModelFlags(
    { modelDrafting: "opus" },
    { engines: ["claude-code", "copilot"], supportsModel: todosSustentam },
  );
  assert.deepEqual(resultado, { ok: false, reason: "bare-value-many-engines", intent: "drafting" });
});

test("should parse the per-engine form for both engines", () => {
  const resultado = resolveModelFlags(
    { modelDrafting: "claude-code=opus,copilot=gpt-x" },
    { engines: ["claude-code", "copilot"], supportsModel: todosSustentam },
  );
  assert.deepEqual(resultado, {
    ok: true,
    models: { drafting: { "claude-code": "opus", copilot: "gpt-x" } },
  });
});

test("should refuse an engine that was not chosen", () => {
  const resultado = resolveModelFlags(
    { modelReview: "copilot=gpt-x" },
    { engines: ["claude-code"], supportsModel: todosSustentam },
  );
  assert.deepEqual(resultado, { ok: false, reason: "engine-not-chosen", intent: "review", engine: "copilot" });
});

test("should parse --origin as a raw value", () => {
  const { flags, unknownFlag } = parseArgs(["--origin", "legacy", "--model-review", "sonnet"], {
    engines: ["claude-code"],
  });
  assert.equal(unknownFlag, null);
  assert.equal(flags.origin, "legacy", "o parser não valida ORIGINS: a borda decide");
  assert.equal(flags.modelReview, "sonnet");
});

test("should refuse a malformed model flag before anything is written", () => {
  const options = { engines: ["claude-code", "copilot"], supportsModel: () => true };
  const single = { engines: ["claude-code"], supportsModel: () => true };
  for (const value of ["claude-code=opus,copilot", "claude-code=", "=opus"]) {
    assert.deepEqual(resolveModelFlags({ modelReview: value }, options), { ok: false, reason: "malformed", intent: "review", value }, value);
  }
  assert.deepEqual(resolveModelFlags({ modelReview: "opus,haiku" }, single), { ok: false, reason: "malformed", intent: "review", value: "opus,haiku" });
});

// Razão atualizada (X-22): nenhum motor escolhido aceita modelo é `no-model-engine`, não `malformed`.
test("should refuse a bare model value when no chosen engine takes a model", () => {
  assert.deepEqual(
    resolveModelFlags({ modelDrafting: "opus" }, { engines: ["custom"], supportsModel: () => false }),
    { ok: false, reason: "no-model-engine", intent: "drafting" },
  );
});

test("should report malformed with the raw value when a bare model value is empty", () => {
  assert.deepEqual(
    resolveModelFlags({ modelDrafting: "" }, { engines: ["claude-code"], supportsModel: soClaudeCode }),
    { ok: false, reason: "malformed", intent: "drafting", value: "" },
  );
});

test("should report no-model-engine instead of malformed for a bare value and no capable engine", () => {
  const resultado = resolveModelFlags({ modelDrafting: "" }, { engines: ["custom"], supportsModel: () => false });
  assert.notEqual(resultado.reason, "malformed", "sem motor que aceite modelo, a razão é outra");
  assert.equal(resultado.reason, "no-model-engine");
});

// --- Borda do install (P1.6): processos filhos, fora de git, sem importar nada do núcleo ---
import fs from "node:fs";
import path from "node:path";
import { runMgr, tempOutsideGit as tempOutsideGitIn } from "../helpers/cli.js";

const tempOutsideGit = (label) => tempOutsideGitIn(label, "mgr-p16");

function installProcess(args) {
  const project = tempOutsideGit("proj");
  const home = tempOutsideGit("home");
  const result = runMgr(["install", "--scope", "project", "--all-skills", ...args, "-y", project], { cwd: project, home });
  return { project, result };
}

const readConfigOf = (project) => JSON.parse(fs.readFileSync(path.join(project, ".mgr-core", "config.json"), "utf8"));

test("should exit 1 and write nothing for an unknown origin", () => {
  const { project, result } = installProcess(["--engine", "claude-code", "--origin", "legacy"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  // A recusa tem de vir da validação ANTECIPADA da borda (sem aspas no valor), e não da segunda defesa
  // do `writeOrigin` (com aspas): numa reinstalação, a remoção e o `migrateOld` rodam antes dele.
  assert.match(result.stderr, /unknown project origin: legacy \(expected greenfield \| brownfield\)/);
  assert.equal(fs.existsSync(path.join(project, ".mgr-core")), false);
});

test("should exit 1 and write nothing for a bare model value with two engines", () => {
  const { project, result } = installProcess(["--engine", "both", "--model-drafting", "opus"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /claude-code=/);
  assert.equal(fs.existsSync(path.join(project, ".mgr-core")), false);
});

test("should record per-engine models for both engines", () => {
  const { project, result } = installProcess(["--engine", "both", "--model-drafting", "claude-code=opus,copilot=gpt-x"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(readConfigOf(project).agents.drafting.model, { "claude-code": "opus", copilot: "gpt-x" });
});

test("should exit 1 for a model flag naming an engine not chosen", () => {
  const { project, result } = installProcess(["--engine", "claude-code", "--model-review", "copilot=gpt-x"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /--model-review: engine copilot was not chosen for this install \(chosen: claude-code\)/);
  assert.equal(fs.existsSync(path.join(project, ".mgr-core")), false);
});

test("should warn about inherited models and absent origin without flags", () => {
  const { project, result } = installProcess(["--engine", "claude-code"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const saida = result.stdout + result.stderr;
  assert.match(saida, /No model recorded for:/);
  assert.match(saida, /Project origin not recorded/);
  const configFile = path.join(project, ".mgr-core", "config.json");
  if (fs.existsSync(configFile)) assert.equal(readConfigOf(project).origin, undefined);
});

test("should record models and origin given by flags", () => {
  const { project, result } = installProcess(["--engine", "claude-code", "--model-review", "opus", "--origin", "brownfield"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const config = readConfigOf(project);
  assert.equal(config.origin, "brownfield");
  assert.deepEqual(config.agents.review.model, { "claude-code": "opus" });
  assert.doesNotMatch(result.stdout + result.stderr, /Project origin not recorded/);
});

test("should exit 1 with the malformed-value message for an engine=id list with an empty id", () => {
  const { project, result } = installProcess(["--engine", "claude-code", "--model-review", "claude-code="]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /--model-review: "claude-code=" is neither one model id nor a list of engine=id pairs/);
  assert.equal(fs.existsSync(path.join(project, ".mgr-core")), false);
});

// S-9: a pergunta de origem é feita com as três opções e `skip` pré-selecionado.
test("should offer greenfield, brownfield and skip for the origin with skip preselected", async () => {
  const { ask, chamadas } = stubAsk(() => "skip");
  await collectInstallAnswers(ask, jaRespondido(["claude-code"]), opcoesSemDefault);

  const origem = chamadas.find((c) => c.message === msg.qOrigin);
  assert.ok(origem, "a origem não gravada é perguntada");
  assert.deepEqual(origem.options.map((opcao) => opcao.value), ["greenfield", "brownfield", "skip"]);
  assert.equal(origem.initialValue, "skip");
});

// E-9 (DT-7): só as intenções LIGADAS são perguntadas, e na ordem de INTENTS.
test("should not ask the model of an intent that is disabled", async () => {
  const { ask, chamadas } = stubAsk(() => "skip");
  await collectInstallAnswers(ask, jaRespondido(["claude-code"]), {
    ...opcoesSemDefault,
    enabledIntents: ["drafting", "review"],
  });

  const perguntadas = chamadas.map((c) => c.message);
  assert.ok(perguntadas.includes(perguntaModelo("drafting", "claude-code")), "drafting ligada é perguntada");
  assert.ok(perguntadas.includes(perguntaModelo("review", "claude-code")), "review ligada é perguntada");
  assert.ok(!perguntadas.includes(perguntaModelo("execution", "claude-code")), "execution desligada não é perguntada");
});

// E-9: modelo de intenção/motor já dado por flag não é perguntado; o outro motor da mesma intenção segue.
test("should not ask the model of an intent and engine already given by a flag", async () => {
  const { ask, chamadas } = stubAsk(() => "skip");
  await collectInstallAnswers(ask, jaRespondido(["claude-code", "copilot"]), {
    ...opcoesSemDefault,
    flagModels: { drafting: { "claude-code": "opus" } },
  });

  const perguntadas = chamadas.map((c) => c.message);
  assert.ok(!perguntadas.includes(perguntaModelo("drafting", "claude-code")), "drafting/claude-code veio por flag");
  assert.ok(perguntadas.includes(perguntaModelo("drafting", "copilot")), "drafting/copilot não veio por flag");
});

// SP-1: a forma de pares também confere se o motor aceita modelo.
test("should refuse a per-engine pair naming an engine that takes no model", () => {
  const options = { engines: ["claude-code", "custom"], supportsModel: soClaudeCode };
  assert.deepEqual(
    resolveModelFlags({ modelReview: "custom=opus" }, { engines: ["custom"], supportsModel: soClaudeCode }),
    { ok: false, reason: "no-model-engine", intent: "review" },
  );
  // Com um motor que aceita modelo escolhido, a razão nomeia SÓ o motor culpado (review final, SP-2):
  // listar os dois diria que o claude-code não aceita modelo, o que é falso.
  assert.deepEqual(
    resolveModelFlags({ modelReview: "claude-code=opus,custom=x" }, options),
    { ok: false, reason: "no-model-engine", intent: "review", engine: "custom" },
  );
});

test("should exit 1 with the no-model-engine message for a pair when only a skills dir is chosen", () => {
  const destino = path.join(tempOutsideGit("skills-dir-par"), "minhas-skills");
  const { project, result } = installProcess(["--skills-dir", destino, "--model-review", "custom=opus"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /--model-review: none of the chosen engines \(custom\) takes a model/);
  assert.equal(fs.existsSync(path.join(project, ".mgr-core")), false);
  assert.equal(fs.existsSync(destino), false, "a recusa vem antes de qualquer escrita");
});

// SP-2 (E-9): o contexto é lido DEPOIS da resposta de motores, com os motores e o escopo reais.
test("should resolve the context only after the engines are answered and skip the model given by flag", async () => {
  const { ask, chamadas } = stubAsk(() => "skip");
  const ordem = [];
  ask.multiselect = async () => { ordem.push("engines"); return ["claude-code"]; };
  const recebido = [];
  const contextFor = (engines, scope) => {
    ordem.push("contexto");
    recebido.push({ engines, scope });
    return { flagModels: { drafting: { "claude-code": "opus" } }, configured: {}, enabledIntents: ["drafting", "execution", "review"], originRecorded: false };
  };
  await collectInstallAnswers(ask, { scope: "project", userLanguage: "en", projectId: "projeto" }, { repo: ".", allSkills: true, msg, contextFor });

  assert.deepEqual(ordem, ["engines", "contexto"], "contextFor só depois da resposta de motores");
  assert.deepEqual(recebido, [{ engines: ["claude-code"], scope: "project" }]);
  const perguntadas = chamadas.map((c) => c.message);
  assert.ok(!perguntadas.includes(perguntaModelo("drafting", "claude-code")), "drafting/claude-code veio por flag");
  assert.ok(perguntadas.includes(perguntaModelo("execution", "claude-code")));
});

// ST-1: chave desconhecida no arquivo pessoal é avisada também no install.
test("should warn about an unrecognized key in config.local.json on install", () => {
  const { project } = installProcess(["--engine", "claude-code"]);
  const home = tempOutsideGit("home2");
  fs.writeFileSync(path.join(project, ".mgr-core", "config.local.json"), JSON.stringify({ projectid: "x" }));
  const result = runMgr(["install", "--scope", "project", "--all-skills", "--engine", "claude-code", "-y", project], { cwd: project, home });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /config\.local\.json: projectid is not a recognized key and was ignored\./);
});

const perguntaEsforco = (intent, engines = "claude-code") => msg.qEffort(intent, engines);
const mensagensDeEsforco = (chamadas) =>
  ["drafting", "execution", "review"].map((intent) => perguntaEsforco(intent)).filter((m) => chamadas.some((c) => c.message === m));
const eEsforco = (c) => ["drafting", "execution", "review"].some((i) => c.message === perguntaEsforco(i));

test("should ask one effort select per intent with the six values, skip label and skip preselected", async () => {
  const { ask, chamadas } = stubAsk(() => "skip");
  await collectInstallAnswers(ask, jaRespondido(["claude-code"]), opcoesSemDefault);

  const defaults = { drafting: "high", execution: "low", review: "max" };
  for (const intent of ["drafting", "execution", "review"]) {
    const perguntas = chamadas.filter((c) => c.message === perguntaEsforco(intent));
    assert.equal(perguntas.length, 1, intent);
    assert.equal(perguntas[0].tipo, "select");
    assert.deepEqual(
      perguntas[0].options.map((opcao) => opcao.value),
      ["low", "medium", "high", "xhigh", "max", "skip"],
      intent,
    );
    assert.equal(perguntas[0].options.at(-1).label, msg.effortSkipLabel(defaults[intent]), intent);
    assert.equal(perguntas[0].initialValue, "skip", intent);
  }
});

test("should ask the effort questions after every model question and before the origin", async () => {
  const { ask, chamadas } = stubAsk(() => "skip");
  await collectInstallAnswers(ask, jaRespondido(["claude-code"]), opcoesSemDefault);

  const mensagens = chamadas.map((c) => c.message);
  const ultimoModelo = Math.max(...["drafting", "execution", "review"].map((i) => mensagens.indexOf(perguntaModelo(i, "claude-code"))));
  const indicesEsforco = chamadas.map((c, i) => (eEsforco(c) ? i : -1)).filter((i) => i >= 0);
  assert.equal(indicesEsforco.length, 3);
  assert.ok(Math.min(...indicesEsforco) > ultimoModelo, "esforço depois de todos os modelos");
  assert.ok(Math.max(...indicesEsforco) < mensagens.indexOf(msg.qOrigin), "esforço antes da origem");
});

test("should not ask any effort question when only copilot is chosen", async () => {
  const { ask, chamadas } = stubAsk(() => "skip");
  const out = await collectInstallAnswers(ask, jaRespondido(["copilot"]), opcoesSemDefault);

  assert.equal(chamadas.filter((c) => c.options?.some((opcao) => opcao.value === "xhigh")).length, 0);
  assert.deepEqual(mensagensDeEsforco(chamadas), []);
  assert.deepEqual(out.efforts, {});
});

test("should ask exactly three effort questions naming only claude-code when copilot is also chosen", async () => {
  const { ask, chamadas } = stubAsk(() => "skip");
  await collectInstallAnswers(ask, jaRespondido(["claude-code", "copilot"]), opcoesSemDefault);

  const esforco = chamadas.filter((c) => ["drafting", "execution", "review"].some((i) => c.message === perguntaEsforco(i, "claude-code")));
  assert.equal(esforco.length, 3);
  for (const intent of ["drafting", "execution", "review"]) {
    assert.ok(!chamadas.some((c) => c.message === perguntaEsforco(intent, "claude-code, copilot")), intent);
    assert.ok(!chamadas.some((c) => c.message === perguntaEsforco(intent, "copilot")), intent);
  }
});

test("should record the answered effort levels per intent", async () => {
  const { ask } = stubAsk((message) => {
    if (message === perguntaEsforco("drafting")) return "xhigh";
    if (message === perguntaEsforco("review")) return "medium";
    return "skip";
  });
  const out = await collectInstallAnswers(ask, jaRespondido(["claude-code"]), opcoesSemDefault);

  assert.deepEqual(out.efforts, { drafting: "xhigh", review: "medium" });
});

test("should not ask the effort of an intent whose effort is already configured", async () => {
  const configured = { drafting: { effort: "configured" } };
  const { ask, chamadas } = stubAsk(() => "skip");
  await collectInstallAnswers(ask, jaRespondido(["claude-code"]), { ...opcoesSemDefault, configured });

  const perguntadas = chamadas.map((c) => c.message);
  assert.ok(!perguntadas.includes(perguntaEsforco("drafting")), "drafting já configurado");
  assert.ok(perguntadas.includes(perguntaEsforco("execution")));
  assert.ok(perguntadas.includes(perguntaEsforco("review")));
});

test("should not ask the effort of an intent given by flag", async () => {
  const { ask, chamadas } = stubAsk(() => "skip");
  await collectInstallAnswers(ask, jaRespondido(["claude-code"]), { ...opcoesSemDefault, flagEfforts: { review: "max" } });

  const perguntadas = chamadas.map((c) => c.message);
  assert.ok(!perguntadas.includes(perguntaEsforco("review")), "review veio por flag");
  assert.ok(perguntadas.includes(perguntaEsforco("drafting")));
  assert.ok(perguntadas.includes(perguntaEsforco("execution")));
});

test("should not ask the effort of an intent given by flag through contextFor", async () => {
  const { ask, chamadas } = stubAsk(() => "skip");
  ask.multiselect = async () => ["claude-code"];
  const contextFor = () => ({
    flagModels: {},
    flagEfforts: { review: "max" },
    configured: {},
    enabledIntents: ["drafting", "execution", "review"],
    originRecorded: false,
  });
  await collectInstallAnswers(ask, { scope: "project", userLanguage: "en", projectId: "projeto" }, { repo: ".", allSkills: true, msg, contextFor });

  const perguntadas = chamadas.map((c) => c.message);
  assert.ok(!perguntadas.includes(perguntaEsforco("review")), "review veio por flag");
  assert.ok(perguntadas.includes(perguntaEsforco("drafting")));
  assert.ok(perguntadas.includes(perguntaEsforco("execution")));
});

test("should not ask the effort of an intent that is disabled", async () => {
  const { ask, chamadas } = stubAsk(() => "skip");
  await collectInstallAnswers(ask, jaRespondido(["claude-code"]), {
    ...opcoesSemDefault,
    enabledIntents: ["drafting", "review"],
  });

  const perguntadas = chamadas.map((c) => c.message);
  assert.ok(perguntadas.includes(perguntaEsforco("drafting")));
  assert.ok(perguntadas.includes(perguntaEsforco("review")));
  assert.ok(!perguntadas.includes(perguntaEsforco("execution")), "execution desligada não é perguntada");
});

test("should return CANCELLED when an effort question is cancelled", async () => {
  const cancelado = Symbol("cancel");
  const { ask } = stubAsk((message) => (message === perguntaEsforco("execution") ? cancelado : "skip"));
  ask.isCancel = (valor) => valor === cancelado;
  const out = await collectInstallAnswers(ask, jaRespondido(["claude-code"]), opcoesSemDefault);

  assert.equal(out, CANCELLED);
});

test("should exit 1 with the no-model-engine message when only a skills dir is chosen", () => {
  // Caminho ABSOLUTO dentro de um temporário: relativo, ele resolveria contra o cwd do processo (a raiz
  // do repositório) e, se a recusa falhasse, o install gravaria skills dentro do próprio repo.
  const destino = path.join(tempOutsideGit("skills-dir"), "minhas-skills");
  const { project, result } = installProcess(["--skills-dir", destino, "--model-review", "opus"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /--model-review: none of the chosen engines \(custom\) takes a model/);
  assert.equal(fs.existsSync(path.join(project, ".mgr-core")), false);
  assert.equal(fs.existsSync(destino), false, "a recusa vem antes de qualquer escrita");
});

function askComAnterior(respostas = {}) {
  const chamadas = [];
  const perguntar = (tipo) => async (opcoes) => {
    chamadas.push({ tipo, ...opcoes });
    return opcoes.message in respostas ? respostas[opcoes.message] : opcoes.initialValue ?? opcoes.initialValues;
  };
  const ask = {
    multiselect: perguntar("multiselect"),
    select: perguntar("select"),
    text: perguntar("text"),
    confirm: perguntar("confirm"),
    isCancel: () => false,
  };
  return { ask, chamadas };
}

async function coletarComAnterior(anterior, { respostas, allSkills = false, semPrevious = false } = {}) {
  const { ask, chamadas } = askComAnterior(respostas);
  const opcoes = { repo: ".", allSkills, msg, enabledIntents: [] };
  if (!semPrevious) opcoes.previous = () => anterior;
  const out = await collectInstallAnswers(ask, { scope: "project", projectId: "projeto" }, opcoes);
  const pergunta = (mensagem) => chamadas.find((c) => c.message === mensagem);
  return { out, chamadas, pergunta };
}

const declaracoesCompletas = {
  engines: ["copilot"],
  architecture: "clean",
  language: "java",
  userLanguage: "pt-BR",
  optional: ["evidence-capture"],
};

test("should preselect every previous declaration in its question", async () => {
  const { out, pergunta } = await coletarComAnterior(declaracoesCompletas);

  assert.deepEqual(pergunta(msg.qEngines).initialValues, ["copilot"]);
  assert.equal(pergunta(msg.qArchitecture).initialValue, "clean");
  assert.equal(pergunta(msg.qLanguage).initialValue, "java");
  assert.equal(pergunta(msg.qOutputLanguage).initialValue, "pt-BR");
  assert.equal(pergunta(msg.qOptionalEvidence).initialValue, true);
  assert.deepEqual(out.engines, ["copilot"]);
  assert.equal(out.architecture, "clean");
  assert.equal(out.language, "java");
  assert.equal(out.userLanguage, "pt-BR");
  assert.deepEqual(out.optional, ["evidence-capture"]);
});

test("should preselect other and record null when the previous language is not in the catalog", async () => {
  const { out, pergunta } = await coletarComAnterior({ language: "cobol" }, { respostas: { [msg.qLanguage]: "outra" } });

  assert.equal(pergunta(msg.qLanguage).initialValue, "outra");
  assert.equal(out.language, null);
});

test("should preselect other and suggest the previous text when the user language is not en or pt-BR", async () => {
  const { pergunta } = await coletarComAnterior({ userLanguage: "es-ES" });

  assert.equal(pergunta(msg.qOutputLanguage).initialValue, "outro");
  assert.equal(pergunta(msg.qWhichLanguage).initialValue, "es-ES");
});

test("should fall back to today's fixed defaults when previous returns nothing", async () => {
  const { pergunta } = await coletarComAnterior({});

  assert.deepEqual(pergunta(msg.qEngines).initialValues, ["claude-code"]);
  assert.equal(pergunta(msg.qArchitecture).initialValue, "hexagonal");
  assert.equal(pergunta(msg.qLanguage).initialValue, "java");
  assert.equal(pergunta(msg.qOutputLanguage).initialValue, "en");
  assert.equal(pergunta(msg.qOptionalEvidence).initialValue, false);
});

test("should fall back to the same defaults when no previous option is given", async () => {
  const comOpcao = await coletarComAnterior({});
  const semOpcao = await coletarComAnterior(null, { semPrevious: true });

  const iniciais = (c) => c.chamadas.map((q) => [q.message, q.initialValue ?? q.initialValues]);
  assert.deepEqual(iniciais(semOpcao), iniciais(comOpcao));
});

test("should skip architecture and language when the inherited declarations say allSkills", async () => {
  const { chamadas, out } = await coletarComAnterior({ allSkills: true });
  const perguntadas = chamadas.map((c) => c.message);

  assert.ok(!perguntadas.includes(msg.qArchitecture));
  assert.ok(!perguntadas.includes(msg.qLanguage));
  assert.ok(perguntadas.includes(msg.qOutputLanguage));
  assert.equal(out.architecture, null);
  assert.equal(out.language, null);
});

test("should preselect the none option and record null when the previous architecture is null", async () => {
  const { out, pergunta } = await coletarComAnterior({ architecture: null });

  assert.equal(pergunta(msg.qArchitecture).initialValue, "none");
  assert.equal(out.architecture, null);
});

test("should preselect and record layered when it was the previous architecture", async () => {
  const { out, pergunta } = await coletarComAnterior({ architecture: "layered" });

  assert.equal(pergunta(msg.qArchitecture).initialValue, "layered");
  assert.equal(out.architecture, "layered");
});

test("should have non-empty none labels in every language table", () => {
  for (const idioma of ["en", "pt-BR"]) {
    const tabela = getMessages(idioma);
    assert.equal(typeof tabela.archNoneLabel, "string");
    assert.notEqual(tabela.archNoneLabel.trim(), "");
    assert.equal(typeof tabela.archNoneHint, "string");
    assert.notEqual(tabela.archNoneHint.trim(), "");
  }
});

test("should build the none option of the architecture select from the message table", async () => {
  for (const idioma of ["en", "pt-BR"]) {
    const tabela = getMessages(idioma);
    const { ask, chamadas } = askComAnterior();
    await collectInstallAnswers(ask, { scope: "project", projectId: "projeto" }, {
      repo: ".", msg: tabela, enabledIntents: [],
    });
    const opcaoNenhuma = chamadas.find((c) => c.message === tabela.qArchitecture).options.find((o) => o.value === "none");

    assert.equal(opcaoNenhuma.label, tabela.archNoneLabel);
    assert.equal(opcaoNenhuma.hint, tabela.archNoneHint);
  }
});

test("should preselect the recorded project id and keep it when the answer is the default", async () => {
  const { ask, chamadas } = askComAnterior();
  const out = await collectInstallAnswers(ask, { scope: "project" }, {
    repo: path.join(path.sep, "pasta-do-repo"), allSkills: false, msg, enabledIntents: [],
    previous: () => ({ ...declaracoesCompletas, projectId: "id-gravado" }),
  });
  assert.equal(chamadas.find((c) => c.message === msg.qProjectId).initialValue, "id-gravado");
  assert.equal(out.projectId, "id-gravado");
});

test("should preselect the folder name as project id when nothing is recorded", async () => {
  const { ask, chamadas } = askComAnterior();
  await collectInstallAnswers(ask, { scope: "project" }, {
    repo: path.join(path.sep, "pasta-do-repo"), allSkills: false, msg, enabledIntents: [], previous: () => ({}),
  });
  assert.equal(chamadas.find((c) => c.message === msg.qProjectId).initialValue, "pasta-do-repo");
});

test("should preselect the folder name as project id when the recorded id is empty", async () => {
  const { ask, chamadas } = askComAnterior();
  await collectInstallAnswers(ask, { scope: "project" }, {
    repo: path.join(path.sep, "pasta-do-repo"), allSkills: false, msg, enabledIntents: [], previous: () => ({ projectId: "" }),
  });
  assert.equal(chamadas.find((c) => c.message === msg.qProjectId).initialValue, "pasta-do-repo");
});
