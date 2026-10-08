#!/usr/bin/env node
// CLI do MGR — Método Governado por Rastreabilidade.
import { existsSync } from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import * as bundle from "../src/bundle.js";
import * as installer from "../src/installer.js";
import * as catalogo from "../src/catalog.js";
import { agents } from "../src/commands/agents.js";
import { specNext, specStatus, specValidate } from "../src/commands/spec.js";
import { detectHook, precompactHook, suggestionsFor } from "../src/commands/hooks.js";
import { escreverSync, lerPayload, modificados } from "./hook-io.js";
import { projectRoot } from "../src/project-root.js";
import { readAgents } from "../src/registry.js";
import * as tokens from "../src/tokens.js";
import * as audit from "../src/audit.js";
import { doctor } from "../src/commands/doctor.js";
import { sddCheck } from "../src/commands/sdd-check.js";
import { origin } from "../src/commands/origin.js";
import { buildRuntime, gateSummary, inheritingModel } from "../src/builder.js";
import { validateAll } from "../src/validator.js";
import { printBanner } from "../src/banner.js";
import { collectInstallAnswers, consentToRemove, detectUserLanguage, removalMode, removalOutcome, CANCELLED, OUTCOME_KEPT_BY_CHOICE, OUTCOME_KEPT_NO_CONSENT, OUTCOME_REMOVED, REMOVE } from "../src/prompts.js";
import { getMessages } from "../src/messages.js";
import {
  add as addPlugin, remove as removePlugin, restore as restorePlugins,
  installedPluginNames, CANCELLED_EXIT_CODE,
} from "../src/plugin-installer.js";
import {
  addRegistry, fetchIndex, listRegistries, readDetectionMode,
  readLawsPreamble, removeRegistry,
} from "../src/registry.js";
import { diff as lockfileDiff, readLockfile, replacedByEngine, LOCKFILE_NAME } from "../src/lockfile.js";
import { detect } from "../src/detector.js";
import { hookFilePath, removeHook, rewriteOwnedHooks, runtimeCommand, writeHook, writtenEvents } from "../src/hooks.js";
import { parseArgs } from "../src/cli-args.js";

const SCOPES = ["project", "global"];
// Comandos de skill plugável: o posicional é o nome da skill/registry, nunca o repositório.
const PLUGIN_COMMANDS = ["add", "remove", "registry"];
// Comandos cujo primeiro posicional é SUBCOMANDO, não repositório. Sem isto, `mgr spec validate`
// resolveria o repo como `<cwd>/validate`, o manifesto não seria encontrado e o `userLanguage` do
// projeto seria descartado — quebrando, só para o comando novo, a precedência
// flag > manifesto > locale que os demais respeitam.
const SUBCOMMAND_COMMANDS = ["spec", "agents", "tokens", "precompact", "origin"];
const isTTY = process.stdin.isTTY && process.stdout.isTTY;

// Tabela de mensagens da CLI. Começa pelo locale; o main refina com a precedência
// flag --user-language > manifesto (project > global) > locale.
let M = getMessages(detectUserLanguage(process.env));

// Adaptador real de prompts; o src/prompts.js o recebe injetado (nos testes, um stub).
const CLACK = {
  multiselect: p.multiselect,
  select: p.select,
  confirm: p.confirm,
  text: p.text,
  isCancel: p.isCancel,
};

function bail(msg) { p.cancel(msg || M.aborted); process.exit(0); }

// Motores que recebem hook nesta instalação: os escolhidos pelo usuário, menos o alvo
// `custom` do --skills-dir, e nenhum quando `--no-hooks`.
const hookEngines = (plan, flags) => (flags.noHooks
  ? []
  : plan.targets.map((target) => target.engine).filter((engine) => installer.ENGINES.includes(engine)));

async function cmdInstall(flags, positional) {
  const repo = path.resolve(positional[0] || ".");
  printBanner(M);
  p.intro(pc.bgCyan(pc.black(" mgr install ")));

  const found = installer.detect(repo);
  if (found.length) {
    p.note(found.map((f) => `[${f.scope}] ${f.path} — ${f.count} skill(s)`).join("\n"),
      M.existingSkillsTitle);
  }

  const skillsDir = flags.skillsDir ? path.resolve(flags.skillsDir) : null;
  let engines = flags.engines;
  let scope = flags.scope;
  let language = flags.language || null;
  let architecture = flags.arch || null;
  let userLanguage = flags.userLanguage || null;
  let projectId = flags.projectId || null;
  const optional = [];

  if (!skillsDir && isTTY && !flags.yes) {
    const answers = await collectInstallAnswers(
      CLACK,
      { engines, scope, language, architecture, userLanguage, projectId },
      { repo, allSkills: flags.allSkills, env: process.env, msg: M }
    );
    if (answers === CANCELLED) bail();
    ({ engines, scope, language, architecture, userLanguage, projectId } = answers);
    optional.push(...answers.optional);
    M = getMessages(userLanguage);
  }
  // Sem TTY/-y e sem flag: herda o locale — nunca grava null em instalação nova
  // (o backfill pt-BR do update é só para manifestos da era sem o campo).
  userLanguage = userLanguage || detectUserLanguage(process.env);
  if (!engines.length) engines = ["claude-code"];
  scope = scope || "project";
  if (!SCOPES.includes(scope)) { p.log.error(M.invalidScope(scope)); process.exit(1); }
  // Lido cedo de propósito: modo de detecção inválido falha ANTES de escrever qualquer coisa.
  const detectionMode = readDetectionMode(installer.coreDir(scope, repo));

  const prior = installer.detectPrior(scope, repo);
  if (prior) {
    const migrada = installer.needsRuntimeMigration(prior);
    if (prior.model === "runtime-launcher") p.log.warn(M.oldInstallWarn(prior.version));
    else if (!migrada) p.log.warn(M.resyncWarn);
    if (migrada) p.log.warn(M.runtimeMigrated(prior.version ?? "?", runtimeDirsOf(prior, repo)));
  }

  const replaced = replacedByEngine(readLockfile(repo));
  const plan = installer.planInstall(engines, scope, repo, { skillsDir, language, architecture, userLanguage, optional, all: flags.allSkills, projectId, replaced });
  const motoresComHook = hookEngines(plan, flags);
  // O que esta instalacao deixa de DECLARAR aparece no plano antes de qualquer escrita, inclusive
  // no --dry-run. O calculo vive no nucleo; aqui fica so a cola (CONSTITUTION secao 2.2), e o modo
  // e resolvido UMA vez: nenhum teste de terminal novo entra no fluxo.
  const abandonadas = installer.abandonedSkills({ prior, plan });
  const modoDeRemocao = removalMode({ isTTY, yes: flags.yes });
  p.note(
    [
      M.planProject(plan.projectId, plan.scope),
      M.planEngines(plan.engines.join(", ")),
      M.planStack(plan.language || "—", plan.architecture || "—"),
      `${M.planOutput(plan.userLanguage || "—")}  ${pc.dim(M.planOutputHint)}`,
      `${M.planConfig(installer.coreDir(plan.scope, plan.repo))}  ${pc.dim(M.planConfigHint)}`,
      ...plan.targets.map((t) => M.planSkillsDir(t.dir)),
      M.planSkills(plan.skills.length, plan.skills.join(", ")),
      ...(abandonadas.length
        ? [M.planAbandoned(abandonadas.map((saindo) => M.removalReason(saindo.name, saindo.class)))]
        : []),
      // O hook mora em arquivo do usuário; ele vê no plano o que será escrito antes de
      // confirmar, e pode abortar. Consentimento visível sem pergunta nova (ADR-0009).
      ...(motoresComHook.length
        ? [`${M.planHooks(motoresComHook.map((engine) => path.relative(plan.repo, hookFilePath(engine, plan.repo))).join(" · "))}  ${pc.dim(M.planHooksHint)}`]
        : []),
      // O runtime também é escrita em diretório do usuário: aparece no plano antes da confirmação.
      M.planRuntime(plan.targets.map((alvo) => path.relative(plan.repo, path.join(alvo.dir, ...catalogo.RUNTIME_DIR))).join(" · "), catalogo.RUNTIME_FILES.length + 1),
      // O agente também mora em diretório do usuário: ele vê modelo e esforço por motor
      // ANTES de confirmar, e vê o que o motor não suporta (ADR-0010).
      ...linhasDoGate(plan),
      // A fonte de leis e o preâmbulo também são escrita em arquivo do usuário: aparecem no
      // plano antes da confirmação, como o hook e o agente (ADR-0011).
      ...linhasDasLeis(plan),
    ].join("\n"),
    M.planTitle
  );

  if (flags.dryRun) { p.outro(pc.dim(M.dryRun)); return 0; }

  // O consentimento vem DEPOIS do retorno do dry-run e ANTES do confirm de instalacao: assim o que
  // sai e parte do plano que a pessoa confirma, e o --dry-run segue sem perguntar e sem escrever.
  const decisao = await consentToRemove(CLACK, abandonadas, { mode: modoDeRemocao, msg: M });
  if (decisao === CANCELLED) bail();
  const aRemover = decisao === REMOVE ? abandonadas : [];
  // O que fica em disco continua DECLARADO. Sem isto, recusar (ou nao ter terminal para perguntar)
  // criaria uma orfa NOVA, que nao tem remediacao, e a mensagem que cita o `-y` seria falsa: na
  // execucao seguinte o nome ja nao estaria no manifesto para virar candidato.
  const aManter = decisao === REMOVE ? [] : abandonadas;
  if (isTTY && !flags.yes) {
    const ok = await p.confirm({ message: M.confirmInstall });
    if (p.isCancel(ok) || !ok) bail();
  }

  const s = p.spinner();
  s.start(M.installing);
  // Nome que esta versao ja nao distribui sai do conjunto mantido: reconstrui-lo lancaria e a RECUSA
  // viraria erro de instalacao. Ele e ANUNCIADO abaixo, nunca descartado em silencio.
  const { mantidas, semFonte } = installer.splitKept(aManter);
  const res = installer.execute(installer.keepDeclared(plan, mantidas), { abandoned: aRemover });
  s.stop(M.installedAt(res.targets.map((t) => t.dir).join(" · ")));
  if (res.migrated) p.log.info(M.migrationInfo(res.migrated.removed.length));
  for (const item of res.runtime || []) p.log.success(M.runtimeWritten(path.relative(plan.repo, item.dir), item.files));
  // Os quatro caminhos saem 0: recusar a remocao nunca transforma a instalacao em erro. Escrita em
  // diretorio do usuario e anunciada, e o que NAO saiu tambem e — em silencio, viraria orfa.
  // A lista do "continua declarado" e a das MANTIDAS, nunca a das abandonadas: dizer que uma skill
  // que esta versao ja nao distribui "segue declarada" seria falso, e foi o que a medicao mostrou.
  const desfecho = removalOutcome({ removed: res.removed, abandoned: mantidas, mode: modoDeRemocao });
  const nomes = mantidas.map((saindo) => saindo.name);
  if (desfecho === OUTCOME_REMOVED) p.log.success(M.removedSkills(res.removed.map((alvo) => path.relative(plan.repo, alvo))));
  else if (desfecho === OUTCOME_KEPT_NO_CONSENT) p.log.warn(M.keptNoConsent(nomes));
  else if (desfecho === OUTCOME_KEPT_BY_CHOICE) p.log.info(M.keptByChoice(nomes));
  if (semFonte.length) p.log.warn(M.keptNoSource(semFonte.map((saindo) => saindo.name)));
  // Degradação declarada, uma vez por capacidade ausente — nunca em silêncio (ADR-0010).
  // Escrita em diretório do usuário é anunciada, como a do hook — LOG-1 do guia.
  for (const file of res.agents || []) {
    p.log.success(M.agentWritten(path.basename(file, path.extname(file)).replace(/\.agent$/, ""), path.relative(plan.repo, file)));
  }
  for (const aviso of res.gateWarnings || []) {
    if (aviso.blocked) p.log.warn(M.gateBlocked(path.relative(plan.repo, aviso.blocked)));
    else p.log.warn(M.gateSkipped(aviso.engine, aviso.capability));
  }

  for (const engine of motoresComHook) {
    const file = writeHook(engine, plan.repo, { command: runtimeCommand(engine, plan.repo, plan.scope) });
    p.log.success(M.hookWritten(path.relative(plan.repo, file), writtenEvents(engine).join(" · ")));
  }
  // O hook do repositório só carrega depois do folder trust; sem este aviso o usuário conclui,
  // com razão, que o MGR gravou algo quebrado (verificado por experimento — ADR-0009).
  if (motoresComHook.includes("copilot")) p.log.warn(M.hookCopilotTrust);

  if (readLockfile(plan.repo)) {
    p.log.step(M.restoring(LOCKFILE_NAME));
    const restored = await restoreLockedPlugins(plan.repo, plan.targets, (message) => p.log.warn(message));
    if (restored) p.log.success(M.restoreDone(restored.restored.length));
  }

  if (detectionMode === "suggest") await proposeDetected(plan.repo, plan.scope, plan.targets);
  p.outro(pc.green(M.done));
  return 0;
}


// Motores/pastas de destino das skills plugáveis: as flags mandam; sem flag, herda os
// motores da instalação do método neste escopo; sem instalação, claude-code.
function pluginTargets(flags, repo) {
  const scope = flags.scope || "project";
  if (!SCOPES.includes(scope)) { p.log.error(M.invalidScope(scope)); process.exit(1); }
  const prior = installer.detectPrior(scope, repo);
  const engines = (flags.engines.length ? flags.engines : (prior?.engines || []))
    .filter((engine) => installer.ENGINES.includes(engine));
  const chosen = engines.length ? engines : ["claude-code"];
  return { scope, targets: chosen.map((engine) => ({ engine, dir: installer.engineSkillsDir(engine, scope, repo) })) };
}

// Confirmação humana obrigatória do `mgr add` (ADR-0007): mostra origem, versão,
// permissões declaradas e checksum ANTES de qualquer escrita. Sem flag de bypass.
function pluginConfirmer() {
  return async (proposal) => {
    p.note([
      M.pluginProposalName(proposal.name, proposal.version),
      M.pluginProposalOrigin(proposal.origin.name, proposal.origin.url),
      M.pluginProposalTrust(proposal.origin.trusted === true),
      M.pluginProposalCategory(proposal.category),
      M.pluginProposalPermissions(proposal.permissions.length ? proposal.permissions.join(", ") : M.pluginNoPermissions),
      M.pluginProposalChecksum(proposal.checksum),
      M.pluginProposalEngines(proposal.engines.join(", ")),
      ...(proposal.extends ? [M.pluginProposalExtends(proposal.extends)] : []),
    ].join("\n"), M.pluginProposalTitle);
    const ok = await p.confirm({ message: M.pluginConfirm, initialValue: false });
    return !p.isCancel(ok) && ok === true;
  };
}

// Colisão com skill do método (ADR-0008): quem decide é o humano, e o default é a opção
// que não desfaz nada. Cancelar cai no mesmo caminho do `confirm` — nada é escrito.
function pluginCollisionResolver() {
  return async (collision) => {
    const choice = await p.select({
      message: M.pluginCollisionQuestion(collision.methodSkill),
      initialValue: "alongside",
      options: [
        { value: "alongside", label: M.pluginCollisionAlongside, hint: M.pluginCollisionAlongsideHint(collision.alongsideDir) },
        { value: "replace", label: M.pluginCollisionReplace, hint: M.pluginCollisionReplaceHint(collision.methodSkill) },
      ],
    });
    return p.isCancel(choice) ? null : choice;
  };
}

async function cmdAdd(flags, positional) {
  const name = positional[0];
  if (!name) { console.error(M.pluginUsageAdd); return 1; }
  // Sem TTY não há como confirmar, e confirmação é requisito de segurança da fase.
  if (!isTTY) { console.error(pc.red(M.errorPrefix(M.pluginNeedsTty))); return 1; }

  const repo = path.resolve(".");
  const { scope, targets } = pluginTargets(flags, repo);
  p.intro(pc.bgCyan(pc.black(" mgr add ")));
  p.log.step(M.pluginInstalling);

  let result;
  try {
    result = await addPlugin(name, {
      repo, coreDir: installer.coreDir(scope, repo), targets,
      fetchImpl: globalThis.fetch, confirm: pluginConfirmer(), resolveCollision: pluginCollisionResolver(),
    });
  } catch (error) {
    if (error.exitCode === CANCELLED_EXIT_CODE) { p.cancel(M.pluginCancelled); return CANCELLED_EXIT_CODE; }
    throw error;
  }

  for (const skill of result.installed) {
    p.log.success(M.pluginInstalled(skill.name, Object.values(skill.dirs).join(" · ")));
    for (const { engine, warning } of skill.warnings) p.log.warn(M.pluginWarning(engine, warning));
  }
  p.outro(pc.green(M.pluginLocked(path.relative(repo, result.lockfile) || result.lockfile)));
  return 0;
}


function cmdRemove(flags, positional) {
  const name = positional[0];
  if (!name) { console.error(M.pluginUsageRemove); return 1; }
  const repo = path.resolve(".");
  const scope = flags.scope || "project";
  if (!SCOPES.includes(scope)) { console.error(M.invalidScope(scope)); return 1; }
  // Alvos de TODOS os motores conhecidos: o remove honra os engines travados no lockfile
  // (entry.engines), não a instalação atual do método — sem pasta órfã se o conjunto de
  // motores mudou entre o add e o remove (review do bloco P1).
  const targets = installer.ENGINES.map((engine) => ({ engine, dir: installer.engineSkillsDir(engine, scope, repo) }));
  console.log(M.pluginRemoving(name));
  const result = removePlugin(name, { repo, targets });
  for (const dir of result.removed) console.log(pc.dim(M.removedItem(path.relative(repo, dir) || dir)));
  for (const { dir } of result.skipped) console.warn(M.pluginRemoveSkipped(path.relative(repo, dir) || dir, name));
  if (result.entry.replaces) console.warn(M.pluginRemoveReturns(result.entry.replaces));
  console.log(pc.green(M.pluginRemoved(name)));
  return 0;
}

// `mgr registry add|remove|list` — CRUD dos registries em .mgr-core/config.json (ADR-0005).
function cmdRegistry(flags, positional) {
  const [action, ...args] = positional;
  const repo = path.resolve(".");
  const scope = flags.scope || "project";
  if (!SCOPES.includes(scope)) { console.error(M.invalidScope(scope)); return 1; }
  const core = installer.coreDir(scope, repo);

  if (action === "add") {
    const [name, url] = args;
    if (!name || !url) { console.error(M.registryUsage); return 1; }
    console.log(M.registryAdding(name));
    addRegistry(core, { name, url, trusted: flags.trusted === true });
    console.log(pc.green(M.registryAdded(name, url)));
    return 0;
  }
  if (action === "remove") {
    const [name] = args;
    if (!name) { console.error(M.registryUsage); return 1; }
    console.log(M.registryRemoving(name));
    removeRegistry(core, name);
    console.log(pc.green(M.registryRemoved(name)));
    return 0;
  }
  if (action === "list") {
    const registries = listRegistries(core);
    if (!registries.length) { console.log(M.registryListEmpty); return 0; }
    console.log(pc.bold(M.registryListTitle));
    for (const registry of registries) console.log(M.registryListItem(registry.name, registry.url, registry.trusted));
    return 0;
  }
  console.error(M.registryUsage);
  return 1;
}


// `mgr list` — extensão ADITIVA (DT-2/CONSTITUTION 2.7): o catálogo do método sai igual;
// as seções de plugin só aparecem quando há lockfile ou registry configurado.
async function cmdList(_flags, positional) {
  bundle.skillNames().forEach((name) => console.log(name));
  const repo = path.resolve(positional[0] || ".");

  const lockfile = readLockfile(repo);
  const installed = Object.entries(lockfile?.skills || {});
  if (installed.length) {
    console.log("");
    console.log(pc.bold(M.pluginsInstalledTitle));
    for (const [name, entry] of installed) {
      console.log(M.pluginsInstalledItem(name, entry.version, entry.registry, entry.dir));
    }
  }

  const registries = listRegistries(installer.coreDir("project", repo));
  if (!registries.length) return 0;
  console.log("");
  console.log(pc.bold(M.pluginsAvailableTitle));
  for (const registry of registries) {
    try {
      const index = await fetchIndex(registry.url, { fetchImpl: globalThis.fetch });
      for (const [category, entries] of Object.entries(index.categories)) {
        for (const entry of entries) console.log(M.pluginsAvailableItem(entry.name, entry.version, category));
      }
    } catch (error) {
      // Registry fora do ar não derruba o `list`: a parte local do comando já foi entregue.
      console.log(pc.dim(M.pluginsAvailableError(registry.name, error.message)));
    }
  }
  return 0;
}


// Restauração do conjunto travado (DT-2/ADR-0006 §4): `install` e `update` reinstalam os
// plugins do `mgr-skills.lock` quando o arquivo existe. Sem lockfile, no-op absoluto —
// é o que mantém a saída de quem não usa plugins idêntica à de hoje (CONSTITUTION 2.7).
async function restoreLockedPlugins(repo, targets, warn) {
  const result = await restorePlugins({ repo, targets, fetchImpl: globalThis.fetch });
  for (const skill of result?.restored || []) {
    if (skill.skippedEngines.length) warn(M.restoreSkippedEngine(skill.name, skill.skippedEngines.join(", ")));
  }
  return result?.restored.length ? result : null;
}

// `mgr detect` — le o projeto e mostra o que o registry oferece para o que foi detectado.
// NAO ESCREVE NADA: nem lockfile, nem config, nem pasta de motor. Com `--hook <motor>`,
// emite o relatorio no formato daquele motor, que e o que o hook de sessao consome.
async function cmdDetect(flags, positional) {
  // O ramo do hook vive na cola testável (src/commands/hooks.js); este ramo é saída de terminal.
  if (flags.hook) return detectHook({ ...commandIo(flags, positional), proc: hookProc });

  const repo = positional[0] ? path.resolve(positional[0]) : projectRoot(process.cwd()).root;
  const detected = detect(repo);

  if (!detected.length) { console.log(M.detectNothing); return 0; }
  console.log(pc.bold(M.detectTitle));
  for (const item of detected) console.log(M.detectItem(item.ecosystem, item.evidence));

  const { suggestions, unreachable } = await suggestionsFor(repo, detected);
  console.log("");
  // Registry fora do ar e REPORTADO, como no `list`: sem isso o usuario leria "nenhuma skill
  // corresponde" quando a verdade e "nao consegui falar com o registry".
  for (const falha of unreachable) console.log(pc.dim(M.pluginsAvailableError(falha.registry, falha.reason)));
  if (!suggestions.length) { console.log(M.suggestNone); return 0; }
  console.log(pc.bold(M.suggestTitle));
  for (const item of suggestions) console.log(M.suggestItem(item.name, item.version, item.ecosystem, item.evidence));
  return 0;
}
// Sugestão ao fim do install (ADR-0009). Aceitar entra no MESMO fluxo do `mgr add`: a
// confirmação que mostra origem, permissões e checksum continua sendo a última palavra, e
// esta feature não cria um segundo caminho de instalação.
async function proposeDetected(repo, scope, targets) {
  const detected = detect(repo);
  if (!detected.length) return;

  const { suggestions: sugestoes } = await suggestionsFor(repo, detected);
  if (!sugestoes.length) return;

  p.note(
    sugestoes.map((item) => M.suggestItem(item.name, item.version, item.ecosystem, item.evidence)).join("\n"),
    M.suggestTitle,
  );
  if (!isTTY) { p.log.info(M.suggestNonInteractive); return; }

  const motores = targets.filter((target) => installer.ENGINES.includes(target.engine));
  if (!motores.length) return;

  let instaladas = 0;
  for (const item of sugestoes) {
    const aceito = await p.confirm({ message: M.suggestConfirm(item.name), initialValue: false });
    if (p.isCancel(aceito) || !aceito) continue;
    const resultado = await addPlugin(item.name, {
      repo, coreDir: installer.coreDir(scope, repo), targets: motores,
      fetchImpl: globalThis.fetch, confirm: pluginConfirmer(), resolveCollision: pluginCollisionResolver(),
    });
    for (const skill of resultado.installed) {
      p.log.success(M.pluginInstalled(skill.name, Object.values(skill.dirs).join(" · ")));
      for (const { engine, warning } of skill.warnings) p.log.warn(M.pluginWarning(engine, warning));
    }
    instaladas += resultado.installed.length;
  }
  if (!instaladas) p.log.info(M.suggestSkipped);
}

// IO dos comandos montado na borda (Humble Object): raiz do projeto, cwd, flags, mensagens e saída.
// As colas testáveis vivem em src/commands/*.js e recebem este objeto.
const commandIo = (flags, positional) => ({
  root: projectRoot(process.cwd()).root,
  cwd: process.cwd(),
  flags,
  positional,
  M,
  io: {
    out: (l) => console.log(l),
    err: (l) => console.error(l),
    style: { dim: pc.dim, yellow: pc.yellow, green: pc.green, red: pc.red, bold: pc.bold },
    invocation: "mgr",
    lifecycle: "mgr",
  },
});
// `mgr spec validate` — valida artefato do PROJETO do usuário. Não confundir com `mgr validate`,
// que valida autoria de SKILL.md: são contratos diferentes (ADR-0012). Descoberta, leitura e
// política vivem em src/plan-validator.js (INV-5); a cola vive em src/commands/spec.js.
const cmdSpecValidate = (flags, positional) => specValidate(commandIo(flags, positional));

// Linhas das leis no plano de instalação: onde elas são gravadas e se o preâmbulo está ligado.
// Vazio quando só há o motor `custom`.
function linhasDasLeis(plan) {
  const motores = plan.targets.filter((alvo) => alvo.engine !== "custom");
  if (!motores.length) return [];
  const dirs = motores.map((alvo) => path.relative(plan.repo, path.join(alvo.dir, ...catalogo.LAWS_INSTALLED)));
  const ligado = readLawsPreamble(installer.coreDir(plan.scope, plan.repo)).enabled;
  return [
    `${M.planLaws([...new Set(dirs)].join(" · "))}  ${pc.dim(M.planLawsHint)}`,
    ligado ? M.planPreambleOn : M.planPreambleOff,
  ];
}

// Três estados por campo, não dois: ter valor, herdar por escolha, e o MOTOR não sustentar.
// Colapsar os dois últimos fazia o plano dizer "esforço da sessão" do copilot, que não tem o campo
// — o valor declarado pelo autor era descartado e a tela onde ele confirma não dizia nada (RN-3).
//
// Esta função serve o plano do install E o `mgr status`. O `cmdAgents` já distinguia; corrigir só
// lá teria deixado a mentira viva nas duas superfícies que importam mais.
function linhaDoMotor(engine, gate, formato = M.planGateEngine) {
  const { model, effort, skipped } = gateSummary(engine, gate);
  const texto = (valor, campo, herdado) =>
    valor || (skipped.includes(campo) ? M.agentsUnsupported : herdado);
  return formato(
    engine,
    texto(model, "model", M.gateModelInherited),
    texto(effort, "effort", M.gateEffortInherited),
  );
}

// O plano lista UMA linha por intenção ligada e por motor, e não só a do gate (ADR-0017, §5).
// Três agentes eram escritos e um era anunciado: o plano é a superfície de consentimento, e
// consentir com um enquanto três são gravados não é consentir.
function linhasDoGate(plan) {
  const policies = plan.agents?.policies;
  const motores = plan.engines.filter((engine) => engine !== "custom");
  const ligadas = catalogo.INTENTS.filter((intent) => policies?.[intent]?.enabled);
  if (!ligadas.length || !motores.length) return [];
  const dirs = motores.map((engine) => path.relative(plan.repo, installer.engineAgentsDir(engine, plan.scope, plan.repo)));
  const linhas = [`${M.planGate([...new Set(dirs)].join(" · "))}  ${pc.dim(M.planGateHint)}`];
  for (const intent of ligadas) {
    linhas.push(M.planAgentIntent(intent, catalogo.AGENTS[intent].agent));
    for (const engine of motores) linhas.push(`  ${linhaDoMotor(engine, policies[intent])}`);
  }
  // O plano é a superfície de consentimento: quem confirma precisa saber que está aceitando três
  // agentes rodando no modelo da sessão, e o que fazer se não quiser isso.
  const herdando = inheritingModel(ligadas, motores, policies);
  if (herdando.length) linhas.push(pc.yellow(M.agentsInheritWarning(herdando.join(", "))));
  return linhas;
}

// `mgr spec next` — a próxima AÇÃO, não o estado (ADR-0014). Sem `--all`: a pergunta "o que faço
// agora" é sobre UMA feature. Aqui só há formatação e exit code; a decisão vive em src/plan-next.js.
const cmdSpecNext = (flags, positional) => specNext(commandIo(flags, positional));

// `mgr spec status` — delegação à cola testável em src/commands/spec.js.
const cmdSpecStatus = (flags, positional) => specStatus(commandIo(flags, positional));

// `mgr agents` — delegação à cola testável em src/commands/agents.js.
const cmdAgents = (flags, positional) => agents(commandIo(flags, positional));

// IO de processo dos hooks, injetado na cola (src/commands/hooks.js). A borda é quem sabe de stdin,
// fds e git (ADR-0018, "Git é da BORDA").
const hookProc = {
  escreverSync, lerPayload, modificados, stdoutFd: 1, stderrFd: 2,
  write: (texto) => process.stdout.write(texto),
};

// `mgr precompact --hook <motor>` — delegação à cola testável em src/commands/hooks.js.
const cmdPrecompact = (flags) => precompactHook({ ...commandIo(flags, []), proc: hookProc });

// `mgr origin` — delegação à cola testável em src/commands/origin.js (despacha `set` lá dentro).
const cmdOrigin = (flags, positional) => origin(commandIo(flags, positional));

// `mgr tokens` — quanto o fluxo consumiu (ADR-0017). O PRIMEIRO transcript é o da conversa; os
// demais são os dos agentes que ela subiu. Medir só a conversa contaria a economia e esconderia o
// custo, porque agente não compartilha contexto.
//
// A decisão vive em `src/tokens.js`; aqui só se escolhe a palavra e o exit code.
function cmdTokens(flags, positional) {
  if (!positional.length) {
    console.error(M.errorPrefix(M.tokensNoInput));
    return 1;
  }
  // Caminho que não existe é ERRO DE ENTRADA, não medição zero: um erro de digitação sairia com
  // `total 0` e cara de medida real. O núcleo tolera arquivo ausente de propósito — um transcript
  // de agente pode ainda não ter sido escrito —, e essa tolerância é dele, não da borda.
  const ausentes = positional.filter((caminho) => !existsSync(caminho));
  if (ausentes.length) {
    console.error(M.errorPrefix(M.tokensMissing(ausentes.join(", "))));
    return 1;
  }

  const [conversation, ...agents] = positional;
  const medicao = tokens.summarize({ conversation, agents });
  const { budget } = readAgents(installer.coreDir("project", projectRoot(process.cwd()).root));
  const teto = budget?.totalTokens ?? null;
  const veredito = tokens.verdict(medicao, teto);

  if (flags.json) {
    console.log(JSON.stringify({ schemaVersion: 1, ...medicao, budget: teto, verdict: veredito }, null, 2));
    return veredito === tokens.OVER_BUDGET ? 1 : 0;
  }

  console.log(M.tokensTotal(medicao.total));
  console.log(M.tokensConversation(medicao.conversationContext, medicao.conversationTotal));
  console.log(M.tokensAgents(medicao.agentsTotal, medicao.agentsCounted));
  console.log(pc.dim(M.tokensCacheRead(medicao.cacheRead)));
  console.log("");
  if (veredito === tokens.NO_BUDGET) console.log(pc.dim(M.tokensNoBudget));
  else if (veredito === tokens.WITHIN_BUDGET) console.log(pc.green(M.tokensWithin(medicao.total, teto)));
  else console.log(pc.red(M.tokensOver(medicao.total, teto)));
  return veredito === tokens.OVER_BUDGET ? 1 : 0;
}

function cmdSpec(flags, positional) {
  const sub = positional[0];
  if (sub === "validate") return cmdSpecValidate(flags, positional.slice(1));
  if (sub === "next") return cmdSpecNext(flags, positional.slice(1));
  if (sub === "status") return cmdSpecStatus(flags, positional.slice(1));
  console.error(M.errorPrefix(M.unknownCommand(`spec ${sub || ""}`.trim())));
  return 1;
}

function cmdStatus(_f, positional) {
  const repo = positional[0] ? path.resolve(positional[0]) : projectRoot(process.cwd()).root;
  let shown = false;
  for (const scope of SCOPES) {
    for (const man of installer.installs(scope, repo)) {
      shown = true;
      const model = man.model === "runtime-launcher" ? M.statusOldModel : (man.model || "self-contained");
      console.log(pc.bold(`[${scope}]`) + ` MGR v${man.version} — ${(man.engines || [man.engine]).join(", ")} — ${model}`);
      console.log(M.statusProject(man.projectId || "—"));
      console.log(M.statusConfig(man.core));
      if (man.language || man.architecture) console.log(M.statusStack(man.language || "—", man.architecture || "—"));
      if (man.userLanguage) console.log(M.statusOutput(man.userLanguage));
      for (const d of man.skillsDirs || [man.skillsDir]) if (d) console.log(M.statusSkillsDir(d));
      console.log(M.statusSkills((man.skills || []).join(", ")));
      // O gate é respondido a partir do config + manifest, sem abrir o arquivo do agente.
      // A política de CADA intenção, da mesma fonte que a instalação usa. Reportar a do apelido
      // fazia o `status` responder sobre uma política diferente da que está no disco.
      const { policies } = readAgents(man.core);
      const ligadas = catalogo.INTENTS.filter((intent) => policies[intent].enabled);
      if (!ligadas.length) {
        console.log(M.statusGate(M.statusGateOff));
      } else if ((man.agents || []).length) {
        console.log(M.statusGate((man.agents || []).join(" · ")));
        for (const intent of ligadas) {
          console.log(M.planAgentIntent(intent, catalogo.AGENTS[intent].agent));
          for (const engine of (man.engines || [man.engine]).filter(Boolean)) {
            if (engine === "custom") continue;
            console.log(`  ${linhaDoMotor(engine, policies[intent], M.statusGateEngine)}`);
          }
        }
      }
      const preambulo = readLawsPreamble(man.core);
      console.log(M.statusLaws(preambulo.enabled ? M.planPreambleOn.trim() : M.planPreambleOff.trim()));
      console.log(M.statusInstalledAt(man.installedAt));
    }
  }
  const lockfile = readLockfile(repo);
  const plugins = Object.entries(lockfile?.skills || {});
  if (plugins.length) {
    // Plugin travado é instalação encontrada: sem isto o status listaria os plugins e logo
    // depois afirmaria "nenhuma instalação encontrada", saindo 1 num projeto que TEM algo.
    shown = true;
    console.log(M.statusPluginsTitle(LOCKFILE_NAME));
    for (const [name, entry] of plugins) {
      console.log(entry.replaces
        ? M.statusPluginItemReplacing(name, entry.version, entry.registry, entry.replaces)
        : M.statusPluginItem(name, entry.version, entry.registry));
    }
    // Divergência entre o contrato do time e ESTA máquina é reportada, nunca corrigida em
    // silêncio (RN-8): quem decide restaurar é o usuário.
    const alvos = installer.ENGINES.map((engine) => ({ engine, dir: installer.engineSkillsDir(engine, "project", repo) }));
    const ausentes = lockfileDiff(lockfile, installedPluginNames(lockfile, alvos)).missing;
    if (ausentes.length) {
      console.log(M.statusDivergenceTitle);
      for (const name of ausentes) console.log(M.statusDivergenceItem(name));
      console.log(M.statusDivergenceHint);
    }
  }
  if (!shown) { console.log(M.statusNone); return 1; }
  return 0;
}

// Diretórios do runtime que a migração vai criar, a partir dos alvos que o manifesto anterior declarou.
const runtimeDirsOf = (prior, repo) =>
  (prior.skillsDirs || [])
    .map((dir) => path.relative(repo, path.join(path.resolve(repo, dir), ...catalogo.RUNTIME_DIR)))
    .join(" · ");

async function cmdUpdate(flags, positional) {
  const repo = positional[0] ? path.resolve(positional[0]) : projectRoot(process.cwd()).root;
  let scope = flags.scope;
  if (!scope) {
    scope = installer.detectPrior("global", repo) && !installer.detectPrior("project", repo)
      ? "global" : "project";
  }
  const prior = installer.detectPrior(scope, repo);
  const migrar = installer.needsRuntimeMigration(prior);
  if (migrar) {
    console.log(M.runtimeMigrated(prior.version ?? "?", runtimeDirsOf(prior, repo)));
  }
  const res = installer.update(scope, repo, { replaced: replacedByEngine(readLockfile(repo)) });
  if (migrar) {
    // Só as entradas do MGR que já existem recebem o comando novo; nenhum evento é criado (DT-13).
    for (const engine of new Set(res.targets.map((t) => t.engine).filter((e) => installer.ENGINES.includes(e)))) {
      const reescrito = rewriteOwnedHooks(engine, repo, { command: runtimeCommand(engine, repo, scope) });
      if (reescrito) {
        console.log(pc.dim(M.hookWritten(path.relative(repo, reescrito.file), reescrito.events.join(" · "))));
      }
    }
  }
  if (res.migrated) console.log(pc.dim(M.updateMigrated));
  console.log(pc.green(M.updateDone(scope, res.skills.length, res.targets.map((t) => t.dir).join(" · "))));

  // O `update` reescreve o frontmatter dos agentes a partir do config, e fazia isso em SILÊNCIO:
  // quem ajustava o modelo não via confirmação nenhuma de que pegou (ADR-0017). Só o que de fato
  // mudou é impresso — relatar o que ficou igual encheria a saída de linha sem informação.
  for (const mudanca of res.agentChanges || []) {
    if (!mudanca.before) { console.log(pc.dim(M.agentCreated(mudanca.agent, mudanca.engine))); continue; }
    for (const campo of ["model", "effort"]) {
      if (mudanca.before[campo] === mudanca.after[campo]) continue;
      console.log(M.agentChanged(mudanca.agent, mudanca.engine, campo, mudanca.before[campo], mudanca.after[campo]));
    }
  }

  if (readLockfile(repo)) {
    console.log(M.restoring(LOCKFILE_NAME));
    const restored = await restoreLockedPlugins(repo, res.targets, (message) => console.warn(message));
    if (restored) console.log(pc.green(M.restoreDone(restored.restored.length)));
  }
  return 0;
}

async function cmdUninstall(flags, positional) {
  const repo = path.resolve(positional[0] || ".");
  const scope = flags.scope || "project";
  if (isTTY && !flags.yes) {
    const ok = await p.confirm({ message: M.uninstallConfirm(scope), initialValue: false });
    if (p.isCancel(ok) || !ok) bail();
  }
  const res = installer.uninstall(scope, repo);
  for (const r of res.removed) console.log(pc.dim(M.removedItem(r)));
  for (const engine of installer.ENGINES) {
    // Os eventos vêm do núcleo, como na escrita: remontá-los aqui duplicaria a regra de quais
    // eventos o método usa, que foi a reprovação do gate do bloco P1.
    const eventos = writtenEvents(engine).join(" · ");
    const file = removeHook(engine, repo);
    if (file) console.log(pc.dim(M.hookRemoved(path.relative(repo, file), eventos)));
  }
  console.log(pc.green(M.uninstalled));
  return 0;
}

function cmdBuild(flags) {
  const dest = path.resolve(flags.out || "dist/mgr-runtime");
  const names = buildRuntime(dest);
  console.log(M.buildDone(dest, names.join(", ")));
  return 0;
}

// `mgr audit` — a Camada 1 da defesa do ADR-0007, e o comparador que aquele ADR situou na Fase 2.
//
// A borda faz o que a §2.2 manda: despacha, formata e devolve exit code. A inferência, a comparação
// e a leitura das skills vivem em `src/audit.js` — e o `done_when` desta task proíbe o contrário.
//
// **Só `EXCEEDS` sai com 1.** O ADR-0007 manda "bloqueio ou warning forte" para "declarou X e
// detectou X+Y", e para "não declarou" manda CONFIRMAÇÃO OBRIGATÓRIA, que é exigência do fluxo de
// instalação e não falha de gate.
function cmdAudit(flags) {
  const resultados = audit.auditAll();
  const bloqueia = audit.blocks(resultados);

  if (flags.json) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      classes: audit.CLASSES,
      blocks: bloqueia,
      skills: resultados,
    }, null, 2));
    return bloqueia ? 1 : 0;
  }

  const cor = { [audit.EXCEEDS]: pc.red, [audit.UNDECLARED]: pc.yellow, [audit.MATCHES]: pc.green };
  for (const { name, outcome, branch, inferred, declared, undeclared, findings } of resultados) {
    // O `branch` é nulo quando o arquivo não abre, então a mensagem é própria.
    if (outcome === audit.UNREADABLE) {
      console.log(`${pc.yellow("?")} ${name} — SKILL.md não pôde ser lido`);
      continue;
    }
    if (branch === audit.NOTHING_TO_DECLARE) {
      console.log(`${pc.green("✓")} ${name} — nenhuma das quatro classes`);
      continue;
    }
    console.log(cor[branch](`• ${name} — ${branch}`));
    if (declared.length) console.log(`    declarado:     ${declared.join(", ")}`);
    // `inferred`, e não `undeclared`: este é o conjunto inferido, e o que sobra sai na linha abaixo.
    console.log(`    inferido:      ${inferred.join(", ")}`);
    if (undeclared.length && undeclared.length !== inferred.length) {
      console.log(`    não declarado: ${undeclared.join(", ")}`);
    }
    // O trecho e a linha de cada achado, porque quem julga é o humano e ele precisa do fato para
    // descartar um falso positivo em segundos. É o veto do ADR-0007 a prometer scanner que garante
    // segurança, virando forma de saída.
    for (const { capability, line, excerpt } of findings) {
      console.log(pc.dim(`      ${capability} · linha ${line}: ${excerpt}`));
    }
  }

  console.log("");
  console.log("A inferência é a fonte de verdade (ADR-0007); a declaração é a afirmação que ela confere.");
  console.log("Ausência de achado NÃO é atestado de segurança: a análise tem falsos positivos e negativos.");
  return bloqueia ? 1 : 0;
}

function cmdValidate() {
  let ok = true;
  for (const [name, problems] of Object.entries(validateAll())) {
    if (problems.length) {
      ok = false;
      console.log(pc.red(`✗ ${name}`));
      for (const pr of problems) console.log(`    - ${pr}`);
    } else console.log(pc.green(`✓ ${name}`));
  }
  return ok ? 0 : 1;
}

async function main() {
  // DT-10: um dist/ gerado para outra versão do package.json ao lado não roda nenhum comando.
  const versaoBundle = bundle.buildVersion();
  if (versaoBundle !== null) {
    const versaoPacote = bundle.packageVersion();
    if (versaoPacote !== versaoBundle) {
      console.error(`dist/mgr.min.js foi gerado para ${versaoBundle} e o pacote está em ${versaoPacote}: rode npm run build`);
      return 1;
    }
  }
  const [, , command, ...rest] = process.argv;
  const { flags, positional, unknownFlag } = parseArgs(rest, { engines: installer.ENGINES });
  if (unknownFlag) { console.error(M.unknownFlag(unknownFlag)); process.exit(1); }
  // Refina o idioma da CLI: flag > manifesto (project > global) > locale (default acima).
  const semRepoPosicional = PLUGIN_COMMANDS.includes(command) || SUBCOMMAND_COMMANDS.includes(command);
  const repo = !semRepoPosicional && positional[0] ? path.resolve(positional[0]) : projectRoot(process.cwd()).root;
  // Manifesto corrompido não pode derrubar o processo ANTES do try: num hook, um stack trace no
  // stderr é exatamente o ruído no contexto do agente que a DT-8 do ADR-0018 quer impedir.
  let manifestLang = null;
  try {
    manifestLang = installer.detectPrior("project", repo)?.userLanguage
      || installer.detectPrior("global", repo)?.userLanguage;
  } catch { /* idioma cai para o locale, que é o default de sempre */ }
  M = getMessages(flags.userLanguage || manifestLang || detectUserLanguage(process.env));
  try {
    switch (command) {
      case "install": return await cmdInstall(flags, positional);
      case "add": return await cmdAdd(flags, positional);
      case "remove": return cmdRemove(flags, positional);
      case "registry": return cmdRegistry(flags, positional);
      case "detect": return await cmdDetect(flags, positional);
      case "precompact": return await cmdPrecompact(flags);
      case "status": return cmdStatus(flags, positional);
      case "update": return await cmdUpdate(flags, positional);
      case "uninstall": return await cmdUninstall(flags, positional);
      case "build": return cmdBuild(flags);
      case "validate": return cmdValidate();
      case "audit": return cmdAudit(flags);
      case "doctor": return doctor({ ...commandIo(flags, positional), root: repo });
      case "sdd-check": return sddCheck({ ...commandIo(flags, positional), root: repo });
      case "spec": return cmdSpec(flags, positional);
      case "agents": return cmdAgents(flags, positional);
      case "origin": return cmdOrigin(flags, positional);
      case "tokens": return cmdTokens(flags, positional);
      case "list": return await cmdList(flags, positional);
      case "version": case "--version": case "-v":
        console.log(`mgr-method ${bundle.readVersion()}`); return 0;
      case undefined: case "help": case "--help": case "-h":
        printBanner(M); process.stdout.write(M.help); return 0;
      default:
        console.error(M.unknownCommand(command)); process.stdout.write(M.help); return 1;
    }
  } catch (e) {
    console.error(pc.red(M.errorPrefix(e.message)));
    return 1;
  }
}

main().then((code) => process.exit(code ?? 0));
