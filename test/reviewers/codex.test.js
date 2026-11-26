import { test } from "node:test";
import assert from "node:assert/strict";
import codex from "../../src/reviewers/codex.js";
import * as reviewers from "../../src/reviewers/index.js";
import { UsageError } from "../../src/core/errors.js";

const BASE_ARGS = {
  repo: "/repo",
  schemaFile: "/tmp/schema.json",
  lastMessageFile: "/tmp/last.json",
  prompt: "revise a fatia",
};

const BASE_ARGV = [
  "exec",
  "--sandbox",
  "read-only",
  "--output-schema",
  "/tmp/schema.json",
  "--output-last-message",
  "/tmp/last.json",
  "--json",
  "--cd",
  "/repo",
];

test("should build the exact exec argv without model and effort", () => {
  assert.deepEqual(codex.execArgv(BASE_ARGS), [...BASE_ARGV, "revise a fatia"]);
});

test("should add -m before the prompt when only the model is chosen", () => {
  assert.deepEqual(codex.execArgv({ ...BASE_ARGS, model: "gpt-5" }), [
    ...BASE_ARGV,
    "-m",
    "gpt-5",
    "revise a fatia",
  ]);
});

test("should add -c model_reasoning_effort as two elements when only the effort is chosen", () => {
  assert.deepEqual(codex.execArgv({ ...BASE_ARGS, effort: "high" }), [
    ...BASE_ARGV,
    "-c",
    "model_reasoning_effort=high",
    "revise a fatia",
  ]);
});

test("should put -m before -c and the prompt last when model and effort are both chosen", () => {
  assert.deepEqual(codex.execArgv({ ...BASE_ARGS, model: "gpt-5", effort: "high" }), [
    ...BASE_ARGV,
    "-m",
    "gpt-5",
    "-c",
    "model_reasoning_effort=high",
    "revise a fatia",
  ]);
});

test("should keep a prompt with spaces and quotes as a single argv element", () => {
  const prompt = `diga "olá" e 'adeus'`;
  const argv = codex.execArgv({ ...BASE_ARGS, prompt });
  assert.equal(argv.at(-1), prompt);
  assert.equal(argv.length, BASE_ARGV.length + 1);
});

test("should find the session id in the thread.started event among other lines", () => {
  const jsonlText = [
    '{"type":"turn.started"}',
    '{"type":"thread.started","thread_id":"abc"}',
    '{"type":"turn.completed"}',
  ].join("\n");
  assert.deepEqual(codex.sessionFrom(jsonlText), { found: true, session: "abc" });
});

test("should report no session when the thread.started event is absent", () => {
  const jsonlText = ['{"type":"turn.started"}', '{"type":"turn.completed"}'].join("\n");
  assert.deepEqual(codex.sessionFrom(jsonlText), { found: false });
});

test("should skip an invalid JSON line before the thread.started event", () => {
  const jsonlText = [
    "{linha quebrada",
    '{"type":"thread.started","thread_id":"xyz"}',
  ].join("\n");
  assert.deepEqual(codex.sessionFrom(jsonlText), { found: true, session: "xyz" });
});

test("should report no session when thread_id is an empty string", () => {
  assert.deepEqual(codex.sessionFrom('{"type":"thread.started","thread_id":""}'), {
    found: false,
  });
});

test("should return the first non-empty line as the version", () => {
  assert.deepEqual(codex.versionFrom("codex-cli 0.162.1\n"), {
    found: true,
    version: "codex-cli 0.162.1",
  });
});

test("should skip empty lines before the version", () => {
  assert.deepEqual(codex.versionFrom("\n\n  codex-cli 0.162.1  \n"), {
    found: true,
    version: "codex-cli 0.162.1",
  });
});

test("should report no version when stdout is empty", () => {
  assert.deepEqual(codex.versionFrom(""), { found: false });
});

test("should consider logged in when the phrase comes on stderr with status 0", () => {
  assert.equal(
    codex.isLoggedIn({ status: 0, stdout: "", stderr: "Logged in using ChatGPT\n" }),
    true,
  );
});

test("should consider logged in when the phrase comes on stdout with status 0", () => {
  assert.equal(
    codex.isLoggedIn({ status: 0, stdout: "Logged in using ChatGPT\n", stderr: "" }),
    true,
  );
});

test("should not consider logged in when status is 1 even with the phrase", () => {
  assert.equal(
    codex.isLoggedIn({ status: 1, stdout: "", stderr: "Logged in using ChatGPT\n" }),
    false,
  );
});

test("should not consider logged in when the output says Not logged in", () => {
  assert.equal(
    codex.isLoggedIn({ status: 0, stdout: "", stderr: "Not logged in\n" }),
    false,
  );
});

test("should return the codex sheet from the registry", () => {
  assert.equal(reviewers.get("codex"), codex);
});

test("should throw UsageError with reviewerUnknown when the reviewer is unknown", () => {
  assert.throws(
    () => reviewers.get("x"),
    (error) => {
      assert.ok(error instanceof UsageError);
      assert.equal(error.key, "reviewerUnknown");
      assert.deepEqual(error.params, ["x", ["codex"]]);
      return true;
    },
  );
});

test("should list only codex as the registered reviewer id", () => {
  assert.deepEqual(reviewers.ids(), ["codex"]);
});

test("should return the raw error and turn.failed lines of the event stream", () => {
  const fluxo = [
    "{\"type\":\"thread.started\",\"thread_id\":\"abc\"}",
    "nao e json",
    "{\"type\":\"error\",\"message\":\"modelo desconhecido\"}",
    "{\"type\":\"turn.failed\",\"error\":{\"message\":\"x\"}}",
    "null",
  ].join("\n");
  assert.deepEqual(codex.failureEventsFrom(fluxo), [
    "{\"type\":\"error\",\"message\":\"modelo desconhecido\"}",
    "{\"type\":\"turn.failed\",\"error\":{\"message\":\"x\"}}",
  ]);
});

test("should return no failure lines when the stream has none", () => {
  assert.deepEqual(codex.failureEventsFrom("{\"type\":\"turn.completed\"}\n"), []);
});
