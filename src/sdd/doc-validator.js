// Descoberta e leitura dos artefatos para o eixo de documentação (ADR-0020). Espelha o
// `prov-validator`: IO e orquestração aqui, decisão pura em `doc-rules`.
//
// A descoberta vem do `spec-status`, e não de glob próprio: quem sabe onde artefato vive é aquele
// módulo, e duplicar a descoberta foi reprovação de gate em fatia anterior.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PRESENT, statusAll, statusFor } from "./spec-status.js";
import { summarize } from "./findings.js";
import { COMPLETION_FILE, check, parse } from "./doc-rules.js";

/**
 * Roda o eixo de documentação sobre as features do repositório, ou sobre uma só.
 *
 * **Só o artefato de fechamento é lido.** Os outros nem chegam à regra: exigir a declaração de diff
 * de um brief seria acusar ausência de algo que aquele artefato nunca prometeu — e é a mesma
 * disciplina que o `prov-rules` aplica ao só olhar posição de marca.
 */
export function validateDocs(repo, { slug = null } = {}) {
  const features = slug ? [statusFor(repo, { slug })] : statusAll(repo);
  const files = [];
  const findings = [];

  for (const feature of features) {
    if (!feature.found) continue;
    for (const artefato of feature.artifacts) {
      if (artefato.status !== PRESENT) continue;
      if (path.basename(artefato.path) !== COMPLETION_FILE) continue;
      files.push(artefato.path);
      const parsed = parse(readFileSync(path.join(repo, artefato.path), "utf8"));
      findings.push(...check(parsed, artefato.path, { repo }));
    }
  }

  return { files, findings, summary: summarize(findings) };
}
