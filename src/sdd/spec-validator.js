// Descoberta e leitura das specs de um projeto (ADR-0013). Espelha o `plan-validator`: IO e
// orquestração no núcleo, nunca na borda (INV-5). A borda só formata e converte em exit code.
import { readFileSync } from "node:fs";
import path from "node:path";
import { artifactFiles } from "./artifacts.js";
import { summarize } from "./findings.js";
import { parse } from "./spec-parser.js";
import { check } from "./spec-rules.js";

const SPEC_FILE = "03-spec.md";

export function validateSpecs(repo, { slug = null } = {}) {
  const arquivos = artifactFiles(repo, slug, SPEC_FILE);
  const findings = [];
  let criteria = 0;
  for (const arquivo of arquivos) {
    const parsed = parse(readFileSync(arquivo, "utf8"));
    // Só conta o que foi de fato CONFERIDO: numa spec sem marcador as regras não rodam, e somar
    // os critérios dela faria a linha de OK dizer "N conferidos" sobre o que ninguém olhou.
    if (parsed.format.declared) criteria += parsed.criteria.length;
    findings.push(...check(parsed, path.relative(repo, arquivo)));
  }
  return {
    files: arquivos.map((arquivo) => path.relative(repo, arquivo)),
    criteria,
    findings,
    summary: summarize(findings),
  };
}
