import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV = { ...process.env, LC_ALL: "C" };
const COPIED_DIRS = ["bin", "src", "scripts", "skills", "shared", "agents"];
const BUNDLE_URL = pathToFileURL(path.join(ROOT, "src", "bundle.js")).href;

const runNode = (cwd, args) => spawnSync(process.execPath, args, { cwd, encoding: "utf8", env: ENV });
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function copyRepo(destino) {
  for (const dir of COPIED_DIRS) cpSync(path.join(ROOT, dir), path.join(destino, dir), { recursive: true });
  cpSync(path.join(ROOT, "package.json"), path.join(destino, "package.json"));
  symlinkSync(path.join(ROOT, "node_modules"), path.join(destino, "node_modules"), "dir");
}

function instalarProjeto(destino) {
  const instalacao = runNode(ROOT, [path.join(ROOT, "bin", "mgr.js"), "install", destino, "-y", "--engine", "claude-code"]);
  assert.equal(instalacao.status, 0, instalacao.stderr);
}

function lerBuildVersion(preambulo) {
  const script = `${preambulo}\nconst modulo = await import(${JSON.stringify(BUNDLE_URL)});\nprocess.stdout.write(JSON.stringify(modulo.buildVersion()));`;
  const resultado = runNode(ROOT, ["--input-type=module", "-e", script]);
  assert.equal(resultado.status, 0, resultado.stderr);
  return JSON.parse(resultado.stdout);
}

test("should print the package version from a dist built into a copy of the repo", () => {
  const copia = mkdtempSync(path.join(os.tmpdir(), "mgr-build-"));
  try {
    copyRepo(copia);
    const build = runNode(copia, ["scripts/build.mjs"]);
    assert.equal(build.status, 0, build.stderr);
    const pacote = path.join(copia, "package.json");
    const versao = readJson(pacote).version;
    const resultado = runNode(copia, ["bin/mgr.cjs", "--version"]);
    assert.equal(resultado.status, 0, resultado.stderr);
    assert.equal(resultado.stdout.trim(), `mgr-method ${versao}`);
  } finally {
    rmSync(copia, { recursive: true, force: true });
  }
});

test("should refuse --version with exit 1 and both versions when package.json changed without rebuild", () => {
  const copia = mkdtempSync(path.join(os.tmpdir(), "mgr-build-"));
  try {
    copyRepo(copia);
    const build = runNode(copia, ["scripts/build.mjs"]);
    assert.equal(build.status, 0, build.stderr);
    const pacote = path.join(copia, "package.json");
    const versaoBuild = readJson(pacote).version;
    const versaoPacote = `${versaoBuild}-defasado`;
    writeJson(pacote, { ...readJson(pacote), version: versaoPacote });
    const resultado = runNode(copia, ["bin/mgr.cjs", "--version"]);
    assert.equal(resultado.status, 1);
    assert.match(resultado.stderr, new RegExp(`gerado para ${versaoBuild} e o pacote está em ${versaoPacote}: rode npm run build`));
    assert.equal(resultado.stdout, "");
  } finally {
    rmSync(copia, { recursive: true, force: true });
  }
});

test("should print the runtime version without a warning when the manifest matches", () => {
  const projeto = mkdtempSync(path.join(os.tmpdir(), "mgr-runtime-"));
  try {
    instalarProjeto(projeto);
    const runtime = path.join(projeto, ".claude", "skills", "_shared", "mgr", "bin", "mgr-runtime.js");
    const versao = readJson(path.join(projeto, ".mgr-core", "manifest.json")).version;
    const resultado = runNode(projeto, [runtime, "--version"]);
    assert.equal(resultado.status, 0, resultado.stderr);
    assert.equal(resultado.stdout.trim(), `mgr-method ${versao} (runtime do projeto)`);
    assert.equal(resultado.stderr, "");
  } finally {
    rmSync(projeto, { recursive: true, force: true });
  }
});

test("should warn on stderr with both versions and exit 0 when the manifest version differs", () => {
  const projeto = mkdtempSync(path.join(os.tmpdir(), "mgr-runtime-"));
  try {
    instalarProjeto(projeto);
    const runtime = path.join(projeto, ".claude", "skills", "_shared", "mgr", "bin", "mgr-runtime.js");
    const manifesto = path.join(projeto, ".mgr-core", "manifest.json");
    const versaoRuntime = readJson(manifesto).version;
    const versaoManifesto = `${versaoRuntime}-divergente`;
    writeJson(manifesto, { ...readJson(manifesto), version: versaoManifesto });
    const resultado = runNode(projeto, [runtime, "--version"]);
    assert.equal(resultado.status, 0, resultado.stderr);
    assert.match(resultado.stdout, /\(runtime do projeto\)/);
    assert.match(resultado.stderr, new RegExp(`runtime em ${versaoRuntime}, manifesto em ${versaoManifesto}: rode npx mgr-method@${versaoManifesto} update`));
  } finally {
    rmSync(projeto, { recursive: true, force: true });
  }
});

test("should return the embedded build version when the global constant is defined", () => {
  assert.equal(lerBuildVersion("globalThis.__MGR_BUILD_VERSION__ = '9.8.7';"), "9.8.7");
});

test("should return null from buildVersion when running from source without the constant", () => {
  assert.equal(lerBuildVersion(""), null);
});
