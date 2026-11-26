import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReviewIo } from "../../bin/review-io.js";
import { tempDir } from "../../scripts/lib/tmp.mjs";
import { criarCodexFalso, pathSemCodex, VERSAO_FALSA } from "../helpers/codex-falso.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const relativo = (caminho) => path.relative(RAIZ, caminho).split(path.sep).join("/");

function testesDe(diretorio) {
  return readdirSync(diretorio, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) return testesDe(caminho);
    return entrada.name.endsWith(".test.js") ? [caminho] : [];
  });
}

test("should leave no directory of the test PATH containing a codex file", () => {
  const pastasComCodex = pathSemCodex()
    .split(path.delimiter)
    .filter((pasta) => pasta !== "" && existsSync(path.join(pasta, "codex")));
  assert.deepEqual(pastasComCodex, [], `o PATH de teste ainda tem um codex real em: ${pastasComCodex.join(", ")}`);
});

test("should answer the fake codex version when run through the test environment", () => {
  const resultado = createReviewIo({ env: criarCodexFalso("ok").env })
    .run("codex", ["--version"], { cwd: tempDir("sem-codex-real-") });
  assert.equal(resultado.stdout?.trim(), VERSAO_FALSA, `codex --version no ambiente de teste nao devolveu a marca do falso (outcome: ${resultado.outcome})`);
});

test("should import codex-falso.js in every test file that runs the external review", () => {
  const semFalso = testesDe(path.join(RAIZ, "test"))
    .filter((arquivo) => {
      const conteudo = readFileSync(arquivo, "utf8");
      const rodaRevisao = conteudo.includes("review-io.js") || /"review",\s*"external"/.test(conteudo);
      return rodaRevisao && !conteudo.includes("codex-falso.js");
    })
    .map(relativo);
  assert.deepEqual(semFalso, [], `arquivos que rodam a revisao externa sem o codex falso: ${semFalso.join(", ")}`);
});
