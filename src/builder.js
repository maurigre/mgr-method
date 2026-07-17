// Build das skills.
// Modelo autossuficiente por motor: o conteúdo completo das skills é escrito DIRETO na pasta
// do motor (.claude/skills ou .github/skills). Sem runtime compartilhado, sem lançadores —
// cada motor é independente e pode ser removido sem afetar o outro.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import * as bundle from "./bundle.js";
import * as catalog from "./catalog.js";

export function buildSkill(name, destSkills) {
  const src = path.join(bundle.skillsDir(), name);
  if (!existsSync(path.join(src, "SKILL.md"))) {
    throw new Error(`skill inexistente ou sem SKILL.md: ${name}`);
  }
  const dest = path.join(destSkills, name);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  return dest;
}

export function buildAll(destSkills, names) {
  mkdirSync(destSkills, { recursive: true });
  names = names || bundle.skillNames();
  return names.map((n) => buildSkill(n, destSkills));
}

// Gera um diretório com o conteúdo completo (utilitário do comando `mgr build`).
export function buildRuntime(runtimeDir, names) {
  names = names || bundle.skillNames();
  buildAll(path.join(runtimeDir, "skills"), names);
  for (const sub of ["shared"]) {
    const dst = path.join(runtimeDir, sub);
    rmSync(dst, { recursive: true, force: true });
    cpSync(bundle.pkgDir(sub), dst, { recursive: true });
  }
  return names;
}

// Resolve a linha-ponteiro de idioma de uma SKILL.md para o idioma de saída do usuário.
export function resolveUserLanguage(text, userLanguage) {
  return text.replaceAll(catalog.USER_LANGUAGE_TOKEN, userLanguage || catalog.USER_LANGUAGE_FALLBACK);
}

// Instala o conjunto de skills DIRETO na pasta do motor (modelo autossuficiente).
// Copia a fonte transversal (_shared/arch) quando há skill de arquitetura, resolve o token
// {{MGR_ARCH_RULES}} para o caminho passado em archRulesRef e o {{MGR_USER_LANGUAGE}} de
// todas as skills para userLanguage.
export function installEngine(engineSkillsDir, skills, { archRulesRef, userLanguage } = {}) {
  mkdirSync(engineSkillsDir, { recursive: true });
  const dirs = skills.map((name) => buildSkill(name, engineSkillsDir));

  for (const name of skills) {
    const md = path.join(engineSkillsDir, name, "SKILL.md");
    const text = readFileSync(md, "utf8");
    if (text.includes(catalog.USER_LANGUAGE_TOKEN)) {
      writeFileSync(md, resolveUserLanguage(text, userLanguage), "utf8");
    }
  }

  // Migração (CONSTITUTION §2.7): instalações ≤ 0.4.x têm a fonte co-locada com os nomes
  // pt antigos; sem esta limpeza o update deixaria o arquivo órfão ao lado do novo.
  for (const legacy of ["arch/regras-transversais.md", "quality/regras-qualidade.md"]) {
    rmSync(path.join(engineSkillsDir, "_shared", legacy), { force: true });
  }

  if (catalog.needsArchShared(skills)) {
    const dst = path.join(engineSkillsDir, "_shared", "arch");
    mkdirSync(dst, { recursive: true });
    const shared = path.join(bundle.pkgDir("shared"), "arch", "cross-cutting-rules.md");
    cpSync(shared, path.join(dst, "cross-cutting-rules.md"));

    const ref = archRulesRef || path.join("_shared", "arch", "cross-cutting-rules.md");
    const archSkills = Object.values(catalog.ARCHITECTURES);
    for (const name of skills) {
      if (!archSkills.includes(name)) continue;
      const md = path.join(engineSkillsDir, name, "SKILL.md");
      const text = readFileSync(md, "utf8").replaceAll(catalog.ARCH_RULES_TOKEN, ref);
      writeFileSync(md, text, "utf8");
    }
  }

  // Fonte de qualidade (co-locada) — usada pelo spec-init ao montar o guia de review.
  if (skills.includes("spec-init")) {
    const qdst = path.join(engineSkillsDir, "_shared", "quality");
    mkdirSync(qdst, { recursive: true });
    cpSync(path.join(bundle.pkgDir("shared"), "quality", "quality-rules.md"),
      path.join(qdst, "quality-rules.md"));
  }
  return dirs;
}
