import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateChecksum, assertValidManifest, parseSkillName, sha256, validateManifest,
  CATEGORIES, EFFORT_LEVELS, PERMISSIONS,
} from "../src/plugin.js";

const manifest = (overrides = {}) => ({
  name: "@mgr/junit-clean",
  version: "1.0.0",
  author: "Mauri Reis",
  description: "Standardizes Java unit tests with JUnit 5 following strict quality rules. Use when creating or refactoring Java tests.",
  category: "language",
  ...overrides,
});

test("parseSkillName decompõe o nome namespaced", () => {
  assert.deepEqual(parseSkillName("@mgr/junit-clean"), { registry: "mgr", skill: "junit-clean" });
  assert.deepEqual(parseSkillName("@empresa/postgres"), { registry: "empresa", skill: "postgres" });
});

test("parseSkillName rejeita nomes fora do padrão @registry/skill", () => {
  for (const bad of ["junit-clean", "@mgr", "@mgr/", "@MGR/skill", "@mgr/skill--x", "@mgr/-skill", "@m gr/skill", "", null, 42]) {
    assert.throws(() => parseSkillName(bad), /invalid skill name/);
  }
});

test("validateManifest aceita manifest mínimo e completo", () => {
  assert.deepEqual(validateManifest(manifest()), []);
  assert.deepEqual(validateManifest(manifest({ description: "x".repeat(40) })), []);
  assert.deepEqual(validateManifest(manifest({ description: "x".repeat(1024) })), []);
  assert.deepEqual(validateManifest(manifest({
    compatibility: { mgr: ">=0.6.0" },
    extends: "@mgr/base-skill",
    permissions: ["read-files", "write-files"],
    capabilities: { requires: ["subagents"], optional: ["model-selection"] },
    model: { "claude-code": "sonnet", copilot: "Claude Sonnet 4.5" },
    effort: "medium",
    testedModels: ["Claude Sonnet 4.5"],
  })), []);
});

test("validateManifest reprova cada regra com mensagem específica", () => {
  const cases = [
    [manifest({ name: "junit-clean" }), /"name" must be namespaced/],
    [manifest({ version: "1.0" }), /"version" must be semver/],
    [manifest({ author: "  " }), /"author" is required/],
    [manifest({ description: "x".repeat(39) }), /"description" must be a string of 40-1024/],
    [manifest({ description: "x".repeat(1025) }), /"description" must be a string of 40-1024/],
    [manifest({ description: 42 }), /"description" must be a string of 40-1024/],
    [manifest({ category: "games" }), /"category" must be one of/],
    [manifest({ compatibility: { node: ">=22" } }), /"compatibility" must be an object with an "mgr"/],
    [manifest({ extends: "base" }), /"extends" must be a namespaced skill name/],
    [manifest({ permissions: ["sudo"] }), /"permissions" must be an array of/],
    [manifest({ capabilities: { requires: "subagents" } }), /"capabilities" must be an object/],
    [manifest({ model: { "claude-code": "" } }), /"model" must map platform/],
    [manifest({ testedModels: "sonnet" }), /"testedModels" must be an array/],
  ];
  for (const [invalid, expected] of cases) {
    const problems = validateManifest(invalid);
    assert.equal(problems.length, 1, JSON.stringify(invalid));
    assert.match(problems[0], expected);
  }
});

test("validateManifest reprova entradas que não são objeto", () => {
  for (const bad of [null, [], "manifest", 7]) {
    assert.deepEqual(validateManifest(bad), ["manifest must be a JSON object"]);
  }
});

test("assertValidManifest lança com todos os problemas na mensagem", () => {
  assert.equal(assertValidManifest(manifest()).name, "@mgr/junit-clean");
  assert.throws(
    () => assertValidManifest(manifest({ version: "x", effort: "extreme" })),
    /invalid mgr-manifest\.json: .*"version".*; .*"effort"/,
  );
});

test("effort aceita xhigh depois da emenda do ADR-0010 ao ADR-0004", () => {
  assert.doesNotThrow(() => assertValidManifest(manifest({ effort: "xhigh" })));
});

test("listas fechadas da v1 conforme ADR-0004", () => {
  assert.deepEqual(EFFORT_LEVELS, ["low", "medium", "high", "xhigh", "max"]);
  assert.ok(CATEGORIES.includes("language") && CATEGORIES.includes("database"));
  assert.deepEqual(PERMISSIONS, ["read-files", "write-files", "run-shell", "network"]);
});

test("sha256 e aggregateChecksum são determinísticos e sensíveis a conteúdo", () => {
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

  const files = [
    { path: "SKILL.md", content: "# Skill\n" },
    { path: "mgr-manifest.json", content: "{}\n" },
    { path: "templates/example.md", content: "example\n" },
  ];
  const reversed = [...files].reverse();
  const checksum = aggregateChecksum(files);
  assert.equal(checksum, aggregateChecksum(reversed), "ordem de entrada não pode alterar o hash");
  assert.match(checksum, /^sha256-[0-9a-f]{64}$/);

  const tampered = files.map((file) => (file.path === "SKILL.md" ? { ...file, content: "# Skill!\n" } : file));
  assert.notEqual(checksum, aggregateChecksum(tampered), "conteúdo alterado deve mudar o hash");

  // Vetor fixo: garante a estabilidade do algoritmo (path + \n + bytes, ordem lexicográfica).
  assert.equal(
    aggregateChecksum([{ path: "a.md", content: "a" }, { path: "b.md", content: "b" }]),
    `sha256-${sha256("a.md\nab.md\nb")}`,
  );
});

test("ecosystems é opcional, kebab e de vocabulário aberto", () => {
  assert.deepEqual(validateManifest(manifest()), [], "ausente segue válido");
  assert.deepEqual(validateManifest(manifest({ ecosystems: [] })), [], "vazio é válido e nunca sugere");
  assert.deepEqual(validateManifest(manifest({ ecosystems: ["java", "postgres"] })), []);
  assert.deepEqual(validateManifest(manifest({ ecosystems: ["kafka"] })), [],
    "token que o detector ainda não conhece é aceito — vocabulário aberto");

  for (const invalido of [["Java"], ["java_ee"], [""], ["java", 7], "java", { java: true }]) {
    const problems = validateManifest(manifest({ ecosystems: invalido }));
    assert.equal(problems.length, 1, JSON.stringify(invalido));
    assert.match(problems[0], /"ecosystems" must be an array of kebab-case/);
  }
});
