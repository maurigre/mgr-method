// Cola dos comandos `mgr spec status|validate|next|archive`. Humble Object: aqui só há parse de flag,
// formatação e exit code; o IO (stdout/stderr, cor) entra por `io` e a raiz por `root`, para o
// teste exercitar sem processo filho. A decisão vive em src/ (plan-validator, plan-next, spec-status,
// archive).
import path from "node:path";
import * as planValidator from "../sdd/plan-validator.js";
import * as specValidator from "../sdd/spec-validator.js";
import * as provValidator from "../sdd/prov-validator.js";
import * as docValidator from "../sdd/doc-validator.js";
import * as planNext from "../sdd/plan-next.js";
import * as specStatusModel from "../sdd/spec-status.js";
import { ARCHIVE_DIR, SPECS_DIR, locate, slugs } from "../sdd/artifacts.js";
import { REASONS, applyArchive, archivedWithWaivers, isWaivedEntry, planArchive } from "../sdd/archive.js";
import { gitComLog } from "./review.js";
import { blocking, findingTexts, summarize } from "../sdd/findings.js";
import { getMessages } from "../core/messages.js";
import { renderText } from "../core/ui-text.js";

// Fatia que só existe no archive, ou o próprio nome `archive`: recusa explícita com o caminho, antes
// do núcleo (resposta 7 do CHECKPOINT 1). Sem ela, `spec validate <arquivada>` diria "nenhuma spec
// encontrada" — verdadeiro e enganoso. Resultado discriminado (DES-1): `{ refused: false }` para
// seguir, ou `{ refused: true, exitCode }` depois de escrever a recusa.
function recusaDeArquivada(repo, slug, io, M) {
  const seguir = { refused: false };
  if (!slug) return seguir;
  const onde = locate(repo, slug);
  if (onde.state === "reserved") {
    io.err(M.errorPrefix(M.specArchiveReserved));
    return { refused: true, exitCode: 1 };
  }
  if (onde.state === "archived") {
    io.err(M.errorPrefix(M.specArchived(slug, onde.paths.join(", "))));
    return { refused: true, exitCode: 1 };
  }
  return seguir;
}

// `mgr spec validate` — valida artefato do PROJETO do usuário. Não confundir com `mgr validate`,
// que valida autoria de SKILL.md: são contratos diferentes (ADR-0012). Aqui só há parse de flag,
// formatação e exit code; descoberta, leitura e política vivem em src/sdd/plan-validator.js (INV-5).
export function specValidate({ root, cwd, flags, positional, io, M }) {
  const repo = root;
  const slug = flags.all ? null : (positional[0] || planValidator.slugFromCwd(repo, cwd));
  const recusa = recusaDeArquivada(repo, slug, io, M);
  if (recusa.refused) return recusa.exitCode;
  // Quatro verificações, um comando: o plano (ADR-0012), a spec (ADR-0013), a proveniência
  // (ADR-0016) e a documentação declarada no fechamento (ADR-0020). As duas primeiras leem UM
  // arquivo por feature, a terceira vale para qualquer artefato e a quarta só para o fechamento —
  // por isso a lista de arquivos é a UNIÃO das quatro, sem repetir quem aparece em mais de uma.
  const planos = planValidator.validatePlans(repo, { slug });
  const specs = specValidator.validateSpecs(repo, { slug });
  const proveniencia = provValidator.validateProvenance(repo, { slug });
  const documentacao = docValidator.validateDocs(repo, { slug });
  const arquivos = [...new Set([...planos.files, ...specs.files, ...proveniencia.files, ...documentacao.files])];
  const achados = [...planos.findings, ...specs.findings, ...proveniencia.findings, ...documentacao.findings];

  if (!arquivos.length) {
    io.err(M.errorPrefix(M.specValidateNoSpecs(slug || path.join(repo, SPECS_DIR))));
    return 1;
  }

  const resultado = {
    files: arquivos,
    tasks: planos.tasks,
    criteria: specs.criteria,
    findings: achados,
    summary: summarize(achados),
  };
  const bloqueantes = blocking(resultado.findings, { strict: flags.strict });

  if (flags.json) {
    io.out(JSON.stringify({
      schemaVersion: 1,
      scope: "structural",
      files: resultado.files,
      findings: resultado.findings,
      summary: resultado.summary,
    }, null, 2));
    return bloqueantes ? 1 : 0;
  }

  let arquivoAtual = null;
  for (const finding of resultado.findings) {
    if (finding.file !== arquivoAtual) { io.out(M.specValidateHeader(finding.file)); arquivoAtual = finding.file; }
    const textos = findingTexts(finding);
    io.out(M.specValidateItem(finding.code, finding.severity, finding.task, finding.line, renderText(M, textos.message)));
    io.out(M.specValidateFix(renderText(M, textos.remediation)));
    for (const linha of renderText(M, textos.example).split("\n")) io.out(M.specValidateExample(linha));
  }
  if (!resultado.findings.length) io.out(M.specValidateOk(resultado.tasks, resultado.criteria, resultado.files.length));
  io.out(M.specValidateSummary(resultado.summary.errors, resultado.summary.warnings));
  io.out(io.style.dim(M.specValidateScopeNote));
  if (bloqueantes) io.out(M.specValidateNextSteps);
  return bloqueantes ? 1 : 0;
}

// `mgr spec next` — a próxima AÇÃO, não o estado (ADR-0014). Sem `--all`: a pergunta "o que faço
// agora" é sobre UMA feature. Aqui só há formatação e exit code; a decisão vive em src/sdd/plan-next.js.
export function specNext({ root, cwd, flags, positional, io, M }) {
  const repo = root;

  // `--all` não é aceito e ignorado: a pergunta "o que faço agora" é sobre UMA feature, e aceitar a
  // flag em silêncio faz o comando responder sobre uma feature qualquer com cara de resposta sobre
  // todas (ADR-0016, DT-8).
  if (flags.all) {
    io.err(M.errorPrefix(M.specNextAllRefused));
    return 1;
  }

  const slug = positional[0] || planValidator.slugFromCwd(repo, cwd);
  const recusa = recusaDeArquivada(repo, slug, io, M);
  if (recusa.refused) return recusa.exitCode;

  // Sem slug e fora de `specs/<slug>/`, a descoberta escolhia a primeira feature em ordem
  // alfabética e respondia como se fosse A resposta. Dizer quantas existem e pedir o nome custa uma
  // linha; a escolha silenciosa custa uma resposta errada que ninguém tem como perceber.
  const existentes = slugs(repo);
  if (!slug && existentes.length) {
    io.err(M.errorPrefix(M.specNextNeedsSlug(existentes.length)));
    return 1;
  }

  const resultado = planNext.nextTask(repo, { slug });

  if (resultado.outcome === "no-plan") {
    io.err(M.errorPrefix(M.specNextNoPlan(slug || path.join(repo, SPECS_DIR))));
    return 1;
  }

  if (flags.json) {
    io.out(JSON.stringify({
      schemaVersion: 1,
      outcome: resultado.outcome,
      file: resultado.file,
      task: resultado.task,
      blocked: resultado.blocked || [],
      stateDeclared: resultado.stateDeclared,
      taskCount: resultado.taskCount,
    }, null, 2));
    return 0;
  }

  // O arquivo, sempre: sem slug e com vários planos a descoberta escolhe um, e o leitor precisa
  // saber de qual feature a resposta fala.
  io.out(M.specNextFile(resultado.file));

  if (resultado.outcome === "task") {
    const { task } = resultado;
    io.out(M.specNextTask(task.id));
    if (task.artifact) io.out(M.specNextArtifact(task.artifact));
    if (task.doneWhen) io.out(M.specNextDoneWhen(task.doneWhen));
    if (task.helperSkill) io.out(M.specNextSkill(task.helperSkill));
    if (task.dependsOn.length) io.out(M.specNextDependsOn(task.dependsOn.join(", ")));
  } else if (resultado.outcome === "all-done") {
    io.out(M.specNextAllDone(resultado.taskCount));
  } else if (resultado.outcome === "nothing-ready") {
    io.out(M.specNextNothingReady);
    for (const item of resultado.blocked) io.out(M.specNextBlocked(item.id, item.waitingFor.join(", ")));
    io.out(M.specNextRunValidate);
  } else if (resultado.outcome === "no-tasks") {
    io.out(M.specNextNoTasks);
  } else {
    io.out(M.specNextFormatNotDeclared);
  }

  // A base do que se afirma, em TODA resposta — a CA-6 diz "toda", e o caminho sem marcador não
  // era exceção escrita em lugar nenhum. Sem ela, devolver P0.1 para sempre seria lido como
  // "esta é a próxima", quando o correto é "esta é a primeira que pode começar" (ADR-0014).
  io.out("");
  io.out(resultado.stateDeclared
    ? M.specNextBasis(resultado.stateDeclared, resultado.taskCount)
    : M.specNextNoState(resultado.taskCount));
  // A ressalva só é verdadeira quando de fato se devolveu uma task. Dizê-la em "nada pronto"
  // seria a saída prometendo o que não fez.
  if (!resultado.stateDeclared && resultado.outcome === "task") io.out(M.specNextFirstStartable);
  return 0;
}

// `brief` vira `brief`, ausente vira `-brief`. O traço marca o que NÃO está lá sem inventar
// palavra nova, e o aviso logo abaixo diz o que a marca significa e o que ela não significa.
const marcaDeArtefato = (artefato) =>
  (artefato.status === specStatusModel.PRESENT ? "" : "-") + artefato.id;

const resumoDeStatus = (feature) =>
  `${feature.artifacts.filter((a) => a.status === specStatusModel.PRESENT).length}/${feature.artifacts.length}`
  + (feature.handoff.exists ? "  handoff" : "");

// `mgr spec status` — o que EXISTE em disco, e o aviso de que existência não é progresso
// (ADR-0015). Aqui só há formatação e exit code; o modelo e o IO vivem em src/sdd/spec-status.js.
export function specStatus({ root, cwd, flags, positional, io, M }) {
  const repo = root;

  if (flags.archived) return statusDasArquivadas(repo, flags, positional, io, M);

  if (flags.all) {
    const todas = specStatusModel.statusAll(repo);
    if (!todas.length) {
      io.err(M.errorPrefix(M.specStatusEmpty(path.join(repo, SPECS_DIR))));
      return 1;
    }
    if (flags.json) {
      io.out(JSON.stringify({ schemaVersion: 1, basis: specStatusModel.BASIS, warning: getMessages("en").specStatusWarning, features: todas }, null, 2));
      return 0;
    }
    for (const feature of todas) io.out(M.specStatusLine(feature.slug, resumoDeStatus(feature)));
    io.out("");
    io.out(M.specStatusWarning);
    return 0;
  }

  const slug = positional[0] || planValidator.slugFromCwd(repo, cwd);
  const recusa = recusaDeArquivada(repo, slug, io, M);
  if (recusa.refused) return recusa.exitCode;
  const resultado = specStatusModel.statusFor(repo, { slug });

  if (!resultado.found) {
    io.err(M.errorPrefix(M.specStatusNotFound(slug || "")));
    return 1;
  }

  if (flags.json) {
    io.out(JSON.stringify({ schemaVersion: 1, ...resultado, warning: getMessages("en").specStatusWarning }, null, 2));
    return 0;
  }

  io.out(M.specStatusRoot(resultado.specRoot));
  io.out(M.specStatusArtifacts(resultado.artifacts.map(marcaDeArtefato).join(" ")));
  io.out(resultado.nextReady.length
    ? M.specStatusNextReady(resultado.nextReady.join(", "))
    : M.specStatusNothingReady);
  io.out(resultado.handoff.exists
    ? M.specStatusHandoffOn(resultado.handoff.path)
    : M.specStatusHandoffNone);
  io.out("");
  io.out(M.specStatusWarning);
  return 0;
}

// `mgr spec status --archived` — o que está em specs/archive/, mais recentes primeiro. Vazio sai 0:
// um projeto sem nada arquivado é o estado inicial legítimo, não erro de diretório. A listagem só diz
// o que está na pasta (limite declarado: uma pasta posta à mão aparece igual).
function statusDasArquivadas(repo, flags, positional, io, M) {
  if (positional[0] || flags.all) {
    io.err(M.errorPrefix(M.specStatusArchivedExclusive));
    return 1;
  }
  // A fatia arquivada com a revisão externa dispensada ganha a marca; sem prova, nada muda (DT-11).
  const arquivadas = archivedWithWaivers(repo);
  if (flags.json) {
    io.out(JSON.stringify({ schemaVersion: 1, archived: arquivadas }, null, 2));
    return 0;
  }
  if (!arquivadas.length) {
    io.out(M.specStatusArchivedEmpty(path.join(repo, SPECS_DIR, ARCHIVE_DIR)));
    return 0;
  }
  for (const entrada of arquivadas) {
    if (!entrada.recognized) io.out(M.specStatusArchivedUnrecognized(entrada.name));
    else if (isWaivedEntry(entrada)) io.out(M.specStatusArchivedLineWaived(entrada.date, entrada.slug));
    else io.out(M.specStatusArchivedLine(entrada.date, entrada.slug));
  }
  return 0;
}

// Código de recusa (dado, `REASONS`) → linha no idioma. A tabela mora na cola, como a de
// `src/commands/sdd-check.js`: o núcleo devolve o código, e só a borda escolhe as palavras.
const LINHA_DO_MOTIVO = {
  [REASONS.reservedSlug]: (M) => M.specArchiveReserved,
  [REASONS.notFound]: (M, motivo) => M.specStatusNotFound(motivo.slug),
  [REASONS.alreadyArchived]: (M, motivo, slug) => M.specArchived(slug, motivo.paths.join(", ")),
  [REASONS.invalidDate]: (M, motivo) => M.specArchiveDateInvalid(motivo.value ?? ""),
  [REASONS.futureDate]: (M, motivo) => M.specArchiveDateFuture(motivo.value),
  [REASONS.noPlan]: (M) => M.specArchiveNoPlan,
  [REASONS.noTasks]: (M) => M.specArchiveNoTasks,
  [REASONS.tasksNotDone]: (M, motivo) => M.specArchiveTasksNotDone(motivo.ids.join(", ")),
  [REASONS.noCompletion]: (M) => M.specArchiveNoCompletion,
  [REASONS.completionFindings]: (M, motivo) => M.specArchiveCompletionFindings(motivo.codes.join(", "), motivo.slug),
  [REASONS.sddCheckFailed]: (M, motivo) => M.specArchiveSddFailed(motivo.reason),
  [REASONS.externalReviewMissing]: (M, motivo) => M.specArchiveReviewMissing(motivo.slug, motivo.consent === "given"),
  [REASONS.externalReviewInvalid]: (M, motivo) => (Object.hasOwn(motivo, "reviewer")
    ? M.specArchiveReviewReviewerNotConfigured(motivo.reviewer, motivo.reviewers)
    : M.specArchiveReviewInvalid(motivo.detail)),
  [REASONS.externalReviewStale]: (M, motivo) => M.specArchiveReviewStale(motivo.paths),
  [REASONS.externalReviewUnverifiable]: (M) => M.specArchiveReviewUnverifiable,
  [REASONS.destinationExists]: (M, motivo) => M.specArchiveDestinationExists(motivo.destination),
};

// `mgr spec archive <slug> [--date AAAA-MM-DD]` — move a fatia terminada para specs/archive/, e só se
// as condições valerem: as três de sempre e, com a revisão externa ligada, a quarta (ADR-0036, K06a; ADR-0039). Slug sempre explícito: o movimento é irreversível, e
// rodar de dentro da pasta que vai mudar de lugar deixaria o shell num diretório que não existe.
// `--all` é recusado, não ignorado: cada fatia é arquivada pelo nome, uma de cada vez.
export function specArchive({ root, flags, positional, io, M, reviewIo }) {
  const repo = root;
  if (flags.all) {
    io.err(M.errorPrefix(M.specArchiveAllRefused));
    return 1;
  }
  const slug = positional[0];
  if (!slug) {
    io.err(M.errorPrefix(M.specArchiveNeedsSlug));
    return 1;
  }
  // O git só é chamado com a revisão externa ligada (DT-13), e cada chamada tem o seu par de LOG-2.
  const git = reviewIo === undefined ? undefined : gitComLog(reviewIo.git, io, M);
  const plano = planArchive(repo, slug, Object.hasOwn(flags, "date") ? { date: flags.date, git } : { git });
  if (plano.outcome === "refused") {
    io.err(M.errorPrefix(M.specArchiveRefused(slug)));
    for (const motivo of plano.reasons) io.err(LINHA_DO_MOTIVO[motivo.code](M, motivo, slug));
    return 1;
  }
  // LOG-1: uma linha logo antes e outra logo depois de alterar o disco.
  io.out(M.specArchiveMoving(path.join(SPECS_DIR, slug), plano.destination));
  const movimento = applyArchive(repo, plano);
  if (movimento.outcome !== "moved") {
    io.err(M.errorPrefix(M.specArchiveMoveFailed(movimento.from, movimento.to, movimento.code)));
    return 1;
  }
  io.out(M.specArchiveDone(movimento.from, movimento.to));
  // Dispensa nunca é silenciosa (resposta 3c): o aviso sai em destaque, com quem, quando e o motivo.
  if (plano.waived) io.out(io.style.bold(io.style.yellow(M.specArchiveWaived(plano.waived.by, plano.waived.at, plano.waived.reason))));
  if (plano.sddWarnings > 0) io.out(M.specArchiveSddWarnings(plano.sddWarnings));
  return 0;
}
