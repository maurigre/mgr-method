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
import { readExternalReview, readReviewConsent } from "../plugins/registry.js";
import { get as reviewerOf } from "../reviewers/index.js";
import { SPECS_DIR, artifactFiles, locate } from "./artifacts.js";
import {
  GUIDE_PATH, PROOF_FILE, REVIEW_REASONS, appendEntry, buildPrompt, checkCitations, fileHashes, nextRound,
  parseProof, reviewedPaths, validateResponse,
} from "./external-review.js";

// A lista PERMITIDA de fontes do eixo Spec (DT-8): os artefatos da fatia, por `artifactFiles`.
const SPEC_SOURCES = Object.freeze(["02-prd.md", "03-spec.md"]);

const relativo = (repo, absoluto) => path.relative(repo, absoluto).split(path.sep).join("/");
const recusa = (code, dados = {}) => ({ outcome: "refused", code, ...dados });

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
  if (slug === undefined || flags.all) return recusa(REVIEW_REASONS.needsSlug);
  const local = locate(repo, slug);
  if (local.state === "archived") return recusa(REVIEW_REASONS.archived, { slug });
  if (local.state !== "active") return recusa(REVIEW_REASONS.notFound, { slug });
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
  const proofPath = path.join(repo, SPECS_DIR, slug, PROOF_FILE);
  const proof = parseProof(existsSync(proofPath) ? readFileSync(proofPath, "utf8") : undefined, slug);
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
