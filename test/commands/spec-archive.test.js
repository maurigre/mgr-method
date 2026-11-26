import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { specArchive, specNext, specStatus, specValidate } from "../../src/commands/spec.js";
import { localDate } from "../../src/sdd/archive.js";
import { inspectSdd } from "../../src/sdd/sdd-check.js";
import { getMessages } from "../../src/core/messages.js";
import { tempDir } from "../../scripts/lib/tmp.mjs";

const IDIOMAS = ["en", "pt-BR"];
const HOJE = localDate(new Date());

const coletor = () => {
  const out = [];
  const err = [];
  const io = { out: (linha) => out.push(linha), err: (linha) => err.push(linha), style: { dim: (texto) => texto }, invocation: "mgr", lifecycle: "mgr" };
  return { io, out, err };
};

const montarRepo = ({ statusDaTask = "done", arquivada = null } = {}) => {
  const root = tempDir("mgr-spec-archive-");
  mkdirSync(path.join(root, "docs", "sdd"), { recursive: true });
  writeFileSync(path.join(root, "docs", "sdd", "CONSTITUTION.md"), "# Constituição\n");
  if (arquivada === null) {
    const dir = path.join(root, "specs", "x");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "04-plan.md"), `### P0.1 — x\n- **status:** ${statusDaTask}\n`);
    writeFileSync(path.join(dir, "06-completion.md"), "## Diff do SDD (local)\n\nNão houve alteração no SDD: motivo.\n");
  } else {
    mkdirSync(path.join(root, "specs", "archive", arquivada), { recursive: true });
  }
  return root;
};

const arvore = (dir, relativo = "") => readdirSync(path.join(dir, relativo)).sort().flatMap((nome) => {
  const caminho = path.join(relativo, nome);
  return statSync(path.join(dir, caminho)).isDirectory()
    ? [[caminho, null], ...arvore(dir, caminho)]
    : [[caminho, readFileSync(path.join(dir, caminho))]];
});

for (const idioma of IDIOMAS) {
  const mensagens = getMessages(idioma);

  test(`should archive a finished feature and print its destination [${idioma}]`, () => {
    const root = montarRepo();
    const { io, out, err } = coletor();

    assert.equal(specArchive({ root, flags: {}, positional: ["x"], io, M: mensagens }), 0);
    assert.deepEqual(err, []);
    const destino = path.join("specs", "archive", `${HOJE}-x`);
    assert.deepEqual(out, [
      mensagens.specArchiveMoving(path.join("specs", "x"), destino),
      mensagens.specArchiveDone(path.join("specs", "x"), destino),
      mensagens.specArchiveSddWarnings(inspectSdd(root).warnings.length),
    ]);
    assert.equal(existsSync(path.join(root, "specs", "x")), false);
    assert.equal(existsSync(path.join(root, "specs", "archive", `${HOJE}-x`)), true);
  });

  test(`should refuse a feature with a task not done and leave specs byte for byte [${idioma}]`, () => {
    const root = montarRepo({ statusDaTask: "todo" });
    const antes = arvore(path.join(root, "specs"));
    const { io, out, err } = coletor();

    assert.equal(specArchive({ root, flags: {}, positional: ["x"], io, M: mensagens }), 1);
    assert.equal(err[0], mensagens.errorPrefix(mensagens.specArchiveRefused("x")));
    assert.ok(err.includes(mensagens.specArchiveTasksNotDone("P0.1")));
    assert.deepEqual(out, []);
    assert.deepEqual(arvore(path.join(root, "specs")), antes);
  });

  test(`should refuse an archive without slug and say why [${idioma}]`, () => {
    const root = montarRepo();
    const antes = arvore(path.join(root, "specs"));
    const { io, out, err } = coletor();

    assert.equal(specArchive({ root, flags: {}, positional: [], io, M: mensagens }), 1);
    assert.deepEqual(err, [mensagens.errorPrefix(mensagens.specArchiveNeedsSlug)]);
    assert.deepEqual(out, []);
    assert.deepEqual(arvore(path.join(root, "specs")), antes);
  });

  test(`should refuse --all with its own message and move nothing [${idioma}]`, () => {
    const root = montarRepo();
    const antes = arvore(path.join(root, "specs"));
    const { io, out, err } = coletor();

    assert.equal(specArchive({ root, flags: { all: true }, positional: [], io, M: mensagens }), 1);
    assert.deepEqual(err, [mensagens.errorPrefix(mensagens.specArchiveAllRefused)]);
    assert.deepEqual(out, []);
    assert.deepEqual(arvore(path.join(root, "specs")), antes);
  });

  test(`should archive under the date given by --date [${idioma}]`, () => {
    const root = montarRepo();
    const { io, out, err } = coletor();

    assert.equal(specArchive({ root, flags: { date: "2026-01-15" }, positional: ["x"], io, M: mensagens }), 0);
    assert.deepEqual(err, []);
    assert.equal(out[1], mensagens.specArchiveDone(path.join("specs", "x"), path.join("specs", "archive", "2026-01-15-x")));
    assert.equal(existsSync(path.join(root, "specs", "archive", "2026-01-15-x")), true);
  });

  test(`should refuse an impossible --date and move nothing [${idioma}]`, () => {
    const root = montarRepo();
    const antes = arvore(path.join(root, "specs"));
    const { io, out, err } = coletor();

    assert.equal(specArchive({ root, flags: { date: "2026-02-30" }, positional: ["x"], io, M: mensagens }), 1);
    assert.deepEqual(err, [mensagens.errorPrefix(mensagens.specArchiveRefused("x")), mensagens.specArchiveDateInvalid("2026-02-30")]);
    assert.deepEqual(out, []);
    assert.deepEqual(arvore(path.join(root, "specs")), antes);
  });

  test(`should list the archived features as text, newest first [${idioma}]`, () => {
    const root = montarRepo({ arquivada: "2026-01-15-x" });
    const { io, out, err } = coletor();

    assert.equal(specStatus({ root, cwd: root, flags: { archived: true }, positional: [], io, M: mensagens }), 0);
    assert.deepEqual(err, []);
    assert.deepEqual(out, [mensagens.specStatusArchivedLine("2026-01-15", "x")]);
    assert.equal(out[0], "  2026-01-15  x");
  });

  test(`should say the archive is empty with exit 0 [${idioma}]`, () => {
    const root = montarRepo();
    const { io, out, err } = coletor();

    assert.equal(specStatus({ root, cwd: root, flags: { archived: true }, positional: [], io, M: mensagens }), 0);
    assert.deepEqual(err, []);
    assert.deepEqual(out, [mensagens.specStatusArchivedEmpty(path.join(root, "specs", "archive"))]);
  });

  test(`should refuse --archived with a slug or --all [${idioma}]`, () => {
    const root = montarRepo({ arquivada: "2026-01-15-x" });

    const comSlug = coletor();
    assert.equal(specStatus({ root, cwd: root, flags: { archived: true }, positional: ["x"], io: comSlug.io, M: mensagens }), 1);
    assert.deepEqual(comSlug.err, [mensagens.errorPrefix(mensagens.specStatusArchivedExclusive)]);
    assert.deepEqual(comSlug.out, []);

    const comAll = coletor();
    assert.equal(specStatus({ root, cwd: root, flags: { archived: true, all: true }, positional: [], io: comAll.io, M: mensagens }), 1);
    assert.deepEqual(comAll.err, [mensagens.errorPrefix(mensagens.specStatusArchivedExclusive)]);
    assert.deepEqual(comAll.out, []);
  });

  test(`should refuse status, next and validate for a slug that only exists archived [${idioma}]`, () => {
    const root = montarRepo({ arquivada: "2026-01-15-x" });
    const onde = path.join("specs", "archive", "2026-01-15-x");
    const esperado = mensagens.errorPrefix(mensagens.specArchived("x", onde));
    const comandos = [
      ["status", (io) => specStatus({ root, cwd: root, flags: {}, positional: ["x"], io, M: mensagens })],
      ["status --json", (io) => specStatus({ root, cwd: root, flags: { json: true }, positional: ["x"], io, M: mensagens })],
      ["next", (io) => specNext({ root, cwd: root, flags: {}, positional: ["x"], io, M: mensagens })],
      ["validate", (io) => specValidate({ root, cwd: root, flags: {}, positional: ["x"], io, M: mensagens })],
    ];
    for (const [nome, executar] of comandos) {
      const { io, out, err } = coletor();
      assert.equal(executar(io), 1, nome);
      assert.deepEqual(err, [esperado], nome);
      assert.deepEqual(out, [], nome);
    }
  });

  test(`should refuse the reserved slug archive in every command [${idioma}]`, () => {
    const root = montarRepo();
    const esperado = mensagens.errorPrefix(mensagens.specArchiveReserved);
    const comandos = [
      ["status", (io) => specStatus({ root, cwd: root, flags: {}, positional: ["archive"], io, M: mensagens })],
      ["next", (io) => specNext({ root, cwd: root, flags: {}, positional: ["archive"], io, M: mensagens })],
      ["validate", (io) => specValidate({ root, cwd: root, flags: {}, positional: ["archive"], io, M: mensagens })],
    ];
    for (const [nome, executar] of comandos) {
      const { io, out, err } = coletor();
      assert.equal(executar(io), 1, nome);
      assert.deepEqual(err, [esperado], nome);
      assert.deepEqual(out, [], nome);
    }
    const { io, err } = coletor();
    assert.equal(specArchive({ root, flags: {}, positional: ["archive"], io, M: mensagens }), 1);
    assert.ok(err.includes(mensagens.specArchiveReserved));
  });
}

test("should print the archived list as JSON with schemaVersion 1", () => {
  const root = montarRepo({ arquivada: "2026-01-15-x" });
  const { io, out, err } = coletor();

  assert.equal(specStatus({ root, cwd: root, flags: { archived: true, json: true }, positional: [], io, M: getMessages("en") }), 0);
  assert.deepEqual(err, []);
  assert.deepEqual(JSON.parse(out[0]), {
    schemaVersion: 1,
    archived: [{
      name: "2026-01-15-x", path: path.join("specs", "archive", "2026-01-15-x"), recognized: true, date: "2026-01-15", slug: "x",
    }],
  });
});

test("should print an empty archived list as JSON with exit 0", () => {
  const root = montarRepo();
  const { io, out, err } = coletor();

  assert.equal(specStatus({ root, cwd: root, flags: { archived: true, json: true }, positional: [], io, M: getMessages("en") }), 0);
  assert.deepEqual(err, []);
  assert.deepEqual(JSON.parse(out[0]), { schemaVersion: 1, archived: [] });
});

const recusaDe = (root, positional, flags = {}) => {
  const { io, out, err } = coletor();
  const codigo = specArchive({ root, flags, positional, io, M: getMessages("en") });
  return { codigo, out, err };
};

const comPlanoApagado = () => {
  const root = montarRepo();
  rmSync(path.join(root, "specs", "x", "04-plan.md"));
  return root;
};

const comPlanoSemTasks = () => {
  const root = montarRepo();
  writeFileSync(path.join(root, "specs", "x", "04-plan.md"), "# Plano sem tasks\n");
  return root;
};

const comFechamentoSemSdd = () => {
  const root = montarRepo();
  writeFileSync(path.join(root, "specs", "x", "06-completion.md"), "# Conclusao\n");
  return root;
};

const semConstituicao = () => {
  const root = montarRepo();
  rmSync(path.join(root, "docs", "sdd", "CONSTITUTION.md"));
  return root;
};

const comDestinoOcupado = () => {
  const root = montarRepo();
  mkdirSync(path.join(root, "specs", "archive", "2026-01-15-x"), { recursive: true });
  return root;
};

const CASOS_DE_RECUSA = [
  ["no-plan", comPlanoApagado, ["x"], {}, (M) => M.specArchiveNoPlan],
  ["no-tasks", comPlanoSemTasks, ["x"], {}, (M) => M.specArchiveNoTasks],
  ["completion-findings", comFechamentoSemSdd, ["x"], {}, (M) => M.specArchiveCompletionFindings("DOC-3", "x")],
  ["sdd-check-failed", semConstituicao, ["x"], {}, (M) => M.specArchiveSddFailed("no-constitution")],
  ["destination-exists", comDestinoOcupado, ["x"], { date: "2026-01-15" },
    (M) => M.specArchiveDestinationExists(path.join("specs", "archive", "2026-01-15-x"))],
  ["future-date", () => montarRepo(), ["x"], { date: "2999-01-01" }, (M) => M.specArchiveDateFuture("2999-01-01")],
  ["invalid-date without value", () => montarRepo(), ["x"], { date: undefined }, (M) => M.specArchiveDateInvalid("")],
  ["not-found", () => montarRepo(), ["nao-existe"], {}, (M) => M.specStatusNotFound("nao-existe")],
  ["already-archived", () => montarRepo({ arquivada: "2026-01-01-velha" }), ["velha"], {},
    (M) => M.specArchived("velha", path.join("specs", "archive", "2026-01-01-velha"))],
  ["reserved-slug", () => montarRepo(), ["archive"], {}, (M) => M.specArchiveReserved],
];

for (const [codigo, montar, positional, flags, linha] of CASOS_DE_RECUSA) {
  test(`should print the ${codigo} reason line through the glue and move nothing`, () => {
    const root = montar();
    const antes = existsSync(path.join(root, "specs")) ? arvore(path.join(root, "specs")) : [];
    const { codigo: saida, out, err } = recusaDe(root, positional, flags);
    assert.equal(saida, 1);
    assert.deepEqual(out, []);
    assert.deepEqual(arvore(path.join(root, "specs")), antes);
    assert.ok(err.includes(linha(getMessages("en"))), err.join(" | "));
  });
}


test("should report the failed move and keep the feature when specs/archive is a file", () => {
  const mensagens = getMessages("en");
  const root = montarRepo();
  writeFileSync(path.join(root, "specs", "archive"), "nao e pasta\n");
  const { codigo, out, err } = recusaDe(root, ["x"], { date: "2026-01-15" });
  assert.equal(codigo, 1);
  assert.deepEqual(out, [mensagens.specArchiveMoving(path.join("specs", "x"), path.join("specs", "archive", "2026-01-15-x"))]);
  assert.deepEqual(err, [mensagens.errorPrefix(mensagens.specArchiveMoveFailed(
    path.join("specs", "x"), path.join("specs", "archive", "2026-01-15-x"), "ENOTDIR"))]);
  assert.equal(existsSync(path.join(root, "specs", "x", "04-plan.md")), true);
});

test("should list an archive folder whose name is outside the date pattern at the end", () => {
  const mensagens = getMessages("en");
  const root = montarRepo({ arquivada: "2026-01-15-x" });
  mkdirSync(path.join(root, "specs", "archive", "solta"), { recursive: true });
  const { io, out } = coletor();
  assert.equal(specStatus({ root, cwd: root, flags: { archived: true }, positional: [], io, M: mensagens }), 0);
  assert.deepEqual(out, [mensagens.specStatusArchivedLine("2026-01-15", "x"), mensagens.specStatusArchivedUnrecognized("solta")]);
});

