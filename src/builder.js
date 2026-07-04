// Build no modelo runtime + lançadores (estilo BMAD).
// - Runtime: conteúdo completo escrito uma vez (as skills e utilitários compartilhados).
//   A CONSTITUTION.md do PROJETO é gerada pela skill spec-init — não pelo instalador.
// - Lançadores: SKILL.md finos, gerados na pasta do motor, que apontam para o runtime.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import * as bundle from "./bundle.js";

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  const meta = {};
  if (m) {
    for (const line of m[1].split("\n")) {
      const t = line.trim();
      if (t && !t.startsWith("#") && t.includes(":")) {
        const idx = line.indexOf(":");
        meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    }
  }
  return meta;
}

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

export function generateLauncher(name, runtimeRef, destSkills) {
  const srcMd = readFileSync(path.join(bundle.skillsDir(), name, "SKILL.md"), "utf8");
  const meta = frontmatter(srcMd);
  const desc = meta.description || `Skill ${name} do MGR.`;
  const target = `${runtimeRef}/SKILL.md`;

  const launcher =
    `---\n` +
    `name: ${name}\n` +
    `description: ${desc}\n` +
    `---\n\n` +
    `# ${name} (lançador MGR)\n\n` +
    `Esta skill faz parte do MGR e seu conteúdo canônico vive no runtime do projeto.\n` +
    `Abra \`${target}\` e siga **todas** as instruções contidas nele, incluindo os\n` +
    `recursos referenciados em \`${runtimeRef}/references/\` (constituição, contrato de\n` +
    `artefato, gates, práticas, arquiteturas). Trate aquele arquivo como se fosse o\n` +
    `corpo desta skill.\n`;

  const dest = path.join(destSkills, name);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  writeFileSync(path.join(dest, "SKILL.md"), launcher, "utf8");
  return dest;
}
