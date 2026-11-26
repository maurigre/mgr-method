// Execução conferida de uma revisão externa (spec da fatia revisor-externo, DT-5, DT-6, DT-9, DT-12):
// o núcleo decide e persiste, a cola só traduz código em mensagem e escreve o log. Mesmo desenho do
// `archive.js` (gate R1, INV-5): `planReview` lê o disco e o git (injetado) e devolve recusa ou o alvo;
// `judge*` classificam a saída da borda sem IO; `appendToProof` grava, como o `applyArchive`.
//
// Os hashes saem ANTES da chamada ao revisor e fixados no commit do HEAD daquele momento (R1-P1): um
// commit feito durante a revisão não pode entrar na prova como conteúdo revisado. Depois da chamada,
// `unchangedSince` confere que o HEAD e a árvore são os mesmos; se não forem, nada é gravado.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readExternalReview, readInitials, readReviewConsent } from "../plugins/registry.js";
import { get as reviewerOf } from "../reviewers/index.js";
import { SPECS_DIR, artifactFiles, locate } from "./artifacts.js";
import {
  GUIDE_PATH, PROOF_FILE, REVIEW_REASONS, appendEntry, buildPrompt, checkCitations, fileHashes, lastDecisive,
  nextRound, parseProof, reviewedPaths, staleFiles, validateResponse,
} from "./external-review.js";

// A lista PERMITIDA de fontes do eixo Spec (DT-8): os artefatos da fatia, por `artifactFiles`.
const SPEC_SOURCES = Object.freeze(["02-prd.md", "03-spec.md"]);

const relativo = (repo, absoluto) => path.relative(repo, absoluto).split(path.sep).join("/");
const recusa = (code, dados = {}) => ({ outcome: "refused", code, ...dados });

// A fatia nomeada, ativa: a mesma pré-condição do `review external` e do `review waive` (QUAL-6).
function fatiaAtiva(repo, slug, flags) {
  if (slug === undefined || flags.all) return recusa(REVIEW_REASONS.needsSlug);
  const local = locate(repo, slug);
  if (local.state === "archived") return recusa(REVIEW_REASONS.archived, { slug });
  if (local.state !== "active") return recusa(REVIEW_REASONS.notFound, { slug });
  return { outcome: "active" };
}

// A prova de uma pasta de fatia (ativa ou arquivada), lida uma vez só para os quatro usos (QUAL-6).
// Ausente é só o arquivo que não existe; um diretório no lugar da prova ou um arquivo sem permissão é prova
// ilegível, com o código do erro, e nunca derruba o comando sem o motivo (R3-P3).
function lerProva(pasta, slug) {
  const proofPath = path.join(pasta, PROOF_FILE);
  if (!existsSync(proofPath)) return { proofPath, proof: parseProof(undefined, slug) };
  try {
    return { proofPath, proof: parseProof(readFileSync(proofPath, "utf8"), slug) };
  } catch (erro) {
    return { proofPath, proof: { state: "invalid", detail: erro.code ?? "read" } };
  }
}

// Sem escolha silenciosa: com mais de um candidato, `--reviewer` é obrigatório.
export function chooseReviewer(flags, candidatos) {
  if (flags.reviewer !== undefined) {
    return candidatos.includes(flags.reviewer)
      ? { ok: true, id: flags.reviewer }
      : { ok: false, code: REVIEW_REASONS.reviewerNotConfigured, id: flags.reviewer, ids: candidatos };
  }
  if (candidatos.length === 1) return { ok: true, id: candidatos[0] };
  return { ok: false, code: REVIEW_REASONS.reviewerAmbiguous, ids: candidatos };
}

// A RN-1 num lugar só: a funcionalidade vale quando o time a ligou. Usado pelo comando e, na 3b, pelo archive.
export const isEnabled = (config) => config.state === "configured" && config.enabled === true;

// Rodadas do fluxo (RN-19): passar disso é decisão humana, e a saída avisa ANTES de gastar a cota.
const RODADAS_DO_FLUXO = 2;

// Pré-condições na ordem da tabela do DT-9 (casos 1 a 5) e os hashes do HEAD: nada é chamado, nada é
// gravado. `git` é a borda injetada (subprocesso, TST-2).
export function planReview(repo, { slug, flags, coreDir, git }) {
  const fatia = fatiaAtiva(repo, slug, flags);
  if (fatia.outcome === "refused") return fatia;
  const config = readExternalReview(coreDir);
  if (!isEnabled(config)) return recusa(REVIEW_REASONS.disabled);
  const escolha = chooseReviewer(flags, config.reviewers);
  if (!escolha.ok) return recusa(escolha.code, { id: escolha.id, ids: escolha.ids });
  const reviewer = reviewerOf(escolha.id);
  if (readReviewConsent(coreDir, reviewer.id).state !== "given") {
    return recusa(REVIEW_REASONS.noConsent, { id: reviewer.id, provider: reviewer.provider });
  }
  if (!git.isRepo(repo)) return recusa(REVIEW_REASONS.notAGitRepo);
  if (flags.base === undefined) return recusa(REVIEW_REASONS.needsBase);
  const base = git.resolve(repo, flags.base);
  if (!base.found) return recusa(REVIEW_REASONS.baseUnknown, { ref: flags.base });
  const head = git.head(repo);
  const sujos = git.dirty(repo);
  if (!head.found || !sujos.ok) return recusa(REVIEW_REASONS.notAGitRepo);
  const sujosForaDaSpec = reviewedPaths(sujos.files);
  if (sujosForaDaSpec.length) return recusa(REVIEW_REASONS.dirtyWorktree, { paths: sujosForaDaSpec });
  const mudados = git.changedFiles(repo, base.commit);
  if (!mudados.ok) return recusa(REVIEW_REASONS.baseUnknown, { ref: flags.base });
  const paths = reviewedPaths(mudados.files);
  if (paths.length === 0) return recusa(REVIEW_REASONS.emptyDiff, { ref: flags.base });
  // O pedido ao `git cat-file --batch` é uma linha por caminho (DT-4): caminho com quebra de linha
  // desalinharia todos os seguintes (R1-P2). Recusado antes de qualquer chamada.
  const comQuebra = paths.filter((caminho) => caminho.includes("\n"));
  if (comQuebra.length) return recusa(REVIEW_REASONS.pathWithNewline, { paths: comQuebra.map((caminho) => JSON.stringify(caminho)) });
  const { proofPath, proof } = lerProva(path.join(repo, SPECS_DIR, slug), slug);
  if (proof.state === "invalid") return recusa(REVIEW_REASONS.proofUnreadable, { file: relativo(repo, proofPath), detail: proof.detail });
  const conteudos = git.contentsAt(repo, head.commit, paths);
  if (!conteudos.ok) return recusa(REVIEW_REASONS.notAGitRepo);
  const specSources = SPEC_SOURCES.flatMap((nome) => artifactFiles(repo, slug, nome))
    .map((absoluto) => ({ path: relativo(repo, absoluto), text: readFileSync(absoluto, "utf8") }));
  const guia = path.join(repo, GUIDE_PATH);
  const round = nextRound(proof);
  return {
    outcome: "ready", slug, reviewer, options: config.options[reviewer.id] ?? {},
    base: { ref: flags.base, commit: base.commit }, head: head.commit, paths, files: fileHashes(conteudos.files),
    proofPath, proof, round, beyondFlow: round > RODADAS_DO_FLUXO, specSources,
    guide: existsSync(guia) ? { present: true, text: readFileSync(guia, "utf8") } : { present: false },
  };
}

// O pedido ao revisor para este alvo: a base vai pelo commit, e não pela ref, que pode andar.
export const promptFor = (plano, language) => buildPrompt({
  slug: plano.slug, base: plano.base.commit, files: plano.paths, specSources: plano.specSources.map((fonte) => fonte.path), language,
});

// As duas falhas comuns às três chamadas: binário ausente e processo que não iniciou.
export function judgeCall(resultado) {
  if (resultado.outcome === "not-found") return { ok: false, code: REVIEW_REASONS.notInstalled };
  if (resultado.outcome !== "exited") {
    return { ok: false, code: REVIEW_REASONS.reviewerFailed, status: `${resultado.outcome} (${resultado.code})`, detail: "" };
  }
  return { ok: true };
}

export function judgeVersion(reviewer, resultado) {
  const lida = resultado.status === 0 ? reviewer.versionFrom(resultado.stdout) : { found: false };
  return lida.found
    ? { ok: true, version: lida.version }
    : { ok: false, code: REVIEW_REASONS.reviewerFailed, status: String(resultado.status), detail: resultado.stderr };
}

export function judgeLogin(reviewer, resultado) {
  return reviewer.isLoggedIn(resultado)
    ? { ok: true }
    : { ok: false, code: REVIEW_REASONS.notLoggedIn, detail: `${resultado.stdout}${resultado.stderr}`.trim() };
}

function lerResposta(resultado) {
  if (!resultado.lastMessage.present) return { ok: false, field: "output-last-message" };
  try {
    return validateResponse(JSON.parse(resultado.lastMessage.text));
  } catch {
    return { ok: false, field: "json" };
  }
}

// A saída do `exec` (casos 8 a 10). A mensagem original repete o stderr e as linhas cruas dos eventos
// de falha do fluxo (a documentação não dá os campos deles).
export function judgeExec(reviewer, resultado) {
  if (resultado.status !== 0) {
    const original = [resultado.stderr.trim(), ...reviewer.failureEventsFrom(resultado.stdout)].filter((linha) => linha !== "").join("\n");
    return { ok: false, code: REVIEW_REASONS.reviewerFailed, status: String(resultado.status), detail: original };
  }
  const resposta = lerResposta(resultado);
  if (!resposta.ok) return { ok: false, code: REVIEW_REASONS.responseInvalid, field: resposta.field };
  const sessao = reviewer.sessionFrom(resultado.stdout);
  if (!sessao.found) return { ok: false, code: REVIEW_REASONS.sessionMissing };
  return { ok: true, response: resposta.response, session: sessao.session };
}

// Depois da chamada: o HEAD e a árvore têm de ser os do plano, senão o revisor pode ter lido outra
// coisa e nada é gravado (nem revisão, nem falha: o revisor não falhou).
export function unchangedSince(repo, plano, git) {
  const head = git.head(repo);
  const sujos = git.dirty(repo);
  if (!head.found || !sujos.ok || head.commit !== plano.head || reviewedPaths(sujos.files).length) {
    return { ok: false, code: REVIEW_REASONS.changedDuringReview };
  }
  return { ok: true };
}

export const failureEntry = (plano, code, at) => ({ kind: "failure", round: plano.round, reviewer: plano.reviewer.id, at, code });

export function reviewEntry(plano, { version, session, response, at, language }) {
  const checked = checkCitations(response, { guide: plano.guide, specSources: plano.specSources, round: plano.round });
  const { model, effort } = plano.options;
  const entry = {
    kind: "review", round: plano.round, reviewer: plano.reviewer.id, provider: plano.reviewer.provider, version, session, at,
    language, base: plano.base.ref, baseCommit: plano.base.commit, head: plano.head,
    ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }),
    files: plano.files, specAxis: checked.specAxis, findings: checked.findings, suggestions: checked.suggestions,
  };
  return { entry, checked };
}

// Grava a entrada sem apagar as anteriores. Devolve o caminho relativo, para a cola o mostrar.
export function appendToProof(repo, plano, entry) {
  const prova = appendEntry(plano.proof, plano.slug, entry);
  writeFileSync(plano.proofPath, JSON.stringify(prova, null, 2) + "\n", "utf8");
  return relativo(repo, plano.proofPath);
}

export const proofFileOf = (repo, plano) => relativo(repo, plano.proofPath);

// A 4ª condição do `spec archive` (spec DT-13; RN-6, RN-7), como FATO para o `decide` do archive. Com a
// funcionalidade desligada devolve `off` sem ler a prova e sem chamar o git (RN-5): a saída do archive
// fica a de sempre. Ligada, julga pela última entrada decisiva da prova (`review` ou `waiver`); a
// `failure` não é prova. A revisão vale se os arquivos dela estão iguais no HEAD de agora (resposta 2).
export function archiveReviewFact(repo, slug, { coreDir, git }) {
  const config = readExternalReview(coreDir);
  if (!isEnabled(config)) return { state: "off" };
  const { proof } = lerProva(path.join(repo, SPECS_DIR, slug), slug);
  if (proof.state === "invalid") return { state: "invalid", detail: proof.detail };
  const decisiva = proof.state === "valid" ? lastDecisive(proof.proof) : { found: false };
  if (!decisiva.found) {
    const consent = config.reviewers.every((id) => readReviewConsent(coreDir, id).state === "given") ? "given" : "absent";
    return { state: "missing", consent };
  }
  const entrada = decisiva.entry;
  if (entrada.kind === "waiver") return { state: "waived", by: entrada.by, at: entrada.at, reason: entrada.reason };
  if (!config.reviewers.includes(entrada.reviewer)) return { state: "reviewer-not-configured", reviewer: entrada.reviewer, reviewers: config.reviewers };
  if (git === undefined || !git.isRepo(repo)) return { state: "unverifiable" };
  const atuais = git.contentsAt(repo, "HEAD", entrada.files.map((arquivo) => arquivo.path));
  if (!atuais.ok) return { state: "unverifiable" };
  const mudados = staleFiles(entrada.files, fileHashes(atuais.files));
  return mudados.length ? { state: "stale", paths: mudados } : { state: "ok" };
}

// A dispensa de uma fatia (para a marca do `spec status --archived`). Sem prova, ou prova que não termina
// em dispensa, é `{ waived: false }`: projeto sem a funcionalidade não ganha campo nenhum (DT-11).
export function waiverOf(dir, slug) {
  const { proof } = lerProva(dir, slug);
  if (proof.state !== "valid") return { waived: false };
  const decisiva = lastDecisive(proof.proof);
  return decisiva.found && decisiva.entry.kind === "waiver" ? { waived: true } : { waived: false };
}

// A dispensa (DT-11; resposta 3c): só humana, com motivo, e só depois de uma falha DO REVISOR registrada
// como última entrada; não é atalho para quem não quer revisar. `by` são as iniciais da camada pessoal.
export function planWaiver(repo, { slug, flags, coreDir }) {
  const fatia = fatiaAtiva(repo, slug, flags);
  if (fatia.outcome === "refused") return fatia.code === REVIEW_REASONS.needsSlug ? recusa(REVIEW_REASONS.waiveNeedsSlug) : fatia;
  const reason = flags.reason;
  if (typeof reason !== "string" || reason.trim() === "") return recusa(REVIEW_REASONS.waiveNeedsReason);
  const iniciais = readInitials(coreDir);
  if (iniciais.state !== "recorded") return recusa(REVIEW_REASONS.waiveNeedsInitials);
  const { proofPath, proof } = lerProva(path.join(repo, SPECS_DIR, slug), slug);
  if (proof.state === "invalid") return recusa(REVIEW_REASONS.proofUnreadable, { file: relativo(repo, proofPath), detail: proof.detail });
  const ultima = proof.state === "valid" ? proof.proof.entries.at(-1) : undefined;
  if (ultima?.kind !== "failure") return recusa(REVIEW_REASONS.waiveNeedsFailure, { slug });
  return { outcome: "ready", slug, proofPath, proof, by: iniciais.initials, reason: reason.trim(), failure: ultima.code };
}

export const waiverEntry = (plano, at) => ({ kind: "waiver", by: plano.by, at, reason: plano.reason, failure: plano.failure });
