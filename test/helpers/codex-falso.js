// `codex` FALSO para os testes da revisão externa (spec revisor-externo, §6.1 e RN-21). É um executável
// de verdade num diretório temporário: o subprocesso roda, só o binário do outro lado é trocado (TST-2,
// fake só na borda). Nenhum teste envia código para fora.
//
// O PATH dos testes nunca alcança o `codex` real: `pathSemCodex` tira do PATH toda pasta que contém um
// `codex` (nesta máquina ele mora na mesma pasta do `node`), e o falso roda pelo caminho absoluto do Node.
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { tempDir } from "../../scripts/lib/tmp.mjs";

export const VERSAO_FALSA = "codex-cli 0.0.0-falso";
export const SESSAO_FALSA = "sessao-falsa-1";
export const RESPOSTA_VAZIA = Object.freeze({ specAxis: "reviewed", standards: [], spec: [], suggestions: [] });

export const MODOS = Object.freeze(["ok", "nao-logado", "falha", "json-invalido", "fora-do-schema", "sem-o", "sem-sessao", "recusa-esforco", "sem-versao", "sem-permissao", "falha-no-fluxo", "suja-a-arvore"]);

const temCodex = (pasta) => existsSync(path.join(pasta, "codex")) || existsSync(path.join(pasta, "codex.cmd"));

export const pathSemCodex = (base = process.env.PATH ?? "") =>
  base.split(path.delimiter).filter((pasta) => pasta !== "" && !temCodex(pasta)).join(path.delimiter);

const SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");
const pasta = __dirname;
const config = JSON.parse(fs.readFileSync(path.join(pasta, "config.json"), "utf8"));
const argv = process.argv.slice(2);
const registro = path.join(pasta, "chamadas.json");
const chamadas = fs.existsSync(registro) ? JSON.parse(fs.readFileSync(registro, "utf8")) : [];
chamadas.push(argv);
fs.writeFileSync(registro, JSON.stringify(chamadas));
if (argv[0] === "--version") {
  if (config.modo === "sem-versao") { process.stderr.write("versao indisponivel\\n"); process.exit(3); }
  process.stdout.write(config.versao + "\\n"); process.exit(0);
}
if (argv[0] === "login") {
  if (config.modo === "nao-logado") { process.stderr.write("Not logged in\\n"); process.exit(1); }
  process.stderr.write("Logged in using ChatGPT\\n"); process.exit(0);
}
if (argv[0] !== "exec") { process.stderr.write("comando inesperado\\n"); process.exit(9); }
if (config.modo === "falha-no-fluxo") {
  process.stderr.write("Reading additional input from stdin...\\n");
  process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: config.sessao }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "error", message: "modelo desconhecido" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "turn.failed", error: { message: "modelo desconhecido" } }) + "\\n");
  process.exit(1);
}
if (config.modo === "falha") { process.stderr.write("erro do revisor: limite atingido\\n"); process.exit(2); }
if (config.modo === "recusa-esforco" && argv.some((valor) => valor.startsWith("model_reasoning_effort="))) {
  process.stderr.write("unsupported reasoning effort\\n"); process.exit(1);
}
const destino = argv[argv.indexOf("--output-last-message") + 1];
if (config.modo === "suja-a-arvore") fs.writeFileSync(path.join(argv[argv.indexOf("--cd") + 1], "intruso.js"), "x\\n");
if (config.modo !== "sem-o") {
  const texto = config.modo === "json-invalido" ? "isto nao e json"
    : config.modo === "fora-do-schema" ? JSON.stringify({ specAxis: "talvez" })
    : JSON.stringify(config.resposta);
  fs.writeFileSync(destino, texto);
}
if (config.modo !== "sem-sessao") process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: config.sessao }) + "\\n");
process.stdout.write(JSON.stringify({ type: "turn.completed" }) + "\\n");
process.exit(0);
`;

// Cria o falso no modo pedido. Devolve a pasta, o `env` com o PATH que o alcança (e não alcança o
// real) e as chamadas registradas, uma lista de argv por invocação.
export function criarCodexFalso(modo = "ok", { resposta = RESPOSTA_VAZIA, sessao = SESSAO_FALSA } = {}) {
  if (!MODOS.includes(modo)) throw new Error(`modo desconhecido do codex falso: ${modo}`);
  const pasta = tempDir("mgr-codex-falso-");
  writeFileSync(path.join(pasta, "config.json"), JSON.stringify({ modo, resposta, sessao, versao: VERSAO_FALSA }));
  writeFileSync(path.join(pasta, "codex.cjs"), SCRIPT);
  const executavel = path.join(pasta, "codex");
  writeFileSync(executavel, `#!/bin/sh\nexec "${process.execPath}" "${path.join(pasta, "codex.cjs")}" "$@"\n`);
  chmodSync(executavel, modo === "sem-permissao" ? 0o644 : 0o755);
  return {
    pasta,
    env: { ...process.env, PATH: [pasta, pathSemCodex()].join(path.delimiter) },
    chamadas: () => {
      const registro = path.join(pasta, "chamadas.json");
      return existsSync(registro) ? JSON.parse(readFileSync(registro, "utf8")) : [];
    },
  };
}

// Ambiente SEM codex nenhum: o caso "revisor não instalado".
export const envSemCodex = () => ({ ...process.env, PATH: pathSemCodex() });
