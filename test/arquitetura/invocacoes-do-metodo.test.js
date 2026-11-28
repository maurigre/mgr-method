import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "../../scripts/lib/tmp.mjs";
import { BASELINE_COMMANDS } from "../../scripts/capture-cli-baseline.mjs";
import { STEPS, comandoDoPasso } from "../../scripts/check-update.mjs";
import { PACKAGE_COMMANDS, RUNTIME_COMMANDS, checkFlags, parseArgs } from "../../src/core/cli-args.js";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MOTORES = ["claude-code", "copilot"];
const MARCA_DO_RUNTIME = "node {{MGR_RUNTIME}} ";

function arquivosMarkdown(pasta) {
  return readdirSync(path.join(RAIZ, pasta), { recursive: true })
    .filter((nome) => nome.endsWith(".md"))
    .map((nome) => path.join(pasta, nome));
}

function abrirOpcionais(linha) {
  return linha.replace(/\[([^\]]*)\]/g, "$1").replace(/<[^>]+>/g, "x").trim();
}

function invocacoesDasSkills() {
  const achadas = [];
  for (const arquivo of [...arquivosMarkdown("skills"), ...arquivosMarkdown("agents"), ...arquivosMarkdown("shared")]) {
    const linhas = readFileSync(path.join(RAIZ, arquivo), "utf8").split("\n");
    linhas.forEach((linha, indice) => {
      let resto = linha;
      let inicio = resto.indexOf(MARCA_DO_RUNTIME);
      while (inicio >= 0) {
        const trecho = resto.slice(inicio + MARCA_DO_RUNTIME.length).split("`")[0];
        if (trecho !== "<command>") achadas.push({ origem: `${arquivo}:${indice + 1}`, cli: "runtime", argv: abrirOpcionais(trecho).split(/\s+/) });
        resto = resto.slice(inicio + MARCA_DO_RUNTIME.length);
        inicio = resto.indexOf(MARCA_DO_RUNTIME);
      }
    });
  }
  return achadas;
}

function invocacoesDosHooks() {
  const projeto = tempDir("invocacoes-hooks-");
  spawnSync("git", ["init", "-q"], { cwd: projeto });
  writeFileSync(path.join(projeto, "README.md"), "x\n");
  const install = spawnSync(process.execPath, [path.join(RAIZ, "bin", "mgr.js"), "install", "--engine", "claude-code", "-y"], { cwd: projeto, env: { ...process.env, NO_COLOR: "1", CI: "true" }, encoding: "utf8" });
  assert.equal(install.status, 0, install.stderr);
  const settings = JSON.parse(readFileSync(path.join(projeto, ".claude", "settings.local.json"), "utf8"));
  const comandos = Object.values(settings.hooks).flat().flatMap((grupo) => grupo.hooks.map((hook) => hook.command));
  return comandos.map((comando) => ({
    origem: ".claude/settings.local.json (gravado pelo install)",
    cli: "runtime",
    argv: comando.split("#")[0].trim().split(/\s+/).slice(2),
  }));
}

function invocacoesDosScripts() {
  const linhaDeBase = BASELINE_COMMANDS.map((argv) => ({ origem: "scripts/capture-cli-baseline.mjs", cli: "pacote", argv: argv.map((parte) => (parte === "<REPO>" ? "x" : parte)) }));
  const atualizacao = STEPS.filter((passo) => passo !== "install").map((passo) => {
    const [, args] = comandoDoPasso(passo, "0.0.0", "pacote.tgz");
    return { origem: "scripts/check-update.mjs", cli: "pacote", argv: args.slice(args.indexOf("--") + 2) };
  });
  const medida = readFileSync(path.join(RAIZ, "scripts", "measure-cost.mjs"), "utf8").match(/\["bin\/mgr\.js", ([^\]]*)\]/);
  const custo = { origem: "scripts/measure-cost.mjs", cli: "pacote", argv: medida[1].split(",").map((parte) => parte.trim().replace(/^"|"$/g, "")).map((parte) => (parte === "slug" ? "x" : parte)) };
  const fontes = [path.join(RAIZ, "package.json"), ...readdirSync(path.join(RAIZ, ".github", "workflows")).map((nome) => path.join(RAIZ, ".github", "workflows", nome))];
  const pacote = fontes.flatMap((arquivo) => [...readFileSync(arquivo, "utf8").matchAll(/node bin\/mgr\.js ([a-z][^"'\n&|]*)/g)]
    .map((casado) => ({ origem: path.relative(RAIZ, arquivo), cli: "pacote", argv: casado[1].trim().split(/\s+/) })));
  return [...linhaDeBase, ...atualizacao, custo, ...pacote];
}

function recusadas(invocacoes) {
  return invocacoes.flatMap(({ origem, cli, argv }) => {
    const [command, ...rest] = argv;
    const { positional, seen, unknownFlag } = parseArgs(rest, { engines: MOTORES });
    const commands = cli === "pacote" ? PACKAGE_COMMANDS : RUNTIME_COMMANDS;
    const fallback = cli === "pacote" ? null : PACKAGE_COMMANDS;
    if (unknownFlag) return [`${origem}: ${argv.join(" ")} (flag desconhecida ${unknownFlag})`];
    const julgamento = checkFlags({ commands, fallback, command, positional, seen });
    return julgamento.ok ? [] : [`${origem}: ${argv.join(" ")} (${julgamento.flag})`];
  });
}

test("should find the runtime invocations the distributed skills document", () => {
  const argvs = invocacoesDasSkills().map(({ argv }) => argv.join(" "));
  assert.ok(argvs.includes("spec status x --json"), argvs.join("\n"));
  assert.ok(argvs.includes("agents set x --model x --effort x --engine x"), argvs.join("\n"));
});

test("should accept every runtime invocation the distributed skills document", () => {
  assert.deepEqual(recusadas(invocacoesDasSkills()), []);
});

test("should accept the hook commands the install writes", () => {
  const hooks = invocacoesDosHooks();
  assert.deepEqual(hooks.map(({ argv }) => argv[0]).sort(), ["detect", "precompact"]);
  assert.deepEqual(recusadas(hooks), []);
});

test("should accept the package invocations of the repository scripts and workflows", () => {
  const scripts = invocacoesDosScripts();
  assert.ok(scripts.some(({ origem }) => origem.startsWith(".github")), "nenhuma invocação de workflow encontrada");
  assert.deepEqual(recusadas(scripts), []);
});
