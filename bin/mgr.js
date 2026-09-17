#!/usr/bin/env node
// CLI do MGR — Método Governado por Rastreabilidade.
import { existsSync, writeSync } from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";
import * as bundle from "../src/bundle.js";
import * as installer from "../src/installer.js";
import * as catalogo from "../src/catalog.js";
import * as planValidator from "../src/plan-validator.js";
import * as specValidator from "../src/spec-validator.js";
import * as provValidator from "../src/prov-validator.js";
import * as docValidator from "../src/doc-validator.js";
import * as planNext from "../src/plan-next.js";
import * as specStatus from "../src/spec-status.js";
import { repoRoot, slugs } from "../src/artifacts.js";
import { CONFIGURED, readAgents, writeAgentPolicy } from "../src/registry.js";
import * as tokens from "../src/tokens.js";
import { ids as engineIds } from "../src/engines/index.js";
import { blocking, summarize } from "../src/findings.js";
import { buildRuntime, gateSummary, inheritingModel } from "../src/builder.js";
import { validateAll } from "../src/validator.js";
import { printBanner } from "../src/banner.js";
import { collectInstallAnswers, detectUserLanguage, CANCELLED } from "../src/prompts.js";
import { getMessages } from "../src/messages.js";
import {
  add as addPlugin, remove as removePlugin, restore as restorePlugins,
  installedPluginNames, CANCELLED_EXIT_CODE,
} from "../src/plugin-installer.js";
import {
  addRegistry, fetchIndex, lawsFallbackRef, listRegistries, readDetectionMode,
  readLawsPreamble, removeRegistry,
} from "../src/registry.js";
import { diff as lockfileDiff, readLockfile, replacedByEngine, LOCKFILE_NAME } from "../src/lockfile.js";
import { collectSuggestions, detect, hookReport, lawsPreamble } from "../src/detector.js";
import { hookFilePath, removeHook, writeHook, writtenEvents } from "../src/hooks.js";
import { ASSEMBLED, assemble, decide, notice, persist, readStamp, writeStamp } from "../src/precompact.js";
import * as contexto from "../src/context-manifest.js";
import { readManifest } from "../src/manifest.js";

const SCOPES = ["project", "global"];
// Comandos de skill plugável: o posicional é o nome da skill/registry, nunca o repositório.
const PLUGIN_COMMANDS = ["add", "remove", "registry"];
// Comandos cujo primeiro posicional é SUBCOMANDO, não repositório. Sem isto, `mgr spec validate`
// resolveria o repo como `<cwd>/validate`, o manifesto não seria encontrado e o `userLanguage` do
// projeto seria descartado — quebrando, só para o comando novo, a precedência
// flag > manifesto > locale que os demais respeitam.
const SUBCOMMAND_COMMANDS = ["spec", "agents", "tokens", "precompact"];
const isTTY = process.stdin.isTTY && process.stdout.isTTY;

// Glue: junta os dados que o nucleo precisa. A decisao de como combinar e do detector.
const suggestionsFor = (repo, detected) => collectSuggestions(
  detected,
  listRegistries(installer.coreDir("project", repo)),
  readLockfile(repo),
  { fetchImpl: globalThis.fetch, fetchIndexImpl: fetchIndex },
);

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

function parseArgs(argv) {
  const flags = { engines: [] };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-y" || a === "--yes") flags.yes = true;
    else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--engine") flags.engines.push(...argv[++i].split(","));
    else if (a === "--scope") flags.scope = argv[++i];
    else if (a === "--skills-dir") flags.skillsDir = argv[++i];
    else if (a === "--language") flags.language = argv[++i];
    else if (a === "--user-language") flags.userLanguage = argv[++i];
    else if (a === "--arch") flags.arch = argv[++i];
    else if (a === "--project-id") flags.projectId = argv[++i];
    else if (a === "--all-skills") flags.allSkills = true;
    else if (a === "--trusted") flags.trusted = true;
    else if (a === "--hook") flags.hook = argv[++i];
    else if (a === "--no-hooks") flags.noHooks = true;
    else if (a === "--strict") flags.strict = true;
    else if (a === "--all") flags.all = true;
    else if (a === "--json") flags.json = true;
    else if (a === "--out") flags.out = argv[++i];
    else if (a === "--model") flags.model = argv[++i];
    else if (a === "--effort") flags.effort = argv[++i];
    else if (a.startsWith("-")) { console.error(M.unknownFlag(a)); process.exit(1); }
    else positional.push(a);
  }
  // compat: --engine both = os dois motores
  flags.engines = flags.engines.flatMap((e) => (e === "both" ? installer.ENGINES : [e]));
  return { flags, positional };
}

function bail(msg) { p.cancel(msg || M.aborted); process.exit(0); }

// Comando que o hook vai executar. A borda é quem sabe como o CLI foi invocado; o núcleo
// recebe isso pronto. O caminho absoluto é aceitável porque o arquivo de hook é local à
// máquina e gitignored — não viaja para o time.
const mgrCommand = () => `node "${process.argv[1]}"`;

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
    if (prior.model === "runtime-launcher") p.log.warn(M.oldInstallWarn(prior.version));
    else p.log.warn(M.resyncWarn);
  }

  const replaced = replacedByEngine(readLockfile(repo));
  const plan = installer.planInstall(engines, scope, repo, { skillsDir, language, architecture, userLanguage, optional, all: flags.allSkills, projectId, replaced });
  const motoresComHook = hookEngines(plan, flags);
  p.note(
    [
      M.planProject(plan.projectId, plan.scope),
      M.planEngines(plan.engines.join(", ")),
      M.planStack(plan.language || "—", plan.architecture || "—"),
      `${M.planOutput(plan.userLanguage || "—")}  ${pc.dim(M.planOutputHint)}`,
      `${M.planConfig(installer.coreDir(plan.scope, plan.repo))}  ${pc.dim(M.planConfigHint)}`,
      ...plan.targets.map((t) => M.planSkillsDir(t.dir)),
      M.planSkills(plan.skills.length, plan.skills.join(", ")),
      // O hook mora em arquivo do usuário; ele vê no plano o que será escrito antes de
      // confirmar, e pode abortar. Consentimento visível sem pergunta nova (ADR-0009).
      ...(motoresComHook.length
        ? [`${M.planHooks(motoresComHook.map((engine) => path.relative(plan.repo, hookFilePath(engine, plan.repo))).join(" · "))}  ${pc.dim(M.planHooksHint)}`]
        : []),
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
  if (isTTY && !flags.yes) {
    const ok = await p.confirm({ message: M.confirmInstall });
    if (p.isCancel(ok) || !ok) bail();
  }

  const s = p.spinner();
  s.start(M.installing);
  const res = installer.execute(plan);
  s.stop(M.installedAt(res.targets.map((t) => t.dir).join(" · ")));
  if (res.migrated) p.log.info(M.migrationInfo(res.migrated.removed.length));
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
    const file = writeHook(engine, plan.repo, { command: mgrCommand() });
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
  const repo = path.resolve(positional[0] || ".");
  const detected = detect(repo);

  if (flags.hook) {
    // Falha aqui nao pode poluir nem derrubar a sessao do agente: no pior caso, silencio.
    try {
      // O preâmbulo das leis entra ANTES do relatório, no mesmo canal do motor (ADR-0011).
      // Desligado, a saída volta a ser exatamente a de antes — nem uma linha a mais.
      const core = installer.coreDir("project", repo);
      const ligado = readLawsPreamble(core).enabled;
      const referencia = installer.installedLawsRef(flags.hook, "project", repo) || lawsFallbackRef();
      process.stdout.write(hookReport(
        (await suggestionsFor(repo, detected)).suggestions,
        flags.hook,
        { preamble: ligado ? lawsPreamble(referencia) : null },
      ));
    } catch {
      return 0;
    }
    return 0;
  }

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

// Linhas do gate no plano de instalação: um resumo por motor, com o que não se aplica dito
// em vez de omitido. Vazio quando o gate está desligado — o plano fica igual ao de antes.
// Formatação de uma linha do gate. A DECISÃO de o que se aplica vem do núcleo
// (`gateSummary`); aqui só se escolhe a palavra para o que não se aplica.
// `mgr spec validate` — valida artefato do PROJETO do usuário. Não confundir com `mgr validate`,
// que valida autoria de SKILL.md: são contratos diferentes (ADR-0012). Aqui só há parse de flag,
// formatação e exit code; descoberta, leitura e política vivem em src/plan-validator.js (INV-5).
function cmdSpecValidate(flags, positional) {
  const repo = repoRoot(process.cwd());
  const slug = flags.all ? null : (positional[0] || planValidator.slugFromCwd(repo, process.cwd()));
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
    console.error(M.errorPrefix(M.specValidateNoSpecs(slug || path.join(repo, "specs"))));
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
    console.log(JSON.stringify({
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
    if (finding.file !== arquivoAtual) { console.log(M.specValidateHeader(finding.file)); arquivoAtual = finding.file; }
    console.log(M.specValidateItem(finding.code, finding.severity, finding.task, finding.line, finding.message));
    console.log(M.specValidateFix(finding.remediation));
    for (const linha of finding.example.split("\n")) console.log(M.specValidateExample(linha));
  }
  if (!resultado.findings.length) console.log(M.specValidateOk(resultado.tasks, resultado.criteria, resultado.files.length));
  console.log(M.specValidateSummary(resultado.summary.errors, resultado.summary.warnings));
  console.log(pc.dim(M.specValidateScopeNote));
  if (bloqueantes) console.log(M.specValidateNextSteps);
  return bloqueantes ? 1 : 0;
}

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

// Namespace `mgr spec <sub>`: separado do `mgr validate` de propósito (ADR-0012).
// `mgr spec next` — a próxima AÇÃO, não o estado (ADR-0014). Sem `--all`: a pergunta "o que faço
// agora" é sobre UMA feature. Aqui só há formatação e exit code; a decisão vive em src/plan-next.js.
function cmdSpecNext(flags, positional) {
  const repo = repoRoot(process.cwd());

  // `--all` não é aceito e ignorado: a pergunta "o que faço agora" é sobre UMA feature, e aceitar a
  // flag em silêncio faz o comando responder sobre uma feature qualquer com cara de resposta sobre
  // todas (ADR-0016, DT-8).
  if (flags.all) {
    console.error(M.errorPrefix(M.specNextAllRefused));
    return 1;
  }

  const slug = positional[0] || planValidator.slugFromCwd(repo, process.cwd());

  // Sem slug e fora de `specs/<slug>/`, a descoberta escolhia a primeira feature em ordem
  // alfabética e respondia como se fosse A resposta. Dizer quantas existem e pedir o nome custa uma
  // linha; a escolha silenciosa custa uma resposta errada que ninguém tem como perceber.
  const existentes = slugs(repo);
  if (!slug && existentes.length) {
    console.error(M.errorPrefix(M.specNextNeedsSlug(existentes.length)));
    return 1;
  }

  const resultado = planNext.nextTask(repo, { slug });

  if (resultado.outcome === "no-plan") {
    console.error(M.errorPrefix(M.specNextNoPlan(slug || path.join(repo, "specs"))));
    return 1;
  }

  if (flags.json) {
    console.log(JSON.stringify({
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
  console.log(M.specNextFile(resultado.file));

  if (resultado.outcome === "task") {
    const { task } = resultado;
    console.log(M.specNextTask(task.id));
    if (task.artifact) console.log(M.specNextArtifact(task.artifact));
    if (task.doneWhen) console.log(M.specNextDoneWhen(task.doneWhen));
    if (task.helperSkill) console.log(M.specNextSkill(task.helperSkill));
    if (task.dependsOn.length) console.log(M.specNextDependsOn(task.dependsOn.join(", ")));
  } else if (resultado.outcome === "all-done") {
    console.log(M.specNextAllDone(resultado.taskCount));
  } else if (resultado.outcome === "nothing-ready") {
    console.log(M.specNextNothingReady);
    for (const item of resultado.blocked) console.log(M.specNextBlocked(item.id, item.waitingFor.join(", ")));
    console.log(M.specNextRunValidate);
  } else if (resultado.outcome === "no-tasks") {
    console.log(M.specNextNoTasks);
  } else {
    console.log(M.specNextFormatNotDeclared);
  }

  // A base do que se afirma, em TODA resposta — a CA-6 diz "toda", e o caminho sem marcador não
  // era exceção escrita em lugar nenhum. Sem ela, devolver P0.1 para sempre seria lido como
  // "esta é a próxima", quando o correto é "esta é a primeira que pode começar" (ADR-0014).
  console.log("");
  console.log(resultado.stateDeclared
    ? M.specNextBasis(resultado.stateDeclared, resultado.taskCount)
    : M.specNextNoState(resultado.taskCount));
  // A ressalva só é verdadeira quando de fato se devolveu uma task. Dizê-la em "nada pronto"
  // seria a saída prometendo o que não fez.
  if (!resultado.stateDeclared && resultado.outcome === "task") console.log(M.specNextFirstStartable);
  return 0;
}

// `mgr spec status` — o que EXISTE em disco, e o aviso de que existência não é progresso
// (ADR-0015). Aqui só há formatação e exit code; o modelo e o IO vivem em src/spec-status.js.
function cmdSpecStatus(flags, positional) {
  const repo = repoRoot(process.cwd());

  if (flags.all) {
    const todas = specStatus.statusAll(repo);
    if (!todas.length) {
      console.error(M.errorPrefix(M.specStatusEmpty(path.join(repo, "specs"))));
      return 1;
    }
    if (flags.json) {
      console.log(JSON.stringify({ schemaVersion: 1, basis: specStatus.BASIS, warning: M.specStatusWarning, features: todas }, null, 2));
      return 0;
    }
    for (const feature of todas) console.log(M.specStatusLine(feature.slug, resumoDeStatus(feature)));
    console.log("");
    console.log(M.specStatusWarning);
    return 0;
  }

  const slug = positional[0] || planValidator.slugFromCwd(repo, process.cwd());
  const resultado = specStatus.statusFor(repo, { slug });

  if (!resultado.found) {
    console.error(M.errorPrefix(M.specStatusNotFound(slug || "")));
    return 1;
  }

  if (flags.json) {
    console.log(JSON.stringify({ schemaVersion: 1, ...resultado, warning: M.specStatusWarning }, null, 2));
    return 0;
  }

  console.log(M.specStatusRoot(resultado.specRoot));
  console.log(M.specStatusArtifacts(resultado.artifacts.map(marcaDeArtefato).join(" ")));
  console.log(resultado.nextReady.length
    ? M.specStatusNextReady(resultado.nextReady.join(", "))
    : M.specStatusNothingReady);
  console.log(resultado.handoff.exists
    ? M.specStatusHandoffOn(resultado.handoff.path)
    : M.specStatusHandoffNone);
  console.log("");
  console.log(M.specStatusWarning);
  return 0;
}

// `brief` vira `brief`, ausente vira `-brief`. O traço marca o que NÃO está lá sem inventar
// palavra nova, e o aviso logo abaixo diz o que a marca significa e o que ela não significa.
const marcaDeArtefato = (artefato) =>
  (artefato.status === specStatus.PRESENT ? "" : "-") + artefato.id;

const resumoDeStatus = (feature) =>
  `${feature.artifacts.filter((a) => a.status === specStatus.PRESENT).length}/${feature.artifacts.length}`
  + (feature.handoff.exists ? "  handoff" : "");

// `mgr agents` — qual modelo e qual esforço cada intenção usa, e DE ONDE veio cada valor
// (ADR-0017). A decisão vem do núcleo: `readAgents` diz o valor e a origem, `gateSummary` diz o que
// o motor sustenta. Aqui só se escolhe a palavra.
function cmdAgents(flags, positional) {
  if (positional[0] === "set") return cmdAgentsSet(flags, positional.slice(1));
  const repo = repoRoot(process.cwd());
  const core = installer.coreDir("project", repo);
  const { policies, sources, aliasOverridden } = readAgents(core);

  const pedida = positional[0];
  if (pedida && !catalogo.INTENTS.includes(pedida)) {
    console.error(M.errorPrefix(M.agentsUnknown(pedida, catalogo.INTENTS.join(" | "))));
    return 1;
  }
  const intents = pedida ? [pedida] : catalogo.INTENTS;
  const motores = engineIds();

  if (flags.json) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      aliasOverridden,
      intents: Object.fromEntries(intents.map((intent) => [intent, {
        agent: catalogo.AGENTS[intent].agent,
        needs: catalogo.AGENTS[intent].needs,
        enabled: policies[intent].enabled,
        engines: Object.fromEntries(motores.map((engine) => {
          const { model, effort, skipped } = gateSummary(engine, policies[intent]);
          return [engine, {
            model, effort, skipped,
            modelSource: model ? sources[intent].model[engine] : null,
            effortSource: effort ? sources[intent].effort : null,
          }];
        })),
      }])),
    }, null, 2));
    return 0;
  }

  const palavraDaOrigem = (origem) =>
    (origem === CONFIGURED ? M.agentsSourceConfigured : M.agentsSourceDefault);
  for (const intent of intents) {
    console.log(M.agentsIntent(intent, catalogo.AGENTS[intent].agent));
    for (const engine of motores) {
      const { model, effort, skipped } = gateSummary(engine, policies[intent]);
      const textoDoModelo = model
        ? M.agentsValueFrom(model, palavraDaOrigem(sources[intent].model[engine]))
        : (skipped.includes("model") ? M.agentsUnsupported : M.agentsInherited);
      // Mesma forma do ramo do `model` logo acima: sem valor pode ser incapacidade do MOTOR ou
      // escolha do autor, e chamar as duas de "não suportado" faz a saída mentir sobre a
      // plataforma — o claude-code suporta `effort`.
      const textoDoEsforco = effort
        ? M.agentsValueFrom(effort, palavraDaOrigem(sources[intent].effort))
        : (skipped.includes("effort") ? M.agentsUnsupported : M.agentsInherited);
      console.log(M.agentsEngine(engine, textoDoModelo, textoDoEsforco));
    }
  }
  // O aviso do default: sem modelo declarado, o agente roda no da sessão. Some quando todas as
  // intenções mostradas têm modelo em algum motor — avisar sobre o que já foi resolvido vira ruído.
  const herdando = inheritingModel(intents, motores, policies);
  if (herdando.length) console.log(pc.yellow(M.agentsInheritWarning(herdando.join(", "))));
  console.log("");
  console.log(pc.dim(M.agentsEffortNote));
  if (aliasOverridden) console.log(M.agentsAliasNote);
  return 0;
}

// `mgr precompact --hook <motor>` — o gatilho mecânico das leis L3.2 e L3.4 (ADR-0018). O motor
// anuncia que vai compactar, e o método põe o estado em disco ANTES.
//
// Disciplina do `mgr detect --hook`, pela mesma razão: falha aqui não pode poluir o contexto do
// agente nem derrubar a sessão de quem só abriu o editor. A ÚNICA saída diferente de zero é o
// bloqueio deliberado, e ele é intencional.
async function cmdPrecompact(flags) {
  try {
    const repo = repoRoot(process.cwd());
    const core = installer.coreDir("project", repo);
    const payload = await lerPayload();
    const engine = flags.hook;
    // Motor desconhecido sai em silêncio, e ANTES de gravar: sem esta guarda o hand-off seria
    // escrito dizendo ter vindo de um motor que não existe, e só depois a decisão falharia. É a
    // validação de entrada da borda (QUAL-2), com a saída silenciosa que a DT-8 exige em lugar do
    // fail fast ruidoso — o `mgr detect --hook` faz igual.
    if (!engineIds().includes(engine)) return 0;
    // O gatilho vem do payload, e SÓ dele. Sem ele, `decide` trata como desconhecido e não bloqueia.
    const trigger = payload.trigger ?? null;

    // Git é da BORDA — o núcleo recebe a lista pronta, e repositório sem git devolve vazio.
    logHook(M.precompactLogGitBefore);
    const changedFiles = modificados(repo);
    logHook(M.precompactLogGitAfter(changedFiles.length));

    // Gravar vem antes de decidir (RN-1): se só der para fazer uma coisa, é pôr o estado em disco.
    const montado = assemble(repo, { engine, trigger, changedFiles });
    const gravou = montado.outcome === ASSEMBLED;
    if (gravou) {
      logHook(M.precompactLogWriteBefore(montado.destination));
      const { appended } = persist(repo, montado);
      logHook(M.precompactLogWriteAfter(montado.destination, appended));
    }

    // A referência ao contexto da conversa (ADR-0019). Vem junto do hand-off, e pela mesma razão:
    // é preservação de estado, e preservar vem antes de decidir.
    //
    // O caminho do transcript vem do payload em duas grafias, porque as duas plataformas o nomeiam
    // diferente — `transcript_path` no claude-code e `transcriptPath` no copilot.
    const referencia = referenciarContexto(repo, {
      engine,
      trigger,
      // Só string vale como caminho: número truthy chegaria a `readFileSync` como **file
      // descriptor**, lendo algo que ninguém pediu. A recusa é silenciosa, como todo o resto deste
      // comando (DT-8), em vez do fail fast ruidoso que a QUAL-2 prescreve em geral.
      transcriptPath: caminhoDoTranscript(payload),
      sessionId: payload.session_id ?? payload.sessionId ?? null,
    });

    // A borda passa o FATO de ter gravado; quem conjuga isso com gatilho e carimbo é o núcleo.
    const veredito = decide({ engine, trigger, blockedAt: readStamp(core, engine), saved: gravou });
    if (veredito.block) {
      // A palavra é escolhida DEPOIS da decisão, e não antes: dizer "a compactação vai acontecer" no
      // caminho em que ela foi impedida seria a saída se contradizendo dentro do mesmo envelope.
      //
      // O motivo vai no envelope, e não no stderr: a doc diz que a mensagem de bloqueio é "the
      // reason from your JSON's blocking decision when it makes one, and your stderr text
      // otherwise" — declarando a decisão, o stderr fica livre para ser canal de log.
      const entregue = emitirAviso(engine, {
        message: `${M.precompactWroteBlocked(montado.destination, montado.slug)}${referencia}`,
        deny: M.precompactBlocked(montado.destination),
      });
      // Bloquear sem conseguir entregar o motivo obstruiria o usuário sem explicação — e é pior que
      // isso: sem envelope válido, a própria doc diz que a mensagem de bloqueio passa a ser o
      // stderr, que aqui carrega as linhas de log. Então não bloqueia. E **não carimba**: a próxima
      // tentativa continua valendo como recusa nova, em vez de ser liberada por uma recusa que o
      // usuário nunca viu.
      if (!entregue) return 0;
      logHook(M.precompactLogStampBefore);
      writeStamp(core, { engine });
      logHook(M.precompactLogStampAfter);
      return 2;
    }
    const gravacao = gravou
      ? M.precompactWrote(montado.destination, montado.slug)
      : M.precompactNothingToSave;
    const seguinte = veredito.repeated ? M.precompactProceeding : M.precompactSuggestNewSession;
    emitirAviso(engine, { message: `${gravacao} ${seguinte}${referencia}` });
    return 0;
  } catch {
    // Silêncio é melhor que ruído no contexto do agente. O aviso, quando houve, já saiu acima.
    return 0;
  }
}

// Registra a referência ao contexto e devolve o TEXTO a acrescentar ao aviso — nunca lança, e
// qualquer falha vira string vazia: perder a referência não pode custar o hand-off nem a sessão
// (RN-5). O núcleo mede e escreve; aqui se resolve o destino e se escolhe a palavra (INV-5).
//
// O manifesto vai para o escopo GLOBAL de propósito: ele carrega caminhos absolutos e ids de sessão
// da máquina, e o `.mgr-core/` do projeto é o que o README manda versionar.
const caminhoDoTranscript = (payload) => {
  const bruto = payload.transcript_path ?? payload.transcriptPath ?? null;
  return typeof bruto === "string" && bruto ? bruto : null;
};

function referenciarContexto(repo, { engine, trigger, transcriptPath, sessionId }) {
  try {
    const projectId = readManifest(installer.coreDir("project", repo))?.projectId;
    // Sem projeto instalado não há por onde endereçar o manifesto. Silêncio, como todo o resto deste
    // comando: quem só abriu o editor não pode receber ruído.
    if (!projectId) return "";

    const entrada = contexto.entryFor({ engine, trigger, transcriptPath, sessionId });
    if (entrada.outcome !== contexto.REFERENCED) return ` ${M.precompactContextMissed(entrada.reason)}`;

    const global = installer.coreDir("global", repo);
    logHook(M.precompactLogContextBefore(contexto.manifestPath(global, projectId)));
    const { file, entries, recovered } = contexto.write(global, projectId, entrada);
    logHook(M.precompactLogContextAfter(file, entries));

    const perda = recovered ? ` ${M.precompactContextRecovered}` : "";
    return ` ${M.precompactContextReferenced({
      file,
      records: entrada.transcriptRecords,
      bytes: entrada.transcriptBytes,
      artifacts: entrada.sessionArtifacts.length,
    })}${perda}`;
  } catch {
    // Referência é acréscimo: se ela falhar, o hand-off e o aviso da fatia anterior seguem intactos.
    return "";
  }
}

// Escrita SÍNCRONA nos dois canais do hook, e isto não é preferência de estilo: o processo termina em
// `process.exit`, e em pipe o stdout do Node é assíncrono — o `write` enfileira e a saída pode ser
// truncada antes do flush. Perder o envelope aqui é perder a única mensagem que chega ao usuário.
// Tentativas em canal que não drenou. NÃO é medição: é escolha de desenho declarada. Existe porque
// dentro do hook a espera é limitada pelo teto de 15s da entrada, mas numa invocação à mão com o
// stdout redirecionado para um pipe non-blocking não há teto nenhum — girar sem limite queimaria CPU
// até alguém ler. Passado o teto, trata-se o canal como indisponível, que é o que o desenho já faz
// para qualquer outro erro.
const MAX_TENTATIVAS_DE_ESCRITA = 1000;

// Erros retentáveis: canal non-blocking que ainda não drenou, e chamada interrompida por sinal. Os
// dois são "tente de novo", e não "o canal morreu".
const RETENTAVEIS = new Set(["EAGAIN", "EINTR"]);

// Devolve se a mensagem saiu INTEIRA. O retorno importa: escrita parcial seguida de canal fechado
// deixaria um envelope truncado, e quem chamou precisa saber para não agir como se tivesse avisado.
const escreverSync = (fd, texto) => {
  const bytes = Buffer.from(texto, "utf8");
  let escrito = 0;
  let tentativas = 0;
  // Laço porque `writeSync` devolve QUANTOS bytes escreveu: em pipe a escrita pode ser parcial, e
  // parar na primeira chamada truncaria a mensagem no meio de um JSON.
  while (escrito < bytes.length) {
    try {
      const n = writeSync(fd, bytes, escrito);
      // Zero byte escrito sem erro não progride: repetir seria laço infinito.
      if (n <= 0) return false;
      escrito += n;
      tentativas = 0;
    } catch (erro) {
      if (!RETENTAVEIS.has(erro.code)) return false;
      if (++tentativas > MAX_TENTATIVAS_DE_ESCRITA) return false;
    }
  }
  return true;
};

// Log de hook vai para o STDERR, nunca para o stdout: o stdout deste evento carrega o envelope JSON,
// e texto solto ali o tornaria impossível de parsear. A doc diz que "stderr from a hook that exits 0
// goes to the debug log only, never the transcript, and Claude never sees it" — é destino de
// diagnóstico, que é o que a LOG-1/LOG-2 pedem, sem virar ruído no contexto de ninguém.
// Log não tem o que fazer com o resultado: se o canal de diagnóstico caiu, não há onde relatar isso
// — e relatar pelo próprio canal seria recursivo.
const logHook = (linha) => { escreverSync(2, `[mgr] ${linha}\n`); };

// O aviso ao usuário sai pelo envelope que o motor declara, ou não sai. Motor sem canal não recebe
// texto solto: imprimir no que a plataforma descarta faria a fatia parecer avisar.
// Devolve se NADA foi perdido. Motor sem canal devolve `true`: não havia o que entregar, e isso não
// é falha de entrega — é a degradação que o descritor declara.
const emitirAviso = (engine, conteudo) => {
  const envelope = notice(engine, conteudo);
  return envelope === null || escreverSync(1, `${envelope}\n`);
};

// O payload chega por stdin. Vazio e JSON inválido são entrada legítima de uma sessão estranha, não
// erro do usuário: viram objeto vazio, e o gatilho desconhecido não bloqueia (`decide`).
async function lerPayload() {
  const pedacos = [];
  for await (const pedaco of process.stdin) pedacos.push(pedaco);
  try {
    return JSON.parse(Buffer.concat(pedacos).toString("utf8")) ?? {};
  } catch {
    return {};
  }
}

const modificados = (repo) => {
  try {
    // `stdio` ignora o stderr do git de propósito: em repositório sem git ele imprime "not a git
    // repository", e isso cairia no contexto do agente — o ruído que a DT-8 quer impedir.
    return execFileSync("git", ["status", "--short"], {
      cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n").map((linha) => linha.trim()).filter(Boolean);
  } catch {
    return [];
  }
};

// `mgr agents set` — escreve a política de UMA intenção e diz o que passou a valer (ADR-0017).
//
// A decisão de MERGE e a validação são do núcleo (`writeAgentPolicy`); aqui só se resolve para
// QUAIS motores escrever, e se escolhe a palavra. Este comando NÃO roda o `update`: reescrever o
// arquivo do agente sem o autor pedir mexeria no disco dele por conta própria.
//
// `model` é mapa POR MOTOR e `effort` é da intenção inteira — por isso `--engine` só tem efeito
// sobre o modelo, e o esforço é escrito uma vez, sem motor.
function cmdAgentsSet(flags, positional) {
  const repo = repoRoot(process.cwd());
  const core = installer.coreDir("project", repo);

  const intent = positional[0];
  if (!intent) {
    console.error(M.errorPrefix(M.agentsSetNeedsIntent(catalogo.INTENTS.join(" | "))));
    return 1;
  }
  if (!catalogo.INTENTS.includes(intent)) {
    console.error(M.errorPrefix(M.agentsUnknown(intent, catalogo.INTENTS.join(" | "))));
    return 1;
  }
  if (flags.model === undefined && flags.effort === undefined) {
    console.error(M.errorPrefix(M.agentsSetNothing));
    return 1;
  }

  // Sem `--engine`, os motores vêm do manifesto — é o que o autor instalou, e não um palpite.
  const manifesto = installer.detectPrior("project", repo);
  const instalados = (manifesto?.engines || [manifesto?.engine]).filter((e) => engineIds().includes(e));
  const motores = flags.engines.length ? flags.engines : instalados;
  for (const engine of flags.engines) {
    // Motor não instalado é RECUSADO, e não gravado e ignorado: config que ninguém lê é pior que
    // erro na hora, porque o autor sai achando que configurou.
    if (!instalados.includes(engine)) {
      console.error(M.errorPrefix(M.agentsSetEngineNotInstalled(engine, instalados.join(", "))));
      return 1;
    }
  }
  if (flags.model !== undefined && !motores.length) {
    console.error(M.errorPrefix(M.agentsSetNoEngines));
    return 1;
  }

  const escrita = {};
  if (flags.model !== undefined) escrita.model = Object.fromEntries(motores.map((e) => [e, flags.model]));
  if (flags.effort !== undefined) escrita.effort = flags.effort;
  // Valor inválido sai pelo `throw` do núcleo, capturado no `main` — e nada é gravado.
  console.log(M.agentsSetWriting(intent));
  const policy = writeAgentPolicy(core, intent, escrita);
  console.log(M.agentsSetWritten(intent, catalogo.AGENTS[intent].agent));

  // `effort` vale para a INTENÇÃO inteira: mostrar só o motor do `--engine` esconderia que ele
  // passou a valer nos outros também. Com `--model` sozinho, mostra-se só onde se escreveu.
  const mostrados = (flags.effort !== undefined && instalados.length)
    ? instalados
    : (motores.length ? motores : engineIds());
  for (const engine of mostrados) {
    const { model, effort, skipped } = gateSummary(engine, policy);
    console.log(M.agentsEngine(engine,
      model || (skipped.includes("model") ? M.agentsUnsupported : M.agentsInherited),
      effort || (skipped.includes("effort") ? M.agentsUnsupported : M.agentsInherited)));
  }
  console.log("");
  // Uma frase por campo ESCRITO: os dois campos passam a valer em momentos diferentes, e dizer só
  // "pronto" deixaria o autor esperando efeito que ainda não existe.
  if (flags.model !== undefined) console.log(pc.dim(M.agentsSetModelEffect));
  if (flags.effort !== undefined) console.log(pc.dim(M.agentsSetEffortEffect));
  return 0;
}

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
  const { budget } = readAgents(installer.coreDir("project", repoRoot(process.cwd())));
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
  const repo = path.resolve(positional[0] || ".");
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

async function cmdUpdate(flags, positional) {
  const repo = path.resolve(positional[0] || ".");
  let scope = flags.scope;
  if (!scope) {
    scope = installer.detectPrior("global", repo) && !installer.detectPrior("project", repo)
      ? "global" : "project";
  }
  const res = installer.update(scope, repo, { replaced: replacedByEngine(readLockfile(repo)) });
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
  const [, , command, ...rest] = process.argv;
  const { flags, positional } = parseArgs(rest);
  // Refina o idioma da CLI: flag > manifesto (project > global) > locale (default acima).
  const semRepoPosicional = PLUGIN_COMMANDS.includes(command) || SUBCOMMAND_COMMANDS.includes(command);
  const repo = path.resolve(semRepoPosicional ? "." : (positional[0] || "."));
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
      case "spec": return cmdSpec(flags, positional);
      case "agents": return cmdAgents(flags, positional);
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
