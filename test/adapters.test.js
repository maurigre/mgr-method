import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyManifestToSkillMd, applyToEngine, compositionHeader, copilotApplied,
  injectCompositionHeader, injectFrontmatter, resolveInstallDirName, PLUGIN_ENGINES,
} from "../src/adapters.js";

const SKILL_MD = `---
name: junit-clean
description: Standardizes Java unit tests with JUnit 5 following strict quality rules.
---

# junit-clean

Instructions here.
`;

const manifest = (overrides = {}) => ({
  name: "@mgr/junit-clean",
  version: "1.0.0",
  author: "Mauri Reis",
  description: "Standardizes Java unit tests with JUnit 5 following strict quality rules.",
  category: "language",
  model: { "claude-code": "sonnet", copilot: "Claude Sonnet 4.5" },
  effort: "medium",
  ...overrides,
});

const installedSkill = (text = SKILL_MD) => {
  const dir = path.join(mkdtempSync(path.join(os.tmpdir(), "mgr-adapters-")), "junit-clean");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), text, "utf8");
  return dir;
};

test("injectFrontmatter acrescenta campos novos e substitui existentes preservando o resto", () => {
  const injected = injectFrontmatter(SKILL_MD, { model: "sonnet", effort: "medium" });
  assert.match(injected, /name: junit-clean/);
  assert.match(injected, /model: sonnet/);
  assert.match(injected, /effort: medium/);

  const replaced = injectFrontmatter(injected, { effort: "high" });
  assert.match(replaced, /effort: high/);
  assert.ok(!replaced.includes("effort: medium"), "campo existente é substituído, não duplicado");
  assert.match(replaced, /# junit-clean/, "corpo intocado");

  assert.throws(() => injectFrontmatter("no frontmatter", { model: "sonnet" }), /no YAML frontmatter/);
});

test("applyManifestToSkillMd injeta model/effort do manifest e devolve applied", () => {
  const { text, applied } = applyManifestToSkillMd(SKILL_MD, manifest());
  assert.match(text, /model: sonnet/);
  assert.match(text, /effort: medium/);
  assert.deepEqual(applied, { model: "sonnet", effort: "medium" });
});

test("applyManifestToSkillMd sem model/effort não altera o arquivo", () => {
  const plain = manifest({ model: undefined, effort: undefined });
  const { text, applied } = applyManifestToSkillMd(SKILL_MD, plain);
  assert.equal(text, SKILL_MD);
  assert.deepEqual(applied, {});
});

test("copilotApplied degrada model/effort declarados em warnings, nunca falha", () => {
  const { warnings } = copilotApplied(manifest());
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /model "Claude Sonnet 4\.5" declared but copilot .* ignored/);
  assert.match(warnings[1], /effort "medium" not supported by copilot .* global only/);

  assert.deepEqual(copilotApplied(manifest({ model: undefined, effort: undefined })), {});
});

test("resolveInstallDirName aplica sufixo do registry apenas em colisão", () => {
  assert.equal(resolveInstallDirName("postgres", "mgr", false), "postgres");
  assert.equal(resolveInstallDirName("postgres", "empresa", true), "postgres--empresa");
});

test("injectCompositionHeader insere o cabeçalho de precedência logo após o frontmatter", () => {
  const header = compositionHeader("@mgr/postgres", ".claude/skills/postgres");
  const composed = injectCompositionHeader(SKILL_MD, header);
  const afterFrontmatter = composed.split("---\n")[2];
  assert.ok(afterFrontmatter.trimStart().startsWith("> This skill extends `@mgr/postgres`"));
  assert.match(composed, /this skill takes precedence/);
});

test("applyToEngine claude-code grava frontmatter traduzido e devolve applied", () => {
  const dir = installedSkill();
  const applied = applyToEngine("claude-code", dir, manifest());
  assert.deepEqual(applied, { model: "sonnet", effort: "medium" });
  const written = readFileSync(path.join(dir, "SKILL.md"), "utf8");
  assert.match(written, /model: sonnet/);
  assert.match(written, /effort: medium/);
});

test("applyToEngine copilot não injeta campos e devolve warnings de degradação", () => {
  const dir = installedSkill();
  const applied = applyToEngine("copilot", dir, manifest());
  assert.equal(applied.warnings.length, 2);
  const written = readFileSync(path.join(dir, "SKILL.md"), "utf8");
  assert.ok(!written.includes("model:") || written.includes("name: junit-clean"), "frontmatter original preservado");
  assert.ok(!written.includes("effort:"));
});

test("applyToEngine injeta composição do extends quando a base está instalada", () => {
  const dir = installedSkill();
  const extended = manifest({ extends: "@mgr/postgres" });
  applyToEngine("claude-code", dir, extended, { extendsBase: ".claude/skills/postgres" });
  const written = readFileSync(path.join(dir, "SKILL.md"), "utf8");
  assert.match(written, /extends `@mgr\/postgres` \(installed at `\.claude\/skills\/postgres`\)/);
});

test("applyToEngine rejeita motor desconhecido; motores suportados fixos", () => {
  assert.deepEqual(PLUGIN_ENGINES, ["claude-code", "copilot"]);
  assert.throws(() => applyToEngine("cursor", installedSkill(), manifest()), /invalid engine for plugin install: cursor/);
});
