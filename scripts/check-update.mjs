#!/usr/bin/env node
// Teste de atualizacao (fatia fecha-0-7-0, task P0.1): um projeto instalado por uma versao PUBLICADA
// do mgr-method e atualizado pelo pacote deste repositorio, passa no doctor e desinstala limpo.
// Ferramenta de desenvolvimento do repo — fora do tarball npm, como o check-tmp.mjs.
//
// Uso:
//   node scripts/check-update.mjs [--from <versao>]... [--tarball <caminho.tgz>]
//
// --from     versao publicada de origem (repetivel; padrao 0.5.0)
// --tarball  pacote a testar; sem ele, o script roda `npm pack` do repositorio num temporario
//
// USA A REDE: baixa a versao de origem e as dependencias do pacote do registro npm, com um cache
// npm vazio num temporario (a origem vem do registro, nunca de copia local). Antes de cada origem,
// confere o registro com `npm view`; registro que nao responde ou versao nao publicada saem 1 com
// uma mensagem que nomeia a causa. Nunca pula e nunca passa sem ter rodado.
//
// Sai 0 so se TODAS as origens passarem em install, update, doctor e uninstall; 1 em qualquer
// falha; 2 em argumento invalido. A regra de julgamento e pura (`judgeUpdate`) e e o que a suite
// testa, junto com o exit 2 do `main`, que sai antes de qualquer subprocesso: a suite nunca chama a
// rede.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "./lib/tmp.mjs";

export const STEPS = Object.freeze(["install", "update", "doctor", "uninstall"]);
const DEFAULT_FROM = Object.freeze(["0.5.0"]);
const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const PACKAGE = "mgr-method";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAIL_LINES = 20;
const STEP_TIMEOUT_MS = 5 * 60 * 1000;

// Arquivos do usuario no projeto de teste. O `.gitignore` e o `.claude/settings.json` ficam onde o
// MGR tambem escreve: provam que o uninstall devolve o que era do usuario sem mudar um byte.
const USER_FILES = Object.freeze({
  "README.md": "# app\n",
  "src/app.js": "export const app = 1;\n",
  ".gitignore": "node_modules/\n",
  ".claude/settings.json": '{\n  "permissions": {}\n}\n',
});

/**
 * Regra pura. Recebe os fatos de UMA origem e devolve `{ ok, failures, warnings }`. Sem IO.
 * - `registry`: `{ ok, reason, detail }` da conferencia do registro (`reason`: `unreachable` ou
 *   `not-published`);
 * - `setup`: `{ ok, detail }` da montagem do projeto de teste;
 * - `steps`: `[{ step, exit }]` na ordem em que rodaram;
 * - `versions`: `{ expected, afterUpdate }`, a versao do pacote em teste e a do manifesto depois do
 *   update (ausente quando o update nao chegou a rodar com sucesso);
 * - `userBefore` e `after`: `{ caminho: sha256 }` antes do install e depois do uninstall;
 * - `emptyDirsAfter`: pastas vazias que sobraram e nao existiam antes.
 */
export function judgeUpdate({ registry, setup = { ok: true }, steps = [], versions, userBefore = {}, after = {}, emptyDirsAfter = [] }) {
  if (!registry?.ok) {
    const kind = registry?.reason === "not-published" ? "not-published" : "registry";
    return { ok: false, failures: [{ kind, detail: registry?.detail ?? "" }], warnings: [] };
  }
  if (!setup.ok) return { ok: false, failures: [{ kind: "setup", detail: setup.detail ?? "" }], warnings: [] };
  const failures = [];
  const exitPorPasso = new Map(steps.map(({ step, exit }) => [step, exit]));
  for (const step of STEPS) {
    if (!exitPorPasso.has(step)) failures.push({ kind: "step-missing", step });
    else if (exitPorPasso.get(step) !== 0) failures.push({ kind: "step", step, exit: exitPorPasso.get(step) });
  }
  if (versions && versions.afterUpdate !== versions.expected) {
    failures.push({ kind: "version-mismatch", expected: versions.expected, found: versions.afterUpdate ?? null });
  }
  for (const [arquivo, hash] of Object.entries(userBefore)) {
    if (!(arquivo in after)) failures.push({ kind: "user-missing", path: arquivo });
    else if (after[arquivo] !== hash) failures.push({ kind: "user-changed", path: arquivo });
  }
  for (const arquivo of Object.keys(after)) {
    if (!(arquivo in userBefore)) failures.push({ kind: "mgr-leftover", path: arquivo });
  }
  const warnings = emptyDirsAfter.map((pasta) => ({ kind: "empty-dir", path: pasta }));
  return { ok: failures.length === 0, failures, warnings };
}

/**
 * Regra pura: classifica a resposta do `npm view <pacote>@<from> version`. So passa com exit 0 E a
 * versao devolvida igual a pedida; `E404` e versao nao publicada; o resto e registro inacessivel.
 */
export function classifyRegistry(from, { exit, stdout, saida }) {
  const versao = stdout.trim().split("\n").pop()?.trim();
  if (exit === 0 && versao === from) return { ok: true };
  const reason = /\bE404\b/.test(saida) ? "not-published" : "unreachable";
  return { ok: false, reason, detail: cauda(saida) || `npm view saiu ${exit}` };
}

/** Le os argumentos. Devolve `{ from, tarball }` ou `{ error }`. */
export function parseArgs(argv) {
  const from = [];
  let tarball = null;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const valor = argv[i + 1];
    if ((flag !== "--from" && flag !== "--tarball") || valor === undefined || valor.startsWith("--")) {
      return { error: `argumento invalido: ${flag}` };
    }
    if (flag === "--from") {
      if (!VERSION_RE.test(valor)) return { error: `versao invalida em --from: ${valor}` };
      from.push(valor);
    } else {
      tarball = path.resolve(valor);
    }
    i += 1;
  }
  return { from: from.length ? from : [...DEFAULT_FROM], tarball };
}

const MENSAGEM = {
  registry: (item) => `registro npm inacessivel (o teste usa a rede): ${item.detail}`,
  "not-published": (item) => `versao de origem nao publicada no registro npm: ${item.detail}`,
  setup: (item) => `montagem do projeto de teste falhou: ${item.detail}`,
  "step-missing": (item) => `passo ${item.step} nao rodou`,
  step: (item) => `passo ${item.step} saiu ${item.exit}`,
  "version-mismatch": (item) =>
    `o update saiu 0 mas o manifesto ficou na versao ${item.found}, e nao na ${item.expected} do pacote em teste`,
  "user-missing": (item) => `arquivo do usuario sumiu: ${item.path}`,
  "user-changed": (item) => `arquivo do usuario mudou: ${item.path}`,
  "mgr-leftover": (item) => `arquivo do MGR sobrou depois do uninstall: ${item.path}`,
  "empty-dir": (item) => `pasta vazia sobrou depois do uninstall (nao reprova): ${item.path}`,
};

export function describeItem(item) {
  return MENSAGEM[item.kind](item);
}

function run(cmd, args, cwd, env) {
  // LOG-2: linha antes e depois de cada subprocesso.
  console.log(`check-update: $ ${cmd} ${args.join(" ")}`);
  const resultado = spawnSync(cmd, args, {
    cwd,
    env,
    encoding: "utf8",
    shell: false,
    timeout: STEP_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  const exit = resultado.status ?? 1;
  console.log(`check-update: exit ${exit} (${cmd})`);
  const stdout = resultado.stdout ?? "";
  const saida = `${stdout}${resultado.stderr ?? ""}${resultado.error ? String(resultado.error) : ""}`;
  return { exit, stdout, saida };
}

function cauda(texto) {
  return texto.trimEnd().split("\n").slice(-TAIL_LINES).join("\n");
}

function conferirRegistro(from, env) {
  return classifyRegistry(from, run("npm", ["view", `${PACKAGE}@${from}`, "version"], REPO, env));
}

// Arquivos e pastas do projeto, fora do `.git`. Arquivos viram `{ caminho: sha256 }`; link simbolico
// vira `link:<destino>`, para que trocar um arquivo do usuario por um link com o mesmo conteudo reprove.
function fotografar(raiz) {
  const arquivos = {};
  const pastasVazias = [];
  const andar = (pasta) => {
    const entradas = readdirSync(pasta, { withFileTypes: true }).filter((e) => e.name !== ".git");
    if (entradas.length === 0 && pasta !== raiz) pastasVazias.push(path.relative(raiz, pasta));
    for (const entrada of entradas) {
      const completo = path.join(pasta, entrada.name);
      if (entrada.isDirectory()) andar(completo);
      else if (entrada.isSymbolicLink()) arquivos[path.relative(raiz, completo)] = `link:${readlinkSync(completo)}`;
      else arquivos[path.relative(raiz, completo)] = createHash("sha256").update(readFileSync(completo)).digest("hex");
    }
  };
  andar(raiz);
  return { arquivos, pastasVazias };
}

function montarProjeto(env) {
  const projeto = tempDir("check-update-");
  // LOG-1: linha antes e depois da gravacao dos arquivos do usuario.
  console.log(`check-update: gravando ${Object.keys(USER_FILES).join(", ")} em ${projeto}`);
  for (const [arquivo, conteudo] of Object.entries(USER_FILES)) {
    mkdirSync(path.dirname(path.join(projeto, arquivo)), { recursive: true });
    writeFileSync(path.join(projeto, arquivo), conteudo);
  }
  console.log(`check-update: ${Object.keys(USER_FILES).length} arquivos do usuario gravados`);
  const git = run("git", ["init", "-q"], projeto, env);
  if (git.exit !== 0) return { projeto, setup: { ok: false, detail: cauda(git.saida) || `git init saiu ${git.exit}` } };
  return { projeto, setup: { ok: true } };
}

function empacotar(env) {
  const destino = tempDir("check-update-pack-");
  const resultado = run("npm", ["pack", "--silent", "--pack-destination", destino], REPO, env);
  const nome = resultado.stdout.trim().split("\n").pop()?.trim();
  if (resultado.exit !== 0 || !nome || !existsSync(path.join(destino, nome))) {
    return { error: cauda(resultado.saida) || `npm pack saiu ${resultado.exit}` };
  }
  return { tarball: path.join(destino, nome) };
}

// A versao do pacote em teste sai do package.json dentro do tarball.
function versaoDoTarball(tarball, env) {
  const resultado = run("tar", ["-xzOf", tarball, "package/package.json"], REPO, env);
  if (resultado.exit !== 0) return null;
  try {
    return JSON.parse(resultado.stdout).version ?? null;
  } catch {
    return null;
  }
}

function versaoDoManifesto(projeto) {
  try {
    return JSON.parse(readFileSync(path.join(projeto, ".mgr-core", "manifest.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

function comandoDoPasso(step, from, tarball) {
  if (step === "install") {
    return ["npx", ["-y", `${PACKAGE}@${from}`, "install", "--engine", "claude-code", "--language", "javascript", "--arch", "layered", "-y"]];
  }
  const args = step === "doctor" ? [step] : [step, "-y"];
  return ["npm", ["exec", "-y", `--package=${tarball}`, "--", PACKAGE, ...args]];
}

function testarOrigem(from, tarball, expected, env) {
  const registry = conferirRegistro(from, env);
  if (!registry.ok) return judgeUpdate({ registry });
  const { projeto, setup } = montarProjeto(env);
  if (!setup.ok) return judgeUpdate({ registry, setup });
  const antes = fotografar(projeto);
  const steps = [];
  let versions;
  for (const step of STEPS) {
    const [cmd, args] = comandoDoPasso(step, from, tarball);
    const resultado = run(cmd, args, projeto, env);
    steps.push({ step, exit: resultado.exit });
    console.log(`check-update [${from}] ${step}: exit ${resultado.exit}`);
    if (step === "update" && resultado.exit === 0) versions = { expected, afterUpdate: versaoDoManifesto(projeto) };
    if (resultado.exit !== 0) {
      console.error(cauda(resultado.saida));
      break;
    }
  }
  const depois = fotografar(projeto);
  const novasVazias = depois.pastasVazias.filter((pasta) => !antes.pastasVazias.includes(pasta));
  return judgeUpdate({ registry, steps, versions, userBefore: antes.arquivos, after: depois.arquivos, emptyDirsAfter: novasVazias });
}

export function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(`check-update: ${args.error}`);
    console.error("uso: node scripts/check-update.mjs [--from <versao>]... [--tarball <caminho.tgz>]");
    return 2;
  }
  const env = { ...process.env, NO_COLOR: "1", CI: "true", npm_config_cache: tempDir("check-update-cache-") };
  let { tarball } = args;
  if (!tarball) {
    const pacote = empacotar(env);
    if (pacote.error) {
      console.error(`check-update: npm pack falhou\n${pacote.error}`);
      return 1;
    }
    tarball = pacote.tarball;
  }
  const expected = versaoDoTarball(tarball, env);
  if (!expected) {
    console.error(`check-update: --tarball nao e um pacote npm legivel (sem package/package.json com versao): ${tarball}`);
    return 2;
  }
  console.log(`check-update: pacote em teste ${tarball} (versao ${expected})`);
  let reprovadas = 0;
  for (const from of args.from) {
    const { ok, failures, warnings } = testarOrigem(from, tarball, expected, env);
    for (const aviso of warnings) console.log(`check-update [${from}] aviso: ${describeItem(aviso)}`);
    for (const falha of failures) console.error(`check-update [${from}] FALHA: ${describeItem(falha)}`);
    console.log(`check-update [${from}] ${ok ? "OK" : "REPROVADO"}`);
    if (!ok) reprovadas += 1;
  }
  return reprovadas === 0 ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-update.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
