import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseArgs,
  checkEffortFlags,
  resolveEffortFlags,
  checkBareModelFlag,
  mergeEfforts,
  PACKAGE_COMMANDS,
  RUNTIME_COMMANDS,
  resolveEntry,
  checkFlags,
} from "../../src/core/cli-args.js";

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

test("should set archived to true when --archived is given", () => {
  const { flags } = parseArgs(["--archived"], { engines: ENGINES });
  assert.equal(flags.archived, true);
});

test("should read --date value from the next argument", () => {
  const { flags } = parseArgs(["--date", "2026-01-15"], { engines: ENGINES });
  assert.equal(flags.date, "2026-01-15");
});

for (const [flag, chave] of [["--base", "base"], ["--reviewer", "reviewer"], ["--reason", "reason"]]) {
  test(`should read ${flag} value from the next argument`, () => {
    const { flags, positional } = parseArgs(["review", flag, "valor com espaço", "x"], { engines: ENGINES });
    assert.equal(flags[chave], "valor com espaço");
    assert.deepEqual(positional, ["review", "x"]);
  });

  test(`should create the ${chave} key with undefined when ${flag} is the last argument`, () => {
    const { flags } = parseArgs([flag], { engines: ENGINES });
    assert.equal(Object.hasOwn(flags, chave), true);
    assert.equal(flags[chave], undefined);
  });
}

test("should create the date key with undefined when --date is the last argument", () => {
  const { flags } = parseArgs(["--date"], { engines: ENGINES });
  assert.equal(Object.hasOwn(flags, "date"), true);
  assert.equal(flags.date, undefined);
});

test("should keep positional arguments when --archived and --date are combined with them", () => {
  const { flags, positional, unknownFlag } = parseArgs(
    ["repo", "--archived", "--date", "2026-01-15", "slug"],
    { engines: ENGINES },
  );
  assert.equal(flags.archived, true);
  assert.equal(flags.date, "2026-01-15");
  assert.deepEqual(positional, ["repo", "slug"]);
  assert.equal(unknownFlag, null);
});

function judge(commands, fallback, argv) {
  const { positional, seen } = parseArgs(argv.slice(1), { engines: ["claude-code", "copilot"] });
  return checkFlags({ commands, fallback, command: argv[0], positional, seen });
}

test("should keep the order and the spelling of the flags in seen", () => {
  const { seen } = parseArgs(["--yes", "--scope", "global", "-y"], { engines: ENGINES });
  assert.deepEqual(seen, ["--yes", "--scope", "-y"]);
});

test("should leave seen empty when only positionals are passed", () => {
  const { seen } = parseArgs(["spec", "next"], { engines: ENGINES });
  assert.deepEqual(seen, []);
});

test("should resolve each command line to its entry name or to none", () => {
  const cases = [
    [["spec", "status"], "spec status"],
    [["spec", "initials"], "spec initials"],
    [["spec", "initials", "set"], "spec initials set"],
    [["spec", "initials", "x"], null],
    [["spec", "foo"], null],
    [["agents", "drafting"], "agents"],
    [["agents", "set"], "agents set"],
    [["agents", "apply"], "agents apply"],
    [["origin"], "origin"],
    [["origin", "set"], "origin set"],
    [["origin", "x"], null],
    [["review", "enable"], "review enable"],
    [["review"], null],
    [["registry", "list"], "registry list"],
    [["registry"], null],
    [["registry", "x"], null],
    [["review", "x"], null],
    [["--version"], "version"],
    [["-h"], "help"],
    [[undefined], "help"],
    [["hooks"], null],
    [["origin set"], null],
    [["spec status"], null],
  ];
  for (const [[command, ...positional], name] of cases) {
    const expected = name === null ? { state: "none" } : { state: "entry", name };
    assert.deepEqual(resolveEntry(PACKAGE_COMMANDS, command, positional), expected);
  }
  assert.deepEqual(resolveEntry(RUNTIME_COMMANDS, "review", ["enable"]), { state: "none" });
  assert.deepEqual(resolveEntry(RUNTIME_COMMANDS, "instructions", []), { state: "entry", name: "instructions" });
  assert.deepEqual(resolveEntry(RUNTIME_COMMANDS, "instructions", ["write"]), { state: "entry", name: "instructions write" });
  assert.deepEqual(resolveEntry(RUNTIME_COMMANDS, "instructions", ["x"]), { state: "none" });
});

test("should have no runtime detect entry without --hook and the detect entry with it", () => {
  assert.deepEqual(resolveEntry(RUNTIME_COMMANDS, "detect", [], []), { state: "none" });
  assert.deepEqual(resolveEntry(RUNTIME_COMMANDS, "detect", [], ["--hook"]), { state: "entry", name: "detect" });
});

test("should refuse update --dry-run naming the flag, the entry and install as acceptor", () => {
  assert.deepEqual(judge(PACKAGE_COMMANDS, null, ["update", "--dry-run"]), {
    ok: false,
    flag: "--dry-run",
    entry: "update",
    acceptedBy: ["install"],
    lifecycle: false,
  });
});

test("should let a flag listed in reads or refuses pass to its own message", () => {
  assert.deepEqual(judge(PACKAGE_COMMANDS, null, ["install", "--dry-run"]), { ok: true });
  assert.deepEqual(judge(PACKAGE_COMMANDS, null, ["install", "--model", "x"]), { ok: true });
  assert.deepEqual(judge(PACKAGE_COMMANDS, null, ["spec", "next", "--all"]), { ok: true });
});

test("should never list a refusing entry in acceptedBy", () => {
  const result = judge(PACKAGE_COMMANDS, null, ["update", "--model", "x"]);
  assert.equal(result.acceptedBy.includes("install"), false);
});

test("should accept --user-language on every entry of both tables", () => {
  const refused = [];
  for (const commands of [PACKAGE_COMMANDS, RUNTIME_COMMANDS]) {
    for (const name of Object.keys(commands)) {
      const argv = [...name.split(" "), "--user-language", "en"];
      if (commands === RUNTIME_COMMANDS && name === "detect") argv.push("--hook", "claude-code");
      const [command, ...rest] = argv;
      const { positional, seen } = parseArgs(rest, { engines: ENGINES });
      assert.deepEqual(resolveEntry(commands, command, positional, seen), { state: "entry", name });
      const result = judge(commands, null, argv);
      if (!result.ok) refused.push({ name, result });
    }
  }
  assert.deepEqual(refused, []);
});

test("should pass the hook mode with --hook and refuse precompact --json without it", () => {
  assert.deepEqual(judge(RUNTIME_COMMANDS, null, ["detect", "--hook", "claude-code", "--dry-run"]), { ok: true });
  assert.deepEqual(judge(RUNTIME_COMMANDS, null, ["precompact", "--hook", "claude-code", "--json"]), { ok: true });
  const refused = judge(RUNTIME_COMMANDS, null, ["precompact", "--json"]);
  assert.equal(refused.ok, false);
  assert.equal(refused.flag, "--json");
  assert.equal(refused.entry, "precompact");
});

test("should refuse --hook on an entry without hook mode", () => {
  const result = judge(PACKAGE_COMMANDS, null, ["update", "--hook", "x", "--dry-run"]);
  assert.equal(result.flag, "--hook");
  assert.deepEqual(result.acceptedBy, ["detect", "precompact"]);
});

test("should judge agents apply by its own empty set", () => {
  const result = judge(PACKAGE_COMMANDS, null, ["agents", "apply", "--json"]);
  assert.equal(result.ok, false);
  assert.equal(result.entry, "agents apply");
});

test("should report the first refusable flag in command-line order", () => {
  const result = judge(PACKAGE_COMMANDS, null, ["update", "--json", "--dry-run"]);
  assert.equal(result.flag, "--json");
});

test("should mark lifecycle true when the fallback table accepts the refused flag", () => {
  assert.deepEqual(judge(RUNTIME_COMMANDS, PACKAGE_COMMANDS, ["origin", "set", "greenfield", "--dry-run"]), {
    ok: false,
    flag: "--dry-run",
    entry: "origin set",
    acceptedBy: ["install"],
    lifecycle: true,
  });
  const doctor = judge(RUNTIME_COMMANDS, PACKAGE_COMMANDS, ["doctor", "--base", "x"]);
  assert.equal(doctor.lifecycle, false);
  assert.deepEqual(doctor.acceptedBy, ["review external"]);
});

test("should return empty acceptedBy and lifecycle false when no table accepts the flag", () => {
  assert.deepEqual(judge(RUNTIME_COMMANDS, null, ["origin", "set", "--dry-run"]), {
    ok: false,
    flag: "--dry-run",
    entry: "origin set",
    acceptedBy: [],
    lifecycle: false,
  });
});

test("should pass when no entry matches the command", () => {
  assert.deepEqual(judge(PACKAGE_COMMANDS, null, ["hooks", "--dry-run"]), { ok: true });
});
