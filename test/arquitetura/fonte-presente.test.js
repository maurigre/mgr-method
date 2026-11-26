import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { caminhoDaFatia, pastasDasFatias } from "../helpers/fonte-presente.js";
import { tempDir } from "../../scripts/lib/tmp.mjs";

const repoCom = (pastas) => {
  const raiz = tempDir("mgr-fonte-");
  for (const pasta of pastas) mkdirSync(path.join(raiz, "specs", pasta), { recursive: true });
  return raiz;
};

test("should prefer the active feature over an archived one with the same slug", () => {
  const raiz = repoCom(["x", "archive/2026-01-01-x"]);
  assert.equal(caminhoDaFatia("x", raiz), path.join(raiz, "specs", "x"));
});

test("should resolve a feature that only exists in the archive to its archived folder", () => {
  const raiz = repoCom(["archive/2026-01-01-x"]);
  assert.equal(caminhoDaFatia("x", raiz), path.join(raiz, "specs", "archive", "2026-01-01-x"));
});

test("should throw when the same slug is archived twice instead of picking one", () => {
  const raiz = repoCom(["archive/2026-01-01-x", "archive/2026-02-01-x"]);
  assert.throws(() => caminhoDaFatia("x", raiz), /mais de um arquivado com o slug "x"/);
});

test("should fall back to specs/<slug> so the absence is declared when the feature is nowhere", () => {
  const raiz = repoCom([]);
  assert.equal(caminhoDaFatia("x", raiz), path.join(raiz, "specs", "x"));
});

test("should list the active folders and then the archived ones", () => {
  const raiz = repoCom(["um", "archive/2026-01-01-velha"]);
  assert.deepEqual(pastasDasFatias(raiz), [path.join(raiz, "specs", "um"), path.join(raiz, "specs", "archive", "2026-01-01-velha")]);
});
