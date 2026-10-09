import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getMessages } from "../src/messages.js";

const LANGS = ["en", "pt-BR"];
const SCALAR_ARGS = ["a", "b", "c", "d", "e"];
const LIST_ARGS = [["a", "b"], ["c"], ["d"], ["e"], ["f"]];
const ARG_SETS = [SCALAR_ARGS, LIST_ARGS];

function callOrMarker(fn, args) {
  try {
    return fn(...args);
  } catch (error) {
    return `<threw ${error.name}>`;
  }
}

function snapshotOf(table) {
  const out = {};
  for (const [key, value] of Object.entries(table)) {
    if (typeof value === "function") {
      out[key] = ARG_SETS.map((args) => callOrMarker(value, args));
    } else {
      out[key] = value;
    }
  }
  return out;
}

function renderedStrings(table) {
  const strings = [];
  for (const value of Object.values(table)) {
    if (typeof value === "string") {
      strings.push(value);
    } else if (typeof value === "function") {
      for (const args of ARG_SETS) {
        const result = callOrMarker(value, args);
        if (typeof result === "string" && !result.startsWith("<threw")) {
          strings.push(result);
        }
      }
    }
  }
  return strings;
}

test("should render the same messages when no invocation options are passed as with the mgr defaults", () => {
  for (const lang of LANGS) {
    const implicit = snapshotOf(getMessages(lang));
    const explicit = snapshotOf(getMessages(lang, { invocation: "mgr", lifecycle: "mgr" }));
    assert.deepEqual(implicit, explicit, `lang ${lang}`);
  }
});

test("should keep the literal mgr prefix in the effort note when invocation is the default", () => {
  const en = getMessages("en").agentsEffortNote;
  const pt = getMessages("pt-BR").agentsEffortNote;
  assert.match(en, /`mgr agents apply`/);
  assert.doesNotMatch(en, /`mgr update`/);
  assert.match(pt, /`mgr agents apply`/);
  assert.doesNotMatch(pt, /`mgr update`/);
});

test("should name the runtime invocation and the lifecycle command when they are passed", () => {
  for (const lang of LANGS) {
    const strings = renderedStrings(getMessages(lang, { invocation: "node X", lifecycle: "npx mgr-method@1.2.3" }));
    assert.equal(
      strings.some((text) => /`mgr [a-z]/.test(text)),
      false,
      `lang ${lang}: no message may keep a literal \`mgr <command>\``,
    );
    assert.ok(
      strings.some((text) => text.includes("node X spec validate")),
      `lang ${lang}: a message must name the runtime invocation`,
    );
    assert.ok(
      strings.some((text) => text.includes("npx mgr-method@1.2.3 update")),
      `lang ${lang}: a message must name the lifecycle command`,
    );
  }
});

test("should keep the effort note pointing at agents apply when the runtime invocation is passed", () => {
  const en = getMessages("en", { invocation: "node X" }).agentsEffortNote;
  const pt = getMessages("pt-BR", { invocation: "node X" }).agentsEffortNote;
  assert.match(en, /`node X agents apply`/);
  assert.match(pt, /`node X agents apply`/);
});

const BASELINE = JSON.parse(
  readFileSync(new URL("./fixtures/messages-baseline.json", import.meta.url), "utf8"),
);
const BASELINE_ARGS = [["a", "b", "c", "d"], [["x"], ["y"], 2, 3]];
const DELIBERADAS = ["agentsEffortNote", "agentsSetEffortEffect", "help", "planConfigHint"];
const EFFORT_KEYS = ["agentsEffortNote", "agentsSetEffortEffect"];

function snapshotWithBaselineArgs(table) {
  const out = {};
  for (const [key, value] of Object.entries(table)) {
    if (typeof value === "function") {
      out[key] = BASELINE_ARGS.map((args) => {
        try {
          return String(value(...args));
        } catch (error) {
          return `THROWS:${error.name}`;
        }
      });
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

test("should keep every message key that the base snapshot has", () => {
  for (const lang of LANGS) {
    const current = snapshotWithBaselineArgs(getMessages(lang));
    const missing = Object.keys(BASELINE[lang]).filter((key) => !Object.hasOwn(current, key));
    assert.deepEqual(missing, [], `lang ${lang}: keys removed from the base`);
  }
});

test("should render every base message identically except the deliberate changes", () => {
  for (const lang of LANGS) {
    const current = snapshotWithBaselineArgs(getMessages(lang));
    for (const key of Object.keys(BASELINE[lang])) {
      if (DELIBERADAS.includes(key)) {
        continue;
      }
      assert.deepEqual(current[key], BASELINE[lang][key], `lang ${lang}: ${key} changed`);
    }
  }
});

test("should differ from the base effort messages only by the mgr update to agents apply rename", () => {
  for (const lang of LANGS) {
    const current = snapshotWithBaselineArgs(getMessages(lang));
    for (const key of EFFORT_KEYS) {
      const expected = BASELINE[lang][key].replaceAll("mgr update", "mgr agents apply");
      assert.deepEqual(current[key], expected, `lang ${lang}: ${key}`);
    }
  }
});

test("should keep every base help line present when the help message gains new lines", () => {
  for (const lang of LANGS) {
    const currentLines = new Set(getMessages(lang).help.split("\n"));
    const missing = BASELINE[lang].help.split("\n").filter((line) => !currentLines.has(line));
    assert.deepEqual(missing, [], `lang ${lang}: help lines removed from the base`);
  }
});
