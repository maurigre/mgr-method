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

const SCOPES = ["project", "global"];
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
    else if (a === "--out") flags.out = argv[++i];
    else if (a.startsWith("-")) { console.error(M.unknownFlag(a)); process.exit(1); }
    else positional.push(a);
  }
  // compat: --engine both = os dois motores
  flags.engines = flags.engines.flatMap((e) => (e === "both" ? installer.ENGINES : [e]));
  return { flags, positional };
}

function bail(msg) { p.cancel(msg || M.aborted); process.exit(0); }

async function cmdInstall(flags, positional) {
  const repo = path.resolve(positional[0] || ".");
  printBanner();
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
  if (!engines.length) engines = ["claude-code"];
  scope = scope || "project";
  if (!SCOPES.includes(scope)) { p.log.error(M.invalidScope(scope)); process.exit(1); }

  const prior = installer.detectPrior(scope, repo);
  if (prior) {
    if (prior.model === "runtime-launcher") p.log.warn(M.oldInstallWarn(prior.version));
    else p.log.warn(M.resyncWarn);
  }

  const plan = installer.planInstall(engines, scope, repo, { skillsDir, language, architecture, userLanguage, optional, all: flags.allSkills, projectId });
  p.note(
    [
      M.planProject(plan.projectId, plan.scope),
      M.planEngines(plan.engines.join(", ")),
      M.planStack(plan.language || "—", plan.architecture || "—"),
      `${M.planOutput(plan.userLanguage || "—")}  ${pc.dim(M.planOutputHint)}`,
      `${M.planConfig(installer.coreDir(plan.scope, plan.repo))}  ${pc.dim(M.planConfigHint)}`,
      ...plan.targets.map((t) => M.planSkillsDir(t.dir)),
      M.planSkills(plan.skills.length, plan.skills.join(", ")),
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
  p.outro(pc.green(M.done));
  return 0;
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
  if (!shown) { console.log(M.statusNone); return 1; }
  return 0;
}

function cmdUpdate(flags, positional) {
  const repo = path.resolve(positional[0] || ".");
  let scope = flags.scope;
  if (!scope) {
    scope = installer.detectPrior("global", repo) && !installer.detectPrior("project", repo)
      ? "global" : "project";
  }
  const res = installer.update(scope, repo);
  if (res.migrated) console.log(pc.dim(M.updateMigrated));
  console.log(pc.green(M.updateDone(scope, res.skills.length, res.targets.map((t) => t.dir).join(" · "))));
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
  const repo = path.resolve(positional[0] || ".");
  const manifestLang = installer.detectPrior("project", repo)?.userLanguage
    || installer.detectPrior("global", repo)?.userLanguage;
  M = getMessages(flags.userLanguage || manifestLang || detectUserLanguage(process.env));
  try {
    switch (command) {
      case "install": return await cmdInstall(flags, positional);
      case "status": return cmdStatus(flags, positional);
      case "update": return cmdUpdate(flags, positional);
      case "uninstall": return await cmdUninstall(flags, positional);
      case "build": return cmdBuild(flags);
      case "validate": return cmdValidate();
      case "list": bundle.skillNames().forEach((n) => console.log(n)); return 0;
      case "version": case "--version": case "-v":
        console.log(`mgr-method ${bundle.readVersion()}`); return 0;
      case undefined: case "help": case "--help": case "-h":
        printBanner(); process.stdout.write(M.help); return 0;
      default:
        console.error(M.unknownCommand(command)); process.stdout.write(M.help); return 1;
    }
  } catch (e) {
    console.error(pc.red(M.errorPrefix(e.message)));
    return 1;
  }
}

main().then((code) => process.exit(code ?? 0));
