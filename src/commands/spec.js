// Cola dos comandos `mgr spec status|validate|next`. Humble Object: aqui só há parse de flag,
// formatação e exit code; o IO (stdout/stderr, cor) entra por `io` e a raiz por `root`, para o
// teste exercitar sem processo filho. A decisão vive em src/ (plan-validator, plan-next, spec-status).
import path from "node:path";
import * as planValidator from "../plan-validator.js";
import * as specValidator from "../spec-validator.js";
import * as provValidator from "../prov-validator.js";
import * as docValidator from "../doc-validator.js";
import * as planNext from "../plan-next.js";
import * as specStatusModel from "../spec-status.js";
import { slugs } from "../artifacts.js";
import { blocking, summarize } from "../findings.js";

// `mgr spec validate` — valida artefato do PROJETO do usuário. Não confundir com `mgr validate`,
// que valida autoria de SKILL.md: são contratos diferentes (ADR-0012). Aqui só há parse de flag,
// formatação e exit code; descoberta, leitura e política vivem em src/plan-validator.js (INV-5).
export function specValidate({ root, cwd, flags, positional, io, M }) {
  const repo = root;
  const slug = flags.all ? null : (positional[0] || planValidator.slugFromCwd(repo, cwd));
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
    io.err(M.errorPrefix(M.specValidateNoSpecs(slug || path.join(repo, "specs"))));
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
    io.out(M.specValidateItem(finding.code, finding.severity, finding.task, finding.line, finding.message));
    io.out(M.specValidateFix(finding.remediation));
    for (const linha of finding.example.split("\n")) io.out(M.specValidateExample(linha));
  }
  if (!resultado.findings.length) io.out(M.specValidateOk(resultado.tasks, resultado.criteria, resultado.files.length));
  io.out(M.specValidateSummary(resultado.summary.errors, resultado.summary.warnings));
  io.out(io.style.dim(M.specValidateScopeNote));
  if (bloqueantes) io.out(M.specValidateNextSteps);
  return bloqueantes ? 1 : 0;
}

// `mgr spec next` — a próxima AÇÃO, não o estado (ADR-0014). Sem `--all`: a pergunta "o que faço
// agora" é sobre UMA feature. Aqui só há formatação e exit code; a decisão vive em src/plan-next.js.
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
    io.err(M.errorPrefix(M.specNextNoPlan(slug || path.join(repo, "specs"))));
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
// (ADR-0015). Aqui só há formatação e exit code; o modelo e o IO vivem em src/spec-status.js.
export function specStatus({ root, cwd, flags, positional, io, M }) {
  const repo = root;

  if (flags.all) {
    const todas = specStatusModel.statusAll(repo);
    if (!todas.length) {
      io.err(M.errorPrefix(M.specStatusEmpty(path.join(repo, "specs"))));
      return 1;
    }
    if (flags.json) {
      io.out(JSON.stringify({ schemaVersion: 1, basis: specStatusModel.BASIS, warning: M.specStatusWarning, features: todas }, null, 2));
      return 0;
    }
    for (const feature of todas) io.out(M.specStatusLine(feature.slug, resumoDeStatus(feature)));
    io.out("");
    io.out(M.specStatusWarning);
    return 0;
  }

  const slug = positional[0] || planValidator.slugFromCwd(repo, cwd);
  const resultado = specStatusModel.statusFor(repo, { slug });

  if (!resultado.found) {
    io.err(M.errorPrefix(M.specStatusNotFound(slug || "")));
    return 1;
  }

  if (flags.json) {
    io.out(JSON.stringify({ schemaVersion: 1, ...resultado, warning: M.specStatusWarning }, null, 2));
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
