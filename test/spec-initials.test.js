import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initials } from "../src/commands/initials.js";
import * as installer from "../src/installer.js";
import { LOCAL_CONFIG_NAME } from "../src/registry.js";
import { getMessages } from "../src/messages.js";
import { descartar, instalacaoLimpa } from "./fixtures/instalacao.js";

const BIN = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
const M = getMessages("en");

const temporario = () => mkdtempSync(path.join(os.tmpdir(), "mgr-initials-"));

const coletor = () => {
  const out = [];
  const err = [];
  const io = { out: (linha) => out.push(linha), err: (linha) => err.push(linha), style: {}, invocation: "mgr", lifecycle: "mgr" };
  return { io, out, err };
};

const arquivoDe = (root) => path.join(installer.coreDir("project", root), LOCAL_CONFIG_NAME);

const escreverConfig = (root, conteudo) => {
  mkdirSync(installer.coreDir("project", root), { recursive: true });
  writeFileSync(arquivoDe(root), JSON.stringify(conteudo));
};

test("should print the three initials states as JSON with exit 0 0 and 1", () => {
  const root = temporario();
  try {
    const ausente = coletor();
    assert.equal(initials({ root, positional: [], flags: { json: true }, io: ausente.io, M }), 0);
    assert.deepEqual(JSON.parse(ausente.out[0]), { schemaVersion: 1, state: "absent" });

    escreverConfig(root, { initials: "mr" });
    const gravado = coletor();
    assert.equal(initials({ root, positional: [], flags: { json: true }, io: gravado.io, M }), 0);
    assert.deepEqual(JSON.parse(gravado.out[0]), { schemaVersion: 1, state: "recorded", initials: "mr" });

    escreverConfig(root, { initials: "M_R" });
    const invalido = coletor();
    assert.equal(initials({ root, positional: [], flags: { json: true }, io: invalido.io, M }), 1);
    assert.deepEqual(JSON.parse(invalido.out[0]), { schemaVersion: 1, state: "invalid", value: "M_R" });
  } finally {
    descartar(root);
  }
});

test("should write initials with set and keep projectId", () => {
  const root = temporario();
  try {
    escreverConfig(root, { projectId: "abc" });
    const { io, out } = coletor();

    assert.equal(initials({ root, positional: ["set", "mr"], flags: {}, io, M }), 0);
    assert.deepEqual(JSON.parse(readFileSync(arquivoDe(root), "utf8")), { projectId: "abc", initials: "mr" });
    assert.equal(out.length, 2);
  } finally {
    descartar(root);
  }
});

test("should refuse invalid initials with exit 1 and leave the file byte for byte", () => {
  const root = temporario();
  try {
    escreverConfig(root, { projectId: "abc" });
    const antes = readFileSync(arquivoDe(root));

    for (const valor of ["AB", "a_b"]) {
      const { io, out, err } = coletor();
      assert.equal(initials({ root, positional: ["set", valor], flags: {}, io, M }), 1);
      assert.equal(err.length, 1);
      assert.equal(out.length, 0);
      assert.deepEqual(readFileSync(arquivoDe(root)), antes);
    }
  } finally {
    descartar(root);
  }
});

test("should exit 1 when set has no value", () => {
  const root = temporario();
  try {
    const { io, err } = coletor();

    assert.equal(initials({ root, positional: ["set"], flags: {}, io, M }), 1);
    assert.equal(err.length, 1);
    assert.ok(err[0].length > 0);
    assert.equal(existsSync(arquivoDe(root)), false);
  } finally {
    descartar(root);
  }
});

test("should keep initials after install", () => {
  const repo = instalacaoLimpa();
  try {
    const { io } = coletor();
    assert.equal(initials({ root: repo, positional: ["set", "mr"], flags: {}, io, M }), 0);

    execFileSync("node", [BIN, "install", "--engine", "claude-code", "--language", "java",
      "--arch", "layered", "--user-language", "pt-BR", "--project-id", "fixture", "-y", repo],
    { encoding: "utf8", cwd: repo });

    assert.equal(JSON.parse(readFileSync(arquivoDe(repo), "utf8")).initials, "mr");
  } finally {
    descartar(repo);
  }
});

test("should print each initials state as text in the right stream", () => {
  const root = temporario();
  try {
    const ausente = coletor();
    assert.equal(initials({ root, positional: [], flags: {}, io: ausente.io, M }), 0);
    assert.deepEqual(ausente.out, [M.initialsNotRecorded()]);

    escreverConfig(root, { initials: "abcd" });
    const gravado = coletor();
    assert.equal(initials({ root, positional: [], flags: {}, io: gravado.io, M }), 0);
    assert.deepEqual(gravado.out, [M.initialsRecorded("abcd")]);

    escreverConfig(root, { initials: ["mr"] });
    const invalido = coletor();
    assert.equal(initials({ root, positional: [], flags: {}, io: invalido.io, M }), 1);
    assert.deepEqual(invalido.out, []);
    assert.deepEqual(invalido.err, [M.initialsInvalid('["mr"]')]);
  } finally {
    descartar(root);
  }
});

test("should print only the JSON line and nothing on stderr", () => {
  const root = temporario();
  try {
    escreverConfig(root, { initials: "mr" });
    const { io, out, err } = coletor();
    initials({ root, positional: [], flags: { json: true }, io, M });
    assert.equal(out.length, 1);
    assert.deepEqual(err, []);
  } finally {
    descartar(root);
  }
});

test("should announce the write before and the result after, with the previous state", () => {
  const root = temporario();
  try {
    escreverConfig(root, { initials: "mr" });
    const { io, out } = coletor();
    const discoNoAnuncio = [];
    const ioQueOlhaODisco = { ...io, out: (linha) => { discoNoAnuncio.push(readFileSync(arquivoDe(root), "utf8")); io.out(linha); } };
    assert.equal(initials({ root, positional: ["set", "abcd"], flags: {}, io: ioQueOlhaODisco, M }), 0);
    assert.deepEqual(out, [M.initialsWriting(arquivoDe(root)), M.initialsWritten("mr", "abcd")]);
    assert.equal(JSON.parse(discoNoAnuncio[0]).initials, "mr");
    assert.equal(JSON.parse(discoNoAnuncio[1]).initials, "abcd");
  } finally {
    descartar(root);
  }
});

test("should refuse an unknown initials verb and write nothing", () => {
  const root = temporario();
  try {
    const { io, err } = coletor();
    assert.equal(initials({ root, positional: ["clear"], flags: {}, io, M }), 1);
    assert.equal(err.length, 1);
    assert.equal(existsSync(arquivoDe(root)), false);
  } finally {
    descartar(root);
  }
});

test("should name the missing value when set has none", () => {
  const root = temporario();
  try {
    const { io, err } = coletor();
    initials({ root, positional: ["set"], flags: {}, io, M });
    assert.ok(err[0].includes(M.initialsSetNeedsValue()));
  } finally {
    descartar(root);
  }
});

test("should install over a personal config holding invalid initials", () => {
  const repo = instalacaoLimpa();
  try {
    escreverConfig(repo, { projectId: "fixture", initials: "M_R" });
    execFileSync(process.execPath, [BIN, "install", "--engine", "claude-code", "--language", "java", "--arch", "layered", "--user-language", "pt-BR", "--project-id", "fixture", "-y", repo], { cwd: repo, stdio: "pipe" });
    assert.equal(JSON.parse(readFileSync(arquivoDe(repo), "utf8")).initials, "M_R");
  } finally {
    descartar(repo);
  }
});

test("should print an invalid string initials value as is", () => {
  const root = temporario();
  try {
    escreverConfig(root, { initials: "M_R" });
    const { io, err } = coletor();
    assert.equal(initials({ root, positional: [], flags: {}, io, M }), 1);
    assert.deepEqual(err, [M.initialsInvalid("M_R")]);
  } finally {
    descartar(root);
  }
});

test("should show an invalid previous value when overwriting it", () => {
  const root = temporario();
  try {
    escreverConfig(root, { initials: "M_R" });
    const { io, out } = coletor();
    assert.equal(initials({ root, positional: ["set", "mr"], flags: {}, io, M }), 0);
    assert.equal(out[1], M.initialsWritten("M_R", "mr"));
  } finally {
    descartar(root);
  }
});

test("should show the none label when there were no initials before", () => {
  const root = temporario();
  try {
    const { io, out } = coletor();
    assert.equal(initials({ root, positional: ["set", "mr"], flags: {}, io, M }), 0);
    assert.equal(out[1], M.initialsWritten(M.initialsNone(), "mr"));
  } finally {
    descartar(root);
  }
});
