// Instalação no modelo AUTOSSUFICIENTE por motor: o conteúdo completo das skills selecionadas
// vai direto para a pasta do motor (.claude/skills ou .github/skills). O `.mgr-core/` guarda
// APENAS config do projeto (manifest.json + .env com MGR_PROJECT_ID) — sem skills.
// Instalações do modelo antigo (runtime-launcher, com skills dentro de .mgr-core) são migradas
// automaticamente no install: remove-se o conteúdo antigo e mantém-se o .mgr-core só como config.
//
// Convenção por motor:
//   claude-code : <repo>/.claude/skills  |  ~/.claude/skills
//   copilot     : <repo>/.github/skills  |  ~/.copilot/skills
import { existsSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as bundle from "./bundle.js";
import { installEngine } from "./builder.js";
import { readManifest, writeManifest, writeEnv } from "./manifest.js";
import * as catalog from "./catalog.js";

const KNOWN_PROJECT = [".claude/skills", ".github/skills", ".agents/skills", ".cursor/skills"];
const KNOWN_GLOBAL = [".claude/skills", ".copilot/skills", ".agents/skills"];

const ENGINE_DIR = {
  "claude-code": { project: ".claude/skills", global: ".claude/skills" },
  copilot: { project: ".github/skills", global: ".copilot/skills" },
};

export const ENGINES = Object.keys(ENGINE_DIR);

function countSkills(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(path.join(dir, d.name, "SKILL.md")))
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

export function engineSkillsDir(engine, scope, repo) {
  const rel = ENGINE_DIR[engine]?.[scope];
  if (!rel) throw new Error(`motor inválido: ${engine}`);
  return scope === "project" ? path.join(repo, rel) : path.join(os.homedir(), rel);
}

// `.mgr-core/` — config do projeto (project) ou global (home).
export function coreDir(scope, repo) {
  const base = scope === "global" ? os.homedir() : repo;
  return path.join(base, bundle.RUNTIME_DIR_NAME);
}

const absDir = (d, scope, repo) => (path.isAbsolute(d) ? d : (scope === "project" ? path.join(repo, d) : d));

// Referência (string) que substitui o token {{MGR_ARCH_RULES}} nas skills arch-*.
function archRulesRef(engineDir, scope, repo) {
  const shared = path.join(engineDir, "_shared", "arch", "regras-transversais.md");
  return scope === "project" ? path.relative(repo, shared) : shared;
}

export function planInstall(engines, scope, repo, opts = {}) {
  const { skillsDir = null, language = null, architecture = null, optional = [], all = false, names = null, projectId = null } = opts;
  const skills = names || (all ? bundle.skillNames() : catalog.selectSkills({ language, architecture, optional }));
  const targets = skillsDir
    ? [{ engine: "custom", dir: skillsDir }]
    : engines.map((e) => ({ engine: e, dir: engineSkillsDir(e, scope, repo) }));
  const pid = projectId || path.basename(path.resolve(repo));
  return { engines: skillsDir ? ["custom"] : engines, scope, repo, targets, skills, language, architecture, projectId: pid };
}

// Migra do modelo antigo (runtime-launcher): remove lançadores e o conteúdo de skills/shared
// de dentro de `.mgr-core/`, mantendo o diretório (será reescrito como config).
export function migrateOld(scope, repo) {
  const core = coreDir(scope, repo);
  const man = readManifest(core);
  if (!man || man.model !== "runtime-launcher") return null;
  const removed = [];
  const dirs = man.skillsDirs || (man.skillsDir ? [man.skillsDir] : []);
  for (const d of dirs) {
    const base = absDir(d, scope, repo);
    for (const name of man.skills || []) {
      const p = path.join(base, name);
      if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); removed.push(p); }
    }
  }
  for (const sub of ["skills", "shared"]) {
    const p = path.join(core, sub);
    if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); removed.push(p); }
  }
  return { removed, version: man.version };
}

export function execute(plan) {
  const migrated = migrateOld(plan.scope, plan.repo);
  for (const t of plan.targets) {
    const ref = t.engine === "custom" ? undefined : archRulesRef(t.dir, plan.scope, plan.repo);
    installEngine(t.dir, plan.skills, { archRulesRef: ref });
  }
  const core = coreDir(plan.scope, plan.repo);
  const rel = (p) => (plan.scope === "project" ? path.relative(plan.repo, p) : p);
  writeManifest(core, {
    version: bundle.readVersion(),
    scope: plan.scope,
    engines: plan.engines,
    language: plan.language,
    architecture: plan.architecture,
    projectId: plan.projectId,
    skillsDirs: plan.targets.map((t) => rel(t.dir)),
    skills: plan.skills,
  });
  writeEnv(core, plan.projectId);
  return {
    targets: plan.targets.map((t) => ({ engine: t.engine, dir: t.dir })),
    skills: plan.skills, migrated, core, projectId: plan.projectId,
  };
}

export function installs(scope, repo) {
  const man = readManifest(coreDir(scope, repo));
  return man ? [{ ...man, core: coreDir(scope, repo) }] : [];
}

export function detectPrior(scope, repo) {
  return readManifest(coreDir(scope, repo));
}

export function uninstall(scope, repo) {
  const core = coreDir(scope, repo);
  const man = readManifest(core);
  if (!man) throw new Error("nenhuma instalação MGR encontrada — nada a desinstalar");
  const removed = [];
  const dirs = man.skillsDirs || (man.skillsDir ? [man.skillsDir] : []);
  for (const d of dirs) {
    const base = absDir(d, scope, repo);
    for (const name of man.skills || []) {
      const p = path.join(base, name);
      if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); removed.push(p); }
    }
    const sh = path.join(base, "_shared");
    if (existsSync(sh)) { rmSync(sh, { recursive: true, force: true }); removed.push(sh); }
    if (existsSync(base) && readdirSync(base).length === 0) { rmSync(base, { recursive: true, force: true }); removed.push(base); }
  }
  if (existsSync(core)) { rmSync(core, { recursive: true, force: true }); removed.push(core); }
  return { removed };
}

export function update(scope, repo) {
  const man = readManifest(coreDir(scope, repo));
  if (!man) throw new Error("nenhuma instalação MGR encontrada — rode `mgr install` antes");
  const engines = (man.engines || [man.engine]).filter((x) => x && x !== "custom");
  const plan = planInstall(engines.length ? engines : ["claude-code"], scope, repo, {
    names: man.skills, language: man.language, architecture: man.architecture, projectId: man.projectId,
  });
  return execute(plan);
}
