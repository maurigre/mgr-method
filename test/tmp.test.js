import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isAlive, tempDir } from "../scripts/lib/tmp.mjs";
import { pidMorto } from "./helpers/pid-morto.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODULO = pathToFileURL(path.join(RAIZ, "scripts", "lib", "tmp.mjs")).href;
const testeQueFalha = () => {
  const arquivo = path.join(tempDir("mgr-tmp-fixture-"), "teste-que-falha.test.mjs");
  writeFileSync(arquivo, [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    'import { mkdirSync, writeFileSync } from "node:fs";',
    'import path from "node:path";',
    `import { tempDir } from ${JSON.stringify(MODULO)};`,
    'test("should fail after writing into temp dir", () => {',
    '  const dir = tempDir("mgr-falha-");',
    '  mkdirSync(path.join(dir, "sub"));',
    '  writeFileSync(path.join(dir, "sub", "arquivo.txt"), "conteudo");',
    '  assert.equal(1, 2);',
    '});',
  ].join("\n"));
  return arquivo;
};

const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const linhaDeAviso = (caminho) => new RegExp(`^tmp: AVISO: ${escapar(caminho)} ficou em disco \\(.+\\); o check-tmp vai acusa-lo$`);
const ehRoot = typeof process.getuid === "function" && process.getuid() === 0;
const SEM_ROOT = { skip: ehRoot ? "rodando como root: a permissao nao bloqueia, e o ramo nao e exercitado" : false };

const novaSandbox = () => tempDir("mgr-tmp-test-");
const baseDe = (sandbox) => path.join(sandbox, "mgr-method");

function ambiente(sandbox, extra = {}) {
  const env = { ...process.env };
  delete env.MGR_KEEP_TMP;
  delete env.NODE_TEST_CONTEXT;
  return { ...env, TMPDIR: sandbox, ...extra };
}

function filho(sandbox, codigo, extra = {}) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", codigo], {
    env: ambiente(sandbox, extra),
    encoding: "utf8",
  });
}

function comImport(codigo) {
  return `import { tempDir } from ${JSON.stringify(MODULO)};\n${codigo}`;
}

function primeiraLinha(stream) {
  return new Promise((resolve, reject) => {
    let acumulado = "";
    stream.setEncoding("utf8");
    stream.on("data", (pedaco) => {
      acumulado += pedaco;
      const fimDaLinha = acumulado.indexOf("\n");
      if (fimDaLinha !== -1) resolve(acumulado.slice(0, fimDaLinha));
    });
    stream.on("error", reject);
  });
}

function mensagemPrefixo(prefixo) {
  return `tempDir: prefixo invalido ${JSON.stringify(prefixo)}; use so letras, digitos, '.', '_' e '-'`;
}

function prefixoNoFilho(prefixo) {
  const sandbox = novaSandbox();
  const resultado = filho(sandbox, comImport(`
try { tempDir(${JSON.stringify(prefixo)}); console.log("ok"); } catch (erro) { console.log(erro.message); }
`));
  assert.equal(resultado.status, 0, resultado.stderr);
  return resultado.stdout.trim();
}

test("should create nothing when only importing the module", () => {
  const sandbox = novaSandbox();
  const resultado = filho(sandbox, `import ${JSON.stringify(MODULO)};`);
  assert.equal(resultado.status, 0, resultado.stderr);
  assert.equal(existsSync(baseDe(sandbox)), false);
});

test("should create a process folder under base with pid and prefixed path", () => {
  const sandbox = novaSandbox();
  const resultado = filho(sandbox, comImport(`
import { existsSync } from "node:fs";
const caminho = tempDir("mgr-p-");
console.log(JSON.stringify({ caminho, pid: process.pid, existe: existsSync(caminho) }));
`));
  assert.equal(resultado.status, 0, resultado.stderr);
  const { caminho, pid, existe } = JSON.parse(resultado.stdout);
  assert.equal(existe, true);
  assert.equal(path.isAbsolute(caminho), true);
  assert.equal(path.dirname(path.dirname(caminho)), baseDe(sandbox));
  assert.match(path.basename(path.dirname(caminho)), new RegExp(`^${pid}-[A-Za-z0-9]{6}$`));
  assert.match(path.basename(caminho), /^mgr-p-/);
});

test("should remove every temp dir and its files at exit", () => {
  const sandbox = novaSandbox();
  const resultado = filho(sandbox, comImport(`
import { writeFileSync } from "node:fs";
import path from "node:path";
const pastaA = tempDir("mgr-a-");
const pastaB = tempDir("mgr-b-");
writeFileSync(path.join(pastaA, "x.txt"), "1");
writeFileSync(path.join(pastaB, "y.txt"), "2");
console.log(JSON.stringify({ paiA: path.dirname(pastaA), paiB: path.dirname(pastaB) }));
`));
  assert.equal(resultado.status, 0, resultado.stderr);
  const { paiA, paiB } = JSON.parse(resultado.stdout);
  assert.equal(paiA, paiB);
  assert.equal(resultado.stderr, "");
  assert.deepEqual(readdirSync(baseDe(sandbox)), []);
});

test("should remove the process folder when the child throws uncaught", () => {
  const sandbox = novaSandbox();
  const resultado = filho(sandbox, comImport(`
import { writeFileSync } from "node:fs";
import path from "node:path";
const dir = tempDir("mgr-erro-");
writeFileSync(path.join(dir, "x.txt"), "1");
throw new Error("erro de teste");
`));
  assert.notEqual(resultado.status, 0);
  assert.match(resultado.stderr, /erro de teste/);
  assert.deepEqual(readdirSync(baseDe(sandbox)), []);
});

test("should leave no entry when a failing test file exits non zero", () => {
  const sandbox = novaSandbox();
  const resultado = spawnSync(process.execPath, ["--test", testeQueFalha()], {
    env: ambiente(sandbox),
    encoding: "utf8",
  });
  assert.notEqual(resultado.status, 0);
  assert.deepEqual(readdirSync(baseDe(sandbox)), []);
});

test("should keep the folder with marker and print the keep line once when keep is one", () => {
  const sandbox = novaSandbox();
  const resultado = filho(sandbox, comImport(`
import path from "node:path";
const caminho = tempDir("mgr-keep-");
console.log(path.dirname(caminho));
`), { MGR_KEEP_TMP: "1" });
  assert.equal(resultado.status, 0, resultado.stderr);
  const pasta = resultado.stdout.trim();
  assert.equal(existsSync(path.join(pasta, ".mgr-keep")), true);
  const linha = `MGR_KEEP_TMP=1: temporarios deste processo preservados em ${pasta}`;
  assert.equal(resultado.stderr, linha + "\n");
});

test("should delete the folder when keep is true", () => {
  const sandbox = novaSandbox();
  const resultado = filho(sandbox, comImport(`
import path from "node:path";
const caminho = tempDir("mgr-keep-");
console.log(path.dirname(caminho));
`), { MGR_KEEP_TMP: "true" });
  assert.equal(resultado.status, 0, resultado.stderr);
  const pasta = resultado.stdout.trim();
  assert.equal(existsSync(pasta), false);
  assert.equal(resultado.stderr.includes("MGR_KEEP_TMP=1:"), false);
});

test("should sweep only the dead unmarked run folder and report it", () => {
  const sandbox = novaSandbox();
  const base = baseDe(sandbox);
  mkdirSync(base);
  const morto = pidMorto();
  const aaaaaa = path.join(base, `${morto}-aaaaaa`);
  const bbbbbb = path.join(base, `${morto}-bbbbbb`);
  const vivo = path.join(base, `${process.pid}-cccccc`);
  const estranha = path.join(base, "xyz");
  for (const dir of [aaaaaa, bbbbbb, vivo, estranha]) mkdirSync(dir);
  writeFileSync(path.join(bbbbbb, ".mgr-keep"), "");
  const resultado = filho(sandbox, comImport(`tempDir("mgr-x-");`));
  assert.equal(resultado.status, 0, resultado.stderr);
  assert.equal(existsSync(aaaaaa), false);
  assert.equal(existsSync(bbbbbb), true);
  assert.equal(existsSync(vivo), true);
  assert.equal(existsSync(estranha), true);
  assert.equal(
    resultado.stderr,
    `tmp: varrendo sobra do processo encerrado ${morto}: ${aaaaaa}\ntmp: sobra varrida: ${aaaaaa}\n`,
  );
});

test("should keep a concurrent process folder until it exits", async () => {
  const sandbox = novaSandbox();
  const base = baseDe(sandbox);
  const processoA = spawn(process.execPath, ["--input-type=module", "-e", comImport(`
const caminho = tempDir("mgr-a-");
console.log(caminho);
process.stdin.resume();
`)], { env: ambiente(sandbox), stdio: ["pipe", "pipe", "pipe"] });
  const fim = new Promise((resolve, reject) => {
    processoA.on("error", reject);
    processoA.on("exit", (code) => resolve(code));
  });
  try {
    const caminhoA = (await primeiraLinha(processoA.stdout)).trim();
    const resultado = filho(sandbox, comImport(`tempDir("mgr-b-");`));
    assert.equal(resultado.status, 0, resultado.stderr);
    assert.equal(existsSync(caminhoA), true);
  } finally {
    processoA.stdin.end();
  }
  assert.equal(await fim, 0);
  assert.deepEqual(readdirSync(base), []);
});

test("should refuse a base that is a symbolic link with the literal message", () => {
  const sandbox = novaSandbox();
  const alvo = path.join(sandbox, "alvo");
  mkdirSync(alvo);
  symlinkSync(alvo, baseDe(sandbox), "dir");
  const resultado = filho(sandbox, comImport(`tempDir("x-");`));
  assert.notEqual(resultado.status, 0);
  assert.equal(
    resultado.stderr.includes(`base temporaria insegura: ${baseDe(sandbox)} e link simbolico; aponte TMPDIR para um diretorio so seu`),
    true,
  );
  assert.deepEqual(readdirSync(alvo), []);
});

test("should reject a prefix with slash with the literal message", () => {
  assert.equal(prefixoNoFilho("a/b"), mensagemPrefixo("a/b"));
});

test("should reject a dot dot prefix with the literal message", () => {
  assert.equal(prefixoNoFilho(".."), mensagemPrefixo(".."));
});

test("should reject a single dot prefix with the literal message", () => {
  assert.equal(prefixoNoFilho("."), mensagemPrefixo("."));
});

test("should reject a prefix that is not a string with the literal message", () => {
  assert.equal(prefixoNoFilho(42), mensagemPrefixo(42));
});

test("should reject an empty prefix with the literal message", () => {
  assert.equal(prefixoNoFilho(""), mensagemPrefixo(""));
});

test("should accept a labelled prefix with trailing dash", () => {
  assert.equal(prefixoNoFilho("mgr-oraculo-x-"), "ok");
});

test("should treat own pid and a pid of another user as alive and an exited pid as dead", () => {
  assert.equal(isAlive(process.pid), true);
  assert.equal(isAlive(1), true);
  assert.equal(isAlive(pidMorto()), false);
});

test("should warn with the literal notice and keep going when a dead run folder cannot be removed", SEM_ROOT, () => {
  const sandbox = novaSandbox();
  const base = baseDe(sandbox);
  const travada = path.join(base, `${pidMorto()}-aaaaaa`);
  const sub = path.join(travada, "sub");
  mkdirSync(sub, { recursive: true });
  writeFileSync(path.join(sub, "arquivo.txt"), "1");
  chmodSync(sub, 0o500);
  try {
    const resultado = filho(sandbox, comImport(`tempDir("mgr-x-");`));
    assert.equal(resultado.status, 0, resultado.stderr);
    assert.ok(resultado.stderr.split("\n").some((linha) => linhaDeAviso(travada).test(linha)), resultado.stderr);
    assert.equal(existsSync(travada), true);
  } finally {
    chmodSync(sub, 0o700);
  }
});

test("should warn with the literal notice when the base cannot be listed", SEM_ROOT, () => {
  const sandbox = novaSandbox();
  const base = baseDe(sandbox);
  mkdirSync(base, { mode: 0o700 });
  chmodSync(base, 0o300);
  try {
    const resultado = filho(sandbox, comImport(`tempDir("mgr-x-");`));
    assert.equal(resultado.status, 0, resultado.stderr);
    assert.ok(resultado.stderr.split("\n").some((linha) => linhaDeAviso(base).test(linha)), resultado.stderr);
  } finally {
    chmodSync(base, 0o700);
  }
});

test("should warn with the literal notice when the exit cleanup fails", SEM_ROOT, () => {
  const sandbox = novaSandbox();
  const resultado = filho(sandbox, comImport(`
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const sub = path.join(tempDir("mgr-travado-"), "sub");
mkdirSync(sub);
writeFileSync(path.join(sub, "arquivo.txt"), "1");
chmodSync(sub, 0o500);
console.log(JSON.stringify({ pasta: path.dirname(path.dirname(sub)), sub }));
`));
  const { pasta, sub } = JSON.parse(resultado.stdout);
  try {
    assert.equal(resultado.status, 0, resultado.stderr);
    const linhas = resultado.stderr.split("\n");
    assert.ok(linhas.some((linha) => linhaDeAviso(pasta).test(linha)), resultado.stderr);
  } finally {
    chmodSync(sub, 0o700);
  }
});

test("should exit zero when the exit cleanup fails and stderr is already closed", SEM_ROOT, () => {
  const sandbox = novaSandbox();
  const resultado = filho(sandbox, comImport(`
import { chmodSync, closeSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const sub = path.join(tempDir("mgr-sem-stderr-"), "sub");
mkdirSync(sub);
writeFileSync(path.join(sub, "arquivo.txt"), "1");
chmodSync(sub, 0o500);
console.log(sub);
closeSync(2);
`));
  const sub = resultado.stdout.trim();
  try {
    assert.equal(resultado.status, 0);
    assert.equal(existsSync(sub), true);
  } finally {
    chmodSync(sub, 0o700);
  }
});
