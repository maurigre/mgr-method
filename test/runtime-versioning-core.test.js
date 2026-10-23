import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tempDir } from "../scripts/lib/tmp.mjs";
import * as catalog from "../src/catalog.js";
import { installRuntime, runtimeIgnoreEffect, runtimeIgnoreFileFor, runtimeIgnoreState } from "../src/builder.js";
import { CONFIG_NAME, runtimeVersioningOf, writeRuntimeVersioning } from "../src/registry.js";
import { applyUpdate, coreDir, execute, planInstall, planUpdate, resolveRuntimeVersioning, runtimeDir, withRuntimeVersioning } from "../src/installer.js";
import { CANCELLED, REMOVAL_ASK, REMOVAL_ASSUMED, REMOVAL_NO_CONSENT, askRuntimeVersioning, collectInstallAnswers } from "../src/prompts.js";
import { DEFECT, FIX_UPDATE, NO_FIX, runtimeVersioningCheck } from "../src/doctor.js";
import { runtimeVersioning } from "../src/commands/runtime-versioning.js";
import { getMessages } from "../src/messages.js";

const coreComConfig = (conteudo) => {
  const coreDir = tempDir("mgr-rv-core-");
  writeFileSync(path.join(coreDir, CONFIG_NAME), `${JSON.stringify(conteudo, null, 2)}\n`, "utf8");
  return coreDir;
};

const lerConfig = (coreDir) => JSON.parse(readFileSync(path.join(coreDir, CONFIG_NAME), "utf8"));

const runtimeNovo = () => path.join(tempDir("mgr-rv-core-"), "runtime");

test("should report absent when the config has no runtimeVersioning key", () => {
  assert.deepEqual(runtimeVersioningOf({}), { state: "absent" });
});

test("should report recorded with the value when runtimeVersioning is versioned", () => {
  assert.deepEqual(runtimeVersioningOf({ runtimeVersioning: "versioned" }), { state: "recorded", value: "versioned" });
});

test("should report recorded with the value when runtimeVersioning is unversioned", () => {
  assert.deepEqual(runtimeVersioningOf({ runtimeVersioning: "unversioned" }), { state: "recorded", value: "unversioned" });
});

for (const valor of ["", "Versioned", "true", 42]) {
  test(`should report invalid for runtimeVersioning ${JSON.stringify(valor)}`, () => {
    assert.deepEqual(runtimeVersioningOf({ runtimeVersioning: valor }), { state: "invalid", value: valor });
  });
}

test("should report antes as ausente and store the value when the key was never written", () => {
  const coreDir = coreComConfig({ origin: "greenfield" });
  const resultado = writeRuntimeVersioning(coreDir, "versioned");
  assert.deepEqual(resultado, { antes: { estado: "ausente" }, depois: "versioned" });
});

test("should keep the other config keys when writing runtimeVersioning", () => {
  const coreDir = coreComConfig({ origin: "greenfield", agents: { review: "opus" } });
  writeRuntimeVersioning(coreDir, "unversioned");
  assert.deepEqual(lerConfig(coreDir), { origin: "greenfield", agents: { review: "opus" }, runtimeVersioning: "unversioned" });
});

test("should report antes as gravado with the previous valid value", () => {
  const coreDir = coreComConfig({ runtimeVersioning: "unversioned" });
  const resultado = writeRuntimeVersioning(coreDir, "versioned");
  assert.deepEqual(resultado, { antes: { estado: "gravado", valor: "unversioned" }, depois: "versioned" });
});

test("should report antes as invalido with the rejected value and replace it", () => {
  const coreDir = coreComConfig({ runtimeVersioning: 42 });
  const resultado = writeRuntimeVersioning(coreDir, "versioned");
  assert.deepEqual(resultado, { antes: { estado: "invalido", valor: 42 }, depois: "versioned" });
  assert.equal(lerConfig(coreDir).runtimeVersioning, "versioned");
});

test("should refuse a value outside the vocabulary without touching the config file", () => {
  const coreDir = coreComConfig({ origin: "greenfield" });
  const antes = readFileSync(path.join(coreDir, CONFIG_NAME), "utf8");
  assert.throws(() => writeRuntimeVersioning(coreDir, "Versioned"), /unknown runtime versioning: "Versioned"/);
  assert.equal(readFileSync(path.join(coreDir, CONFIG_NAME), "utf8"), antes);
});

const MC_DC_EFEITO = [
  { state: "no-runtime", ignoreFile: "write", efeito: "write" },
  { state: "absent", ignoreFile: "write", efeito: "write" },
  { state: "outdated", ignoreFile: "write", efeito: "rewrite" },
  { state: "current", ignoreFile: "write", efeito: "none" },
  { state: "current", ignoreFile: "omit", efeito: "remove" },
  { state: "outdated", ignoreFile: "omit", efeito: "remove" },
  { state: "no-runtime", ignoreFile: "omit", efeito: "none" },
  { state: "absent", ignoreFile: "omit", efeito: "none" },
];

for (const { state, ignoreFile, efeito } of MC_DC_EFEITO) {
  test(`should return ${efeito} when the state is ${state} and ignoreFile is ${ignoreFile}`, () => {
    assert.equal(runtimeIgnoreEffect({ state, ignoreFile }), efeito);
  });
}

test("should throw when ignoreFile is neither write nor omit in runtimeIgnoreEffect", () => {
  assert.throws(() => runtimeIgnoreEffect({ state: "absent", ignoreFile: true }), /ignoreFile must be "write" or "omit"/);
});

test("should report no-runtime when the runtime directory does not exist", () => {
  assert.equal(runtimeIgnoreState(runtimeNovo()), "no-runtime");
});

test("should report absent when the runtime directory exists without the ignore file", () => {
  const dir = runtimeNovo();
  mkdirSync(dir, { recursive: true });
  assert.equal(runtimeIgnoreState(dir), "absent");
});

test("should report current when the ignore file has the exact catalog content", () => {
  const dir = runtimeNovo();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, catalog.RUNTIME_IGNORE_FILE), catalog.RUNTIME_IGNORE_CONTENT, "utf8");
  assert.equal(runtimeIgnoreState(dir), "current");
});

test("should report outdated when the ignore file has different content", () => {
  const dir = runtimeNovo();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, catalog.RUNTIME_IGNORE_FILE), "*\n", "utf8");
  assert.equal(runtimeIgnoreState(dir), "outdated");
});

test("should report outdated when the ignore file differs only by the trailing newline", () => {
  const dir = runtimeNovo();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, catalog.RUNTIME_IGNORE_FILE), catalog.RUNTIME_IGNORE_CONTENT.replace(/\n$/, ""), "utf8");
  assert.equal(runtimeIgnoreState(dir), "outdated");
});

test("should write the exact catalog content as the ignore file when ignoreFile is write", () => {
  const dir = runtimeNovo();
  installRuntime(dir, { version: "1.0.0", ignoreFile: "write" });
  assert.equal(readFileSync(path.join(dir, catalog.RUNTIME_IGNORE_FILE), "utf8"), catalog.RUNTIME_IGNORE_CONTENT);
});

test("should report files as RUNTIME_FILES plus one when ignoreFile is write", () => {
  const resultado = installRuntime(runtimeNovo(), { version: "1.0.0", ignoreFile: "write" });
  assert.equal(resultado.files, catalog.RUNTIME_FILES.length + 1);
});

test("should not write the ignore file when ignoreFile is omit", () => {
  const dir = runtimeNovo();
  installRuntime(dir, { version: "1.0.0", ignoreFile: "omit" });
  assert.equal(existsSync(path.join(dir, catalog.RUNTIME_IGNORE_FILE)), false);
});

test("should throw and not create the runtime directory when ignoreFile is invalid", () => {
  const dir = runtimeNovo();
  assert.throws(() => installRuntime(dir, { version: "1.0.0", ignoreFile: true }), /ignoreFile must be "write" or "omit"/);
  assert.equal(existsSync(dir), false);
});

const msg = getMessages("en");

function stubAsk(responder) {
  const chamadas = [];
  const perguntar = (tipo) => async (opcoes) => {
    chamadas.push({ tipo, ...opcoes });
    return responder(opcoes.message, tipo);
  };
  const ask = {
    multiselect: async () => { throw new Error("multiselect nao deveria ser chamado"); },
    select: perguntar("select"),
    text: perguntar("text"),
    confirm: async () => { throw new Error("confirm nao deveria ser chamado"); },
    isCancel: () => false,
  };
  return { ask, chamadas };
}

const VALIDOS = catalog.RUNTIME_VERSIONING.join(" | ");
const IGNORE_REL = `.mgr-core/runtime/${catalog.RUNTIME_IGNORE_FILE}`;

const RESOLUCAO = [
  { nome: "global scope wins over an answer and a recorded value", entrada: { scope: "global", answered: "versioned", recorded: { state: "recorded", value: "unversioned" } }, esperado: { source: "not-applicable" } },
  { nome: "the answer wins over the recorded value in project scope", entrada: { scope: "project", answered: "versioned", recorded: { state: "recorded", value: "unversioned" } }, esperado: { source: "answered", value: "versioned" } },
  { nome: "the recorded value is used when there is no answer", entrada: { scope: "project", answered: null, recorded: { state: "recorded", value: "versioned" } }, esperado: { source: "recorded", value: "versioned" } },
  { nome: "the default is used when there is no answer and nothing recorded", entrada: { scope: "project", answered: null, recorded: { state: "absent" } }, esperado: { source: "default", value: "unversioned" } },
];

for (const { nome, entrada, esperado } of RESOLUCAO) {
  test(`should resolve: ${nome}`, () => {
    assert.deepEqual(resolveRuntimeVersioning(entrada), esperado);
  });
}

const PLANO_EFEITO = [
  { scope: "project", answered: "unversioned", ignore: "write" },
  { scope: "project", answered: "versioned", ignore: "omit" },
  { scope: "project", answered: null, ignore: "write" },
  { scope: "global", answered: "unversioned", ignore: "omit" },
];

for (const { scope, answered, ignore } of PLANO_EFEITO) {
  test(`should set runtimeIgnore ${ignore} for scope ${scope} with answer ${answered}`, () => {
    const home = tempDir("mgr-rv-core-");
    const homeAntes = process.env.HOME;
    process.env.HOME = home;
    try {
      const plano = withRuntimeVersioning({ scope, repo: tempDir("mgr-rv-core-") }, answered);
      assert.equal(plano.runtimeIgnore, ignore);
    } finally {
      process.env.HOME = homeAntes;
    }
  });
}

test("should return a new plan without mutating the original in withRuntimeVersioning", () => {
  const original = { scope: "project", repo: tempDir("mgr-rv-core-") };
  const novo = withRuntimeVersioning(original, "versioned");
  assert.notEqual(novo, original);
  assert.equal("runtimeVersioning" in original, false);
  assert.deepEqual(novo.runtimeVersioning, { source: "answered", value: "versioned" });
});

const instalar = (runtimeVersioning, config = null) => {
  const repo = tempDir("mgr-rv-core-");
  if (config) {
    mkdirSync(coreDir("project", repo), { recursive: true });
    writeFileSync(path.join(coreDir("project", repo), CONFIG_NAME), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
  execute(planInstall(["claude-code"], "project", repo, { all: true, runtimeVersioning }));
  return repo;
};

const ignorePath = (repo) => path.join(runtimeDir("project", repo), catalog.RUNTIME_IGNORE_FILE);

const respostasDoInstall = (runtime) => (message) => {
  if (message === msg.qOrigin) return "skip";
  if (message === msg.qRuntimeVersioning) return runtime;
  return "skip";
};

const jaRespondido = { engines: ["claude-code"], scope: "project", userLanguage: "en", projectId: "projeto" };

test("should ask the runtime versioning select after the origin with the options and default of the spec", async () => {
  const { ask, chamadas } = stubAsk(respostasDoInstall("unversioned"));
  await collectInstallAnswers(ask, jaRespondido, { repo: ".", allSkills: true, msg });
  const mensagens = chamadas.map((c) => c.message);
  assert.ok(mensagens.indexOf(msg.qRuntimeVersioning) > mensagens.indexOf(msg.qOrigin));
  assert.equal(mensagens.at(-1), msg.qRuntimeVersioning);
  const pergunta = chamadas.find((c) => c.message === msg.qRuntimeVersioning);
  assert.deepEqual(pergunta.options, [
    { value: "unversioned", label: msg.runtimeUnversionedOption },
    { value: "versioned", label: msg.runtimeVersionedOption },
  ]);
  assert.equal(pergunta.initialValue, "unversioned");
});

test("should not ask the runtime versioning in global scope", async () => {
  const { ask, chamadas } = stubAsk(respostasDoInstall("versioned"));
  const out = await collectInstallAnswers(ask, { ...jaRespondido, scope: "global" }, { repo: ".", allSkills: true, msg });
  assert.equal(chamadas.some((c) => c.message === msg.qRuntimeVersioning), false);
  assert.equal(out.runtimeVersioning, null);
});

test("should not ask the runtime versioning when it is already recorded", async () => {
  const { ask, chamadas } = stubAsk(respostasDoInstall("versioned"));
  const out = await collectInstallAnswers(ask, jaRespondido, { repo: ".", allSkills: true, msg, runtimeVersioningRecorded: true });
  assert.equal(chamadas.some((c) => c.message === msg.qRuntimeVersioning), false);
  assert.equal(out.runtimeVersioning, null);
});

test("should return the answer in runtimeVersioning and cancel when the select is cancelled", async () => {
  const { ask } = stubAsk(respostasDoInstall("versioned"));
  const out = await collectInstallAnswers(ask, jaRespondido, { repo: ".", allSkills: true, msg });
  assert.equal(out.runtimeVersioning, "versioned");
  const cancelando = { ...stubAsk(respostasDoInstall("versioned")).ask, isCancel: (valor) => valor === "versioned" };
  assert.equal(await collectInstallAnswers(cancelando, jaRespondido, { repo: ".", allSkills: true, msg }), CANCELLED);
});

test("should write unversioned from the collected answer preserving the other config keys", async () => {
  const { ask } = stubAsk(respostasDoInstall("unversioned"));
  const out = await collectInstallAnswers(ask, jaRespondido, { repo: ".", allSkills: true, msg });
  const repo = instalar(out.runtimeVersioning, { origin: "greenfield" });
  const config = lerConfig(coreDir("project", repo));
  assert.equal(config.runtimeVersioning, "unversioned");
  assert.equal(config.origin, "greenfield");
  assert.equal(readFileSync(ignorePath(repo), "utf8"), catalog.RUNTIME_IGNORE_CONTENT);
});

test("should not record runtimeVersioning when execute runs without an answer", () => {
  const repo = instalar(null);
  assert.equal("runtimeVersioning" in lerConfigOuVazio(repo), false);
  assert.equal(readFileSync(ignorePath(repo), "utf8"), catalog.RUNTIME_IGNORE_CONTENT);
});

const lerConfigOuVazio = (repo) => {
  const arquivo = path.join(coreDir("project", repo), CONFIG_NAME);
  return existsSync(arquivo) ? JSON.parse(readFileSync(arquivo, "utf8")) : {};
};

test("should ask in ask mode and return the answer", async () => {
  const { ask, chamadas } = stubAsk(() => "versioned");
  assert.deepEqual(await askRuntimeVersioning(ask, { mode: REMOVAL_ASK, msg }), { source: "answered", value: "versioned" });
  assert.equal(chamadas.length, 1);
});

for (const modo of [REMOVAL_ASSUMED, REMOVAL_NO_CONSENT]) {
  test(`should return default without asking in ${modo} mode`, async () => {
    const { ask, chamadas } = stubAsk(() => "versioned");
    assert.deepEqual(await askRuntimeVersioning(ask, { mode: modo, msg }), { source: "default" });
    assert.equal(chamadas.length, 0);
  });
}

test("should return CANCELLED when the ask is cancelled in ask mode", async () => {
  const { ask } = stubAsk(() => "versioned");
  assert.equal(await askRuntimeVersioning({ ...ask, isCancel: () => true }, { mode: REMOVAL_ASK, msg }), CANCELLED);
});

test("should write versioned on update preserving origin and removing the ignore file", () => {
  const repo = instalar("unversioned", { origin: "brownfield" });
  assert.equal(existsSync(ignorePath(repo)), true);
  applyUpdate(planUpdate("project", repo), { runtimeVersioning: "versioned" });
  const config = lerConfig(coreDir("project", repo));
  assert.equal(config.runtimeVersioning, "versioned");
  assert.equal(config.origin, "brownfield");
  assert.equal(existsSync(ignorePath(repo)), false);
});

test("should leave the config untouched on update when there is no answer", () => {
  const repo = instalar("unversioned", { origin: "brownfield" });
  const antes = readFileSync(path.join(coreDir("project", repo), CONFIG_NAME), "utf8");
  applyUpdate(planUpdate("project", repo), {});
  assert.equal(readFileSync(path.join(coreDir("project", repo), CONFIG_NAME), "utf8"), antes);
  assert.equal(existsSync(ignorePath(repo)), true);
});

const DOCTOR_MC_DC = [
  { nome: "absent choice and ignore absent", choice: { state: "absent" }, ignoreState: "absent", expected: "o arquivo de ignorar como o metodo o grava (runtimeVersioning: unversioned)", found: "ausente" },
  { nome: "absent choice and ignore outdated", choice: { state: "absent" }, ignoreState: "outdated", expected: "o arquivo de ignorar como o metodo o grava (runtimeVersioning: unversioned)", found: "difere do que o metodo grava" },
  { nome: "absent choice and ignore current", choice: { state: "absent" }, ignoreState: "current", expected: null },
  { nome: "unversioned choice and ignore absent", choice: { state: "recorded", value: "unversioned" }, ignoreState: "absent", expected: "o arquivo de ignorar como o metodo o grava (runtimeVersioning: unversioned)", found: "ausente" },
  { nome: "unversioned choice and ignore current", choice: { state: "recorded", value: "unversioned" }, ignoreState: "current", expected: null },
  { nome: "versioned choice and ignore absent", choice: { state: "recorded", value: "versioned" }, ignoreState: "absent", expected: null },
  { nome: "versioned choice and ignore current", choice: { state: "recorded", value: "versioned" }, ignoreState: "current", expected: "sem arquivo de ignorar (runtimeVersioning: versioned)", found: "presente" },
  { nome: "versioned choice and ignore outdated", choice: { state: "recorded", value: "versioned" }, ignoreState: "outdated", expected: "sem arquivo de ignorar (runtimeVersioning: versioned)", found: "presente" },
  { nome: "invalid choice regardless of the ignore file", choice: { state: "invalid", value: "Versioned" }, ignoreState: "current", expected: "runtimeVersioning: versioned | unversioned, ou ausente", found: "valor \"Versioned\"" },
];

for (const { nome, choice, ignoreState, expected, found } of DOCTOR_MC_DC) {
  test(`should ${expected ? "report one defect" : "report nothing"} for ${nome}`, () => {
    const achados = runtimeVersioningCheck({ choice, ignoreState, file: IGNORE_REL, configFile: ".mgr-core/config.json" });
    if (!expected) {
      assert.deepEqual(achados, []);
      return;
    }
    assert.equal(achados.length, 1);
    assert.equal(achados[0].check, "runtime-versioning");
    assert.equal(achados[0].severity, DEFECT);
    assert.equal(achados[0].expected, expected);
    assert.equal(achados[0].found, found);
  });
}

test("should point the achado at the config file and offer no fix for an invalid value", () => {
  const [achado] = runtimeVersioningCheck({ choice: { state: "invalid", value: 42 }, ignoreState: "absent", file: IGNORE_REL, configFile: ".mgr-core/config.json" });
  assert.equal(achado.file, ".mgr-core/config.json");
  assert.equal(achado.fix, NO_FIX);
  assert.equal(achado.found, "valor 42");
});

test("should offer mgr update and point at the ignore file for the two ignore conditions", () => {
  const [achadoAusente] = runtimeVersioningCheck({ choice: { state: "absent" }, ignoreState: "absent", file: IGNORE_REL, configFile: ".mgr-core/config.json" });
  const [achadoPresente] = runtimeVersioningCheck({ choice: { state: "recorded", value: "versioned" }, ignoreState: "current", file: IGNORE_REL, configFile: ".mgr-core/config.json" });
  for (const achado of [achadoAusente, achadoPresente]) {
    assert.equal(achado.file, IGNORE_REL);
    assert.equal(achado.fix, FIX_UPDATE);
  }
});

test("should report the unreadable config text when the config cannot be read", () => {
  const [achado] = runtimeVersioningCheck({ choice: { state: "invalid", value: "config.json ilegivel" }, ignoreState: "absent", file: IGNORE_REL, configFile: ".mgr-core/config.json" });
  assert.equal(achado.found, "config.json ilegivel");
});

const coletor = () => {
  const out = [];
  const err = [];
  return { out, err, io: { out: (linha) => out.push(linha), err: (linha) => err.push(linha) } };
};

const gitVazio = () => ({ state: "listed", files: [] });
const gitProibido = () => { throw new Error("gitIndex nao deveria ser chamado"); };

const fotografia = (repo) => ({
  config: existsSync(path.join(coreDir("project", repo), CONFIG_NAME)) ? readFileSync(path.join(coreDir("project", repo), CONFIG_NAME), "utf8") : null,
  ignore: existsSync(ignorePath(repo)) ? readFileSync(ignorePath(repo), "utf8") : null,
});

test("should print the set lines in the LOG-1 and LOG-2 order and write the ignore file", () => {
  const repo = instalar("versioned", { origin: "greenfield" });
  const { io, out } = coletor();
  const codigo = runtimeVersioning({ root: repo, positional: ["set", "unversioned"], io, M: msg, gitIndex: gitVazio });
  assert.equal(codigo, 0);
  assert.deepEqual(out, [
    msg.rvWriting(coreDir("project", repo)),
    msg.rvWritten("versioned", "unversioned"),
    msg.runtimeIgnoreToWrite(IGNORE_REL),
    msg.runtimeIgnoreWritten(IGNORE_REL),
    msg.gitIndexChecking(".mgr-core/runtime"),
    msg.gitIndexNone(".mgr-core/runtime"),
  ]);
  assert.equal(readFileSync(ignorePath(repo), "utf8"), catalog.RUNTIME_IGNORE_CONTENT);
  const config = lerConfig(coreDir("project", repo));
  assert.equal(config.runtimeVersioning, "unversioned");
  assert.equal(config.origin, "greenfield");
});

const REFUGOS = [
  { nome: "no value", positional: ["set"], esperado: msg.errorPrefix(msg.rvSetNeedsValue(VALIDOS)) },
  { nome: "an unknown value", positional: ["set", "x"], esperado: msg.errorPrefix(msg.rvUnknown("x", VALIDOS)) },
  { nome: "a value with the wrong case", positional: ["set", "Versioned"], esperado: msg.errorPrefix(msg.rvUnknown("Versioned", VALIDOS)) },
  { nome: "an unknown subcommand", positional: ["foo"], esperado: msg.errorPrefix(msg.rvSetNeedsValue(VALIDOS)) },
];

for (const { nome, positional, esperado } of REFUGOS) {
  test(`should exit 1 and change nothing for ${nome}`, () => {
    const repo = instalar("unversioned", { origin: "greenfield" });
    const antes = fotografia(repo);
    const { io, out, err } = coletor();
    assert.equal(runtimeVersioning({ root: repo, positional, io, M: msg, gitIndex: gitProibido }), 1);
    assert.deepEqual(err, [esperado]);
    assert.deepEqual(out, []);
    assert.deepEqual(fotografia(repo), antes);
  });
}

test("should exit 1 without creating .mgr-core when there is no manifest", () => {
  const repo = tempDir("mgr-rv-core-");
  const { io, out, err } = coletor();
  assert.equal(runtimeVersioning({ root: repo, positional: ["set", "versioned"], io, M: msg, gitIndex: gitProibido }), 1);
  assert.deepEqual(err, [msg.errorPrefix(msg.rvNoInstall(".mgr-core"))]);
  assert.deepEqual(out, []);
  assert.equal(existsSync(path.join(repo, ".mgr-core")), false);
});

test("should refuse a config that is not JSON leaving the config and the ignore file as they were", () => {
  const repo = instalar("unversioned", { origin: "greenfield" });
  writeFileSync(path.join(coreDir("project", repo), CONFIG_NAME), "{ not json", "utf8");
  const antes = fotografia(repo);
  const { io, out } = coletor();
  assert.throws(() => runtimeVersioning({ root: repo, positional: ["set", "versioned"], io, M: msg, gitIndex: gitProibido }), SyntaxError);
  assert.deepEqual(out, []);
  assert.deepEqual(fotografia(repo), antes);
});

test("should map each recorded value to its ignore file outcome", () => {
  assert.equal(runtimeIgnoreFileFor("unversioned"), "write");
  assert.equal(runtimeIgnoreFileFor("versioned"), "omit");
});

for (const valor of ["Versioned", ""]) {
  test(`should refuse to map ${JSON.stringify(valor)} to an ignore file outcome`, () => {
    assert.throws(() => runtimeIgnoreFileFor(valor), /versioned \| unversioned/);
  });
}

test("should refuse a plan whose answer is outside the vocabulary", () => {
  const repo = tempDir("mgr-rv-core-");
  assert.throws(() => withRuntimeVersioning({ scope: "project", repo }, "Versioned"), /versioned \| unversioned/);
});

test("should show a non-string invalid previous value as JSON when set overwrites it", () => {
  const repo = instalar("unversioned", { origin: "greenfield" });
  writeFileSync(path.join(coreDir("project", repo), CONFIG_NAME), `${JSON.stringify({ origin: "greenfield", runtimeVersioning: ["versioned"] })}\n`, "utf8");
  const { io, out } = coletor();
  assert.equal(runtimeVersioning({ root: repo, positional: ["set", "unversioned"], io, M: msg, gitIndex: () => ({ state: "listed", files: [] }) }), 0);
  assert.ok(out.includes(msg.rvWritten('["versioned"]', "unversioned")), out.join("\n"));
});
