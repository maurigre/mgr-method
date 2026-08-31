// Instalação no modelo AUTOSSUFICIENTE por motor: o conteúdo completo das skills selecionadas
// vai direto para a pasta do motor (.claude/skills ou .github/skills). O `.mgr-core/` guarda
// APENAS config do projeto (manifest.json + .env com MGR_PROJECT_ID) — sem skills.
// Instalações do modelo antigo (runtime-launcher, com skills dentro de .mgr-core) são migradas
// automaticamente no install: remove-se o conteúdo antigo e mantém-se o .mgr-core só como config.
//
// Convenção por motor:
//   claude-code : <repo>/.claude/skills  |  ~/.claude/skills
//   copilot     : <repo>/.github/skills  |  ~/.copilot/skills
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as bundle from "./bundle.js";
import { installAgents, installEngine, isOurAgent } from "./builder.js";
import * as engineDescriptors from "./engines/index.js";
import { readReviewGate } from "./registry.js";
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
  const shared = path.join(engineDir, "_shared", "arch", "cross-cutting-rules.md");
  return scope === "project" ? path.relative(repo, shared) : shared;
}

// Referência que substitui o token {{MGR_LAWS}} nas SKILL.md do CORE (ADR-0011).
function lawsRulesRef(engineDir, scope, repo) {
  const shared = path.join(engineDir, ...catalog.LAWS_INSTALLED);
  return scope === "project" ? path.relative(repo, shared) : shared;
}

// Fonte de leis JÁ INSTALADA de um motor, ou `null` se aquele motor não está instalado.
// Mora no núcleo porque é DECISÃO sobre estado persistido (INV-5/INV-6): a borda só formata.
// Resolvida pelo diretório do próprio motor, nunca por posição em `skillsDirs` — indexar por
// posição fazia o hook do copilot anunciar a árvore do claude-code.
export function installedLawsRef(engine, scope, repo) {
  const man = readManifest(coreDir(scope, repo));
  if (!man || !(man.engines || []).includes(engine)) return null;
  return lawsRulesRef(engineSkillsDir(engine, scope, repo), scope, repo);
}

// Diretório de agentes do motor, resolvido pelo descritor (ADR-0010) — mesma forma que
// engineSkillsDir faz para skills, mas sem um segundo mapa por motor aqui dentro.
export function engineAgentsDir(engine, scope, repo) {
  const rel = engineDescriptors.get(engine).agentsDir[scope];
  if (!rel) throw new Error(`escopo desconhecido: ${scope} (use project | global)`);
  return scope === "project" ? path.join(repo, rel) : path.join(os.homedir(), rel);
}

export function planInstall(engines, scope, repo, opts = {}) {
  const { skillsDir = null, language = null, architecture = null, userLanguage = null, optional = [], all = false, names = null, projectId = null, replaced = {} } = opts;
  const skills = names || (all ? bundle.skillNames() : catalog.selectSkills({ language, architecture, optional }));
  // Skill substituída por plugin sai do conjunto DAQUELE motor (ADR-0008): sem isso o
  // instalador escreveria a skill do método para o restore sobrescrever logo em seguida,
  // deixando no disco, no intervalo, a versão que o usuário não escolheu.
  const forEngine = (engine) => skills.filter((name) => !(replaced[engine] || {})[name]);
  const targets = skillsDir
    ? [{ engine: "custom", dir: skillsDir, skills }]
    : engines.map((e) => ({ engine: e, dir: engineSkillsDir(e, scope, repo), skills: forEngine(e) }));
  const pid = projectId || path.basename(path.resolve(repo));
  const reviewGate = readReviewGate(coreDir(scope, repo));
  return { engines: skillsDir ? ["custom"] : engines, scope, repo, targets, skills, replaced, language, architecture, userLanguage, projectId: pid, reviewGate };
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
  const gate = plan.reviewGate || readReviewGate(coreDir(plan.scope, plan.repo));
  const agents = [];
  const agentsDirs = [];
  const gateWarnings = [];
  for (const t of plan.targets) {
    const ref = t.engine === "custom" ? undefined : archRulesRef(t.dir, plan.scope, plan.repo);
    const engineId = t.engine === "custom" ? undefined : t.engine;
    installEngine(t.dir, t.skills || plan.skills, {
      archRulesRef: ref,
      lawsRulesRef: t.engine === "custom" ? undefined : lawsRulesRef(t.dir, plan.scope, plan.repo),
      userLanguage: plan.userLanguage, engineId, reviewGate: engineId ? gate : undefined,
    });
    // Motor "custom" (--skills-dir) não é plataforma: não há diretório de agentes para ele.
    if (!engineId || !gate.enabled) continue;
    const dir = engineAgentsDir(engineId, plan.scope, plan.repo);
    const skillRef = path.join(t.dir, catalog.REVIEW_GATE.skill, "SKILL.md");
    const { written, skipped, blocked } = installAgents(engineId, dir, gate, {
      reviewSkillRef: plan.scope === "project" ? path.relative(plan.repo, skillRef) : skillRef,
      userLanguage: plan.userLanguage,
    });
    if (written.length) { agents.push(...written); agentsDirs.push(dir); }
    for (const capability of skipped) gateWarnings.push({ engine: engineId, capability });
    for (const file of blocked) gateWarnings.push({ engine: engineId, blocked: file });
  }
  const core = coreDir(plan.scope, plan.repo);
  const rel = (p) => (plan.scope === "project" ? path.relative(plan.repo, p) : p);
  writeManifest(core, {
    version: bundle.readVersion(),
    scope: plan.scope,
    engines: plan.engines,
    language: plan.language,
    architecture: plan.architecture,
    userLanguage: plan.userLanguage,
    projectId: plan.projectId,
    skillsDirs: plan.targets.map((t) => rel(t.dir)),
    // `skills` continua sendo o conjunto PRETENDIDO do método — é o que faz a skill voltar
    // quando o plugin que a substituiu for removido (DT-6). `replaced` diz o que, hoje,
    // está cedido a um plugin naquele motor.
    skills: plan.skills,
    ...(Object.keys(plan.replaced || {}).length ? { replaced: plan.replaced } : {}),
    // Agentes instalados: é o que faz o uninstall saber o que remover e o update, o que
    // reescrever — mesmo contrato que as skills já têm.
    ...(agents.length ? { agentsDirs: agentsDirs.map(rel), agents: agents.map(rel) } : {}),
  });
  writeEnv(core, plan.projectId);
  return {
    targets: plan.targets.map((t) => ({ engine: t.engine, dir: t.dir })),
    skills: plan.skills, migrated, core, projectId: plan.projectId,
    agents, gate, gateWarnings,
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
  const kept = [];
  for (const file of man.agents || []) {
    const p = absDir(file, scope, repo);
    if (!existsSync(p)) continue;
    // Prova de posse: se o arquivo perdeu o marcador, alguém o reescreveu — não é nosso.
    if (!isOurAgent(readFileSync(p, "utf8"))) { kept.push(p); continue; }
    rmSync(p, { force: true });
    removed.push(p);
  }
  for (const d of man.agentsDirs || []) {
    const base = absDir(d, scope, repo);
    if (existsSync(base) && readdirSync(base).length === 0) {
      rmSync(base, { recursive: true, force: true });
      removed.push(base);
    }
  }
  if (existsSync(core)) { rmSync(core, { recursive: true, force: true }); removed.push(core); }
  return { removed, kept };
}

export function update(scope, repo, { replaced = {} } = {}) {
  const man = readManifest(coreDir(scope, repo));
  if (!man) throw new Error("nenhuma instalação MGR encontrada — rode `mgr install` antes");
  const engines = (man.engines || [man.engine]).filter((x) => x && x !== "custom");
  const plan = planInstall(engines.length ? engines : ["claude-code"], scope, repo, {
    names: man.skills, language: man.language, architecture: man.architecture, projectId: man.projectId,
    // Manifesto anterior a esta versão não tem userLanguage: toda instalação dessa era é
    // pt-BR — herdar preserva a experiência sem pergunta nova (decisão do CHECKPOINT 1).
    userLanguage: man.userLanguage || "pt-BR",
    replaced,
  });
  return execute(plan);
}
