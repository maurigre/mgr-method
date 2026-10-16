import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { detectPrior, execute, legacyRuntimeDirs, planInstall, runtimeMigration } from "../src/installer.js";
import { MODEL_CORE_RUNTIME, MODEL_LAYERED, MODEL_RUNTIME, manifestPath } from "../src/manifest.js";
import { rewriteOwnedHooks, runtimeCommand, writeHook } from "../src/hooks.js";
import { getMessages } from "../src/messages.js";
import { layoutPorMotor } from "./fixtures/layout-por-motor.js";
import { spawnSync } from "node:child_process";

const RUNTIME_ENTRY = [".mgr-core", "runtime", "bin", "mgr-runtime.js"];
const SKILLS_DIR = ".claude/skills";
const FOREIGN = { matcher: "startup", hooks: [{ type: "command", command: "echo alheio", timeout: 3 }] };
const STALE_MGR = { matcher: "startup", hooks: [{ type: "command", command: 'node "/nao/existe/mgr.js" detect --hook claude-code # mgr-session-hook', timeout: 5 }] };

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
  return spawnSync(process.execPath, [MGR_BIN, ...args], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, LC_ALL: "C" },
  });
}

function writeSettings(file, hooks) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ hooks }, null, 2) + "\n", "utf8");
  return file;
}

function writeForeignOnlySettings(repo) {
  return writeSettings(path.join(repo, ".claude", "settings.local.json"), { SessionStart: [FOREIGN] });
}

const readModel = (repo) => JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8")).model;

const snapshotDir = (dir) => Object.fromEntries(
  readdirSync(dir, { recursive: true })
    .filter((rel) => statSync(path.join(dir, rel)).isFile())
    .map((rel) => [rel, readFileSync(path.join(dir, rel)).toString("base64")]),
);

const brokenHooks = (repo) => JSON.parse(runMgr(["doctor", "--json", repo]).stdout).findings.filter((finding) => finding.check === "broken-hook");

function geracaoPorMotor(repo, { engines, model }) {
  writeSettings(path.join(repo, ".claude", "settings.local.json"), { SessionStart: [FOREIGN] });
  execute(planInstall(engines, "project", repo, { all: true }));
  for (const engine of engines) writeHook(engine, repo, { command: runtimeCommand("project", repo) });
  layoutPorMotor(repo, { model });
}

function geracaoSemRuntime(repo, model) {
  writeSettings(path.join(repo, ".claude", "settings.local.json"), { SessionStart: [FOREIGN, STALE_MGR] });
  execute(planInstall(["claude-code"], "project", repo, { all: true }));
  rmSync(path.join(repo, ".mgr-core", "runtime"), { recursive: true, force: true });
  const manifesto = manifestPath(path.join(repo, ".mgr-core"));
  writeFileSync(manifesto, JSON.stringify({ ...JSON.parse(readFileSync(manifesto, "utf8")), model }, null, 2) + "\n", "utf8");
}

const GERACOES = [
  [MODEL_RUNTIME, (repo) => geracaoPorMotor(repo, { engines: ["claude-code"], model: MODEL_RUNTIME })],
  [MODEL_LAYERED, (repo) => geracaoPorMotor(repo, { engines: ["claude-code"], model: MODEL_LAYERED })],
  ["runtime-launcher", (repo) => geracaoSemRuntime(repo, "runtime-launcher")],
  ["self-contained", (repo) => geracaoSemRuntime(repo, "self-contained")],
];

const COMANDOS = {
  update: (repo) => runMgr(["update", repo]),
  "install -y": (repo) => runMgr(["install", "-y", "--engine", "claude-code", "--scope", "project", "--all-skills", "--user-language", "en", repo]),
};

const REPO_LEGADO = path.join(os.tmpdir(), "mgr-legado-repo");
const CAND_CLAUDE = path.join(REPO_LEGADO, ".claude", "skills", "_shared", "mgr");
const CAND_COPILOT = path.join(REPO_LEGADO, ".github", "skills", "_shared", "mgr");
const PRIOR_CLAUDE = { skillsDirs: [".claude/skills"] };
const PRIOR_COPILOT = { skillsDirs: [".github/skills"] };
const PLANO_CLAUDE = [{ dir: path.join(REPO_LEGADO, ".claude", "skills") }];
const PLANO_COPILOT = [{ dir: path.join(REPO_LEGADO, ".github", "skills") }];
const VAZIO = { remove: [], keep: [] };

const CASOS_MC_DC = [
  ["should remove the old runtime when it is declared, in the plan and present", { prior: PRIOR_CLAUDE, targets: PLANO_CLAUDE, existentes: [CAND_CLAUDE] }, { remove: [CAND_CLAUDE], keep: [] }],
  ["should keep the old runtime when it is declared, present and out of the plan", { prior: PRIOR_CLAUDE, targets: PLANO_COPILOT, existentes: [CAND_CLAUDE] }, { remove: [], keep: [CAND_CLAUDE] }],
  ["should leave nothing when the old runtime is declared and in the plan but absent", { prior: PRIOR_CLAUDE, targets: PLANO_CLAUDE, existentes: [] }, VAZIO],
  ["should leave nothing when the old runtime is declared, out of the plan and absent", { prior: PRIOR_CLAUDE, targets: PLANO_COPILOT, existentes: [] }, VAZIO],
  ["should remove the old runtime of a folder the plan reinstalls even when the prior manifest did not declare it", { prior: PRIOR_COPILOT, targets: PLANO_CLAUDE, existentes: [CAND_CLAUDE] }, { remove: [CAND_CLAUDE], keep: [] }],
  ["should keep the copilot runtime when it is declared, present and out of the plan", { prior: PRIOR_COPILOT, targets: PLANO_CLAUDE, existentes: [CAND_COPILOT] }, { remove: [], keep: [CAND_COPILOT] }],
  ["should leave nothing when the old runtime is present and out of the plan but not declared", { prior: PRIOR_COPILOT, targets: PLANO_COPILOT, existentes: [CAND_CLAUDE] }, VAZIO],
  ["should return two empty lists when there is no prior installation", { prior: null, targets: PLANO_CLAUDE, existentes: [CAND_CLAUDE] }, VAZIO],
  ["should take the singular skillsDir of an older manifest as declared", { prior: { skillsDir: ".claude/skills" }, targets: PLANO_CLAUDE, existentes: [CAND_CLAUDE] }, { remove: [CAND_CLAUDE], keep: [] }],
  ["should still remove the old runtime of a planned folder when the prior manifest declares no skills folder", { prior: {}, targets: PLANO_CLAUDE, existentes: [CAND_CLAUDE] }, { remove: [CAND_CLAUDE], keep: [] }],
  ["should not keep a declared folder out of the plan whose old runtime is absent while removing the planned one", { prior: { skillsDirs: [".claude/skills", ".github/skills"] }, targets: PLANO_CLAUDE, existentes: [CAND_CLAUDE] }, { remove: [CAND_CLAUDE], keep: [] }],
];

test("should write the core-runtime model on a fresh install", () => {
  withRepo((repo) => {
    execute(planInstall(["claude-code"], "project", repo, { all: true }));
    assert.equal(readModel(repo), MODEL_CORE_RUNTIME);
    assert.equal(MODEL_RUNTIME, "self-contained-runtime");
  });
});

test("should add the core runtime and upgrade the model when installing over a self-contained manifest", () => {
  withRepo((repo) => {
    writeOldManifest(repo, "self-contained");
    assert.equal(existsSync(path.join(repo, ...RUNTIME_ENTRY)), false);
    execute(planInstall(["claude-code"], "project", repo, { all: true }));
    assert.ok(existsSync(path.join(repo, ...RUNTIME_ENTRY)));
    assert.equal(existsSync(path.join(repo, SKILLS_DIR, "_shared", "mgr")), false);
    assert.equal(readModel(repo), MODEL_CORE_RUNTIME);
  });
});

test("should map each prior model to none, relocate or copy in the runtime migration", () => {
  assert.equal(runtimeMigration(null), "none");
  assert.equal(runtimeMigration(undefined), "none");
  assert.equal(runtimeMigration({ model: MODEL_CORE_RUNTIME }), "none");
  assert.equal(runtimeMigration({ model: MODEL_RUNTIME }), "relocate");
  assert.equal(runtimeMigration({ model: MODEL_LAYERED }), "relocate");
  assert.equal(runtimeMigration({ model: "runtime-launcher" }), "copy");
  assert.equal(runtimeMigration({ model: "self-contained" }), "copy");
  assert.equal(runtimeMigration({}), "copy");
});

test("should flag a detected prior as needing a copy and stop flagging after the install", () => {
  withRepo((repo) => {
    writeOldManifest(repo, "self-contained");
    assert.equal(runtimeMigration(detectPrior("project", repo)), "copy");
    execute(planInstall(["claude-code"], "project", repo, { all: true }));
    assert.equal(runtimeMigration(detectPrior("project", repo)), "none");
  });
});

test("should still migrate a runtime-launcher install and finish with the core runtime present", () => {
  withRepo((repo) => {
    const core = writeOldManifest(repo, "runtime-launcher");
    mkdirSync(path.join(core, "skills"), { recursive: true });
    mkdirSync(path.join(core, "shared"), { recursive: true });
    const result = execute(planInstall(["claude-code"], "project", repo, { all: true }));
    assert.notEqual(result.migrated, null);
    assert.equal(existsSync(path.join(core, "skills")), false);
    assert.equal(existsSync(path.join(core, "shared")), false);
    assert.ok(existsSync(path.join(repo, ...RUNTIME_ENTRY)));
    assert.equal(readModel(repo), MODEL_CORE_RUNTIME);
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

    assert.ok(existsSync(path.join(repo, ...RUNTIME_ENTRY)));
    assert.equal(readModel(repo), MODEL_CORE_RUNTIME);
    const settings = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(Object.keys(settings.hooks).sort(), ["PreCompact", "SessionStart"]);
    const precompact = settings.hooks.PreCompact[0].hooks[0];
    assert.ok(precompact.command.includes("mgr-session-hook"));
    assert.ok(precompact.command.includes(path.join(repo, ...RUNTIME_ENTRY)));
    assert.equal(JSON.stringify(settings.hooks.SessionStart[0]), JSON.stringify(alheia));
    const novo = settings.hooks.SessionStart[1].hooks[0];
    assert.ok(novo.command.includes(path.join(repo, ...RUNTIME_ENTRY)));
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
    assert.ok(existsSync(path.join(repo, ...RUNTIME_ENTRY)));
    assert.equal(readModel(repo), MODEL_CORE_RUNTIME);
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
    const runtimeFile = path.join(repo, ...RUNTIME_ENTRY);
    assert.ok(existsSync(runtimeFile));
    assert.equal(readModel(repo), MODEL_CORE_RUNTIME);
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
    assert.equal(manifest.model, MODEL_CORE_RUNTIME);
    const runtimeDir = path.join(repo, ".mgr-core", "runtime");
    assert.ok(existsSync(path.join(runtimeDir, "bin", "mgr-runtime.js")));
    const pkg = JSON.parse(readFileSync(path.join(runtimeDir, "package.json"), "utf8"));
    assert.equal(pkg.type, "module");
    assert.equal(pkg.version, manifest.version);
    for (const engineDir of [".claude", ".github"]) {
      assert.equal(existsSync(path.join(repo, engineDir, "skills", "_shared", "mgr")), false, engineDir);
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

for (const [model, monta] of GERACOES) {
  for (const [nome, rodar] of Object.entries(COMANDOS)) {
    test(`should move the runtime to .mgr-core and keep foreign files on ${nome} from ${model}`, () => {
      withRepo((repo) => {
        monta(repo);
        const keep = path.join(repo, SKILLS_DIR, "_shared", "foreign", "keep.txt");
        mkdirSync(path.dirname(keep), { recursive: true });
        writeFileSync(keep, "conteudo alheio\n", "utf8");
        const keepBefore = readFileSync(keep);

        const run = rodar(repo);

        assert.equal(run.status, 0, run.stderr);
        assert.ok(existsSync(path.join(repo, ...RUNTIME_ENTRY)));
        assert.equal(existsSync(path.join(repo, SKILLS_DIR, "_shared", "mgr")), false);
        assert.deepEqual(readFileSync(keep), keepBefore);
        assert.ok(existsSync(path.join(repo, SKILLS_DIR, "_shared", "laws", "execution-laws.md")));
        assert.equal(readModel(repo), MODEL_CORE_RUNTIME);
        const settings = JSON.parse(readFileSync(path.join(repo, ".claude", "settings.local.json"), "utf8"));
        const mgrEntry = settings.hooks.SessionStart.find((entry) => JSON.stringify(entry).includes("mgr-session-hook"));
        assert.ok(JSON.stringify(mgrEntry).includes(path.join(repo, ...RUNTIME_ENTRY)));
        assert.equal(JSON.stringify(mgrEntry).includes("_shared/mgr"), false);
        assert.deepEqual(settings.hooks.SessionStart.find((entry) => !JSON.stringify(entry).includes("mgr-session-hook")), FOREIGN);
      });
    });
  }
}

test("should announce the relocation and the old runtime in the plan before the first write on install", () => {
  withRepo((repo) => {
    geracaoPorMotor(repo, { engines: ["claude-code", "copilot"], model: MODEL_RUNTIME });

    const run = runMgr(["install", "-y", "--engine", "both", "--scope", "project", "--all-skills", "--user-language", "en", repo]);

    assert.equal(run.status, 0, run.stderr);
    const out = stripVTControlCharacters(run.stdout + run.stderr);
    const reloc = out.indexOf("one MGR runtime per engine");
    const remover = out.indexOf("old MGR runtime to remove:");
    const plano = out.indexOf("MGR runtime →");
    const gravado = out.indexOf("MGR runtime written to");
    const removido = out.indexOf("old MGR runtime removed:");
    assert.ok(reloc >= 0, out);
    assert.ok(remover >= 0, out);
    assert.ok(reloc < plano, out);
    assert.ok(plano < remover, out);
    assert.ok(remover < gravado, out);
    assert.ok(removido > gravado, out);
    assert.equal(existsSync(path.join(repo, ".claude", "skills", "_shared", "mgr")), false);
  });
});

test("should print the relocation and the old runtime on a dry run and change neither the copies nor the manifest", () => {
  withRepo((repo) => {
    geracaoPorMotor(repo, { engines: ["claude-code", "copilot"], model: MODEL_RUNTIME });
    const manifesto = path.join(repo, ".mgr-core", "manifest.json");
    const copia = path.join(repo, ".claude", "skills", "_shared", "mgr", "bin", "mgr-runtime.js");
    const manifestoAntes = readFileSync(manifesto);
    const copiaAntes = readFileSync(copia);

    const run = runMgr(["install", "-y", "--dry-run", "--engine", "both", "--scope", "project", "--all-skills", "--user-language", "en", repo]);

    assert.equal(run.status, 0, run.stderr);
    const out = stripVTControlCharacters(run.stdout + run.stderr);
    assert.ok(out.includes("one MGR runtime per engine"), out);
    assert.ok(out.includes("old MGR runtime to remove:"), out);
    assert.deepEqual(readFileSync(copia), copiaAntes);
    assert.deepEqual(readFileSync(manifesto), manifestoAntes);
    assert.equal(existsSync(path.join(repo, ...RUNTIME_ENTRY)), false);
  });
});

test("should announce the relocation and the old runtime before the first write and remove the old runtime after on update", () => {
  withRepo((repo) => {
    geracaoPorMotor(repo, { engines: ["claude-code", "copilot"], model: MODEL_RUNTIME });

    const run = runMgr(["update", repo]);

    assert.equal(run.status, 0, run.stderr);
    const out = stripVTControlCharacters(run.stdout + run.stderr);
    const reloc = out.indexOf("one MGR runtime per engine");
    const remover = out.indexOf("old MGR runtime to remove:");
    const escrito = out.indexOf("MGR runtime written to");
    const removido = out.indexOf("old MGR runtime removed:");
    assert.ok(reloc >= 0 && remover > reloc, out);
    assert.ok(escrito > remover, out);
    assert.ok(removido > escrito, out);
    assert.equal(existsSync(path.join(repo, ".claude", "skills", "_shared", "mgr")), false);
    assert.equal(existsSync(path.join(repo, ".github", "skills", "_shared", "mgr")), false);
  });
});

for (const [nome, { prior, targets, existentes }, esperado] of CASOS_MC_DC) {
  test(nome, () => {
    const resultado = legacyRuntimeDirs({
      prior, targets, scope: "project", repo: REPO_LEGADO, exists: (caminho) => existentes.includes(caminho),
    });
    assert.deepEqual(resultado, esperado);
  });
}

test("should keep the copilot runtime copy and its hook byte for byte when reinstalling only claude-code", () => {
  withRepo((repo) => {
    geracaoPorMotor(repo, { engines: ["claude-code", "copilot"], model: MODEL_RUNTIME });
    const copilotHook = path.join(repo, ".github", "copilot", "settings.local.json");
    const copilotHookBefore = readFileSync(copilotHook);
    const copiaCopilotBefore = snapshotDir(path.join(repo, ".github", "skills", "_shared", "mgr"));

    const run = runMgr(["install", "-y", "--engine", "claude-code", "--scope", "project", "--all-skills", "--user-language", "en", repo]);

    assert.equal(run.status, 0, run.stderr);
    const out = stripVTControlCharacters(run.stdout + run.stderr);
    assert.equal(existsSync(path.join(repo, ".claude", "skills", "_shared", "mgr")), false);
    assert.deepEqual(snapshotDir(path.join(repo, ".github", "skills", "_shared", "mgr")), copiaCopilotBefore);
    assert.ok(out.includes("old MGR runtime kept:"), out);
    assert.ok(out.includes(".github/skills/_shared/mgr"), out);
    assert.deepEqual(readFileSync(copilotHook), copilotHookBefore);
    const { hooks } = JSON.parse(readFileSync(copilotHook, "utf8"));
    const comando = hooks.sessionStart.find((entry) => JSON.stringify(entry).includes("mgr-session-hook")).bash;
    const hook = spawnSync(comando, { shell: true, cwd: repo, encoding: "utf8", input: "", env: { ...process.env, LC_ALL: "C" } });
    assert.equal(hook.status, 0, hook.stderr);
  });
});

test("should remove and announce the old copilot runtime when reinstalling both engines after a claude-only reinstall", () => {
  withRepo((repo) => {
    geracaoPorMotor(repo, { engines: ["claude-code", "copilot"], model: MODEL_RUNTIME });
    const base = ["install", "-y", "--scope", "project", "--all-skills", "--user-language", "en"];
    assert.equal(runMgr([...base, "--engine", "claude-code", repo]).status, 0);
    assert.ok(existsSync(path.join(repo, ".github", "skills", "_shared", "mgr")));

    const run = runMgr([...base, "--engine", "both", repo]);

    assert.equal(run.status, 0, run.stderr);
    const out = stripVTControlCharacters(run.stdout + run.stderr).replace(/[│\s]+/g, " ");
    assert.ok(out.includes("old MGR runtime to remove: .github/skills/_shared/mgr"), out);
    assert.ok(out.includes("old MGR runtime removed: .github/skills/_shared/mgr"), out);
    assert.equal(existsSync(path.join(repo, ".github", "skills", "_shared", "mgr")), false);
    assert.ok(existsSync(path.join(repo, ".github", "skills", "_shared", "laws", "execution-laws.md")));
    assert.ok(existsSync(path.join(repo, ".mgr-core", "runtime", "bin", "mgr-runtime.js")));
  });
});

test("should rewrite a MGR hook entry that points to a removed per-engine copy on update and clear the broken-hook finding", () => {
  withRepo((repo) => {
    const install = runMgr(["install", "-y", "--engine", "claude-code", "--scope", "project", "--all-skills", "--user-language", "en", repo]);
    assert.equal(install.status, 0, install.stderr);
    const stale = path.join(repo, ".claude", "skills", "_shared", "mgr", "bin", "mgr-runtime.js");
    const file = writeSettings(path.join(repo, ".claude", "settings.local.json"), {
      SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: `node "${stale}" detect --hook claude-code # mgr-session-hook`, timeout: 5 }] }],
    });
    assert.ok(brokenHooks(repo).length > 0, "o hook apontando para o caminho removido deveria ser broken-hook");

    const update = runMgr(["update", repo]);

    assert.equal(update.status, 0, update.stderr);
    const out = stripVTControlCharacters(update.stdout + update.stderr);
    assert.ok(out.includes("hooks written to .claude/settings.local.json: SessionStart"), out);
    const command = JSON.parse(readFileSync(file, "utf8")).hooks.SessionStart[0].hooks[0].command;
    assert.ok(command.includes(path.join(repo, ...RUNTIME_ENTRY)));
    assert.equal(command.includes(stale), false);
    assert.deepEqual(brokenHooks(repo), []);
  });
});

test("should keep the core runtime reachable from the copilot skills after reinstalling only claude-code", () => {
  withRepo((repo) => {
    const both = runMgr(["install", "-y", "--engine", "both", "--scope", "project", "--all-skills", "--user-language", "en", repo]);
    assert.equal(both.status, 0, both.stderr);
    const claudeOnly = runMgr(["install", "-y", "--engine", "claude-code", "--scope", "project", "--all-skills", "--user-language", "en", repo]);
    assert.equal(claudeOnly.status, 0, claudeOnly.stderr);

    assert.ok(existsSync(path.join(repo, ...RUNTIME_ENTRY)));
    const spec = readFileSync(path.join(repo, ".github", "skills", "spec-init", "SKILL.md"), "utf8");
    const citado = spec.match(/\.mgr-core\/runtime\/bin\/mgr-runtime\.js/);
    assert.ok(citado, "caminho do runtime ausente no SKILL.md do copilot");
    assert.ok(existsSync(path.join(repo, citado[0])));
  });
});

test("should list the team-ignored line of .gitignore and add no other .gitignore message on a dry run", () => {
  withRepo((repo) => {
    writeFileSync(path.join(repo, ".gitignore"), ".mgr-core/\n", "utf8");

    const run = runMgr(["install", "-y", "--dry-run", "--engine", "claude-code", "--scope", "project", "--all-skills", "--user-language", "en", repo]);

    assert.equal(run.status, 0, run.stderr);
    const out = stripVTControlCharacters(run.stdout + run.stderr);
    const corrido = (texto) => texto.replace(/[│┌└┐┘─╮╯╭╰◇◆]/g, " ").replace(/\s+/g, " ");
    assert.ok(corrido(out).includes(corrido(getMessages("en").gitignoreTeamIgnored(".mgr-core/"))), out);
    assert.equal(out.split("\n").some((linha) => linha.includes(".gitignore") && /runtime/i.test(linha)), false, out);
    for (const lang of ["en", "pt-BR"]) {
      const m = getMessages(lang);
      const textos = [m.runtimeRelocated("v", "d"), m.legacyRuntimeToRemove("d"), m.legacyRuntimeRemoved("d"), m.legacyRuntimeKept("d")];
      assert.equal(textos.some((texto) => texto.includes(".gitignore")), false, lang);
    }
  });
});

test("should rewrite only the command of the MGR hook entry on install with --no-hooks and add no event", () => {
  withRepo((repo) => {
    execute(planInstall(["claude-code", "copilot"], "project", repo, { all: true }));
    layoutPorMotor(repo, { model: MODEL_RUNTIME });
    const antigo = path.join(repo, ".claude", "skills", "_shared", "mgr", "bin", "mgr-runtime.js");
    const file = writeSettings(path.join(repo, ".claude", "settings.local.json"), {
      SessionStart: [FOREIGN, { matcher: "startup", hooks: [{ type: "command", command: `node "${antigo}" detect --hook claude-code # mgr-session-hook`, timeout: 5 }] }],
    });
    const eventosAntes = Object.keys(JSON.parse(readFileSync(file, "utf8")).hooks);

    const run = runMgr(["install", "-y", "--no-hooks", "--engine", "claude-code", "--scope", "project", "--all-skills", "--user-language", "en", repo]);

    assert.equal(run.status, 0, run.stderr);
    const settings = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(Object.keys(settings.hooks), eventosAntes);
    assert.deepEqual(settings.hooks.SessionStart[0], FOREIGN);
    const entry = settings.hooks.SessionStart[1];
    assert.equal(entry.hooks[0].command, `node "${path.join(repo, ...RUNTIME_ENTRY)}" detect --hook claude-code # mgr-session-hook`);
    assert.equal(entry.hooks[0].timeout, 5);
    assert.equal(entry.matcher, "startup");
  });
});

function projetoComHookAntigo(repo) {
  execute(planInstall(["claude-code", "copilot"], "project", repo, { all: true }));
  layoutPorMotor(repo, { model: MODEL_RUNTIME });
  const antigo = path.join(repo, ".claude", "skills", "_shared", "mgr", "bin", "mgr-runtime.js");
  return writeSettings(path.join(repo, ".claude", "settings.local.json"), {
    SessionStart: [FOREIGN, { matcher: "startup", hooks: [{ type: "command", command: `node "${antigo}" detect --hook claude-code # mgr-session-hook`, timeout: 5 }] }],
  });
}

test("should announce the hook command to rewrite on a dry run with --no-hooks and write nothing", () => {
  withRepo((repo) => {
    const file = projetoComHookAntigo(repo);
    const antes = readFileSync(file);

    const run = runMgr(["install", "-y", "--dry-run", "--no-hooks", "--engine", "claude-code", "--scope", "project", "--all-skills", "--user-language", "en", repo]);

    assert.equal(run.status, 0, run.stderr);
    const out = stripVTControlCharacters(run.stdout + run.stderr).replace(/[│\s]+/g, " ");
    assert.ok(out.includes(getMessages("en").hookCommandToRewrite(path.join(".claude", "settings.local.json"), "SessionStart")), out);
    assert.deepEqual(readFileSync(file), antes);
  });
});

test("should not rewrite nor announce a hook file whose MGR command is already current with --no-hooks", () => {
  withRepo((repo) => {
    const file = projetoComHookAntigo(repo);
    const args = ["install", "-y", "--no-hooks", "--engine", "claude-code", "--scope", "project", "--all-skills", "--user-language", "en", repo];
    assert.equal(runMgr(args).status, 0);
    const convergido = readFileSync(file);

    const run = runMgr(args);

    assert.equal(run.status, 0, run.stderr);
    const out = stripVTControlCharacters(run.stdout + run.stderr);
    assert.equal(out.includes("hook command to rewrite"), false, out);
    assert.equal(out.includes("hooks written to"), false, out);
    assert.deepEqual(readFileSync(file), convergido);
  });
});

test("should leave the project hook file untouched on a global install with --no-hooks", () => {
  withRepo((repo) => {
    const file = projetoComHookAntigo(repo);
    const antes = readFileSync(file);
    const home = mkdtempSync(path.join(os.tmpdir(), "mgr-global-nohooks-"));
    try {
      const run = spawnSync(process.execPath, [MGR_BIN, "install", "-y", "--no-hooks", "--engine", "claude-code", "--scope", "global", "--all-skills", "--user-language", "en", repo], {
        encoding: "utf8", input: "", cwd: repo, env: { ...process.env, LC_ALL: "C", HOME: home },
      });

      assert.equal(run.status, 0, run.stderr);
      assert.deepEqual(readFileSync(file), antes);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

test("should not create a hook file where none existed when installing with --no-hooks", () => {
  withRepo((repo) => {
    execute(planInstall(["claude-code", "copilot"], "project", repo, { all: true }));
    layoutPorMotor(repo, { model: MODEL_RUNTIME });

    const run = runMgr(["install", "-y", "--no-hooks", "--engine", "claude-code", "--scope", "project", "--all-skills", "--user-language", "en", repo]);

    assert.equal(run.status, 0, run.stderr);
    assert.equal(existsSync(path.join(repo, ".claude", "settings.local.json")), false);
    assert.equal(existsSync(path.join(repo, ".github", "copilot", "settings.local.json")), false);
  });
});
