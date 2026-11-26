// Cola do comando `mgr review` (spec da fatia revisor-externo, DT-9, DT-10, DT-12 e DT-17). Humble
// Object: só parse, formatação, log e exit code. A decisão e a prova vivem em `src/sdd/review-run.js` e
// `src/sdd/external-review.js` (gate R1, INV-5), a config em
// `src/plugins/registry.js`, a ficha em `src/reviewers/` e o processo em `bin/review-io.js`, que chega
// injetado (`reviewIo`), como a confirmação humana (`confirm`), no padrão de `src/install/prompts.js`.
//
// Falha alto: todo caso de recusa ou de falha tem motivo próprio e sai 1; nenhuma falha grava prova
// (as falhas do REVISOR gravam só uma entrada `failure`, que não é prova). Sucesso sai 0 com ou sem
// achado: o exit diz "a revisão aconteceu", não "o código está conforme" (CHECKPOINT 2, P-13).
import path from "node:path";
import * as installer from "../install/installer.js";
import { LOCAL_CONFIG_NAME, readExternalReview, readReviewConsent, removeReviewConsent, writeExternalReview,
  writeReviewConsent, writeReviewerOptions } from "../plugins/registry.js";
import { get as reviewerOf, ids as reviewerIds } from "../reviewers/index.js";
import { RESPONSE_SCHEMA, REVIEW_REASONS } from "../sdd/external-review.js";
import { appendToProof, chooseReviewer, isEnabled, failureEntry, judgeCall, judgeExec, judgeLogin, judgeVersion, planReview,
  proofFileOf, promptFor, reviewEntry, unchangedSince } from "../sdd/review-run.js";

const CONFIG_NAME = "config.json";
const COMANDO = "review";
const SUBCOMANDOS = ["external", "status", "enable", "disable", "consent", "revoke", "set"];

export async function review(contexto) {
  const { positional, io, M } = contexto;
  const sub = positional[0];
  if (!SUBCOMANDOS.includes(sub)) {
    if (sub !== undefined) io.err(M.errorPrefix(M.unknownCommand(`${COMANDO} ${sub}`)));
    else io.err(M.errorPrefix(M.reviewNeedsSub(SUBCOMANDOS)));
    return 1;
  }
  const resto = { now: () => new Date(), ...contexto, positional: positional.slice(1), core: installer.coreDir("project", contexto.root) };
  if (sub === "status") return reviewStatus(resto);
  if (sub === "enable") return reviewEnable(resto);
  if (sub === "disable") return reviewDisable(resto);
  if (sub === "consent") return reviewConsent(resto);
  if (sub === "revoke") return reviewRevoke(resto);
  if (sub === "set") return reviewSet(resto);
  return reviewExternal(resto);
}


function recusaDoRevisor(escolha, io, M) {
  const linha = escolha.code === REVIEW_REASONS.reviewerAmbiguous
    ? M.reviewReviewerAmbiguous(escolha.ids)
    : M.reviewReviewerNotConfigured(escolha.id, escolha.ids);
  io.err(M.errorPrefix(linha));
  return 1;
}

function reviewStatus({ core, flags, io, M }) {
  const config = readExternalReview(core);
  const estado = isEnabled(config) ? "on" : "off";
  const origem = config.state === "configured" ? "configured" : "default";
  const revisores = config.state === "configured" ? config.reviewers : [];
  const opcoes = config.state === "configured" ? config.options : {};
  const consentimento = Object.fromEntries(reviewerIds().map((id) => [id, readReviewConsent(core, id).state]));
  if (flags.json) {
    io.out(JSON.stringify({ schemaVersion: 1, enabled: estado === "on", source: origem, reviewers: revisores, options: opcoes, consent: consentimento }));
    return 0;
  }
  io.out(M.reviewStatusLine(estado, origem));
  if (revisores.length) io.out(M.reviewStatusReviewers(revisores));
  for (const id of revisores) {
    const { model, effort } = opcoes[id] ?? {};
    io.out(M.reviewStatusOptions(id, model ?? M.reviewDefaultValue, effort ?? M.reviewDefaultValue));
  }
  for (const [id, valor] of Object.entries(consentimento)) io.out(M.reviewStatusConsent(id, valor));
  return 0;
}

// Ativar e consentir exigem um humano no terminal (DT-10; ADR-0007, Camada 4): sem TTY, recusa.
async function confirmar({ confirm, io, M }, sub, pergunta) {
  const resposta = await confirm(pergunta);
  if (resposta.state === "no-tty") {
    io.err(M.errorPrefix(M.reviewNeedsTty(sub)));
    return false;
  }
  if (resposta.state !== "yes") {
    io.err(M.reviewDeclined);
    return false;
  }
  return true;
}

async function reviewEnable(contexto) {
  const { core, flags, io, M } = contexto;
  const escolha = chooseReviewer(flags, reviewerIds());
  if (!escolha.ok) return recusaDoRevisor(escolha, io, M);
  const ficha = reviewerOf(escolha.id);
  for (const linha of M.reviewEnableEffects(ficha.provider)) io.out(linha);
  if (!(await confirmar(contexto, "enable", M.reviewEnableConfirm))) return 1;
  io.out(M.reviewConfigWriting(path.join(core, CONFIG_NAME)));
  const { after } = writeExternalReview(core, { enabled: true, reviewers: [escolha.id] });
  io.out(M.reviewEnabledWritten(after.reviewers));
  if (readReviewConsent(core, escolha.id).state !== "given") io.out(M.reviewEnableConsentHint(escolha.id));
  return 0;
}

function reviewDisable({ core, io, M }) {
  const config = readExternalReview(core);
  if (!isEnabled(config)) {
    io.out(M.reviewAlreadyOff);
    return 0;
  }
  io.out(M.reviewConfigWriting(path.join(core, CONFIG_NAME)));
  writeExternalReview(core, { enabled: false, reviewers: config.reviewers });
  io.out(M.reviewDisabledWritten);
  io.out(M.reviewDisableEffect);
  return 0;
}

async function reviewConsent(contexto) {
  const { core, flags, io, M, now } = contexto;
  const escolha = chooseReviewer(flags, reviewerIds());
  if (!escolha.ok) return recusaDoRevisor(escolha, io, M);
  const ficha = reviewerOf(escolha.id);
  for (const linha of M.reviewConsentEffects(ficha.provider)) io.out(linha);
  if (!(await confirmar(contexto, "consent", M.reviewConsentConfirm))) return 1;
  io.out(M.reviewConfigWriting(path.join(core, LOCAL_CONFIG_NAME)));
  writeReviewConsent(core, escolha.id, now().toISOString());
  io.out(M.reviewConsentWritten(escolha.id));
  return 0;
}

function reviewRevoke({ core, flags, io, M }) {
  const escolha = chooseReviewer(flags, reviewerIds());
  if (!escolha.ok) return recusaDoRevisor(escolha, io, M);
  if (readReviewConsent(core, escolha.id).state !== "given") {
    io.out(M.reviewConsentAlreadyAbsent(escolha.id));
    return 0;
  }
  io.out(M.reviewConfigWriting(path.join(core, LOCAL_CONFIG_NAME)));
  removeReviewConsent(core, escolha.id);
  io.out(M.reviewConsentRevoked(escolha.id));
  return 0;
}

// Modelo e esforço do revisor (DT-17): quem escolhe é o projeto; o MGR nunca sugere um valor, e o
// esforço não é conferido contra lista fechada (depende do modelo). Configurar não liga a funcionalidade.
function reviewSet({ core, flags, io, M }) {
  if (flags.model === undefined && flags.effort === undefined) {
    io.err(M.errorPrefix(M.reviewSetNeedsValue));
    return 1;
  }
  const escolha = chooseReviewer(flags, reviewerIds());
  if (!escolha.ok) return recusaDoRevisor(escolha, io, M);
  io.out(M.reviewConfigWriting(path.join(core, CONFIG_NAME)));
  const { after } = writeReviewerOptions(core, escolha.id, { model: flags.model, effort: flags.effort });
  io.out(M.reviewOptionsWritten(escolha.id, after.model ?? M.reviewDefaultValue, after.effort ?? M.reviewDefaultValue));
  return 0;
}

// Recusa de pré-condição (casos 1 a 5, e os de git): código do núcleo vira uma linha. Nada foi chamado.
const LINHA_DA_RECUSA = {
  [REVIEW_REASONS.needsSlug]: (M) => M.reviewNeedsSlug,
  [REVIEW_REASONS.archived]: (M, recusa) => M.reviewSliceArchived(recusa.slug),
  [REVIEW_REASONS.notFound]: (M, recusa) => M.reviewSliceNotFound(recusa.slug),
  [REVIEW_REASONS.disabled]: (M) => M.reviewDisabled,
  [REVIEW_REASONS.reviewerAmbiguous]: (M, recusa) => M.reviewReviewerAmbiguous(recusa.ids),
  [REVIEW_REASONS.reviewerNotConfigured]: (M, recusa) => M.reviewReviewerNotConfigured(recusa.id, recusa.ids),
  [REVIEW_REASONS.noConsent]: (M, recusa) => M.reviewNoConsent(recusa.id, recusa.provider),
  [REVIEW_REASONS.notAGitRepo]: (M) => M.reviewNotGitRepo,
  [REVIEW_REASONS.needsBase]: (M) => M.reviewNeedsBase,
  [REVIEW_REASONS.baseUnknown]: (M, recusa) => M.reviewBaseUnknown(recusa.ref),
  [REVIEW_REASONS.dirtyWorktree]: (M, recusa) => M.reviewDirty(recusa.paths),
  [REVIEW_REASONS.emptyDiff]: (M, recusa) => M.reviewEmptyDiff(recusa.ref),
  [REVIEW_REASONS.pathWithNewline]: (M, recusa) => M.reviewPathWithNewline(recusa.paths),
  [REVIEW_REASONS.proofUnreadable]: (M, recusa) => M.reviewProofUnreadable(recusa.file, recusa.detail),
};

// Falha do REVISOR (casos 6 a 10): a linha com a mensagem original quando houver.
const LINHA_DA_FALHA = {
  [REVIEW_REASONS.notInstalled]: (M, falha, ficha) => M.reviewNotInstalled(ficha.id, ficha.binary),
  [REVIEW_REASONS.notLoggedIn]: (M, falha, ficha) => M.reviewNotLoggedIn(ficha.id, ficha.binary, falha.detail),
  [REVIEW_REASONS.reviewerFailed]: (M, falha, ficha) => M.reviewFailed(ficha.id, falha.status, falha.detail),
  [REVIEW_REASONS.responseInvalid]: (M, falha, ficha) => M.reviewResponseInvalid(ficha.id, falha.field),
  [REVIEW_REASONS.sessionMissing]: (M, falha, ficha) => M.reviewSessionMissing(ficha.id),
};

// O resultado vira booleano, e a palavra vem da tabela de cada idioma (QUAL-8; R2-S4).
const deuCerto = (resultado) => (typeof resultado === "boolean" ? resultado : resultado.ok === true || resultado.found === true);

// LOG-2: o git é subprocesso, então cada chamada ganha uma linha antes e outra depois. O núcleo recebe
// este invólucro e não sabe que há log.
function gitComLog(git, io, M) {
  const comLog = (nome, chamada) => (...argumentos) => {
    io.out(M.reviewGitCalling(nome));
    const resultado = chamada(...argumentos);
    io.out(M.reviewGitCalled(nome, deuCerto(resultado)));
    return resultado;
  };
  return {
    isRepo: comLog("rev-parse --is-inside-work-tree", git.isRepo),
    resolve: comLog("rev-parse --verify", git.resolve),
    head: comLog("rev-parse HEAD", git.head),
    dirty: comLog("status --porcelain", git.dirty),
    changedFiles: comLog("diff --name-only", git.changedFiles),
    contentsAt: comLog("cat-file --batch", git.contentsAt),
  };
}

function chamar(io, M, ficha, etapa, executar) {
  io.out(M.reviewCalling(ficha.id, etapa));
  const resultado = executar();
  io.out(M.reviewCalled(ficha.id, etapa, resultado.outcome === "exited" ? String(resultado.status) : resultado.outcome));
  return resultado;
}

async function reviewExternal(contexto) {
  const { root, core, flags, positional, reviewIo, io, M, now, language } = contexto;
  const git = gitComLog(reviewIo.git, io, M);
  const plano = planReview(root, { slug: positional[0], flags, coreDir: core, git });
  if (plano.outcome === "refused") {
    io.err(M.errorPrefix(LINHA_DA_RECUSA[plano.code](M, plano)));
    return 1;
  }
  const ficha = plano.reviewer;
  const falhou = (falha) => {
    io.err(M.errorPrefix(LINHA_DA_FALHA[falha.code](M, falha, ficha)));
    io.out(M.reviewWriting(proofFileOf(root, plano)));
    io.err(M.reviewFailureRecorded(appendToProof(root, plano, failureEntry(plano, falha.code, now().toISOString()))));
    return 1;
  };
  const executar = (etapa, rodar, julgar) => {
    const resultado = chamar(io, M, ficha, etapa, rodar);
    const chamada = judgeCall(resultado);
    return chamada.ok ? julgar(ficha, resultado) : chamada;
  };

  if (plano.beyondFlow) io.out(io.style.yellow(M.reviewRoundBeyondFlow(plano.round)));
  const versao = executar("--version", () => reviewIo.run(ficha.binary, ficha.versionArgv, { cwd: root }), judgeVersion);
  if (!versao.ok) return falhou(versao);
  const login = executar("login status", () => reviewIo.run(ficha.binary, ficha.loginArgv, { cwd: root }), judgeLogin);
  if (!login.ok) return falhou(login);
  const prompt = promptFor(plano, language);
  const { model, effort } = plano.options;
  const revisao = executar("exec", () => reviewIo.review(ficha.binary,
    ({ schemaFile, lastMessageFile }) => ficha.execArgv({ repo: root, schemaFile, lastMessageFile, prompt, model, effort }),
    { cwd: root, schema: RESPONSE_SCHEMA }), judgeExec);
  if (!revisao.ok) return falhou(revisao);

  const intacto = unchangedSince(root, plano, git);
  if (!intacto.ok) {
    io.err(M.errorPrefix(M.reviewChangedDuringReview));
    return 1;
  }
  const { entry, checked } = reviewEntry(plano, { version: versao.version, session: revisao.session, response: revisao.response, at: now().toISOString(), language });
  io.out(M.reviewWriting(proofFileOf(root, plano)));
  io.out(M.reviewWritten(appendToProof(root, plano, entry), plano.round));
  relatar(io, M, checked);
  return 0;
}

function relatar(io, M, conferida) {
  for (const achado of conferida.findings.standards) {
    io.out(M.reviewFindingStandards(achado.id, achado.rule, achado.file, achado.line));
    io.out(`    ${achado.violation}`);
  }
  for (const achado of conferida.findings.spec) {
    io.out(M.reviewFindingSpec(achado.id, achado.source, achado.file, achado.line));
    io.out(`    ${achado.finding}`);
  }
  for (const sugestao of conferida.suggestions) {
    io.out(sugestao.reason === undefined ? M.reviewSuggestion(sugestao.text) : M.reviewDemoted(sugestao.text, sugestao.reason));
  }
  if (conferida.specAxis === "abstained") io.out(M.reviewSpecAbstained);
  io.out(M.reviewSummary(conferida.findings.standards.length, conferida.findings.spec.length, conferida.suggestions.length));
}

