import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CHILD_PROCESS = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](?:node:)?child_process["']/;

function arquivosJsDe(diretorio) {
  return readdirSync(diretorio, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) return arquivosJsDe(caminho);
    return entrada.name.endsWith(".js") ? [path.relative(RAIZ, caminho).split(path.sep).join("/")] : [];
  });
}

test("should keep child_process out of every module of src (the spawn border lives in bin/)", () => {
  const ofensores = arquivosJsDe(path.join(RAIZ, "src"))
    .filter((rel) => CHILD_PROCESS.test(readFileSync(path.join(RAIZ, rel), "utf8")));
  assert.deepEqual(ofensores, [], `child_process importado em arquivos de src/: ${ofensores.join(", ")}`);
});
