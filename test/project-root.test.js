import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RUNTIME_DIR_NAME } from "../src/bundle.js";
import { MANIFEST_NAME } from "../src/manifest.js";
import { repoRoot } from "../src/artifacts.js";
import { projectRoot } from "../src/project-root.js";

const temporario = () => mkdtempSync(path.join(tmpdir(), "mgr-root-"));

const comMarcador = (dir) => {
  mkdirSync(path.join(dir, RUNTIME_DIR_NAME), { recursive: true });
  writeFileSync(path.join(dir, RUNTIME_DIR_NAME, MANIFEST_NAME), "{}");
  return dir;
};

test("should climb to the first marker across intermediate .git and package.json", () => {
  const raiz = comMarcador(temporario());
  const pacote = path.join(raiz, "packages", "a");
  mkdirSync(path.join(pacote, ".git"), { recursive: true });
  writeFileSync(path.join(pacote, "package.json"), "{}");
  const profundo = path.join(pacote, "src", "deep");
  mkdirSync(profundo, { recursive: true });

  assert.deepEqual(projectRoot(profundo, { home: temporario() }), { root: raiz, via: "marker" });
});

test("should return the nearest marker when both parent and child have one", () => {
  const pai = comMarcador(temporario());
  const filho = comMarcador(path.join(pai, "filho"));
  const neto = path.join(filho, "src");
  mkdirSync(neto, { recursive: true });

  assert.deepEqual(projectRoot(neto, { home: temporario() }), { root: filho, via: "marker" });
});

test("should ignore the home marker when home is injected", () => {
  const home = comMarcador(temporario());
  const dentro = path.join(home, "projeto", "src");
  mkdirSync(dentro, { recursive: true });

  const resultado = projectRoot(dentro, { home });
  assert.deepEqual(resultado, { root: repoRoot(dentro), via: "fallback" }, "a home nunca vira raiz de projeto");
});

test("should fall back to repoRoot with via fallback when there is no marker", () => {
  const dir = path.join(temporario(), "sem", "marcador");
  mkdirSync(dir, { recursive: true });

  assert.deepEqual(projectRoot(dir, { home: temporario() }), { root: repoRoot(dir), via: "fallback" });
});

test("should resolve a relative start path before climbing", () => {
  const raiz = comMarcador(temporario());
  const profundo = path.join(raiz, "a", "b");
  mkdirSync(profundo, { recursive: true });
  const relativo = path.relative(process.cwd(), profundo);

  assert.deepEqual(projectRoot(relativo, { home: temporario() }), { root: raiz, via: "marker" });
});
