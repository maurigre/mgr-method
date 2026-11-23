import { test } from "node:test";
import assert from "node:assert/strict";
import { text, datum, renderText } from "../../src/core/ui-text.js";
import { LocalizedError, UsageError, InvariantError, renderError } from "../../src/core/errors.js";
import { getMessages } from "../../src/core/messages.js";
import { InstallCancelled } from "../../src/install/plugin-installer.js";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EN = getMessages("en");
const PT = getMessages("pt-BR");

test("should return fixed text as is when the message is a string", () => {
  assert.equal(renderText(EN, text("aborted")), EN.aborted, "fixed text must not be called");
});

test("should call the message function with the params when the message is a function", () => {
  assert.equal(
    renderText(EN, text("unknownFlag", "--x")),
    "unknown flag: --x",
    "params must reach the message function",
  );
});

test("should return the datum value untouched in any language", () => {
  assert.equal(renderText(EN, datum("1.2.3")), "1.2.3", "data must not depend on the table");
  assert.equal(renderText(PT, datum("1.2.3")), "1.2.3", "data must not depend on the table");
});

test("should throw when the key does not exist in the table", () => {
  assert.throws(
    () => renderText(EN, text("noSuchKey")),
    TypeError,
    "a missing key must fail loud, never render empty text",
  );
});

test("should build a descriptor with key and params from text", () => {
  assert.deepEqual(text("unknownFlag", "--x"), { key: "unknownFlag", params: ["--x"] });
  assert.deepEqual(datum(7), { value: 7 });
});

for (const [name, Klass] of [
  ["UsageError", UsageError],
  ["InvariantError", InvariantError],
]) {
  test(`should make ${name} an Error and a LocalizedError with the en message`, () => {
    const error = new Klass("unknownFlag", ["--x"]);
    assert.ok(error instanceof Error, "must be catchable as Error");
    assert.ok(error instanceof LocalizedError, "must share the localized base");
    assert.equal(error.message, EN.unknownFlag("--x"), "message is canonical English for logs");
    assert.equal(error.key, "unknownFlag", "key is needed to render in another language");
    assert.deepEqual(error.params, ["--x"], "params are needed to render in another language");
  });

  test(`should accept a fixed-text key and empty params in ${name}`, () => {
    const error = new Klass("aborted");
    assert.equal(error.message, EN.aborted, "fixed text must become the message");
    assert.deepEqual(error.params, [], "params default to empty");
  });

  test(`should preserve the cause in ${name}`, () => {
    const cause = new Error("root");
    const error = new Klass("unknownFlag", ["--x"], { cause });
    assert.equal(error.cause, cause, "cause keeps the original failure traceable");
  });
}

for (const [lang, tabela] of [
  ["en", EN],
  ["pt-BR", PT],
]) {
  test(`should render a UsageError with its own message in ${lang}`, () => {
    const error = new UsageError("unknownFlag", ["--x"]);
    assert.equal(renderError(tabela, error), tabela.unknownFlag("--x"), "usage errors show only the text");
  });

  test(`should prefix an InvariantError with the internal defect notice in ${lang}`, () => {
    const error = new InvariantError("unknownFlag", ["--x"]);
    assert.equal(
      renderError(tabela, error),
      `${tabela.internalDefect}\n${tabela.unknownFlag("--x")}`,
      "invariants must tell the user it is an MGR defect",
    );
  });

  test(`should render a system error with path in ${lang}`, () => {
    const error = Object.assign(new Error("platform text"), {
      code: "ENOENT",
      syscall: "open",
      path: "/tmp/x",
    });
    assert.equal(renderError(tabela, error), tabela.systemError("ENOENT", "open", "/tmp/x"));
  });

  test(`should render a system error without path in ${lang}`, () => {
    const error = Object.assign(new Error("platform text"), { code: "EACCES", syscall: "mkdir" });
    assert.equal(renderError(tabela, error), tabela.systemErrorNoPath("EACCES", "mkdir"));
  });

  test(`should render an error with a string code and no syscall as unexpected in ${lang}`, () => {
    const error = Object.assign(new Error("platform text"), { code: "ENOENT" });
    assert.equal(renderError(tabela, error), tabela.unexpectedError("Error"));
  });

  test(`should render an error with a string syscall and no code as unexpected in ${lang}`, () => {
    const error = Object.assign(new Error("platform text"), { syscall: "open" });
    assert.equal(renderError(tabela, error), tabela.unexpectedError("Error"));
  });

  test(`should render any other error as unexpected without platform text in ${lang}`, () => {
    const error = new TypeError("x is not a function");
    const rendered = renderError(tabela, error);
    assert.equal(rendered, tabela.unexpectedError("TypeError"), "only the error name may appear");
    assert.ok(!rendered.includes("is not a function"), "platform text varies by system");
  });
}

test("should fall back to unexpected when the table lacks the UsageError key", () => {
  const error = new UsageError("unknownFlag", ["--x"]);
  const table = { ...EN };
  delete table.unknownFlag;
  assert.equal(renderError(table, error), EN.unexpectedError(error.name));
});

test("should fall back to unexpected when the table lacks the InvariantError key", () => {
  const error = new InvariantError("unknownFlag", ["--x"]);
  const table = { ...EN };
  delete table.unknownFlag;
  assert.equal(renderError(table, error), EN.unexpectedError(error.name));
});

test("should render a non-Error throwable as unexpected Error", () => {
  assert.equal(renderError(EN, undefined), EN.unexpectedError("Error"));
});

const SRC_DIR = fileURLToPath(new URL("../../src", import.meta.url));
const NEW_ERROR = /new\s+(UsageError|InvariantError)\(\s*"([A-Za-z0-9_]+)"/g;
const SUBCLASS = /class\s+\w+\s+extends\s+(UsageError|InvariantError)\b[^]*?super\(\s*"([A-Za-z0-9_]+)"/g;

const sourceFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });

const scanKeys = () => {
  const usage = new Set();
  const invariant = new Set();
  for (const file of sourceFiles(SRC_DIR)) {
    const content = readFileSync(file, "utf8");
    for (const pattern of [NEW_ERROR, SUBCLASS]) {
      for (const [, kind, key] of content.matchAll(pattern)) {
        (kind === "InvariantError" ? invariant : usage).add(key);
      }
    }
  }
  return { usage: [...usage].sort(), invariant: [...invariant].sort() };
};

const SAMPLES = ["x", ["x"], 1, {}, [{ key: "aborted", params: [] }]];
const SAMPLE_ARITY = 4;

const rendersWith = (tabela, key, params) => {
  try {
    return typeof renderText(tabela, text(key, ...params)) === "string";
  } catch {
    return false;
  }
};

const sampleParams = (key) => {
  const total = SAMPLES.length ** SAMPLE_ARITY;
  for (let n = 0; n < total; n += 1) {
    const params = Array.from({ length: SAMPLE_ARITY }, (_, i) => SAMPLES[Math.floor(n / SAMPLES.length ** i) % SAMPLES.length]);
    if (rendersWith(EN, key, params) && rendersWith(PT, key, params)) return params;
  }
  return null;
};

const KEYS = scanKeys();
const ALL_KEYS = [...new Set([...KEYS.usage, ...KEYS.invariant])].sort();

test("should find error keys in src for both UsageError and InvariantError", () => {
  assert.ok(KEYS.usage.length > 0, "the scan must find usage error keys");
  assert.ok(KEYS.invariant.length > 0, "the scan must find invariant keys");
  assert.ok(KEYS.usage.includes("installCancelled"), "subclass keys must be scanned");
});

test("should have every error key from src in the en and pt-BR tables", () => {
  const missingEn = ALL_KEYS.filter((key) => EN[key] === undefined);
  const missingPt = ALL_KEYS.filter((key) => PT[key] === undefined);
  assert.deepEqual({ missingEn, missingPt }, { missingEn: [], missingPt: [] });
});

test("should render every error key from src in en and pt-BR with sample params", () => {
  const notRendering = ALL_KEYS.filter((key) => EN[key] !== undefined && PT[key] !== undefined && sampleParams(key) === null);
  assert.deepEqual(notRendering, [], "keys whose message function throws with every sample");
});

test("should render every error key from src with different text in en and pt-BR", () => {
  const sameText = ALL_KEYS.filter((key) => {
    const params = EN[key] !== undefined && PT[key] !== undefined ? sampleParams(key) : null;
    return params !== null && renderText(EN, text(key, ...params)) === renderText(PT, text(key, ...params));
  });
  assert.deepEqual(sameText, [], "keys whose en and pt-BR texts are identical");
});

for (const [lang, tabela] of [
  ["en", EN],
  ["pt-BR", PT],
]) {
  test(`should render every InvariantError key from src as internal defect plus the phrase in ${lang}`, () => {
    const wrong = KEYS.invariant.filter((key) => {
      const params = sampleParams(key) ?? [];
      if (tabela[key] === undefined) return true;
      return renderError(tabela, new InvariantError(key, params)) !== `${tabela.internalDefect}\n${renderText(tabela, text(key, ...params))}`;
    });
    assert.deepEqual(wrong, []);
  });
}

test("should make InstallCancelled a UsageError with the cancelled exit code", () => {
  const error = new InstallCancelled("junit");
  assert.ok(error instanceof UsageError, "cancellation is a usage outcome, not an MGR defect");
  assert.equal(error.exitCode, 2);
  assert.equal(error.key, "installCancelled");
  assert.equal(renderError(PT, error), renderText(PT, text("installCancelled", "junit")));
});

const DETAIL_LINES = [text("aborted"), text("unknownFlag", "--y")];

test("should keep the details on the error and append their lines to the en message", () => {
  const error = new UsageError("unknownFlag", ["--x"], { details: DETAIL_LINES });
  assert.deepEqual(error.details, DETAIL_LINES);
  assert.equal(error.message, [EN.unknownFlag("--x"), EN.aborted, EN.unknownFlag("--y")].join("\n"));
});

test("should default the details to an empty list and keep the message a single line", () => {
  const error = new UsageError("unknownFlag", ["--x"], { cause: new Error("root") });
  assert.deepEqual(error.details, []);
  assert.equal(error.message, EN.unknownFlag("--x"));
});

for (const [lang, tabela] of [
  ["en", EN],
  ["pt-BR", PT],
]) {
  test(`should render a UsageError with details as the key line plus one line per detail in ${lang}`, () => {
    const error = new UsageError("unknownFlag", ["--x"], { details: DETAIL_LINES });
    assert.equal(
      renderError(tabela, error),
      [tabela.unknownFlag("--x"), tabela.aborted, tabela.unknownFlag("--y")].join("\n"),
      "key line first, then the details in the given order",
    );
  });

  test(`should render a UsageError with empty details as a single line in ${lang}`, () => {
    const error = new UsageError("unknownFlag", ["--x"], { details: [] });
    assert.equal(renderError(tabela, error), tabela.unknownFlag("--x"));
  });

  test(`should fall back to unexpected when the table lacks a detail key in ${lang}`, () => {
    const error = new UsageError("unknownFlag", ["--x"], { details: [text("aborted")] });
    const incomplete = { ...tabela };
    delete incomplete.aborted;
    assert.equal(renderError(incomplete, error), tabela.unexpectedError(error.name));
  });
}
