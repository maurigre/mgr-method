#!/usr/bin/env node
// Baseline de saida da CLI para o teste de regressao da CONSTITUTION 2.7 / criterio 5 da
// spec fase1-fundacao-plugins: em projeto SEM plugins (sem mgr-skills.lock e sem registry
// configurado), install/list/status/update tem de sair como saiam ANTES da fundacao de
// plugins. Ferramenta de desenvolvimento do repo, fora do tarball npm (precedente: D3 da
// spec idioma-canonico-ingles, mesma pasta).
//
// Regenerar a baseline (so quando a mudanca de saida for DELIBERADA):
//   node scripts/capture-cli-baseline.mjs <ref-git> > test/fixtures/cli-baseline.txt
// `ref-git` default: main (a release anterior a fundacao de plugins).
//
// A comparacao e de CONTEUDO, nao de pixels: a normalizacao abaixo remove cor, moldura do
// @clack, caminhos absolutos, versao e timestamp; o que sobra e a informacao da CLI.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, "g");
const BOX = /[─-╿■-◿]/g;
const WRAP = 78;

export function normalize(text, { repo, home }) {
  return text
    .replace(ANSI, "")
    .replaceAll(repo, "<REPO>")
    .replaceAll(home, "<HOME>")
    .replace(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g, "<VERSION>")
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<TS>")
    .replace(BOX, " ")
    // A moldura do @clack quebra linha em funcao da LARGURA do conteudo (e o caminho do
    // repo temporario muda de tamanho a cada execucao): comparar linha a linha acusaria
    // diferenca cosmetica. Entao o texto e colapsado e reembrulhado deterministicamente.
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .reduce((lines, word) => {
      const current = lines[lines.length - 1];
      if (current && (current + " " + word).length <= WRAP) lines[lines.length - 1] = current + " " + word;
      else lines.push(word);
      return lines;
    }, [])
    .join("\n") + "\n";
}

// Sequencia da baseline: os quatro comandos que a spec 2.7 lista como estendidos.
export const BASELINE_COMMANDS = [
  ["list"],
  ["install", "--engine", "claude-code", "--arch", "hexagonal", "--project-id", "x", "-y", "<REPO>"],
  ["status", "<REPO>"],
  ["update", "<REPO>"],
];

export function captureCli(bin, { repo, home }) {
  const parts = [];
  for (const command of BASELINE_COMMANDS) {
    const args = command.map((arg) => (arg === "<REPO>" ? repo : arg));
    const stdout = execFileSync("node", [bin, ...args], {
      encoding: "utf8", cwd: repo, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: home, LC_ALL: "pt_BR.UTF-8" },
    });
    parts.push(`$ mgr ${command.join(" ")}`, normalize(stdout, { repo, home }));
  }
  return parts.join("\n");
}

function main() {
  const ref = process.argv[2] || "main";
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const work = mkdtempSync(path.join(os.tmpdir(), "mgr-baseline-"));
  const checkout = path.join(work, "src-tree");
  try {
    execFileSync("git", ["worktree", "add", "--detach", checkout, ref], { cwd: root, stdio: "ignore" });
    symlinkSync(path.join(root, "node_modules"), path.join(checkout, "node_modules"));
    const repo = mkdtempSync(path.join(work, "repo-"));
    const home = mkdtempSync(path.join(work, "home-"));
    process.stdout.write(`# baseline da CLI capturada de "${ref}" - regenerar com scripts/capture-cli-baseline.mjs\n`);
    process.stdout.write(captureCli(path.join(checkout, "bin", "mgr.js"), { repo, home }));
  } finally {
    execFileSync("git", ["worktree", "remove", "--force", checkout], { cwd: root, stdio: "ignore" });
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && process.argv[1].endsWith("capture-cli-baseline.mjs")) main();
