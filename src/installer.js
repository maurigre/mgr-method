// Instalação no modelo runtime + lançadores, em duas fases, com MÚLTIPLOS motores.
// Fase 1 (planInstall): monta o plano, sem escrever. Fase 2 (execute): escreve o runtime
// uma vez e gera lançadores em CADA motor selecionado, e grava o manifesto.
//
// Convenção por motor (sem impor .claude):
//   claude-code : <repo>/.claude/skills   |  ~/.claude/skills
//   copilot     : <repo>/.github/skills   |  ~/.copilot/skills
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as bundle from "./bundle.js";
import { buildRuntime, generateLauncher } from "./builder.js";
import { readManifest, writeManifest } from "./manifest.js";

const KNOWN_PROJECT = [".claude/skills", ".github/skills", ".agents/skills", ".cursor/skills"];
const KNOWN_GLOBAL = [".claude/skills", ".copilot/skills", ".agents/skills"];

const ENGINE_DIR = {
  "claude-code": { project: ".claude/skills", global: ".claude/skills" },
  copilot: { project: ".github/skills", global: ".copilot/skills" },
};

export const ENGINES = Object.keys(ENGINE_DIR);

function countSkills(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, "SKILL.md")))
    .length;
}

export function detect(repo) {
  const out = [];
  for (const rel of KNOWN_PROJECT) {
    const p = path.join(repo, rel);
    if (existsSync(p)) out.push({ scope: "projeto", path: p, count: countSkills(p) });
  }
  for (const rel of KNOWN_GLOBAL) {
    const p = path.join(os.homedir(), rel);
    if (existsSync(p)) out.push({ scope: "global", path: p, count: countSkills(p) });
  }
  return out;
}

export function runtimeDirFor(scope, repo) {
  const base = scope === "global" ? os.homedir() : repo;
  return path.join(base, bundle.RUNTIME_DIR_NAME);
}

export function detectPrior(scope, repo) {
  return readManifest(runtimeDirFor(scope, repo));
}

function engineSkillsDir(engine, scope, repo) {
  const rel = ENGINE_DIR[engine]?.[scope];
  if (!rel) throw new Error(`motor inválido: ${engine}`);
  return scope === "project" ? path.join(repo, rel) : path.join(os.homedir(), rel);
}

// engines: array (ex.: ["claude-code","copilot"]). skillsDirOverride força um único alvo.
export function planInstall(engines, scope, repo, { skillsDir = null, names = null } = {}) {
  const runtime = runtimeDirFor(scope, repo);
  const runtimeRefBase = scope === "project" ? bundle.RUNTIME_DIR_NAME : runtime;
  let targets;
  if (skillsDir) {
    targets = [{ engine: "custom", dir: skillsDir }];
  } else {
    targets = engines.map((e) => ({ engine: e, dir: engineSkillsDir(e, scope, repo) }));
  }
  return {
    engines: skillsDir ? ["custom"] : engines,
    scope, repo,
    runtimeDir: runtime,
    runtimeRefBase,
    targets,
    skills: names || bundle.skillNames(),
  };
}

export function execute(plan) {
  buildRuntime(plan.runtimeDir, plan.skills);        // conteúdo uma vez
  for (const t of plan.targets) {                    // lançadores em cada motor
    mkdirSync(t.dir, { recursive: true });
    for (const name of plan.skills) {
      generateLauncher(name, `${plan.runtimeRefBase}/skills/${name}`, t.dir);
    }
  }
  const rel = (p) => (plan.scope === "project" ? path.relative(plan.repo, p) : p);
  writeManifest(plan.runtimeDir, {
    version: bundle.readVersion(),
    engines: plan.engines,
    scope: plan.scope,
    runtimeDir: rel(plan.runtimeDir),
    skillsDirs: plan.targets.map((t) => rel(t.dir)),
    skills: plan.skills,
  });
  return { runtime: plan.runtimeDir, targets: plan.targets, skills: plan.skills };
}

function absDir(d, scope, repo) {
  if (path.isAbsolute(d)) return d;
  return scope === "project" ? path.join(repo, d) : d;
}

export function uninstall(scope, repo) {
  const runtime = runtimeDirFor(scope, repo);
  const man = readManifest(runtime);
  if (!man) throw new Error("nenhum manifesto MGR encontrado — nada a desinstalar");
  const dirs = man.skillsDirs || (man.skillsDir ? [man.skillsDir] : []);
  const removed = [];
  for (const d of dirs) {
    const base = absDir(d, scope, repo);
    for (const name of man.skills) {
      const p = path.join(base, name);
      if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); removed.push(p); }
    }
  }
  if (existsSync(runtime)) { rmSync(runtime, { recursive: true, force: true }); removed.push(runtime); }
  return { removed };
}

export function update(scope, repo) {
  const runtime = runtimeDirFor(scope, repo);
  const man = readManifest(runtime);
  if (!man) throw new Error("nenhum manifesto MGR encontrado — rode `mgr install` antes");
  const engines = man.engines || [man.engine];
  let plan;
  if (engines.includes("custom")) {
    // instalado com --skills-dir: reutiliza o diretório registrado no manifesto
    const d = (man.skillsDirs || [man.skillsDir])[0];
    plan = planInstall([], scope, repo, { skillsDir: absDir(d, scope, repo) });
  } else {
    plan = planInstall(engines, scope, repo);
  }
  return execute(plan);
}
