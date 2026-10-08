import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const listarMarkdown = (dir) => readdirSync(dir).filter((nome) => nome.endsWith(".md") && !nome.startsWith("."));

export function checkSdd(root, { exists = existsSync, listMd = listarMarkdown } = {}) {
  const dir = path.join(root, "docs", "sdd");
  const falha = (reason) => ({ ok: false, reason, warnings: [], dir });

  if (!exists(dir)) return falha("no-dir");
  if (!exists(path.join(dir, "CONSTITUTION.md"))) return falha("no-constitution");
  if (listMd(dir).length === 0) return falha("empty");

  const warnings = exists(path.join(dir, "09-review-rules.md")) ? [] : ["no-review-rules"];
  return { ok: true, reason: null, warnings, dir };
}
