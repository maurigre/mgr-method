import { test } from "node:test";
import assert from "node:assert/strict";
import { inferredChoices } from "../src/installer.js";
import * as catalog from "../src/catalog.js";

const ARQUITETURAS = Object.values(catalog.ARCHITECTURES);

test("should keep the recorded choices when the manifest has them", () => {
  assert.deepEqual(inferredChoices({ skills: [], optional: ["evidence-capture"], allSkills: false }),
    { optional: ["evidence-capture"], allSkills: false });
});

test("should infer allSkills only when the four architectures are declared (D-14)", () => {
  assert.equal(inferredChoices({ skills: [...catalog.CORE, ...ARQUITETURAS] }).allSkills, true);
  assert.equal(inferredChoices({ skills: [...catalog.CORE, ...ARQUITETURAS.slice(1)] }).allSkills, false);
});

test("should infer optional as the shipped optional skills that are declared", () => {
  assert.deepEqual(inferredChoices({ skills: [...catalog.CORE, "evidence-capture"] }).optional,
    catalog.OPTIONAL.filter((nome) => nome === "evidence-capture"));
});
