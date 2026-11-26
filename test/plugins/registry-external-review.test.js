import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  configPath, LOCAL_CONFIG_NAME, misplacedTeamKeys, readExternalReview, readPersonal, readReviewConsent,
  removeReviewConsent, writeConfig, writeExternalReview, writeInitials, writePersonal, writeReviewConsent,
  writeReviewerOptions,
} from "../../src/plugins/registry.js";
import { UsageError } from "../../src/core/errors.js";
import { tempDir } from "../../scripts/lib/tmp.mjs";

const diretorioTemporario = () => tempDir("mgr-review-cfg-");
const configDo = (core) => JSON.parse(readFileSync(configPath(core), "utf8"));
const localDo = (core) => JSON.parse(readFileSync(path.join(core, LOCAL_CONFIG_NAME), "utf8"));
const ATIVO = { enabled: true, reviewers: ["codex"] };

test("should report absent when config.json has no externalReview", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [] });
  assert.deepEqual(readExternalReview(core), { state: "absent" });
});

test("should read a configured externalReview without options as an empty options map", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], externalReview: ATIVO });
  assert.deepEqual(readExternalReview(core), { state: "configured", enabled: true, reviewers: ["codex"], options: {} });
});

test("should read a configured externalReview with model and effort per reviewer", () => {
  const core = diretorioTemporario();
  writeConfig(core, {
    registries: [],
    externalReview: { enabled: true, reviewers: ["codex"], options: { codex: { model: "gpt-5", effort: "high" } } },
  });
  assert.deepEqual(readExternalReview(core), {
    state: "configured",
    enabled: true,
    reviewers: ["codex"],
    options: { codex: { model: "gpt-5", effort: "high" } },
  });
});

test("should refuse a non-boolean enabled with the configEnabledInvalid key", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], externalReview: { enabled: "sim", reviewers: ["codex"] } });
  assert.throws(() => readExternalReview(core), (erro) => erro instanceof UsageError && erro.key === "configEnabledInvalid");
});

test("should refuse an empty reviewers list with the externalReviewReviewersInvalid key", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], externalReview: { enabled: true, reviewers: [] } });
  assert.throws(() => readExternalReview(core), (erro) => erro instanceof UsageError && erro.key === "externalReviewReviewersInvalid");
});

test("should refuse a reviewer id that is not known with the externalReviewReviewersInvalid key", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], externalReview: { enabled: true, reviewers: ["gemini"] } });
  assert.throws(() => readExternalReview(core), (erro) => erro instanceof UsageError && erro.key === "externalReviewReviewersInvalid");
});

test("should refuse reviewers that is not an array with the externalReviewReviewersInvalid key", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], externalReview: { enabled: true, reviewers: "codex" } });
  assert.throws(() => readExternalReview(core), (erro) => erro instanceof UsageError && erro.key === "externalReviewReviewersInvalid");
});

test("should refuse an externalReview that is not an object with the configValueNotObject key", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], externalReview: true });
  assert.throws(() => readExternalReview(core), (erro) => erro instanceof UsageError && erro.key === "configValueNotObject");
});

test("should refuse an option for a reviewer that is not known with the reviewerUnknown key", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], externalReview: { ...ATIVO, options: { gemini: { model: "x" } } } });
  assert.throws(() => readExternalReview(core), (erro) => erro instanceof UsageError && erro.key === "reviewerUnknown");
});

test("should refuse a model with a space with the externalReviewOptionInvalid key", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], externalReview: { ...ATIVO, options: { codex: { model: "gpt 5" } } } });
  assert.throws(() => readExternalReview(core), (erro) => erro instanceof UsageError
    && erro.key === "externalReviewOptionInvalid" && erro.message.includes("model"));
});

test("should refuse an empty effort with the externalReviewOptionInvalid key", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], externalReview: { ...ATIVO, options: { codex: { effort: "" } } } });
  assert.throws(() => readExternalReview(core), (erro) => erro instanceof UsageError
    && erro.key === "externalReviewOptionInvalid" && erro.message.includes("effort"));
});

test("should preserve origin, agents and the recorded options when writing externalReview", () => {
  const core = diretorioTemporario();
  writeConfig(core, {
    registries: [],
    origin: "greenfield",
    agents: { execution: { effort: "low" } },
    externalReview: { enabled: false, reviewers: ["codex"], options: { codex: { model: "gpt-5" } } },
  });
  writeExternalReview(core, { enabled: true, reviewers: ["codex"] });
  const config = configDo(core);
  assert.equal(config.origin, "greenfield");
  assert.deepEqual(config.agents, { execution: { effort: "low" } });
  assert.deepEqual(config.externalReview, { enabled: true, reviewers: ["codex"], options: { codex: { model: "gpt-5" } } });
});

test("should leave config.json byte for byte when writeExternalReview receives an invalid request", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], origin: "brownfield" });
  const antes = readFileSync(configPath(core), "utf8");
  assert.throws(() => writeExternalReview(core, { enabled: true, reviewers: ["gemini"] }),
    (erro) => erro instanceof UsageError && erro.key === "externalReviewReviewersInvalid");
  assert.equal(readFileSync(configPath(core), "utf8"), antes);
});

test("should create a disabled externalReview when writing reviewer options without one", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [] });
  const { before, after } = writeReviewerOptions(core, "codex", { model: "gpt-5" });
  assert.deepEqual(before, {});
  assert.deepEqual(after, { model: "gpt-5" });
  assert.deepEqual(configDo(core).externalReview, {
    enabled: false,
    reviewers: ["codex"],
    options: { codex: { model: "gpt-5" } },
  });
});

test("should refuse writing options for a reviewer that is not known with the reviewerUnknown key", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [] });
  assert.throws(() => writeReviewerOptions(core, "gemini", { model: "x" }),
    (erro) => erro instanceof UsageError && erro.key === "reviewerUnknown");
});

test("should merge effort into the recorded options without losing the model", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], externalReview: { ...ATIVO, options: { codex: { model: "gpt-5" } } } });
  const { before, after } = writeReviewerOptions(core, "codex", { effort: "high" });
  assert.deepEqual(before, { model: "gpt-5" });
  assert.deepEqual(after, { model: "gpt-5", effort: "high" });
  assert.deepEqual(readExternalReview(core).options, { codex: { model: "gpt-5", effort: "high" } });
  assert.equal(readExternalReview(core).enabled, true, "configurar opções não mexe na ativação");
});

test("should write consent to config.local.json and never to config.json", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [] });
  const { before, after } = writeReviewConsent(core, "codex", "2026-11-26T10:00:00.000Z");
  assert.deepEqual(before, { state: "absent" });
  assert.deepEqual(after, { state: "given", at: "2026-11-26T10:00:00.000Z" });
  assert.equal(Object.hasOwn(configDo(core), "externalReviewConsent"), false);
  assert.deepEqual(localDo(core).externalReviewConsent, { codex: { at: "2026-11-26T10:00:00.000Z" } });
  assert.deepEqual(readReviewConsent(core, "codex"), { state: "given", at: "2026-11-26T10:00:00.000Z" });
});

test("should report absent consent when config.local.json does not exist", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [] });
  assert.equal(existsSync(path.join(core, LOCAL_CONFIG_NAME)), false);
  assert.deepEqual(readReviewConsent(core, "codex"), { state: "absent" });
});

test("should refuse a consent entry that is not an object with the configValueNotObject key", () => {
  const core = diretorioTemporario();
  writeFileSync(path.join(core, LOCAL_CONFIG_NAME), JSON.stringify({ externalReviewConsent: { codex: "sim" } }));
  assert.throws(() => readReviewConsent(core, "codex"), (erro) => erro instanceof UsageError && erro.key === "configValueNotObject");
});

test("should preserve projectId and initials when writing consent", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [] });
  writePersonal(core, { projectId: "projeto-1" });
  writeInitials(core, "mr");
  writeReviewConsent(core, "codex", "2026-11-26T10:00:00.000Z");
  const local = localDo(core);
  assert.equal(local.projectId, "projeto-1");
  assert.equal(local.initials, "mr");
  assert.deepEqual(local.externalReviewConsent, { codex: { at: "2026-11-26T10:00:00.000Z" } });
});

test("should remove only the consent of the given reviewer and keep the others", () => {
  const core = diretorioTemporario();
  writeFileSync(path.join(core, LOCAL_CONFIG_NAME), JSON.stringify({
    externalReviewConsent: { codex: { at: "2026-11-26T10:00:00.000Z" }, outro: { at: "2026-11-20T09:00:00.000Z" } },
  }));
  const { before, after } = removeReviewConsent(core, "codex");
  assert.deepEqual(before, { state: "given", at: "2026-11-26T10:00:00.000Z" });
  assert.deepEqual(after, { state: "absent" });
  assert.deepEqual(localDo(core).externalReviewConsent, { outro: { at: "2026-11-20T09:00:00.000Z" } });
});

test("should remove the externalReviewConsent key when the last consent is removed", () => {
  const core = diretorioTemporario();
  writeReviewConsent(core, "codex", "2026-11-26T10:00:00.000Z");
  removeReviewConsent(core, "codex");
  assert.equal(Object.hasOwn(localDo(core), "externalReviewConsent"), false);
  assert.deepEqual(readReviewConsent(core, "codex"), { state: "absent" });
});

test("should not list externalReviewConsent as an unknown key of config.local.json", () => {
  const core = diretorioTemporario();
  writeReviewConsent(core, "codex", "2026-11-26T10:00:00.000Z");
  assert.deepEqual(readPersonal(core).ignoredUnknown, []);
  assert.deepEqual(readPersonal(core).ignoredTeam, []);
});

test("should not list externalReview of config.json as a personal key in the wrong place", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], externalReview: ATIVO });
  assert.deepEqual(misplacedTeamKeys(core), []);
});

test("should refuse a repeated reviewer with the externalReviewReviewersInvalid key", () => {
  const core = diretorioTemporario();
  writeConfig(core, { registries: [], externalReview: { enabled: true, reviewers: ["codex", "codex"] } });
  assert.throws(() => readExternalReview(core), (erro) => erro instanceof UsageError && erro.key === "externalReviewReviewersInvalid");
});

for (const [rotulo, externalReview] of [
  ["externalReview.options", { enabled: true, reviewers: ["codex"], options: "m1" }],
  ["externalReview.options.codex", { enabled: true, reviewers: ["codex"], options: { codex: "m1" } }],
]) {
  test(`should refuse ${rotulo} that is not an object with the configValueNotObject key`, () => {
    const core = diretorioTemporario();
    writeConfig(core, { registries: [], externalReview });
    assert.throws(() => readExternalReview(core),
      (erro) => erro instanceof UsageError && erro.key === "configValueNotObject" && erro.params[0] === rotulo);
  });
}

test("should refuse an externalReviewConsent that is not an object with the configValueNotObject key", () => {
  const core = diretorioTemporario();
  mkdirSync(core, { recursive: true });
  writeFileSync(path.join(core, "config.local.json"), JSON.stringify({ externalReviewConsent: "sim" }));
  assert.throws(() => readReviewConsent(core, "codex"),
    (erro) => erro instanceof UsageError && erro.key === "configValueNotObject" && erro.params[0] === "externalReviewConsent");
});

for (const at of ["", "ontem", "2026-11-26", "2026-13-40T99:99:99.999Z"]) {
  test(`should read a consent with the time ${JSON.stringify(at)} as absent`, () => {
    const core = diretorioTemporario();
    mkdirSync(core, { recursive: true });
    writeFileSync(path.join(core, "config.local.json"), JSON.stringify({ externalReviewConsent: { codex: { at } } }));
    assert.deepEqual(readReviewConsent(core, "codex"), { state: "absent" });
  });
}

test("should refuse to write a consent whose time is not an ISO time and write nothing", () => {
  const core = diretorioTemporario();
  assert.throws(() => writeReviewConsent(core, "codex", ""),
    (erro) => erro instanceof UsageError && erro.key === "externalReviewConsentAtInvalid");
  assert.equal(existsSync(path.join(core, "config.local.json")), false);
});
