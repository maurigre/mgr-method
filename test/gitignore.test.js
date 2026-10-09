import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  GITIGNORE_BLOCK,
  PERSONAL_LINES,
  planGitignore,
  removeGitignoreBlock,
  writeGitignoreBlock,
} from "../src/gitignore.js";

import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { consentToGitignore } from "../src/prompts.js";

const diretorioTemporario =() => mkdtempSync(path.join(os.tmpdir(), "mgr-gitignore-"));

const arquivoDe = (repo) => path.join(repo, ".gitignore");

const comGitignore = (conteudo) => {
  const repo = diretorioTemporario();
  writeFileSync(arquivoDe(repo), conteudo, "utf8");
  return repo;
};

const ler = (repo) => readFileSync(arquivoDe(repo), "utf8");

const BLOCO = GITIGNORE_BLOCK.join("\n");

test("bloco literal tem as duas linhas de borda e as duas linhas pessoais da DT-4", () => {
  assert.deepEqual(GITIGNORE_BLOCK, [
    "# >>> mgr-method (managed block: mgr uninstall removes it) >>>",
    ".mgr-core/config.local.json",
    ".mgr-core/.env",
    "# <<< mgr-method <<<",
  ]);
  assert.deepEqual(PERSONAL_LINES, [".mgr-core/config.local.json", ".mgr-core/.env"]);
});

test("should append the managed block once", () => {
  const repo = comGitignore("node_modules/\n");

  writeGitignoreBlock(repo);
  writeGitignoreBlock(repo);

  assert.equal(ler(repo), `node_modules/\n${BLOCO}\n`);
  assert.equal(ler(repo).split(GITIGNORE_BLOCK[0]).length - 1, 1, "a marca de abertura aparece uma vez");
});

test("should replace the block in place on a second write", () => {
  const repo = comGitignore(`antes\n# >>> mgr-method (managed block: mgr uninstall removes it) >>>\nlinha velha\n# <<< mgr-method <<<\ndepois\n`);

  writeGitignoreBlock(repo);

  assert.equal(ler(repo), `antes\n${BLOCO}\ndepois\n`);
});

test("should keep every line outside the block byte for byte", () => {
  const prefixo = "dist/ \r\n  #  comentário com espaço\r\n*.log\r\n";
  const sufixo = "\r\n!keep.log\r\nsem-quebra-final";
  const repo = comGitignore(`${prefixo}${GITIGNORE_BLOCK.join("\r\n")}${sufixo}`);

  writeGitignoreBlock(repo);
  const apos = ler(repo);

  assert.ok(apos.startsWith(prefixo), "o conteúdo antes do bloco ficou byte a byte");
  assert.ok(apos.endsWith(sufixo), "o conteúdo depois do bloco ficou byte a byte");
  assert.ok(apos.includes(GITIGNORE_BLOCK.join("\r\n")), "o bloco foi reescrito no lugar, com o fim de linha do arquivo");
});

test("should remove only the managed block", () => {
  const repo = comGitignore(`antes\n${BLOCO}\ndepois\n`);

  const removido = removeGitignoreBlock(repo);

  assert.deepEqual(removido, { outcome: "removed", file: arquivoDe(repo) });
  assert.equal(ler(repo), "antes\ndepois\n");
});

test("should report absent when the gitignore has no managed block", () => {
  const repo = comGitignore("antes\n");

  assert.deepEqual(removeGitignoreBlock(repo), { outcome: "absent", file: arquivoDe(repo) });
  assert.equal(ler(repo), "antes\n");
});

test("should report no-file when there is no gitignore", () => {
  const repo = comGitignore("x\n");
  rmSync(arquivoDe(repo));

  assert.deepEqual(removeGitignoreBlock(repo), { outcome: "no-file", file: arquivoDe(repo) });
});

test("should delete a gitignore that held only the block", () => {
  const repo = comGitignore(`${BLOCO}\n\n  \n`);

  const removido = removeGitignoreBlock(repo);

  assert.deepEqual(removido, { outcome: "removed", file: arquivoDe(repo) });
  assert.equal(existsSync(arquivoDe(repo)), false);
});

test("should flag each literal line that ignores the team config", () => {
  const repo = comGitignore([
    ".mgr-core",
    "/.mgr-core/",
    "# .mgr-core",
    ".mgr-core/config.local.json",
    ".mgr-core/config.json",
    "/.mgr-core",
    "",
  ].join("\n"));

  const plano = planGitignore(repo);

  assert.deepEqual(plano.teamIgnoredLines, [".mgr-core", "/.mgr-core/", ".mgr-core/config.json", "/.mgr-core"]);
});

test("should not evaluate glob or negation patterns", () => {
  const repo = comGitignore([".mgr-core*", "**/.mgr-core", ".mgr-core/*", "!.mgr-core/config.json", "!.mgr-core", ""].join("\n"));

  const plano = planGitignore(repo);

  assert.deepEqual(plano.teamIgnoredLines, [], "padrão glob e negação ficam fora do aviso, por limite declarado");
});

// --- P1.7: borda do install e do uninstall (processo filho, fora de git) ---
const MGR_BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "mgr.js");

const rodar = (args, home) => spawnSync(process.execPath, [MGR_BIN, ...args], {
  encoding: "utf8",
  input: "",
  timeout: 120000,
  env: { ...process.env, LC_ALL: "C", HOME: home },
});

const projetoForaDeGit = (conteudo) => {
  const repo = path.join(diretorioTemporario(), "p");
  mkdirSync(repo);
  const sonda = spawnSync("git", ["-C", repo, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  assert.equal(sonda.error, undefined, "git precisa rodar para provar que o diretório está fora de um repositório");
  assert.notEqual(sonda.status, 0, "o diretório temporário não pode estar dentro de um git work tree");
  if (conteudo !== undefined) writeFileSync(arquivoDe(repo), conteudo, "utf8");
  return { repo, home: diretorioTemporario() };
};

const ARGS_INSTALL = ["install", "--engine", "claude-code", "--scope", "project", "--all-skills"];
const instalar = ({ repo, home }, extra = ["-y"]) => rodar([...ARGS_INSTALL, ...extra, repo], home);
const saida = (r) => `${r.stdout}${r.stderr}`;

test("should write the block once across two installs with -y", () => {
  const ctx = projetoForaDeGit();

  const a = instalar(ctx);
  const b = instalar(ctx);

  assert.equal(a.status, 0, saida(a));
  assert.equal(b.status, 0, saida(b));
  const texto = ler(ctx.repo);
  assert.equal(texto.split(GITIGNORE_BLOCK[0]).length - 1, 1, "o bloco aparece uma vez só");
  assert.equal(texto, GITIGNORE_BLOCK.join("\n") + "\n");
});

test("should keep a previous node_modules line byte for byte", () => {
  const ctx = projetoForaDeGit("node_modules/\n");

  const r = instalar(ctx);

  assert.equal(r.status, 0, saida(r));
  assert.ok(ler(ctx.repo).startsWith("node_modules/\n"), "a linha anterior fica intacta no começo");
  assert.ok(ler(ctx.repo).endsWith(GITIGNORE_BLOCK.join("\n") + "\n"));
});

test("should leave gitignore unchanged without a terminal and without -y", () => {
  const ctx = projetoForaDeGit("node_modules/\n");

  const r = instalar(ctx, []);

  assert.equal(r.status, 0, saida(r));
  assert.equal(ler(ctx.repo), "node_modules/\n");
  assert.match(saida(r), /Keep these out of version control/);
  for (const linha of PERSONAL_LINES) assert.ok(saida(r).includes(linha), `a saída lista ${linha}`);
});

test("should decline when the stub answers no", async () => {
  const perguntas = [];
  const ask = { confirm: async (opcoes) => { perguntas.push(opcoes); return false; }, isCancel: () => false };

  const decisao = await consentToGitignore(ask, { mode: "ask" });

  assert.equal(decisao, "decline");
  assert.equal(perguntas.length, 1);
  assert.equal(perguntas[0].initialValue, true, "DT-4: o bloco só acrescenta linhas, o padrão é sim");
});

test("should warn when .mgr-core/ is ignored", () => {
  const ctx = projetoForaDeGit(".mgr-core/\n");

  const r = instalar(ctx);

  assert.equal(r.status, 0, saida(r));
  assert.match(saida(r), /ignores the team config/);
});

test("should remove the block and keep other lines on uninstall", () => {
  const ctx = projetoForaDeGit("node_modules/\n");
  assert.equal(instalar(ctx).status, 0);

  const r = rodar(["uninstall", "--scope", "project", "-y", ctx.repo], ctx.home);

  assert.equal(r.status, 0, saida(r));
  assert.equal(ler(ctx.repo), "node_modules/\n");
  // CA-9: a saída anuncia o bloco removido e o caminho de `.mgr-core`.
  assert.match(saida(r), /managed block removed from \.gitignore/);
  assert.match(saida(r), /\.mgr-core/);
});

test("should delete a gitignore that held only the block on uninstall", () => {
  const ctx = projetoForaDeGit();
  assert.equal(instalar(ctx).status, 0);
  assert.ok(existsSync(arquivoDe(ctx.repo)));

  const r = rodar(["uninstall", "--scope", "project", "-y", ctx.repo], ctx.home);

  assert.equal(r.status, 0, saida(r));
  assert.equal(existsSync(arquivoDe(ctx.repo)), false);
});
