// Arquivamento conferido de uma fatia (ADR-0036, K06a). A decisão é pura (`decide`), a leitura do
// disco fica em `planArchive` e a escrita em `applyArchive`, com o I/O injetado nas duas, no mesmo
// desenho do `plan-next` (decisão pura, descoberta com IO) e do `sdd-check` (dependências por
// parâmetro com default).
//
// "Arquivada" significa terminada, inclusive o SDD. As três condições usam só regras que já existem
// (RN-4): o status das tasks (ADR-0014), a declaração de documentação do fechamento (DOC-3/DOC-4,
// ADR-0020) e o `sdd-check`. A condição do SDD confere a DECLARAÇÃO, não a correção do conteúdo
// (limite declarado; o conteúdo é a 0.8.0, K06b). A quarta, a revisão externa, só existe com a
// funcionalidade ligada no projeto (fatia revisor-externo, DT-13); desligada, nada muda.
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync } from "node:fs";
import path from "node:path";
import { ARCHIVE_DIR, SPECS_DIR, archivedEntries, artifactFiles, locate } from "./artifacts.js";
import { PLAN_FILE, STATUS_DONE, parse } from "./plan-parser.js";
import { validateDocs } from "./doc-validator.js";
import { inspectSdd } from "./sdd-check.js";
import { RUNTIME_DIR_NAME } from "../core/bundle.js";
import { archiveReviewFact, waiverOf } from "./review-run.js";

// Códigos estáveis de recusa: dado, não prosa, iguais em todos os idiomas (a cola traduz cada um
// para uma chave de mensagem).
export const REASONS = Object.freeze({
  reservedSlug: "reserved-slug",
  notFound: "not-found",
  alreadyArchived: "already-archived",
  invalidDate: "invalid-date",
  futureDate: "future-date",
  noPlan: "no-plan",
  noTasks: "no-tasks",
  tasksNotDone: "tasks-not-done",
  noCompletion: "no-completion",
  completionFindings: "completion-findings",
  sddCheckFailed: "sdd-check-failed",
  externalReviewMissing: "external-review-missing",
  externalReviewInvalid: "external-review-invalid",
  externalReviewReviewerNotConfigured: "external-review-reviewer-not-configured",
  externalReviewStale: "external-review-stale",
  externalReviewUnverifiable: "external-review-unverifiable",
  destinationExists: "destination-exists",
});

const FORMATO_DE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const doisDigitos = (numero) => String(numero).padStart(2, "0");

// Fuso local, e não UTC: a data diz quando a fatia terminou para quem arquiva. Em UTC, um
// arquivamento à noite em UTC-3 levaria o dia seguinte.
export function localDate(now) {
  return `${now.getFullYear()}-${doisDigitos(now.getMonth() + 1)}-${doisDigitos(now.getDate())}`;
}

// Aceita só AAAA-MM-DD que seja dia real do calendário (ida e volta pelo `Date`) e não posterior a
// `hoje`: a data afirma quando a fatia terminou.
export function parseDate(valor, hoje) {
  const casou = typeof valor === "string" ? valor.match(FORMATO_DE_DATA) : null;
  if (!casou) return { ok: false, reason: REASONS.invalidDate };
  const [, ano, mes, dia] = casou.map(Number);
  const real = new Date(ano, mes - 1, dia);
  if (real.getFullYear() !== ano || real.getMonth() !== mes - 1 || real.getDate() !== dia) {
    return { ok: false, reason: REASONS.invalidDate };
  }
  if (valor > hoje) return { ok: false, reason: REASONS.futureDate };
  return { ok: true, date: valor };
}

const destinationOf = (date, slug) => path.join(SPECS_DIR, ARCHIVE_DIR, `${date}-${slug}`);

// Decisão pura sobre os fatos já levantados. As pré-condições encerram na hora (sem elas não há
// fatia a julgar); as condições são TODAS avaliadas e reportadas na ordem (1) a (4), para a
// recusa trazer o motivo completo de uma vez.
export function decide(fatos) {
  const { slug, location, date, plan, completion, sdd, destinationExists, externalReview = { state: "off" } } = fatos;
  if (location.state === "reserved") return recusa([{ code: REASONS.reservedSlug }]);
  if (location.state === "archived") return recusa([{ code: REASONS.alreadyArchived, paths: location.paths }]);
  if (location.state === "absent") return recusa([{ code: REASONS.notFound, slug }]);
  if (!date.ok) return recusa([{ code: date.reason, value: date.value }]);

  const motivos = [...condicaoDoPlano(plan), ...condicaoDoFechamento(completion, slug)];
  if (!sdd.ok) motivos.push({ code: REASONS.sddCheckFailed, reason: sdd.reason });
  motivos.push(...condicaoDaRevisaoExterna(externalReview, slug));
  const destination = destinationOf(date.date, slug);
  if (destinationExists) motivos.push({ code: REASONS.destinationExists, destination });
  // Os avisos do `sdd-check` não bloqueiam (RN-4, P-2): só a contagem viaja, e a cola aponta o comando.
  const sddWarnings = sdd.warnings?.length ?? 0;
  if (motivos.length) return recusa(motivos);
  // A dispensa passa a condição (4), e o resultado a carrega para a cola anunciar em destaque (DT-11).
  return externalReview.state === "waived"
    ? { outcome: "archive", slug, destination, sddWarnings, waived: { by: externalReview.by, at: externalReview.at, reason: externalReview.reason } }
    : { outcome: "archive", slug, destination, sddWarnings };
}

// A condição (4): o fato chega pronto de `archiveReviewFact`; aqui só vira código de recusa.
const RECUSA_DA_REVISAO = {
  missing: (fato, slug) => [{ code: REASONS.externalReviewMissing, slug, consent: fato.consent }],
  invalid: (fato) => [{ code: REASONS.externalReviewInvalid, detail: fato.detail }],
  "reviewer-not-configured": (fato) => [{ code: REASONS.externalReviewReviewerNotConfigured, reviewer: fato.reviewer, reviewers: fato.reviewers }],
  stale: (fato) => [{ code: REASONS.externalReviewStale, paths: fato.paths }],
  unverifiable: () => [{ code: REASONS.externalReviewUnverifiable }],
};

function condicaoDaRevisaoExterna(fato, slug) {
  return Object.hasOwn(RECUSA_DA_REVISAO, fato.state) ? RECUSA_DA_REVISAO[fato.state](fato, slug) : [];
}

const recusa = (reasons) => ({ outcome: "refused", reasons });

// Só a task com `status` igual a `done` conta como concluída: ausência vale `todo` e valor fora do
// vocabulário nunca é `done` (ADR-0014). Zero tasks é recusa: "todas `done`" sobre nenhuma seria
// verdade vazia afirmando conclusão sem fonte. Plano sem marcador de formato é julgado pelo mesmo
// status (não pelo `choose` do plan-next, que recusaria por formato: seria critério novo).
function condicaoDoPlano(plan) {
  if (!plan.present) return [{ code: REASONS.noPlan }];
  if (plan.tasks.length === 0) return [{ code: REASONS.noTasks }];
  const abertas = plan.tasks.filter((task) => task.status !== STATUS_DONE).map((task) => task.id);
  return abertas.length ? [{ code: REASONS.tasksNotDone, ids: abertas }] : [];
}

// O fechamento é obrigatório: a ausência dele é recusa, não aprovação vazia (CHECKPOINT 1).
function condicaoDoFechamento(completion, slug) {
  if (!completion.present) return [{ code: REASONS.noCompletion }];
  return completion.codes.length ? [{ code: REASONS.completionFindings, codes: completion.codes, slug }] : [];
}

// Levanta os fatos lendo o disco, sem escrever nada (uma recusa nunca move nada).
// `now` é injetado porque a data do dia precisa ser determinística no teste; `git` porque é subprocesso
// (borda, TST-2) e só é chamado com a revisão externa ligada. O resto é o disco real (TST-1).
export function planArchive(repo, slug, opcoes = {}) {
  const { date, now = new Date(), git } = opcoes;
  const location = locate(repo, slug);
  const hoje = localDate(now);
  const dataPedida = Object.hasOwn(opcoes, "date") ? { ...parseDate(date, hoje), value: date } : { ok: true, date: hoje };
  if (location.state !== "active" || !dataPedida.ok) {
    return decide({ slug, location, date: dataPedida });
  }
  const plano = artifactFiles(repo, slug, PLAN_FILE);
  const plan = plano.length
    ? { present: true, tasks: parse(readFileSync(plano[0], "utf8")).tasks.map(({ id, status }) => ({ id, status })) }
    : { present: false, tasks: [] };
  const docs = validateDocs(repo, { slug });
  const completion = { present: docs.files.length > 0, codes: [...new Set(docs.findings.map((achado) => achado.code))] };
  const sdd = inspectSdd(repo);
  const destinationExists = existsSync(path.join(repo, destinationOf(dataPedida.date, slug)));
  const externalReview = archiveReviewFact(repo, slug, { coreDir: path.join(repo, RUNTIME_DIR_NAME), git });
  return decide({ slug, location, date: dataPedida, plan, completion, sdd, destinationExists, externalReview });
}

// Move a fatia por um `rename` só: atômico no mesmo sistema de arquivos (ou tudo muda de lugar, ou
// nada muda). Sem plano B de copiar e apagar, que poderia deixar a fatia pela metade nos dois lados.
// O destino é conferido antes porque o `rename` do POSIX substitui em silêncio um diretório vazio.
export function applyArchive(repo, plano) {
  const from = path.join(SPECS_DIR, plano.slug);
  const to = plano.destination;
  const destinoAbsoluto = path.join(repo, to);
  if (existsSync(destinoAbsoluto)) return { outcome: "move-failed", from, to, code: "EEXIST" };
  const pastaDoArchive = path.join(repo, SPECS_DIR, ARCHIVE_DIR);
  const criouArchive = !existsSync(pastaDoArchive);
  if (criouArchive) mkdirSync(pastaDoArchive, { recursive: true });
  try {
    renameSync(path.join(repo, from), destinoAbsoluto);
    return { outcome: "moved", from, to };
  } catch (erro) {
    // Melhor esforço: desfaz só a pasta criada nesta chamada, e `rmdir` só remove diretório vazio.
    if (criouArchive) {
      try {
        rmdirSync(pastaDoArchive);
      } catch {
        // A pasta não estava vazia ou sumiu: não há o que desfazer, e a falha real é a do `rename`.
      }
    }
    return { outcome: "move-failed", from, to, code: erro.code ?? "UNKNOWN" };
  }
}

// As fatias arquivadas, com a marca da revisão externa dispensada (DT-11): só a entrada reconhecida cuja
// prova termina em dispensa ganha o campo; sem prova, a entrada fica exatamente como `archivedEntries`.
export function archivedWithWaivers(repo) {
  return archivedEntries(repo).map((entrada) => (entrada.recognized && waiverOf(path.join(repo, entrada.path), entrada.slug).waived
    ? { ...entrada, externalReview: "waived" }
    : entrada));
}

export const isWaivedEntry = (entrada) => entrada.externalReview === "waived";
