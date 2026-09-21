import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pendentes } from "../scripts/check-clean.mjs";

const repoTemporario = () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mgr-pend-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  return repo;
};

test("shouldListAnUntrackedFileSoItReachesTheCleanTree", () => {
  const repo = repoTemporario();
  writeFileSync(path.join(repo, "novo.js"), "export const x = 1;\n");
  assert.deepEqual(pendentes(repo), ["novo.js"],
    "arquivo nao commitado tem de ir para a arvore limpa, senao o check roda sobre codigo velho");
});

test("shouldListAnUntrackedDirectoryAsTheDirectoryItself", () => {
  const repo = repoTemporario();
  mkdirSync(path.join(repo, "scripts"));
  writeFileSync(path.join(repo, "scripts", "novo.mjs"), "export const y = 2;\n");
  assert.deepEqual(pendentes(repo), ["scripts/"],
    "git reporta o DIRETORIO e nao os arquivos dentro; a copia e recursiva justamente por isso");
});

test("shouldListEachFileWhenTheDirectoryIsAlreadyTracked", () => {
  const repo = repoTemporario();
  mkdirSync(path.join(repo, "scripts"));
  writeFileSync(path.join(repo, "scripts", "velho.mjs"), "1\n");
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "a"], { cwd: repo });
  writeFileSync(path.join(repo, "scripts", "novo.mjs"), "2\n");
  assert.deepEqual(pendentes(repo), ["scripts/novo.mjs"],
    "com o diretorio ja rastreado o caminho vem completo, e e o caso normal deste repositorio");
});

test("shouldSkipAPathThatGitReportsButDoesNotExist", () => {
  const repo = repoTemporario();
  writeFileSync(path.join(repo, "a.js"), "1\n");
  execFileSync("git", ["add", "a.js"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "a"], { cwd: repo });
  execFileSync("git", ["rm", "-q", "a.js"], { cwd: repo });
  assert.deepEqual(pendentes(repo), [],
    "git reporta o apagado, e copiar um caminho que nao existe derrubaria a montagem da arvore");
});

test("shouldReportNothingPendingOnACleanRepository", () => {
  const repo = repoTemporario();
  writeFileSync(path.join(repo, "a.js"), "1\n");
  execFileSync("git", ["add", "a.js"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "a"], { cwd: repo });
  assert.deepEqual(pendentes(repo), [],
    "o caso negativo: sem pendencia a arvore limpa e o HEAD puro");
});
