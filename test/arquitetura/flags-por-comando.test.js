import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as nodeModule from "node:module";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "../../scripts/lib/tmp.mjs";
import { FLAGS, GLOBAL_FLAGS, PACKAGE_COMMANDS, RUNTIME_COMMANDS } from "../../src/core/cli-args.js";
import { criarCodexFalso } from "../helpers/codex-falso.js";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BIN = path.join(RAIZ, "bin", "mgr.js");
const RUNTIME = path.join(".mgr-core", "runtime", "bin", "mgr-runtime.js");
const ESPIAO = path.join(RAIZ, "test", "helpers", "registra-leitura-de-flags.mjs");
const TEM_SCRIPT = spawnSync("script", ["--version"], { encoding: "utf8" }).status === 0;
const TEM_GANCHO = typeof nodeModule.registerHooks === "function";
const SEM_GANCHO = TEM_GANCHO ? false : "Node sem module.registerHooks (anterior a 22.15.0): a guarda nao consegue medir as leituras";
const SEM_SCRIPT = TEM_SCRIPT ? false : "sem o utilitario script, nao ha pty para medir add e uninstall";
const RECUSA_NOVA = "it is accepted by";
const aspas = (texto) => `'${String(texto).replace(/'/g, "'\\''")}'`;
const ENV = { ...criarCodexFalso("ok").env, NO_COLOR: "1", CI: "true" };

const PLANO = `<!-- mgr-plan-format: 1 -->
# Plano

### P0.1 — Tarefa
- **priority:** P0
- **depends_on:** []
- **files:** [a.js]
- **artifact:** a
- **done_when:** a
- **helper_skill:** —
- **status:** done
`;

function prepararModelo() {
  const modelo = tempDir("flags-modelo-");
  spawnSync("git", ["init", "-q"], { cwd: modelo });
  writeFileSync(path.join(modelo, "README.md"), "x\n");
  const install = spawnSync(process.execPath, [BIN, "install", "--engine", "claude-code", "--language", "javascript", "--arch", "layered", "-y"], { cwd: modelo, env: ENV, encoding: "utf8" });
  assert.equal(install.status, 0, install.stderr);
  mkdirSync(path.join(modelo, "specs", "x"), { recursive: true });
  writeFileSync(path.join(modelo, "specs", "x", "04-plan.md"), PLANO);
  writeFileSync(path.join(modelo, "specs", "x", "06-completion.md"), "# Completion\n\n## Diff do SDD\n- nada\n");
  mkdirSync(path.join(modelo, "docs", "sdd"), { recursive: true });
  writeFileSync(path.join(modelo, "docs", "sdd", "CONSTITUTION.md"), "# Constituição\n");
  writeFileSync(path.join(modelo, "conversa.jsonl"), "");
  const config = path.join(modelo, ".mgr-core", "config.json");
  const atual = existsSync(config) ? JSON.parse(readFileSync(config, "utf8")) : {};
  writeFileSync(config, JSON.stringify({ ...atual, externalReview: { enabled: true, reviewers: ["codex"] } }, null, 2));
  writeFileSync(path.join(modelo, ".mgr-core", "config.local.json"), JSON.stringify({ externalReviewConsent: { codex: { at: "2026-11-27T00:00:00.000Z" } } }));
  return modelo;
}

const PACOTE = [
  { entrada: "install", argv: ["install", "--engine", "claude-code", "--language", "javascript", "--arch", "layered", "-y"], vazio: true },
  { entrada: "update", argv: ["update", "-y"] },
  { entrada: "uninstall", argv: ["uninstall", "-y"], terminal: true },
  { entrada: "status", argv: ["status"] },
  { entrada: "list", argv: ["list"] },
  { entrada: "validate", argv: ["validate"] },
  { entrada: "build", argv: ["build", "--out", "saida-build"] },
  { entrada: "audit", argv: ["audit", "--json"] },
  { entrada: "tokens", argv: ["tokens", "conversa.jsonl"] },
  { entrada: "add", argv: ["add", "@mgr/nao-existe"], terminal: true },
  { entrada: "remove", argv: ["remove", "@mgr/nao-existe"] },
  { entrada: "registry add", argv: ["registry", "add", "r", "http://127.0.0.1:9/index.json"] },
  { entrada: "registry remove", argv: ["registry", "remove", "r"] },
  { entrada: "registry list", argv: ["registry", "list"] },
  { entrada: "detect", argv: ["detect", "--hook", "claude-code"] },
  { entrada: "precompact", argv: ["precompact", "--hook", "claude-code"] },
  { entrada: "doctor", argv: ["doctor"] },
  { entrada: "sdd-check", argv: ["sdd-check"] },
  { entrada: "spec validate", argv: ["spec", "validate"] },
  { entrada: "spec next", argv: ["spec", "next", "x"] },
  { entrada: "spec status", argv: ["spec", "status", "x"] },
  { entrada: "spec archive", argv: ["spec", "archive", "x"] },
  { entrada: "spec initials", argv: ["spec", "initials"] },
  { entrada: "spec initials set", argv: ["spec", "initials", "set", "ab"] },
  { entrada: "agents", argv: ["agents"] },
  { entrada: "agents set", argv: ["agents", "set", "drafting", "--model", "x"] },
  { entrada: "agents apply", argv: ["agents", "apply"] },
  { entrada: "origin", argv: ["origin"] },
  { entrada: "origin set", argv: ["origin", "set", "greenfield"] },
  { entrada: "runtime-versioning", argv: ["runtime-versioning"] },
  { entrada: "runtime-versioning set", argv: ["runtime-versioning", "set", "unversioned"] },
  { entrada: "review status", argv: ["review", "status"] },
  { entrada: "review enable", argv: ["review", "enable"] },
  { entrada: "review disable", argv: ["review", "disable"] },
  { entrada: "review consent", argv: ["review", "consent"] },
  { entrada: "review revoke", argv: ["review", "revoke"] },
  { entrada: "review set", argv: ["review", "set", "--model", "m"] },
  { entrada: "review external", argv: ["review", "external", "x", "--base", "HEAD"] },
  { entrada: "review waive", argv: ["review", "waive", "x", "--reason", "r"] },
  { entrada: "version", argv: ["version"] },
  { entrada: "help", argv: ["help"] },
];

const DO_RUNTIME = [
  { entrada: "detect", argv: ["detect", "--hook", "claude-code"] },
  { entrada: "precompact", argv: ["precompact", "--hook", "claude-code"] },
  { entrada: "doctor", argv: ["doctor"] },
  { entrada: "sdd-check", argv: ["sdd-check"] },
  { entrada: "spec validate", argv: ["spec", "validate"] },
  { entrada: "spec next", argv: ["spec", "next", "x"] },
  { entrada: "spec status", argv: ["spec", "status", "x"] },
  { entrada: "spec archive", argv: ["spec", "archive", "x"] },
  { entrada: "spec initials", argv: ["spec", "initials"] },
  { entrada: "spec initials set", argv: ["spec", "initials", "set", "ab"] },
  { entrada: "agents", argv: ["agents"] },
  { entrada: "agents set", argv: ["agents", "set", "drafting", "--model", "x"] },
  { entrada: "agents apply", argv: ["agents", "apply"] },
  { entrada: "origin", argv: ["origin"] },
  { entrada: "origin set", argv: ["origin", "set", "greenfield"] },
  { entrada: "review status", argv: ["review", "status"] },
  { entrada: "review external", argv: ["review", "external", "x", "--base", "HEAD"] },
  { entrada: "instructions", argv: ["instructions"] },
  { entrada: "instructions write", argv: ["instructions", "write", "--engine", "claude-code"] },
  { entrada: "version", argv: ["version"] },
  { entrada: "help", argv: ["help"] },
];

// Toda invocação leva `--user-language en`: a guarda também prova que a flag global passa pelos pontos de
// entrada reais (P6) sem a recusa nova.
function lerChaves(cenario, cli, modelo) {
  const projeto = tempDir("flags-cenario-");
  if (!cenario.vazio) cpSync(modelo, projeto, { recursive: true });
  const saidaLeituras = path.join(projeto, "..", `${path.basename(projeto)}-leituras.json`);
  const programa = cli === "pacote" ? BIN : path.join(projeto, RUNTIME);
  const env = { ...ENV, FLAG_READS_OUT: saidaLeituras };
  const argv = [...cenario.argv, "--user-language", "en"];
  const execucao = cenario.terminal
    ? spawnSync("script", ["-qec", `stty cols 200 rows 50; ${[process.execPath, "--import", ESPIAO, programa, ...argv].map(aspas).join(" ")}`, "/dev/null"], { cwd: projeto, env, input: "\n", encoding: "utf8", timeout: 60000 })
    : spawnSync(process.execPath, ["--import", ESPIAO, programa, ...argv], { cwd: projeto, env, input: "", encoding: "utf8", timeout: 60000 });
  return {
    chaves: JSON.parse(readFileSync(saidaLeituras, "utf8")).filter((chave) => !GLOBAL_FLAGS.includes(chave)),
    recusou: `${execucao.stdout}${execucao.stderr}`.includes(RECUSA_NOVA),
  };
}

function medir(cenarios, cli, modelo) {
  const lidas = {};
  const recusadas = [];
  if (!TEM_GANCHO) return { lidas, recusadas };
  for (const cenario of cenarios) {
    if (cenario.terminal && !TEM_SCRIPT) continue;
    const { chaves, recusou } = lerChaves(cenario, cli, modelo);
    lidas[cenario.entrada] = chaves;
    if (recusou) recusadas.push(`${cli} ${cenario.entrada}`);
  }
  return { lidas, recusadas };
}

function conferir(tabela, cenarios, lidas) {
  const fora = [];
  const naoLidas = [];
  for (const cenario of cenarios) {
    if (!Object.hasOwn(lidas, cenario.entrada)) continue;
    const { reads, refuses } = tabela[cenario.entrada];
    const aceitas = [...reads, ...refuses];
    for (const chave of lidas[cenario.entrada]) if (!aceitas.includes(chave)) fora.push(`${cenario.entrada}: ${chave}`);
    for (const chave of aceitas) if (!lidas[cenario.entrada].includes(chave)) naoLidas.push(`${cenario.entrada}: ${chave}`);
  }
  return { fora, naoLidas };
}

const modelo = prepararModelo();
const pacote = medir(PACOTE, "pacote", modelo);
const runtime = medir(DO_RUNTIME, "runtime", modelo);
const lidasPacote = pacote.lidas;
const lidasRuntime = runtime.lidas;
const esperadas = (cenarios) => cenarios.filter((c) => TEM_SCRIPT || !c.terminal).map((c) => c.entrada).sort();

test("should give every entry of both tables a measured scenario", () => {
  assert.deepEqual(PACOTE.map((c) => c.entrada).sort(), Object.keys(PACKAGE_COMMANDS).sort());
  assert.deepEqual(DO_RUNTIME.map((c) => c.entrada).sort(), Object.keys(RUNTIME_COMMANDS).sort());
});

test("should measure every scenario that can run here", { skip: SEM_GANCHO }, () => {
  assert.deepEqual(Object.keys(lidasPacote).sort(), esperadas(PACOTE));
  assert.deepEqual(Object.keys(lidasRuntime).sort(), esperadas(DO_RUNTIME));
});

test("should measure the terminal scenarios add and uninstall", { skip: SEM_GANCHO || SEM_SCRIPT }, () => {
  assert.ok(Object.hasOwn(lidasPacote, "add") && Object.hasOwn(lidasPacote, "uninstall"));
});

test("should pass --user-language through every real entry point without the new refusal", { skip: SEM_GANCHO }, () => {
  assert.deepEqual([...pacote.recusadas, ...runtime.recusadas], []);
});

test("should never read a flag outside the accepted set of the package entry", { skip: SEM_GANCHO }, () => {
  assert.deepEqual(conferir(PACKAGE_COMMANDS, PACOTE, lidasPacote).fora, []);
});

test("should read every flag the package entry accepts", { skip: SEM_GANCHO }, () => {
  assert.deepEqual(conferir(PACKAGE_COMMANDS, PACOTE, lidasPacote).naoLidas, []);
});

test("should never read a flag outside the accepted set of the runtime entry", { skip: SEM_GANCHO }, () => {
  assert.deepEqual(conferir(RUNTIME_COMMANDS, DO_RUNTIME, lidasRuntime).fora, []);
});

test("should read every flag the runtime entry accepts", { skip: SEM_GANCHO }, () => {
  assert.deepEqual(conferir(RUNTIME_COMMANDS, DO_RUNTIME, lidasRuntime).naoLidas, []);
});

test("should accept every known flag in some entry of some CLI", () => {
  const entradas = [...Object.values(PACKAGE_COMMANDS), ...Object.values(RUNTIME_COMMANDS)];
  const orfas = FLAGS.map((flag) => flag.key)
    .filter((chave) => !GLOBAL_FLAGS.includes(chave))
    .filter((chave) => !entradas.some((entrada) => entrada.reads.includes(chave)));
  assert.deepEqual(orfas, []);
});
