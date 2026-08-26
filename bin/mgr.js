#!/usr/bin/env node
// CLI do MGR — Método Governado por Rastreabilidade.
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import * as bundle from "../src/bundle.js";
import * as installer from "../src/installer.js";
import { buildRuntime } from "../src/builder.js";
import { validateAll } from "../src/validator.js";
import { printBanner } from "../src/banner.js";
import { collectInstallAnswers, detectUserLanguage, CANCELLED } from "../src/prompts.js";
import { getMessages } from "../src/messages.js";
import {
  add as addPlugin, remove as removePlugin, restore as restorePlugins,
  installedPluginNames, CANCELLED_EXIT_CODE,
} from "../src/plugin-installer.js";
import {
  addRegistry, fetchIndex, listRegistries, readDetectionMode, removeRegistry,
} from "../src/registry.js";
import { diff as lockfileDiff, readLockfile, replacedByEngine, LOCKFILE_NAME } from "../src/lockfile.js";
import { collectSuggestions, detect, hookReport } from "../src/detector.js";
import { hookFilePath, removeHook, writeHook } from "../src/hooks.js";

const SCOPES = ["project", "global"];
// Comandos de skill plugável: o posicional é o nome da skill/registry, nunca o repositório.
const PLUGIN_COMMANDS = ["add", "remove", "registry"];
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
    else if (a === "--out") flags.out = argv[++i];
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

  for (const engine of motoresComHook) {
    const file = writeHook(engine, plan.repo, { command: mgrCommand() });
    p.log.success(M.hookWritten(path.relative(plan.repo, file)));
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
      process.stdout.write(hookReport((await suggestionsFor(repo, detected)).suggestions, flags.hook));
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
    const file = removeHook(engine, repo);
    if (file) console.log(pc.dim(M.hookRemoved(path.relative(repo, file))));
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
  const repo = path.resolve(PLUGIN_COMMANDS.includes(command) ? "." : (positional[0] || "."));
  const manifestLang = installer.detectPrior("project", repo)?.userLanguage
    || installer.detectPrior("global", repo)?.userLanguage;
  M = getMessages(flags.userLanguage || manifestLang || detectUserLanguage(process.env));
  try {
    switch (command) {
      case "install": return await cmdInstall(flags, positional);
      case "add": return await cmdAdd(flags, positional);
      case "remove": return cmdRemove(flags, positional);
      case "registry": return cmdRegistry(flags, positional);
      case "detect": return await cmdDetect(flags, positional);
      case "status": return cmdStatus(flags, positional);
      case "update": return await cmdUpdate(flags, positional);
      case "uninstall": return await cmdUninstall(flags, positional);
      case "build": return cmdBuild(flags);
      case "validate": return cmdValidate();
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
