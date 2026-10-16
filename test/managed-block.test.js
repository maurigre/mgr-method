import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { blockState, locateBlock, removeBlock, writeBlock } from "../src/managed-block.js";

const BLOCO = ["<!-- >>> mgr-method (managed block: mgr uninstall removes it) >>> -->", "linha um", "linha dois", "<!-- <<< mgr-method <<< -->"];
const ABERTURA = BLOCO[0];
const MSG_SEM_FECHO = (file) => `bloco do mgr-method sem linha de fecho em ${file}; corrija o arquivo à mão`;

const diretorioTemporario = () => mkdtempSync(path.join(os.tmpdir(), "mgr-managed-block-"));

const comArquivo = (conteudo) => {
  const dir = diretorioTemporario();
  const file = path.join(dir, "arquivo.md");
  writeFileSync(file, conteudo, "utf8");
  return { dir, file };
};

const ler = (file) => readFileSync(file, "utf8");

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

test("should report no-file when the file does not exist", () => {
  const dir = diretorioTemporario();
  try {
    assert.equal(blockState(path.join(dir, "ausente.md"), BLOCO), "no-file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should report absent when the file has no markers", () => {
  const { dir, file } = comArquivo("texto solto\n");
  try {
    assert.equal(blockState(file, BLOCO), "absent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should report current when the block is exactly as expected", () => {
  const { dir, file } = comArquivo(`antes\n${BLOCO.join("\n")}\ndepois\n`);
  try {
    assert.equal(blockState(file, BLOCO), "current");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should report outdated when the markers stay and the inner line differs", () => {
  const { dir, file } = comArquivo(`antes\n${[ABERTURA, "linha velha", BLOCO[3]].join("\n")}\n`);
  try {
    assert.equal(blockState(file, BLOCO), "outdated");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should report current when the block lines use CRLF", () => {
  const { dir, file } = comArquivo(`antes\r\n${BLOCO.join("\r\n")}\r\ndepois\r\n`);
  try {
    assert.equal(blockState(file, BLOCO), "current");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should report absent when the opening marker is only inside another line", () => {
  const { dir, file } = comArquivo(`texto antes ${ABERTURA}\nlinha um\nlinha dois\n${BLOCO[3]}\n`);
  try {
    assert.equal(blockState(file, BLOCO), "absent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should replace an outdated block in place keeping the text around it byte for byte", () => {
  const antes = "antes\r\n  # comentário\n";
  const depois = "\ndepois sem quebra";
  const { dir, file } = comArquivo(`${antes}${[ABERTURA, "linha velha", BLOCO[3]].join("\n")}${depois}`);
  try {
    writeBlock(file, BLOCO);

    const apos = ler(file);
    assert.ok(apos.startsWith(antes), "o texto antes do bloco ficou byte a byte");
    assert.ok(apos.endsWith(depois), "o texto depois do bloco ficou byte a byte");
    assert.equal(apos.split(ABERTURA).length - 1, 1, "a marca de abertura aparece uma vez");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should append the block after the original bytes when the file has no final newline", () => {
  const original = "node_modules/";
  const { dir, file } = comArquivo(original);
  try {
    writeBlock(file, BLOCO);

    assert.equal(ler(file), `${original}\n${BLOCO.join("\n")}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should not rewrite a file whose block is already current", () => {
  const dir = diretorioTemporario();
  const file = path.join(dir, "arquivo.md");
  try {
    writeBlock(file, BLOCO);
    const hashAntes = sha256(file);
    const mtimeAntes = statSync(file).mtimeMs;

    const retorno = writeBlock(file, BLOCO);

    assert.equal(retorno, file);
    assert.equal(sha256(file), hashAntes, "os bytes não mudaram");
    assert.equal(statSync(file).mtimeMs, mtimeAntes, "o arquivo não foi reescrito");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should create the missing parent directory when writing the block", () => {
  const dir = diretorioTemporario();
  const file = path.join(dir, ".github", "x.md");
  try {
    writeBlock(file, BLOCO);

    assert.equal(ler(file), `${BLOCO.join("\n")}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should throw with the literal message when the opening marker has no closing line", () => {
  const { dir, file } = comArquivo(`antes\n${ABERTURA}\nlinha solta\n`);
  try {
    assert.throws(() => locateBlock(ler(file).split("\n"), BLOCO, file), { message: MSG_SEM_FECHO(file) });
    assert.throws(() => blockState(file, BLOCO), { message: MSG_SEM_FECHO(file) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should delete the file when the block was the only content", () => {
  const { dir, file } = comArquivo(`${BLOCO.join("\n")}\n`);
  try {
    assert.deepEqual(removeBlock(file, BLOCO), { outcome: "removed", file });
    assert.equal(existsSync(file), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should keep the rest of the file byte for byte when removing the block", () => {
  const { dir, file } = comArquivo(`antes\r\n${BLOCO.join("\n")}\ndepois\n`);
  try {
    assert.deepEqual(removeBlock(file, BLOCO), { outcome: "removed", file });
    assert.equal(ler(file), "antes\r\ndepois\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should report absent when removing a block from a file without markers", () => {
  const { dir, file } = comArquivo("antes\n");
  try {
    assert.deepEqual(removeBlock(file, BLOCO), { outcome: "absent", file });
    assert.equal(ler(file), "antes\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should report no-file when removing a block from a missing file", () => {
  const dir = diretorioTemporario();
  const file = path.join(dir, "ausente.md");
  try {
    assert.deepEqual(removeBlock(file, BLOCO), { outcome: "no-file", file });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should return found false without markers instead of null", () => {
  assert.deepEqual(locateBlock(["antes", "depois"], BLOCO, "x"), { found: false });
});
