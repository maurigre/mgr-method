import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkSdd, describeSdd, inspectSdd, ROLE_STEMS, SDD_FILES } from "../src/sdd-check.js";
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
  sddCheckMissingCanonical: (file) => `M:missing:${file}`,
  sddCheckOutOfList: (file) => `M:out:${file}`,
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
  assert.deepEqual(err, [
    "M:no-review-rules",
    "M:missing:00-overview.md",
    "M:missing:01-stack.md",
    "M:missing:02-architecture.md",
    "M:missing:03-contracts.md",
    "M:missing:04-domain.md",
    "M:missing:05-data.md",
    "M:missing:06-quality.md",
    "M:missing:07-operations.md",
    "M:missing:08-glossary.md",
    "M:missing:_self-assessment.md",
  ]);
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
  const raiz = comDocs(SDD_FILES.map(({ file }) => file));
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

  const raiz = comDocs(SDD_FILES.map(({ file }) => file).filter((file) => file !== "09-review-rules.md"));
  const pronto = rodar(raiz);
  assert.equal(pronto.code, 0);
  assert.deepEqual(pronto.err, ["aviso: docs/sdd/09-review-rules.md ausente — o code-analyzer vai operar sem o guia do projeto"]);
  assert.deepEqual(pronto.out, [`SDD OK: projeto inicializado (${path.join(raiz, "docs", "sdd")})`]);
});

test("should list the twelve canonical files in order and keep the list frozen", () => {
  assert.deepEqual(SDD_FILES, [
    { role: "overview", file: "00-overview.md" },
    { role: "stack", file: "01-stack.md" },
    { role: "architecture", file: "02-architecture.md" },
    { role: "contracts", file: "03-contracts.md" },
    { role: "domain", file: "04-domain.md" },
    { role: "data", file: "05-data.md" },
    { role: "quality", file: "06-quality.md" },
    { role: "operations", file: "07-operations.md" },
    { role: "glossary", file: "08-glossary.md" },
    { role: "review-rules", file: "09-review-rules.md" },
    { role: "constitution", file: "CONSTITUTION.md" },
    { role: "self-assessment", file: "_self-assessment.md" },
  ]);
  assert.ok(Object.isFrozen(SDD_FILES));
  assert.ok(SDD_FILES.every((item) => Object.isFrozen(item)));
  assert.ok(Object.isFrozen(ROLE_STEMS));
  assert.ok(Object.values(ROLE_STEMS).every((radicais) => Object.isFrozen(radicais)));
});

test("should resolve a role to its canonical file when it exists", () => {
  const raiz = comDocs(["02-architecture.md"]);

  assert.deepEqual(describeSdd(raiz).roles.architecture, {
    status: "canonical",
    path: path.join(raiz, "docs", "sdd", "02-architecture.md"),
    candidates: [],
  });
});

test("should resolve a role to a single legacy file and report it out of the list", () => {
  const raiz = comDocs(["01-architecture.md"]);
  const dir = path.join(raiz, "docs", "sdd");
  const resultado = describeSdd(raiz);

  assert.deepEqual(resultado.roles.architecture, {
    status: "legacy",
    path: path.join(dir, "01-architecture.md"),
    candidates: ["01-architecture.md"],
  });
  assert.deepEqual(resultado.outOfList, ["01-architecture.md"]);
  assert.ok(resultado.missing.includes("02-architecture.md"));
});

test("should report ambiguous with both candidates when two legacy files match a role", () => {
  const raiz = comDocs(["01-architecture.md", "05-architecture-notes.md"]);

  assert.deepEqual(describeSdd(raiz).roles.architecture, {
    status: "ambiguous",
    path: null,
    candidates: ["01-architecture.md", "05-architecture-notes.md"],
  });
});

test("should report absent when nothing matches and resolve one file to two roles", () => {
  const raiz = comDocs(["05-quality-operations.md", "README.md"]);
  const dir = path.join(raiz, "docs", "sdd");
  const { roles } = describeSdd(raiz);

  assert.deepEqual(roles.quality, { status: "legacy", path: path.join(dir, "05-quality-operations.md"), candidates: ["05-quality-operations.md"] });
  assert.deepEqual(roles.operations, { status: "legacy", path: path.join(dir, "05-quality-operations.md"), candidates: ["05-quality-operations.md"] });
  assert.deepEqual(roles.stack, { status: "absent", path: null, candidates: [] });
});

test("should resolve Portuguese legacy names measured in the projects", () => {
  const raiz = comDocs(["03-contratos.md", "04-dominio.md"]);
  const dir = path.join(raiz, "docs", "sdd");
  const { roles } = describeSdd(raiz);

  assert.deepEqual(roles.contracts, { status: "legacy", path: path.join(dir, "03-contratos.md"), candidates: ["03-contratos.md"] });
  assert.deepEqual(roles.domain, { status: "legacy", path: path.join(dir, "04-dominio.md"), candidates: ["04-dominio.md"] });
});

test("should ignore auxiliary underscore files and subdirectories in the out of list report", () => {
  const raiz = comDocs(["_analysis-x.md", "_notes-architecture.md", "README.md"]);
  const dir = path.join(raiz, "docs", "sdd");
  mkdirSync(path.join(dir, "extensions"));
  writeFileSync(path.join(dir, "extensions", "topico.md"), "# x\n");

  const resultado = describeSdd(raiz);

  assert.deepEqual(resultado.outOfList, ["README.md"]);
  assert.equal(resultado.roles.architecture.status, "absent");
});

test("should report every role absent when docs/sdd does not exist", () => {
  const raiz = temporario();
  const resultado = describeSdd(raiz);

  assert.deepEqual(Object.keys(resultado.roles), SDD_FILES.map(({ role }) => role));
  assert.deepEqual(Object.values(resultado.roles).map(({ status }) => status), SDD_FILES.map(() => "absent"));
  assert.deepEqual(resultado.missing, SDD_FILES.map(({ file }) => file));
  assert.deepEqual(resultado.outOfList, []);
});

test("should warn about each missing canonical file except the review guide", () => {
  const raiz = comDocs(["CONSTITUTION.md", "00-overview.md", "08-glossary.md"]);
  const { io, out, err } = coletor();
  const ausentes = [
    "01-stack.md",
    "02-architecture.md",
    "03-contracts.md",
    "04-domain.md",
    "05-data.md",
    "06-quality.md",
    "07-operations.md",
    "_self-assessment.md",
  ];

  assert.equal(sddCheck({ root: raiz, io, M }), 0);
  assert.deepEqual(err, ["M:no-review-rules", ...ausentes.map((file) => `M:missing:${file}`)]);
  assert.deepEqual(out, [`M:ok:${path.join(raiz, "docs", "sdd")}`]);
});

test("should print only valid JSON with the twelve roles and keep exit 0 for a ready project", () => {
  const raiz = comDocs(SDD_FILES.map(({ file }) => file));
  const { io, out, err } = coletor();

  assert.equal(sddCheck({ root: raiz, io, M, flags: { json: true } }), 0);
  assert.deepEqual(err, []);
  assert.equal(out.length, 1);
  const payload = JSON.parse(out[0]);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.ok, true);
  assert.equal(payload.reason, null);
  assert.equal(payload.dir, path.join(raiz, "docs", "sdd"));
  assert.deepEqual(payload.warnings, []);
  assert.deepEqual(Object.keys(payload.roles), SDD_FILES.map(({ role }) => role));
});

test("should print the JSON with ok false and exit 1 when the constitution is missing", () => {
  const raiz = comDocs(["01-prd.md"]);
  const { io, out, err } = coletor();

  assert.equal(sddCheck({ root: raiz, io, M, flags: { json: true } }), 1);
  assert.deepEqual(err, []);
  assert.equal(out.length, 1);
  const payload = JSON.parse(out[0]);
  assert.equal(payload.ok, false);
  assert.equal(payload.reason, "no-constitution");
  assert.deepEqual(payload.warnings, [{ code: "out-of-list", file: "01-prd.md" }]);
  assert.equal(payload.roles.architecture.status, "absent");
});

test("should keep the text output byte for byte for a project with all canonical files", () => {
  const real = getMessages("pt-BR");
  const raiz = comDocs(SDD_FILES.map(({ file }) => file));
  const { io, out, err } = coletor();

  assert.equal(sddCheck({ root: raiz, io, M: real }), 0);
  assert.deepEqual(err, []);
  assert.deepEqual(out, [`SDD OK: projeto inicializado (${path.join(raiz, "docs", "sdd")})`]);
});

test("should warn about out of list files in text and list every warning code in order in the JSON", () => {
  const arquivos = SDD_FILES.map(({ file }) => file).filter((file) => !["09-review-rules.md", "01-stack.md"].includes(file));
  const raiz = comDocs([...arquivos, "README.md"]);
  const texto = coletor();

  assert.equal(sddCheck({ root: raiz, io: texto.io, M }), 0);
  assert.deepEqual(texto.err, ["M:no-review-rules", "M:missing:01-stack.md", "M:out:README.md"]);

  const json = coletor();
  assert.equal(sddCheck({ root: raiz, io: json.io, M, flags: { json: true } }), 0);
  assert.deepEqual(JSON.parse(json.out[0]).warnings, [
    { code: "no-review-rules" },
    { code: "missing-canonical", file: "01-stack.md" },
    { code: "out-of-list", file: "README.md" },
  ]);
  assert.deepEqual(json.err, []);
});

test("should match role stems regardless of letter case", () => {
  const raiz = comDocs(["03-CONTRATOS.md"]);

  assert.equal(describeSdd(raiz).roles.contracts.status, "legacy");
});

test("should describe a docs/sdd that is a plain file as having nothing to list", () => {
  const raiz = temporario();
  mkdirSync(path.join(raiz, "docs"));
  writeFileSync(path.join(raiz, "docs", "sdd"), "x\n");
  const { io, out, err } = coletor();

  assert.deepEqual(describeSdd(raiz).outOfList, []);
  assert.equal(sddCheck({ root: raiz, io, M, flags: { json: true } }), 1);
  assert.equal(JSON.parse(out[0]).reason, "no-constitution");
  assert.deepEqual(err, []);
});

test("should derive the warnings in the core and keep only out of list ones when the check fails", () => {
  const pronto = comDocs(SDD_FILES.map(({ file }) => file).filter((file) => !["09-review-rules.md", "01-stack.md"].includes(file)).concat("README.md"));

  assert.deepEqual(inspectSdd(pronto).warnings, [
    { code: "no-review-rules" },
    { code: "missing-canonical", file: "01-stack.md" },
    { code: "out-of-list", file: "README.md" },
  ]);
  assert.deepEqual(inspectSdd(comDocs(["00-overview.md"])).warnings, []);
  assert.deepEqual(inspectSdd(comDocs(["01-contexto-visao.md"])).warnings, [{ code: "out-of-list", file: "01-contexto-visao.md" }]);
});

test("should print the new warnings with the real messages in both languages", () => {
  const raiz = comDocs(SDD_FILES.map(({ file }) => file).filter((file) => file !== "01-stack.md").concat("README.md"));
  const linhas = (idioma) => {
    const { io, err } = coletor();
    sddCheck({ root: raiz, io, M: getMessages(idioma) });
    return err;
  };

  assert.deepEqual(linhas("en"), [
    "warning: docs/sdd/01-stack.md missing (canonical SDD file)",
    "warning: docs/sdd/README.md is not a canonical SDD file name",
  ]);
  assert.deepEqual(linhas("pt-BR"), [
    "aviso: docs/sdd/01-stack.md ausente (arquivo canônico do SDD)",
    "aviso: docs/sdd/README.md não é um nome canônico do SDD",
  ]);
});

test("should keep showing an unmatched legacy file to spec-init when the constitution is missing", () => {
  const raiz = comDocs(["01-contexto-visao.md"]);
  const json = coletor();
  const texto = coletor();

  assert.equal(sddCheck({ root: raiz, io: json.io, M, flags: { json: true } }), 1);
  const payload = JSON.parse(json.out[0]);
  assert.equal(payload.reason, "no-constitution");
  assert.equal(payload.roles.overview.status, "absent");
  assert.deepEqual(payload.warnings, [{ code: "out-of-list", file: "01-contexto-visao.md" }]);
  assert.equal(sddCheck({ root: raiz, io: texto.io, M }), 1);
  assert.deepEqual(texto.err, ["M:no-constitution"]);
});

test("should rethrow a read error other than ENOTDIR", () => {
  const erro = Object.assign(new Error("sem permissao"), { code: "EACCES" });
  const listMd = () => { throw erro; };

  assert.throws(() => describeSdd(temporario(), { exists: () => true, listMd }), erro);
});
