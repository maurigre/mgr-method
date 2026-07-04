// Validação: garante que cada SKILL.md conforma ao spec de Agent Skills.
import { readFileSync } from "node:fs";
import path from "node:path";
import * as bundle from "./bundle.js";

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_LINES = 500;

function frontmatter(text) {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end === -1) return {};
  const meta = {};
  for (const line of text.slice(3, end).split("\n")) {
    const t = line.trim();
    if (t && !t.startsWith("#") && t.includes(":")) {
      const idx = line.indexOf(":");
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return meta;
}

export function validateSkill(name) {
  const problems = [];
  const md = path.join(bundle.skillsDir(), name, "SKILL.md");
  let text;
  try {
    text = readFileSync(md, "utf8");
  } catch {
    return [`${name}: falta SKILL.md`];
  }
  const meta = frontmatter(text);
  if (Object.keys(meta).length === 0) {
    problems.push(`${name}: sem frontmatter YAML (--- ... ---)`);
    return problems;
  }
  const nm = meta.name || "";
  if (!nm) problems.push(`${name}: frontmatter sem \`name\``);
  else {
    if (!NAME_RE.test(nm)) problems.push(`${name}: \`name\` não é kebab-case: ${nm}`);
    if (nm !== name) problems.push(`${name}: \`name\` (${nm}) difere do nome da pasta`);
  }
  if ((meta.description || "").length < 40) {
    problems.push(`${name}: \`description\` ausente ou curta demais (o que faz E quando usar)`);
  }
  const nLines = text.split("\n").length;
  if (nLines > MAX_LINES) {
    problems.push(`${name}: SKILL.md com ${nLines} linhas (> ${MAX_LINES}); use references/`);
  }
  return problems;
}

export function validateAll(names) {
  names = names || bundle.skillNames();
  const out = {};
  for (const n of names) out[n] = validateSkill(n);
  return out;
}
