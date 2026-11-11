import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getMessages } from "../src/messages.js";
import { runMgr, tempOutsideGit as tempOutsideGitIn } from "./helpers/cli.js";

const msg = getMessages("en");
const BASE = ["install", "--scope", "project", "--all-skills", "-y", "--engine", "claude-code"];
const CONFIG_FILE = ".mgr-core/config.json";

const tempOutsideGit = (label) => tempOutsideGitIn(label, "mgr-rgate");

const compact = (text) => text.replace(/[|│\s]+/g, "");
const CONTINUATION_LABELS = ["Replaced:", "Replaces:", "Keeps:", "Keptfromit:", "Itdeclarednofield"];
const CONTINUATION = `(?!${CONTINUATION_LABELS.join("|")})`;
const announcementIndex = (output, text) => {
  const escaped = compact(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return output.search(new RegExp(escaped + CONTINUATION));
};
const everything = (result) => compact(result.stdout + result.stderr);
const dump = (result) => result.stdout + result.stderr;
const configPath = (project) => path.join(project, ".mgr-core", "config.json");
const readConfig = (project) => JSON.parse(fs.readFileSync(configPath(project), "utf8"));
const reviewAgentFile = (project) => path.join(project, ".claude", "agents", "mgr-review.md");

function writeConfig(project, config) {
  fs.mkdirSync(path.dirname(configPath(project)), { recursive: true });
  fs.writeFileSync(configPath(project), JSON.stringify(config));
}

function projectWith(config) {
  const project = tempOutsideGit("proj");
  const home = tempOutsideGit("home");
  if (config !== undefined) writeConfig(project, config);
  return { project, home };
}

const DISABLED = { reviewGate: { enabled: false } };
const KEPT_ENABLED = { state: "migrated", kept: [{ field: "enabled", value: false }], replaced: [] };

for (const flag of [["--effort-review", "max"], ["--model-review", "opus"]]) {
  test(`should keep reviewGate disabled after install ${flag.join(" ")} and announce the migration`, () => {
    const { project, home } = projectWith(DISABLED);
    const result = runMgr([...BASE, ...flag, project], { cwd: project, home });
    assert.equal(result.status, 0, dump(result));
    const expected = flag[0] === "--effort-review"
      ? { enabled: false, effort: "max" }
      : { enabled: false, model: { "claude-code": "opus" } };
    assert.deepEqual(readConfig(project), { agents: { review: expected } });
    assert.ok(announcementIndex(everything(result), msg.reviewGateMigrated(KEPT_ENABLED, CONFIG_FILE)) >= 0, dump(result));
    const json = runMgr(["agents", "--json"], { cwd: project, home });
    assert.equal(json.status, 0, dump(json));
    assert.equal(JSON.parse(json.stdout).intents.review.enabled, false);
    const text = runMgr(["agents"], { cwd: project, home });
    assert.equal(text.status, 0, dump(text));
    assert.ok(!everything(text).includes(compact(msg.agentsAliasNote)));
    assert.equal(fs.existsSync(reviewAgentFile(project)), false);
  });
}

test("should keep reviewGate disabled after agents set review --effort max and announce the migration", () => {
  const { project, home } = projectWith();
  const installed = runMgr([...BASE, project], { cwd: project, home });
  assert.equal(installed.status, 0, dump(installed));
  writeConfig(project, DISABLED);
  const result = runMgr(["agents", "set", "review", "--effort", "max"], { cwd: project, home });
  assert.equal(result.status, 0, dump(result));
  assert.deepEqual(readConfig(project), { agents: { review: { enabled: false, effort: "max" } } });
  const written = compact(msg.agentsSetWritten("review", "mgr-review"));
  const out = compact(result.stdout);
  const announcedAt = announcementIndex(out, msg.reviewGateMigrated(KEPT_ENABLED, CONFIG_FILE));
  assert.ok(out.includes(written), dump(result));
  assert.ok(announcedAt >= 0, dump(result));
  assert.ok(announcedAt > out.indexOf(written), dump(result));
});

test("should show the review disabled in the dry-run plan when only reviewGate exists", () => {
  const { project, home } = projectWith(DISABLED);
  const before = fs.readFileSync(configPath(project), "utf8");
  const result = runMgr([...BASE, "--dry-run", "--effort-review", "max", project], { cwd: project, home });
  assert.equal(result.status, 0, dump(result));
  const out = everything(result);
  assert.ok(!out.includes(compact(msg.planAgentIntent("review", "mgr-review"))), dump(result));
  assert.ok(out.includes(compact(msg.planAgentIntent("drafting", "mgr-draft"))), dump(result));
  assert.equal(fs.readFileSync(configPath(project), "utf8"), before);
  assert.deepEqual(fs.readdirSync(project), [".mgr-core"]);
  assert.deepEqual(fs.readdirSync(path.join(project, ".mgr-core")), ["config.json"]);
});

test("should refuse install --effort-review over an invalid reviewGate before the plan and write nothing", () => {
  const { project, home } = projectWith({ reviewGate: { enabled: "sim" } });
  const before = fs.readFileSync(configPath(project), "utf8");
  const result = runMgr([...BASE, "--effort-review", "max", project], { cwd: project, home });
  assert.equal(result.status, 1, dump(result));
  assert.ok(
    result.stderr.includes(msg.errorPrefix('invalid reviewGate.enabled: "sim" (expected true | false)')),
    result.stderr,
  );
  assert.ok(!result.stdout.includes(msg.planTitle), result.stdout);
  assert.deepEqual(fs.readdirSync(project), [".mgr-core"]);
  assert.deepEqual(fs.readdirSync(path.join(project, ".mgr-core")), ["config.json"]);
  assert.equal(fs.readFileSync(configPath(project), "utf8"), before);
});

test("should announce in the dry-run plan what the migration keeps and replaces", () => {
  const args = [...BASE, "--dry-run", "--effort-review", "max"];
  const withGate = projectWith({ reviewGate: { enabled: false, effort: "high" } });
  const result = runMgr([...args, withGate.project], { cwd: withGate.project, home: withGate.home });
  assert.equal(result.status, 0, dump(result));
  const plan = msg.planReviewGateMigration({
    state: "migrated",
    kept: [{ field: "enabled", value: false }],
    replaced: [{ field: "effort", from: "high", to: "max" }],
  }, CONFIG_FILE);
  assert.ok(announcementIndex(everything(result), plan) >= 0, dump(result));
  const without = projectWith();
  const clean = runMgr([...args, without.project], { cwd: without.project, home: without.home });
  assert.equal(clean.status, 0, dump(clean));
  const emptyPlan = msg.planReviewGateMigration({ state: "migrated", kept: [], replaced: [] }, CONFIG_FILE);
  const start = emptyPlan.slice(0, emptyPlan.indexOf(". "));
  assert.ok(start.length > 0 && start.startsWith("`reviewGate`"), start);
  assert.ok(!everything(clean).includes(compact(start)), dump(clean));
});

test("should refuse agents set review over a non-object agents and write nothing", () => {
  const { project, home } = projectWith();
  const installed = runMgr([...BASE, project], { cwd: project, home });
  assert.equal(installed.status, 0, dump(installed));
  writeConfig(project, { agents: "x", reviewGate: { enabled: false } });
  const before = fs.readFileSync(configPath(project), "utf8");
  const result = runMgr(["agents", "set", "review", "--effort", "max"], { cwd: project, home });
  assert.equal(result.status, 1, dump(result));
  assert.ok(result.stderr.includes(msg.errorPrefix('invalid agents: "x" (expected an object)')), result.stderr);
  assert.equal(fs.readFileSync(configPath(project), "utf8"), before);
});

test("should render the migration announcements in en and pt-BR", () => {
  const both = {
    state: "migrated",
    kept: [{ field: "enabled", value: false }, { field: "model.claude-code", value: "opus" }],
    replaced: [{ field: "effort", from: "high", to: "max" }],
  };
  const empty = { state: "migrated", kept: [], replaced: [] };
  const pt = getMessages("pt-BR");
  const enHead = "`reviewGate` was merged into `agents.review` and removed from .mgr-core/config.json.";
  const ptHead = "O `reviewGate` foi incorporado a `agents.review` e removido de .mgr-core/config.json.";
  assert.equal(
    msg.reviewGateMigrated(both, CONFIG_FILE),
    `${enHead} Kept from it: enabled=false, model.claude-code="opus". Replaced: effort "high" -> "max".`,
  );
  assert.equal(msg.reviewGateMigrated(empty, CONFIG_FILE), `${enHead} It declared no field.`);
  assert.equal(
    pt.reviewGateMigrated(both, CONFIG_FILE),
    `${ptHead} Ficou dele: enabled=false, model.claude-code="opus". Substituído: effort "high" -> "max".`,
  );
  assert.equal(pt.reviewGateMigrated(empty, CONFIG_FILE), `${ptHead} Ele não declarava nenhum campo.`);
  const enPlan = "`reviewGate` will be merged into `agents.review` and removed from .mgr-core/config.json.";
  const ptPlan = "O `reviewGate` será incorporado a `agents.review` e removido de .mgr-core/config.json.";
  assert.equal(
    msg.planReviewGateMigration(both, CONFIG_FILE),
    `${enPlan} Keeps: enabled=false, model.claude-code="opus". Replaces: effort "high" -> "max".`,
  );
  assert.equal(msg.planReviewGateMigration(empty, CONFIG_FILE), `${enPlan} It declared no field.`);
  assert.equal(
    pt.planReviewGateMigration(both, CONFIG_FILE),
    `${ptPlan} Fica: enabled=false, model.claude-code="opus". Substitui: effort "high" -> "max".`,
  );
  assert.equal(pt.planReviewGateMigration(empty, CONFIG_FILE), `${ptPlan} Ele não declarava nenhum campo.`);
  const other = "~/.mgr-core/config.json";
  for (const mensagens of [msg, pt]) {
    assert.ok(mensagens.reviewGateMigrated(empty, other).includes(`${other}.`));
    assert.ok(mensagens.planReviewGateMigration(empty, other).includes(`${other}.`));
    assert.ok(!mensagens.reviewGateMigrated(empty, other).includes(` ${CONFIG_FILE}`));
    assert.ok(!mensagens.planReviewGateMigration(empty, other).includes(` ${CONFIG_FILE}`));
  }
  const rendered = compact([both, empty].flatMap((migration) => [
    msg.reviewGateMigrated(migration, CONFIG_FILE),
    msg.planReviewGateMigration(migration, CONFIG_FILE),
  ]).join(""));
  for (const label of CONTINUATION_LABELS) assert.ok(rendered.includes(label), label);
  const marked = { state: "migrated", kept: [{ field: "KEPTFIELD", value: 1 }], replaced: [{ field: "REPLACEDFIELD", from: 1, to: 2 }] };
  const labelsIn = (text, head) => {
    const rest = compact(text).slice(compact(head).length);
    return [rest.slice(0, rest.indexOf("KEPTFIELD")), rest.slice(rest.indexOf("1.") + 2, rest.indexOf("REPLACEDFIELD"))];
  };
  const heads = [msg.reviewGateMigrated(empty, CONFIG_FILE), msg.planReviewGateMigration(empty, CONFIG_FILE)]
    .map((text) => text.slice(0, text.indexOf(" It declared")));
  const derived = [
    ...labelsIn(msg.reviewGateMigrated(marked, CONFIG_FILE), heads[0]),
    ...labelsIn(msg.planReviewGateMigration(marked, CONFIG_FILE), heads[1]),
    compact(msg.reviewGateMigrated(empty, CONFIG_FILE).slice(heads[0].length)).replace(/\.$/, ""),
  ];
  assert.deepEqual([...new Set(derived)].sort(), [...CONTINUATION_LABELS].sort());
});
