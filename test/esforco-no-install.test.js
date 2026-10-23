import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "../scripts/lib/tmp.mjs";
import { getMessages } from "../src/messages.js";

const msg = getMessages("en");
const MGR_BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "mgr.js");
const LEVELS = "low | medium | high | xhigh | max | inherit";

function tempOutsideGit(label) {
  const dir = fs.realpathSync(tempDir(`mgr-esforco-${label}-`));
  const probe = spawnSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  assert.equal(probe.error, undefined);
  assert.notEqual(probe.status, 0);
  return dir;
}

function runMgr(args, { cwd, home }) {
  return spawnSync(process.execPath, [MGR_BIN, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120000,
    env: { ...process.env, LC_ALL: "C", HOME: home },
  });
}

function install(extraArgs, { flagsLast = false } = {}) {
  const project = tempOutsideGit("proj");
  const home = tempOutsideGit("home");
  const base = ["install", "--scope", "project", "--all-skills", "-y"];
  const finalArgs = flagsLast ? [...base, project, ...extraArgs] : [...base, ...extraArgs, project];
  const result = runMgr(finalArgs, { cwd: project, home });
  return { project, home, result };
}

const errorLine = (message) => msg.errorPrefix(message);
const coreOf = (project) => path.join(project, ".mgr-core");
const configOf = (project) => JSON.parse(fs.readFileSync(path.join(coreOf(project), "config.json"), "utf8"));
const agentFile = (project, name) => fs.readFileSync(path.join(project, ".claude", "agents", name), "utf8");

function assertRefused(run, message, { beforeBanner = true } = {}) {
  assert.equal(run.result.status, 1, run.result.stdout + run.result.stderr);
  assert.ok(run.result.stderr.includes(errorLine(message)), run.result.stderr);
  if (beforeBanner) assert.equal(run.result.stdout, "");
  assert.deepEqual(fs.readdirSync(run.project), []);
}

test("should refuse the bare --effort flag and write nothing", () => {
  assertRefused(install(["--engine", "claude-code", "--effort", "max"]), msg.effortFlagBare(LEVELS));
});

test("should refuse the bare --model flag and write nothing", () => {
  assertRefused(install(["--engine", "claude-code", "--model", "opus"]), msg.modelFlagBare());
});

test("should report the bare --model refusal before the bare --effort one", () => {
  assertRefused(install(["--engine", "claude-code", "--model", "opus", "--effort", "max"]), msg.modelFlagBare());
});

test("should refuse the bare --effort flag even when a per-intent effort flag is present", () => {
  assertRefused(
    install(["--engine", "claude-code", "--effort", "max", "--effort-review", "max"]),
    msg.effortFlagBare(LEVELS),
  );
});

for (const value of ["maxx", "MAX", ""]) {
  test(`should refuse the invalid effort level "${value}" and write nothing`, () => {
    assertRefused(
      install(["--engine", "claude-code", "--effort-review", value]),
      msg.effortFlagInvalid("review", value, LEVELS),
    );
  });
}

test("should refuse an effort-review flag left without a value as the last argument", () => {
  assertRefused(
    install(["--engine", "claude-code", "--effort-review"], { flagsLast: true }),
    msg.effortFlagInvalid("review", "", LEVELS),
  );
});

test("should refuse an invalid effort level with a skills dir and not create the skills dir", () => {
  const skillsDir = path.join(tempOutsideGit("skills"), "custom-skills");
  const run = install(["--skills-dir", skillsDir, "--effort-review", "maxx"]);
  assertRefused(run, msg.effortFlagInvalid("review", "maxx", LEVELS));
  assert.equal(fs.existsSync(skillsDir), false);
});

test("should refuse an effort flag when the only chosen engine takes no effort", () => {
  assertRefused(
    install(["--engine", "copilot", "--effort-review", "max"]),
    msg.effortFlagNoEffortEngine("review", "copilot"),
    { beforeBanner: false },
  );
});

test("should refuse an effort flag for the custom engine and not create the skills dir", () => {
  const skillsDir = path.join(tempOutsideGit("skills"), "custom-skills");
  const run = install(["--skills-dir", skillsDir, "--effort-review", "max"]);
  assertRefused(run, msg.effortFlagNoEffortEngine("review", "custom"), { beforeBanner: false });
  assert.equal(fs.existsSync(skillsDir), false);
});

test("should accept an effort flag when at least one chosen engine takes effort", () => {
  const { result } = install(["--engine", "claude-code,copilot", "--effort-review", "max"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("should write only the declared intents and render them in the agent files", () => {
  const { project, result } = install([
    "--engine", "claude-code",
    "--effort-review", "max",
    "--effort-execution", "inherit",
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(configOf(project).agents, {
    execution: { effort: "inherit" },
    review: { effort: "max" },
  });
  assert.match(agentFile(project, "mgr-review.md"), /^effort: max$/m);
  assert.doesNotMatch(agentFile(project, "mgr-task.md"), /^effort:/m);
  assert.match(agentFile(project, "mgr-draft.md"), /^effort: high$/m);
});

test("should keep the default efforts and record no effort when no effort flag is given", () => {
  const { project, result } = install(["--engine", "claude-code"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(agentFile(project, "mgr-draft.md"), /^effort: high$/m);
  assert.match(agentFile(project, "mgr-task.md"), /^effort: low$/m);
  assert.match(agentFile(project, "mgr-review.md"), /^effort: max$/m);
  const configPath = path.join(coreOf(project), "config.json");
  if (fs.existsSync(configPath)) {
    assert.ok(!fs.readFileSync(configPath, "utf8").includes("effort"));
  }
});

test("should write a flag-declared intent without any interactive answer", () => {
  const { project, result } = install(["--engine", "claude-code", "--effort-drafting", "xhigh"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(configOf(project).agents, { drafting: { effort: "xhigh" } });
});

test("should report the declared level as configured, inherit as no effort and the rest as default in agents json", () => {
  const { project, home, result } = install([
    "--engine", "claude-code",
    "--effort-review", "max",
    "--effort-execution", "inherit",
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const agents = runMgr(["agents", "--json"], { cwd: project, home });
  assert.equal(agents.status, 0, agents.stdout + agents.stderr);
  const { intents } = JSON.parse(agents.stdout);
  assert.equal(intents.review.engines["claude-code"].effortSource, "configured");
  assert.equal(intents.review.engines["claude-code"].effort, "max");
  assert.equal(intents.drafting.engines["claude-code"].effortSource, "default");
  assert.equal(intents.drafting.engines["claude-code"].effort, "high");
  assert.equal(intents.execution.engines["claude-code"].effort, null);
  assert.equal(intents.execution.engines["claude-code"].effortSource, null);
});
