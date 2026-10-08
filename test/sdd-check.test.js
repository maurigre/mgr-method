import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkSdd } from "../src/sdd-check.js";
import { sddCheck } from "../src/commands/sdd-check.js";
import { getMessages } from "../src/messages.js";

const temporario = () => mkdtempSync(path.join(tmpdir(), "mgr-sdd-"));

const comDocs = (arquivos) => {
  const raiz = temporario();
  const dir = path.join(raiz, "docs", "sdd");
  mkdirSync(dir, { recursive: true });
  for (const nome of arquivos) writeFileSync(path.join(dir, nome), "# x\n");
  return raiz;
};

const coletor = () => {
  const out = [];
  const err = [];
  const io = { out: (linha) => out.push(linha), err: (linha) => err.push(linha), style: {}, invocation: "mgr", lifecycle: "mgr" };
  return { io, out, err };
};

const M = {
  sddCheckNoDir: () => "M:no-dir",
  sddCheckNoConstitution: () => "M:no-constitution",
  sddCheckEmpty: () => "M:empty",
  sddCheckNoReviewRules: () => "M:no-review-rules",
  sddCheckOk: (dir) => `M:ok:${dir}`,
};

test("should fail with no-dir when docs/sdd does not exist", () => {
  const raiz = temporario();

  assert.deepEqual(checkSdd(raiz), { ok: false, reason: "no-dir", warnings: [], dir: path.join(raiz, "docs", "sdd") });
});

test("should fail with no-constitution when CONSTITUTION.md is absent", () => {
  const raiz = comDocs(["01-prd.md"]);

  assert.deepEqual(checkSdd(raiz), { ok: false, reason: "no-constitution", warnings: [], dir: path.join(raiz, "docs", "sdd") });
});

test("should fail with empty when no markdown is listed even though the constitution exists", () => {
  const raiz = temporario();

  assert.deepEqual(checkSdd(raiz, { exists: () => true, listMd: () => [] }), {
    ok: false,
    reason: "empty",
    warnings: [],
    dir: path.join(raiz, "docs", "sdd"),
  });
});

test("should pass with a no-review-rules warning when only the review guide is missing", () => {
  const raiz = comDocs(["CONSTITUTION.md"]);

  assert.deepEqual(checkSdd(raiz), {
    ok: true,
    reason: null,
    warnings: ["no-review-rules"],
    dir: path.join(raiz, "docs", "sdd"),
  });
});

test("should pass with no warnings when the constitution and the review guide are present", () => {
  const raiz = comDocs(["CONSTITUTION.md", "09-review-rules.md"]);

  assert.deepEqual(checkSdd(raiz), { ok: true, reason: null, warnings: [], dir: path.join(raiz, "docs", "sdd") });
});

test("should write the no-dir text to stderr and exit 1 when docs/sdd does not exist", () => {
  const raiz = temporario();
  const { io, out, err } = coletor();

  assert.equal(sddCheck({ root: raiz, io, M }), 1);
  assert.deepEqual(err, ["M:no-dir"]);
  assert.deepEqual(out, []);
});

test("should write the no-constitution text to stderr and exit 1 when CONSTITUTION.md is absent", () => {
  const raiz = comDocs(["01-prd.md"]);
  const { io, out, err } = coletor();

  assert.equal(sddCheck({ root: raiz, io, M }), 1);
  assert.deepEqual(err, ["M:no-constitution"]);
  assert.deepEqual(out, []);
});

test("should write the no-review-rules warning to stderr and the ok line to stdout with exit 0", () => {
  const raiz = comDocs(["CONSTITUTION.md"]);
  const { io, out, err } = coletor();

  assert.equal(sddCheck({ root: raiz, io, M }), 0);
  assert.deepEqual(err, ["M:no-review-rules"]);
  assert.deepEqual(out, [`M:ok:${path.join(raiz, "docs", "sdd")}`]);
});

test("should write the empty text to stderr and exit 1 when docs/sdd has no markdown by injection", () => {
  const raiz = temporario();
  const { io, out, err } = coletor();

  assert.equal(sddCheck({ root: raiz, io, M, exists: () => true, listMd: () => [] }), 1);
  assert.deepEqual(err, ["M:empty"]);
  assert.deepEqual(out, []);
});

test("should write only the ok line to stdout and exit 0 when the project is ready", () => {
  const raiz = comDocs(["CONSTITUTION.md", "09-review-rules.md"]);
  const { io, out, err } = coletor();

  assert.equal(sddCheck({ root: raiz, io, M }), 0);
  assert.deepEqual(err, []);
  assert.deepEqual(out, [`M:ok:${path.join(raiz, "docs", "sdd")}`]);
});

// Os literais vêm da tabela "sdd-check, textos pt-BR" da §4 da spec (CA-13), e não do messages.js.
test("should print the five pt-BR texts of the spec table with the real messages", () => {
  const real = getMessages("pt-BR");
  const rodar = (raiz, extra = {}) => {
    const { io, out, err } = coletor();
    const code = sddCheck({ root: raiz, io, M: real, ...extra });
    return { code, out, err };
  };

  const semDir = rodar(temporario());
  assert.equal(semDir.code, 1);
  assert.deepEqual(semDir.err, ["SDD INCOMPLETO: docs/sdd/ não existe — rode a skill spec-init primeiro"]);

  const semConstituicao = rodar(comDocs(["00-overview.md"]));
  assert.equal(semConstituicao.code, 1);
  assert.deepEqual(semConstituicao.err, ["SDD INCOMPLETO: docs/sdd/CONSTITUTION.md ausente — rode o spec-init e revise a constituição"]);

  const vazio = rodar(comDocs(["CONSTITUTION.md"]), { listMd: () => [] });
  assert.equal(vazio.code, 1);
  assert.deepEqual(vazio.err, ["SDD INCOMPLETO: docs/sdd/ está vazio"]);

  const raiz = comDocs(["CONSTITUTION.md"]);
  const pronto = rodar(raiz);
  assert.equal(pronto.code, 0);
  assert.deepEqual(pronto.err, ["aviso: docs/sdd/09-review-rules.md ausente — o code-analyzer vai operar sem o guia do projeto"]);
  assert.deepEqual(pronto.out, [`SDD OK: projeto inicializado (${path.join(raiz, "docs", "sdd")})`]);
});
