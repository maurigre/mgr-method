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

// Instala o conjunto de skills DIRETO na pasta do motor (modelo autossuficiente).
// Copia a fonte transversal (_shared/arch) quando há skill de arquitetura e resolve o token
// {{MGR_ARCH_RULES}} para o caminho passado em archRulesRef.
export function installEngine(engineSkillsDir, skills, { archRulesRef } = {}) {
  mkdirSync(engineSkillsDir, { recursive: true });
  const dirs = skills.map((name) => buildSkill(name, engineSkillsDir));

  if (catalog.needsArchShared(skills)) {
    const dst = path.join(engineSkillsDir, "_shared", "arch");
    mkdirSync(dst, { recursive: true });
    const shared = path.join(bundle.pkgDir("shared"), "arch", "regras-transversais.md");
    cpSync(shared, path.join(dst, "regras-transversais.md"));

    const ref = archRulesRef || path.join("_shared", "arch", "regras-transversais.md");
    const archSkills = Object.values(catalog.ARCHITECTURES);
    for (const name of skills) {
      if (!archSkills.includes(name)) continue;
      const md = path.join(engineSkillsDir, name, "SKILL.md");
      const text = readFileSync(md, "utf8").replaceAll(catalog.ARCH_RULES_TOKEN, ref);
      writeFileSync(md, text, "utf8");
    }
  }
  return dirs;
}
