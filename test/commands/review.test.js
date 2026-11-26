import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { review } from "../../src/commands/review.js";
import { createReviewIo } from "../../bin/review-io.js";
import { getMessages } from "../../src/core/messages.js";
import { GUIDE_PATH, PROOF_FILE, buildPrompt } from "../../src/sdd/external-review.js";
import { readExternalReview, readReviewConsent } from "../../src/plugins/registry.js";
import { get as reviewerOf } from "../../src/reviewers/index.js";
import { criarCodexFalso, envSemCodex, SESSAO_FALSA, VERSAO_FALSA } from "../helpers/codex-falso.js";
import { tempDir } from "../../scripts/lib/tmp.mjs";

const IDIOMAS = ["en", "pt-BR"];
const FICHA = reviewerOf("codex");
const FATIA = "x";
const SUBCOMANDOS = ["external", "status", "enable", "disable", "consent", "revoke", "set"];
const AGORA = "2026-11-26T10:00:00Z";
const DATA_DO_CONSENTIMENTO = "2026-11-26T10:00:00.000Z";
const GUIA = "**(SEC-4)** Never build a shell\ncommand line as text.\n";
const SPEC = "CA-1: must do it\n";
const RELATIVA_DA_PROVA = `specs/${FATIA}/${PROOF_FILE}`;
const OPCOES_CODEX = { codex: { model: "m1", effort: "e1" } };
const RESPOSTA_COM_ACHADOS = {
  specAxis: "reviewed",
  standards: [
    { rule: "SEC-4", quote: "Never build a shell command line as text.", violation: "concatena texto de shell", justification: "montagem por texto", fix: "usar argv", file: "b.js", line: 1 },
    { rule: "X-1", quote: "regra inventada", violation: "sem regra", justification: "j", fix: "f", file: "b.js", line: 1 },
  ],
  spec: [
    { source: "specs/x/03-spec.md", quote: "must do it", finding: "nao cobre", justification: "j", fix: "f", file: "b.js", line: 1 },
  ],
  suggestions: [{ text: "renomear a variavel" }],
};
const MODOS_DE_FALHA = [
  ["nao-logado", "not-logged-in"],
  ["falha", "reviewer-failed"],
  ["json-invalido", "response-invalid"],
  ["fora-do-schema", "response-invalid"],
  ["sem-o", "response-invalid"],
  ["sem-sessao", "session-missing"],
];
const DESLIGADAS = [
  ["off", { ligada: false }],
  ["without review config", { semRevisao: true }],
];

const git = (cwd, ...argumentos) => execFileSync("git", argumentos, { cwd, encoding: "utf8" });
const sha256 = (conteudo) => createHash("sha256").update(conteudo).digest("hex");
const pastaDaFatia = (root) => path.join(root, "specs", FATIA);
const caminhoDaProva = (root) => path.join(pastaDaFatia(root), PROOF_FILE);
const caminhoDoConfig = (core) => path.join(core, "config.json");
const lerSeExiste = (caminho) => (existsSync(caminho) ? readFileSync(caminho, "utf8") : undefined);
const lerProva = (root) => JSON.parse(readFileSync(caminhoDaProva(root), "utf8"));
const lerConfig = (core) => JSON.parse(readFileSync(caminhoDoConfig(core), "utf8"));
const contemPar = (argv, flag, valor) => argv.some((item, indice) => item === flag && argv[indice + 1] === valor);
const confirmacaoProibida = async () => {
  throw new Error("confirm nao deveria ser chamado neste caso");
};
const agora = () => new Date(AGORA);

function montarProjeto({ ligada = true, consentimento = true, options, semRevisao = false } = {}) {
  const root = tempDir("mgr-review-projeto-");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "teste@example.invalid");
  git(root, "config", "user.name", "teste");
  mkdirSync(path.join(root, "docs", "sdd"), { recursive: true });
  writeFileSync(path.join(root, GUIDE_PATH), GUIA);
  writeFileSync(path.join(root, ".gitignore"), "specs/\n.mgr-core/\n");
  writeFileSync(path.join(root, "a.js"), "x\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  writeFileSync(path.join(root, "b.js"), "y\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "feat");
  const core = path.join(root, ".mgr-core");
  mkdirSync(core, { recursive: true });
  mkdirSync(pastaDaFatia(root), { recursive: true });
  writeFileSync(path.join(pastaDaFatia(root), "03-spec.md"), SPEC);
  const configuracao = semRevisao
    ? {}
    : { externalReview: { enabled: ligada, reviewers: [FICHA.id], ...(options === undefined ? {} : { options }) } };
  writeFileSync(caminhoDoConfig(core), JSON.stringify(configuracao));
  if (consentimento) {
    writeFileSync(path.join(core, "config.local.json"), JSON.stringify({ externalReviewConsent: { codex: { at: DATA_DO_CONSENTIMENTO } } }));
  }
  return { root, core };
}

function cenario({ modo = "ok", resposta, env, ...projeto } = {}) {
  const montado = montarProjeto(projeto);
  const falso = criarCodexFalso(modo, { resposta });
  const tmpRoot = tempDir("mgr-review-tmp-");
  const reviewIo = createReviewIo({ env: env ?? falso.env, tmpRoot });
  return { ...montado, falso, reviewIo, tmpRoot };
}

function ambienteDe({ root, idioma = "pt-BR", reviewIo, confirm = confirmacaoProibida }) {
  const out = [];
  const err = [];
  const io = {
    out: (linha) => out.push(linha),
    err: (linha) => err.push(linha),
    style: { yellow: (texto) => texto },
  };
  const mensagens = getMessages(idioma);
  const executar = (positional, flags = {}) => review({
    root, positional, flags, io, M: mensagens, reviewIo, confirm, language: idioma, now: agora,
  });
  return { out, err, mensagens, executar };
}

async function recusada({ idioma, projeto = {}, preparar = () => {}, flags, linha }) {
  const { root, reviewIo, falso } = cenario(projeto);
  preparar(root);
  const provaAntes = lerSeExiste(caminhoDaProva(root));
  const amb = ambienteDe({ root, idioma, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], flags), 1);
  assert.deepEqual(amb.err, [amb.mensagens.errorPrefix(linha(amb.mensagens))]);
  assert.deepEqual(falso.chamadas(), []);
  assert.equal(lerSeExiste(caminhoDaProva(root)), provaAntes);
}

for (const idioma of IDIOMAS) {
  test(`should refuse a review with no subcommand and list the valid ones (${idioma})`, async () => {
    const root = tempDir("mgr-review-vazio-");
    const amb = ambienteDe({ root, idioma });
    assert.equal(await amb.executar([]), 1);
    assert.deepEqual(amb.err, [amb.mensagens.errorPrefix(amb.mensagens.reviewNeedsSub(SUBCOMANDOS))]);
  });

  test(`should refuse an unknown subcommand and name it (${idioma})`, async () => {
    const root = tempDir("mgr-review-vazio-");
    const amb = ambienteDe({ root, idioma });
    assert.equal(await amb.executar(["sumir"]), 1);
    assert.deepEqual(amb.err, [amb.mensagens.errorPrefix(amb.mensagens.unknownCommand("review sumir"))]);
  });

  test(`should refuse an external review without a feature slug and call no reviewer (${idioma})`, async () => {
    const { root, reviewIo, falso } = cenario();
    const amb = ambienteDe({ root, idioma, reviewIo });
    assert.equal(await amb.executar(["external"], { base: "HEAD~1" }), 1);
    assert.deepEqual(amb.err, [amb.mensagens.errorPrefix(amb.mensagens.reviewNeedsSlug)]);
    assert.deepEqual(falso.chamadas(), []);
  });

  test(`should refuse an external review of a feature that does not exist (${idioma})`, async () => {
    const { root, reviewIo, falso } = cenario();
    const amb = ambienteDe({ root, idioma, reviewIo });
    assert.equal(await amb.executar(["external", "nao-existe"], { base: "HEAD~1" }), 1);
    assert.deepEqual(amb.err, [amb.mensagens.errorPrefix(amb.mensagens.reviewSliceNotFound("nao-existe"))]);
    assert.deepEqual(falso.chamadas(), []);
  });

  for (const [descricao, projeto] of DESLIGADAS) {
    test(`should refuse an external review when review is ${descricao} and write no proof (${idioma})`, async () => {
      const { root, reviewIo, falso } = cenario(projeto);
      const amb = ambienteDe({ root, idioma, reviewIo });
      assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 1);
      assert.deepEqual(amb.err, [amb.mensagens.errorPrefix(amb.mensagens.reviewDisabled)]);
      assert.deepEqual(falso.chamadas(), []);
      assert.equal(existsSync(caminhoDaProva(root)), false);
    });
  }

  test(`should refuse an external review without the person's consent and call no reviewer (${idioma})`, async () => {
    const { root, reviewIo, falso } = cenario({ consentimento: false });
    const amb = ambienteDe({ root, idioma, reviewIo });
    assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 1);
    assert.deepEqual(amb.err, [amb.mensagens.errorPrefix(amb.mensagens.reviewNoConsent(FICHA.id, FICHA.provider))]);
    assert.deepEqual(falso.chamadas(), []);
  });

  test(`should refuse a reviewer that is not configured in the project (${idioma})`, async () => {
    const { root, reviewIo, falso } = cenario();
    const amb = ambienteDe({ root, idioma, reviewIo });
    assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1", reviewer: "outro" }), 1);
    assert.deepEqual(amb.err, [amb.mensagens.errorPrefix(amb.mensagens.reviewReviewerNotConfigured("outro", [FICHA.id]))]);
    assert.deepEqual(falso.chamadas(), []);
  });

  test(`should refuse an external review without --base (${idioma})`, async () => {
    await recusada({ idioma, flags: {}, linha: (mensagens) => mensagens.reviewNeedsBase });
  });

  test(`should refuse an external review whose --base is not a commit (${idioma})`, async () => {
    await recusada({
      idioma,
      flags: { base: "nao-existe" },
      linha: (mensagens) => mensagens.reviewBaseUnknown("nao-existe"),
    });
  });

  test(`should refuse an external review with an uncommitted file outside specs and name it (${idioma})`, async () => {
    await recusada({
      idioma,
      preparar: (root) => writeFileSync(path.join(root, "novo.js"), "z\n"),
      flags: { base: "HEAD~1" },
      linha: (mensagens) => mensagens.reviewDirty(["novo.js"]),
    });
  });

  test(`should refuse an external review when the base is HEAD and the diff is empty (${idioma})`, async () => {
    await recusada({
      idioma,
      flags: { base: "HEAD" },
      linha: (mensagens) => mensagens.reviewEmptyDiff("HEAD"),
    });
  });

  test(`should refuse to overwrite an unreadable proof and leave it as it was (${idioma})`, async () => {
    await recusada({
      idioma,
      preparar: (root) => writeFileSync(caminhoDaProva(root), "lixo"),
      flags: { base: "HEAD~1" },
      linha: (mensagens) => mensagens.reviewProofUnreadable(RELATIVA_DA_PROVA, "json"),
    });
  });

  test(`should record a failure only when the reviewer is not installed (${idioma})`, async () => {
    const { root, reviewIo } = cenario({ env: envSemCodex() });
    const amb = ambienteDe({ root, idioma, reviewIo });
    assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 1);
    assert.deepEqual(amb.err, [
      amb.mensagens.errorPrefix(amb.mensagens.reviewNotInstalled(FICHA.id, FICHA.binary)),
      amb.mensagens.reviewFailureRecorded(RELATIVA_DA_PROVA),
    ]);
    const prova = lerProva(root);
    assert.deepEqual(prova.entries.map((entrada) => entrada.kind), ["failure"]);
    assert.equal(prova.entries[0].code, "not-installed");
  });

  test(`should record a review with the findings, the file hashes and the citations checked (${idioma})`, async () => {
    const { root, reviewIo } = cenario({ resposta: RESPOSTA_COM_ACHADOS });
    const amb = ambienteDe({ root, idioma, reviewIo });
    assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 0);
    const { mensagens } = amb;
    assert.ok(amb.out.includes(mensagens.reviewWritten(RELATIVA_DA_PROVA, 1)));
    assert.ok(amb.out.includes(mensagens.reviewFindingStandards("R1-S1", "SEC-4", "b.js", 1)));
    assert.ok(amb.out.includes(mensagens.reviewFindingSpec("R1-P1", "specs/x/03-spec.md", "b.js", 1)));
    assert.ok(amb.out.includes(mensagens.reviewSuggestion("renomear a variavel")));
    assert.ok(amb.out.includes(mensagens.reviewDemoted("b.js:1 sem regra", "rule-not-in-guide")));
    assert.ok(amb.out.includes(mensagens.reviewSummary(1, 1, 2)));
    const prova = lerProva(root);
    assert.equal(prova.entries.length, 1);
    const [entrada] = prova.entries;
    assert.equal(entrada.kind, "review");
    assert.equal(entrada.round, 1);
    assert.equal(entrada.reviewer, FICHA.id);
    assert.equal(entrada.version, VERSAO_FALSA);
    assert.equal(entrada.session, SESSAO_FALSA);
    assert.equal(entrada.language, idioma);
    assert.equal(entrada.at, DATA_DO_CONSENTIMENTO);
    assert.deepEqual(entrada.files, [
      { path: "b.js", state: "present", sha256: sha256(git(root, "show", "HEAD:b.js")) },
    ]);
    assert.equal(entrada.findings.standards[0].id, "R1-S1");
    assert.equal(entrada.findings.spec[0].id, "R1-P1");
    assert.deepEqual(entrada.suggestions, [
      { text: "renomear a variavel" },
      { text: "b.js:1 sem regra", demotedFrom: "standards", reason: "rule-not-in-guide", rule: "X-1", quote: "regra inventada" },
    ]);
  });

  test(`should append round 2 keeping round 1, and warn past the two rounds of the flow (${idioma})`, async () => {
    const { root, reviewIo } = cenario();
    const amb = ambienteDe({ root, idioma, reviewIo });
    const flags = { base: "HEAD~1" };
    assert.equal(await amb.executar(["external", FATIA], flags), 0);
    const primeira = lerProva(root).entries[0];
    assert.equal(await amb.executar(["external", FATIA], flags), 0);
    const entradas = lerProva(root).entries;
    assert.equal(entradas.length, 2);
    assert.deepEqual(entradas[0], primeira);
    assert.equal(entradas[1].round, 2);
    assert.equal(await amb.executar(["external", FATIA], flags), 0);
    assert.ok(amb.out.includes(amb.mensagens.reviewRoundBeyondFlow(3)));
  });

  test(`should decline enable on a no, write nothing and say so (${idioma})`, async () => {
    const { root, core } = montarProjeto({ semRevisao: true, consentimento: false });
    const amb = ambienteDe({ root, idioma, confirm: async () => ({ state: "no" }) });
    assert.equal(await amb.executar(["enable"], {}), 1);
    assert.deepEqual(amb.err, [amb.mensagens.reviewDeclined]);
    assert.equal(Object.hasOwn(lerConfig(core), "externalReview"), false);
  });

  test(`should refuse enable without a person at the terminal and write nothing (${idioma})`, async () => {
    const { root, core } = montarProjeto({ semRevisao: true, consentimento: false });
    const amb = ambienteDe({ root, idioma, confirm: async () => ({ state: "no-tty" }) });
    assert.equal(await amb.executar(["enable"], {}), 1);
    assert.deepEqual(amb.err, [amb.mensagens.errorPrefix(amb.mensagens.reviewNeedsTty("enable"))]);
    assert.equal(Object.hasOwn(lerConfig(core), "externalReview"), false);
  });

  test(`should turn review on after a yes, print its effects and the consent hint (${idioma})`, async () => {
    const { root, core } = montarProjeto({ semRevisao: true, consentimento: false });
    const amb = ambienteDe({ root, idioma, confirm: async () => ({ state: "yes" }) });
    assert.equal(await amb.executar(["enable"], {}), 0);
    const config = readExternalReview(core);
    assert.equal(config.state, "configured");
    assert.equal(config.enabled, true);
    assert.deepEqual(config.reviewers, [FICHA.id]);
    const efeitos = amb.mensagens.reviewEnableEffects(FICHA.provider);
    assert.deepEqual(amb.out.slice(0, efeitos.length), efeitos);
    assert.ok(amb.out.includes(amb.mensagens.reviewEnabledWritten([FICHA.id])));
    assert.ok(amb.out.includes(amb.mensagens.reviewEnableConsentHint(FICHA.id)));
  });

  test(`should turn review off after disable, keeping the reviewers and the options (${idioma})`, async () => {
    const { root, core } = montarProjeto({ ligada: true, options: OPCOES_CODEX });
    const amb = ambienteDe({ root, idioma });
    assert.equal(await amb.executar(["disable"], {}), 0);
    const config = readExternalReview(core);
    assert.equal(config.enabled, false);
    assert.deepEqual(config.reviewers, [FICHA.id]);
    assert.deepEqual(config.options, OPCOES_CODEX);
    assert.ok(amb.out.includes(amb.mensagens.reviewDisabledWritten));
    assert.ok(amb.out.includes(amb.mensagens.reviewDisableEffect));
  });

  test(`should report that review is already off and leave the config byte for byte (${idioma})`, async () => {
    const { root, core } = montarProjeto({ ligada: false, options: OPCOES_CODEX });
    const antes = readFileSync(caminhoDoConfig(core), "utf8");
    const amb = ambienteDe({ root, idioma });
    assert.equal(await amb.executar(["disable"], {}), 0);
    assert.ok(amb.out.includes(amb.mensagens.reviewAlreadyOff));
    assert.equal(readFileSync(caminhoDoConfig(core), "utf8"), antes);
  });

  test(`should record consent in the personal layer with the clock date after a yes (${idioma})`, async () => {
    const { root, core } = montarProjeto({ semRevisao: true, consentimento: false });
    const amb = ambienteDe({ root, idioma, confirm: async () => ({ state: "yes" }) });
    assert.equal(await amb.executar(["consent"], {}), 0);
    assert.deepEqual(readReviewConsent(core, FICHA.id), { state: "given", at: DATA_DO_CONSENTIMENTO });
    assert.equal(Object.hasOwn(lerConfig(core), "externalReviewConsent"), false);
    const efeitos = amb.mensagens.reviewConsentEffects(FICHA.provider);
    assert.deepEqual(amb.out.slice(0, efeitos.length), efeitos);
    assert.ok(amb.out.includes(amb.mensagens.reviewConsentWritten(FICHA.id)));
  });

  test(`should refuse consent without a person at the terminal and record nothing (${idioma})`, async () => {
    const { root, core } = montarProjeto({ semRevisao: true, consentimento: false });
    const amb = ambienteDe({ root, idioma, confirm: async () => ({ state: "no-tty" }) });
    assert.equal(await amb.executar(["consent"], {}), 1);
    assert.deepEqual(amb.err, [amb.mensagens.errorPrefix(amb.mensagens.reviewNeedsTty("consent"))]);
    assert.equal(readReviewConsent(core, FICHA.id).state, "absent");
  });

  test(`should revoke a given consent and remove it from the personal layer (${idioma})`, async () => {
    const { root, core } = montarProjeto({ consentimento: true });
    const amb = ambienteDe({ root, idioma });
    assert.equal(await amb.executar(["revoke"], {}), 0);
    assert.equal(readReviewConsent(core, FICHA.id).state, "absent");
    assert.ok(amb.out.includes(amb.mensagens.reviewConsentRevoked(FICHA.id)));
  });

  test(`should report that there is no consent to revoke and write nothing (${idioma})`, async () => {
    const { root, core } = montarProjeto({ consentimento: false });
    const amb = ambienteDe({ root, idioma });
    assert.equal(await amb.executar(["revoke"], {}), 0);
    assert.ok(amb.out.includes(amb.mensagens.reviewConsentAlreadyAbsent(FICHA.id)));
    assert.equal(readReviewConsent(core, FICHA.id).state, "absent");
  });

  test(`should refuse set without --model or --effort (${idioma})`, async () => {
    const { root } = montarProjeto({ semRevisao: true });
    const amb = ambienteDe({ root, idioma });
    assert.equal(await amb.executar(["set"], {}), 1);
    assert.deepEqual(amb.err, [amb.mensagens.errorPrefix(amb.mensagens.reviewSetNeedsValue)]);
  });

  test(`should write the model of the reviewer and leave review off when it was not on (${idioma})`, async () => {
    const { root, core } = montarProjeto({ semRevisao: true });
    const amb = ambienteDe({ root, idioma });
    assert.equal(await amb.executar(["set"], { model: "m2" }), 0);
    const config = readExternalReview(core);
    assert.equal(config.state, "configured");
    assert.equal(config.enabled, false);
    assert.deepEqual(config.reviewers, [FICHA.id]);
    assert.deepEqual(config.options, { codex: { model: "m2" } });
    assert.ok(amb.out.includes(amb.mensagens.reviewOptionsWritten(FICHA.id, "m2", amb.mensagens.reviewDefaultValue)));
  });

  test(`should print the status as off by default with consent absent (${idioma})`, async () => {
    const { root } = montarProjeto({ semRevisao: true, consentimento: false });
    const amb = ambienteDe({ root, idioma });
    assert.equal(await amb.executar(["status"], {}), 0);
    assert.deepEqual(amb.out, [
      amb.mensagens.reviewStatusLine("off", "default"),
      amb.mensagens.reviewStatusConsent(FICHA.id, "absent"),
    ]);
  });

  test(`should print the status as on from the project config with consent given (${idioma})`, async () => {
    const { root } = montarProjeto({ ligada: true, consentimento: true });
    const amb = ambienteDe({ root, idioma });
    assert.equal(await amb.executar(["status"], {}), 0);
    assert.deepEqual(amb.out, [
      amb.mensagens.reviewStatusLine("on", "configured"),
      amb.mensagens.reviewStatusReviewers([FICHA.id]),
      amb.mensagens.reviewStatusOptions(FICHA.id, amb.mensagens.reviewDefaultValue, amb.mensagens.reviewDefaultValue),
      amb.mensagens.reviewStatusConsent(FICHA.id, "given"),
    ]);
  });
}

for (const [modo, codigo] of MODOS_DE_FALHA) {
  test(`should record only a failure with code ${codigo} when the reviewer mode is ${modo}`, async () => {
    const { root, reviewIo } = cenario({ modo });
    const amb = ambienteDe({ root, reviewIo });
    assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 1);
    const prova = lerProva(root);
    assert.deepEqual(prova.entries.map((entrada) => entrada.kind), ["failure"]);
    assert.equal(prova.entries[0].code, codigo);
  });
}

for (const idioma of IDIOMAS) {
  test(`should show the reviewer's login answer when it is not logged in (${idioma})`, async () => {
    const { root, reviewIo } = cenario({ modo: "nao-logado" });
    const amb = ambienteDe({ root, idioma, reviewIo });
    assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 1);
    assert.deepEqual(amb.err, [
      amb.mensagens.errorPrefix(amb.mensagens.reviewNotLoggedIn(FICHA.id, "Not logged in")),
      amb.mensagens.reviewFailureRecorded(RELATIVA_DA_PROVA),
    ]);
  });

  test(`should show the reviewer's own message when it fails (${idioma})`, async () => {
    const { root, reviewIo } = cenario({ modo: "falha" });
    const amb = ambienteDe({ root, idioma, reviewIo });
    assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 1);
    assert.deepEqual(amb.err, [
      amb.mensagens.errorPrefix(amb.mensagens.reviewFailed(FICHA.id, 2, "erro do revisor: limite atingido\n")),
      amb.mensagens.reviewFailureRecorded(RELATIVA_DA_PROVA),
    ]);
  });
}

test("should not refuse a dirty spec, because specs are outside the reviewed files", async () => {
  const { root, reviewIo, falso } = cenario();
  git(root, "add", "-f", `specs/${FATIA}/03-spec.md`);
  git(root, "commit", "-qm", "spec");
  writeFileSync(path.join(pastaDaFatia(root), "03-spec.md"), "CA-1: must do it\nCA-2: outro\n");
  const amb = ambienteDe({ root, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~2" }), 0);
  assert.deepEqual(amb.err, []);
  assert.ok(falso.chamadas().length > 0);
});

test("should pass model and effort as separate argv elements and record them", async () => {
  const { root, reviewIo, falso } = cenario({ options: OPCOES_CODEX });
  const amb = ambienteDe({ root, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 0);
  const argv = falso.chamadas().at(-1);
  assert.ok(contemPar(argv, "-m", "m1"));
  assert.ok(contemPar(argv, "-c", "model_reasoning_effort=e1"));
  const [entrada] = lerProva(root).entries;
  assert.equal(entrada.model, "m1");
  assert.equal(entrada.effort, "e1");
});

test("should send neither model nor effort and record neither when the project chose none", async () => {
  const { root, reviewIo, falso } = cenario();
  const amb = ambienteDe({ root, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 0);
  const argv = falso.chamadas().at(-1);
  assert.equal(argv.includes("-m"), false);
  assert.equal(argv.some((item) => item.startsWith("model_reasoning_effort=")), false);
  const [entrada] = lerProva(root).entries;
  assert.equal(Object.hasOwn(entrada, "model"), false);
  assert.equal(Object.hasOwn(entrada, "effort"), false);
});

test("should record only a failure when the reviewer refuses the reasoning effort", async () => {
  const { root, reviewIo } = cenario({ modo: "recusa-esforco", options: { codex: { effort: "e1" } } });
  const amb = ambienteDe({ root, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 1);
  assert.ok(amb.err.some((linha) => linha.includes("unsupported reasoning effort")));
  const prova = lerProva(root);
  assert.deepEqual(prova.entries.map((entrada) => entrada.kind), ["failure"]);
});

test("should record a file the feature deleted as deleted in the proof", async () => {
  const { root, reviewIo } = cenario();
  git(root, "rm", "-q", "a.js");
  git(root, "commit", "-qm", "remove a");
  const amb = ambienteDe({ root, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~2" }), 0, amb.err.join("\n"));
  assert.deepEqual(lerProva(root).entries[0].files, [
    { path: "a.js", state: "deleted" },
    { path: "b.js", state: "present", sha256: sha256("y\n") },
  ]);
});

test("should record a reviewer failure when the reviewer cannot report its version", async () => {
  const { root, reviewIo } = cenario({ modo: "sem-versao" });
  const amb = ambienteDe({ root, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 1);
  assert.ok(amb.err.some((linha) => linha.includes("versao indisponivel")));
  assert.deepEqual(lerProva(root).entries.map(({ kind, code }) => [kind, code]), [["failure", "reviewer-failed"]]);
});

test("should record a reviewer failure when the reviewer binary cannot start", async () => {
  const { root, reviewIo } = cenario({ modo: "sem-permissao" });
  const amb = ambienteDe({ root, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 1);
  assert.ok(amb.err[0].startsWith(amb.mensagens.errorPrefix(amb.mensagens.reviewFailed("codex", "failed-to-start (EACCES)", ""))));
  assert.deepEqual(lerProva(root).entries.map(({ kind, code }) => [kind, code]), [["failure", "reviewer-failed"]]);
});

test("should refuse an external review of an archived feature and call no reviewer", async () => {
  const { root, reviewIo, falso } = cenario();
  mkdirSync(path.join(root, "specs", "archive", `2026-01-01-${FATIA}`), { recursive: true });
  rmSync(pastaDaFatia(root), { recursive: true });
  const amb = ambienteDe({ root, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 1);
  assert.deepEqual(amb.err, [amb.mensagens.errorPrefix(amb.mensagens.reviewSliceArchived(FATIA))]);
  assert.deepEqual(falso.chamadas(), []);
});

test("should refuse an external review outside a git repository and call no reviewer", async () => {
  const { root, reviewIo, falso } = cenario();
  rmSync(path.join(root, ".git"), { recursive: true });
  const amb = ambienteDe({ root, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 1);
  assert.deepEqual(amb.err, [amb.mensagens.errorPrefix(amb.mensagens.reviewNotGitRepo)]);
  assert.deepEqual(falso.chamadas(), []);
});

test("should refuse a --base that starts with a dash as an unknown commit", async () => {
  const { root, reviewIo, falso } = cenario();
  const amb = ambienteDe({ root, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], { base: "--output=x" }), 1);
  assert.deepEqual(amb.err, [amb.mensagens.errorPrefix(amb.mensagens.reviewBaseUnknown("--output=x"))]);
  assert.deepEqual(falso.chamadas(), []);
});

test("should demote every standards finding when the project has no review guide", async () => {
  const resposta = { specAxis: "abstained", standards: [{ rule: "SEC-4", quote: "Never build a shell command line as text.", violation: "v", justification: "j", fix: "f", file: "b.js", line: 1 }], spec: [], suggestions: [] };
  const { root, reviewIo } = cenario({ resposta });
  git(root, "rm", "-q", GUIDE_PATH);
  git(root, "commit", "-qm", "sem guia");
  const amb = ambienteDe({ root, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~2" }), 0, amb.err.join("\n"));
  const entrada = lerProva(root).entries[0];
  assert.deepEqual(entrada.findings, { standards: [], spec: [] });
  assert.deepEqual(entrada.suggestions.map(({ reason }) => reason), ["no-guide"]);
  assert.ok(amb.out.includes(amb.mensagens.reviewSpecAbstained));
});

test("should accept the configured reviewer when it is named with --reviewer", async () => {
  const { root, reviewIo, falso } = cenario();
  const amb = ambienteDe({ root, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1", reviewer: "codex" }), 0, amb.err.join("\n"));
  assert.equal(falso.chamadas().length, 3);
});

for (const sub of ["enable", "consent", "revoke", "set"]) {
  test(`should refuse review ${sub} for a reviewer that does not exist and write nothing`, async () => {
    const { root, core } = montarProjeto({ ligada: false, consentimento: false });
    const configAntes = readFileSync(caminhoDoConfig(core), "utf8");
    const amb = ambienteDe({ root, confirm: async () => ({ state: "yes" }) });
    assert.equal(await amb.executar([sub], { reviewer: "gemini", model: "m1" }), 1);
    assert.deepEqual(amb.err, [amb.mensagens.errorPrefix(amb.mensagens.reviewReviewerNotConfigured("gemini", ["codex"]))]);
    assert.equal(readFileSync(caminhoDoConfig(core), "utf8"), configAntes);
    assert.equal(existsSync(path.join(core, "config.local.json")), false);
  });
}

test("should keep the model and show the reviewer default effort when only the model is set", async () => {
  const { root, core } = montarProjeto({ options: { codex: { model: "m1" } } });
  const amb = ambienteDe({ root });
  assert.equal(await amb.executar(["set"], { effort: "high" }), 0);
  assert.deepEqual(lerConfig(core).externalReview.options.codex, { model: "m1", effort: "high" });
  assert.ok(amb.out.includes(amb.mensagens.reviewOptionsWritten("codex", "m1", "high")));
});

test("should record the consent with the current time when no clock is injected", async () => {
  const { root, core } = montarProjeto({ consentimento: false });
  const antes = Date.now();
  const out = [];
  const io = { out: (linha) => out.push(linha), err: (linha) => out.push(linha), style: { yellow: (texto) => texto } };
  const codigo = await review({ root, positional: ["consent"], flags: {}, io, M: getMessages("en"), confirm: async () => ({ state: "yes" }), language: "en" });
  assert.equal(codigo, 0);
  const gravado = Date.parse(JSON.parse(readFileSync(path.join(core, "config.local.json"), "utf8")).externalReviewConsent.codex.at);
  assert.ok(gravado >= antes && gravado <= Date.now());
});

test("should show the error events of the reviewer stream when exec fails with only a notice on stderr", async () => {
  const { root, reviewIo } = cenario({ modo: "falha-no-fluxo" });
  const amb = ambienteDe({ root, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 1);
  const saida = amb.err.join("\n");
  assert.ok(saida.includes("Reading additional input from stdin..."));
  assert.ok(saida.includes("{\"type\":\"error\",\"message\":\"modelo desconhecido\"}"));
  assert.ok(saida.includes("\"type\":\"turn.failed\""));
  assert.deepEqual(lerProva(root).entries.map(({ kind, code }) => [kind, code]), [["failure", "reviewer-failed"]]);
});

test("should send exactly the argv of the reviewer sheet to the fake codex", async () => {
  const { root, reviewIo, falso, tmpRoot } = cenario();
  const amb = ambienteDe({ root, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 0, amb.err.join("\n"));
  const enviado = falso.chamadas().at(-1);
  const prompt = buildPrompt({
    slug: FATIA, base: git(root, "rev-parse", "HEAD~1").trim(), files: ["b.js"], specSources: [`specs/${FATIA}/03-spec.md`], language: "pt-BR",
  });
  assert.deepEqual(enviado, FICHA.execArgv({ repo: root, schemaFile: enviado[4], lastMessageFile: enviado[6], prompt }));
  assert.ok(enviado[4].startsWith(tmpRoot) && enviado[6].startsWith(tmpRoot));
});

test("should log a line before and after every git and reviewer call", async () => {
  const { root, reviewIo } = cenario();
  const amb = ambienteDe({ root, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 0, amb.err.join("\n"));
  const linhas = amb.out;
  for (const etapa of ["--version", "login status", "exec"]) {
    const antes = linhas.indexOf(amb.mensagens.reviewCalling("codex", etapa));
    assert.ok(antes >= 0, etapa);
    assert.equal(linhas[antes + 1], amb.mensagens.reviewCalled("codex", etapa, "0"));
  }
  for (const etapa of ["rev-parse --is-inside-work-tree", "rev-parse --verify", "rev-parse HEAD", "status --porcelain", "diff --name-only", "cat-file --batch"]) {
    const antes = linhas.indexOf(amb.mensagens.reviewGitCalling(etapa));
    assert.ok(antes >= 0, etapa);
    assert.equal(linhas[antes + 1], amb.mensagens.reviewGitCalled(etapa, true), etapa);
  }
});

for (const [modo, campo] of [["json-invalido", "json"], ["fora-do-schema", "$.specAxis"], ["sem-o", "output-last-message"]]) {
  test(`should name the field ${campo} when the reviewer answers outside the format in mode ${modo}`, async () => {
    const { root, reviewIo } = cenario({ modo });
    const amb = ambienteDe({ root, reviewIo });
    assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 1);
    assert.equal(amb.err[0], amb.mensagens.errorPrefix(amb.mensagens.reviewResponseInvalid("codex", campo)));
  });
}

test("should record nothing when the working tree changes while the reviewer runs", async () => {
  const { root, reviewIo } = cenario({ modo: "suja-a-arvore" });
  const amb = ambienteDe({ root, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 1);
  assert.deepEqual(amb.err, [amb.mensagens.errorPrefix(amb.mensagens.reviewChangedDuringReview)]);
  assert.equal(existsSync(caminhoDaProva(root)), false);
});

test("should refuse a reviewed file name with a line break and call no reviewer", async () => {
  const { root, reviewIo, falso } = cenario();
  writeFileSync(path.join(root, "a\nb.js"), "z\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "nome com quebra");
  const amb = ambienteDe({ root, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~2" }), 1);
  assert.deepEqual(amb.err, [amb.mensagens.errorPrefix(amb.mensagens.reviewPathWithNewline([JSON.stringify("a\nb.js")]))]);
  assert.deepEqual(falso.chamadas(), []);
});

test("should write nothing when the person declines the consent", async () => {
  const { root, core } = montarProjeto({ consentimento: false });
  const amb = ambienteDe({ root, confirm: async () => ({ state: "no" }) });
  assert.equal(await amb.executar(["consent"]), 1);
  assert.deepEqual(amb.err, [amb.mensagens.reviewDeclined]);
  assert.equal(existsSync(path.join(core, "config.local.json")), false);
});

test("should print the review state as JSON with enabled as a boolean", async () => {
  const { root } = montarProjeto();
  const amb = ambienteDe({ root });
  assert.equal(await amb.executar(["status"], { json: true }), 0);
  assert.deepEqual(JSON.parse(amb.out[0]), {
    schemaVersion: 1, enabled: true, source: "configured", reviewers: ["codex"], options: {}, consent: { codex: "given" },
  });
});

test("should record a file that became a directory as deleted in the proof", async () => {
  const { root, reviewIo } = cenario();
  git(root, "rm", "-q", "a.js");
  mkdirSync(path.join(root, "a.js"));
  writeFileSync(path.join(root, "a.js", "dentro.js"), "w\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "arquivo vira pasta");
  const amb = ambienteDe({ root, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~2" }), 0, amb.err.join("\n"));
  assert.deepEqual(lerProva(root).entries[0].files, [
    { path: "a.js", state: "deleted" },
    { path: "a.js/dentro.js", state: "present", sha256: sha256("w\n") },
    { path: "b.js", state: "present", sha256: sha256("y\n") },
  ]);
});

test("should warn past the two rounds of the flow before calling the reviewer, even when the call fails", async () => {
  const { root, reviewIo } = cenario();
  const amb = ambienteDe({ root, reviewIo });
  assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 0);
  assert.equal(await amb.executar(["external", FATIA], { base: "HEAD~1" }), 0);
  const falha = criarCodexFalso("falha");
  const terceira = ambienteDe({ root, reviewIo: createReviewIo({ env: falha.env, tmpRoot: tempDir("mgr-review-tmp-") }) });
  assert.equal(await terceira.executar(["external", FATIA], { base: "HEAD~1" }), 1);
  const aviso = terceira.out.indexOf(terceira.mensagens.reviewRoundBeyondFlow(3));
  assert.ok(aviso >= 0);
  assert.ok(aviso < terceira.out.indexOf(terceira.mensagens.reviewCalling("codex", "--version")));
});
