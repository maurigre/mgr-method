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

const SCOPES = ["project", "global"];
const isTTY = process.stdin.isTTY && process.stdout.isTTY;

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

  if (!skillsDir && isTTY && !flags.yes) {
    if (!engines.length) {
      const sel = await p.multiselect({
        message: "Quais motores devem receber as skills? (espaço marca, enter confirma)",
        options: [
          { value: "claude-code", label: "Claude Code", hint: ".claude/skills" },
          { value: "copilot", label: "GitHub Copilot", hint: ".github/skills" },
        ],
        initialValues: ["claude-code"],
        required: true,
      });
      if (p.isCancel(sel)) bail();
      engines = sel;
    }
    if (!scope) {
      const s = await p.select({
        message: "Escopo da instalação?",
        options: [
          { value: "project", label: "project", hint: "neste repositório" },
          { value: "global", label: "global", hint: "para todos os projetos (home)" },
        ],
      });
      if (p.isCancel(s)) bail();
      scope = s;
    }
  }
  if (!engines.length) engines = ["claude-code"];
  scope = scope || "project";
  if (!SCOPES.includes(scope)) { p.log.error(`escopo inválido: ${scope}`); process.exit(1); }

  const prior = installer.detectPrior(scope, repo);
  if (prior) {
    p.log.warn(`Instalação MGR existente (v${prior.version}, ${(prior.engines || [prior.engine]).join("+")}). Será re-sincronizada.`);
  }

  const plan = installer.planInstall(engines, scope, repo, { skillsDir });
  p.note(
    [
      `motor(es):  ${plan.engines.join(", ")}   escopo: ${plan.scope}`,
      `runtime  →  ${plan.runtimeDir}  ${pc.dim("(conteúdo uma vez)")}`,
      ...plan.targets.map((t) => `skills   →  ${t.dir}  ${pc.dim(`(lançadores ${t.engine})`)}`),
      `skills:     ${plan.skills.join(", ")}`,
    ].join("\n"),
    "Plano de instalação"
  );

  if (flags.dryRun) { p.outro(pc.dim("(dry-run: nada foi escrito.)")); return 0; }
  if (isTTY && !flags.yes) {
    const ok = await p.confirm({ message: "Confirmar instalação?" });
    if (p.isCancel(ok) || !ok) bail();
  }

  const s = p.spinner();
  s.start("Escrevendo runtime e lançadores");
  const res = installer.execute(plan);
  s.stop(`Runtime em ${res.runtime}; lançadores em ${res.targets.map((t) => t.dir).join(" e ")}.`);
  p.outro(pc.green("Pronto! Comece com /spec-init e depois /spec-create por feature."));
  return 0;
}

function cmdStatus(_f, positional) {
  const repo = path.resolve(positional[0] || ".");
  let shown = false;
  for (const scope of SCOPES) {
    const man = installer.detectPrior(scope, repo);
    if (man) {
      shown = true;
      const engines = (man.engines || [man.engine]).join(", ");
      console.log(pc.bold(`[${scope}]`) + ` MGR v${man.version} — motores: ${engines}`);
      console.log(`  runtime: ${man.runtimeDir}`);
      for (const d of man.skillsDirs || [man.skillsDir]) console.log(`  skills:  ${d}`);
      console.log(`  skills:  ${man.skills.join(", ")}`);
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

  install [repo]   instala runtime + lançadores (--engine claude-code|copilot|both, --scope, --skills-dir, --dry-run, -y)
  status [repo]    mostra o que está instalado
  update [repo]    re-sincroniza (--scope)
  uninstall [repo] remove lançadores e runtime (--scope, -y)
  build            gera o runtime num diretório (--out)
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
