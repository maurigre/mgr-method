import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
