// Instalação no modelo AUTOSSUFICIENTE por motor: o conteúdo completo das skills selecionadas
// vai direto para a pasta do motor (.claude/skills ou .github/skills), com um manifesto próprio.
// Não há runtime compartilhado (.mgr-core) nem lançadores — cada motor é independente.
// Instalações do modelo antigo (runtime-launcher) são migradas automaticamente no install.
//
// Convenção por motor:
//   claude-code : <repo>/.claude/skills  |  ~/.claude/skills
//   copilot     : <repo>/.github/skills  |  ~/.copilot/skills
import { existsSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as bundle from "./bundle.js";
import { installEngine } from "./builder.js";
import { readManifest, writeManifest, readLegacyManifest } from "./manifest.js";
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

function legacyRuntimeDir(scope, repo) {
  const base = scope === "global" ? os.homedir() : repo;
  return path.join(base, bundle.RUNTIME_DIR_NAME);
}

// Referência (string) que substitui o token {{MGR_ARCH_RULES}} nas skills arch-*.
function archRulesRef(engineDir, scope, repo) {
  const shared = path.join(engineDir, "_shared", "arch", "regras-transversais.md");
  return scope === "project" ? path.relative(repo, shared) : shared;
}

// engines: array. Opções: { skillsDir, language, architecture, optional, all, names }.
export function planInstall(engines, scope, repo, opts = {}) {
  const { skillsDir = null, language = null, architecture = null, optional = [], all = false, names = null } = opts;
  const skills = names || (all ? bundle.skillNames() : catalog.selectSkills({ language, architecture, optional }));
  const targets = skillsDir
    ? [{ engine: "custom", dir: skillsDir }]
    : engines.map((e) => ({ engine: e, dir: engineSkillsDir(e, scope, repo) }));
  return { engines: skillsDir ? ["custom"] : engines, scope, repo, targets, skills, language, architecture };
}

// Remove artefatos do modelo antigo (runtime-launcher): lançadores + `.mgr-core/`.
export function removeLegacy(scope, repo) {
  const runtime = legacyRuntimeDir(scope, repo);
  const man = readLegacyManifest(runtime);
  if (!man) return null;
  const removed = [];
  const dirs = man.skillsDirs || (man.skillsDir ? [man.skillsDir] : []);
  for (const d of dirs) {
    const base = path.isAbsolute(d) ? d : (scope === "project" ? path.join(repo, d) : d);
    for (const name of man.skills || []) {
      const p = path.join(base, name);
      if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); removed.push(p); }
    }
  }
  if (existsSync(runtime)) { rmSync(runtime, { recursive: true, force: true }); removed.push(runtime); }
  return { removed, version: man.version };
}

export function execute(plan) {
  const migrated = removeLegacy(plan.scope, plan.repo); // migração automática do modelo antigo
  const targets = [];
  for (const t of plan.targets) {
    const ref = t.engine === "custom" ? undefined : archRulesRef(t.dir, plan.scope, plan.repo);
    installEngine(t.dir, plan.skills, { archRulesRef: ref });
    const rel = (p) => (plan.scope === "project" ? path.relative(plan.repo, p) : p);
    writeManifest(t.dir, {
      version: bundle.readVersion(),
      engine: t.engine,
      engines: plan.engines,
      scope: plan.scope,
      language: plan.language,
      architecture: plan.architecture,
      skillsDir: rel(t.dir),
      skills: plan.skills,
    });
    targets.push({ engine: t.engine, dir: t.dir });
  }
  return { targets, skills: plan.skills, migrated };
}

// Instalações existentes num escopo (novas por motor + legado), para status/aviso.
export function installs(scope, repo) {
  const out = [];
  for (const e of ENGINES) {
    const man = readManifest(engineSkillsDir(e, scope, repo));
    if (man) out.push({ ...man, dir: engineSkillsDir(e, scope, repo) });
  }
  const legacy = readLegacyManifest(legacyRuntimeDir(scope, repo));
  if (legacy) out.push({ ...legacy, dir: legacyRuntimeDir(scope, repo), legacy: true });
  return out;
}

export function detectPrior(scope, repo) {
  const list = installs(scope, repo);
  return list.length ? list : null;
}

export function uninstall(scope, repo, engine = null) {
  const removed = [];
  const legacy = removeLegacy(scope, repo);
  if (legacy) removed.push(...legacy.removed);
  for (const e of (engine ? [engine] : ENGINES)) {
    const dir = engineSkillsDir(e, scope, repo);
    const man = readManifest(dir);
    if (!man) continue;
    for (const name of man.skills || []) {
      const p = path.join(dir, name);
      if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); removed.push(p); }
    }
    for (const extra of ["_shared", ".mgr-manifest.json"]) {
      const p = path.join(dir, extra);
      if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); removed.push(p); }
    }
    if (existsSync(dir) && readdirSync(dir).length === 0) { rmSync(dir, { recursive: true, force: true }); removed.push(dir); }
  }
  if (!removed.length) throw new Error("nenhuma instalação MGR encontrada — nada a desinstalar");
  return { removed };
}

export function update(scope, repo, engine = null) {
  const list = installs(scope, repo).filter((m) => !m.legacy);
  const engines = [...new Set(list.map((m) => m.engine).filter(Boolean))];
  if (engines.length) {
    const ref = list[0];
    const plan = planInstall(engine ? [engine] : engines, scope, repo, {
      language: ref.language, architecture: ref.architecture, names: ref.skills,
    });
    return execute(plan);
  }
  // Só há instalação antiga → migra preservando as skills que havia.
  const legacy = readLegacyManifest(legacyRuntimeDir(scope, repo));
  if (!legacy) throw new Error("nenhuma instalação MGR encontrada — rode `mgr install` antes");
  const eng = (legacy.engines || [legacy.engine]).filter((x) => x && x !== "custom");
  const plan = planInstall(eng.length ? eng : ["claude-code"], scope, repo, { names: legacy.skills });
  return execute(plan);
}
