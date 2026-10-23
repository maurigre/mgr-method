import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseArgs,
  checkEffortFlags,
  resolveEffortFlags,
  checkBareModelFlag,
  mergeEfforts,
} from "../src/cli-args.js";

const ENGINES = ["claude-code", "codex"];
const LEVELS = ["low", "medium", "high", "xhigh", "max", "inherit"];

test("should read a flag that takes a value from the next argument", () => {
  const { flags } = parseArgs(["--scope", "global"], { engines: ENGINES });
  assert.equal(flags.scope, "global");
});

test("should set a boolean flag without consuming the following argument", () => {
  const { flags, positional } = parseArgs(["--dry-run", "repo"], { engines: ENGINES });
  assert.equal(flags.dryRun, true);
  assert.deepEqual(positional, ["repo"]);
});

test("should keep defaults untouched when no flag is given", () => {
  const { flags, positional, unknownFlag } = parseArgs([], { engines: ENGINES });
  assert.deepEqual(flags, { engines: [] });
  assert.deepEqual(positional, []);
  assert.equal(unknownFlag, null);
});

test("should expand --engine both into the engines received as parameter", () => {
  const { flags } = parseArgs(["--engine", "both"], { engines: ENGINES });
  assert.deepEqual(flags.engines, ENGINES);
});

test("should split a comma list in --engine and keep the explicit names", () => {
  const { flags } = parseArgs(["--engine", "codex,claude-code"], { engines: ENGINES });
  assert.deepEqual(flags.engines, ["codex", "claude-code"]);
});

test("should report the unknown flag in unknownFlag and stop reading arguments", () => {
  const { positional, unknownFlag } = parseArgs(["repo", "--nope", "depois"], { engines: ENGINES });
  assert.equal(unknownFlag, "--nope");
  assert.deepEqual(positional, ["repo"]);
});

test("should keep positional arguments in their original order", () => {
  const { positional, unknownFlag } = parseArgs(["b", "--json", "a", "c"], { engines: ENGINES });
  assert.deepEqual(positional, ["b", "a", "c"]);
  assert.equal(unknownFlag, null);
});

test("should read each --effort-<intent> flag into its own field", () => {
  const { flags } = parseArgs(
    ["--effort-drafting", "low", "--effort-execution", "high", "--effort-review", "max"],
    { engines: ENGINES },
  );
  assert.equal(flags.effortDrafting, "low");
  assert.equal(flags.effortExecution, "high");
  assert.equal(flags.effortReview, "max");
});

test("should keep reading --effort into flags.effort", () => {
  const { flags, unknownFlag } = parseArgs(["--effort", "max"], { engines: ENGINES });
  assert.equal(flags.effort, "max");
  assert.equal(unknownFlag, null);
});

test("should create the effort-review key with undefined when the value is missing", () => {
  const { flags } = parseArgs(["--effort-review"], { engines: ENGINES });
  assert.equal(Object.hasOwn(flags, "effortReview"), true);
  assert.equal(flags.effortReview, undefined);
});

test("should refuse a bare --effort even when an intent flag is valid", () => {
  const result = checkEffortFlags({ effort: "max", effortReview: "max" }, { levels: LEVELS });
  assert.deepEqual(result, { ok: false, reason: "bare-effort" });
});

test("should refuse a bare --effort whose value is undefined", () => {
  const result = checkEffortFlags({ effort: undefined }, { levels: LEVELS });
  assert.deepEqual(result, { ok: false, reason: "bare-effort" });
});

test("should refuse a bare --effort before reporting an invalid intent level", () => {
  const result = checkEffortFlags({ effort: "max", effortReview: "maxx" }, { levels: LEVELS });
  assert.deepEqual(result, { ok: false, reason: "bare-effort" });
});

test("should refuse an intent flag with an empty value as invalid-level", () => {
  const result = checkEffortFlags({ effortReview: "" }, { levels: LEVELS });
  assert.deepEqual(result, { ok: false, reason: "invalid-level", intent: "review", value: "" });
});

test("should refuse an intent flag without value as invalid-level with empty value", () => {
  const result = checkEffortFlags({ effortExecution: undefined }, { levels: LEVELS });
  assert.deepEqual(result, { ok: false, reason: "invalid-level", intent: "execution", value: "" });
});

test("should refuse MAX as invalid-level because the comparison is case sensitive", () => {
  const result = checkEffortFlags({ effortReview: "MAX" }, { levels: LEVELS });
  assert.deepEqual(result, { ok: false, reason: "invalid-level", intent: "review", value: "MAX" });
});

test("should refuse maxx as invalid-level", () => {
  const result = checkEffortFlags({ effortDrafting: "maxx" }, { levels: LEVELS });
  assert.deepEqual(result, { ok: false, reason: "invalid-level", intent: "drafting", value: "maxx" });
});

for (const level of LEVELS) {
  test(`should accept the effort ${level} in an intent flag`, () => {
    const result = checkEffortFlags({ effortExecution: level }, { levels: LEVELS });
    assert.deepEqual(result, { ok: true, efforts: { execution: level } });
  });
}

test("should return only the intents declared by flag", () => {
  const result = checkEffortFlags({ effortExecution: "low" }, { levels: LEVELS });
  assert.deepEqual(result, { ok: true, efforts: { execution: "low" } });
});

test("should return ok with empty efforts when no effort flag is given", () => {
  const result = checkEffortFlags({ engines: [] }, { levels: LEVELS });
  assert.deepEqual(result, { ok: true, efforts: {} });
});

test("should report the first invalid intent in drafting, execution, review order", () => {
  const result = checkEffortFlags({ effortReview: "x", effortDrafting: "y" }, { levels: LEVELS });
  assert.deepEqual(result, { ok: false, reason: "invalid-level", intent: "drafting", value: "y" });
});

const supportsClaudeCode = (engine) => engine === "claude-code";

test("should refuse with no-effort-engine when no chosen engine supports effort", () => {
  const result = resolveEffortFlags(
    { effortReview: "max" },
    { engines: ["codex"], supportsEffort: supportsClaudeCode, levels: LEVELS },
  );
  assert.deepEqual(result, { ok: false, reason: "no-effort-engine", intent: "review" });
});

test("should accept the intent when one chosen engine supports effort", () => {
  const result = resolveEffortFlags(
    { effortReview: "max" },
    { engines: ["codex", "claude-code"], supportsEffort: supportsClaudeCode, levels: LEVELS },
  );
  assert.deepEqual(result, { ok: true, efforts: { review: "max" } });
});

test("should accept without an effort engine when no intent flag is given", () => {
  const result = resolveEffortFlags(
    {},
    { engines: ["codex"], supportsEffort: supportsClaudeCode, levels: LEVELS },
  );
  assert.deepEqual(result, { ok: true, efforts: {} });
});

test("should return the bare-effort refusal before checking the engines", () => {
  const result = resolveEffortFlags(
    { effort: "max" },
    { engines: ["codex"], supportsEffort: supportsClaudeCode, levels: LEVELS },
  );
  assert.deepEqual(result, { ok: false, reason: "bare-effort" });
});

test("should return the invalid-level refusal before checking the engines", () => {
  const result = resolveEffortFlags(
    { effortReview: "maxx" },
    { engines: ["codex"], supportsEffort: supportsClaudeCode, levels: LEVELS },
  );
  assert.deepEqual(result, { ok: false, reason: "invalid-level", intent: "review", value: "maxx" });
});

test("should name the first declared intent in no-effort-engine", () => {
  const result = resolveEffortFlags(
    { effortReview: "max", effortDrafting: "low" },
    { engines: ["codex"], supportsEffort: supportsClaudeCode, levels: LEVELS },
  );
  assert.deepEqual(result, { ok: false, reason: "no-effort-engine", intent: "drafting" });
});

test("should refuse the bare --model when the key holds a value", () => {
  assert.deepEqual(checkBareModelFlag({ model: "opus" }), { ok: false, reason: "bare-model" });
});

test("should refuse the bare --model when the key holds undefined", () => {
  assert.deepEqual(checkBareModelFlag({ model: undefined }), { ok: false, reason: "bare-model" });
});

test("should accept when the model key is absent and only intent model flags are given", () => {
  assert.deepEqual(checkBareModelFlag({ modelDrafting: "opus" }), { ok: true });
});

test("should let the flag-declared effort win over the answered one for the same intent", () => {
  assert.deepEqual(mergeEfforts({ review: "low", drafting: "high" }, { review: "max" }), { review: "max", drafting: "high" });
});

test("should keep the answered efforts when no effort was declared by flag", () => {
  assert.deepEqual(mergeEfforts({ execution: "medium" }, {}), { execution: "medium" });
});
