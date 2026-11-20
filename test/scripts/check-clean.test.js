import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pendentes, removidos, ambienteDoCi } from "../../scripts/check-clean.mjs";
import { tempDir } from "../../scripts/lib/tmp.mjs";

const repoTemporario = () => {
  const repo = tempDir("mgr-pend-");
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

test("shouldListAFileDeletedFromTheWorktreeAsRemoved", () => {
  const repo = repoTemporario();
  writeFileSync(path.join(repo, "a.js"), "1\n");
  execFileSync("git", ["add", "a.js"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "a"], { cwd: repo });
  rmSync(path.join(repo, "a.js"));
  assert.deepEqual(removidos(repo), ["a.js"],
    "apagado so na arvore (status ' D') tem de sair da arvore limpa, senao ela fica com o arquivo apagado");
  assert.deepEqual(pendentes(repo), [],
    "o apagado nao pode cair na lista de copia: ele nao existe no worktree");
});

test("shouldListAFileDeletedFromTheIndexAsRemoved", () => {
  const repo = repoTemporario();
  writeFileSync(path.join(repo, "a.js"), "1\n");
  execFileSync("git", ["add", "a.js"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "a"], { cwd: repo });
  execFileSync("git", ["rm", "-q", "a.js"], { cwd: repo });
  assert.deepEqual(removidos(repo), ["a.js"],
    "apagado no indice (status 'D ') tambem e remocao; o caso e o de git rm");
  assert.deepEqual(pendentes(repo), [],
    "o caminho removido no indice nao pode ser copiado");
});

test("shouldNotListAModifiedFileAsRemoved", () => {
  const repo = repoTemporario();
  writeFileSync(path.join(repo, "a.js"), "1\n");
  execFileSync("git", ["add", "a.js"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "a"], { cwd: repo });
  writeFileSync(path.join(repo, "a.js"), "2\n");
  assert.deepEqual(removidos(repo), [],
    "arquivo modificado existe e vai por pendentes(); marcar como removido o apagaria da copia");
  assert.deepEqual(pendentes(repo), ["a.js"],
    "o modificado continua sendo copiado");
});

test("shouldNotListAnUntrackedFileAsRemoved", () => {
  const repo = repoTemporario();
  writeFileSync(path.join(repo, "novo.js"), "1\n");
  assert.deepEqual(removidos(repo), [],
    "arquivo nunca commitado nao foi apagado; ele so precisa de copia");
});

test("shouldReportNothingRemovedOnACleanRepository", () => {
  const repo = repoTemporario();
  writeFileSync(path.join(repo, "a.js"), "1\n");
  execFileSync("git", ["add", "a.js"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "a"], { cwd: repo });
  assert.deepEqual(removidos(repo), [],
    "o caso negativo: sem alteracao nao ha remocao a propagar");
});

test("shouldReproduceTheRunnerEnvironmentWithCiSetAndNoInheritedColorOrLocale", () => {
  const env = ambienteDoCi({ PATH: "/bin", LANG: "pt_BR.UTF-8", LANGUAGE: "pt_BR", NO_COLOR: "1", FORCE_COLOR: "1", LC_ALL: "pt_BR.UTF-8" });
  assert.equal(env.CI, "true");
  assert.equal(env.LC_ALL, "C");
  assert.equal(env.PATH, "/bin");
  for (const chave of ["LANG", "LANGUAGE", "NO_COLOR", "FORCE_COLOR"]) assert.equal(chave in env, false, chave);
});

test("shouldCopyTheNewPathAndRemoveTheOldOneForAFileRenamedWithGitMv", () => {
  const repo = repoTemporario();
  writeFileSync(path.join(repo, "a.js"), "1\n");
  execFileSync("git", ["add", "a.js"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "a"], { cwd: repo });
  mkdirSync(path.join(repo, "pasta"));
  execFileSync("git", ["mv", "a.js", "pasta/a.js"], { cwd: repo });
  assert.deepEqual(pendentes(repo), ["pasta/a.js"]);
  assert.deepEqual(removidos(repo), ["a.js"]);
});

test("shouldCopyTheNewPathOfARenamedFileThatWasAlsoModified", () => {
  const repo = repoTemporario();
  writeFileSync(path.join(repo, "a.js"), "1\n");
  execFileSync("git", ["add", "a.js"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "a"], { cwd: repo });
  execFileSync("git", ["mv", "a.js", "b.js"], { cwd: repo });
  writeFileSync(path.join(repo, "b.js"), "2\n");
  assert.deepEqual(pendentes(repo), ["b.js"]);
  assert.deepEqual(removidos(repo), ["a.js"]);
});

test("shouldRemoveBothPathsOfARenamedFileThatWasDeletedFromTheTree", () => {
  const repo = repoTemporario();
  writeFileSync(path.join(repo, "a.js"), "1\n");
  execFileSync("git", ["add", "a.js"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "a"], { cwd: repo });
  execFileSync("git", ["mv", "a.js", "b.js"], { cwd: repo });
  rmSync(path.join(repo, "b.js"));
  assert.deepEqual(pendentes(repo), []);
  assert.deepEqual(removidos(repo).sort(), ["a.js", "b.js"]);
});

test("shouldCopyTheNewPathAndKeepTheOriginalForAFileCopiedInTheIndex", () => {
  const repo = repoTemporario();
  writeFileSync(path.join(repo, "a.js"), "export const conteudoLongoParaADeteccaoDeCopia = 1;\n".repeat(20));
  execFileSync("git", ["add", "a.js"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "a"], { cwd: repo });
  execFileSync("git", ["config", "status.renames", "copies"], { cwd: repo });
  execFileSync("git", ["config", "diff.renames", "copies"], { cwd: repo });
  writeFileSync(path.join(repo, "a.js"), "export const conteudoLongoParaADeteccaoDeCopia = 1;\n".repeat(20) + "2\n");
  writeFileSync(path.join(repo, "b.js"), "export const conteudoLongoParaADeteccaoDeCopia = 1;\n".repeat(20));
  execFileSync("git", ["add", "a.js", "b.js"], { cwd: repo });
  assert.match(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }), /^C {2}a\.js -> b\.js$/m);
  assert.deepEqual(pendentes(repo).sort(), ["a.js", "b.js"]);
  assert.deepEqual(removidos(repo), []);
});
