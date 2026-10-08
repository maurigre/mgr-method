import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli-args.js";

const ENGINES = ["claude-code", "codex"];

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
