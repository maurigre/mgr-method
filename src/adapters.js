// Adapters por motor (ADR-0004/D05): traduzem o mgr-manifest.json para o que cada
// plataforma suporta HOJE e degradam com warning o que ela não suporta — instalação nunca
// falha por capacidade ausente. Matriz verificada em 2026-07-20 (spec §0):
//   claude-code  `model` e `effort` no frontmatter do SKILL.md
//   copilot      sem destino para model/effort em skills (feature request aberta)
// O bloco `applied` devolvido aqui vai ao lockfile (rastreabilidade D07, ADR-0006).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const PLUGIN_ENGINES = ["claude-code", "copilot"];

// Fonte única da forma de frontmatter aceita — reusada pelo scripts/export-plugin.mjs
// para o export gerar exatamente o que o adapter aceita.
export const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

// Insere/substitui campos simples no frontmatter YAML preservando os existentes.
export function injectFrontmatter(text, fields) {
  const match = text.match(FRONTMATTER_RE);
  if (!match) throw new Error("SKILL.md has no YAML frontmatter to inject into");
  let frontmatter = match[1];
  for (const [key, value] of Object.entries(fields)) {
    const line = `${key}: ${value}`;
    const existing = new RegExp(`^${key}:.*$`, "m");
    frontmatter = existing.test(frontmatter) ? frontmatter.replace(existing, line) : `${frontmatter}\n${line}`;
  }
  return text.replace(match[0], `---\n${frontmatter}\n---`);
}

// Tradução para o claude-code: injeta model/effort quando declarados no manifest.
export function applyManifestToSkillMd(text, manifest) {
  const fields = {};
  const applied = {};
  const displayName = manifest.model?.["claude-code"];
  if (displayName) {
    fields.model = displayName;
    applied.model = displayName;
  }
  if (manifest.effort) {
    fields.effort = manifest.effort;
    applied.effort = manifest.effort;
  }
  return { text: Object.keys(fields).length ? injectFrontmatter(text, fields) : text, applied };
}

// Degradação explícita do copilot: o que foi declarado e não tem destino vira warning.
export function copilotApplied(manifest) {
  const warnings = [];
  if (manifest.model?.copilot) {
    warnings.push(`model "${manifest.model.copilot}" declared but copilot skills have no model field; ignored`);
  }
  if (manifest.effort) {
    warnings.push(`effort "${manifest.effort}" not supported by copilot skills; effort is global only`);
  }
  return warnings.length ? { warnings } : {};
}

// Nome da pasta instalada: kebab da skill; em colisão entre registries (Q1), sufixo da
// origem — `x` e `x--empresa` convivem sem sobrescrita.
export function resolveInstallDirName(skillName, registryName, hasCollision) {
  return hasCollision ? `${skillName}--${registryName}` : skillName;
}

// Cabeçalho de composição do extends (v1: instala as duas com precedência da que estende —
// checkpoint 2/ADR-0004). Injetado logo após o frontmatter da skill que estende.
export function compositionHeader(extendsName, baseInstallPath) {
  return `> This skill extends \`${extendsName}\` (installed at \`${baseInstallPath}\`); `
    + "where instructions conflict, this skill takes precedence.";
}

export function injectCompositionHeader(text, header) {
  const match = text.match(FRONTMATTER_RE);
  if (!match) throw new Error("SKILL.md has no YAML frontmatter to inject into");
  return text.replace(match[0], `${match[0]}\n\n${header}`);
}

// Aplica o manifest à skill já copiada para a pasta do motor e devolve o bloco `applied`.
// `extendsBase` = caminho instalado da skill base, quando o manifest declara `extends`.
export function applyToEngine(engine, installedSkillDir, manifest, { extendsBase = null } = {}) {
  if (!PLUGIN_ENGINES.includes(engine)) {
    throw new Error(`invalid engine for plugin install: ${engine} (expected ${PLUGIN_ENGINES.join(" | ")})`);
  }
  const skillMd = path.join(installedSkillDir, "SKILL.md");
  let text = readFileSync(skillMd, "utf8");
  let applied;

  if (engine === "claude-code") {
    ({ text, applied } = applyManifestToSkillMd(text, manifest));
  } else {
    applied = copilotApplied(manifest);
  }
  if (manifest.extends && extendsBase) {
    text = injectCompositionHeader(text, compositionHeader(manifest.extends, extendsBase));
  }
  writeFileSync(skillMd, text, "utf8");
  return applied;
}
