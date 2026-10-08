// Oraculo da F1, parte 2 (RN-19, specs/entrega-f1-runtime-no-projeto/03-spec.md secoes 7 e 9). Prova que o
// runtime instalado no projeto funciona SEM `mgr` no PATH, de um subdiretorio e sem rede. Regra inegociavel:
// este arquivo NAO importa nada de `src/`; so executa processos filhos e le o disco. Os literais esperados
// vem dos criterios CA-2, CA-3, CA-15 e CA-19 e da regra "Sem PATH" da secao 7.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MGR_BIN = path.join(PACKAGE_ROOT, "bin", "mgr.js");
const RUNTIME_RELATIVE = ["skills", "_shared", "mgr", "bin", "mgr-runtime.js"];
const RUNTIMES = [path.join(".claude", ...RUNTIME_RELATIVE), path.join(".github", ...RUNTIME_RELATIVE)];
const TIMEOUT_MS = 120000;

const COMMANDS = [
  ["spec", "status", "demo", "--json"],
  ["spec", "validate", "demo"],
  ["spec", "next", "demo"],
  ["agents", "drafting", "--json"],
  ["agents", "execution", "--json"],
  ["agents", "set", "review", "--effort", "high"],
  ["origin", "set", "greenfield"],
  ["agents", "apply"],
  ["sdd-check"],
  ["doctor"],
];

const SPEC_TEXT = "<!-- mgr-spec-format: 1 -->\n# Spec - demo\n\n- [ ] **CA-1:** the demo criterion is observable\n";
const PLAN_TEXT = [
  "<!-- mgr-plan-format: 1 -->",
  "# Plan - demo",
  "",
  "## P0 - Blocking",
  "### P0.1 - Demo task",
  "- **priority:** P0",
  "- **depends_on:** []",
  "- **files:** [src/demo.js]",
  "- **artifact:** one demo module",
  "- **done_when:** the demo test passes",
  "- **status:** todo",
  "",
].join("\n");
const PRELOAD_TEXT = [
  'import net from "node:net";',
  'globalThis.fetch = () => { throw new Error("network is forbidden in this test"); };',
  'net.connect = () => { throw new Error("network is forbidden in this test"); };',
  'net.createConnection = () => { throw new Error("network is forbidden in this test"); };',
  "",
].join("\n");

const makeTemp = (label) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `mgr-e2e-${label}-`)));

const assertOutsideGit = (dir) => {
  const probe = spawnSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  assert.equal(probe.error, undefined, "git must be runnable to prove the temp dir is outside a repository");
  assert.notEqual(probe.status, 0, "the temp dir must not be inside a git work tree");
};

let reducedPathDir = null;

function reducedPath() {
  if (reducedPathDir) return reducedPathDir;
  const dir = makeTemp("path");
  fs.symlinkSync(process.execPath, path.join(dir, "node"));
  const absoluteSh = spawnSync("sh", ["-c", "command -v sh"], { encoding: "utf8" }).stdout.trim();
  assert.ok(path.isAbsolute(absoluteSh), `sh must resolve to an absolute path: ${absoluteSh}`);
  const probe = spawnSync(absoluteSh, ["-c", "command -v mgr"], { encoding: "utf8", env: { PATH: dir } });
  assert.equal(probe.error, undefined, "the probe must run");
  assert.notEqual(probe.status, 0, `mgr must not resolve in the reduced PATH: ${probe.stdout}`);
  reducedPathDir = dir;
  return dir;
}

const runtimeEnv = (home, extra = {}) => ({ PATH: reducedPath(), HOME: home, LC_ALL: "C", ...extra });

function runNode(args, { cwd, env }) {
  return spawnSync("node", args, { cwd, encoding: "utf8", timeout: TIMEOUT_MS, env });
}

function runPackage(args, { cwd, home, extra = {} }) {
  return spawnSync(process.execPath, [MGR_BIN, ...args], {
    cwd,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    env: { ...process.env, LC_ALL: "C", HOME: home, ...extra },
  });
}

function fixture(label) {
  const project = makeTemp(label);
  const home = makeTemp(`${label}-home`);
  assertOutsideGit(project);
  const installed = runPackage(["install", project, "-y", "--engine", "both", "--all-skills"], { cwd: project, home });
  assert.equal(installed.status, 0, `install failed: ${installed.stderr}`);
  fs.mkdirSync(path.join(project, "docs", "sdd"), { recursive: true });
  fs.writeFileSync(path.join(project, "docs", "sdd", "CONSTITUTION.md"), "# Constitution\n", "utf8");
  fs.writeFileSync(path.join(project, "docs", "sdd", "00-overview.md"), "# Overview\n", "utf8");
  const feature = path.join(project, "specs", "demo");
  fs.mkdirSync(feature, { recursive: true });
  fs.writeFileSync(path.join(feature, "02-prd.md"), "# PRD - demo\n", "utf8");
  fs.writeFileSync(path.join(feature, "03-spec.md"), SPEC_TEXT, "utf8");
  fs.writeFileSync(path.join(feature, "04-plan.md"), PLAN_TEXT, "utf8");
  return { project, home };
}

const nestedPackage = (project) => {
  const nested = path.join(project, "packages", "a");
  fs.mkdirSync(path.join(nested, ".git"), { recursive: true });
  fs.writeFileSync(path.join(nested, "package.json"), '{ "name": "nested-a", "version": "0.0.0" }\n', "utf8");
  return nested;
};

test("should exit 0 on the ten runtime commands of both engines with only node in the PATH (CA-2)", () => {
  const { project, home } = fixture("ca2");
  for (const runtime of RUNTIMES) {
    for (const command of COMMANDS) {
      const result = runNode([runtime, ...command], { cwd: project, env: runtimeEnv(home) });
      assert.equal(result.error, undefined, `${runtime} ${command.join(" ")}: ${result.error}`);
      assert.equal(result.status, 0, `${runtime} ${command.join(" ")}: ${result.stdout}${result.stderr}`);
    }
  }
});

test("should resolve the project root and the saved model from a subdirectory with its own package.json and .git (CA-3)", () => {
  const { project, home } = fixture("ca3");
  const runtime = path.join(project, RUNTIMES[0]);
  const set = runNode([runtime, "agents", "set", "drafting", "--model", "opus"], { cwd: project, env: runtimeEnv(home) });
  assert.equal(set.status, 0, set.stderr);
  const nested = nestedPackage(project);

  const status = runNode([runtime, "spec", "status", "demo", "--json"], { cwd: nested, env: runtimeEnv(home) });
  assert.equal(status.status, 0, status.stderr);
  const specRoot = JSON.parse(status.stdout).specRoot;
  const resolved = path.resolve(project, specRoot);
  assert.equal(resolved, path.join(project, "specs", "demo"));
  assert.equal(fs.existsSync(path.join(nested, "specs")), false, "no specs folder may appear in the subdirectory");

  const agents = runNode([runtime, "agents", "drafting", "--json"], { cwd: nested, env: runtimeEnv(home) });
  assert.equal(agents.status, 0, agents.stderr);
  const engine = JSON.parse(agents.stdout).intents.drafting.engines["claude-code"];
  assert.equal(engine.model, "opus");
  assert.equal(engine.modelSource, "configured");
  assert.equal(fs.existsSync(path.join(nested, ".mgr-core")), false, "the config must not be written in the subdirectory");
});

test("should keep the CA-2 exit codes with fetch and net.connect throwing (CA-15)", () => {
  const { project, home } = fixture("ca15");
  const preload = path.join(project, "no-network.mjs");
  fs.writeFileSync(preload, PRELOAD_TEXT, "utf8");
  const importFlag = ["--import", pathToFileURL(preload).href];

  const guard = runNode(
    [...importFlag, "-e", "let n = 0; for (const f of [() => fetch('http://127.0.0.1:1'), () => require('node:net').connect(1), () => require('node:net').createConnection(1)]) { try { f(); } catch { n += 1; } } process.exit(n === 3 ? 0 : 1);"],
    { cwd: project, env: runtimeEnv(home) },
  );
  assert.equal(guard.status, 0, `the preload must make the network calls throw: ${guard.stderr}`);

  for (const runtime of RUNTIMES) {
    for (const command of COMMANDS) {
      const result = runNode([...importFlag, runtime, ...command], { cwd: project, env: runtimeEnv(home) });
      assert.equal(result.status, 0, `${runtime} ${command.join(" ")} offline: ${result.stdout}${result.stderr}`);
    }
  }
});

test("should answer in the manifest language, not the locale, from a subdirectory in both CLIs (CA-19)", () => {
  const { project, home } = fixture("ca19");
  const manifestFile = path.join(project, ".mgr-core", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  manifest.userLanguage = "en";
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const nested = nestedPackage(project);
  const english = "This is FILE EXISTENCE, not progress.";
  const portuguese = "Isto é EXISTÊNCIA DE ARQUIVO, não progresso.";

  const viaPackage = runPackage(["spec", "status", "--all"], { cwd: nested, home, extra: { LC_ALL: "pt_BR.UTF-8" } });
  const viaRuntime = runNode([path.join(project, RUNTIMES[0]), "spec", "status", "--all"], {
    cwd: nested,
    env: runtimeEnv(home, { LC_ALL: "pt_BR.UTF-8" }),
  });
  for (const [label, result] of [["package", viaPackage], ["runtime", viaRuntime]]) {
    assert.equal(result.status, 0, `${label}: ${result.stderr}`);
    assert.ok(result.stdout.includes("demo"), `${label}: ${result.stdout}`);
    assert.ok(result.stdout.includes(english), `${label} must answer in English: ${result.stdout}`);
    assert.equal(result.stdout.includes(portuguese), false, `${label} must not answer in Portuguese`);
  }
});

test("should name the npx lifecycle command, never a bare mgr, in the doctor fixes of the runtime (DT-15)", () => {
  const { project, home } = fixture("dt15");
  const { version } = JSON.parse(fs.readFileSync(path.join(project, ".mgr-core", "manifest.json"), "utf8"));
  fs.rmSync(path.join(project, ".claude", "agents", "mgr-draft.md"));

  const result = runNode([RUNTIMES[0], "doctor"], { cwd: project, env: runtimeEnv(home) });
  assert.equal(result.status, 1, result.stdout);
  assert.ok(result.stdout.includes(`npx mgr-method@${version} update`), result.stdout);
  assert.equal(/resolva com: mgr /.test(result.stdout), false, result.stdout);
});

test("should keep the eight engine-independent commands at exit 0 and name the removed .claude agents on the other two (CA-25)", () => {
  const { project, home } = fixture("ca25");
  fs.rmSync(path.join(project, ".claude"), { recursive: true, force: true });
  const runtime = RUNTIMES[1];
  const inspectsRemovedEngine = (command) => ["agents apply", "doctor"].includes(command.join(" "));

  for (const command of COMMANDS) {
    const result = runNode([runtime, ...command], { cwd: project, env: runtimeEnv(home) });
    const label = `${runtime} ${command.join(" ")}`;
    if (!inspectsRemovedEngine(command)) {
      assert.equal(result.status, 0, `${label}: ${result.stdout}${result.stderr}`);
      continue;
    }
    assert.equal(result.status, 1, `${label}: ${result.stdout}${result.stderr}`);
    assert.ok(`${result.stdout}${result.stderr}`.includes(path.join(".claude", "agents", "mgr-draft.md")), label);
  }
});
