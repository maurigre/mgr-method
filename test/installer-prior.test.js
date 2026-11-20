import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { COMMAND, effectiveInstallChoices, migrateOld, needsConfigMigration, previousForQuestions, readPrior, resolvePrior, runtimeMigration } from "../src/installer.js";
import { MODEL_CORE_RUNTIME, MODEL_LAYERED, MODEL_RUNTIME, RESOLVED_DECLARATIONS, manifestShapeProblems } from "../src/manifest.js";
import { UsageError, renderError } from "../src/errors.js";
import { getMessages } from "../src/messages.js";
import { text } from "../src/ui-text.js";
import * as catalog from "../src/catalog.js";
import { tempDir } from "../scripts/lib/tmp.mjs";

const REPO = path.join(path.sep, "repo-ficticio-sem-disco");
const MANIFEST_FILE = "manifest.json";
const [ARCH_A, ARCH_B] = catalog.architectures();
const CLAUDE_DIR = ".claude/skills";
const COPILOT_DIR = ".github/skills";

const validManifest = (extra = {}) => ({
  scope: "project",
  engines: ["claude-code"],
  skills: [],
  skillsDirs: [CLAUDE_DIR],
  architecture: ARCH_A,
  language: "java",
  userLanguage: "en",
  optional: ["evidence-capture"],
  allSkills: false,
  ...extra,
});

const withoutKeys = (manifest, ...keys) => {
  const copy = { ...manifest };
  for (const key of keys) delete copy[key];
  return copy;
};

const readOf = (manifest) => ({ state: "read", manifest, problems: manifestShapeProblems(manifest).filter((p) => p.field !== "skills") });

const resolve = (manifest, options = {}) =>
  resolvePrior(readOf(manifest), { scope: "project", repo: REPO, localeLanguage: "en", command: COMMAND.INSTALL, ...options });

const refusalOf = (action) => {
  try {
    action();
  } catch (error) {
    return error;
  }
  return assert.fail("a recusa nao aconteceu");
};

const FIELDS = [
  { field: "engines", valid: ["claude-code"], explicit: ["copilot"], broken: 7 },
  { field: "architecture", valid: ARCH_A, explicit: ARCH_B, broken: "mvc" },
  { field: "language", valid: "java", explicit: "go", broken: 7 },
  { field: "userLanguage", valid: "en", explicit: "pt-BR", broken: 7 },
  { field: "optional", valid: ["evidence-capture"], explicit: [], broken: "x" },
  { field: "allSkills", valid: false, explicit: true, broken: "yes" },
];

for (const { field, valid, explicit } of FIELDS) {
  test(`should inherit ${field} from the valid previous manifest when nothing is explicit`, () => {
    assert.deepEqual(resolve(validManifest({ [field]: valid })).declarations[field], valid);
  });

  test(`should let the explicit ${field} win over the valid previous value`, () => {
    assert.deepEqual(resolve(validManifest({ [field]: valid }), { explicit: { [field]: explicit } }).declarations[field], explicit);
  });
}

for (const { field, explicit, broken } of FIELDS) {
  test(`should refuse an out-of-shape ${field} that nothing explicit or asked covers`, () => {
    const error = refusalOf(() => resolve(validManifest({ [field]: broken })));
    assert.ok(error instanceof UsageError);
    assert.equal(error.key, "manifestRefused");
    assert.deepEqual(error.params, [MANIFEST_FILE]);
    assert.ok(error.details.length >= 2);
  });

  test(`should accept the explicit ${field} over an out-of-shape previous value`, () => {
    const result = resolve(validManifest({ [field]: broken }), { explicit: { [field]: explicit } });
    assert.deepEqual(result.declarations[field], explicit);
  });
}

for (const { field, broken } of FIELDS.filter((entry) => entry.field !== "allSkills")) {
  test(`should not refuse an out-of-shape ${field} when the question asked covers it`, () => {
    assert.doesNotThrow(() => resolve(validManifest({ [field]: broken }), { asked: [field] }));
  });
}

test("should leave a field the question will answer out of the declarations", () => {
  const { declarations } = resolve(validManifest({ architecture: "mvc" }), { asked: ["architecture"] });
  assert.equal("architecture" in declarations, false);
});

test("should keep refusing an uncovered field when another field is asked", () => {
  const error = refusalOf(() => resolve(validManifest({ architecture: "mvc", language: 7 }), { asked: ["architecture"] }));
  assert.deepEqual(error.details[0], text("manifestProblemNotText", "language", "number"));
});

test("should inherit a null architecture and a null language as null", () => {
  const { declarations } = resolve(validManifest({ architecture: null, language: null }));
  assert.equal(declarations.architecture, null);
  assert.equal(declarations.language, null);
});

test("should declare null architecture and language when the legacy manifest has none", () => {
  const { declarations } = resolve(withoutKeys(validManifest(), "architecture", "language"));
  assert.equal(declarations.architecture, null);
  assert.equal(declarations.language, null);
});

test("should infer optional from the recorded skills when the legacy manifest has no optional", () => {
  const manifest = withoutKeys(validManifest({ skills: [...catalog.CORE, "evidence-capture"] }), "optional");
  assert.deepEqual(resolve(manifest).declarations.optional, ["evidence-capture"]);
});

test("should infer allSkills true when the legacy manifest records the four architectures", () => {
  const skills = [...catalog.CORE, ...Object.values(catalog.ARCHITECTURES)];
  assert.equal(resolve(withoutKeys(validManifest({ skills }), "allSkills")).declarations.allSkills, true);
});

test("should infer allSkills false when the legacy manifest records fewer architectures", () => {
  const skills = [...catalog.CORE, ...Object.values(catalog.ARCHITECTURES).slice(1)];
  assert.equal(resolve(withoutKeys(validManifest({ skills }), "allSkills")).declarations.allSkills, false);
});

test("should declare the legacy pt-BR userLanguage when the manifest has none, whatever the locale", () => {
  const { declarations } = resolve(withoutKeys(validManifest(), "userLanguage"), { localeLanguage: "en" });
  assert.equal(declarations.userLanguage, "pt-BR");
});

test("should declare the legacy pt-BR userLanguage when the manifest records null", () => {
  assert.equal(resolve(validManifest({ userLanguage: null }), { localeLanguage: "en" }).declarations.userLanguage, "pt-BR");
});

test("should declare the legacy pt-BR userLanguage when the manifest records an empty text", () => {
  assert.equal(resolve(validManifest({ userLanguage: "" }), { localeLanguage: "en" }).declarations.userLanguage, "pt-BR");
});

test("should keep a recorded userLanguage over the locale", () => {
  assert.equal(resolve(validManifest({ userLanguage: "en" }), { localeLanguage: "pt-BR" }).declarations.userLanguage, "en");
});

test("should declare the defaults and the locale when there is no previous installation", () => {
  const result = resolvePrior({ state: "absent" }, { scope: "project", repo: REPO, localeLanguage: "pt-BR", command: COMMAND.INSTALL });
  assert.equal(result.prior, null);
  assert.deepEqual(result.repairs, []);
  assert.deepEqual(result.declarations, {
    engines: ["claude-code"], architecture: null, language: null, userLanguage: "pt-BR", optional: [], allSkills: false,
  });
});

test("should let the explicit values win over the defaults when there is no previous installation", () => {
  const explicit = { engines: ["custom"], skillsDirs: ["minhas-skills"], architecture: "layered", language: "java", userLanguage: "en", allSkills: true };
  const result = resolvePrior({ state: "absent" }, { scope: "project", repo: REPO, localeLanguage: "pt-BR", command: COMMAND.INSTALL, explicit });
  assert.equal(result.prior, null);
  assert.deepEqual(result.declarations, { ...explicit, optional: [] });
});

test("should refuse empty engines without a legacy engine and name the empty-engines problem", () => {
  const error = refusalOf(() => resolve(validManifest({ engines: [] })));
  assert.equal(error.key, "manifestRefused");
  assert.deepEqual(error.details[0], text("manifestProblemEmptyEngines"));
});

test("should point the install refusal for empty engines at the engine flag", () => {
  const error = refusalOf(() => resolve(validManifest({ engines: [] }), { command: COMMAND.INSTALL }));
  assert.deepEqual(error.details.at(-1), text("manifestRefusedOrFlags", "--engine"));
});

test("should point the update refusal for empty engines at install with the engine flag", () => {
  const error = refusalOf(() => resolve(validManifest({ engines: [] }), { command: COMMAND.UPDATE }));
  assert.deepEqual(error.details.at(-1), text("manifestRefusedOrInstall", "--engine"));
});

test("should inherit the legacy engine when engines is empty and engine is copilot", () => {
  const result = resolve(validManifest({ engines: [], engine: "copilot" }));
  assert.deepEqual(result.declarations.engines, ["copilot"]);
  assert.deepEqual(result.prior.skillsDirs, [COPILOT_DIR]);
});

test("should fall back to the legacy engine when engines is absent", () => {
  const manifest = withoutKeys(validManifest({ engine: "copilot" }), "engines");
  assert.deepEqual(resolve(manifest).declarations.engines, ["copilot"]);
});

test("should fall back to claude-code when engines and engine are both absent", () => {
  assert.deepEqual(resolve(withoutKeys(validManifest(), "engines")).declarations.engines, ["claude-code"]);
});

test("should keep two recorded engines and recompute both directories", () => {
  const result = resolve(validManifest({ engines: ["claude-code", "copilot"], skillsDirs: ["x"] }));
  assert.deepEqual(result.declarations.engines, ["claude-code", "copilot"]);
  assert.deepEqual(result.prior.skillsDirs, [CLAUDE_DIR, COPILOT_DIR]);
});

test("should recompute skillsDirs from the effective engines when skillsDirs is a text", () => {
  const result = resolve(validManifest({ skillsDirs: "x" }));
  assert.deepEqual(result.prior.skillsDirs, [CLAUDE_DIR]);
  assert.deepEqual(result.repairs, [{ field: "skillsDirs", kind: "container", expected: "array-of-strings", found: "string" }]);
});

test("should recompute skillsDirs from the effective engines when an element is not a text", () => {
  const result = resolve(validManifest({ skillsDirs: [1] }));
  assert.deepEqual(result.prior.skillsDirs, [CLAUDE_DIR]);
  assert.deepEqual(result.repairs,
    [{ field: "skillsDirs", kind: "element", expected: "array-of-strings", found: "non-string-element", position: 0 }]);
});

test("should recompute a well-formed skillsDirs that points outside the engine directory", () => {
  const result = resolve(validManifest({ skillsDirs: ["../isca"] }));
  assert.deepEqual(result.prior.skillsDirs, [CLAUDE_DIR]);
  assert.deepEqual(result.repairs, []);
});

test("should recompute skillsDirs from the previous engines even when other engines are explicit", () => {
  const result = resolve(validManifest({ skillsDirs: 7 }), { explicit: { engines: ["copilot"] } });
  assert.deepEqual(result.prior.skillsDirs, [CLAUDE_DIR]);
  assert.deepEqual(result.declarations.engines, ["copilot"]);
});

test("should recompute skillsDirs from the explicit engines when the previous engines cannot be known", () => {
  const result = resolve(validManifest({ engines: 7, skillsDirs: 7 }), { explicit: { engines: ["copilot"] } });
  assert.deepEqual(result.prior.skillsDirs, [COPILOT_DIR]);
});

test("should recompute skillsDirs as absolute engine directories in the global scope", () => {
  const result = resolve(validManifest({ scope: "global" }), { scope: "global" });
  assert.deepEqual(result.prior.skillsDirs, [path.join(os.homedir(), CLAUDE_DIR)]);
});

test("should announce an invalid scope as a repair and normalize it to the resolved scope", () => {
  const result = resolve(validManifest({ scope: "bogus" }));
  assert.deepEqual(result.repairs.map((repair) => repair.field), ["scope"]);
  assert.equal(result.prior.scope, "project");
});

test("should drop agents out of shape from the prior and announce the repair", () => {
  const result = resolve(validManifest({ agents: 7 }));
  assert.equal("agents" in result.prior, false);
  assert.deepEqual(result.repairs.map((repair) => repair.field), ["agents"]);
});

test("should drop agentsDirs out of shape from the prior and announce the repair", () => {
  const result = resolve(validManifest({ agentsDirs: "x" }));
  assert.equal("agentsDirs" in result.prior, false);
  assert.deepEqual(result.repairs.map((repair) => repair.field), ["agentsDirs"]);
});

test("should keep agents and agentsDirs in shape and announce no repair", () => {
  const result = resolve(validManifest({ agents: ["a"], agentsDirs: [".claude/agents"] }));
  assert.deepEqual(result.prior.agents, ["a"]);
  assert.deepEqual(result.prior.agentsDirs, [".claude/agents"]);
  assert.deepEqual(result.repairs, []);
});

test("should not refuse a derived field out of shape", () => {
  assert.doesNotThrow(() => resolve(validManifest({ skillsDirs: 7, scope: "bogus", agents: 7 }), { command: COMMAND.UNINSTALL }));
});

test("should list the refusal details in the DT-8 order with the flag line of the install", () => {
  const error = refusalOf(() => resolve(validManifest({ architecture: "mvc", language: 7 }), { command: COMMAND.INSTALL }));
  assert.deepEqual(error.details, [
    text("manifestProblemUnknownValue", "architecture", catalog.architectures().join(" | ")),
    text("manifestProblemNotText", "language", "number"),
    text("manifestRefusedFixByHand", MANIFEST_FILE),
    text("manifestRefusedOrFlags", "--arch, --language"),
  ]);
});

test("should list the refusal details in the DT-8 order with the install line of the update", () => {
  const error = refusalOf(() => resolve(validManifest({ engines: 7 }), { command: COMMAND.UPDATE }));
  assert.deepEqual(error.details, [
    text("manifestProblemStringList", "engines", "number"),
    text("manifestRefusedFixByHand", MANIFEST_FILE),
    text("manifestRefusedOrInstall", "--engine"),
  ]);
});

test("should list the refusal details of the uninstall with neither flag line", () => {
  const error = refusalOf(() => resolve(validManifest({ engines: 7 }), { command: COMMAND.UNINSTALL }));
  assert.deepEqual(error.details, [
    text("manifestProblemStringList", "engines", "number"),
    text("manifestRefusedFixByHand", MANIFEST_FILE),
  ]);
});

test("should render the refusal block through renderError in the canonical language", () => {
  const error = refusalOf(() => resolve(validManifest({ engines: [] }), { command: COMMAND.INSTALL }));
  assert.equal(renderError(getMessages("en"), error), [
    "manifest.json has declarations out of shape, and nothing was written:",
    "  `engines`: expected at least one engine, found an empty list",
    "Fix these fields by hand in manifest.json and run the command again.",
    "Or declare the value on the command line: --engine.",
  ].join("\n"));
});

test("should refuse optional out of shape without any flag line in install and update", () => {
  for (const command of [COMMAND.INSTALL, COMMAND.UPDATE]) {
    const error = refusalOf(() => resolve(validManifest({ optional: "x" }), { command }));
    assert.deepEqual(error.details, [
      text("manifestProblemStringList", "optional", "string"),
      text("manifestRefusedFixByHand", MANIFEST_FILE),
    ]);
  }
});

test("should refuse allSkills out of shape without any flag line in install and update", () => {
  for (const command of [COMMAND.INSTALL, COMMAND.UPDATE]) {
    const error = refusalOf(() => resolve(validManifest({ allSkills: "yes" }), { command }));
    assert.deepEqual(error.details, [
      text("manifestProblemNotBoolean", "allSkills", "string"),
      text("manifestRefusedFixByHand", MANIFEST_FILE),
    ]);
  }
});

test("should list one flag per refused field in the flag line", () => {
  const error = refusalOf(() => resolve(validManifest({ userLanguage: 7, language: 7 }), { command: COMMAND.INSTALL }));
  assert.deepEqual(error.details.at(-1), text("manifestRefusedOrFlags", "--language, --user-language"));
});

test("should keep the custom target and inherit its skills directory", () => {
  const manifest = validManifest({ engines: ["custom"], skillsDirs: ["minhas-skills"] });
  const result = resolve(manifest);
  assert.deepEqual(result.declarations.engines, ["custom"]);
  assert.deepEqual(result.declarations.skillsDirs, ["minhas-skills"]);
  assert.deepEqual(result.prior.skillsDirs, ["minhas-skills"]);
});

for (const [label, change] of [["absent", undefined], ["null", null], ["empty", []]]) {
  test(`should refuse the custom target with skillsDirs ${label} and point install at the skills-dir flag`, () => {
    const manifest = validManifest({ engines: ["custom"], skillsDirs: change });
    const error = refusalOf(() => resolve(manifest, { command: COMMAND.INSTALL }));
    assert.deepEqual(error.details, [
      text("manifestProblemEmptyCustomDir"),
      text("manifestRefusedFixByHand", MANIFEST_FILE),
      text("manifestRefusedOrFlags", "--skills-dir"),
    ]);
  });
}

test("should point the update refusal for the custom target at install with the skills-dir flag", () => {
  const error = refusalOf(() => resolve(validManifest({ engines: ["custom"], skillsDirs: [] }), { command: COMMAND.UPDATE }));
  assert.deepEqual(error.details.at(-1), text("manifestRefusedOrInstall", "--skills-dir"));
});

test("should let the explicit skills-dir cover the custom target without a recorded directory", () => {
  const manifest = validManifest({ engines: ["custom"], skillsDirs: [] });
  const result = resolve(manifest, { explicit: { skillsDirs: ["nova"] } });
  assert.deepEqual(result.declarations.skillsDirs, ["nova"]);
});

test("should refuse the custom target when skillsDirs is out of shape and name the skills-dir flag", () => {
  const error = refusalOf(() => resolve(validManifest({ engines: ["custom"], skillsDirs: "x" }), { command: COMMAND.INSTALL }));
  assert.deepEqual(error.details[0], text("manifestProblemStringList", "skillsDirs", "string"));
  assert.deepEqual(error.details.at(-1), text("manifestRefusedOrFlags", "--skills-dir"));
});

test("should return absent when there is no manifest to read", () => {
  assert.deepEqual(readPrior("project", tempDir("mgr-prior-ausente-")), { state: "absent" });
});

test("should read the manifest and report shape problems without the skills registry ones", () => {
  const repo = tempDir("mgr-prior-lido-");
  mkdirSync(path.join(repo, ".mgr-core"), { recursive: true });
  writeFileSync(path.join(repo, ".mgr-core", MANIFEST_FILE), JSON.stringify({ skills: [], skillsDirs: 7 }));
  const read = readPrior("project", repo);
  assert.equal(read.state, "read");
  assert.deepEqual(read.manifest, { skills: [], skillsDirs: 7 });
  assert.deepEqual(read.problems, [{ field: "skillsDirs", kind: "container", expected: "array-of-strings", found: "number" }]);
});

const BOGUS_MODEL = "bogus";
const BAIT_SKILL = "isca";

const projectWithLegacyManifest = (manifest) => {
  const parent = tempDir("mgr-migrate-old-");
  const repo = path.join(parent, "proj");
  mkdirSync(path.join(repo, ".mgr-core"), { recursive: true });
  writeFileSync(path.join(repo, ".mgr-core", MANIFEST_FILE), JSON.stringify(manifest));
  return { parent, repo };
};

const makeSkillDir = (dir, name) => {
  mkdirSync(path.join(dir, name), { recursive: true });
  writeFileSync(path.join(dir, name, "SKILL.md"), "x");
};

test("should treat a present model outside the known ones as the current layout", () => {
  assert.equal(runtimeMigration({ model: BOGUS_MODEL }), "none");
  assert.equal(needsConfigMigration({ model: BOGUS_MODEL }), false);
});

test("should keep announcing the migration for the known legacy models", () => {
  assert.equal(runtimeMigration({ model: MODEL_RUNTIME }), "relocate");
  assert.equal(runtimeMigration({ model: MODEL_LAYERED }), "relocate");
  assert.equal(runtimeMigration({ model: "runtime-launcher" }), "copy");
  assert.equal(needsConfigMigration({ model: MODEL_RUNTIME }), true);
  assert.equal(needsConfigMigration({ model: MODEL_LAYERED }), false);
  assert.equal(needsConfigMigration({ model: MODEL_CORE_RUNTIME }), false);
});

test("should keep the copy and config migration when the model is absent", () => {
  assert.equal(runtimeMigration({}), "copy");
  assert.equal(needsConfigMigration({}), true);
});

test("should leave a declared directory that differs from the recalculated one untouched", () => {
  const { parent, repo } = projectWithLegacyManifest({
    model: "runtime-launcher",
    engines: ["claude-code"],
    skills: [BAIT_SKILL],
    skillsDirs: ["../isca-dir"],
  });
  const baitDir = path.join(parent, "isca-dir");
  makeSkillDir(baitDir, BAIT_SKILL);
  const result = migrateOld("project", repo);
  assert.equal(existsSync(path.join(baitDir, BAIT_SKILL, "SKILL.md")), true);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.ignored, ["../isca-dir"]);
});

test("should remove the skills in the recalculated directory of a legacy manifest", () => {
  const { repo } = projectWithLegacyManifest({
    model: "runtime-launcher",
    engines: ["claude-code"],
    skills: [BAIT_SKILL],
    skillsDirs: [CLAUDE_DIR],
  });
  makeSkillDir(path.join(repo, CLAUDE_DIR), BAIT_SKILL);
  const result = migrateOld("project", repo);
  assert.equal(existsSync(path.join(repo, CLAUDE_DIR, BAIT_SKILL)), false);
  assert.deepEqual(result.removed, [path.join(repo, CLAUDE_DIR, BAIT_SKILL)]);
  assert.deepEqual(result.ignored, []);
});

test("should migrate a legacy manifest with the singular engine and skillsDir as before", () => {
  const { repo } = projectWithLegacyManifest({
    model: "runtime-launcher",
    engine: "claude-code",
    skills: [BAIT_SKILL],
    skillsDir: CLAUDE_DIR,
  });
  makeSkillDir(path.join(repo, CLAUDE_DIR), BAIT_SKILL);
  const result = migrateOld("project", repo);
  assert.equal(existsSync(path.join(repo, CLAUDE_DIR, BAIT_SKILL)), false);
  assert.deepEqual(result.ignored, []);
});

test("should remove the skills in the default engine directory when the legacy manifest declares no engine", () => {
  const { repo } = projectWithLegacyManifest({
    model: "runtime-launcher",
    skills: [BAIT_SKILL],
    skillsDir: CLAUDE_DIR,
  });
  makeSkillDir(path.join(repo, CLAUDE_DIR), BAIT_SKILL);
  const result = migrateOld("project", repo);
  assert.equal(existsSync(path.join(repo, CLAUDE_DIR, BAIT_SKILL)), false);
  assert.deepEqual(result.removed, [path.join(repo, CLAUDE_DIR, BAIT_SKILL)]);
  assert.deepEqual(result.ignored, []);
});

const previousOf = (read) => previousForQuestions(read, { scope: "project", repo: REPO, localeLanguage: "pt-BR" });

test("should offer no previous declaration to the questions when there is no installation", () => {
  assert.deepEqual(previousOf({ state: "absent" }), {});
});

test("should leave architecture and language out of the question defaults when the legacy manifest has neither", () => {
  const previous = previousOf(readOf(withoutKeys(validManifest(), "architecture", "language")));
  assert.equal("architecture" in previous, false);
  assert.equal("language" in previous, false);
  assert.deepEqual(previous.engines, ["claude-code"]);
});

test("should keep a recorded null architecture as the question default", () => {
  const previous = previousOf(readOf(validManifest({ architecture: null })));
  assert.equal(previous.architecture, null);
  assert.equal(previous.language, "java");
});

test("should offer every valid previous declaration to the questions", () => {
  const previous = previousOf(readOf(validManifest({ engines: ["copilot"], architecture: ARCH_B })));
  assert.deepEqual(previous, {
    engines: ["copilot"], architecture: ARCH_B, language: "java", userLanguage: "en", optional: ["evidence-capture"], allSkills: false,
    projectId: path.basename(REPO),
  });
});

test("should not refuse the question defaults for a declaration out of shape that has a question", () => {
  const previous = previousOf(readOf(validManifest({ architecture: 7 })));
  assert.equal("architecture" in previous, false);
  assert.equal(previous.language, "java");
});

const declarationsOf = (extra = {}) => ({
  engines: ["claude-code"], architecture: ARCH_A, language: "java", userLanguage: "en", optional: [], allSkills: false, ...extra,
});
const choicesOf = (options) => effectiveInstallChoices({ scope: "project", repo: REPO, localeLanguage: "pt-BR", skillsDirFlag: null, ...options });
const ANSWERED = { engines: ["copilot"], architecture: ARCH_B, language: null, userLanguage: "pt-BR", optional: ["evidence-capture"] };

test("should take every choice from the answers when the questions were asked", () => {
  const choices = choicesOf({ declarations: declarationsOf(), askQuestions: true, answered: ANSWERED });
  assert.deepEqual(choices, {
    engines: ["copilot"], skillsDir: null, skillsDirDeclared: null, architecture: ARCH_B, language: null, userLanguage: "pt-BR", optional: ["evidence-capture"], allSkills: false,
  });
});

test("should inherit architecture and language with allSkills because those questions are skipped", () => {
  const choices = choicesOf({ declarations: declarationsOf({ allSkills: true }), askQuestions: true, answered: ANSWERED });
  assert.equal(choices.architecture, ARCH_A);
  assert.equal(choices.language, "java");
  assert.equal(choices.allSkills, true);
});

test("should fall back to the default engines and the locale when the answers leave them empty", () => {
  const choices = choicesOf({ declarations: declarationsOf(), askQuestions: true, answered: { ...ANSWERED, engines: [], userLanguage: null } });
  assert.deepEqual(choices.engines, ["claude-code"]);
  assert.equal(choices.userLanguage, "pt-BR");
});

test("should take every choice from the resolution when no question was asked", () => {
  const choices = choicesOf({ declarations: declarationsOf({ engines: ["claude-code", "copilot"] }), askQuestions: false, answered: ANSWERED });
  assert.deepEqual(choices, {
    engines: ["claude-code", "copilot"], skillsDir: null, skillsDirDeclared: null, architecture: ARCH_A, language: "java", userLanguage: "en", optional: [], allSkills: false,
  });
});

test("should resolve the custom folder from the declaration when no question was asked", () => {
  const raiz = tempDir("mgr-escolhas-custom-");
  const choices = effectiveInstallChoices({
    declarations: declarationsOf({ engines: ["custom"], skillsDirs: ["minhas-skills"] }), askQuestions: false, answered: ANSWERED,
    skillsDirFlag: null, scope: "project", repo: raiz, localeLanguage: "pt-BR",
  });
  assert.deepEqual(choices.engines, []);
  assert.equal(choices.skillsDir, path.join(raiz, "minhas-skills"));
});

test("should refuse the question defaults before any question when allSkills is out of shape and no flag covers it", () => {
  const error = refusalOf(() => previousOf(readOf(validManifest({ allSkills: "sim" }))));
  assert.equal(error.key, "manifestRefused");
});

test("should accept the question defaults when the all-skills flag covers an allSkills out of shape", () => {
  const previous = previousForQuestions(readOf(validManifest({ allSkills: "sim" })), {
    scope: "project", repo: REPO, localeLanguage: "pt-BR", explicit: { allSkills: true },
  });
  assert.equal(previous.allSkills, true);
});

test("should resolve exactly the declarations of the single list, with or without a previous installation", () => {
  const semInstalacao = resolvePrior({ state: "absent" }, { scope: "project", repo: REPO, localeLanguage: "pt-BR", command: COMMAND.INSTALL });
  const comInstalacao = resolvePrior(readOf(validManifest()), { scope: "project", repo: REPO, localeLanguage: "pt-BR", command: COMMAND.INSTALL });
  assert.deepEqual(Object.keys(semInstalacao.declarations).sort(), [...RESOLVED_DECLARATIONS].sort());
  assert.deepEqual(Object.keys(comInstalacao.declarations).sort(), [...RESOLVED_DECLARATIONS].sort());
});

test("should offer the recorded project id as the question default instead of the folder name", () => {
  assert.equal(previousOf(readOf(validManifest({ projectId: "meu-projeto" }))).projectId, "meu-projeto");
});
