// Validação de artefato do projeto: descoberta, leitura e política (ADR-0012).
//
// Existe porque a §1 da spec declarou o padrão do `src/validator.js` — `checkSkill` puro,
// `validateSkill` com IO, comando fino na borda — e a primeira versão entregou os dois módulos
// puros deixando descoberta, leitura e política de bloqueio dentro de `bin/mgr.js`. INV-5 atribui
// persistência e decisão ao núcleo; a borda faz parse de flag, formatação e exit code.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { summarize } from "./findings.js";
import { parse } from "./plan-parser.js";
import { check } from "./plan-rules.js";

export const PLAN_FILE = "04-plan.md";
export const SPECS_DIR = "specs";

// Avisos isentos do `--strict`. `PLAN-0` anuncia formato legado, e a RN-2 garante que formato
// antigo não reprova nem em modo estrito — vira erro só numa minor futura, com prazo.
export const STRICT_EXEMPT = ["PLAN-0"];

// Planos de um slug, ou de todos. Nunca inventa caminho: só devolve o que existe em disco.
export function planFiles(repo, slug = null) {
  const raiz = path.join(repo, SPECS_DIR);
  if (!existsSync(raiz)) return [];
  const slugs = slug
    ? [slug]
    : readdirSync(raiz, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  return slugs.map((nome) => path.join(raiz, nome, PLAN_FILE)).filter(existsSync);
}

// Slug derivado do diretório atual, quando se está dentro de `specs/<slug>/`. Devolve `null`
// quando não dá para derivar — quem chama decide o que fazer, em vez de receber um palpite.
export function slugFromCwd(repo, cwd) {
  const relativo = path.relative(path.join(repo, SPECS_DIR), cwd);
  if (!relativo || relativo.startsWith("..") || path.isAbsolute(relativo)) return null;
  return relativo.split(path.sep)[0] || null;
}

export function validatePlans(repo, { slug = null } = {}) {
  const arquivos = planFiles(repo, slug);
  const findings = [];
  let tasks = 0;
  for (const arquivo of arquivos) {
    const parsed = parse(readFileSync(arquivo, "utf8"));
    tasks += parsed.tasks.length;
    findings.push(...check(parsed, path.relative(repo, arquivo)));
  }
  return {
    files: arquivos.map((arquivo) => path.relative(repo, arquivo)),
    tasks,
    findings,
    summary: summarize(findings),
  };
}

// Quantos achados bloqueiam a saída. A política mora aqui, não na borda: a borda só converte o
// número em exit code. Quando a fatia 2 acrescentar outro aviso isento, muda-se um lugar só.
export function blocking(findings, { strict = false } = {}) {
  return findings.filter((finding) => {
    if (finding.severity === "error") return true;
    return strict && !STRICT_EXEMPT.includes(finding.code);
  }).length;
}
