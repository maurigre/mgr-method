import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { specArchive, specStatus } from "../../src/commands/spec.js";
import { PROOF_FILE } from "../../src/sdd/external-review.js";
import { inspectSdd } from "../../src/sdd/sdd-check.js";
import { getMessages } from "../../src/core/messages.js";
import { createReviewIo } from "../../bin/review-io.js";
import { tempDir } from "../../scripts/lib/tmp.mjs";
import { envSemCodex } from "../helpers/codex-falso.js";

const IDIOMAS = ["en", "pt-BR"];
const DATA = "2026-11-26";
const DATA_DO_CONSENTIMENTO = "2026-11-26T10:00:00.000Z";
const CONFIG_LIGADA = { externalReview: { enabled: true, reviewers: ["codex"] } };
const CONFIG_DESLIGADA = { externalReview: { enabled: false, reviewers: ["codex"] } };
const CONSENTIMENTO = { externalReviewConsent: { codex: { at: DATA_DO_CONSENTIMENTO } } };
const ORIGEM = path.join("specs", "x");
const DESTINO = path.join("specs", "archive", `${DATA}-x`);
const FUNCOES_DO_GIT = ["isRepo", "resolve", "head", "dirty", "changedFiles", "contentsAt"];

const sha256 = (conteudo) => createHash("sha256").update(conteudo).digest("hex");
const git = (cwd, ...argumentos) => execFileSync("git", argumentos, { cwd, encoding: "utf8" });
const SHA_DO_B_ORIGINAL = sha256("y\n");

const REVISAO = {
  kind: "review", round: 1, reviewer: "codex", provider: "OpenAI", version: "codex-cli 0.0.0", session: "s1",
  at: DATA_DO_CONSENTIMENTO, language: "pt-BR", base: "main", baseCommit: "a".repeat(40), head: "b".repeat(40),
  files: [{ path: "b.js", state: "present", sha256: SHA_DO_B_ORIGINAL }],
  specAxis: "reviewed", findings: { standards: [], spec: [] }, suggestions: [],
};
const FALHA = { kind: "failure", round: 1, reviewer: "codex", at: DATA_DO_CONSENTIMENTO, code: "reviewer-failed" };
const DISPENSA = { kind: "waiver", by: "mr", at: "2026-11-26T11:00:00.000Z", reason: "cota esgotada", failure: "reviewer-failed" };
const provaCom = (...entradas) => ({ schemaVersion: 1, slug: "x", entries: entradas });

const coletor = () => {
  const out = [];
  const err = [];
  const style = { bold: (texto) => `<b>${texto}</b>`, yellow: (texto) => `<y>${texto}</y>` };
  const io = { out: (linha) => out.push(linha), err: (linha) => err.push(linha), style };
  return { io, out, err };
};

const gitQueLanca = () => Object.fromEntries(FUNCOES_DO_GIT.map((nome) => [nome, () => {
  throw new Error(`git chamado: ${nome}`);
}]));

const reviewIoReal = () => createReviewIo({ env: envSemCodex(), tmpRoot: tempDir("mgr-arch-rev-tmp-") });

function montarFatia({ statusDaTask = "done", configuracao = CONFIG_LIGADA, consentimento = true, prova } = {}) {
  const root = tempDir("mgr-arch-rev-");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "teste@example.invalid");
  git(root, "config", "user.name", "teste");
  mkdirSync(path.join(root, "docs", "sdd"), { recursive: true });
  writeFileSync(path.join(root, "docs", "sdd", "CONSTITUTION.md"), "# Constituição\n");
  writeFileSync(path.join(root, ".gitignore"), "specs/\n.mgr-core/\n");
  writeFileSync(path.join(root, "b.js"), "y\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "feat");
  const pasta = path.join(root, "specs", "x");
  mkdirSync(pasta, { recursive: true });
  writeFileSync(path.join(pasta, "04-plan.md"), `### P0.1 — x\n- **status:** ${statusDaTask}\n`);
  writeFileSync(path.join(pasta, "06-completion.md"), "## Diff do SDD (local)\n\nNão houve alteração no SDD: motivo.\n");
  const core = path.join(root, ".mgr-core");
  mkdirSync(core, { recursive: true });
  if (configuracao !== null) writeFileSync(path.join(core, "config.json"), JSON.stringify(configuracao));
  if (consentimento) writeFileSync(path.join(core, "config.local.json"), JSON.stringify(CONSENTIMENTO));
  if (prova !== undefined) {
    writeFileSync(path.join(pasta, PROOF_FILE), typeof prova === "string" ? prova : JSON.stringify(prova, null, 2));
  }
  return root;
}

const mudarB = (root, conteudo) => {
  writeFileSync(path.join(root, "b.js"), conteudo);
  git(root, "add", "b.js");
  git(root, "commit", "-qm", "muda b");
};

const arquivar = ({ root, idioma, reviewIo }) => {
  const mensagens = getMessages(idioma);
  const { io, out, err } = coletor();
  const codigo = specArchive({ root, flags: { date: DATA }, positional: ["x"], io, M: mensagens, reviewIo });
  return { codigo, out, err, mensagens, io };
};

const recusa = (mensagens, ...linhas) => [mensagens.errorPrefix(mensagens.specArchiveRefused("x")), ...linhas];

function arquivadaComDispensa(idioma) {
  const root = montarFatia({ prova: provaCom(FALHA, DISPENSA) });
  const resultado = arquivar({ root, idioma, reviewIo: reviewIoReal() });
  assert.equal(resultado.codigo, 0);
  return root;
}

for (const idioma of IDIOMAS) {
  for (const [variante, configuracao] of [["sem config", null], ["com enabled false", CONFIG_DESLIGADA]]) {
    test(`should archive without calling git when the external review is off (${variante}) [${idioma}]`, () => {
      const root = montarFatia({ configuracao });
      const avisos = inspectSdd(root).warnings.length;
      const { codigo, out, err, mensagens } = arquivar({ root, idioma, reviewIo: { git: gitQueLanca() } });

      assert.equal(codigo, 0);
      assert.deepEqual(err, []);
      assert.deepEqual(out, [
        mensagens.specArchiveMoving(ORIGEM, DESTINO),
        mensagens.specArchiveDone(ORIGEM, DESTINO),
        mensagens.specArchiveSddWarnings(avisos),
      ]);
      assert.equal(existsSync(path.join(root, "specs", "archive", `${DATA}-x`)), true);
    });
  }

  test(`should refuse with the missing reason and consent given when there is no proof [${idioma}]`, () => {
    const root = montarFatia();
    const { codigo, out, err, mensagens } = arquivar({ root, idioma, reviewIo: reviewIoReal() });

    assert.equal(codigo, 1);
    assert.deepEqual(err, recusa(mensagens, mensagens.specArchiveReviewMissing("x", true)));
    assert.deepEqual(out, []);
    assert.equal(existsSync(path.join(root, "specs", "x")), true);
    assert.equal(existsSync(path.join(root, "specs", "archive")), false);
  });

  test(`should refuse and name the missing consent when there is no proof and no consent [${idioma}]`, () => {
    const root = montarFatia({ consentimento: false });
    const { codigo, err, mensagens } = arquivar({ root, idioma, reviewIo: reviewIoReal() });

    assert.equal(codigo, 1);
    assert.deepEqual(err, recusa(mensagens, mensagens.specArchiveReviewMissing("x", false)));
  });

  test(`should refuse as missing when the proof has only a failure [${idioma}]`, () => {
    const root = montarFatia({ prova: provaCom(FALHA) });
    const { codigo, err, mensagens } = arquivar({ root, idioma, reviewIo: reviewIoReal() });

    assert.equal(codigo, 1);
    assert.deepEqual(err, recusa(mensagens, mensagens.specArchiveReviewMissing("x", true)));
    assert.equal(existsSync(path.join(root, "specs", "x", PROOF_FILE)), true);
  });

  test(`should refuse with the invalid reason and keep the unreadable proof untouched [${idioma}]`, () => {
    const root = montarFatia({ prova: "lixo" });
    const { codigo, err, mensagens } = arquivar({ root, idioma, reviewIo: reviewIoReal() });

    assert.equal(codigo, 1);
    assert.deepEqual(err, recusa(mensagens, mensagens.specArchiveReviewInvalid("json")));
    assert.equal(readFileSync(path.join(root, "specs", "x", PROOF_FILE), "utf8"), "lixo");
  });

  test(`should refuse with the stale reason when a reviewed file changed after the review [${idioma}]`, () => {
    const root = montarFatia({ prova: provaCom(REVISAO) });
    mudarB(root, "z\n");
    const { codigo, err, mensagens } = arquivar({ root, idioma, reviewIo: reviewIoReal() });

    assert.equal(codigo, 1);
    assert.deepEqual(err, recusa(mensagens, mensagens.specArchiveReviewStale(["b.js"])));
  });

  test(`should archive with the valid proof moved along when the hash still matches [${idioma}]`, () => {
    const root = montarFatia({ prova: provaCom(REVISAO) });
    const { codigo, out, err, mensagens } = arquivar({ root, idioma, reviewIo: reviewIoReal() });

    assert.equal(codigo, 0);
    assert.deepEqual(err, []);
    assert.ok(out.includes(mensagens.specArchiveDone(ORIGEM, DESTINO)));
    assert.equal(existsSync(path.join(root, "specs", "archive", `${DATA}-x`, PROOF_FILE)), true);
  });

  test(`should refuse with the unverifiable reason when no git is injected [${idioma}]`, () => {
    const root = montarFatia({ prova: provaCom(REVISAO) });
    const { codigo, err, mensagens } = arquivar({ root, idioma, reviewIo: undefined });

    assert.equal(codigo, 1);
    assert.deepEqual(err, recusa(mensagens, mensagens.specArchiveReviewUnverifiable));
  });

  test(`should list the task reason before the review reason when both fail [${idioma}]`, () => {
    const root = montarFatia({ statusDaTask: "todo" });
    const { codigo, err, mensagens } = arquivar({ root, idioma, reviewIo: reviewIoReal() });

    assert.equal(codigo, 1);
    assert.deepEqual(err, recusa(
      mensagens,
      mensagens.specArchiveTasksNotDone("P0.1"),
      mensagens.specArchiveReviewMissing("x", true),
    ));
  });

  test(`should archive with the waiver and print the waiver notice in bold yellow [${idioma}]`, () => {
    const root = montarFatia({ prova: provaCom(FALHA, DISPENSA) });
    const { codigo, out, err, mensagens, io } = arquivar({ root, idioma, reviewIo: reviewIoReal() });
    const aviso = io.style.bold(io.style.yellow(mensagens.specArchiveWaived("mr", "2026-11-26T11:00:00.000Z", "cota esgotada")));

    assert.equal(codigo, 0);
    assert.deepEqual(err, []);
    assert.ok(out.includes(aviso));
    assert.equal(aviso, `<b><y>${mensagens.specArchiveWaived("mr", "2026-11-26T11:00:00.000Z", "cota esgotada")}</y></b>`);
  });

  test(`should list the waived archived feature with the waiver mark as text [${idioma}]`, () => {
    const mensagens = getMessages(idioma);
    const root = arquivadaComDispensa(idioma);
    const { io, out, err } = coletor();

    assert.equal(specStatus({ root, cwd: root, flags: { archived: true }, positional: [], io, M: mensagens }), 0);
    assert.deepEqual(err, []);
    assert.deepEqual(out, [mensagens.specStatusArchivedLineWaived(DATA, "x")]);
  });
}

test("should mark the waived archived feature in JSON and leave the one without proof without the key", () => {
  const root = arquivadaComDispensa("en");
  mkdirSync(path.join(root, "specs", "archive", "2026-01-15-velha"), { recursive: true });
  const { io, out, err } = coletor();

  assert.equal(specStatus({ root, cwd: root, flags: { archived: true, json: true }, positional: [], io, M: getMessages("en") }), 0);
  assert.deepEqual(err, []);
  const { archived } = JSON.parse(out[0]);
  const dispensada = archived.find((entrada) => entrada.slug === "x");
  const velha = archived.find((entrada) => entrada.slug === "velha");
  assert.equal(dispensada.externalReview, "waived");
  assert.equal(Object.hasOwn(velha, "externalReview"), false);
});

const arvore = (dir, relativo = "") => readdirSync(path.join(dir, relativo)).sort().flatMap((nome) => {
  const caminho = path.join(relativo, nome);
  return statSync(path.join(dir, caminho)).isDirectory()
    ? [[caminho, null], ...arvore(dir, caminho)]
    : [[caminho, readFileSync(path.join(dir, caminho))]];
});

const comRevisaoSemGit = () => {
  const root = montarFatia({ prova: provaCom(REVISAO) });
  rmSync(path.join(root, ".git"), { recursive: true, force: true });
  return root;
};

const comRevisaoAlterada = () => {
  const root = montarFatia({ prova: provaCom(REVISAO) });
  mudarB(root, "z\n");
  return root;
};

const CASOS_DE_REVISAO_RECUSADA = [
  ["missing", () => montarFatia(), (mensagens) => mensagens.specArchiveReviewMissing("x", true)],
  ["invalid", () => montarFatia({ prova: "lixo" }), (mensagens) => mensagens.specArchiveReviewInvalid("json")],
  ["stale", comRevisaoAlterada, (mensagens) => mensagens.specArchiveReviewStale(["b.js"])],
  ["reviewer-not-configured", () => montarFatia({ prova: provaCom({ ...REVISAO, reviewer: "outro" }) }),
    (mensagens) => mensagens.specArchiveReviewReviewerNotConfigured("outro", ["codex"])],
  ["unverifiable", comRevisaoSemGit, (mensagens) => mensagens.specArchiveReviewUnverifiable],
];

for (const idioma of IDIOMAS) {
  for (const [nome, montar, linhaDe] of CASOS_DE_REVISAO_RECUSADA) {
    test(`should refuse the ${nome} external review and leave specs byte for byte [${idioma}]`, () => {
      const mensagens = getMessages(idioma);
      const root = montar();
      const antes = arvore(path.join(root, "specs"));
      const { codigo, out, err } = arquivar({ root, idioma, reviewIo: reviewIoReal() });

      assert.equal(codigo, 1);
      assert.deepEqual(err, recusa(mensagens, linhaDe(mensagens)));
      assert.deepEqual(out.filter((linha) => !linha.startsWith("git (") && !linha.startsWith(mensagens.reviewGitCalling("").split("(")[0])), []);
      assert.deepEqual(arvore(path.join(root, "specs")), antes);
    });
  }

  test(`should refuse a file deleted in the review that exists again at HEAD as stale [${idioma}]`, () => {
    const mensagens = getMessages(idioma);
    const root = montarFatia({ prova: provaCom({ ...REVISAO, files: [{ path: "c.js", state: "deleted" }] }) });
    writeFileSync(path.join(root, "c.js"), "novo\n");
    git(root, "add", "c.js");
    git(root, "commit", "-qm", "recria c");
    const antes = arvore(path.join(root, "specs"));
    const { codigo, out, err } = arquivar({ root, idioma, reviewIo: reviewIoReal() });

    assert.equal(codigo, 1);
    assert.deepEqual(err, recusa(mensagens, mensagens.specArchiveReviewStale(["c.js"])));
    assert.deepEqual(out.filter((linha) => !linha.startsWith("git (") && !linha.startsWith(mensagens.reviewGitCalling("").split("(")[0])), []);
    assert.deepEqual(arvore(path.join(root, "specs")), antes);
  });

  test(`should list the task, completion and review reasons in that order when all three fail [${idioma}]`, () => {
    const mensagens = getMessages(idioma);
    const root = montarFatia({ statusDaTask: "todo" });
    rmSync(path.join(root, "specs", "x", "06-completion.md"));
    const { codigo, err } = arquivar({ root, idioma, reviewIo: reviewIoReal() });

    assert.equal(codigo, 1);
    assert.deepEqual(err, recusa(
      mensagens,
      mensagens.specArchiveTasksNotDone("P0.1"),
      mensagens.specArchiveNoCompletion,
      mensagens.specArchiveReviewMissing("x", true),
    ));
  });

  test(`should wrap the cat-file git call with its log lines when archiving with a valid proof [${idioma}]`, () => {
    const mensagens = getMessages(idioma);
    const root = montarFatia({ prova: provaCom(REVISAO) });
    const { codigo, out, err } = arquivar({ root, idioma, reviewIo: reviewIoReal() });
    const posicao = out.indexOf(mensagens.reviewGitCalling("cat-file --batch"));

    assert.equal(codigo, 0);
    assert.deepEqual(err, []);
    assert.notEqual(posicao, -1);
    assert.equal(out[posicao + 1], mensagens.reviewGitCalled("cat-file --batch", true));
  });
}

function arquivadasComProvas() {
  const root = tempDir("mgr-arch-rev-");
  mkdirSync(path.join(root, "specs", "archive", "2026-01-15-x"), { recursive: true });
  writeFileSync(path.join(root, "specs", "archive", "2026-01-15-x", PROOF_FILE), JSON.stringify(provaCom(REVISAO), null, 2));
  mkdirSync(path.join(root, "specs", "archive", "2026-01-16-y"), { recursive: true });
  writeFileSync(path.join(root, "specs", "archive", "2026-01-16-y", PROOF_FILE), "lixo");
  return root;
}

for (const idioma of IDIOMAS) {
  test(`should list the archived features without the waiver mark when no proof ends in a waiver [${idioma}]`, () => {
    const mensagens = getMessages(idioma);
    const root = arquivadasComProvas();
    const { io, out, err } = coletor();

    assert.equal(specStatus({ root, cwd: root, flags: { archived: true }, positional: [], io, M: mensagens }), 0);
    assert.deepEqual(err, []);
    assert.deepEqual(
      [...out].sort(),
      [mensagens.specStatusArchivedLine("2026-01-15", "x"), mensagens.specStatusArchivedLine("2026-01-16", "y")].sort(),
    );
  });
}

test("should leave the externalReview key out of the JSON when no proof ends in a waiver", () => {
  const root = arquivadasComProvas();
  const { io, out, err } = coletor();

  assert.equal(specStatus({ root, cwd: root, flags: { archived: true, json: true }, positional: [], io, M: getMessages("en") }), 0);
  assert.deepEqual(err, []);
  const { archived } = JSON.parse(out[0]);
  assert.equal(archived.length, 2);
  for (const slug of ["x", "y"]) {
    assert.equal(Object.hasOwn(archived.find((entrada) => entrada.slug === slug), "externalReview"), false);
  }
});

for (const idioma of IDIOMAS) {
  test(`should refuse with the reason (4) when the proof is a directory and cannot be read [${idioma}]`, () => {
    const mensagens = getMessages(idioma);
    const root = montarFatia({});
    mkdirSync(path.join(root, "specs", "x", "external-review.json"));
    const { codigo, err } = arquivar({ root, idioma, reviewIo: reviewIoReal() });
    assert.equal(codigo, 1);
    assert.deepEqual(err, recusa(mensagens, mensagens.specArchiveReviewInvalid("EISDIR")));
  });
}
