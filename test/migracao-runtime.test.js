import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { detectPrior, execute, needsRuntimeMigration, planInstall } from "../src/installer.js";
import { MODEL_RUNTIME, MODEL_LAYERED } from "../src/manifest.js";
import { rewriteOwnedHooks } from "../src/hooks.js";
import { spawnSync } from "node:child_process";

const RUNTIME_ENTRY = ["_shared", "mgr", "bin", "mgr-runtime.js"];
const SKILLS_DIR = ".claude/skills";

function withRepo(fn) {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mgr-migracao-"));
  try {
    fn(repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

function writeOldManifest(repo, model) {
  const core = path.join(repo, ".mgr-core");
  mkdirSync(core, { recursive: true });
  writeFileSync(
    path.join(core, "manifest.json"),
    JSON.stringify({ model, version: "0.0.1", scope: "project", engines: ["claude-code"], skillsDirs: [SKILLS_DIR], skills: [] }),
    "utf8",
  );
  return core;
}

const MGR_BIN = path.resolve(import.meta.dirname, "..", "bin", "mgr.js");

function runMgr(args) {
  return spawnSync(process.execPath, [MGR_BIN, ...args], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
}

function writeForeignOnlySettings(repo) {
  const file = path.join(repo, ".claude", "settings.local.json");
  const foreign = { matcher: "startup", hooks: [{ type: "command", command: "echo alheio", timeout: 3 }] };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ hooks: { SessionStart: [foreign] } }, null, 2) + "\n", "utf8");
  return file;
}

const readModel = (repo) => JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8")).model;

test("should write the layered-config model on a fresh install", () => {
  withRepo((repo) => {
    execute(planInstall(["claude-code"], "project", repo, { all: true }));
    assert.equal(readModel(repo), MODEL_LAYERED);
    assert.equal(MODEL_RUNTIME, "self-contained-runtime");
  });
});

test("should add the runtime and upgrade the model when installing over a self-contained manifest", () => {
  withRepo((repo) => {
    writeOldManifest(repo, "self-contained");
    assert.equal(existsSync(path.join(repo, SKILLS_DIR, ...RUNTIME_ENTRY)), false);
    execute(planInstall(["claude-code"], "project", repo, { all: true }));
    assert.ok(existsSync(path.join(repo, SKILLS_DIR, ...RUNTIME_ENTRY)));
    assert.equal(readModel(repo), MODEL_LAYERED);
  });
});

test("should report migration needed only for a prior that is not in the runtime layout", () => {
  assert.equal(needsRuntimeMigration(null), false);
  assert.equal(needsRuntimeMigration(undefined), false);
  assert.equal(needsRuntimeMigration({ model: "runtime-launcher" }), true);
  assert.equal(needsRuntimeMigration({ model: "self-contained" }), true);
  assert.equal(needsRuntimeMigration({}), true);
  assert.equal(needsRuntimeMigration({ model: "self-contained-runtime" }), false);
});

test("should flag a detected prior as needing migration and stop flagging after the install", () => {
  withRepo((repo) => {
    writeOldManifest(repo, "self-contained");
    assert.equal(needsRuntimeMigration(detectPrior("project", repo)), true);
    execute(planInstall(["claude-code"], "project", repo, { all: true }));
    assert.equal(needsRuntimeMigration(detectPrior("project", repo)), false);
  });
});

test("should still migrate a runtime-launcher install and finish with the runtime present", () => {
  withRepo((repo) => {
    const core = writeOldManifest(repo, "runtime-launcher");
    mkdirSync(path.join(core, "skills"), { recursive: true });
    mkdirSync(path.join(core, "shared"), { recursive: true });
    const result = execute(planInstall(["claude-code"], "project", repo, { all: true }));
    assert.notEqual(result.migrated, null);
    assert.equal(existsSync(path.join(core, "skills")), false);
    assert.equal(existsSync(path.join(core, "shared")), false);
    assert.ok(existsSync(path.join(repo, SKILLS_DIR, ...RUNTIME_ENTRY)));
    assert.equal(readModel(repo), MODEL_LAYERED);
  });
});

test("should return null and create nothing when rewriting hooks of a missing file", () => {
  withRepo((repo) => {
    assert.equal(rewriteOwnedHooks("claude-code", repo, { command: 'node "/x/mgr-runtime.js"' }), null);
    assert.equal(existsSync(path.join(repo, ".claude")), false);
  });
});

test("should rewrite the existing MGR hook on update, add the missing PreCompact event and keep foreign entries", () => {
  withRepo((repo) => {
    writeOldManifest(repo, "self-contained");
    const alheia = { matcher: "startup", hooks: [{ type: "command", command: "echo alheio", timeout: 3 }] };
    const nossa = { matcher: "startup", hooks: [{ type: "command", command: 'node "/nao/existe/mgr.js" detect --hook claude-code # mgr-session-hook', timeout: 5 }] };
    const file = path.join(repo, ".claude", "settings.local.json");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ hooks: { SessionStart: [alheia, nossa] } }, null, 2) + "\n", "utf8");

    const updateRun = runMgr(["update", repo]);
    assert.equal(updateRun.status, 0, updateRun.stderr);

    assert.ok(existsSync(path.join(repo, SKILLS_DIR, ...RUNTIME_ENTRY)));
    assert.equal(readModel(repo), MODEL_LAYERED);
    const settings = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(Object.keys(settings.hooks).sort(), ["PreCompact", "SessionStart"]);
    const precompact = settings.hooks.PreCompact[0].hooks[0];
    assert.ok(precompact.command.includes("mgr-session-hook"));
    assert.ok(precompact.command.includes(path.join(repo, SKILLS_DIR, ...RUNTIME_ENTRY)));
    assert.equal(JSON.stringify(settings.hooks.SessionStart[0]), JSON.stringify(alheia));
    const novo = settings.hooks.SessionStart[1].hooks[0];
    assert.ok(novo.command.includes(path.join(repo, SKILLS_DIR, ...RUNTIME_ENTRY)));
    assert.ok(!novo.command.includes("/nao/existe"));
    assert.ok(novo.command.includes("mgr-session-hook"));
    assert.equal(novo.timeout, 5);
    assert.match(updateRun.stdout, /previous layout/);
    assert.match(stripVTControlCharacters(updateRun.stdout), /hooks written to \.claude\/settings\.local\.json: SessionStart\n/);
    assert.match(stripVTControlCharacters(updateRun.stdout), /hook event added to \.claude\/settings\.local\.json: PreCompact\n/);
  });
});

test("should return the file and only the events whose MGR entries were rewritten", () => {
  withRepo((repo) => {
    const nossa = { matcher: "startup", hooks: [{ type: "command", command: 'node "/old/mgr.js" detect --hook claude-code # mgr-session-hook' }] };
    const file = path.join(repo, ".claude", "settings.local.json");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ hooks: { SessionStart: [nossa], PreCompact: [] } }, null, 2) + "\n", "utf8");
    assert.deepEqual(rewriteOwnedHooks("claude-code", repo, { command: 'node "/x/mgr-runtime.js"' }), { file, events: ["SessionStart"] });
  });
});

test("should return null and leave the hook file byte for byte equal when it holds only foreign entries", () => {
  withRepo((repo) => {
    const file = writeForeignOnlySettings(repo);
    const before = readFileSync(file);
    assert.equal(rewriteOwnedHooks("claude-code", repo, { command: 'node "/x/mgr-runtime.js"' }), null);
    assert.deepEqual(readFileSync(file), before);
  });
});

test("should migrate on update without reporting a hook write when the settings file holds no MGR entry", () => {
  withRepo((repo) => {
    writeOldManifest(repo, "self-contained");
    const file = writeForeignOnlySettings(repo);
    const before = readFileSync(file);

    const updateRun = runMgr(["update", repo]);

    assert.equal(updateRun.status, 0, updateRun.stderr);
    assert.ok(existsSync(path.join(repo, SKILLS_DIR, ...RUNTIME_ENTRY)));
    assert.equal(readModel(repo), MODEL_LAYERED);
    assert.doesNotMatch(updateRun.stdout, /hooks written to/);
    assert.deepEqual(readFileSync(file), before);
  });
});

test("should announce the migration before the runtime plan line and finish migrated when installing over a self-contained manifest", () => {
  withRepo((repo) => {
    writeOldManifest(repo, "self-contained");

    const installRun = runMgr(["install", "-y", "--engine", "claude-code", repo]);

    assert.equal(installRun.status, 0, installRun.stderr);
    const output = installRun.stdout + installRun.stderr;
    const announcement = output.indexOf("previous layout");
    const planLine = output.indexOf("MGR runtime →");
    assert.ok(announcement >= 0, output);
    assert.ok(planLine > announcement, output);
    const runtimeFile = path.join(repo, SKILLS_DIR, ...RUNTIME_ENTRY);
    assert.ok(existsSync(runtimeFile));
    assert.equal(readModel(repo), MODEL_LAYERED);
    const settings = JSON.parse(readFileSync(path.join(repo, ".claude", "settings.local.json"), "utf8"));
    const sessionStart = JSON.stringify(settings.hooks.SessionStart);
    assert.ok(sessionStart.includes(runtimeFile));
  });
});

test("should migrate the CA-16 starting point on install, announce before the plan and meet CA-1 and CA-5 (CA-17)", () => {
  withRepo((repo) => {
    writeOldManifest(repo, "self-contained");
    const alheia = { matcher: "startup", hooks: [{ type: "command", command: "echo alheio", timeout: 3 }] };
    const nossa = { matcher: "startup", hooks: [{ type: "command", command: 'node "/nao/existe/mgr.js" detect --hook claude-code # mgr-session-hook', timeout: 5 }] };
    const claudeFile = path.join(repo, ".claude", "settings.local.json");
    mkdirSync(path.dirname(claudeFile), { recursive: true });
    writeFileSync(claudeFile, JSON.stringify({ hooks: { SessionStart: [alheia, nossa] } }, null, 2) + "\n", "utf8");

    const installRun = runMgr(["install", "--engine", "both", "--scope", "project", "--all-skills", "-y", repo]);
    assert.equal(installRun.status, 0, installRun.stderr);

    const output = installRun.stdout + installRun.stderr;
    const announcement = output.indexOf("previous layout");
    assert.ok(announcement >= 0, output);
    assert.ok(output.indexOf("MGR runtime →") > announcement, output);

    const manifest = JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8"));
    assert.equal(manifest.model, MODEL_LAYERED);
    for (const engineDir of [".claude", ".github"]) {
      const runtimeDir = path.join(repo, engineDir, "skills", "_shared", "mgr");
      assert.ok(existsSync(path.join(runtimeDir, "bin", "mgr-runtime.js")), engineDir);
      const pkg = JSON.parse(readFileSync(path.join(runtimeDir, "package.json"), "utf8"));
      assert.equal(pkg.type, "module", engineDir);
      assert.equal(pkg.version, manifest.version, engineDir);
    }

    const hookFiles = [
      [claudeFile, "SessionStart", "PreCompact", "claude-code"],
      [path.join(repo, ".github", "copilot", "settings.local.json"), "sessionStart", "preCompact", "copilot"],
    ];
    for (const [file, startEvent, compactEvent, engine] of hookFiles) {
      const text = readFileSync(file, "utf8");
      const { hooks } = JSON.parse(text);
      const start = JSON.stringify(hooks[startEvent]);
      const compact = JSON.stringify(hooks[compactEvent]);
      assert.ok(start.includes("mgr-session-hook") && start.includes(`detect --hook ${engine}`), `${file}: ${start}`);
      assert.ok(compact.includes("mgr-session-hook") && compact.includes(`precompact --hook ${engine}`), `${file}: ${compact}`);
      const quoted = [...text.matchAll(/\\"(\/[^"\\]+)\\"/g)].map((match) => match[1]);
      assert.ok(quoted.length > 0, file);
      for (const quotedPath of quoted) {
        assert.ok(quotedPath.startsWith(repo + path.sep), `${file}: ${quotedPath} is outside the project`);
        assert.ok(existsSync(quotedPath), `${file}: ${quotedPath} does not exist`);
      }
      assert.equal(text.includes("/nao/existe"), false, file);
    }
    const claudeHooks = JSON.parse(readFileSync(claudeFile, "utf8")).hooks;
    assert.equal(JSON.stringify(claudeHooks.SessionStart[0]), JSON.stringify(alheia));
  });
});
