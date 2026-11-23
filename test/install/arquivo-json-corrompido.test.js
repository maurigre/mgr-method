import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { tempDir } from "../../scripts/lib/tmp.mjs";
import { CONFIG_NAME, readConfig } from "../../src/plugins/registry.js";
import { hookFilePath, writeHook } from "../../src/install/hooks.js";
import { manifestFromFiles } from "../../src/install/plugin-installer.js";
import { MANIFEST_NAME } from "../../src/plugin.js";
import { UsageError, renderError } from "../../src/core/errors.js";
import { getMessages } from "../../src/core/messages.js";
import { LOCKFILE_NAME, readLockfile } from "../../src/install/lockfile.js";

const TEXTO_DO_PARSER = /Unexpected|Expected|JSON at position|SyntaxError/;

function exigirErroDeArquivo(executar, chave, parametros) {
  let capturado;
  assert.throws(executar, (erro) => {
    capturado = erro;
    return erro instanceof UsageError;
  });
  assert.equal(capturado.key, chave);
  assert.deepEqual(capturado.params, parametros);
  assert.ok(capturado.cause instanceof SyntaxError, "the parser error stays as the cause");
  for (const idioma of ["en", "pt-BR"]) {
    const tabela = getMessages(idioma);
    const mostrado = renderError(tabela, capturado);
    assert.equal(mostrado, tabela[chave](...parametros));
    assert.doesNotMatch(mostrado, TEXTO_DO_PARSER);
  }
}

test("should refuse a corrupt config.json as a usage error naming the file", () => {
  const coreDir = tempDir("mgr-json-corrompido-");
  const arquivo = path.join(coreDir, CONFIG_NAME);
  writeFileSync(arquivo, "{ not json", "utf8");
  exigirErroDeArquivo(() => readConfig(coreDir), "fileNotJson", [arquivo]);
});

test("should refuse a corrupt engine settings file as a usage error naming the file", () => {
  const repo = tempDir("mgr-json-corrompido-");
  const arquivo = hookFilePath("claude-code", repo);
  mkdirSync(path.dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, "{ not json", "utf8");
  exigirErroDeArquivo(() => writeHook("claude-code", repo, { command: "node runtime.js" }), "fileNotJson", [arquivo]);
});

test("should refuse a downloaded plugin manifest that is not JSON as a usage error naming the package", () => {
  const files = [{ path: MANIFEST_NAME, content: Buffer.from("{ not json", "utf8") }];
  const entry = { name: "@mgr/exemplo", version: "1.0.0" };
  exigirErroDeArquivo(() => manifestFromFiles(files, entry), "skillPackageManifestNotJson", [MANIFEST_NAME, "@mgr/exemplo"]);
});

function exigirErroDeRaiz(executar, parametros) {
  let capturado;
  assert.throws(executar, (erro) => {
    capturado = erro;
    return erro instanceof UsageError;
  });
  assert.equal(capturado.key, "fileNotObject");
  assert.deepEqual(capturado.params, parametros);
  for (const idioma of ["en", "pt-BR"]) {
    const tabela = getMessages(idioma);
    assert.equal(renderError(tabela, capturado), tabela.fileNotObject(...parametros));
  }
}

for (const raiz of ["null", "[]", "\"x\"", "7"]) {
  test(`should refuse a config.json whose JSON root is ${raiz} as a usage error, never as an MGR defect`, () => {
    const coreDir = tempDir("mgr-json-raiz-");
    const arquivo = path.join(coreDir, CONFIG_NAME);
    writeFileSync(arquivo, raiz, "utf8");
    exigirErroDeRaiz(() => readConfig(coreDir), [arquivo]);
  });

  test(`should refuse engine settings whose JSON root is ${raiz} as a usage error, never as an MGR defect`, () => {
    const repo = tempDir("mgr-json-raiz-");
    const arquivo = hookFilePath("claude-code", repo);
    mkdirSync(path.dirname(arquivo), { recursive: true });
    writeFileSync(arquivo, raiz, "utf8");
    exigirErroDeRaiz(() => writeHook("claude-code", repo, { command: "node runtime.js" }), [arquivo]);
  });

  test(`should refuse a lockfile whose JSON root is ${raiz} as a usage error, never as an MGR defect`, () => {
    const repo = tempDir("mgr-json-raiz-");
    writeFileSync(path.join(repo, LOCKFILE_NAME), raiz, "utf8");
    exigirErroDeRaiz(() => readLockfile(repo), [LOCKFILE_NAME]);
  });
}
