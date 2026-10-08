// Oraculo da F1 (RN-19, specs/entrega-f1-runtime-no-projeto/03-spec.md secao 7). Prova que a instalacao
// entrega o que foi DECIDIDO. Regra inegociavel: este arquivo NAO importa nada de `src/` (nem catalog,
// nem RUNTIME_FILES, nem descritores). So executa `bin/mgr.js` como processo filho e le o disco; todo
// valor esperado e literal escrito a partir das decisoes (secoes 3 e 5, DT-7/D-9, DT-8/DT-9, DT-13,
// D-14 e os criterios CA-1, CA-5, CA-6, CA-7, CA-25, CA-26), nunca lido do codigo.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MGR_BIN = path.join(PACKAGE_ROOT, "bin", "mgr.js");
const ENGINES = [".claude", ".github"];
const RUNTIME_RELATIVE = ["skills", "_shared", "mgr", "bin", "mgr-runtime.js"];
const SKILLS = ["spec-create", "spec-execute", "code-analyzer", "spec-init", "configure-agents"];
const HOOK_MARKER = "mgr-session-hook";
const TIMEOUT_MS = 120000;

const baseEnv = (home) => ({ ...process.env, LC_ALL: "C", HOME: home });

const makeTemp = (label) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `mgr-oraculo-${label}-`)));

function run(command, args, { cwd, input = "", home }) {
  return spawnSync(command, args, {
    cwd,
    input,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    env: baseEnv(home),
  });
}

function installInto(project, home, packageRoot = PACKAGE_ROOT) {
  const result = run(
    process.execPath,
    [path.join(packageRoot, "bin", "mgr.js"), "install", "--engine", "both", "--scope", "project", "--all-skills", "-y", project],
    { cwd: project, home },
  );
  assert.equal(result.status, 0, `install failed: ${result.stderr}`);
}

function freshInstall(label) {
  const project = makeTemp(label);
  const home = makeTemp(`${label}-home`);
  const gitProbe = spawnSync("git", ["-C", project, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  assert.equal(gitProbe.error, undefined, "git must be runnable to prove the temp dir is outside a repository");
  assert.notEqual(gitProbe.status, 0, "the temp dir must not be inside a git work tree");
  installInto(project, home);
  return { project, home };
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

const collectStrings = (value) => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
};

const hookCommands = (settingsFile, event) =>
  collectStrings(readJson(settingsFile).hooks?.[event] ?? []).filter((text) => text.includes(HOOK_MARKER));

const HOOK_FILES = [
  {
    engine: "claude-code",
    file: [".claude", "settings.local.json"],
    sessionEvent: "SessionStart",
    compactEvent: "PreCompact",
  },
  {
    engine: "copilot",
    file: [".github", "copilot", "settings.local.json"],
    sessionEvent: "sessionStart",
    compactEvent: "preCompact",
  },
];

const quotedPath = (command) => {
  const match = command.match(/^node "([^"]+)"/);
  assert.ok(match, `command must start with node "<path>": ${command}`);
  return match[1];
};

const isInside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

test("should install the runtime, a module package.json and the new manifest model in both engines (CA-1)", () => {
  const { project } = freshInstall("ca1");
  const manifest = readJson(path.join(project, ".mgr-core", "manifest.json"));
  assert.equal(manifest.model, "self-contained-runtime");
  for (const engine of ENGINES) {
    const runtimeDir = path.join(project, engine, "skills", "_shared", "mgr");
    assert.ok(fs.existsSync(path.join(project, engine, ...RUNTIME_RELATIVE)), `${engine} runtime entry missing`);
    const generated = readJson(path.join(runtimeDir, "package.json"));
    assert.equal(generated.type, "module");
    assert.equal(generated.version, manifest.version);
  }
});

test("should write session and compaction hooks pointing inside the project for each engine (CA-5)", () => {
  const { project } = freshInstall("ca5");
  for (const { engine, file, sessionEvent, compactEvent } of HOOK_FILES) {
    const settingsFile = path.join(project, ...file);
    const [sessionCommand] = hookCommands(settingsFile, sessionEvent);
    const [compactCommand] = hookCommands(settingsFile, compactEvent);
    assert.ok(sessionCommand, `${engine}: no ${sessionEvent} entry owned by the MGR`);
    assert.ok(compactCommand, `${engine}: no ${compactEvent} entry owned by the MGR`);
    assert.ok(sessionCommand.includes(`detect --hook ${engine}`), sessionCommand);
    assert.ok(compactCommand.includes(`precompact --hook ${engine}`), compactCommand);
    for (const command of [sessionCommand, compactCommand]) {
      const target = quotedPath(command);
      assert.ok(isInside(project, target), `${target} must be inside ${project}`);
      assert.ok(fs.existsSync(target), `${target} must exist`);
    }
  }
});

test("should not write any absolute path outside the project into the hook files (CA-5)", () => {
  const { project } = freshInstall("ca5-paths");
  for (const { file } of HOOK_FILES) {
    const content = fs.readFileSync(path.join(project, ...file), "utf8");
    const absolutePaths = [...content.matchAll(/(?:^|[\s"'=])(\/[^\s"']+)/g)].map((match) => match[1]);
    assert.ok(absolutePaths.length > 0, "the hook file must carry the absolute runtime path");
    for (const absolute of absolutePaths) {
      assert.ok(absolute.startsWith(project), `${absolute} is outside ${project}`);
    }
  }
});

test("should run the recorded hooks after the package copy is deleted, from the root and from a subdirectory (CA-6)", () => {
  const copyRoot = makeTemp("ca6-package");
  for (const entry of ["package.json", "bin", "src", "skills", "shared", "agents"]) {
    fs.cpSync(path.join(PACKAGE_ROOT, entry), path.join(copyRoot, entry), { recursive: true });
  }
  fs.symlinkSync(path.join(PACKAGE_ROOT, "node_modules"), path.join(copyRoot, "node_modules"), "dir");
  const project = makeTemp("ca6");
  const home = makeTemp("ca6-home");
  installInto(project, home, copyRoot);
  fs.rmSync(copyRoot, { recursive: true, force: true });
  assert.equal(fs.existsSync(copyRoot), false, "the package copy must be gone before the hooks run");

  const nested = path.join(project, "packages", "a");
  fs.mkdirSync(nested, { recursive: true });
  const settingsFile = path.join(project, ".claude", "settings.local.json");
  const [sessionCommand] = hookCommands(settingsFile, "SessionStart");
  const [compactCommand] = hookCommands(settingsFile, "PreCompact");

  for (const cwd of [project, nested]) {
    const session = run("sh", ["-c", sessionCommand], { cwd, input: "", home });
    assert.equal(session.status, 0, `SessionStart from ${cwd}: ${session.stderr}`);
    assert.ok(session.stdout.trim().length > 0, `SessionStart from ${cwd} printed nothing`);
  }
  const compact = run("sh", ["-c", compactCommand], { cwd: project, input: "{}", home });
  assert.equal(compact.status, 0, `PreCompact: ${compact.stderr}`);
});

test("should leave no CLI-only wording and a resolved runtime path in the five installed skills (CA-7)", () => {
  const { project } = freshInstall("ca7");
  const forbidden = ["`mgr` CLI is NOT installed", "skills alone", "sdd-check.sh", ".mgr-core/shared", "{{MGR_RUNTIME}}"];
  const required = ["STOP — the MGR runtime is missing", "npx mgr-method@", "skills/_shared/mgr/bin/mgr-runtime.js"];
  for (const engine of ENGINES) {
    for (const skill of SKILLS) {
      const file = path.join(project, engine, "skills", skill, "SKILL.md");
      const content = fs.readFileSync(file, "utf8");
      for (const text of forbidden) {
        assert.equal(content.includes(text), false, `${engine}/${skill} still contains: ${text}`);
      }
      for (const text of required) {
        assert.ok(content.includes(text), `${engine}/${skill} is missing: ${text}`);
      }
    }
  }
});

test("should run the copilot runtime alone after the whole .claude folder is deleted (CA-25)", () => {
  const { project, home } = freshInstall("ca25");
  fs.rmSync(path.join(project, ".claude"), { recursive: true, force: true });
  const runtime = path.join(".github", ...RUNTIME_RELATIVE);

  const version = run(process.execPath, [runtime, "version"], { cwd: project, home });
  assert.equal(version.status, 0, version.stderr);
  const agents = run(process.execPath, [runtime, "agents", "--json"], { cwd: project, home });
  assert.equal(agents.status, 0, agents.stderr);
  const sddCheck = run(process.execPath, [runtime, "sdd-check"], { cwd: project, home });
  assert.equal(sddCheck.status, 1);
  assert.ok(sddCheck.stderr.includes("SDD"), sddCheck.stderr);
});

test("should remove the runtime of both engines and only the MGR hook entries on uninstall (CA-26)", () => {
  const { project, home } = freshInstall("ca26");
  const claudeSettings = path.join(project, ".claude", "settings.local.json");
  const settings = readJson(claudeSettings);
  settings.hooks.SessionStart.push({ hooks: [{ type: "command", command: "echo oraculo-alien-hook" }] });
  fs.writeFileSync(claudeSettings, JSON.stringify(settings, null, 2) + "\n", "utf8");

  const result = run(process.execPath, [MGR_BIN, "uninstall", "-y", project], { cwd: project, home });
  assert.equal(result.status, 0, result.stderr);

  for (const engine of ENGINES) {
    assert.equal(fs.existsSync(path.join(project, engine, "skills", "_shared", "mgr")), false, `${engine} runtime survived`);
  }
  const remaining = fs.readFileSync(claudeSettings, "utf8");
  assert.ok(remaining.includes("echo oraculo-alien-hook"), "the foreign hook entry was removed");
  assert.equal(remaining.includes(HOOK_MARKER), false, "an MGR hook entry survived in claude settings");
  const copilotSettings = path.join(project, ".github", "copilot", "settings.local.json");
  if (fs.existsSync(copilotSettings)) {
    assert.equal(fs.readFileSync(copilotSettings, "utf8").includes(HOOK_MARKER), false);
  }
});

test("should report no defect on a fresh install and a divergent-body when one runtime byte changes (D-14)", () => {
  const { project, home } = freshInstall("d14");
  const clean = run(process.execPath, [MGR_BIN, "doctor", project, "--json"], { cwd: project, home });
  const cleanFindings = JSON.parse(clean.stdout).findings;
  assert.deepEqual(cleanFindings.filter((finding) => finding.severity === "defect"), []);

  const runtimeFile = path.join(project, ".claude", ...RUNTIME_RELATIVE);
  fs.appendFileSync(runtimeFile, " ");
  const tampered = run(process.execPath, [MGR_BIN, "doctor", project, "--json"], { cwd: project, home });
  const divergent = JSON.parse(tampered.stdout).findings.filter(
    (finding) => finding.check === "divergent-body" && finding.file.includes(".claude") && finding.file.includes("mgr-runtime.js"),
  );
  assert.equal(divergent.length, 1, tampered.stdout);
  assert.equal(divergent[0].severity, "defect");
});

test("should leave no bare mgr command in the installed skills and spec-create templates (CA-7)", () => {
  const { project } = freshInstall("bare-mgr");
  const bareCommand = /(?<![-@\w/.])mgr (?:spec|agents|origin|update)\b/;
  for (const engine of ENGINES) {
    const files = [
      ...SKILLS.map((skill) => path.join(project, engine, "skills", skill, "SKILL.md")),
      path.join(project, engine, "skills", "spec-create", "templates", "03-spec.md"),
      path.join(project, engine, "skills", "spec-create", "templates", "04-plan.md"),
    ];
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(text, bareCommand, `${path.relative(project, file)} still calls a bare mgr command`);
    }
  }
});
