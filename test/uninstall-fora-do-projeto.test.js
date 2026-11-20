import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isOurAgent, isOurSkill } from "../src/builder.js";
import { IGNORED_REASON, coreDir, planUninstall, resolveCustomDir } from "../src/installer.js";
import { manifestPath } from "../src/manifest.js";
import { getMessages } from "../src/messages.js";
import { tempDir } from "../scripts/lib/tmp.mjs";

const M = getMessages("en");
const exec = promisify(execFile);
const MGR_BIN = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
const CLI_TIMEOUT_MS = 120_000;
const REGISTRY_SKILL = "arch-hexagonal";
const USER_FILES = [`${REGISTRY_SKILL}/SKILL.md`, "nota.txt", path.join("_shared", "minha-coisa", "a.txt")];
const UNMARKED_SKILL = `---\nname: ${REGISTRY_SKILL}\ndescription: skill da pessoa\n---\n\ncorpo da pessoa\n`;

async function mgr(home, args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [MGR_BIN, ...args], {
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
      cwd: home,
      env: { ...process.env, LC_ALL: "C", LANG: "C", LANGUAGE: "", NO_COLOR: "1", HOME: home },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

function seedBait(bait) {
  for (const rel of USER_FILES) mkdirSync(path.dirname(path.join(bait, rel)), { recursive: true });
  writeFileSync(path.join(bait, USER_FILES[0]), UNMARKED_SKILL, "utf8");
  writeFileSync(path.join(bait, USER_FILES[1]), "nota da pessoa\n", "utf8");
  writeFileSync(path.join(bait, USER_FILES[2]), "a da pessoa\n", "utf8");
}

async function withWorld(fn) {
  const root = realpathSync(tempDir("mgr-uninstall-fora-"));
  const repo = path.join(root, "proj");
  const bait = path.join(root, "isca");
  const home = path.join(root, "home");
  try {
    for (const dir of [repo, bait, home]) mkdirSync(dir, { recursive: true });
    seedBait(bait);
    await fn({ root, repo, bait, home });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const hashes = (dir, files) => Object.fromEntries(files.map((rel) => [rel, sha(path.join(dir, rel))]));
const readManifest = (repo) => JSON.parse(readFileSync(manifestPath(coreDir("project", repo)), "utf8"));

function tamper(repo, patch) {
  const file = manifestPath(coreDir("project", repo));
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...patch }, null, 2) + "\n", "utf8");
}

async function installNormal(home, repo, extra = []) {
  const result = await mgr(home, ["install", "--engine", "claude-code", "--arch", "hexagonal", "--project-id", "x", "-y", ...extra, repo]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
}

const skippedLines = (stdout) => stdout.split("\n").filter((line) => line.startsWith("skipped "));
const hasLine = (stdout, line) => stdout.split("\n").includes(line);
const otherSkill = (manifest) => manifest.skills.find((name) => name !== REGISTRY_SKILL);

test("should leave the same bait byte for byte under install, update and uninstall", async () => {
  await withWorld(async ({ repo, bait, home }) => {
    const before = hashes(bait, USER_FILES);
    const kept = M.enteringKeptNotOurs(path.relative(repo, path.join(bait, REGISTRY_SKILL)), REGISTRY_SKILL);

    const install = await mgr(home, ["install", "--skills-dir", bait, "--arch", "hexagonal", "--project-id", "x", "-y", repo]);
    assert.equal(install.code, 1, install.stdout + install.stderr);
    assert.ok(hasLine(install.stdout, kept), install.stdout);
    assert.ok(!readManifest(repo).skills.includes(REGISTRY_SKILL));
    assert.deepEqual(hashes(bait, USER_FILES), before);

    assert.deepEqual(readManifest(repo).engines, ["custom"]);
    const update = await mgr(home, ["update", "-y", repo]);
    assert.equal(update.code, 1, update.stdout + update.stderr);
    assert.ok(hasLine(update.stdout, kept), update.stdout);
    assert.ok(!readManifest(repo).skills.includes(REGISTRY_SKILL));
    assert.deepEqual(hashes(bait, USER_FILES), before);

    const uninstall = await mgr(home, ["uninstall", "-y", repo]);
    assert.equal(uninstall.code, 0, uninstall.stdout + uninstall.stderr);
    assert.ok(hasLine(uninstall.stdout, M.uninstallPathIgnored(path.join(bait, "_shared", "minha-coisa"))), uninstall.stdout);
    assert.deepEqual(hashes(bait, USER_FILES), before);
  });
});

test("should update a marked folder inside the bait and then remove it", async () => {
  await withWorld(async ({ repo, bait, home }) => {
    const install = await mgr(home, ["install", "--skills-dir", bait, "--arch", "hexagonal", "--project-id", "x", "-y", repo]);
    assert.equal(install.code, 1, install.stdout + install.stderr);
    const name = otherSkill(readManifest(repo));
    const skillFile = path.join(bait, name, "SKILL.md");
    assert.ok(isOurSkill(readFileSync(skillFile, "utf8"), name));
    const written = readFileSync(skillFile, "utf8");
    writeFileSync(skillFile, `${written}\nEDITADO PELA PESSOA\n`, "utf8");

    const update = await mgr(home, ["update", "-y", repo]);
    assert.equal(update.code, 1, update.stdout + update.stderr);
    assert.equal(readFileSync(skillFile, "utf8"), written);

    const uninstall = await mgr(home, ["uninstall", "-y", repo]);
    assert.equal(uninstall.code, 0, uninstall.stdout + uninstall.stderr);
    assert.equal(existsSync(path.join(bait, name)), false);
    assert.ok(existsSync(path.join(bait, USER_FILES[1])));
  });
});

async function uninstallTampered({ repo, bait, home, patch, extraFiles = [] }) {
  await installNormal(home, repo);
  const agentFile = path.join(repo, ".claude", "agents", "mgr-review.md");
  assert.ok(isOurAgent(readFileSync(agentFile, "utf8")));
  cpSync(agentFile, path.join(bait, "mgr-review.md"));
  tamper(repo, typeof patch === "function" ? patch(readManifest(repo)) : patch);
  const files = [...USER_FILES, "mgr-review.md", ...extraFiles];
  const before = hashes(bait, files);
  const result = await mgr(home, ["uninstall", "-y", repo]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(hashes(bait, files), before);
  assert.equal(existsSync(path.join(repo, ".claude", "skills")), false);
  assert.equal(existsSync(coreDir("project", repo)), false);
  assert.equal(existsSync(agentFile), false);
  return result;
}

test("should ignore a relative skillsDirs entry pointing outside the project", async () => {
  await withWorld(async ({ repo, bait, home }) => {
    const result = await uninstallTampered({ repo, bait, home, patch: { skillsDirs: ["../isca"] } });
    assert.deepEqual(skippedLines(result.stdout), [M.uninstallPathIgnored(bait)]);
  });
});

test("should ignore an absolute skillsDirs entry pointing outside the project", async () => {
  await withWorld(async ({ repo, bait, home }) => {
    const result = await uninstallTampered({ repo, bait, home, patch: { skillsDirs: [bait] } });
    assert.deepEqual(skippedLines(result.stdout), [M.uninstallPathIgnored(bait)]);
  });
});

test("should ignore an agentsDirs entry pointing outside the project", async () => {
  await withWorld(async ({ repo, bait, home }) => {
    const result = await uninstallTampered({ repo, bait, home, patch: { agentsDirs: ["../isca"] } });
    assert.deepEqual(skippedLines(result.stdout), [M.uninstallPathIgnored(bait)]);
  });
});

test("should ignore a marked agent file declared outside the recalculated agent folders", async () => {
  await withWorld(async ({ repo, bait, home }) => {
    const patch = (manifest) => ({ agents: [...manifest.agents, "../isca/mgr-review.md"] });
    const result = await uninstallTampered({ repo, bait, home, patch });
    assert.deepEqual(skippedLines(result.stdout), [M.uninstallPathIgnored(path.join(bait, "mgr-review.md"))]);
  });
});

test("should keep the unmarked bait folder and remove the marked one when the manifest declares custom", async () => {
  await withWorld(async ({ repo, bait, home }) => {
    await installNormal(home, repo);
    const name = otherSkill(readManifest(repo));
    cpSync(path.join(repo, ".claude", "skills", name), path.join(bait, name), { recursive: true });
    assert.ok(isOurSkill(readFileSync(path.join(bait, name, "SKILL.md"), "utf8"), name));
    tamper(repo, { engines: ["custom"], skillsDirs: ["../isca"] });
    const before = hashes(bait, USER_FILES);

    const result = await mgr(home, ["uninstall", "-y", repo]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.ok(hasLine(result.stdout, M.uninstallPathIgnored(path.join(bait, REGISTRY_SKILL))), result.stdout);
    assert.deepEqual(hashes(bait, USER_FILES), before);
    assert.equal(existsSync(path.join(bait, name)), false);
  });
});

for (const [rotulo, patch] of [
  ["architecture outside the catalog", { architecture: "mvc" }],
  ["language not text", { language: [1] }],
  ["userLanguage not text", { userLanguage: 7 }],
  ["optional not a list", { optional: {} }],
  ["allSkills not a boolean", { allSkills: "sim" }],
]) {
  test(`should uninstall with exit 0 when the ${rotulo} because the uninstall does not consume it`, async () => {
    await withWorld(async ({ repo, home }) => {
      await installNormal(home, repo);
      tamper(repo, patch);
      const result = await mgr(home, ["uninstall", "-y", repo]);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.equal(existsSync(path.join(repo, ".claude", "skills", REGISTRY_SKILL)), false);
      assert.equal(existsSync(manifestPath(coreDir("project", repo))), false);
    });
  });
}

test("should refuse the uninstall with exit 1 and remove nothing when engines is not a list", async () => {
  await withWorld(async ({ repo, bait, home }) => {
    await installNormal(home, repo);
    tamper(repo, { engines: 7 });
    const before = {
      bait: hashes(bait, USER_FILES),
      manifest: sha(manifestPath(coreDir("project", repo))),
      skill: sha(path.join(repo, ".claude", "skills", REGISTRY_SKILL, "SKILL.md")),
      agent: sha(path.join(repo, ".claude", "agents", "mgr-review.md")),
    };

    const result = await mgr(home, ["uninstall", "-y", repo]);
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.equal(sha(manifestPath(coreDir("project", repo))), before.manifest);
    assert.equal(sha(path.join(repo, ".claude", "skills", REGISTRY_SKILL, "SKILL.md")), before.skill);
    assert.equal(sha(path.join(repo, ".claude", "agents", "mgr-review.md")), before.agent);
    assert.deepEqual(hashes(bait, USER_FILES), before.bait);
  });
});

for (const scope of ["project", "global"]) {
  test(`should keep an unmarked registry-named folder and remove a marked one in ${scope} scope`, async () => {
    await withWorld(async ({ repo, home }) => {
      const scopeArgs = ["--scope", scope];
      const install = await mgr(home, ["install", "--engine", "claude-code", "--arch", "hexagonal", "--project-id", "x", "-y", ...scopeArgs, repo]);
      assert.equal(install.code, 0, install.stdout + install.stderr);
      const skillsDir = path.join(scope === "global" ? home : repo, ".claude", "skills");
      const manifestFile = path.join(scope === "global" ? home : repo, ".mgr-core", "manifest.json");
      const name = otherSkill(JSON.parse(readFileSync(manifestFile, "utf8")));
      const foreign = path.join(skillsDir, REGISTRY_SKILL, "SKILL.md");
      writeFileSync(foreign, UNMARKED_SKILL, "utf8");
      assert.ok(existsSync(path.join(skillsDir, name, "SKILL.md")));

      const result = await mgr(home, ["uninstall", "-y", ...scopeArgs, repo]);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.ok(hasLine(result.stdout, M.uninstallPathIgnored(path.join(skillsDir, REGISTRY_SKILL))), result.stdout);
      assert.equal(readFileSync(foreign, "utf8"), UNMARKED_SKILL);
      assert.equal(existsSync(path.join(skillsDir, name)), false);
    });
  });
}

function withRoot(fn) {
  const root = realpathSync(tempDir("mgr-resolve-custom-"));
  const repo = path.join(root, "proj");
  const outside = path.join(root, "fora");
  try {
    mkdirSync(repo, { recursive: true });
    mkdirSync(outside, { recursive: true });
    fn({ root, repo, outside });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("should resolve a dot to the project root", () => {
  withRoot(({ repo }) => {
    assert.deepEqual(resolveCustomDir(".", "project", repo), { state: "resolved", dir: repo, declared: repo });
  });
});

test("should resolve a double dot to the parent of the project", () => {
  withRoot(({ root, repo }) => {
    assert.equal(resolveCustomDir("..", "project", repo).dir, root);
  });
});

test("should resolve an absolute path inside the project to itself", () => {
  withRoot(({ repo }) => {
    const inside = path.join(repo, "skills");
    mkdirSync(inside);
    assert.equal(resolveCustomDir(inside, "project", repo).dir, inside);
  });
});

test("should resolve an absolute path outside the project to itself", () => {
  withRoot(({ repo, outside }) => {
    assert.equal(resolveCustomDir(outside, "project", repo).dir, outside);
  });
});

test("should resolve a not yet existing subfolder under the project", () => {
  withRoot(({ repo }) => {
    assert.equal(resolveCustomDir(path.join("a", "b"), "project", repo).dir, path.join(repo, "a", "b"));
  });
});

test("should resolve a symlink inside the project to the real outside path", () => {
  withRoot(({ repo, outside }) => {
    symlinkSync(outside, path.join(repo, "link"));
    assert.equal(resolveCustomDir("link", "project", repo).dir, outside);
    assert.equal(resolveCustomDir(path.join("link", "novo"), "project", repo).dir, path.join(outside, "novo"));
  });
});

test("should give each ignored path the reason it was left on disk", async () => {
  await withWorld(async ({ repo, bait, home }) => {
    await installNormal(home, repo);
    const unmarked = path.join(repo, ".claude", "skills", REGISTRY_SKILL);
    writeFileSync(path.join(unmarked, "SKILL.md"), UNMARKED_SKILL, "utf8");
    tamper(repo, {
      skillsDirs: ["../isca"],
      agents: [...JSON.parse(readFileSync(manifestPath(coreDir("project", repo)), "utf8")).agents, "../isca/mgr-review.md"],
    });
    const { ignored } = planUninstall("project", repo);
    const reasonOf = (alvo) => ignored.filter(({ path: caminho }) => caminho === alvo).map(({ reason }) => reason);
    assert.deepEqual(reasonOf(path.resolve(bait)), [IGNORED_REASON.DIFFERS_FROM_RECALCULATED]);
    assert.deepEqual(reasonOf(path.join(path.resolve(bait), "mgr-review.md")), [IGNORED_REASON.OUTSIDE_AGENT_DIRS]);
    assert.deepEqual(reasonOf(unmarked), [IGNORED_REASON.NO_OWNERSHIP_MARK]);
  });
});

test("should keep a registry-named folder without SKILL.md on uninstall and say why", async () => {
  await withWorld(async ({ repo, home }) => {
    await installNormal(home, repo);
    const pasta = path.join(repo, ".claude", "skills", REGISTRY_SKILL);
    rmSync(path.join(pasta, "SKILL.md"));
    writeFileSync(path.join(pasta, "nota.txt"), "da pessoa\n", "utf8");
    const result = await mgr(home, ["uninstall", "-y", repo]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(readFileSync(path.join(pasta, "nota.txt"), "utf8"), "da pessoa\n");
    assert.ok(result.stdout.split("\n").includes(M.uninstallPathIgnored(pasta)), result.stdout);
  });
});

test("should announce the kept unmarked folder in pt-BR only when the install runs in pt-BR", async () => {
  await withWorld(async ({ repo, bait, home }) => {
    const pt = getMessages("pt-BR");
    const result = await mgr(home, ["install", "--skills-dir", bait, "--arch", "hexagonal", "--project-id", "x", "--user-language", "pt-BR", "-y", repo]);
    const rel = path.relative(repo, path.join(bait, REGISTRY_SKILL));
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.ok(result.stdout.includes(pt.enteringKeptNotOurs(rel, REGISTRY_SKILL)), result.stdout);
    assert.ok(!result.stdout.includes(M.enteringKeptNotOurs(rel, REGISTRY_SKILL)), result.stdout);
  });
});

test("should record the declared custom folder and not the real path behind a symlink, on install and update", async () => {
  await withWorld(async ({ repo, bait, home }) => {
    const link = path.join(repo, "skills-link");
    symlinkSync(bait, link);
    const install = await mgr(home, ["install", "--skills-dir", link, "--arch", "hexagonal", "--project-id", "x", "-y", repo]);
    assert.equal(install.code, 1, install.stdout + install.stderr);
    assert.deepEqual(readManifest(repo).skillsDirs, ["skills-link"]);
    const update = await mgr(home, ["update", "-y", repo]);
    assert.equal(update.code, 1, update.stdout + update.stderr);
    assert.deepEqual(readManifest(repo).skillsDirs, ["skills-link"]);
    assert.ok(existsSync(path.join(realpathSync(bait), "spec-init", "SKILL.md")));
  });
});

for (const [rotulo, patch] of [["agents not a list", { agents: 7 }]]) {
  test(`should recalculate the MGR agents and keep the person's file on uninstall when ${rotulo}`, async () => {
    await withWorld(async ({ repo, home }) => {
      await installNormal(home, repo);
      const pasta = path.join(repo, ".claude", "agents");
      const daPessoa = path.join(pasta, "meu-agente.md");
      writeFileSync(daPessoa, "agente da pessoa\n", "utf8");
      tamper(repo, patch);
      const result = await mgr(home, ["uninstall", "-y", repo]);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.equal(existsSync(path.join(pasta, "mgr-review.md")), false);
      assert.equal(readFileSync(daPessoa, "utf8"), "agente da pessoa\n");
      assert.ok(!result.stdout.includes(daPessoa), result.stdout);
    });
  });
}

test("should remove the recalculated empty agents folder on uninstall when agentsDirs is not a list", async () => {
  await withWorld(async ({ repo, home }) => {
    await installNormal(home, repo);
    tamper(repo, { agentsDirs: 7 });
    const result = await mgr(home, ["uninstall", "-y", repo]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(existsSync(path.join(repo, ".claude", "agents")), false);
  });
});

test("should announce and remove the skill leaving the set when the custom folder is behind a symlink", async () => {
  await withWorld(async ({ repo, home }) => {
    const real = path.join(path.dirname(repo), "skills-reais");
    mkdirSync(real, { recursive: true });
    const link = path.join(repo, "skills-link");
    symlinkSync(real, link);
    const install = await mgr(home, ["install", "--skills-dir", link, "--arch", "hexagonal", "--project-id", "x", "-y", repo]);
    assert.equal(install.code, 0, install.stdout + install.stderr);
    assert.ok(existsSync(path.join(real, "arch-hexagonal", "SKILL.md")));
    tamper(repo, { architecture: "layered" });
    const update = await mgr(home, ["update", "-y", repo]);
    assert.equal(update.code, 0, update.stdout + update.stderr);
    assert.equal(existsSync(path.join(real, "arch-hexagonal")), false, update.stdout);
    assert.equal(readManifest(repo).skills.includes("arch-hexagonal"), false);
    assert.deepEqual(readManifest(repo).skillsDirs, ["skills-link"]);
  });
});

test("should still announce an agent entry declared outside the project when another agents element is out of shape", async () => {
  await withWorld(async ({ repo, bait, home }) => {
    await installNormal(home, repo);
    const fora = path.join(bait, "mgr-review.md");
    cpSync(path.join(repo, ".claude", "agents", "mgr-review.md"), fora);
    const antes = readFileSync(fora, "utf8");
    tamper(repo, { agents: ["../isca/mgr-review.md", 7] });
    const result = await mgr(home, ["uninstall", "-y", repo]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.ok(result.stdout.split("\n").includes(M.uninstallPathIgnored(path.resolve(fora))), result.stdout);
    assert.equal(readFileSync(fora, "utf8"), antes);
    assert.equal(existsSync(path.join(repo, ".claude", "agents", "mgr-review.md")), false);
  });
});

test("should uninstall when agents is out of shape and the recalculated agents folder does not exist", async () => {
  await withWorld(async ({ repo, home }) => {
    await installNormal(home, repo);
    rmSync(path.join(repo, ".claude", "agents"), { recursive: true, force: true });
    tamper(repo, { agents: 7 });
    const result = await mgr(home, ["uninstall", "-y", repo]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(existsSync(path.join(repo, ".claude", "skills", REGISTRY_SKILL)), false);
  });
});

for (const comando of [["update", "-y"], ["install", "-y"]]) {
  test(`should keep the custom folder text and remove the leaving skill on ${comando[0]} when the declaration has a trailing slash`, async () => {
    await withWorld(async ({ repo, home }) => {
      const pasta = path.join(repo, "minhas-skills");
      const install = await mgr(home, ["install", "--skills-dir", pasta, "--arch", "hexagonal", "--project-id", "x", "-y", repo]);
      assert.equal(install.code, 0, install.stdout + install.stderr);
      assert.ok(existsSync(path.join(pasta, "arch-hexagonal", "SKILL.md")));
      tamper(repo, { skillsDirs: ["minhas-skills/"], architecture: "layered" });
      const result = await mgr(home, [...comando, repo]);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.equal(existsSync(path.join(pasta, "arch-hexagonal")), false, result.stdout);
      assert.equal(readManifest(repo).skills.includes("arch-hexagonal"), false);
      assert.deepEqual(readManifest(repo).skillsDirs, ["minhas-skills/"]);
    });
  });
}

test("should keep a relative custom folder text and remove the leaving skill on a global update", async () => {
  await withWorld(async ({ repo, home }) => {
    const pasta = path.join(home, "skills-globais");
    const install = await mgr(home, ["install", "--scope", "global", "--skills-dir", pasta, "--arch", "hexagonal", "--project-id", "x", "-y", repo]);
    assert.equal(install.code, 0, install.stdout + install.stderr);
    const arquivo = path.join(home, ".mgr-core", "manifest.json");
    const manifesto = JSON.parse(readFileSync(arquivo, "utf8"));
    writeFileSync(arquivo, JSON.stringify({ ...manifesto, skillsDirs: ["skills-globais"], architecture: "layered" }));
    const update = await mgr(home, ["update", "-y", "--scope", "global", repo]);
    assert.equal(update.code, 0, update.stdout + update.stderr);
    assert.equal(existsSync(path.join(pasta, "arch-hexagonal")), false, update.stdout);
    assert.deepEqual(JSON.parse(readFileSync(arquivo, "utf8")).skillsDirs, ["skills-globais"]);
  });
});

test("should offer and remove a method orphan on update when the custom declaration has a trailing slash", async () => {
  await withWorld(async ({ repo, home }) => {
    const pasta = path.join(repo, "minhas-skills");
    const install = await mgr(home, ["install", "--skills-dir", pasta, "--arch", "hexagonal", "--project-id", "x", "-y", repo]);
    assert.equal(install.code, 0, install.stdout + install.stderr);
    const skills = readManifest(repo).skills.filter((nome) => nome !== "arch-hexagonal");
    tamper(repo, { skillsDirs: ["minhas-skills/"], architecture: "layered", skills });
    const update = await mgr(home, ["update", "-y", repo]);
    assert.equal(update.code, 0, update.stdout + update.stderr);
    assert.equal(existsSync(path.join(pasta, "arch-hexagonal")), false, update.stdout);
  });
});
