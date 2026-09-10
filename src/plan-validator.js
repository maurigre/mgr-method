// Validação de artefato do projeto: descoberta, leitura e política (ADR-0012).
//
// Existe porque a §1 da spec declarou o padrão do `src/validator.js` — `checkSkill` puro,
// `validateSkill` com IO, comando fino na borda — e a primeira versão entregou os dois módulos
// puros deixando descoberta, leitura e política de bloqueio dentro de `bin/mgr.js`. INV-5 atribui
// persistência e decisão ao núcleo; a borda faz parse de flag, formatação e exit code.
//
// A política de bloqueio subiu para `findings.js` quando passou a valer para dois artefatos:
// bloquear é propriedade do achado, não do plano. Quem precisa dela importa de lá.
import { readFileSync } from "node:fs";
import path from "node:path";
import { SPECS_DIR, artifactFiles } from "./artifacts.js";
import { summarize } from "./findings.js";
import { PLAN_FILE, parse } from "./plan-parser.js";
import { check } from "./plan-rules.js";

// Slug derivado do diretório atual, quando se está dentro de `specs/<slug>/`. Devolve `null`
// quando não dá para derivar — quem chama decide o que fazer, em vez de receber um palpite.
export function slugFromCwd(repo, cwd) {
  const relativo = path.relative(path.join(repo, SPECS_DIR), cwd);
  if (!relativo || relativo.startsWith("..") || path.isAbsolute(relativo)) return null;
  return relativo.split(path.sep)[0] || null;
}

export function validatePlans(repo, { slug = null } = {}) {
  const arquivos = artifactFiles(repo, slug, PLAN_FILE);
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
