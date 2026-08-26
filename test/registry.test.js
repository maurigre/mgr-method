import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addRegistry, configPath, fetchIndex, listRegistries, readConfig, readDetectionMode,
  removeRegistry, resolve, validateIndex, writeConfig,
} from "../src/registry.js";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "mgr-registry-"));

const INDEX_URL = "https://raw.githubusercontent.com/maurigre/mgr-registry/main/index.json";

const indexFixture = () => ({
  indexVersion: 1,
  registry: "mgr",
  generatedAt: "2026-07-20T00:00:00.000Z",
  categories: {
    language: [{
      name: "@mgr/junit-clean",
      version: "1.0.0",
      description: "Standardizes Java unit tests with JUnit 5.",
      checksum: `sha256-${"a".repeat(64)}`,
      files: [{ path: "SKILL.md", url: "https://raw.example/junit-clean/SKILL.md", sha256: "b".repeat(64) }],
    }],
  },
});

const fetchStub = (body, { ok = true, status = 200 } = {}) => async () => ({
  ok,
  status,
  json: async () => {
    if (typeof body === "string") throw new SyntaxError("Unexpected token");
    return body;
  },
});

test("config de registries: add/list/remove persistem em .mgr-core/config.json", () => {
  const core = tmp();
  assert.deepEqual(readConfig(core), { registries: [] });

  addRegistry(core, { name: "mgr", url: INDEX_URL, trusted: true });
  addRegistry(core, { name: "empresa", url: "https://registry.empresa.dev/index.json" });
  assert.ok(existsSync(configPath(core)));
  assert.deepEqual(listRegistries(core), [
    { name: "mgr", url: INDEX_URL, trusted: true },
    { name: "empresa", url: "https://registry.empresa.dev/index.json", trusted: false },
  ]);

  removeRegistry(core, "empresa");
  assert.deepEqual(listRegistries(core).map((registry) => registry.name), ["mgr"]);
  assert.match(readFileSync(configPath(core), "utf8"), /"registries"/);
});

test("addRegistry valida nome, url e duplicidade", () => {
  const core = tmp();
  assert.throws(() => addRegistry(core, { name: "MGR", url: INDEX_URL }), /invalid registry name/);
  assert.throws(() => addRegistry(core, { name: "mgr", url: "ftp://x" }), /invalid registry url/);
  addRegistry(core, { name: "mgr", url: INDEX_URL });
  assert.throws(() => addRegistry(core, { name: "mgr", url: INDEX_URL }), /registry already configured/);
});

test("removeRegistry de nome não configurado é erro explícito", () => {
  assert.throws(() => removeRegistry(tmp(), "ghost"), /registry not configured: ghost/);
});

test("writeConfig preserva campos desconhecidos do config", () => {
  const core = tmp();
  writeConfig(core, { registries: [], detectionMode: "suggest" });
  addRegistry(core, { name: "mgr", url: INDEX_URL });
  removeRegistry(core, "mgr");
  assert.equal(readConfig(core).detectionMode, "suggest");
});

test("validateIndex aceita index gerado válido", () => {
  assert.deepEqual(validateIndex(indexFixture()), []);
});

test("validateIndex reprova cada regra com mensagem específica", () => {
  const valid = indexFixture();
  const entry = valid.categories.language[0];
  const cases = [
    [{ ...valid, indexVersion: 2 }, /unsupported "indexVersion"/],
    [{ ...valid, registry: "" }, /"registry" must be a non-empty string/],
    [{ indexVersion: 1, registry: "mgr" }, /"categories" must be an object/],
    [{ ...valid, categories: { language: [{ ...entry, name: "junit" }] } }, /invalid "name"/],
    [{ ...valid, categories: { language: [{ ...entry, checksum: "md5-x" }] } }, /"checksum" must be "sha256-<hex>"/],
    [{ ...valid, categories: { language: [{ ...entry, files: [] }] } }, /"files" must be a non-empty array/],
  ];
  for (const [invalid, expected] of cases) {
    const problems = validateIndex(invalid);
    assert.ok(problems.some((problem) => expected.test(problem)), `${expected} em ${JSON.stringify(problems)}`);
  }
  assert.deepEqual(validateIndex(null), ["index must be a JSON object"]);
});

test("fetchIndex devolve o index válido e falha com erro específico", async () => {
  const index = await fetchIndex(INDEX_URL, { fetchImpl: fetchStub(indexFixture()) });
  assert.equal(index.registry, "mgr");

  await assert.rejects(
    fetchIndex(INDEX_URL, { fetchImpl: fetchStub(indexFixture(), { ok: false, status: 404 }) }),
    /registry index unavailable: .*HTTP 404/,
  );
  await assert.rejects(
    fetchIndex(INDEX_URL, { fetchImpl: fetchStub("not-json") }),
    /registry index is not valid JSON/,
  );
  await assert.rejects(
    fetchIndex(INDEX_URL, { fetchImpl: fetchStub({ indexVersion: 1 }) }),
    /invalid registry index/,
  );
});

test("resolve encontra a skill pelo scope e devolve entrada + origem", async () => {
  const registries = [{ name: "mgr", url: INDEX_URL, trusted: true }];
  const { entry, category, origin } = await resolve("@mgr/junit-clean", registries, { fetchImpl: fetchStub(indexFixture()) });
  assert.equal(entry.version, "1.0.0");
  assert.equal(category, "language");
  assert.equal(origin.name, "mgr");
});

test("resolve falha com registry não configurado ou skill ausente", async () => {
  await assert.rejects(
    resolve("@ghost/skill", [{ name: "mgr", url: INDEX_URL }], { fetchImpl: fetchStub(indexFixture()) }),
    /registry not configured for scope "@ghost"/,
  );
  await assert.rejects(
    resolve("@mgr/unknown", [{ name: "mgr", url: INDEX_URL }], { fetchImpl: fetchStub(indexFixture()) }),
    /skill not found in registry "mgr": @mgr\/unknown/,
  );
});

test("readDetectionMode: ausente é suggest, manual é aceito, auto é recusado com o motivo", () => {
  const core = tmp();
  assert.equal(readDetectionMode(core), "suggest", "sem config, o default de D03");

  writeConfig(core, { registries: [], detectionMode: "manual" });
  assert.equal(readDetectionMode(core), "manual");

  writeConfig(core, { registries: [], detectionMode: "suggest" });
  assert.equal(readDetectionMode(core), "suggest");

  writeConfig(core, { registries: [], detectionMode: "auto" });
  assert.throws(() => readDetectionMode(core), /"auto" is not available yet.*mgr audit/s);

  writeConfig(core, { registries: [], detectionMode: "sugerir" });
  assert.throws(() => readDetectionMode(core), /invalid detectionMode: "sugerir"/);
});

test("o modo de detecção convive com os registries no mesmo config", () => {
  const core = tmp();
  writeConfig(core, { registries: [], detectionMode: "manual" });
  addRegistry(core, { name: "mgr", url: INDEX_URL });
  assert.equal(readDetectionMode(core), "manual", "addRegistry preserva o modo");
  assert.deepEqual(listRegistries(core).map((registry) => registry.name), ["mgr"]);
});
