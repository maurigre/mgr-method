// Cola do comando `mgr review` (spec da fatia revisor-externo, DT-9, DT-10, DT-12 e DT-17). Humble
// Object: só parse, formatação e exit code. A decisão vive em `src/sdd/external-review.js`, a config em
// `src/plugins/registry.js`, a ficha em `src/reviewers/` e o processo em `bin/review-io.js`, que chega
// injetado (`reviewIo`), como a confirmação humana (`confirm`), no padrão de `src/install/prompts.js`.
//
// Falha alto: todo caso de recusa ou de falha tem motivo próprio e sai 1; nenhuma falha grava prova
// (as falhas do REVISOR gravam só uma entrada `failure`, que não é prova). Sucesso sai 0 com ou sem
// achado: o exit diz "a revisão aconteceu", não "o código está conforme" (CHECKPOINT 2, P-13).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as installer from "../install/installer.js";
import { LOCAL_CONFIG_NAME, readExternalReview, readReviewConsent, removeReviewConsent, writeExternalReview,
  writeReviewConsent, writeReviewerOptions } from "../plugins/registry.js";
import { get as reviewerOf, ids as reviewerIds } from "../reviewers/index.js";
import { SPECS_DIR, locate } from "../sdd/artifacts.js";
import { GUIDE_PATH, PROOF_FILE, RESPONSE_SCHEMA, REVIEW_REASONS, appendEntry, buildPrompt, checkCitations,
  fileHashes, nextRound, parseProof, reviewedPaths, validateResponse } from "../sdd/external-review.js";

const CONFIG_NAME = "config.json";
const COMANDO = "review";
const SUBCOMANDOS = ["external", "status", "enable", "disable", "consent", "revoke", "set"];
// Rodadas do fluxo (RN-19): passar disso é decisão humana, e a saída avisa.
const RODADAS_DO_FLUXO = 2;
const ARQUIVOS_DA_SPEC = ["02-prd.md", "03-spec.md"];

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

const ligada = (config) => config.state === "configured" && config.enabled === true;

// Escolha do revisor sem escolha silenciosa: com mais de um candidato, `--reviewer` é obrigatório.
function escolherRevisor(flags, candidatos) {
  if (flags.reviewer !== undefined) {
    return candidatos.includes(flags.reviewer)
      ? { ok: true, id: flags.reviewer }
      : { ok: false, code: REVIEW_REASONS.reviewerNotConfigured, id: flags.reviewer, ids: candidatos };
  }
  if (candidatos.length === 1) return { ok: true, id: candidatos[0] };
  return { ok: false, code: REVIEW_REASONS.reviewerAmbiguous, ids: candidatos };
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
  const estado = ligada(config) ? "on" : "off";
  const origem = config.state === "configured" ? "configured" : "default";
  const revisores = config.state === "configured" ? config.reviewers : [];
  const opcoes = config.state === "configured" ? config.options : {};
  const consentimento = Object.fromEntries(reviewerIds().map((id) => [id, readReviewConsent(core, id).state]));
  if (flags.json) {
    io.out(JSON.stringify({ schemaVersion: 1, state: estado, source: origem, reviewers: revisores, options: opcoes, consent: consentimento }));
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
  const escolha = escolherRevisor(flags, reviewerIds());
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
  if (!ligada(config)) {
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
  const escolha = escolherRevisor(flags, reviewerIds());
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
  const escolha = escolherRevisor(flags, reviewerIds());
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
  const escolha = escolherRevisor(flags, reviewerIds());
  if (!escolha.ok) return recusaDoRevisor(escolha, io, M);
  io.out(M.reviewConfigWriting(path.join(core, CONFIG_NAME)));
  const { after } = writeReviewerOptions(core, escolha.id, { model: flags.model, effort: flags.effort });
  io.out(M.reviewOptionsWritten(escolha.id, after.model ?? M.reviewDefaultValue, after.effort ?? M.reviewDefaultValue));
  return 0;
}

const relativo = (root, absoluto) => path.relative(root, absoluto).split(path.sep).join("/");

// Pré-condições na ordem da tabela do DT-9 (casos 1 a 5): nada é chamado, nada é gravado.
function preparar({ root, core, flags, positional, reviewIo, io, M }) {
  const slug = positional[0];
  const recusa = (linha) => {
    io.err(M.errorPrefix(linha));
    return { ok: false };
  };
  if (slug === undefined || flags.all) return recusa(M.reviewNeedsSlug);
  const local = locate(root, slug);
  if (local.state === "archived") return recusa(M.reviewSliceArchived(slug));
  if (local.state !== "active") return recusa(M.reviewSliceNotFound(slug));
  const config = readExternalReview(core);
  if (!ligada(config)) return recusa(M.reviewDisabled);
  const escolha = escolherRevisor(flags, config.reviewers);
  if (!escolha.ok) {
    recusaDoRevisor(escolha, io, M);
    return { ok: false };
  }
  const ficha = reviewerOf(escolha.id);
  if (readReviewConsent(core, ficha.id).state !== "given") return recusa(M.reviewNoConsent(ficha.id, ficha.provider));
  const git = reviewIo.git;
  if (!git.isRepo(root)) return recusa(M.reviewNotGitRepo);
  if (flags.base === undefined) return recusa(M.reviewNeedsBase);
  const base = git.resolve(root, flags.base);
  if (!base.found) return recusa(M.reviewBaseUnknown(flags.base));
  const head = git.head(root);
  const sujos = git.dirty(root);
  if (!head.found || !sujos.ok) return recusa(M.reviewNotGitRepo);
  const sujosForaDaSpec = reviewedPaths(sujos.files);
  if (sujosForaDaSpec.length) return recusa(M.reviewDirty(sujosForaDaSpec));
  const mudados = git.changedFiles(root, base.commit);
  if (!mudados.ok) return recusa(M.reviewBaseUnknown(flags.base));
  const arquivos = reviewedPaths(mudados.files);
  if (arquivos.length === 0) return recusa(M.reviewEmptyDiff(flags.base));
  const pasta = path.join(root, SPECS_DIR, slug);
  const arquivoDaProva = path.join(pasta, PROOF_FILE);
  const prova = parseProof(existsSync(arquivoDaProva) ? readFileSync(arquivoDaProva, "utf8") : undefined, slug);
  if (prova.state === "invalid") return recusa(M.reviewProofUnreadable(relativo(root, arquivoDaProva), prova.detail));
  const opcoes = config.options[ficha.id] ?? {};
  return { ok: true, slug, pasta, ficha, opcoes, base: { ref: flags.base, commit: base.commit }, head: head.commit, arquivos, arquivoDaProva, prova };
}

function gravarProva(root, alvo, entrada, io, M) {
  const prova = appendEntry(alvo.prova, alvo.slug, entrada);
  const arquivo = relativo(root, alvo.arquivoDaProva);
  io.out(M.reviewWriting(arquivo));
  writeFileSync(alvo.arquivoDaProva, JSON.stringify(prova, null, 2) + "\n", "utf8");
  return arquivo;
}

// Falha do REVISOR (casos 6 a 10): motivo próprio, a mensagem original quando houver, e a entrada
// `failure` gravada para a dispensa poder citá-la. Não é revisão.
function falhaDoRevisor({ root, io, M, now }, alvo, rodada, codigo, linhas) {
  for (const linha of linhas) io.err(linha);
  const arquivo = gravarProva(root, alvo, { kind: "failure", round: rodada, reviewer: alvo.ficha.id, at: now().toISOString(), code: codigo }, io, M);
  io.err(M.reviewFailureRecorded(arquivo));
  return 1;
}

// Toda chamada ao revisor passa por aqui: log antes e depois (LOG-2) e as duas falhas comuns às três
// etapas, binário ausente e processo que não iniciou, resolvidas num lugar só. Só o processo que
// terminou segue para a etapa julgar a saída dele.
function chamar({ io, M }, ficha, etapa, executar) {
  io.out(M.reviewCalling(ficha.id, etapa));
  const resultado = executar();
  io.out(M.reviewCalled(ficha.id, etapa, resultado.outcome === "exited" ? String(resultado.status) : resultado.outcome));
  if (resultado.outcome === "not-found") {
    return { ok: false, code: REVIEW_REASONS.notInstalled, linha: M.reviewNotInstalled(ficha.id, ficha.binary) };
  }
  if (resultado.outcome !== "exited") {
    return { ok: false, code: REVIEW_REASONS.reviewerFailed, linha: M.reviewFailed(ficha.id, resultado.outcome, "") };
  }
  return { ok: true, resultado };
}

const lerTexto = (absoluto) => (existsSync(absoluto) ? { present: true, text: readFileSync(absoluto, "utf8") } : { present: false });

function interpretar(resultado) {
  if (!resultado.lastMessage.present) return { ok: false, field: "output-last-message" };
  let valor;
  try {
    valor = JSON.parse(resultado.lastMessage.text);
  } catch {
    return { ok: false, field: "json" };
  }
  return validateResponse(valor);
}

async function reviewExternal(contexto) {
  const { root, reviewIo, io, M, now, language } = contexto;
  const alvo = preparar(contexto);
  if (!alvo.ok) return 1;
  const { ficha } = alvo;
  const rodada = nextRound(alvo.prova);
  const falha = (codigo, ...linhas) => falhaDoRevisor(contexto, alvo, rodada, codigo, linhas);

  const naoTerminou = (chamada) => falha(chamada.code, M.errorPrefix(chamada.linha));

  const versao = chamar(contexto, ficha, "--version", () => reviewIo.run(ficha.binary, ficha.versionArgv, { cwd: root }));
  if (!versao.ok) return naoTerminou(versao);
  const versaoLida = versao.resultado.status === 0 ? ficha.versionFrom(versao.resultado.stdout) : { found: false };
  if (!versaoLida.found) {
    return falha(REVIEW_REASONS.reviewerFailed, M.errorPrefix(M.reviewFailed(ficha.id, versao.resultado.status, versao.resultado.stderr)));
  }

  const login = chamar(contexto, ficha, "login status", () => reviewIo.run(ficha.binary, ficha.loginArgv, { cwd: root }));
  if (!login.ok) return naoTerminou(login);
  if (!ficha.isLoggedIn(login.resultado)) {
    return falha(REVIEW_REASONS.notLoggedIn, M.errorPrefix(M.reviewNotLoggedIn(ficha.id, `${login.resultado.stdout}${login.resultado.stderr}`.trim())));
  }

  const fontes = ARQUIVOS_DA_SPEC.map((nome) => path.join(alvo.pasta, nome)).filter(existsSync).map((absoluto) => ({ path: relativo(root, absoluto), text: readFileSync(absoluto, "utf8") }));
  const prompt = buildPrompt({ slug: alvo.slug, base: alvo.base.ref, files: alvo.arquivos, specSources: fontes.map((fonte) => fonte.path), language });
  const { model, effort } = alvo.opcoes;
  const chamada = chamar(contexto, ficha, "exec", () => reviewIo.review(ficha.binary,
    ({ schemaFile, lastMessageFile }) => ficha.execArgv({ repo: root, schemaFile, lastMessageFile, prompt, model, effort }),
    { cwd: root, schema: RESPONSE_SCHEMA }));
  if (!chamada.ok) return naoTerminou(chamada);
  const { resultado } = chamada;
  if (resultado.status !== 0) {
    return falha(REVIEW_REASONS.reviewerFailed, M.errorPrefix(M.reviewFailed(ficha.id, resultado.status, resultado.stderr)));
  }
  const resposta = interpretar(resultado);
  if (!resposta.ok) return falha(REVIEW_REASONS.responseInvalid, M.errorPrefix(M.reviewResponseInvalid(ficha.id, resposta.field)));
  const sessao = ficha.sessionFrom(resultado.stdout);
  if (!sessao.found) return falha(REVIEW_REASONS.sessionMissing, M.errorPrefix(M.reviewSessionMissing(ficha.id)));

  const conteudos = reviewIo.git.headContents(root, alvo.arquivos);
  if (!conteudos.ok) return falha(REVIEW_REASONS.reviewerFailed, M.errorPrefix(M.reviewNotGitRepo));
  const conferida = checkCitations(resposta.response, { guide: lerTexto(path.join(root, GUIDE_PATH)), specSources: fontes, round: rodada });
  const entrada = {
    kind: "review", round: rodada, reviewer: ficha.id, provider: ficha.provider, version: versaoLida.version,
    session: sessao.session, at: now().toISOString(), language, base: alvo.base.ref, baseCommit: alvo.base.commit,
    head: alvo.head, ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }),
    files: fileHashes(conteudos.files), specAxis: conferida.specAxis, findings: conferida.findings, suggestions: conferida.suggestions,
  };
  const arquivo = gravarProva(root, alvo, entrada, io, M);
  io.out(M.reviewWritten(arquivo, rodada));
  relatar(io, M, conferida);
  if (rodada > RODADAS_DO_FLUXO) io.out(io.style.yellow(M.reviewRoundBeyondFlow(rodada)));
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

