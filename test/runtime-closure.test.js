import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_FILES } from "../src/catalog.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = "bin/mgr-runtime.js";
const FROM_RE = /\bfrom\s+["']([^"']+)["']/g;
const BARE_IMPORT_RE = /\bimport\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(/;

function specifiersOf(source) {
  const found = [];
  for (const re of [FROM_RE, BARE_IMPORT_RE]) {
    for (const match of source.matchAll(re)) found.push(match[1]);
  }
  return found;
}

function computeClosure() {
  const closure = new Map();
  const queue = [ENTRY];
  while (queue.length > 0) {
    const rel = queue.shift();
    if (closure.has(rel)) continue;
    const specs = specifiersOf(readFileSync(path.join(ROOT, rel), "utf8"));
    closure.set(rel, specs);
    for (const spec of specs) {
      if (spec.startsWith("./") || spec.startsWith("../")) {
        queue.push(path.posix.join(path.posix.dirname(rel), spec));
      }
    }
  }
  return closure;
}

test("should declare RUNTIME_FILES as exactly the import closure of the runtime entry", () => {
  const closure = [...computeClosure().keys()].sort();
  assert.deepEqual([...RUNTIME_FILES], closure);
});

test("should keep RUNTIME_FILES sorted so the declared list is stable across edits", () => {
  assert.deepEqual([...RUNTIME_FILES], [...RUNTIME_FILES].sort());
});

test("should allow only relative or node: specifiers in every file of the closure", () => {
  const violations = [];
  for (const [rel, specs] of computeClosure()) {
    for (const spec of specs) {
      if (!spec.startsWith("./") && !spec.startsWith("../") && !spec.startsWith("node:")) {
        violations.push(`${rel} -> ${spec}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("should keep src/banner.js out of the runtime closure", () => {
  assert.equal(computeClosure().has("src/banner.js"), false);
});

test("should keep test files and bin/mgr.js out of the runtime closure", () => {
  const offending = [...computeClosure().keys()].filter(
    (rel) => rel.startsWith("test/") || rel === "bin/mgr.js",
  );
  assert.deepEqual(offending, []);
});

test("should find no dynamic import() call in any file of the runtime closure", () => {
  const offending = [];
  for (const rel of computeClosure().keys()) {
    if (DYNAMIC_IMPORT_RE.test(readFileSync(path.join(ROOT, rel), "utf8"))) offending.push(rel);
  }
  assert.deepEqual(offending, []);
});
