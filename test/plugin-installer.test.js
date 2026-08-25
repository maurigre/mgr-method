import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { add, assertSafePath, CANCELLED_EXIT_CODE, download, manifestFromFiles, remove, restore } from "../src/plugin-installer.js";
import { aggregateChecksum, sha256 } from "../src/plugin.js";
import { addRegistry } from "../src/registry.js";
import { readLockfile, LOCKFILE_NAME } from "../src/lockfile.js";

const INDEX_URL = "https://raw.example/mgr/index.json";

const skillMd = (name) => `---
name: ${name}
description: Standardizes Java unit tests with JUnit 5 following strict quality rules.
---

# ${name}

Instructions here.
`;

const manifestOf = (name, overrides = {}) => ({
  name,
  version: "1.0.0",
  author: "Mauri Reis",
  description: "Standardizes Java unit tests with JUnit 5 following strict quality rules.",
  category: "language",
  permissions: ["read-files", "write-files"],
  model: { "claude-code": "sonnet", copilot: "Claude Sonnet 4.5" },
  effort: "medium",
  ...overrides,
});

// Registry de teste: monta index + servidor de arquivos coerentes (checksums reais).
function stubRegistry(skills, { registry = "mgr", indexUrl = INDEX_URL } = {}) {
  const bodies = new Map();
  const categories = {};
  for (const { name, manifest = manifestOf(name), extraFiles = [] } of skills) {
    const short = name.split("/")[1];
    const contents = [
      { path: "SKILL.md", content: Buffer.from(skillMd(short), "utf8") },
      { path: "mgr-manifest.json", content: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
      ...extraFiles.map((file) => ({ path: file.path, content: Buffer.from(file.content, "utf8") })),
    ];
    const files = contents.map((file) => {
      const url = `https://raw.example/${registry}/${short}/${file.path}`;
      bodies.set(url, file.content);
      return { path: file.path, url, sha256: sha256(file.content) };
    });
    const category = manifest.category;
    categories[category] = categories[category] || [];
    categories[category].push({
      name, version: manifest.version, description: manifest.description,
      checksum: aggregateChecksum(contents), files,
    });
  }
  const index = { indexVersion: 1, registry, generatedAt: "2026-07-21T00:00:00.000Z", categories };
  return {
    index, bodies, indexUrl,
    fetchImpl: async (url) => {
      if (url === indexUrl) return { ok: true, status: 200, json: async () => index };
      const body = bodies.get(url);
      if (!body) return { ok: false, status: 404, arrayBuffer: async () => new Uint8Array() };
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(body) };
    },
  };
}

function project() {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mgr-plugin-install-"));
  const coreDir = path.join(repo, ".mgr-core");
  const targets = [
    { engine: "claude-code", dir: path.join(repo, ".claude", "skills") },
    { engine: "copilot", dir: path.join(repo, ".github", "skills") },
  ];
  return { repo, coreDir, targets };
}

const accept = async () => true;

test("add instala nos dois motores, traduz por motor e trava no lockfile", async () => {
  const { repo, coreDir, targets } = project();
  const registry = stubRegistry([{ name: "@mgr/junit-clean" }]);
  addRegistry(coreDir, { name: "mgr", url: registry.indexUrl, trusted: true });

  const result = await add("@mgr/junit-clean", { repo, coreDir, targets, fetchImpl: registry.fetchImpl, confirm: accept });

  const claude = readFileSync(path.join(repo, ".claude/skills/junit-clean/SKILL.md"), "utf8");
  const copilot = readFileSync(path.join(repo, ".github/skills/junit-clean/SKILL.md"), "utf8");
  assert.match(claude, /^model: sonnet$/m);
  assert.match(claude, /^effort: medium$/m);
  assert.doesNotMatch(copilot, /^model:/m);
  assert.ok(existsSync(path.join(repo, ".claude/skills/junit-clean/mgr-manifest.json")));

  const lockfile = readLockfile(repo);
  const entry = lockfile.skills["@mgr/junit-clean"];
  assert.equal(entry.version, "1.0.0");
  assert.equal(entry.registry, "mgr");
  assert.equal(entry.category, "language");
  assert.equal(entry.dir, "junit-clean");
  assert.deepEqual(entry.engines, ["claude-code", "copilot"]);
  assert.deepEqual(entry.applied["claude-code"], { model: "sonnet", effort: "medium" });
  assert.equal(entry.applied.copilot.warnings.length, 2);
  assert.deepEqual(lockfile.registries.mgr, { url: registry.indexUrl, trusted: true });
  assert.equal(result.lockfile, path.join(repo, LOCKFILE_NAME));
  assert.equal(result.installed[0].warnings.length, 2);
});

test("add exige confirmação humana: negada cancela com exit code próprio e não escreve nada", async () => {
  const { repo, coreDir, targets } = project();
  const registry = stubRegistry([{ name: "@mgr/junit-clean" }]);
  addRegistry(coreDir, { name: "mgr", url: registry.indexUrl });

  const shown = [];
  const refuse = async (proposal) => { shown.push(proposal); return false; };
  const cancelled = await add("@mgr/junit-clean", { repo, coreDir, targets, fetchImpl: registry.fetchImpl, confirm: refuse })
    .then(() => null, (error) => error);

  assert.equal(cancelled.name, "InstallCancelled");
  assert.equal(cancelled.exitCode, CANCELLED_EXIT_CODE);
  assert.deepEqual(shown[0].permissions, ["read-files", "write-files"]);
  assert.equal(shown[0].origin.name, "mgr");
  assert.match(shown[0].checksum, /^sha256-[0-9a-f]{64}$/);
  assert.ok(!existsSync(path.join(repo, ".claude/skills/junit-clean")));
  assert.equal(readLockfile(repo), null);

  await assert.rejects(
    add("@mgr/junit-clean", { repo, coreDir, targets, fetchImpl: registry.fetchImpl }),
    /requires a human confirmation callback/,
  );
});

test("checksum divergente aborta sem escrever nada", async () => {
  const { repo, coreDir, targets } = project();
  const registry = stubRegistry([{ name: "@mgr/junit-clean" }]);
  addRegistry(coreDir, { name: "mgr", url: registry.indexUrl });
  const [url] = [...registry.bodies.keys()];
  registry.bodies.set(url, Buffer.from("tampered", "utf8"));

  await assert.rejects(
    add("@mgr/junit-clean", { repo, coreDir, targets, fetchImpl: registry.fetchImpl, confirm: accept }),
    /checksum mismatch for SKILL.md/,
  );
  assert.ok(!existsSync(path.join(repo, ".claude/skills/junit-clean")));
  assert.equal(readLockfile(repo), null);
});

test("checksum agregado divergente e arquivo fora do ar são erros explícitos", async () => {
  const entry = {
    name: "@mgr/junit-clean",
    files: [{ path: "SKILL.md", url: "https://raw.example/a", sha256: sha256("body") }],
    checksum: `sha256-${"0".repeat(64)}`,
  };
  const fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array(Buffer.from("body", "utf8")) });
  await assert.rejects(download(entry, { fetchImpl }), /aggregate checksum mismatch for @mgr\/junit-clean/);
  await assert.rejects(
    download(entry, { fetchImpl: async () => ({ ok: false, status: 404 }) }),
    /skill file unavailable: .*HTTP 404/,
  );
});

test("path de arquivo do registry fora da pasta da skill é recusado", () => {
  assert.equal(assertSafePath("reference/rules.md"), path.normalize("reference/rules.md"));
  assert.throws(() => assertSafePath("../../etc/passwd"), /unsafe file path/);
  assert.throws(() => assertSafePath("/etc/passwd"), /unsafe file path/);
});

test("manifest ausente ou divergente do index é erro explícito", () => {
  const entry = { name: "@mgr/junit-clean", version: "1.0.0" };
  assert.throws(() => manifestFromFiles([{ path: "SKILL.md", content: Buffer.from("x") }], entry), /has no mgr-manifest.json/);
  const divergent = [{ path: "mgr-manifest.json", content: Buffer.from(JSON.stringify(manifestOf("@mgr/junit-clean", { version: "2.0.0" }))) }];
  assert.throws(() => manifestFromFiles(divergent, entry), /does not match the registry index/);
});

test("extends instala a base e injeta o cabeçalho de composição só na que estende", async () => {
  const { repo, coreDir, targets } = project();
  const registry = stubRegistry([
    { name: "@mgr/junit-clean" },
    { name: "@mgr/junit-empresa", manifest: manifestOf("@mgr/junit-empresa", { extends: "@mgr/junit-clean" }) },
  ]);
  addRegistry(coreDir, { name: "mgr", url: registry.indexUrl });

  const { installed } = await add("@mgr/junit-empresa", { repo, coreDir, targets, fetchImpl: registry.fetchImpl, confirm: accept });

  assert.deepEqual(installed.map((skill) => skill.name), ["@mgr/junit-clean", "@mgr/junit-empresa"]);
  const extending = readFileSync(path.join(repo, ".claude/skills/junit-empresa/SKILL.md"), "utf8");
  const base = readFileSync(path.join(repo, ".claude/skills/junit-clean/SKILL.md"), "utf8");
  assert.match(extending, /This skill extends `@mgr\/junit-clean` \(installed at `.claude\/skills\/junit-clean`\)/);
  assert.doesNotMatch(base, /This skill extends/);

  const lockfile = readLockfile(repo);
  assert.equal(lockfile.skills["@mgr/junit-empresa"].extends, "@mgr/junit-clean");
  assert.equal(lockfile.skills["@mgr/junit-clean"].extends, undefined);
});

test("colisão de nome entre registries instala em pastas distintas", async () => {
  const { repo, coreDir, targets } = project();
  const official = stubRegistry([{ name: "@mgr/junit-clean" }]);
  const company = stubRegistry([{ name: "@empresa/junit-clean" }], { registry: "empresa", indexUrl: "https://raw.example/empresa/index.json" });
  addRegistry(coreDir, { name: "mgr", url: official.indexUrl });
  addRegistry(coreDir, { name: "empresa", url: company.indexUrl });
  const fetchImpl = async (url) => (url.includes("/empresa/") ? company.fetchImpl(url) : official.fetchImpl(url));

  await add("@mgr/junit-clean", { repo, coreDir, targets, fetchImpl, confirm: accept });
  await add("@empresa/junit-clean", { repo, coreDir, targets, fetchImpl, confirm: accept });

  assert.ok(existsSync(path.join(repo, ".claude/skills/junit-clean/SKILL.md")));
  assert.ok(existsSync(path.join(repo, ".claude/skills/junit-clean--empresa/SKILL.md")));
  const lockfile = readLockfile(repo);
  assert.equal(lockfile.skills["@empresa/junit-clean"].dir, "junit-clean--empresa");
  assert.deepEqual(Object.keys(lockfile.registries), ["empresa", "mgr"]);
});

test("add de skill travada em outra versão não atualiza silenciosamente", async () => {
  const { repo, coreDir, targets } = project();
  const v1 = stubRegistry([{ name: "@mgr/junit-clean" }]);
  addRegistry(coreDir, { name: "mgr", url: v1.indexUrl });
  await add("@mgr/junit-clean", { repo, coreDir, targets, fetchImpl: v1.fetchImpl, confirm: accept });

  const v2 = stubRegistry([{ name: "@mgr/junit-clean", manifest: manifestOf("@mgr/junit-clean", { version: "2.0.0" }) }]);
  await assert.rejects(
    add("@mgr/junit-clean", { repo, coreDir, targets, fetchImpl: v2.fetchImpl, confirm: accept }),
    /locked at 1.0.0; updating a plugin is not supported yet/,
  );
});

test("add sem motor de destino é erro explícito", async () => {
  const { repo, coreDir } = project();
  await assert.rejects(
    add("@mgr/junit-clean", { repo, coreDir, targets: [], fetchImpl: async () => ({}), confirm: accept }),
    /at least one engine target/,
  );
});

test("remove limpa só o plugin e o lockfile; _shared e skills do método ficam intactos", async () => {
  const { repo, coreDir, targets } = project();
  const registry = stubRegistry([{ name: "@mgr/junit-clean" }]);
  addRegistry(coreDir, { name: "mgr", url: registry.indexUrl });
  await add("@mgr/junit-clean", { repo, coreDir, targets, fetchImpl: registry.fetchImpl, confirm: accept });

  const shared = path.join(repo, ".claude/skills/_shared/arch/cross-cutting-rules.md");
  const methodSkill = path.join(repo, ".claude/skills/spec-create/SKILL.md");
  mkdirSync(path.dirname(shared), { recursive: true });
  mkdirSync(path.dirname(methodSkill), { recursive: true });
  writeFileSync(shared, "rules", "utf8");
  writeFileSync(methodSkill, "method", "utf8");

  const { removed } = remove("@mgr/junit-clean", { repo, targets });

  assert.equal(removed.length, 2);
  assert.ok(!existsSync(path.join(repo, ".claude/skills/junit-clean")));
  assert.ok(!existsSync(path.join(repo, ".github/skills/junit-clean")));
  assert.ok(existsSync(shared));
  assert.ok(existsSync(methodSkill));
  const lockfile = readLockfile(repo);
  assert.deepEqual(lockfile.skills, {});
  assert.deepEqual(lockfile.registries, {});
});

test("remove recusa skill fora do lockfile e skill que serve de base a outra", async () => {
  const { repo, coreDir, targets } = project();
  const registry = stubRegistry([
    { name: "@mgr/junit-clean" },
    { name: "@mgr/junit-empresa", manifest: manifestOf("@mgr/junit-empresa", { extends: "@mgr/junit-clean" }) },
  ]);
  addRegistry(coreDir, { name: "mgr", url: registry.indexUrl });
  assert.throws(() => remove("@mgr/ghost", { repo, targets }), /skill not installed as a plugin/);

  await add("@mgr/junit-empresa", { repo, coreDir, targets, fetchImpl: registry.fetchImpl, confirm: accept });
  assert.throws(
    () => remove("@mgr/junit-clean", { repo, targets }),
    /is extended by @mgr\/junit-empresa; remove the extending skill first/,
  );
});

test("restore reproduz o conjunto exato a partir do lockfile em diretório limpo", async () => {
  const origin = project();
  const registry = stubRegistry([
    { name: "@mgr/junit-clean" },
    { name: "@mgr/junit-empresa", manifest: manifestOf("@mgr/junit-empresa", { extends: "@mgr/junit-clean" }) },
  ]);
  addRegistry(origin.coreDir, { name: "mgr", url: registry.indexUrl });
  await add("@mgr/junit-empresa", { repo: origin.repo, coreDir: origin.coreDir, targets: origin.targets, fetchImpl: registry.fetchImpl, confirm: accept });

  const clone = project();
  writeFileSync(path.join(clone.repo, LOCKFILE_NAME), readFileSync(path.join(origin.repo, LOCKFILE_NAME), "utf8"), "utf8");

  const { skills } = await restore({ repo: clone.repo, targets: clone.targets, fetchImpl: registry.fetchImpl });

  assert.deepEqual(skills, ["@mgr/junit-clean", "@mgr/junit-empresa"]);
  for (const engine of [".claude/skills", ".github/skills"]) {
    assert.ok(existsSync(path.join(clone.repo, engine, "junit-clean/SKILL.md")));
    assert.ok(existsSync(path.join(clone.repo, engine, "junit-empresa/SKILL.md")));
  }
  const restoredMd = readFileSync(path.join(clone.repo, ".claude/skills/junit-empresa/SKILL.md"), "utf8");
  assert.equal(restoredMd, readFileSync(path.join(origin.repo, ".claude/skills/junit-empresa/SKILL.md"), "utf8"));
  assert.deepEqual(readLockfile(clone.repo), readLockfile(origin.repo));
});

test("restore aborta quando o registry não serve mais a versão travada", async () => {
  const { repo, coreDir, targets } = project();
  const v1 = stubRegistry([{ name: "@mgr/junit-clean" }]);
  addRegistry(coreDir, { name: "mgr", url: v1.indexUrl });
  await add("@mgr/junit-clean", { repo, coreDir, targets, fetchImpl: v1.fetchImpl, confirm: accept });

  const v2 = stubRegistry([{ name: "@mgr/junit-clean", manifest: manifestOf("@mgr/junit-clean", { version: "2.0.0" }) }]);
  await assert.rejects(
    restore({ repo, targets, fetchImpl: v2.fetchImpl }),
    new RegExp(`does not match ${LOCKFILE_NAME}: locked 1.0.0`),
  );
});

test("restore sem lockfile é no-op", async () => {
  const { repo, targets } = project();
  assert.equal(await restore({ repo, targets, fetchImpl: async () => ({}) }), null);
});

test("remove honra os engines travados: pasta homônima em motor não travado fica intacta", async () => {
  const { repo, coreDir, targets } = project();
  const registry = stubRegistry([{ name: "@mgr/junit-clean" }]);
  addRegistry(coreDir, { name: "mgr", url: registry.indexUrl });
  await add("@mgr/junit-clean", { repo, coreDir, targets: [targets[0]], fetchImpl: registry.fetchImpl, confirm: accept });

  const homonima = path.join(repo, ".github/skills/junit-clean/SKILL.md");
  mkdirSync(path.dirname(homonima), { recursive: true });
  writeFileSync(homonima, "não sou o plugin", "utf8");

  const { removed } = remove("@mgr/junit-clean", { repo, targets });

  assert.deepEqual(removed, [path.join(repo, ".claude/skills/junit-clean")]);
  assert.ok(existsSync(homonima), "motor fora de entry.engines não pode ser tocado");
});

test("restore reporta os motores travados sem target ativo (degradação explícita)", async () => {
  const { repo, coreDir, targets } = project();
  const registry = stubRegistry([{ name: "@mgr/junit-clean" }]);
  addRegistry(coreDir, { name: "mgr", url: registry.indexUrl });
  await add("@mgr/junit-clean", { repo, coreDir, targets, fetchImpl: registry.fetchImpl, confirm: accept });

  const soClaude = [targets[0]];
  const { restored } = await restore({ repo, targets: soClaude, fetchImpl: registry.fetchImpl });

  assert.deepEqual(restored[0].skippedEngines, ["copilot"]);
  assert.deepEqual(Object.keys(restored[0].dirs), ["claude-code"]);

  const completo = await restore({ repo, targets, fetchImpl: registry.fetchImpl });
  assert.deepEqual(completo.restored[0].skippedEngines, []);
});

test("remove nunca apaga pasta que não é do plugin (skill do método de mesmo nome)", async () => {
  const { repo, coreDir, targets } = project();
  const registry = stubRegistry([{ name: "@mgr/junit-clean" }]);
  addRegistry(coreDir, { name: "mgr", url: registry.indexUrl });
  await add("@mgr/junit-clean", { repo, coreDir, targets, fetchImpl: registry.fetchImpl, confirm: accept });

  // Simula o que o `mgr update` faz: reinstala a skill do MÉTODO por cima, sem manifest.
  const doMetodo = path.join(repo, ".claude/skills/junit-clean");
  rmSync(doMetodo, { recursive: true, force: true });
  mkdirSync(doMetodo, { recursive: true });
  writeFileSync(path.join(doMetodo, "SKILL.md"), "skill do método, não do plugin", "utf8");

  const { removed, skipped } = remove("@mgr/junit-clean", { repo, targets });

  assert.deepEqual(removed, [path.join(repo, ".github/skills/junit-clean")], "só a pasta que é o plugin sai");
  assert.deepEqual(skipped.map((item) => item.engine), ["claude-code"]);
  assert.equal(readFileSync(path.join(doMetodo, "SKILL.md"), "utf8"), "skill do método, não do plugin");
  assert.equal(readLockfile(repo).skills["@mgr/junit-clean"], undefined, "o lockfile é limpo mesmo assim");
});

test("remove recusa pasta com manifest de OUTRO plugin", async () => {
  const { repo, coreDir, targets } = project();
  const registry = stubRegistry([{ name: "@mgr/junit-clean" }]);
  addRegistry(coreDir, { name: "mgr", url: registry.indexUrl });
  await add("@mgr/junit-clean", { repo, coreDir, targets: [targets[0]], fetchImpl: registry.fetchImpl, confirm: accept });

  const dir = path.join(repo, ".claude/skills/junit-clean");
  writeFileSync(path.join(dir, "mgr-manifest.json"), JSON.stringify({ name: "@outro/junit-clean" }), "utf8");

  const { removed, skipped } = remove("@mgr/junit-clean", { repo, targets: [targets[0]] });
  assert.deepEqual(removed, []);
  assert.equal(skipped.length, 1);
  assert.ok(existsSync(dir));
});

test("add recusa instalar por cima de skill do método e não escreve nada", async () => {
  const { repo, coreDir, targets } = project();
  const registry = stubRegistry([{ name: "@mgr/junit-clean" }]);
  addRegistry(coreDir, { name: "mgr", url: registry.indexUrl });

  const doMetodo = path.join(repo, ".claude/skills/junit-clean");
  mkdirSync(doMetodo, { recursive: true });
  writeFileSync(path.join(doMetodo, "SKILL.md"), "skill do método", "utf8");

  await assert.rejects(
    add("@mgr/junit-clean", { repo, coreDir, targets, fetchImpl: registry.fetchImpl, confirm: accept }),
    /already holds another skill.*not supported yet/s,
  );
  assert.equal(readFileSync(path.join(doMetodo, "SKILL.md"), "utf8"), "skill do método");
  assert.ok(!existsSync(path.join(repo, ".github/skills/junit-clean")), "recusa antes de escrever em QUALQUER motor");
  assert.equal(readLockfile(repo), null);
});

test("add do mesmo plugin sobre a própria instalação segue permitido", async () => {
  const { repo, coreDir, targets } = project();
  const registry = stubRegistry([{ name: "@mgr/junit-clean" }]);
  addRegistry(coreDir, { name: "mgr", url: registry.indexUrl });
  await add("@mgr/junit-clean", { repo, coreDir, targets, fetchImpl: registry.fetchImpl, confirm: accept });

  const reinstalado = await add("@mgr/junit-clean", { repo, coreDir, targets, fetchImpl: registry.fetchImpl, confirm: accept });
  assert.equal(reinstalado.installed[0].name, "@mgr/junit-clean");
  assert.ok(existsSync(path.join(repo, ".claude/skills/junit-clean/mgr-manifest.json")));
});
