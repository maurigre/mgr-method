import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentsApply } from "../src/commands/agents.js";
import { installAgents, AGENT_MARKER } from "../src/builder.js";
import { readAgents } from "../src/registry.js";

const M = {
  agentChanged: (agent, engine, field, from, to) => `${agent} (${engine}): ${field} ${from} -> ${to}`,
  agentsApplyMissing: (file, version) => `missing ${file}: npx mgr-method@${version} update`,
  agentsApplyNotOwned: (file) => `not owned ${file}`,
  agentsApplyWriting: (file) => `writing ${file}`,
  agentsApplyWritten: (file) => `written ${file}`,
};

function projeto(contexto) {
  const root = mkdtempSync(path.join(os.tmpdir(), "mgr-apply-"));
  contexto.after(() => rmSync(root, { recursive: true, force: true }));
  const core = path.join(root, ".mgr-core");
  mkdirSync(core, { recursive: true });
  const config = (effort, extra = {}) =>
    writeFileSync(path.join(core, "config.json"), JSON.stringify({ agents: { review: { effort, ...extra } } }));
  config("high");
  const dir = path.join(root, ".claude", "agents");
  const { written } = installAgents("claude-code", dir, readAgents(core).policies, { userLanguage: "en" });
  const rel = written.map((arquivo) => path.relative(root, arquivo));
  const manifesto = (extra = {}) => writeFileSync(path.join(core, "manifest.json"), JSON.stringify({
    version: "9.9.9", engines: ["claude-code"], agents: rel, ...extra,
  }));
  manifesto();
  const review = written.find((arquivo) => arquivo.endsWith("mgr-review.md"));
  return { root, core, config, manifesto, rel, review };
}

function run(root) {
  const out = [];
  const err = [];
  const io = { out: (linha) => out.push(linha), err: (linha) => err.push(linha) };
  const code = agentsApply({ root, cwd: root, flags: {}, positional: [], io, M });
  return { code, out, err };
}

const corpoDe = (texto) => texto.slice(texto.indexOf("\n---") + 4);

test("should apply effort max and keep the body byte for byte, naming the field", (contexto) => {
  const { root, config, review } = projeto(contexto);
  const antes = readFileSync(review, "utf8");
  config("max");
  const { code, out, err } = run(root);
  const depois = readFileSync(review, "utf8");
  assert.equal(code, 0);
  assert.deepEqual(err, []);
  assert.match(depois, /^effort: max$/m);
  assert.equal(corpoDe(depois), corpoDe(antes));
  assert.ok(out.some((linha) => linha.includes("effort") && linha.includes("high") && linha.includes("max")));
});

test("should announce each file before and after rewriting it", (contexto) => {
  const { root, config } = projeto(contexto);
  config("max");
  const { out } = run(root);
  const rel = path.join(".claude", "agents", "mgr-review.md");
  const antes = out.indexOf(`writing ${rel}`);
  const depois = out.indexOf(`written ${rel}`);
  assert.ok(antes >= 0);
  assert.ok(depois > antes);
});

test("should leave the file untouched and exit 1 when the marker is missing", (contexto) => {
  const { root, config, review } = projeto(contexto);
  const semMarcador = readFileSync(review, "utf8").replace(AGENT_MARKER, "other");
  writeFileSync(review, semMarcador);
  config("max");
  const { code, err } = run(root);
  assert.equal(code, 1);
  assert.equal(readFileSync(review, "utf8"), semMarcador);
  assert.ok(err.some((linha) => linha.includes("mgr-review.md")));
});

test("should leave the file untouched and exit 1 when our file has no frontmatter", (contexto) => {
  const { root, config, review } = projeto(contexto);
  const semFrontmatter = `body only\n<!-- ${AGENT_MARKER} -->\n`;
  writeFileSync(review, semFrontmatter);
  config("max");
  const { code, err } = run(root);
  assert.equal(code, 1);
  assert.equal(readFileSync(review, "utf8"), semFrontmatter);
  assert.ok(err.some((linha) => linha.includes("not owned") && linha.includes("mgr-review.md")));
});

test("should exit 1 pointing to the update command when a declared agent was deleted", (contexto) => {
  const { root, review } = projeto(contexto);
  rmSync(review);
  const { code, err } = run(root);
  assert.equal(code, 1);
  assert.ok(err.some((linha) => linha.includes("npx mgr-method@9.9.9 update") && linha.includes("mgr-review.md")));
});

test("should skip an intent that is turned off and leave its file untouched", (contexto) => {
  const { root, config, review } = projeto(contexto);
  const antes = readFileSync(review, "utf8");
  config("max", { enabled: false });
  const { code, out, err } = run(root);
  assert.equal(code, 0);
  assert.deepEqual(err, []);
  assert.equal(readFileSync(review, "utf8"), antes);
  assert.ok(!out.some((linha) => linha.includes("mgr-review.md")));
});

test("should skip an agent the manifest does not declare", (contexto) => {
  const { root, config, manifesto, rel, review } = projeto(contexto);
  manifesto({ agents: rel.filter((arquivo) => !arquivo.endsWith("mgr-review.md")) });
  const antes = readFileSync(review, "utf8");
  config("max");
  const { code, out, err } = run(root);
  assert.equal(code, 0);
  assert.deepEqual(err, []);
  assert.equal(readFileSync(review, "utf8"), antes);
  assert.ok(!out.some((linha) => linha.includes("mgr-review.md")));
});

test("should exit 0 and write nothing when the project has no manifest", (contexto) => {
  const { root, core, config, review } = projeto(contexto);
  rmSync(path.join(core, "manifest.json"));
  const antes = readFileSync(review, "utf8");
  config("max");
  const { code, out, err } = run(root);
  assert.equal(code, 0);
  assert.deepEqual(out, []);
  assert.deepEqual(err, []);
  assert.equal(readFileSync(review, "utf8"), antes);
});

test("should skip an engine in the manifest that is not in the catalog", (contexto) => {
  const { root, config, manifesto, review } = projeto(contexto);
  manifesto({ engines: ["unknown-engine"] });
  const antes = readFileSync(review, "utf8");
  config("max");
  const { code, out, err } = run(root);
  assert.equal(code, 0);
  assert.deepEqual(out, []);
  assert.deepEqual(err, []);
  assert.equal(readFileSync(review, "utf8"), antes);
});

test("should declare nothing and exit 0 when the manifest has no agents list", (contexto) => {
  const { root, core, config, review } = projeto(contexto);
  writeFileSync(path.join(core, "manifest.json"), JSON.stringify({ version: "9.9.9", engines: ["claude-code"] }));
  const antes = readFileSync(review, "utf8");
  config("max");
  const { code, out, err } = run(root);
  assert.equal(code, 0);
  assert.deepEqual(out, []);
  assert.deepEqual(err, []);
  assert.equal(readFileSync(review, "utf8"), antes);
});

test("should apply to the singular engine field when the manifest has no engines list", (contexto) => {
  const { root, core, config, rel, review } = projeto(contexto);
  writeFileSync(path.join(core, "manifest.json"), JSON.stringify({ version: "9.9.9", engine: "claude-code", agents: rel }));
  config("max");
  const { code, err } = run(root);
  assert.equal(code, 0);
  assert.deepEqual(err, []);
  assert.match(readFileSync(review, "utf8"), /^effort: max$/m);
});

test("should neither rewrite nor announce a file already matching the config on a second run", (contexto) => {
  const { root, config, review } = projeto(contexto);
  config("max");
  run(root);
  const antesDaSegunda = new Date(Date.now() - 60_000);
  utimesSync(review, antesDaSegunda, antesDaSegunda);
  const mtimeAntesDaSegunda = statSync(review).mtimeMs;
  const conteudo = readFileSync(review, "utf8");
  const { code, out, err } = run(root);
  assert.equal(code, 0);
  assert.deepEqual(err, []);
  assert.deepEqual(out, []);
  assert.equal(statSync(review).mtimeMs, mtimeAntesDaSegunda);
  assert.equal(readFileSync(review, "utf8"), conteudo);
});
