// Oraculo da F2 (specs/entrega-f2-config-e-ciclo-de-vida/03-spec.md secao 7, "Regra do oraculo"). Prova que a
// instalacao entrega o que foi DECIDIDO. Regra inegociavel: este arquivo importa SO `node:*`. Nada de
// `src/`, nem catalogo, nem descritores. Executa `bin/mgr.js` e o runtime copiado como processo filho e le
// o disco; todo valor esperado e literal escrito a partir da spec (CA-1, CA-3, CA-5, CA-15 da secao 9).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MGR_BIN = path.join(PACKAGE_ROOT, "bin", "mgr.js");
const TIMEOUT_MS = 120000;
const PERSONAL_ID = "dev-a-7f3";

const baseEnv = (home) => ({ ...process.env, LC_ALL: "C", HOME: home });

const makeTemp = (label) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `mgr-oraculo-f2-${label}-`)));

function run(command, args, { cwd, input = "", home }) {
  return spawnSync(command, args, { cwd, input, encoding: "utf8", timeout: TIMEOUT_MS, env: baseEnv(home) });
}

// Temporario fora de git: a conferencia e que `git rev-parse --is-inside-work-tree` sai diferente de 0.
function makeOutsideGit(label) {
  const dir = makeTemp(label);
  const probe = spawnSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  assert.equal(probe.error, undefined, "git must be runnable to prove the temp dir is outside a repository");
  assert.notEqual(probe.status, 0, "the temp dir must not be inside a git work tree");
  return dir;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

// CA-1: o comando literal da spec.
function installCa1(project, home) {
  const result = run(
    process.execPath,
    [
      MGR_BIN, "install", "--engine", "claude-code", "--arch", "layered",
      "--model-drafting", "opus", "--model-execution", "haiku", "--model-review", "sonnet",
      "--origin", "brownfield", "--project-id", PERSONAL_ID, "-y", project,
    ],
    { cwd: project, home },
  );
  assert.equal(result.status, 0, `install failed: ${result.stderr}`);
  return result;
}

const allFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? allFiles(full) : [full];
  });

test("should record the answered team policy, origin and personal id", () => {
  const project = makeOutsideGit("ca1");
  const home = makeTemp("ca1-home");
  installCa1(project, home);

  const config = readJson(path.join(project, ".mgr-core", "config.json"));
  assert.equal(config.agents.drafting.model["claude-code"], "opus");
  assert.equal(config.agents.execution.model["claude-code"], "haiku");
  assert.equal(config.agents.review.model["claude-code"], "sonnet");
  assert.equal(config.origin, "brownfield");

  const agentLines = {
    "mgr-draft.md": "model: opus",
    "mgr-task.md": "model: haiku",
    "mgr-review.md": "model: sonnet",
  };
  for (const [file, line] of Object.entries(agentLines)) {
    const lines = fs.readFileSync(path.join(project, ".claude", "agents", file), "utf8").split("\n");
    assert.ok(lines.includes(line), `${file} must contain the line "${line}"`);
  }

  assert.deepEqual(readJson(path.join(project, ".mgr-core", "config.local.json")), { projectId: PERSONAL_ID });
  assert.ok(
    fs.readFileSync(path.join(project, ".mgr-core", ".env"), "utf8").includes(`MGR_PROJECT_ID=${PERSONAL_ID}`),
    ".mgr-core/.env must carry MGR_PROJECT_ID",
  );

  const manifest = readJson(path.join(project, ".mgr-core", "manifest.json"));
  assert.equal(Object.hasOwn(manifest, "projectId"), false, "the manifest must not carry projectId");
  assert.equal(manifest.model, "self-contained-layered-config");
});

test("should warn and record nothing without model and origin flags", () => {
  const project = makeOutsideGit("ca3");
  const home = makeTemp("ca3-home");
  const result = run(process.execPath, [MGR_BIN, "install", "--engine", "claude-code", "-y", project], {
    cwd: project,
    home,
  });
  assert.equal(result.status, 0, `install failed: ${result.stderr}`);

  for (const file of ["mgr-draft.md", "mgr-task.md", "mgr-review.md"]) {
    const content = fs.readFileSync(path.join(project, ".claude", "agents", file), "utf8");
    assert.doesNotMatch(content, /^model:/m, `${file} must have no model line`);
  }
  assert.ok(result.stdout.includes("No model recorded for:"), result.stdout);
  assert.ok(result.stdout.includes("Project origin not recorded:"), result.stdout);

  const configFile = path.join(project, ".mgr-core", "config.json");
  if (fs.existsSync(configFile)) {
    const config = readJson(configFile);
    assert.equal(Object.hasOwn(config, "origin"), false, "config.json must not record an origin");
    assert.equal(Object.hasOwn(config, "agents"), false, "config.json must not record agents");
  }
});

test("should give a clone the team policy without asking and without the personal id", () => {
  const project = makeOutsideGit("ca5");
  const home = makeTemp("ca5-home");
  installCa1(project, home);

  const clone = makeOutsideGit("ca5-clone");
  fs.cpSync(project, clone, { recursive: true });
  fs.rmSync(path.join(clone, ".mgr-core", "config.local.json"), { force: true });
  fs.rmSync(path.join(clone, ".mgr-core", ".env"), { force: true });

  const result = run(
    process.execPath,
    [path.join(".claude", "skills", "_shared", "mgr", "bin", "mgr-runtime.js"), "agents", "drafting", "--json"],
    { cwd: clone, input: "", home },
  );
  assert.equal(result.status, 0, result.stderr);
  const claude = JSON.parse(result.stdout).intents.drafting.engines["claude-code"];
  assert.equal(claude.model, "opus");
  assert.equal(claude.modelSource, "configured");

  for (const file of allFiles(clone)) {
    assert.equal(
      fs.readFileSync(file).includes(PERSONAL_ID),
      false,
      `${path.relative(clone, file)} must not contain the personal id`,
    );
  }
});

test("should end every method skill frontmatter with the ownership mark", () => {
  const project = makeOutsideGit("ca15");
  const home = makeTemp("ca15-home");
  const install = run(process.execPath, [MGR_BIN, "install", "--engine", "claude-code", "--all-skills", "-y", project], {
    cwd: project,
    home,
  });
  assert.equal(install.status, 0, `install failed: ${install.stderr}`);

  const skillsDir = path.join(project, ".claude", "skills");
  const folders = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillsDir, entry.name, "SKILL.md")))
    .map((entry) => entry.name);
  assert.ok(folders.length > 0, "the install must carry at least one skill");

  for (const folder of folders) {
    const text = fs.readFileSync(path.join(skillsDir, folder, "SKILL.md"), "utf8");
    const lines = text.split("\n");
    assert.equal(lines[0], "---", `${folder}: the file must open a frontmatter`);
    const close = lines.indexOf("---", 1);
    assert.ok(close > 1, `${folder}: the frontmatter must be closed`);
    assert.equal(lines[close - 1], `# mgr-managed-skill: ${folder}`, `${folder}: the mark must be the last frontmatter line`);
    assert.equal(
      lines.filter((line) => line.startsWith("# mgr-managed-skill")).length,
      1,
      `${folder}: the mark must appear exactly once`,
    );
  }

  const validate = run(process.execPath, [MGR_BIN, "validate"], { cwd: PACKAGE_ROOT, home });
  assert.equal(validate.status, 0, validate.stdout + validate.stderr);

  const doctor = run(process.execPath, [MGR_BIN, "doctor", project, "--json"], { cwd: project, home });
  const checks = JSON.parse(doctor.stdout).findings.map((finding) => finding.check);
  assert.equal(checks.includes("divergent-body"), false, doctor.stdout);
  assert.equal(checks.includes("unresolved-token"), false, doctor.stdout);
});

const stripAnsi = (text) => stripVTControlCharacters(text);
const manifestFile = (project) => path.join(project, ".mgr-core", "manifest.json");
const skillsDirOf = (project) => path.join(project, ".claude", "skills");

function installFresh(project, home, extra = []) {
  const result = run(process.execPath, [MGR_BIN, "install", "--engine", "claude-code", ...extra, "-y", project], {
    cwd: project,
    home,
  });
  assert.equal(result.status, 0, `install failed: ${result.stderr}`);
}

const hasMgrHook = (entry) => JSON.stringify(entry).includes("mgr-session-hook");

test("should bring configure-agents and PreCompact to a previous-version install", () => {
  const project = makeOutsideGit("ca10");
  const home = makeTemp("ca10-home");
  installFresh(project, home);

  // Monta a "versao anterior" a partir da instalacao fresca (CA-10, preparacao).
  fs.rmSync(path.join(skillsDirOf(project), "configure-agents"), { recursive: true, force: true });
  const manifest = readJson(manifestFile(project));
  manifest.skills = manifest.skills.filter((name) => name !== "configure-agents");
  manifest.model = "self-contained-runtime";
  manifest.projectId = "previous-id-9c1";
  // A versão anterior (layout da F1) não tinha camada pessoal: o id morava só no manifesto e no `.env`.
  fs.rmSync(path.join(project, ".mgr-core", "config.local.json"), { force: true });
  fs.rmSync(path.join(project, ".mgr-core", ".env"), { force: true });
  fs.writeFileSync(manifestFile(project), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const alienStart = { matcher: "startup", hooks: [{ type: "command", command: "echo alien-start", timeout: 3 }] };
  const alienCompact = { matcher: "auto", hooks: [{ type: "command", command: "echo alien-compact", timeout: 4 }] };
  const settingsFile = path.join(project, ".claude", "settings.local.json");
  const settings = readJson(settingsFile);
  settings.hooks.PreCompact = [alienCompact];
  settings.hooks.SessionStart = [...(settings.hooks.SessionStart ?? []), alienStart];
  fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

  for (const file of allFiles(skillsDirOf(project)).filter((f) => path.basename(f) === "SKILL.md")) {
    const text = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, text.split("\n").filter((line) => !line.startsWith("# mgr-managed-skill:")).join("\n"), "utf8");
  }

  const result = run(process.execPath, [MGR_BIN, "update", project], { cwd: project, home });
  assert.equal(result.status, 0, `update failed: ${result.stdout}${result.stderr}`);
  const stdout = stripAnsi(result.stdout);

  assert.ok(fs.existsSync(path.join(skillsDirOf(project), "configure-agents", "SKILL.md")));
  assert.ok(readJson(manifestFile(project)).skills.includes("configure-agents"));

  const after = readJson(settingsFile);
  const compact = after.hooks.PreCompact.filter(hasMgrHook);
  assert.equal(compact.length, 1, JSON.stringify(after.hooks.PreCompact));
  assert.ok(JSON.stringify(compact[0]).includes("precompact --hook claude-code"));
  assert.ok(after.hooks.PreCompact.map((e) => JSON.stringify(e)).includes(JSON.stringify(alienCompact)));
  assert.ok(after.hooks.SessionStart.map((e) => JSON.stringify(e)).includes(JSON.stringify(alienStart)));

  assert.ok(stdout.includes("skill entering: configure-agents"), stdout);
  assert.ok(stdout.includes("hook event added to .claude/settings.local.json: PreCompact"), stdout);
  // L-5: o evento é anunciado ANTES de ser gravado (LOG-1).
  const previsto = stdout.indexOf("hook event to add in .claude/settings.local.json: PreCompact");
  assert.ok(previsto >= 0 && previsto < stdout.indexOf("hook event added to .claude/settings.local.json: PreCompact"), stdout);
  const announce = stdout.indexOf("Installation in the previous layout");
  assert.ok(announce >= 0, stdout);
  assert.ok(announce < stdout.indexOf("skill entering: configure-agents"), "the announcement must precede the first difference");
  assert.ok(announce < stdout.indexOf("hook event added to"), "the announcement must precede the first difference");

  assert.equal(readJson(path.join(project, ".mgr-core", "config.local.json")).projectId, "previous-id-9c1");
  assert.equal(Object.hasOwn(readJson(manifestFile(project)), "projectId"), false);

  const skillFiles = allFiles(skillsDirOf(project)).filter((f) => path.basename(f) === "SKILL.md");
  assert.ok(skillFiles.length > 0);
  for (const file of skillFiles) {
    const folder = path.basename(path.dirname(file));
    const lines = fs.readFileSync(file, "utf8").split("\n");
    if (!lines.some((line) => line.startsWith("# mgr-managed-skill:"))) {
      assert.fail(`${folder}: SKILL.md must carry the ownership mark`);
    }
  }
});

test("should exit 1 when a leaving skill is kept without a terminal", () => {
  const project = makeOutsideGit("ca11");
  const home = makeTemp("ca11-home");
  installFresh(project, home, ["--arch", "layered"]);

  const leaving = path.join(skillsDirOf(project), "arch-hexagonal");
  fs.cpSync(path.join(PACKAGE_ROOT, "test", "fixtures", "orfas-f0", "arch-hexagonal"), leaving, { recursive: true });
  const manifest = readJson(manifestFile(project));
  manifest.skills.push("arch-hexagonal");
  fs.writeFileSync(manifestFile(project), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const result = run(process.execPath, [MGR_BIN, "update", project], { cwd: project, home });
  const stdout = stripAnsi(result.stdout);
  assert.equal(result.status, 1, `${stdout}${result.stderr}`);
  assert.ok(fs.existsSync(leaving), "the leaving skill folder must stay");
  assert.ok(readJson(manifestFile(project)).skills.includes("arch-hexagonal"));
  assert.ok(stdout.includes("skill leaving: arch-hexagonal"), stdout);
  assert.ok(stdout.includes("Still diverging from what v"), stdout);
});

test("should keep real orphans without consent and remove them with -y", () => {
  const project = makeOutsideGit("ca13");
  const home = makeTemp("ca13-home");
  installFresh(project, home, ["--arch", "layered"]);

  const orphans = ["arch-hexagonal", "evidence-capture", "junit-clean"];
  for (const name of orphans) {
    fs.cpSync(path.join(PACKAGE_ROOT, "test", "fixtures", "orfas-f0", name), path.join(skillsDirOf(project), name), {
      recursive: true,
    });
  }

  const refused = run(process.execPath, [MGR_BIN, "update", project], { cwd: project, home });
  const stdout = stripAnsi(refused.stdout);
  assert.equal(refused.status, 1, `${stdout}${refused.stderr}`);
  for (const name of orphans) {
    assert.ok(fs.existsSync(path.join(skillsDirOf(project), name)), `${name} must stay without consent`);
    const lines = stdout.split("\n").filter((line) => line.includes("orphan offered for removal:") && line.includes(name));
    assert.equal(lines.length, 1, `${name}: exactly one offer line\n${stdout}`);
    assert.ok(
      lines[0].includes("a name mgr-method ships, absent from the manifest and from mgr-skills.lock"),
      lines[0],
    );
  }

  const forced = run(process.execPath, [MGR_BIN, "update", "-y", project], { cwd: project, home });
  assert.equal(forced.status, 0, `${forced.stdout}${forced.stderr}`);
  for (const name of orphans) {
    assert.equal(fs.existsSync(path.join(skillsDirOf(project), name)), false, `${name} must be removed with -y`);
  }

  const doctor = run(process.execPath, [MGR_BIN, "doctor", project, "--json"], { cwd: project, home });
  const checks = JSON.parse(doctor.stdout).findings.map((finding) => finding.check);
  assert.equal(checks.includes("orphan-skill"), false, doctor.stdout);
});
