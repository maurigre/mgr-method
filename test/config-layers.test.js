import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execute, planInstall } from "../src/installer.js";
import { PERSONAL_KEYS, TEAM_KEYS, misplacedTeamKeys, previewAgents, readAgents, readPersonal, writePersonal } from "../src/registry.js";

const diretorioTemporario = () => mkdtempSync(path.join(os.tmpdir(), "mgr-config-layers-"));

test("should read projectId from the personal layer", () => {
  const coreDir = diretorioTemporario();
  writePersonal(coreDir, { projectId: "abc123" });

  assert.deepEqual(readPersonal(coreDir), {
    projectId: "abc123",
    ignoredTeam: [],
    ignoredUnknown: [],
  });
});

test("should ignore and report a team key written in config.local.json", () => {
  const coreDir = diretorioTemporario();
  writeFileSync(path.join(coreDir, "config.local.json"), JSON.stringify({ projectId: "abc123", agents: {} }));

  const personal = readPersonal(coreDir);
  assert.equal(personal.projectId, "abc123");
  assert.deepEqual(personal.ignoredTeam, ["agents"]);
  assert.deepEqual(personal.ignoredUnknown, []);
});

test("should ignore and report an unknown key in config.local.json", () => {
  const coreDir = diretorioTemporario();
  writeFileSync(path.join(coreDir, "config.local.json"), JSON.stringify({ projectId: "abc123", foo: 1 }));

  const personal = readPersonal(coreDir);
  assert.equal(personal.projectId, "abc123");
  assert.deepEqual(personal.ignoredTeam, []);
  assert.deepEqual(personal.ignoredUnknown, ["foo"]);
});

test("should report projectId written in config.json as misplaced", () => {
  const coreDir = diretorioTemporario();
  writeFileSync(path.join(coreDir, "config.json"), JSON.stringify({ registries: [], projectId: "abc123" }));

  assert.deepEqual(misplacedTeamKeys(coreDir), ["projectId"]);
});

test("should keep reading the model policy only from config.json", () => {
  const baseline = readAgents(diretorioTemporario());

  const coreDir = diretorioTemporario();
  writeFileSync(
    path.join(coreDir, "config.local.json"),
    JSON.stringify({ agents: { review: { enabled: false, model: { "claude-code": "haiku" } } } }),
  );

  assert.deepEqual(readAgents(coreDir).policies, baseline.policies);
  assert.deepEqual(readAgents(coreDir).sources, baseline.sources);
});

test("should preserve unknown team keys when writing the personal layer", () => {
  const coreDir = diretorioTemporario();
  const file = path.join(coreDir, "config.local.json");
  writeFileSync(file, JSON.stringify({ agents: { review: { enabled: false } }, foo: 1 }));

  writePersonal(coreDir, { projectId: "novo-id" });

  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
    agents: { review: { enabled: false } },
    foo: 1,
    projectId: "novo-id",
  });
});

test("should name the file when config.local.json is not valid JSON and keep it untouched on write", () => {
  const core = diretorioTemporario();
  const file = path.join(core, "config.local.json");
  writeFileSync(file, "{ not json", "utf8");
  assert.throws(() => readPersonal(core), (error) => error.message.includes(file) && error.message.includes("not valid JSON"));
  assert.throws(() => writePersonal(core, { projectId: "dev-a" }), /not valid JSON/);
  assert.equal(readFileSync(file, "utf8"), "{ not json");
});

test("should refuse a config.local.json that is not a JSON object", () => {
  const core = diretorioTemporario();
  writeFileSync(path.join(core, "config.local.json"), "[]", "utf8");
  assert.throws(() => readPersonal(core), /must contain a JSON object/);
});

test("should refuse an empty or non-string projectId on read and on write", () => {
  const core = diretorioTemporario();
  writeFileSync(path.join(core, "config.local.json"), JSON.stringify({ projectId: "" }), "utf8");
  assert.throws(() => readPersonal(core), /invalid projectId/);
  assert.throws(() => writePersonal(diretorioTemporario(), { projectId: 42 }), /invalid projectId/);
  assert.throws(() => writePersonal(diretorioTemporario()), /invalid projectId/);
});

test("should fix the team and personal key lists of DT-2", () => {
  assert.deepEqual([...PERSONAL_KEYS], ["projectId"]);
  assert.deepEqual([...TEAM_KEYS].sort(), [
    "agents", "architecture", "detectionMode", "language", "lawsPreamble", "origin", "registries", "reviewGate", "userLanguage",
  ]);
});

test("should return no projectId and empty lists when config.local.json is absent", () => {
  const read = readPersonal(diretorioTemporario());
  assert.deepEqual(read, { ignoredTeam: [], ignoredUnknown: [] });
  assert.equal(Object.hasOwn(read, "projectId"), false);
});

test("should report a team key and no projectId when config.local.json has only a team key", () => {
  const core = diretorioTemporario();
  writeFileSync(path.join(core, "config.local.json"), JSON.stringify({ agents: {} }), "utf8");
  assert.deepEqual(readPersonal(core), { ignoredTeam: ["agents"], ignoredUnknown: [] });
});

test("should refuse a non-string projectId on read and an empty one on write", () => {
  const core = diretorioTemporario();
  writeFileSync(path.join(core, "config.local.json"), JSON.stringify({ projectId: 42 }), "utf8");
  assert.throws(() => readPersonal(core), /invalid projectId/);
  assert.throws(() => writePersonal(diretorioTemporario(), { projectId: "" }), /invalid projectId/);
});

test("should report no misplaced key when config.json has no projectId", () => {
  const core = diretorioTemporario();
  writeFileSync(path.join(core, "config.json"), JSON.stringify({ origin: "brownfield" }), "utf8");
  assert.deepEqual(misplacedTeamKeys(core), []);
});

// --- P1.2: o install grava só o que foi respondido ---
const repoTemporario = () => mkdtempSync(path.join(os.tmpdir(), "mgr-p12-"));
const instalar = (repo, opts = {}) => {
  const plan = planInstall(["claude-code"], "project", repo, { all: true, ...opts });
  return { plan, result: execute(plan) };
};
const configDe = (repo) => path.join(repo, ".mgr-core", "config.json");
const lerConfig = (repo) => JSON.parse(readFileSync(configDe(repo), "utf8"));

test("should not create config.json when nothing was answered", () => {
  const repo = repoTemporario();
  instalar(repo);
  assert.equal(existsSync(configDe(repo)), false);
});

test("should write only the answered intent and engine", () => {
  const repo = repoTemporario();
  instalar(repo, { models: { review: { "claude-code": "haiku" } } });
  assert.deepEqual(lerConfig(repo).agents, { review: { model: { "claude-code": "haiku" } } });
});

test("should write origin only when answered", () => {
  const sem = repoTemporario();
  instalar(sem, { origin: null });
  assert.equal(existsSync(configDe(sem)), false);

  const com = repoTemporario();
  instalar(com, { origin: "brownfield" });
  assert.equal(lerConfig(com).origin, "brownfield");
});

test("should preserve unknown team keys when writing answers", () => {
  const repo = repoTemporario();
  mkdirSync(path.join(repo, ".mgr-core"), { recursive: true });
  writeFileSync(configDe(repo), JSON.stringify({ registries: [], chaveDoTime: { a: 1 }, agents: { execution: { effort: "low" } } }));
  instalar(repo, { models: { review: { "claude-code": "haiku" } }, origin: "greenfield" });
  const config = lerConfig(repo);
  assert.deepEqual(config.chaveDoTime, { a: 1 });
  assert.equal(config.agents.execution.effort, "low");
  assert.equal(config.agents.review.model["claude-code"], "haiku");
  assert.equal(config.origin, "greenfield");
});

test("should install agent files from the same policy the plan showed", () => {
  const repo = repoTemporario();
  const { plan, result } = instalar(repo, { models: { review: { "claude-code": "haiku" } } });
  assert.equal(plan.agents.policies.review.model["claude-code"], "haiku");
  assert.equal(existsSync(configDe(repo)), true);
  assert.deepEqual(plan.agents, readAgents(path.join(repo, ".mgr-core")), "o plano tem de ser a política que ficou gravada");
  const conteudos = result.agents.map((arquivo) => readFileSync(path.resolve(repo, arquivo), "utf8"));
  assert.ok(conteudos.some((texto) => texto.includes("model: haiku")));
});

test("should not write config.json while previewing the agents", () => {
  const core = diretorioTemporario();
  const preview = previewAgents(core, { review: { "claude-code": "haiku" } });
  assert.equal(preview.policies.review.model["claude-code"], "haiku");
  assert.equal(existsSync(path.join(core, "config.json")), false);
  assert.throws(() => previewAgents(core, { inexistente: { "claude-code": "x" } }), /unknown agent intent/);
  assert.deepEqual(previewAgents(core, {}), readAgents(core));
});

test("should record optional and allSkills in the manifest", () => {
  const repo = repoTemporario();
  instalar(repo, { all: true, optional: ["x-opcional"] });
  const man = JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8"));
  assert.deepEqual(man.optional, ["x-opcional"]);
  assert.equal(man.allSkills, true);

  const outro = repoTemporario();
  instalar(outro, { all: false, language: "java", architecture: "hexagonal" });
  const manOutro = JSON.parse(readFileSync(path.join(outro, ".mgr-core", "manifest.json"), "utf8"));
  assert.deepEqual(manOutro.optional, []);
  assert.equal(manOutro.allSkills, false);
});

// --- P1.17: `agents` avisa a chave pessoal ignorada só em stderr (CA-6), pelo runtime copiado ---
const MGR_BIN_P117 = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
const RUNTIME_P117 = path.join(".claude", "skills", "_shared", "mgr", "bin", "mgr-runtime.js");

const projetoInstaladoP117 = () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "mgr-p117-projeto-"));
  const home = mkdtempSync(path.join(os.tmpdir(), "mgr-p117-home-"));
  const probe = spawnSync("git", ["-C", project, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  assert.equal(probe.error, undefined, "git must be runnable to prove the temp dir is outside a repository");
  assert.notEqual(probe.status, 0, "the temp dir must not be inside a git work tree");
  const env = { ...process.env, LC_ALL: "C", HOME: home };
  const instalado = spawnSync(process.execPath, [MGR_BIN_P117, "install", project, "-y", "--engine", "claude-code"], {
    cwd: project, encoding: "utf8", env,
  });
  assert.equal(instalado.status, 0, `install failed: ${instalado.stderr}`);
  return { project, home };
};

const agentsRuntimeP117 = (project, home) => spawnSync(
  process.execPath,
  [path.join(project, RUNTIME_P117), "agents", "review", "--json"],
  { cwd: project, encoding: "utf8", env: { ...process.env, LC_ALL: "C", HOME: home } },
);

test("should keep the team review model when config.local.json declares another", () => {
  const { project, home } = projetoInstaladoP117();
  writeFileSync(path.join(project, ".mgr-core", "config.json"), JSON.stringify({ agents: { review: { model: { "claude-code": "opus" } } } }), "utf8");
  writeFileSync(path.join(project, ".mgr-core", "config.local.json"), JSON.stringify({ agents: { review: { model: { "claude-code": "haiku" } } } }), "utf8");

  const result = agentsRuntimeP117(project, home);
  assert.equal(result.status, 0, result.stderr);
  const engine = JSON.parse(result.stdout).intents.review.engines["claude-code"];
  assert.equal(engine.model, "opus");
  assert.equal(engine.modelSource, "configured");
});

test("should print valid JSON on stdout and the ignored-key notice on stderr", () => {
  const { project, home } = projetoInstaladoP117();
  writeFileSync(path.join(project, ".mgr-core", "config.local.json"), JSON.stringify({ agents: { review: { model: { "claude-code": "haiku" } } } }), "utf8");

  const result = agentsRuntimeP117(project, home);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotThrow(() => JSON.parse(result.stdout), "stdout must stay pure JSON");
  assert.equal(result.stdout.includes("config.local.json"), false, "the notice must not reach stdout");
  assert.ok(
    result.stderr.includes("config.local.json: agents belong to the team config (.mgr-core/config.json) and were ignored."),
    result.stderr,
  );
});

test("should name an unreadable config.local.json on stderr and keep the agents output", async () => {
  const { agents } = await import("../src/commands/agents.js");
  const { getMessages } = await import("../src/messages.js");
  const root = diretorioTemporario();
  mkdirSync(path.join(root, ".mgr-core"), { recursive: true });
  const ler = () => {
    const out = [];
    const err = [];
    const code = agents({ root, cwd: root, flags: { json: true }, positional: ["review"], io: { out: (linha) => out.push(linha), err: (linha) => err.push(linha) }, M: getMessages("en") });
    return { code, out, err };
  };
  const antes = ler();
  writeFileSync(path.join(root, ".mgr-core", "config.local.json"), "{ quebrado", "utf8");
  const depois = ler();
  assert.equal(depois.code, antes.code);
  assert.deepEqual(depois.out, antes.out, "o stdout e guarda de paridade da F1");
  assert.ok(depois.err.some((linha) => linha.includes("config.local.json") && linha.includes("not valid JSON")), depois.err.join("\n"));
});

test("should read the origin as recorded, absent or invalid", async () => {
  const { readOrigin } = await import("../src/registry.js");
  const core = diretorioTemporario();
  assert.deepEqual(readOrigin(core), { state: "absent" });
  writeFileSync(path.join(core, "config.json"), JSON.stringify({ origin: "brownfield" }), "utf8");
  assert.deepEqual(readOrigin(core), { state: "recorded", origin: "brownfield" });
  writeFileSync(path.join(core, "config.json"), JSON.stringify({ origin: "legacy" }), "utf8");
  assert.deepEqual(readOrigin(core), { state: "invalid", value: "legacy" });
});

// --- P1.18: `origin [--json]`, modo de leitura (CA-23, DT-15) ---
const coletorDeSaida = () => {
  const out = [];
  const err = [];
  return { out, err, io: { out: (linha) => out.push(linha), err: (linha) => err.push(linha) } };
};

test("should report absent origin as JSON with exit 0", async () => {
  const { origin } = await import("../src/commands/origin.js");
  const { getMessages } = await import("../src/messages.js");
  const root = diretorioTemporario();
  const saida = coletorDeSaida();
  const code = origin({ root, positional: [], flags: { json: true }, io: saida.io, M: getMessages("en") });
  assert.equal(code, 0);
  assert.deepEqual(saida.out, [`{"schemaVersion":1,"state":"absent"}`]);
  assert.deepEqual(saida.err, []);
});

test("should report the recorded origin after install", async () => {
  const { origin } = await import("../src/commands/origin.js");
  const { getMessages } = await import("../src/messages.js");
  const project = mkdtempSync(path.join(os.tmpdir(), "mgr-p118-projeto-"));
  const home = mkdtempSync(path.join(os.tmpdir(), "mgr-p118-home-"));
  const probe = spawnSync("git", ["-C", project, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  assert.equal(probe.error, undefined, "git must be runnable to prove the temp dir is outside a repository");
  assert.notEqual(probe.status, 0, "the temp dir must not be inside a git work tree");
  const instalado = spawnSync(
    process.execPath,
    [MGR_BIN_P117, "install", "--engine", "claude-code", "--origin", "brownfield", "-y", project],
    { cwd: project, encoding: "utf8", env: { ...process.env, LC_ALL: "C", HOME: home } },
  );
  assert.equal(instalado.status, 0, `install failed: ${instalado.stderr}`);

  const saida = coletorDeSaida();
  const code = origin({ root: project, positional: [], flags: { json: true }, io: saida.io, M: getMessages("en") });
  assert.equal(code, 0);
  assert.deepEqual(saida.out, [`{"schemaVersion":1,"state":"recorded","origin":"brownfield"}`]);
});

test("should report an invalid hand-written origin with exit 1", async () => {
  const { origin } = await import("../src/commands/origin.js");
  const { getMessages } = await import("../src/messages.js");
  const root = diretorioTemporario();
  mkdirSync(path.join(root, ".mgr-core"), { recursive: true });
  writeFileSync(path.join(root, ".mgr-core", "config.json"), JSON.stringify({ origin: "legacy" }), "utf8");
  const saida = coletorDeSaida();
  const code = origin({ root, positional: [], flags: { json: true }, io: saida.io, M: getMessages("en") });
  assert.equal(code, 1);
  assert.deepEqual(saida.out, [`{"schemaVersion":1,"state":"invalid","value":"legacy"}`]);
});

test("should keep refusing origin with a value but without set", async () => {
  const { origin } = await import("../src/commands/origin.js");
  const { getMessages } = await import("../src/messages.js");
  const root = diretorioTemporario();
  const saida = coletorDeSaida();
  const code = origin({ root, positional: ["brownfield"], flags: {}, io: saida.io, M: getMessages("en") });
  assert.equal(code, 1);
  assert.deepEqual(saida.out, []);
  assert.equal(saida.err.length, 1);
  assert.ok(saida.err[0].includes("origin set needs a value"), saida.err.join("\n"));
  assert.equal(existsSync(path.join(root, ".mgr-core", "config.json")), false, "a recusa nao grava nada");
});

test("should print the human origin text for each of the three states", async () => {
  const { origin } = await import("../src/commands/origin.js");
  const { getMessages } = await import("../src/messages.js");
  const M = getMessages("en", { invocation: "node X" });
  const root = diretorioTemporario();
  mkdirSync(path.join(root, ".mgr-core"), { recursive: true });
  const ler = () => {
    const out = [];
    const code = origin({ root, positional: [], flags: {}, io: { out: (linha) => out.push(linha), err: () => {} }, M });
    return { code, out };
  };
  assert.deepEqual(ler(), { code: 0, out: ["project origin: not recorded — run node X origin set greenfield|brownfield"] });
  writeFileSync(path.join(root, ".mgr-core", "config.json"), JSON.stringify({ origin: "greenfield" }), "utf8");
  assert.deepEqual(ler(), { code: 0, out: ["project origin: greenfield (.mgr-core/config.json)"] });
  writeFileSync(path.join(root, ".mgr-core", "config.json"), JSON.stringify({ origin: "legacy" }), "utf8");
  assert.deepEqual(ler(), { code: 1, out: ["project origin: invalid value legacy in .mgr-core/config.json"] });
});

test("should warn on stderr about an unknown key in config.local.json and keep the agents output", async () => {
  const { agents } = await import("../src/commands/agents.js");
  const { getMessages } = await import("../src/messages.js");
  const root = diretorioTemporario();
  mkdirSync(path.join(root, ".mgr-core"), { recursive: true });
  const ler = () => {
    const out = [];
    const err = [];
    agents({ root, cwd: root, flags: { json: true }, positional: ["review"], io: { out: (linha) => out.push(linha), err: (linha) => err.push(linha) }, M: getMessages("en") });
    return { out, err };
  };
  const antes = ler();
  writeFileSync(path.join(root, ".mgr-core", "config.local.json"), JSON.stringify({ projectid: "digitado-errado" }), "utf8");
  const depois = ler();
  assert.deepEqual(depois.out, antes.out);
  assert.deepEqual(depois.err, ["config.local.json: projectid is not a recognized key and was ignored."]);
});
