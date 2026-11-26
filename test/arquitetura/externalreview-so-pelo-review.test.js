import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LITERAL_EXTERNAL_REVIEW = /\bexternalReview\b(?!Consent)/;
const MODULOS_COM_LITERAL = new Set([
  "src/plugins/registry.js",
  "src/commands/review.js",
  "src/sdd/external-review.js",
  "src/sdd/archive.js",
]);
const DONO_DAS_ESCRITAS = "src/commands/review.js";
const REGISTRO_DE_CONFIG = "src/plugins/registry.js";
const FUNCOES_DE_ESCRITA = ["writeExternalReview", "writeReviewerOptions", "writeReviewConsent", "removeReviewConsent"];

function arquivosDe(diretorio) {
  return readdirSync(diretorio, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) return arquivosDe(caminho);
    return /\.[cm]?js$/.test(entrada.name) ? [caminho] : [];
  });
}

const relativo = (caminho) => path.relative(RAIZ, caminho).split(path.sep).join("/");

function arquivosDeFonte() {
  return [...arquivosDe(path.join(RAIZ, "src")), ...arquivosDe(path.join(RAIZ, "bin"))];
}

function usosForaDoDono(nome) {
  return arquivosDeFonte().flatMap((arquivo) => {
    const rel = relativo(arquivo);
    return readFileSync(arquivo, "utf8").split("\n").flatMap((linha, indice) => {
      if (!linha.includes(`${nome}(`)) return [];
      const permitido = rel === DONO_DAS_ESCRITAS || (rel === REGISTRO_DE_CONFIG && linha.includes("export function "));
      return permitido ? [] : [`${rel}:${indice + 1}`];
    });
  });
}

test("should keep the externalReview literal only in the modules allowed to read or write the review config", () => {
  const ofensores = arquivosDe(path.join(RAIZ, "src"))
    .map(relativo)
    .filter((rel) => !MODULOS_COM_LITERAL.has(rel) && LITERAL_EXTERNAL_REVIEW.test(readFileSync(path.join(RAIZ, rel), "utf8")));
  assert.deepEqual(ofensores, [], `literal externalReview fora dos módulos permitidos em src/: ${ofensores.join(", ")}`);
});

for (const nome of FUNCOES_DE_ESCRITA) {
  test(`should call ${nome} only from the review command and define it only in the registry`, () => {
    const ofensores = usosForaDoDono(nome);
    assert.deepEqual(ofensores, [], `${nome} usado fora de ${DONO_DAS_ESCRITAS} ou da definição em ${REGISTRO_DE_CONFIG}: ${ofensores.join(", ")}`);
  });
}
