// Descoberta e leitura da proveniência dos artefatos (ADR-0016). Terceiro do trio que o
// `plan-validator` e o `spec-validator` já formavam: IO e orquestração no núcleo, nunca na borda
// (INV-5). A borda só formata e converte em exit code.
//
// Diferença deliberada em relação aos outros dois: eles leem UM arquivo por feature — o plano, a
// spec. A proveniência vale para QUALQUER artefato, porque asserção normativa não mora só na spec.
// Por isso a lista de arquivos vem do `spec-status`, que já é a fonte única dos seis artefatos
// canônicos, em vez de uma tabela nova aqui. Duplicar descoberta foi reprovação do gate isolado
// numa fatia anterior.
import { readFileSync } from "node:fs";
import path from "node:path";
import { summarize } from "./findings.js";
import { parse } from "./provenance.js";
import { check } from "./prov-rules.js";
import { PRESENT, statusAll, statusFor } from "./spec-status.js";

// `06-completion.md` em disco é o que torna a feature "fechada" para a `PROV-3` — o mesmo fato de
// existência de arquivo que o ADR-0015 fixou, lido pela mesma função. Não se infere fechamento de
// mais nada: o `spec-status` já diz que existência de artefato não é progresso, e cruzar com outro
// sinal seria julgamento disfarçado de dado.
const featureFechada = (feature) =>
  feature.artifacts.some((artefato) => artefato.id === "completion" && artefato.status === PRESENT);

export function validateProvenance(repo, { slug = null } = {}) {
  const features = slug ? [statusFor(repo, { slug })] : statusAll(repo);
  const files = [];
  const findings = [];

  for (const feature of features) {
    if (!feature.found) continue;
    const closed = featureFechada(feature);
    for (const artefato of feature.artifacts) {
      if (artefato.status !== PRESENT) continue;
      files.push(artefato.path);
      const parsed = parse(readFileSync(path.join(repo, artefato.path), "utf8"));
      findings.push(...check(parsed, artefato.path, { repo, closed }));
    }
  }

  return { files, findings, summary: summarize(findings) };
}
