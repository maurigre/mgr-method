import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildManifest, collectFiles, exportPlugin, readFrontmatter, resolveTokens } from "../scripts/export-plugin.mjs";
import { MANIFEST_NAME, validateManifest } from "../src/plugin.js";
import { manifestFromFiles } from "../src/plugin-installer.js";
import { ARCH_RULES_TOKEN, USER_LANGUAGE_FALLBACK, USER_LANGUAGE_TOKEN } from "../src/catalog.js";
import { fileURLToPath } from "node:url";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "mgr-export-"));

const POC = ["junit-clean", "diagnosing-bugs"];
const skillSource = (skill) => fileURLToPath(new URL(`../skills/${skill}/SKILL.md`, import.meta.url));

test("export das PoC gera plugins válidos com o manifest do formato", () => {
  const outDir = tmp();
  for (const skill of POC) {
    const result = exportPlugin(skill, { outDir });
    assert.equal(result.name, `@mgr/${skill}`);
    assert.ok(result.files.includes("SKILL.md") && result.files.includes(MANIFEST_NAME));
    assert.match(result.checksum, /^sha256-[0-9a-f]{64}$/);

    const manifest = JSON.parse(readFileSync(path.join(result.dir, MANIFEST_NAME), "utf8"));
    assert.deepEqual(validateManifest(manifest), []);
    assert.equal(manifest.compatibility.mgr, ">=0.6.0");
    assert.ok(manifest.permissions.length, "permissions é obrigatório no registry oficial");

    const original = readFrontmatter(readFileSync(skillSource(skill), "utf8"));
    assert.equal(manifest.description, original.description);
  }
});

test("export resolve o token de idioma e mantém a SKILL.md instalável", () => {
  const outDir = tmp();
  const { dir } = exportPlugin("junit-clean", { outDir });
  const skillMd = readFileSync(path.join(dir, "SKILL.md"), "utf8");
  assert.ok(!skillMd.includes(USER_LANGUAGE_TOKEN), "token de idioma não pode vazar para o plugin");
  assert.ok(skillMd.includes(USER_LANGUAGE_FALLBACK));
  assert.match(skillMd, /^name: junit-clean$/m, "o frontmatter do padrão agentskills.io fica intacto");
});

test("junit-clean declara model/effort e diagnosing-bugs não (degradação por motor)", () => {
  const outDir = tmp();
  const junit = JSON.parse(readFileSync(path.join(exportPlugin("junit-clean", { outDir }).dir, MANIFEST_NAME), "utf8"));
  const bugs = JSON.parse(readFileSync(path.join(exportPlugin("diagnosing-bugs", { outDir }).dir, MANIFEST_NAME), "utf8"));
  assert.equal(junit.model["claude-code"], "sonnet");
  assert.equal(junit.effort, "medium");
  assert.equal(bugs.model, undefined);
  assert.equal(bugs.effort, undefined);
});

test("checksum do export é determinístico e o pacote casa com a entrada do index", () => {
  const primeiro = exportPlugin("diagnosing-bugs", { outDir: tmp() });
  const segundo = exportPlugin("diagnosing-bugs", { outDir: tmp() });
  assert.equal(primeiro.checksum, segundo.checksum);

  const files = collectFiles(primeiro.dir);
  const versao = JSON.parse(readFileSync(path.join(primeiro.dir, MANIFEST_NAME), "utf8")).version;
  const entry = { name: "@mgr/diagnosing-bugs", version: versao, checksum: primeiro.checksum };
  assert.equal(manifestFromFiles(files, entry).name, "@mgr/diagnosing-bugs");
});

test("export recusa skill sem metadados e skill que depende de _shared", () => {
  const outDir = tmp();
  const skillsDir = tmp();
  mkdirSync(path.join(skillsDir, "arch-hexagonal"), { recursive: true });
  writeFileSync(
    path.join(skillsDir, "arch-hexagonal", "SKILL.md"),
    `---\nname: arch-hexagonal\ndescription: ${"x".repeat(60)}\n---\n\n${ARCH_RULES_TOKEN}\n`,
    "utf8",
  );
  assert.throws(() => exportPlugin("arch-hexagonal", { outDir, skillsDir }), /sem metadados de plugin/);
  assert.throws(() => resolveTokens(`text ${ARCH_RULES_TOKEN}`, "arch-hexagonal"), /nao e exportavel como plugin/);
});

test("buildManifest reprova description fora do limite do schema", () => {
  assert.throws(
    () => buildManifest("junit-clean", { description: "curta" }, { registry: "mgr", version: "1.0.0", author: "Mauri Reis" }),
    /"description" must be a string of 40-1024 characters/,
  );
});

test("ecosystems só é declarado onde há ecossistema real de projeto", () => {
  const outDir = tmp();
  const junit = JSON.parse(readFileSync(path.join(exportPlugin("junit-clean", { outDir }).dir, MANIFEST_NAME), "utf8"));
  const bugs = JSON.parse(readFileSync(path.join(exportPlugin("diagnosing-bugs", { outDir }).dir, MANIFEST_NAME), "utf8"));

  assert.deepEqual(junit.ecosystems, ["java"], "junit-clean serve a projeto Java");
  assert.equal(bugs.ecosystems, undefined,
    "diagnosticar bug não pertence a um ecossistema; inventar um seria ruído");
  assert.deepEqual(validateManifest(junit), []);
  assert.deepEqual(validateManifest(bugs), []);
});
