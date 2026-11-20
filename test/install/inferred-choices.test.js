import { test } from "node:test";
import assert from "node:assert/strict";
import { inferredChoices } from "../../src/install/installer.js";
import * as catalog from "../../src/core/catalog.js";

const ARQUITETURAS = Object.values(catalog.ARCHITECTURES);

test("should keep the recorded choices when the manifest has them", () => {
  assert.deepEqual(inferredChoices({ skills: [], optional: ["evidence-capture"], allSkills: false }),
    { userLanguage: "pt-BR", optional: ["evidence-capture"], allSkills: false });
});

test("should infer the legacy pt-BR userLanguage when it is null", () => {
  assert.equal(inferredChoices({ skills: [], userLanguage: null }).userLanguage, "pt-BR");
});

test("should infer the legacy pt-BR userLanguage when it is an empty text", () => {
  assert.equal(inferredChoices({ skills: [], userLanguage: "" }).userLanguage, "pt-BR");
});

test("should keep a recorded userLanguage", () => {
  assert.equal(inferredChoices({ skills: [], userLanguage: "en" }).userLanguage, "en");
});

test("should infer allSkills only when the four architectures are declared (D-14)", () => {
  assert.equal(inferredChoices({ skills: [...catalog.CORE, ...ARQUITETURAS] }).allSkills, true);
  assert.equal(inferredChoices({ skills: [...catalog.CORE, ...ARQUITETURAS.slice(1)] }).allSkills, false);
});

test("should infer optional as the shipped optional skills that are declared", () => {
  assert.deepEqual(inferredChoices({ skills: [...catalog.CORE, "evidence-capture"] }).optional,
    catalog.OPTIONAL.filter((nome) => nome === "evidence-capture"));
});
