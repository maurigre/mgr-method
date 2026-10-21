import { describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const root = fileURLToPath(new URL("..", import.meta.url));
const eslint = new ESLint({ cwd: root });
const MENSAGEM =
  "temporario so por tempDir(prefixo) de scripts/lib/tmp.mjs (tmp-organizado): ele limpa ao fim do processo";

const FORMA_PROPRIEDADE = 'import os from "node:os"; os.tmpdir();';
const FORMA_COMPUTADA = 'import fs from "node:fs"; fs["mkdtempSync"]("x");';
const FORMA_IMPORT_NOMEADO = 'import { mkdtempSync as m } from "node:fs"; m("x");';
const FORMA_DESESTRUTURACAO = 'import fs from "node:fs"; const { mkdtempSync } = fs;';

async function restricoesDe(codigo, arquivoVirtual) {
  const [resultado] = await eslint.lintText(codigo, {
    filePath: path.join(root, arquivoVirtual),
  });
  return resultado.messages.filter((mensagem) => mensagem.ruleId === "no-restricted-syntax");
}

describe("regra no-restricted-syntax do tmp-organizado", () => {
  const formas = [
    ["acesso por propriedade", FORMA_PROPRIEDADE],
    ["acesso computado com literal", FORMA_COMPUTADA],
    ["import nomeado com alias", FORMA_IMPORT_NOMEADO],
    ["desestruturacao", FORMA_DESESTRUTURACAO],
  ];

  for (const [nome, codigo] of formas) {
    test(`should reprove ${nome} under test/ with the rule message`, async () => {
      const hits = await restricoesDe(codigo, "test/x.test.js");
      assert.ok(hits.length > 0);
      assert.deepEqual(new Set(hits.map((hit) => hit.message)), new Set([MENSAGEM]));
    });

    test(`should reprove ${nome} under scripts/ with the rule message`, async () => {
      const hits = await restricoesDe(codigo, "scripts/x.mjs");
      assert.ok(hits.length > 0);
      assert.deepEqual(new Set(hits.map((hit) => hit.message)), new Set([MENSAGEM]));
    });
  }

  test("should not reprove the same tmpdir form inside scripts/lib/tmp.mjs", async () => {
    const hits = await restricoesDe(FORMA_PROPRIEDADE, "scripts/lib/tmp.mjs");
    assert.equal(hits.length, 0);
  });

  test("should still reprove tmpdir form preceded by an eslint-disable-next-line comment", async () => {
    const codigo = `// eslint-disable-next-line no-restricted-syntax\n${FORMA_PROPRIEDADE}`;
    const hits = await restricoesDe(codigo, "test/x.test.js");
    assert.ok(hits.length > 0);
    assert.deepEqual(new Set(hits.map((hit) => hit.message)), new Set([MENSAGEM]));
  });
});
