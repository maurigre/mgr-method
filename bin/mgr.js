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
import { collectInstallAnswers, CANCELLED } from "../src/prompts.js";

const SCOPES = ["project", "global"];
const isTTY = process.stdin.isTTY && process.stdout.isTTY;

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
    else if (a === "--arch") flags.arch = argv[++i];
    else if (a === "--project-id") flags.projectId = argv[++i];
    else if (a === "--all-skills") flags.allSkills = true;
    else if (a === "--out") flags.out = argv[++i];
    else if (a.startsWith("-")) { console.error(`flag desconhecida: ${a}`); process.exit(1); }
    else positional.push(a);
  }
  // compat: --engine both = os dois motores
  flags.engines = flags.engines.flatMap((e) => (e === "both" ? installer.ENGINES : [e]));
  return { flags, positional };
}

function bail(msg) { p.cancel(msg || "abortado."); process.exit(0); }

async function cmdInstall(flags, positional) {
  const repo = path.resolve(positional[0] || ".");
  printBanner();
  p.intro(pc.bgCyan(pc.black(" mgr install ")));

  const found = installer.detect(repo);
  if (found.length) {
    p.note(found.map((f) => `[${f.scope}] ${f.path} — ${f.count} skill(s)`).join("\n"),
      "Skills existentes detectadas");
  }

  const skillsDir = flags.skillsDir ? path.resolve(flags.skillsDir) : null;
  let engines = flags.engines;
  let scope = flags.scope;
  let language = flags.language || null;
  let architecture = flags.arch || null;
  let projectId = flags.projectId || null;
  const optional = [];

  if (!skillsDir && isTTY && !flags.yes) {
    const answers = await collectInstallAnswers(
      CLACK,
      { engines, scope, language, architecture, projectId },
      { repo, allSkills: flags.allSkills }
    );
    if (answers === CANCELLED) bail();
    ({ engines, scope, language, architecture, projectId } = answers);
    optional.push(...answers.optional);
  }
  if (!engines.length) engines = ["claude-code"];
  scope = scope || "project";
  if (!SCOPES.includes(scope)) { p.log.error(`escopo inválido: ${scope}`); process.exit(1); }

  const prior = installer.detectPrior(scope, repo);
  if (prior) {
    if (prior.model === "runtime-launcher") p.log.warn(`Instalação antiga (v${prior.version}, modelo runtime-launcher) detectada — será MIGRADA para o novo layout.`);
    else p.log.warn("Instalação MGR existente detectada — será re-sincronizada.");
  }

  const plan = installer.planInstall(engines, scope, repo, { skillsDir, language, architecture, optional, all: flags.allSkills, projectId });
  p.note(
    [
      `projeto:     ${plan.projectId}    escopo: ${plan.scope}`,
      `motor(es):   ${plan.engines.join(", ")}`,
      `linguagem:   ${plan.language || "—"}    arquitetura: ${plan.architecture || "—"}`,
      `config   →   ${installer.coreDir(plan.scope, plan.repo)}  ${pc.dim("(manifest.json + .env)")}`,
      ...plan.targets.map((t) => `skills   →   ${t.dir}`),
      `skills (${plan.skills.length}): ${plan.skills.join(", ")}`,
    ].join("\n"),
    "Plano de instalação (autossuficiente por motor)"
  );

  if (flags.dryRun) { p.outro(pc.dim("(dry-run: nada foi escrito.)")); return 0; }
  if (isTTY && !flags.yes) {
    const ok = await p.confirm({ message: "Confirmar instalação?" });
    if (p.isCancel(ok) || !ok) bail();
  }

  const s = p.spinner();
  s.start("Instalando skills nos motores");
  const res = installer.execute(plan);
  s.stop(`Skills instaladas em ${res.targets.map((t) => t.dir).join(" e ")}.`);
  if (res.migrated) p.log.info(`Migração: modelo antigo removido (${res.migrated.removed.length} item(ns), incluindo .mgr-core).`);
  p.outro(pc.green("Pronto! Comece com /spec-init e depois /spec-create por feature."));
  return 0;
}

function cmdStatus(_f, positional) {
  const repo = path.resolve(positional[0] || ".");
  let shown = false;
  for (const scope of SCOPES) {
    for (const man of installer.installs(scope, repo)) {
      shown = true;
      const model = man.model === "runtime-launcher" ? "runtime-launcher (ANTIGO — rode `mgr update` para migrar)" : (man.model || "self-contained");
      console.log(pc.bold(`[${scope}]`) + ` MGR v${man.version} — ${(man.engines || [man.engine]).join(", ")} — ${model}`);
      console.log(`  projeto: ${man.projectId || "—"}`);
      console.log(`  config:  ${man.core}`);
      if (man.language || man.architecture) console.log(`  stack:   linguagem=${man.language || "—"} arquitetura=${man.architecture || "—"}`);
      for (const d of man.skillsDirs || [man.skillsDir]) if (d) console.log(`  skills:  ${d}`);
      console.log(`  skills:  ${(man.skills || []).join(", ")}`);
      console.log(`  em:      ${man.installedAt}`);
    }
  }
  if (!shown) { console.log("Nenhuma instalação MGR encontrada (projeto ou global)."); return 1; }
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
  if (res.migrated) console.log(pc.dim("(instalação antiga migrada para o novo layout)"));
  console.log(pc.green(`Re-sincronizado (${scope}): ${res.skills.length} skills em ${res.targets.map((t) => t.dir).join(" e ")}.`));
  return 0;
}

async function cmdUninstall(flags, positional) {
  const repo = path.resolve(positional[0] || ".");
  const scope = flags.scope || "project";
  if (isTTY && !flags.yes) {
    const ok = await p.confirm({ message: `Remover instalação MGR (${scope})? docs/ e specs/ serão preservados.`, initialValue: false });
    if (p.isCancel(ok) || !ok) bail();
  }
  const res = installer.uninstall(scope, repo);
  for (const r of res.removed) console.log(pc.dim(`  removido: ${r}`));
  console.log(pc.green("Desinstalado."));
  return 0;
}

function cmdBuild(flags) {
  const dest = path.resolve(flags.out || "dist/mgr-runtime");
  const names = buildRuntime(dest);
  console.log(`runtime construído em ${dest}: ${names.join(", ")}`);
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

const HELP = `MGR — Método Governado por Rastreabilidade

Uso: mgr <comando> [opções]

  install [repo]   instala as skills (seletivo) direto na pasta do motor
                   (--engine claude-code|copilot|both, --scope, --language, --arch,
                    --project-id, --all-skills, --skills-dir, --dry-run, -y)
  status [repo]    mostra o que está instalado
  update [repo]    re-sincroniza (--scope)
  uninstall [repo] remove as skills instaladas (--scope, -y)
  build            gera um diretório com todo o conteúdo (--out)
  validate         valida as SKILL.md
  list             lista as skills
  version          mostra a versão
`;

async function main() {
  const [, , command, ...rest] = process.argv;
  const { flags, positional } = parseArgs(rest);
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
        printBanner(); process.stdout.write(HELP); return 0;
      default:
        console.error(`comando desconhecido: ${command}\n`); process.stdout.write(HELP); return 1;
    }
  } catch (e) {
    console.error(pc.red(`erro: ${e.message}`));
    return 1;
  }
}

main().then((code) => process.exit(code ?? 0));
