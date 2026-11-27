import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "../../scripts/lib/tmp.mjs";
import { fotografar } from "../../scripts/check-update.mjs";
import { getMessages } from "../../src/core/messages.js";
import { effortFlagLevels } from "../../src/core/cli-args.js";
import { criarCodexFalso } from "../helpers/codex-falso.js";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BIN = path.join(RAIZ, "bin", "mgr.js");
const RUNTIME = path.join(".mgr-core", "runtime", "bin", "mgr-runtime.js");
const TEM_SCRIPT = spawnSync("script", ["--version"], { encoding: "utf8" }).status === 0;
const CODEX_FALSO = criarCodexFalso("ok");
const aspas = (texto) => `'${String(texto).replace(/'/g, "'\\''")}'`;

function prepararModelo() {
  const projeto = tempDir("flag-modelo-");
  const home = tempDir("flag-home-");
  spawnSync("git", ["init", "-q"], { cwd: projeto });
  writeFileSync(path.join(projeto, "README.md"), "x\n");
  const install = rodar("pacote", ["install", "--engine", "claude-code", "--language", "javascript", "--arch", "layered", "-y"], { projeto, home });
  assert.equal(install.status, 0, install.stderr);
  return { projeto, home };
}

function env(home) {
  return { ...CODEX_FALSO.env, NO_COLOR: "1", CI: "true", LC_ALL: "C", LANG: "C", HOME: home };
}

function rodar(cli, argv, { projeto, home }, input = "") {
  const programa = cli === "pacote" ? BIN : path.join(projeto, RUNTIME);
  return spawnSync(process.execPath, [programa, ...argv], { cwd: projeto, env: env(home), encoding: "utf8", input, timeout: 60000 });
}

function copiar(modelo) {
  const projeto = tempDir("flag-projeto-");
  const home = tempDir("flag-home-");
  cpSync(modelo.projeto, projeto, { recursive: true });
  cpSync(modelo.home, home, { recursive: true });
  return { projeto, home };
}

function foto({ projeto, home }) {
  return { projeto: fotografar(projeto).arquivos, home: fotografar(home).arquivos };
}

const modelo = prepararModelo();
const versao = JSON.parse(readFileSync(path.join(modelo.projeto, ".mgr-core", "manifest.json"), "utf8")).version;
const mensagens = getMessages("en", { lifecycle: `npx mgr-method@${versao}` });

function recusaSemEfeito(cli, argv, esperado) {
  const alvo = copiar(modelo);
  const antes = foto(alvo);
  const saida = rodar(cli, argv, alvo);
  assert.equal(saida.status, 1, `${argv.join(" ")}: ${saida.stderr}`);
  assert.equal(saida.stderr, `${esperado}\n`, argv.join(" "));
  assert.equal(saida.stdout, "", argv.join(" "));
  assert.deepEqual(foto(alvo), antes, argv.join(" "));
}

test("should refuse --dry-run on every measured package command without writing anything", () => {
  const casos = [
    [["update", "--dry-run"], "update"],
    [["spec", "initials", "set", "ab", "--dry-run"], "spec initials set"],
    [["origin", "set", "greenfield", "--dry-run"], "origin set"],
    [["runtime-versioning", "set", "versioned", "--dry-run"], "runtime-versioning set"],
    [["agents", "set", "drafting", "--model", "x", "--dry-run"], "agents set"],
  ];
  for (const [argv, entrada] of casos) recusaSemEfeito("pacote", argv, mensagens.flagNotAccepted("--dry-run", entrada, ["install"]));
});

test("should keep the installation byte for byte when uninstall gets --dry-run", () => {
  recusaSemEfeito("pacote", ["uninstall", "-y", "--dry-run"], mensagens.flagNotAccepted("--dry-run", "uninstall", ["install"]));
});

test("should refuse through the runtime pointing to the lifecycle command that accepts the flag", () => {
  const casos = [
    [["origin", "set", "greenfield", "--dry-run"], "origin set"],
    [["spec", "initials", "set", "ab", "--dry-run"], "spec initials set"],
    [["agents", "set", "drafting", "--model", "x", "--dry-run"], "agents set"],
  ];
  for (const [argv, entrada] of casos) recusaSemEfeito("runtime", argv, mensagens.flagNotAcceptedLifecycle("--dry-run", entrada, ["install"]));
  recusaSemEfeito("runtime", ["doctor", "--base", "x"], mensagens.flagNotAccepted("--base", "doctor", ["review external"]));
});

test("should keep the lifecycle refusal of the runtime when the flag is also unused", () => {
  for (const argv of [["update"], ["runtime-versioning", "set", "versioned"], ["review", "enable"]]) {
    const semFlag = rodar("runtime", argv, copiar(modelo));
    const comFlag = rodar("runtime", [...argv, "--dry-run"], copiar(modelo));
    assert.equal(comFlag.status, semFlag.status, argv.join(" "));
    assert.equal(comFlag.stderr, semFlag.stderr, argv.join(" "));
  }
});

test("should keep the unknown flag, the help flag and the unknown command as before", () => {
  for (const cli of ["pacote", "runtime"]) {
    for (const argv of [["update", "--nada"], ["update", "--dry-run", "--nada"], ["update", "--nada", "--dry-run"]]) {
      const saida = rodar(cli, argv, copiar(modelo));
      assert.equal(saida.status, 1, `${cli} ${argv.join(" ")}`);
      assert.equal(saida.stderr, `${mensagens.unknownFlag("--nada")}\n`, `${cli} ${argv.join(" ")}`);
    }
  }
  const ajuda = rodar("pacote", ["update", "--help"], copiar(modelo));
  assert.equal(ajuda.stderr, `${mensagens.unknownFlag("--help")}\n`);
  const semFlag = rodar("pacote", ["hooks"], copiar(modelo));
  const comFlag = rodar("pacote", ["hooks", "--dry-run"], copiar(modelo));
  assert.equal(comFlag.status, semFlag.status);
  assert.equal(comFlag.stderr, semFlag.stderr);
});

test("should judge each subcommand by its own set of flags", () => {
  recusaSemEfeito("pacote", ["agents", "--model", "x"], mensagens.flagNotAccepted("--model", "agents", ["agents set", "review set"]));
  recusaSemEfeito("pacote", ["registry", "list", "--trusted"], mensagens.flagNotAccepted("--trusted", "registry list", ["registry add"]));
  recusaSemEfeito("pacote", ["update", "--engine", "both"], mensagens.flagNotAccepted("--engine", "update", ["install", "add", "agents set"]));
  const grava = rodar("pacote", ["agents", "set", "drafting", "--model", "x"], copiar(modelo));
  assert.equal(grava.status, 0, grava.stderr);
  const vazio = { projeto: tempDir("flag-vazio-"), home: tempDir("flag-home-") };
  spawnSync("git", ["init", "-q"], { cwd: vazio.projeto });
  const install = rodar("pacote", ["install", "--engine", "both", "--language", "javascript", "--arch", "layered", "-y"], vazio);
  assert.equal(install.status, 0, install.stderr);
});

test("should keep the own refusals of the flags read only to refuse", () => {
  const propria = getMessages("en");
  const casos = [
    [["install", "--model", "x"], propria.modelFlagBare()],
    [["install", "--effort", "max"], propria.effortFlagBare(effortFlagLevels.join(" | "))],
    [["spec", "next", "--all"], propria.specNextAllRefused],
    [["spec", "archive", "x", "--all"], propria.specArchiveAllRefused],
    [["review", "external", "x", "--all"], propria.reviewNeedsSlug],
    [["review", "waive", "x", "--all"], propria.reviewWaiveNeedsSlug],
  ];
  for (const [argv, frase] of casos) {
    const saida = rodar("pacote", argv, copiar(modelo));
    assert.equal(saida.status, 1, argv.join(" "));
    assert.ok(saida.stderr.includes(frase), `${argv.join(" ")}: ${saida.stderr}`);
    assert.doesNotMatch(saida.stderr, /it is accepted by/, argv.join(" "));
  }
});

test("should refuse a harmless flag, --json without json output, and flags on version and help", () => {
  recusaSemEfeito("pacote", ["doctor", "-y"], mensagens.flagNotAccepted("-y", "doctor", ["install", "update", "uninstall"]));
  for (const argv of [["status", "--json"], ["version", "--dry-run"], ["help", "--json"]]) {
    const saida = rodar("pacote", argv, copiar(modelo));
    assert.equal(saida.status, 1, argv.join(" "));
    assert.match(saida.stderr, /does not accept/, argv.join(" "));
  }
});

test("should accept --user-language on a command that reads no other flag", () => {
  const saida = rodar("pacote", ["status", "--user-language", "en"], copiar(modelo));
  assert.equal(saida.status, 0, saida.stderr);
});

test("should keep the hook contract when the hook command gets an extra flag", () => {
  for (const cli of ["pacote", "runtime"]) {
    const semFlag = rodar(cli, ["detect", "--hook", "claude-code"], copiar(modelo));
    const comFlag = rodar(cli, ["detect", "--hook", "claude-code", "--dry-run"], copiar(modelo));
    assert.equal(comFlag.status, semFlag.status, cli);
    assert.equal(comFlag.stdout, semFlag.stdout, cli);
    const payload = JSON.stringify({ trigger: "manual" });
    const preSem = rodar(cli, ["precompact", "--hook", "claude-code"], copiar(modelo), payload);
    const preCom = rodar(cli, ["precompact", "--hook", "claude-code", "--json"], copiar(modelo), payload);
    assert.equal(preCom.status, preSem.status, cli);
    assert.equal(preCom.stdout, preSem.stdout, cli);
  }
});

test("should refuse review enable --dry-run in a real terminal before asking and without writing the config", { skip: TEM_SCRIPT ? false : "sem o utilitario script, nao ha pty para o caminho com terminal" }, () => {
  const alvo = copiar(modelo);
  const config = path.join(alvo.projeto, ".mgr-core");
  const antes = fotografar(config).arquivos;
  const saida = spawnSync("script", ["-qec", `stty cols 200 rows 50; ${[process.execPath, BIN, "review", "enable", "--dry-run"].map(aspas).join(" ")}`, "/dev/null"], { cwd: alvo.projeto, env: env(alvo.home), encoding: "utf8", input: "\n", timeout: 60000 });
  assert.equal(saida.status, 1, saida.stdout);
  assert.match(saida.stdout, /review enable does not accept --dry-run/);
  assert.doesNotMatch(saida.stdout, new RegExp(mensagens.reviewEnableConfirm.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(fotografar(config).arquivos, antes);
});
