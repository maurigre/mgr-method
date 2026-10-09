import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { planOwnedHooks, syncOwnedHooks } from "../src/hooks.js";
import { applyUpdate, consentItems, coreDir, execute, migrateOld, occupiedFolders, orphanCandidates, partitionConsent, planInstall, planUpdate, skippedByConsent, versionSet } from "../src/installer.js";
import { MODEL_RUNTIME, manifestPath, writeManifest } from "../src/manifest.js";
import { markSkill } from "../src/builder.js";
import * as bundle from "../src/bundle.js";
import * as catalog from "../src/catalog.js";
import { CANCELLED, consentEach, removalMode, REMOVAL_ASK, REMOVAL_ASSUMED, REMOVAL_NO_CONSENT, updateOutcome } from "../src/prompts.js";
import { cpSync } from "node:fs";
import { execFile, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { aggregateChecksum, sha256 } from "../src/plugin.js";

// --- helpers reutilizáveis (outras tasks acrescentam testes a este arquivo) ---

const ENGINE = "claude-code";
const NEW_COMMAND = 'node "/x/mgr-runtime.js"';
const FOREIGN = { matcher: "startup", hooks: [{ type: "command", command: "echo alheio", timeout: 3 }] };
const OWNED_OLD = {
  matcher: "startup",
  hooks: [{ type: "command", command: 'node "/old/mgr.js" detect --hook claude-code # mgr-session-hook', timeout: 5 }],
};

function withRepo(fn) {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mgr-convergente-"));
  try {
    fn(repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

const hookFile = (repo) => path.join(repo, ".claude", "settings.local.json");

function writeHooks(repo, hooks) {
  const file = hookFile(repo);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ hooks }, null, 2) + "\n", "utf8");
  return file;
}

const readHooks = (repo) => JSON.parse(readFileSync(hookFile(repo), "utf8")).hooks;

// --- syncOwnedHooks / planOwnedHooks (DT-12) ---

test("should not create hooks in a file without an MGR entry", () => {
  withRepo((repo) => {
    const file = writeHooks(repo, { SessionStart: [FOREIGN] });
    const before = readFileSync(file);
    assert.deepEqual(syncOwnedHooks(ENGINE, repo, { command: NEW_COMMAND }), { outcome: "no-owned-entry", file });
    assert.deepEqual(readFileSync(file), before);
    assert.deepEqual(planOwnedHooks(ENGINE, repo), { added: [], rewrite: [] });
  });
});

test("should not create the hook file when it does not exist", () => {
  withRepo((repo) => {
    const result = syncOwnedHooks(ENGINE, repo, { command: NEW_COMMAND });
    assert.equal(result.outcome, "no-owned-entry");
    assert.equal(existsSync(path.join(repo, ".claude")), false);
    assert.deepEqual(planOwnedHooks(ENGINE, repo), { added: [], rewrite: [] });
  });
});

test("should add the missing PreCompact next to an existing MGR entry", () => {
  withRepo((repo) => {
    const file = writeHooks(repo, { SessionStart: [OWNED_OLD] });
    assert.deepEqual(planOwnedHooks(ENGINE, repo), { added: ["PreCompact"], rewrite: [] });
    const before = readFileSync(file);
    planOwnedHooks(ENGINE, repo);
    assert.deepEqual(readFileSync(file), before, "the calculation must not write");

    const result = syncOwnedHooks(ENGINE, repo, { command: NEW_COMMAND });
    assert.deepEqual(result, { outcome: "synced", file, added: ["PreCompact"], rewritten: ["SessionStart"] });
    const pre = readHooks(repo).PreCompact;
    assert.equal(pre.length, 1);
    assert.ok(JSON.stringify(pre[0]).includes("mgr-session-hook"));
    assert.ok(pre[0].hooks[0].command.startsWith(`${NEW_COMMAND} precompact --hook ${ENGINE}`));
    assert.deepEqual(planOwnedHooks(ENGINE, repo), { added: [], rewrite: [] });
  });
});

test("should keep foreign entries identical", () => {
  withRepo((repo) => {
    const foreignPre = { matcher: "manual", hooks: [{ type: "command", command: "echo pre" }] };
    writeHooks(repo, { SessionStart: [FOREIGN, OWNED_OLD], PreCompact: [foreignPre], Stop: [FOREIGN] });
    syncOwnedHooks(ENGINE, repo, { command: NEW_COMMAND });
    const hooks = readHooks(repo);
    assert.equal(JSON.stringify(hooks.SessionStart[0]), JSON.stringify(FOREIGN));
    assert.equal(JSON.stringify(hooks.PreCompact[0]), JSON.stringify(foreignPre));
    assert.equal(JSON.stringify(hooks.Stop), JSON.stringify([FOREIGN]));
    assert.equal(hooks.PreCompact.length, 2);
  });
});

test("should rewrite the command of existing MGR entries", () => {
  withRepo((repo) => {
    writeHooks(repo, { SessionStart: [OWNED_OLD] });
    syncOwnedHooks(ENGINE, repo, { command: NEW_COMMAND });
    const entry = readHooks(repo).SessionStart[0];
    assert.ok(!JSON.stringify(entry).includes("/old/mgr.js"));
    assert.ok(entry.hooks[0].command.includes(NEW_COMMAND));
    assert.equal(entry.hooks[0].timeout, 5);
  });
});

test("should be idempotent when run twice", () => {
  withRepo((repo) => {
    writeHooks(repo, { SessionStart: [OWNED_OLD] });
    syncOwnedHooks(ENGINE, repo, { command: NEW_COMMAND });
    const once = readFileSync(hookFile(repo));
    const second = syncOwnedHooks(ENGINE, repo, { command: NEW_COMMAND });
    assert.deepEqual(second.added, []);
    assert.deepEqual(readFileSync(hookFile(repo)), once);
  });
});

// --- versionSet (DT-9, CA-25) ---

test("should return every shipped skill when allSkills is recorded", () => {
  const manifest = { architecture: "layered", language: null, optional: [], allSkills: true, skills: [] };
  assert.deepEqual(versionSet(manifest), bundle.skillNames());
});

test("should infer allSkills from the four architectures in an old manifest", () => {
  const manifest = { architecture: "layered", language: null, skills: Object.values(catalog.ARCHITECTURES) };
  assert.deepEqual(versionSet(manifest), bundle.skillNames());
});

test("should infer optional evidence-capture from an old manifest", () => {
  const manifest = { architecture: "layered", language: null, skills: [...catalog.CORE, "arch-layered", "evidence-capture"] };
  const expected = catalog.selectSkills({ architecture: "layered", optional: ["evidence-capture"] });
  assert.deepEqual(versionSet(manifest), expected);
  assert.ok(versionSet(manifest).includes("evidence-capture"));
});

// --- orphanCandidates (DT-10, CA-14) ---

const SKILLS_DIR = "/proj/.claude/skills";
const SHIPPED = bundle.skillNames().find((n) => catalog.distributesSkill(n));
const UNMARKED = "---\nname: x\n---\ncorpo\n";

// Disco em memoria: { "<pasta>": { "SKILL.md": texto, "mgr-manifest.json": "{}" } } sob `dir`.
function fakeDisk(folders, dir = SKILLS_DIR) {
  const files = new Set([dir]);
  const texts = new Map();
  for (const [folder, content] of Object.entries(folders)) {
    for (const [file, text] of Object.entries(content)) {
      const full = path.join(dir, folder, file);
      files.add(full);
      texts.set(full, text);
    }
  }
  return {
    exists: (p) => files.has(p),
    read: (p) => texts.get(p),
    list: (d) => (d === dir ? Object.keys(folders) : []),
  };
}

function orphanArgs(folders, { lockfile = null, prior = {}, plan = {} } = {}) {
  return {
    prior: { skills: [], skillsDirs: [".claude/skills"], ...prior },
    plan: { scope: "project", repo: "/proj", skills: [], targets: [{ engine: ENGINE, dir: SKILLS_DIR }], ...plan },
    lockfile,
    ...fakeDisk(folders),
  };
}

test("should offer an unmarked shipped name absent from manifest and lockfile", () => {
  const result = orphanCandidates(orphanArgs({ [SHIPPED]: { "SKILL.md": UNMARKED } }));
  assert.deepEqual(result, {
    candidates: [{ name: SHIPPED, dir: SKILLS_DIR, path: path.join(SKILLS_DIR, SHIPPED), class: "distributed" }],
    outOfReach: [],
  });
});

test("should offer a marked renamed folder", () => {
  const folder = "renamed-folder";
  const result = orphanCandidates(orphanArgs({ [folder]: { "SKILL.md": markSkill(UNMARKED, folder) } }));
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].name, folder);
  assert.equal(result.candidates[0].class, "marked");
  assert.deepEqual(result.outOfReach, []);
});

test("should never offer a lockfile dir", () => {
  const lockfile = { skills: { "pub/x": { dir: SHIPPED } } };
  const result = orphanCandidates(orphanArgs({ [SHIPPED]: { "SKILL.md": UNMARKED } }, { lockfile }));
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.outOfReach, [{ name: SHIPPED, dir: SKILLS_DIR }]);
});

test("should never offer a folder with mgr-manifest.json", () => {
  const result = orphanCandidates(orphanArgs({
    [SHIPPED]: { "SKILL.md": UNMARKED, "mgr-manifest.json": "{}" },
  }));
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.outOfReach, [{ name: SHIPPED, dir: SKILLS_DIR }]);
});

test("should report an unknown name as out of reach", () => {
  const result = orphanCandidates(orphanArgs({ "someone-elses": { "SKILL.md": UNMARKED } }));
  assert.deepEqual(result, { candidates: [], outOfReach: [{ name: "someone-elses", dir: SKILLS_DIR }] });
});

test("should not scan a directory the prior manifest never declared", () => {
  const args = orphanArgs({ [SHIPPED]: { "SKILL.md": UNMARKED } }, { prior: { skillsDirs: [".github/skills"] } });
  args.list = () => assert.fail("must not list an undeclared directory");
  assert.deepEqual(orphanCandidates(args), { candidates: [], outOfReach: [] });
});

test("should skip a folder with the _ prefix when scanning for orphans", () => {
  const result = orphanCandidates(orphanArgs({ _hidden: { "SKILL.md": markSkill(UNMARKED, "_hidden") } }));
  assert.deepEqual(result, { candidates: [], outOfReach: [] });
});

test("should not scan a target whose directory does not exist", () => {
  const args = orphanArgs({ [SHIPPED]: { "SKILL.md": UNMARKED } });
  args.exists = () => false;
  args.list = () => assert.fail("must not list a missing directory");
  assert.deepEqual(orphanCandidates(args), { candidates: [], outOfReach: [] });
});

// --- consentEach / updateOutcome (DT-11 passo 4, DT-13; CA-11, CA-13) ---

// Stub de @clack: responde pela fila e registra cada pergunta. Nunca cancela.
function scriptedAsk(answers) {
  const queue = [...answers];
  const calls = [];
  return {
    calls,
    isCancel: () => false,
    confirm: async (opts) => {
      calls.push(opts);
      return queue.shift();
    },
  };
}

test("should ask once per candidate with no as default", async () => {
  const ask = scriptedAsk([false, false]);
  const result = await consentEach(ask, ["a/x", "b/y"], { mode: REMOVAL_ASK });
  assert.deepEqual(ask.calls.map((c) => c.message), ["Remove a/x?", "Remove b/y?"]);
  assert.ok(ask.calls.every((c) => c.initialValue === false));
  assert.deepEqual(result, { remove: [], keep: ["a/x", "b/y"] });
});

test("should remove only the second of three when answers are no yes no", async () => {
  const ask = scriptedAsk([false, true, false]);
  const result = await consentEach(ask, ["a/1", "b/2", "c/3"], { mode: REMOVAL_ASK });
  assert.equal(ask.calls.length, 3);
  assert.deepEqual(result, { remove: ["b/2"], keep: ["a/1", "c/3"] });
});

test("should keep everything without a terminal and without -y", async () => {
  const mode = removalMode({ isTTY: false, yes: false });
  assert.equal(mode, REMOVAL_NO_CONSENT);
  const ask = scriptedAsk([true, true]);
  const result = await consentEach(ask, ["a/1", "b/2"], { mode });
  assert.equal(ask.calls.length, 0, "without a terminal there is nothing to ask");
  assert.deepEqual(result, { remove: [], keep: ["a/1", "b/2"] });
});

test("should exit 1 when a removal is refused", async () => {
  const ask = scriptedAsk([false]);
  const { keep } = await consentEach(ask, ["old-skill"], { mode: REMOVAL_ASK });
  assert.deepEqual(updateOutcome({ keptAbandoned: keep }), { exit: 1, divergent: ["old-skill"] });
  // Ordem abandonadas -> órfãs -> sem fonte, com item string e item objeto (nome em `name`).
  const mixed = updateOutcome({ keptAbandoned: keep, keptOrphans: [{ name: "orph" }], keptNoSource: ["src"] });
  assert.deepEqual(mixed, { exit: 1, divergent: ["old-skill", "orph", "src"] });
});

test("should exit 0 when nothing diverges", () => {
  assert.deepEqual(updateOutcome({}), { exit: 0, divergent: [] });
  assert.deepEqual(updateOutcome({ keptAbandoned: [], keptOrphans: [], keptNoSource: [] }), { exit: 0, divergent: [] });
});

test("should not count out-of-reach folders as divergence", () => {
  const found = orphanCandidates(orphanArgs({ "someone-elses": { "SKILL.md": UNMARKED } }));
  assert.equal(found.outOfReach.length, 1, "the folder is out of reach, so it is announced and never offered");
  assert.deepEqual(updateOutcome({ keptOrphans: found.candidates }), { exit: 0, divergent: [] });
});

test("should remove every candidate without asking when -y authorized it", async () => {
  const ask = scriptedAsk([]);
  const result = await consentEach(ask, ["a/x", "b/y"], { mode: REMOVAL_ASSUMED });
  assert.deepEqual(result, { remove: ["a/x", "b/y"], keep: [] });
  assert.equal(ask.calls.length, 0);
});

test("should stop at the first cancelled answer and remove nothing", async () => {
  const CANCEL = Symbol("cancel");
  const asked = [];
  const ask = {
    isCancel: (value) => value === CANCEL,
    confirm: async (opts) => {
      asked.push(opts.message);
      return asked.length === 2 ? CANCEL : true;
    },
  };
  assert.equal(await consentEach(ask, ["a/1", "b/2", "c/3"], { mode: REMOVAL_ASK }), CANCELLED);
  assert.equal(asked.length, 2, "a terceira pergunta nao pode ser feita depois do cancelamento");
});

// --- planUpdate / update (DT-9, DT-11, DT-17) ---

const priorBase = { engines: [ENGINE], language: null, architecture: null, optional: [], allSkills: false, userLanguage: "pt-BR" };

test("should leave the prior manifest byte-identical when remove throws on an orphan", () => {
  withRepo((repo) => {
    const dir = path.join(repo, ".claude", "skills");
    mkdirSync(path.join(dir, "ghost"), { recursive: true });
    writeFileSync(path.join(dir, "ghost", "SKILL.md"), markSkill("---\nname: ghost\n---\ncorpo\n", "ghost"), "utf8");
    writeManifest(coreDir("project", repo), { ...priorBase, scope: "project", skillsDirs: [".claude/skills"], skills: [] });
    const before = readFileSync(manifestPath(coreDir("project", repo)));
    const planned = planUpdate("project", repo);
    assert.deepEqual(planned.orphans.candidates.map((a) => a.name), ["ghost"]);
    const remove = () => { throw new Error("falha de remocao"); };
    assert.throws(() => applyUpdate(planned, { aRemover: planned.orphans.candidates, remove }), /falha de remocao/);
    assert.ok(readFileSync(manifestPath(coreDir("project", repo))).equals(before));
  });
});

test("should keep a custom skills dir on update", () => {
  withRepo((repo) => {
    writeManifest(coreDir("project", repo), { ...priorBase, engines: ["custom"], scope: "project", skillsDirs: ["custom/skills"], skills: [] });
    const { plan } = planUpdate("project", repo);
    assert.deepEqual(plan.engines, ["custom"]);
    assert.deepEqual(plan.targets.map((t) => [t.engine, t.dir]), [["custom", path.join(repo, "custom", "skills")]]);
  });
});

test("should list configure-agents as entering for a manifest that lacks it", () => {
  withRepo((repo) => {
    writeManifest(coreDir("project", repo), { ...priorBase, scope: "project", skillsDirs: [".claude/skills"], skills: ["spec-init"] });
    const { entering } = planUpdate("project", repo);
    assert.ok(entering.includes("configure-agents"));
    assert.ok(!entering.includes("spec-init"));
  });
});

test("should flag the config migration for a self-contained-runtime manifest", () => {
  withRepo((repo) => {
    writeManifest(coreDir("project", repo), { ...priorBase, model: MODEL_RUNTIME, scope: "project", skillsDirs: [".claude/skills"], skills: [] });
    assert.deepEqual(planUpdate("project", repo).migration, { runtime: false, config: true });
  });
});

test("should record the inferred choices of an old manifest so the next update offers no architecture removal", () => {
  withRepo((repo) => {
    const core = coreDir("project", repo);
    const archs = Object.values(catalog.ARCHITECTURES);
    writeManifest(core, {
      version: "0.0.1", scope: "project", engines: ["claude-code"], skillsDirs: [".claude/skills"],
      skills: [...catalog.CORE, ...archs, "evidence-capture"], architecture: "hexagonal",
    });
    const antigo = JSON.parse(readFileSync(manifestPath(core), "utf8"));
    delete antigo.optional;
    delete antigo.allSkills;
    writeFileSync(manifestPath(core), JSON.stringify(antigo), "utf8");

    const planned = planUpdate("project", repo, {});
    assert.equal(planned.plan.all, true);
    applyUpdate(planned, {});
    const gravado = JSON.parse(readFileSync(manifestPath(core), "utf8"));
    assert.equal(gravado.allSkills, true, "o manifesto seguinte tem de gravar o allSkills inferido");
    assert.ok(gravado.optional.includes("evidence-capture"), "e o optional inferido");

    const segundo = planUpdate("project", repo, {});
    assert.deepEqual(segundo.abandoned.map(({ name }) => name).filter((nome) => archs.includes(nome)), []);
  });
});

// --- update convergente por CLI: processo filho, fora de git, LC_ALL=C (CA-11, CA-13, CA-14, CA-15, CA-20) ---

const exec = promisify(execFile);
const MGR_BIN = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
const ORPHANS_FIXTURE = fileURLToPath(new URL("./fixtures/orfas-f0/", import.meta.url));
const REAL_ORPHANS = ["arch-hexagonal", "evidence-capture", "junit-clean"];
const CLI_TIMEOUT_MS = 120_000;
const DISTRIBUTED_EVIDENCE = "a name mgr-method ships, absent from the manifest and from mgr-skills.lock";
const MARK_PREFIX = "mgr-managed-skill";

// Roda o CLI como processo filho: sem TTY (stdin/stdout são pipes), LC_ALL=C e HOME temporário. Assíncrono
// de propósito: o servidor HTTP dos testes de plugin vive neste processo e não responderia a um spawnSync.
async function mgr(home, args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [MGR_BIN, ...args], {
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
      env: { ...process.env, LC_ALL: "C", LANG: "C", LANGUAGE: "", HOME: home },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

async function withProcessProject(fn) {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mgr-update-cli-"));
  const home = mkdtempSync(path.join(os.tmpdir(), "mgr-update-home-"));
  try {
    const git = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: repo, encoding: "utf8" });
    assert.notEqual(git.status, 0, "the project must live outside any git work tree");
    await fn({ repo, home });
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

async function installLayered(home, repo, extra = []) {
  const result = await mgr(home, ["install", "--engine", "claude-code", "--arch", "layered", "--project-id", "x", "-y", ...extra, repo]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
}

const skillsPath = (repo, ...parts) => path.join(repo, ".claude", "skills", ...parts);
const copyOrphan = (repo, name) => cpSync(path.join(ORPHANS_FIXTURE, name), skillsPath(repo, name), { recursive: true });
const orphanLine = (name) => `orphan offered for removal: ${path.join(".claude", "skills", name)} (${DISTRIBUTED_EVIDENCE})`;
const countOf = (text, needle) => text.split(needle).length - 1;

function declareSkill(repo, name) {
  const file = manifestPath(coreDir("project", repo));
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...manifest, skills: [...manifest.skills, name] }, null, 2) + "\n", "utf8");
}

const declaredSkills = (repo) => JSON.parse(readFileSync(manifestPath(coreDir("project", repo)), "utf8")).skills;

test("should exit 1 keeping a refused leaving skill declared without a terminal", async () => {
  await withProcessProject(async ({ repo, home }) => {
    await installLayered(home, repo);
    copyOrphan(repo, "arch-hexagonal");
    declareSkill(repo, "arch-hexagonal");

    const result = await mgr(home, ["update", repo]);
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /skill leaving: arch-hexagonal/);
    assert.match(result.stdout, /Still diverging from what v/);
    assert.match(result.stdout, /Still diverging from what v[^\n]*arch-hexagonal/, "the divergence names the skill that stayed");
    assert.ok(existsSync(skillsPath(repo, "arch-hexagonal", "SKILL.md")), "without consent nothing is removed");
    assert.ok(declaredSkills(repo).includes("arch-hexagonal"), "the refused skill stays declared");
  });
});

test("should remove the leaving skill with -y", async () => {
  await withProcessProject(async ({ repo, home }) => {
    await installLayered(home, repo);
    copyOrphan(repo, "arch-hexagonal");
    declareSkill(repo, "arch-hexagonal");

    const result = await mgr(home, ["update", "-y", repo]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /skill leaving: arch-hexagonal/);
    assert.equal(existsSync(skillsPath(repo, "arch-hexagonal")), false);
    assert.equal(declaredSkills(repo).includes("arch-hexagonal"), false);
    assert.doesNotMatch(result.stdout, /Still diverging from what v/);
  });
});

test("should offer each real orphan from orfas-f0 and keep them without a terminal", async () => {
  await withProcessProject(async ({ repo, home }) => {
    await installLayered(home, repo);
    for (const name of REAL_ORPHANS) copyOrphan(repo, name);

    const result = await mgr(home, ["update", repo]);
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.equal(countOf(result.stdout, "orphan offered for removal:"), 3);
    for (const name of REAL_ORPHANS) {
      assert.ok(result.stdout.includes(orphanLine(name)), `missing the offer line of ${name}`);
      assert.ok(existsSync(skillsPath(repo, name, "SKILL.md")), `${name} must stay without consent`);
    }
    assert.match(result.stdout, /Still diverging from what v/);
  });
});

test("should remove the three real orphans with -y and leave doctor without orphan-skill", async () => {
  await withProcessProject(async ({ repo, home }) => {
    await installLayered(home, repo);
    for (const name of REAL_ORPHANS) copyOrphan(repo, name);
    const checksOf = async () => JSON.parse((await mgr(home, ["doctor", repo, "--json"])).stdout).findings.map((f) => f.check);
    assert.ok((await checksOf()).includes("orphan-skill"), "before the update doctor must see the orphans");

    const result = await mgr(home, ["update", "-y", repo]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    for (const name of REAL_ORPHANS) assert.equal(existsSync(skillsPath(repo, name)), false, `${name} must be removed`);
    assert.equal((await checksOf()).includes("orphan-skill"), false);
  });
});

test("should apply no yes no to the real orphans removing only the second", async () => {
  await withProcessProject(async ({ repo, home }) => {
    await installLayered(home, repo);
    for (const name of REAL_ORPHANS) copyOrphan(repo, name);

    const planned = planUpdate("project", repo);
    const candidates = planned.orphans.candidates;
    assert.equal(candidates.length, 3);
    const rels = candidates.map((c) => path.relative(repo, c.path));
    const ask = scriptedAsk([false, true, false]);
    const decision = await consentEach(ask, rels, { mode: REMOVAL_ASK });
    assert.equal(ask.calls.length, 3);
    assert.ok(ask.calls.every((c) => c.initialValue === false), "no is the default of every question");
    assert.deepEqual(decision, { remove: [rels[1]], keep: [rels[0], rels[2]] });

    const approved = new Set(decision.remove.map((rel) => path.join(repo, rel)));
    const { aRemover, mantidas, keptOrphans } = partitionConsent(planned, approved);
    applyUpdate(planned, { aRemover, mantidas });
    assert.equal(updateOutcome({ keptAbandoned: mantidas, keptOrphans }).exit, 1);
    assert.equal(existsSync(candidates[1].path), false, "the second one answered yes");
    assert.ok(existsSync(candidates[0].path), "the first one answered no");
    assert.ok(existsSync(candidates[2].path), "the third one answered no");
  });
});

// Plugins servidos por node:http local (precedente: test/mgr.test.js, "install e update restauram o conjunto
// travado"). `dirs` são as pastas; cada uma vira um plugin `@mgr/<dir>` travado no mgr-skills.lock.
function pluginOf(dir) {
  const description = `Standardizes the ${dir} behaviour of a project following strict quality rules.`;
  const manifest = {
    name: `@mgr/${dir}`, version: "1.0.0", author: "Mauri Reis", description,
    category: "language", permissions: ["read-files"], model: { "claude-code": "sonnet" }, effort: "medium",
  };
  const skillMd = `---\nname: ${dir}\ndescription: ${description}\n---\n\n# ${dir}\n`;
  const contents = [
    { path: "SKILL.md", content: Buffer.from(skillMd, "utf8") },
    { path: "mgr-manifest.json", content: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
  ];
  return { dir, manifest, contents };
}

async function withPluginServer(dirs, fn) {
  const plugins = dirs.map(pluginOf);
  let index = null;
  const server = createServer((request, response) => {
    if (request.url === "/index.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(index));
      return;
    }
    const hit = plugins.flatMap((p) => p.contents.map((file) => ({ p, file })))
      .find(({ p, file }) => request.url === `/${p.dir}/${file.path}`);
    if (!hit) { response.statusCode = 404; response.end("not found"); return; }
    response.end(hit.file.content);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const entries = plugins.map((p) => ({
      name: p.manifest.name, version: "1.0.0", description: p.manifest.description,
      checksum: aggregateChecksum(p.contents),
      files: p.contents.map((file) => ({ path: file.path, url: `${base}/${p.dir}/${file.path}`, sha256: sha256(file.content) })),
    }));
    index = { indexVersion: 1, registry: "mgr", generatedAt: "2026-07-21T00:00:00.000Z", categories: { language: entries } };
    const lockfile = {
      lockfileVersion: 1,
      registries: { mgr: { url: `${base}/index.json`, trusted: true } },
      skills: Object.fromEntries(plugins.map((p, i) => [p.manifest.name, {
        version: "1.0.0", registry: "mgr", checksum: entries[i].checksum, category: "language", dir: p.dir,
        engines: ["claude-code"], applied: { "claude-code": { model: "sonnet", effort: "medium" } },
      }])),
    };
    await fn({ lockfile });
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

const writeLockfile = (repo, lockfile) => writeFileSync(path.join(repo, "mgr-skills.lock"), JSON.stringify(lockfile, null, 2) + "\n", "utf8");

test("should never offer a locked plugin, a locked dir nor an unknown folder", async () => {
  await withPluginServer(["meu-plugin", "junit-clean"], async ({ lockfile }) => {
    await withProcessProject(async ({ repo, home }) => {
      writeLockfile(repo, lockfile);
      await installLayered(home, repo);
      assert.ok(existsSync(skillsPath(repo, "meu-plugin", "mgr-manifest.json")), "the plugin was restored by the install");

      // `junit-clean` volta a ser a órfã real: sem mgr-manifest.json, só o `dir` do lockfile a protege.
      rmSync(skillsPath(repo, "junit-clean"), { recursive: true, force: true });
      copyOrphan(repo, "junit-clean");
      assert.equal(existsSync(skillsPath(repo, "junit-clean", "mgr-manifest.json")), false);
      mkdirSync(skillsPath(repo, "minha-skill"), { recursive: true });
      writeFileSync(skillsPath(repo, "minha-skill", "SKILL.md"), "---\nname: minha-skill\ndescription: mine\n---\ncorpo\n", "utf8");

      const result = await mgr(home, ["update", "-y", repo]);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.doesNotMatch(result.stdout, /orphan offered for removal:/);
      const reach = result.stdout.split("\n").find((line) => line.startsWith("out of reach, origin unknown (not offered):"));
      assert.ok(reach, `no out-of-reach line in: ${result.stdout}`);
      for (const name of ["meu-plugin", "junit-clean", "minha-skill"]) {
        assert.ok(reach.includes(path.join(".claude", "skills", name)), `${name} must be listed as out of reach`);
        assert.ok(existsSync(skillsPath(repo, name, "SKILL.md")), `${name} must stay on disk`);
      }
      assert.doesNotMatch(result.stdout, /Still diverging from what v/);
    });
  });
});

test("should not mark a plugin SKILL.md", async () => {
  await withPluginServer(["meu-plugin", "junit-clean"], async ({ lockfile }) => {
    await withProcessProject(async ({ repo, home }) => {
      writeLockfile(repo, lockfile);
      await installLayered(home, repo);
      const marked = (name) => readFileSync(skillsPath(repo, name, "SKILL.md"), "utf8").includes(MARK_PREFIX);

      assert.equal(marked("meu-plugin"), false, "after install");
      assert.equal(marked("junit-clean"), false, "after install");
      const result = await mgr(home, ["update", repo]);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.equal(marked("meu-plugin"), false, "after update");
      assert.equal(marked("junit-clean"), false, "after update");
      assert.ok(marked("spec-init"), "control: a skill of the method does carry the mark");
    });
  });
});

test("should keep skills in the custom dir and create no .claude/skills on update", async () => {
  await withProcessProject(async ({ repo, home }) => {
    const customDir = path.join(repo, "minhas-skills");
    const installed = await mgr(home, ["install", "--skills-dir", customDir, "--arch", "layered", "--project-id", "x", "-y", repo]);
    assert.equal(installed.code, 0, installed.stdout + installed.stderr);
    assert.ok(existsSync(path.join(customDir, "spec-init", "SKILL.md")));

    const result = await mgr(home, ["update", repo]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const { engines } = JSON.parse(readFileSync(manifestPath(coreDir("project", repo)), "utf8"));
    assert.deepEqual(engines, ["custom"]);
    assert.ok(existsSync(path.join(customDir, "spec-init", "SKILL.md")), "the custom dir keeps its skills");
    assert.equal(existsSync(path.join(repo, ".claude", "skills")), false, "update must not create the claude-code dir");
  });
});

// --- pasta ocupada por skill que entra (X-19, E-1) e particao do consentimento no nucleo (S-1) ---

const ENTERING = "configure-agents";

// Simula a instalacao antiga que nao declarava `ENTERING`: some do manifesto e do disco.
function undeclareEntering(repo) {
  const file = manifestPath(coreDir("project", repo));
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...manifest, skills: manifest.skills.filter((n) => n !== ENTERING) }, null, 2) + "\n", "utf8");
  rmSync(skillsPath(repo, ENTERING), { recursive: true, force: true });
}

test("should keep a hand-written folder named like an entering skill without consent", async () => {
  await withProcessProject(async ({ repo, home }) => {
    await installLayered(home, repo);
    undeclareEntering(repo);
    const own = "---\nname: configure-agents\ndescription: minha\n---\ncorpo do usuario\n";
    mkdirSync(skillsPath(repo, ENTERING), { recursive: true });
    writeFileSync(skillsPath(repo, ENTERING, "SKILL.md"), own, "utf8");

    const result = await mgr(home, ["update", repo]);
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.equal(readFileSync(skillsPath(repo, ENTERING, "SKILL.md"), "utf8"), own);
    assert.equal(declaredSkills(repo).includes(ENTERING), false);
  });
});

test("should never replace a locked plugin folder named like an entering skill", async () => {
  await withProcessProject(async ({ repo, home }) => {
    await installLayered(home, repo);
    undeclareEntering(repo);
    const own = "---\nname: configure-agents\ndescription: plugin\n---\ncorpo do plugin\n";
    mkdirSync(skillsPath(repo, ENTERING), { recursive: true });
    writeFileSync(skillsPath(repo, ENTERING, "SKILL.md"), own, "utf8");
    writeFileSync(skillsPath(repo, ENTERING, "mgr-manifest.json"), "{}", "utf8");

    for (const args of [["update", repo], ["update", "-y", repo]]) {
      const result = await mgr(home, args);
      assert.equal(result.code, 1, `${args.join(" ")}: ${result.stdout}${result.stderr}`);
      assert.equal(readFileSync(skillsPath(repo, ENTERING, "SKILL.md"), "utf8"), own);
      assert.equal(existsSync(skillsPath(repo, ENTERING, "mgr-manifest.json")), true);
      assert.equal(declaredSkills(repo).includes(ENTERING), false);
      // X-26 (L-11): a bloqueada não aparece como "entrando" e ganha a sua linha.
      assert.doesNotMatch(result.stdout, new RegExp(`skill entering: ${ENTERING}\\b`));
      assert.match(result.stdout, new RegExp(`kept \\.claude/skills/${ENTERING}: a plugin owns that folder, so ${ENTERING} was not installed`));
    }
  });
});

test("should announce a hook command to rewrite before writing it", async () => {
  await withProcessProject(async ({ repo, home }) => {
    await installLayered(home, repo);
    const file = path.join(repo, ".claude", "settings.local.json");
    const settings = JSON.parse(readFileSync(file, "utf8"));
    settings.hooks.SessionStart = [{ matcher: "startup", hooks: [{ type: "command", command: 'node "/velho/mgr.js" detect --hook claude-code # mgr-session-hook', timeout: 5 }] }];
    writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", "utf8");

    const result = await mgr(home, ["update", repo]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const anuncio = result.stdout.indexOf("hook command to rewrite in .claude/settings.local.json: SessionStart");
    const gravado = result.stdout.indexOf("hooks written to .claude/settings.local.json: SessionStart");
    assert.ok(anuncio >= 0, result.stdout);
    assert.ok(gravado > anuncio, "o anúncio vem ANTES da gravação (LOG-1)");
  });
});

// Disco real em mkdtemp (TST-2): cada pasta de skill com os arquivos dados.
function writeSkillFolders(dir, folders) {
  for (const [folder, files] of Object.entries(folders)) {
    mkdirSync(path.join(dir, folder), { recursive: true });
    for (const [file, text] of Object.entries(files)) writeFileSync(path.join(dir, folder, file), text, "utf8");
  }
}

test("should classify an occupied folder as own, blocked or replaceable by what the disk proves", () => {
  withRepo((repo) => {
    const dir = path.join(repo, "skills");
    writeSkillFolders(dir, {
      marcada: { "SKILL.md": markSkill(UNMARKED, "marcada") },
      travada: { "SKILL.md": UNMARKED },
      livre: { "SKILL.md": UNMARKED },
    });
    const plan = { scope: "project", repo, skills: ["marcada", "travada", "livre"], targets: [{ engine: ENGINE, dir }] };
    const lockfile = { skills: { "pub/travada": { dir: "travada" } } };
    const result = occupiedFolders({ plan, entering: ["marcada", "travada", "livre"], lockfile });
    assert.deepEqual(result, {
      replaceable: [{ name: "livre", dir, path: path.join(dir, "livre") }],
      blocked: [{ name: "travada", dir, path: path.join(dir, "travada") }],
    });
  });
});

test("should block a declared skill whose folder carries mgr-manifest.json and leave the other declared ones alone", () => {
  withRepo((repo) => {
    const dir = path.join(repo, "skills");
    writeSkillFolders(dir, {
      cedida: { "SKILL.md": UNMARKED, "mgr-manifest.json": "{}" },
      comum: { "SKILL.md": UNMARKED },
    });
    const plan = { scope: "project", repo, skills: ["cedida", "comum"], targets: [{ engine: ENGINE, dir }] };
    const result = occupiedFolders({ plan, entering: [], declared: ["cedida", "comum"], lockfile: null });
    assert.deepEqual(result, { replaceable: [], blocked: [{ name: "cedida", dir, path: path.join(dir, "cedida") }] });
  });
});

test("should leave an approved replacement in and a refused one out of the skipped names", () => {
  withRepo((repo) => {
    const dir = path.join(repo, "skills");
    const item = { name: "livre", dir, path: path.join(dir, "livre") };
    const planned = { abandoned: [], orphans: { candidates: [] }, occupied: { replaceable: [item], blocked: [] } };

    const approved = partitionConsent(planned, new Set([item.path]));
    assert.deepEqual(approved.declinedReplacements, []);
    assert.deepEqual(skippedByConsent(planned, approved), []);

    const refused = partitionConsent(planned, new Set());
    assert.deepEqual(refused.declinedReplacements, [item]);
    assert.deepEqual(skippedByConsent(planned, refused), ["livre"]);
  });
});

test("should list a blocked folder among the skipped names even when everything else is approved", () => {
  withRepo((repo) => {
    const dir = path.join(repo, "skills");
    const blocked = { name: "travada", dir, path: path.join(dir, "travada") };
    const planned = { abandoned: [], orphans: { candidates: [] }, occupied: { replaceable: [], blocked: [blocked] } };
    assert.deepEqual(skippedByConsent(planned, partitionConsent(planned, new Set([blocked.path]))), ["travada"]);
  });
});

test("should replace an unmarked folder named like an entering skill with -y and declare the name", async () => {
  await withProcessProject(async ({ repo, home }) => {
    await installLayered(home, repo);
    const pacote = readFileSync(skillsPath(repo, ENTERING, "SKILL.md"), "utf8");
    undeclareEntering(repo);
    mkdirSync(skillsPath(repo, ENTERING), { recursive: true });
    writeFileSync(skillsPath(repo, ENTERING, "SKILL.md"), "---\nname: configure-agents\ndescription: minha\n---\ncorpo do usuario\n", "utf8");

    const result = await mgr(home, ["update", "-y", repo]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(readFileSync(skillsPath(repo, ENTERING, "SKILL.md"), "utf8"), pacote, "the content becomes the package's");
    assert.ok(declaredSkills(repo).includes(ENTERING), "the name stays declared");
  });
});

test("should never overwrite a declared skill whose folder carries mgr-manifest.json, not even with -y", async () => {
  await withProcessProject(async ({ repo, home }) => {
    await installLayered(home, repo);
    const own = "---\nname: spec-init\ndescription: plugin\n---\ncorpo do plugin\n";
    writeFileSync(skillsPath(repo, "spec-init", "SKILL.md"), own, "utf8");
    writeFileSync(skillsPath(repo, "spec-init", "mgr-manifest.json"), "{}", "utf8");

    for (const args of [["update", repo], ["update", "-y", repo]]) {
      const result = await mgr(home, args);
      assert.equal(readFileSync(skillsPath(repo, "spec-init", "SKILL.md"), "utf8"), own, `${args.join(" ")}: ${result.stdout}${result.stderr}`);
      assert.equal(existsSync(skillsPath(repo, "spec-init", "mgr-manifest.json")), true);
    }
  });
});

test("should keep the refused orphans byte for byte and out of the manifest when answering no yes no", async () => {
  await withProcessProject(async ({ repo, home }) => {
    await installLayered(home, repo);
    for (const name of REAL_ORPHANS) copyOrphan(repo, name);
    const before = REAL_ORPHANS.map((name) => readFileSync(skillsPath(repo, name, "SKILL.md")));

    const planned = planUpdate("project", repo);
    const items = consentItems(planned);
    assert.equal(items.length, 3);
    assert.ok(items.every((entry) => entry.kind === "orphan"));
    const answers = [false, true, false];
    const approved = new Set(items.filter((_, i) => answers[i]).map((entry) => entry.item.path));
    const part = partitionConsent(planned, approved);
    assert.deepEqual(part.aRemover.map((x) => x.path), [items[1].item.path]);
    assert.deepEqual(part.keptOrphans.map((x) => x.path), [items[0].item.path, items[2].item.path]);
    assert.deepEqual(part.mantidas, []);

    applyUpdate(planned, { aRemover: part.aRemover, mantidas: part.mantidas, skipEntering: part.declinedReplacements.map((x) => x.name) });

    for (const { item } of [items[0], items[2]]) {
      assert.ok(readFileSync(path.join(item.path, "SKILL.md")).equals(before[REAL_ORPHANS.indexOf(item.name)]), `${item.name} must stay byte for byte`);
      assert.equal(declaredSkills(repo).includes(item.name), false, `${item.name} must stay out of the manifest`);
    }
    assert.equal(existsSync(items[1].item.path), false);
    assert.equal(updateOutcome({ keptAbandoned: part.mantidas, keptOrphans: part.keptOrphans }).exit, 1);
  });
});

test("should never touch an abandoned declared skill whose folder carries mgr-manifest.json, in any consent mode", async () => {
  await withProcessProject(async ({ repo, home }) => {
    await installLayered(home, repo);
    const plugin = "---\nname: arch-hexagonal\ndescription: plugin\n---\nCONTEUDO DO PLUGIN\n";
    mkdirSync(skillsPath(repo, "arch-hexagonal"), { recursive: true });
    writeFileSync(skillsPath(repo, "arch-hexagonal", "SKILL.md"), plugin, "utf8");
    writeFileSync(skillsPath(repo, "arch-hexagonal", "mgr-manifest.json"), "{}", "utf8");
    declareSkill(repo, "arch-hexagonal");

    // Modo "nao": o nucleo nao oferece a pasta, entao nao ha o que recusar nem o que devolver ao plano.
    const planned = planUpdate("project", repo, {});
    assert.equal(consentItems(planned).some(({ item }) => item.name === "arch-hexagonal"), false);
    assert.ok(planned.orphans.outOfReach.some((fora) => fora.name === "arch-hexagonal"));
    assert.equal(planned.abandoned.some((saindo) => saindo.name === "arch-hexagonal"), false);

    for (const args of [["update", repo], ["update", "-y", repo]]) {
      const result = await mgr(home, args);
      assert.equal(result.code, 0, `${args.join(" ")}: ${result.stdout}${result.stderr}`);
      assert.equal(readFileSync(skillsPath(repo, "arch-hexagonal", "SKILL.md"), "utf8"), plugin, args.join(" "));
      assert.equal(existsSync(skillsPath(repo, "arch-hexagonal", "mgr-manifest.json")), true, args.join(" "));
      assert.match(result.stdout, /out of reach, origin unknown \(not offered\): [^\n]*\.claude\/skills\/arch-hexagonal/);
      assert.doesNotMatch(result.stdout, /skill leaving: arch-hexagonal/);
      assert.equal(declaredSkills(repo).includes("arch-hexagonal"), false, "a versão não a seleciona e o método deixa de declará-la");
    }
  });
});

test("should block a locked folder even when it carries its own ownership mark, and offer a folder without SKILL.md", () => {
  withRepo((repo) => {
    const dir = path.join(repo, "skills");
    writeSkillFolders(dir, {
      "travada-marcada": { "SKILL.md": markSkill(UNMARKED, "travada-marcada") },
      "sem-skill-md": { "LEIAME.txt": "outra coisa" },
    });
    const plan = { scope: "project", repo, skills: ["travada-marcada", "sem-skill-md"], targets: [{ engine: ENGINE, dir }] };
    const lockfile = { skills: { "pub/travada": { dir: "travada-marcada" } } };
    const result = occupiedFolders({ plan, entering: ["travada-marcada", "sem-skill-md"], lockfile });
    // MC/DC da guarda (review final, ST-6): `!bloqueada` decide sozinho na primeira, `exists(SKILL.md)` na segunda.
    assert.deepEqual(result, {
      replaceable: [{ name: "sem-skill-md", dir, path: path.join(dir, "sem-skill-md") }],
      blocked: [{ name: "travada-marcada", dir, path: path.join(dir, "travada-marcada") }],
    });
  });
});

test("should not build in a custom skills dir a skill ceded to a plugin in any engine, leaving the plugin folder intact", () => {
  withRepo((repo) => {
    const dir = path.join(repo, "minhas-skills");
    execute(planInstall(["claude-code"], "project", repo, { skillsDir: dir }));
    const plugin = "---\nname: diagnosing-bugs\ndescription: plugin\n---\nPLUGIN\n";
    writeFileSync(path.join(dir, "diagnosing-bugs", "SKILL.md"), plugin, "utf8");
    writeFileSync(path.join(dir, "diagnosing-bugs", "mgr-manifest.json"), "{}", "utf8");

    // `replaced` chaveado pelo motor REAL, como o lockfile grava; o alvo `custom` usa a união.
    const planned = planUpdate("project", repo, { replaced: { "claude-code": { "diagnosing-bugs": "@reg/diagnosing-bugs" } } });
    assert.equal(planned.plan.targets[0].engine, "custom");
    assert.equal(planned.plan.targets[0].skills.includes("diagnosing-bugs"), false);
    applyUpdate(planned, {});
    assert.equal(readFileSync(path.join(dir, "diagnosing-bugs", "SKILL.md"), "utf8"), plugin);
    assert.equal(existsSync(path.join(dir, "diagnosing-bugs", "mgr-manifest.json")), true);
  });
});

test("should keep a plugin folder when migrating a runtime-launcher install", () => {
  withRepo((repo) => {
    const core = coreDir("project", repo);
    const skills = path.join(repo, ".claude", "skills");
    mkdirSync(path.join(skills, "spec-create"), { recursive: true });
    writeFileSync(path.join(skills, "spec-create", "SKILL.md"), "---\nname: spec-create\ndescription: plugin\n---\nPLUGIN\n", "utf8");
    writeFileSync(path.join(skills, "spec-create", "mgr-manifest.json"), "{}", "utf8");
    mkdirSync(path.join(skills, "spec-init"), { recursive: true });
    writeFileSync(path.join(skills, "spec-init", "SKILL.md"), "lancador antigo", "utf8");
    writeManifest(core, { version: "0.1.0", scope: "project", engines: ["claude-code"], skillsDirs: [".claude/skills"], skills: ["spec-create", "spec-init"] });
    const manifesto = JSON.parse(readFileSync(manifestPath(core), "utf8"));
    writeFileSync(manifestPath(core), JSON.stringify({ ...manifesto, model: "runtime-launcher" }), "utf8");

    const { removed } = migrateOld("project", repo);
    assert.equal(existsSync(path.join(skills, "spec-create", "mgr-manifest.json")), true, "pasta de plugin não é lançador");
    assert.ok(removed.some((p) => p.endsWith(path.join(".claude", "skills", "spec-init"))), "o lançador antigo sai");
  });
});
