// Núcleo puro da revisão externa (ADR-0036, K13; spec da fatia revisor-externo, DT-5 a DT-8 e DT-12).
// Nada aqui chama processo nem toca o disco: o texto do guia e da spec, a saída do revisor e o conteúdo
// dos arquivos no HEAD chegam por parâmetro. Quem roda o `codex` e o `git` é a borda (`bin/review-io.js`),
// e quem lê e grava arquivos é a cola (`src/commands/review.js`), no desenho do `archive.js`.
//
// O MGR nunca confia na conformidade declarada pelo revisor: a resposta é revalidada aqui contra a mesma
// forma do schema, e cada citação é conferida no texto da fonte. Apontamento sem citação conferida não
// bloqueia: vira sugestão registrada (RN-14, resposta 6 do CHECKPOINT 1).
import { createHash } from "node:crypto";
import { SPECS_DIR } from "./artifacts.js";

export const PROOF_FILE = "external-review.json";
export const PROOF_SCHEMA_VERSION = 1;
export const GUIDE_PATH = "docs/sdd/09-review-rules.md";

// Códigos estáveis: dado, não prosa (a cola traduz cada um para uma chave de mensagem).
export const REVIEW_REASONS = Object.freeze({
  needsSlug: "needs-slug",
  notFound: "not-found",
  archived: "archived",
  disabled: "disabled",
  reviewerAmbiguous: "reviewer-ambiguous",
  reviewerNotConfigured: "reviewer-not-configured",
  noConsent: "no-consent",
  notAGitRepo: "not-a-git-repo",
  needsBase: "needs-base",
  baseUnknown: "base-unknown",
  dirtyWorktree: "dirty-worktree",
  emptyDiff: "empty-diff",
  proofUnreadable: "proof-unreadable",
  notInstalled: "not-installed",
  notLoggedIn: "not-logged-in",
  reviewerFailed: "reviewer-failed",
  responseInvalid: "response-invalid",
  sessionMissing: "session-missing",
});

// As falhas do REVISOR (DT-9, casos 6 a 10): só elas viram entrada `failure` na prova, para a dispensa
// poder citar a falha que a originou. As falhas de uso e de pré-condição não são do revisor.
export const REVIEWER_FAILURES = Object.freeze([
  REVIEW_REASONS.notInstalled,
  REVIEW_REASONS.notLoggedIn,
  REVIEW_REASONS.reviewerFailed,
  REVIEW_REASONS.responseInvalid,
  REVIEW_REASONS.sessionMissing,
]);

const texto = { type: "string" };
const linha = { type: "integer", minimum: 1 };
const objetoFechado = (campos) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(campos),
  properties: campos,
});

// Formato fixo da resposta (DT-7): todo campo obrigatório, nenhum extra, sem `null` (DES-1). Espelha o
// achado do `code-analyzer` nos dois eixos, Standards e Spec, separados.
export const RESPONSE_SCHEMA = Object.freeze(objetoFechado({
  specAxis: { type: "string", enum: ["reviewed", "abstained"] },
  standards: {
    type: "array",
    items: objetoFechado({ rule: texto, quote: texto, violation: texto, justification: texto, fix: texto, file: texto, line: linha }),
  },
  spec: {
    type: "array",
    items: objetoFechado({ source: texto, quote: texto, finding: texto, justification: texto, fix: texto, file: texto, line: linha }),
  },
  suggestions: { type: "array", items: objetoFechado({ text: texto }) },
}));

// O pedido é o mesmo para qualquer ficha. Texto em inglês canônico (ADR-0003), com a linha de idioma
// vinda do `userLanguage`: não é texto mostrado ao usuário, é instrução ao revisor.
export function buildPrompt({ slug, base, files, specSources, language }) {
  const eixoSpec = specSources.length
    ? `- Spec: the originating spec at ${specSources.join(", ")}. Every spec finding MUST name the source file and quote the\n  spec line VERBATIM.`
    : "- Spec: No originating spec is available: set specAxis to \"abstained\" and leave spec empty.";
  return [
    `You are an external, read-only code reviewer for the feature "${slug}".`,
    `Do not modify any file. Review only these files, as changed by \`git diff ${base}...HEAD\`:`,
    ...files,
    "Review on two independent axes and never merge them:",
    `- Standards: the project rules guide at ${GUIDE_PATH}. Every standards finding MUST`,
    "  name the rule ID exactly as written in the guide, e.g. (SEC-4), and quote the rule text VERBATIM.",
    eixoSpec,
    "A problem with no verbatim rule or spec line is NOT a finding: put it in suggestions.",
    "Report each finding at its code location as file (repository-relative path) and line.",
    `Output language: ${language}. Write every free-text field in that language; keep rule IDs,`,
    "paths and quotes exactly as they appear in the source.",
    "Answer only with the JSON object required by the output schema.",
  ].join("\n");
}

const isPlainObject = (valor) => typeof valor === "object" && valor !== null && !Array.isArray(valor);

// Caminho que veio de fora (SEC-2): relativo ao repositório e sem subir de diretório.
const caminhoSeguro = (valor) =>
  typeof valor === "string" && valor !== "" && !valor.startsWith("/") && !/^[A-Za-z]:/.test(valor)
  && !valor.split(/[\\/]/).includes("..");

function conferir(valor, schema, caminho) {
  if (schema.type === "string") {
    if (typeof valor !== "string") return caminho;
    return schema.enum && !schema.enum.includes(valor) ? caminho : undefined;
  }
  if (schema.type === "integer") {
    return Number.isInteger(valor) && valor >= schema.minimum ? undefined : caminho;
  }
  if (schema.type === "array") {
    if (!Array.isArray(valor)) return caminho;
    for (const [posicao, item] of valor.entries()) {
      const errado = conferir(item, schema.items, `${caminho}[${posicao}]`);
      if (errado !== undefined) return errado;
    }
    return undefined;
  }
  if (!isPlainObject(valor)) return caminho;
  const extra = Object.keys(valor).find((chave) => !Object.hasOwn(schema.properties, chave));
  if (extra !== undefined) return `${caminho}.${extra}`;
  for (const chave of schema.required) {
    const errado = Object.hasOwn(valor, chave)
      ? conferir(valor[chave], schema.properties[chave], `${caminho}.${chave}`)
      : `${caminho}.${chave}`;
    if (errado !== undefined) return errado;
  }
  return undefined;
}

// Revalida a resposta já interpretada como JSON. Devolve o caminho do PRIMEIRO campo errado.
export function validateResponse(valor) {
  const errado = conferir(valor, RESPONSE_SCHEMA, "$");
  if (errado !== undefined) return { ok: false, field: errado };
  const achados = [...valor.standards.map((achado, posicao) => [achado, `$.standards[${posicao}].file`]),
    ...valor.spec.map((achado, posicao) => [achado, `$.spec[${posicao}].file`])];
  const inseguro = achados.find(([achado]) => !caminhoSeguro(achado.file));
  if (inseguro) return { ok: false, field: inseguro[1] };
  return { ok: true, response: valor };
}

// As regras do guia quebram linha no meio da frase: sem colapsar o espaço, citação fiel falharia.
// Limite declarado: não remove marcação Markdown.
const normalizar = (valor) => valor.replace(/\s+/g, " ").trim();
const contem = (fonte, citacao) => normalizar(citacao) !== "" && normalizar(fonte).includes(normalizar(citacao));

function motivoStandards(achado, guide) {
  if (!guide.present) return "no-guide";
  if (!guide.text.includes(`(${achado.rule})`)) return "rule-not-in-guide";
  return contem(guide.text, achado.quote) ? undefined : "quote-not-in-guide";
}

function motivoSpec(achado, specSources) {
  const fonte = specSources.find((candidata) => candidata.path === achado.source);
  if (!fonte) return "source-not-allowed";
  return contem(fonte.text, achado.quote) ? undefined : "quote-not-in-source";
}

// Confere cada citação no texto da fonte (DT-8). `guide` é `{ present: false }` ou `{ present: true,
// text }`; `specSources` é a lista PERMITIDA de `{ path, text }` (os 02/03 da fatia). Achado conferido
// ganha id `R<rodada>-S<n>`/`R<rodada>-P<n>`; o resto vira sugestão com o motivo do rebaixamento.
export function checkCitations(response, { guide, specSources, round }) {
  const rebaixadas = [];
  const standards = [];
  for (const achado of response.standards) {
    const motivo = motivoStandards(achado, guide);
    if (motivo === undefined) standards.push({ id: `R${round}-S${standards.length + 1}`, ...achado });
    else rebaixadas.push({ text: `${achado.file}:${achado.line} ${achado.violation}`, demotedFrom: "standards", reason: motivo });
  }
  const spec = [];
  for (const achado of response.spec) {
    const motivo = motivoSpec(achado, specSources);
    if (motivo === undefined) spec.push({ id: `R${round}-P${spec.length + 1}`, ...achado });
    else rebaixadas.push({ text: `${achado.file}:${achado.line} ${achado.finding}`, demotedFrom: "spec", reason: motivo });
  }
  return {
    specAxis: response.specAxis,
    findings: { standards, spec },
    suggestions: [...response.suggestions.map(({ text }) => ({ text })), ...rebaixadas],
  };
}

// Os arquivos revisados (DT-5): o que mudou desde a base, menos `specs/` (a spec é a REFERÊNCIA do eixo
// Spec, não o código revisado; e o próprio arquivo de prova nunca entra). Ordem estável.
export function reviewedPaths(changed) {
  return [...new Set(changed)]
    .filter((caminho) => caminho !== SPECS_DIR && !caminho.startsWith(`${SPECS_DIR}/`))
    .sort();
}

const sha256 = (conteudo) => createHash("sha256").update(conteudo).digest("hex");

// `contents` vem da borda: `{ path, state: "present", content: Buffer }` ou `{ path, state: "deleted" }`.
export function fileHashes(contents) {
  return contents.map((arquivo) => (arquivo.state === "present"
    ? { path: arquivo.path, state: "present", sha256: sha256(arquivo.content) }
    : { path: arquivo.path, state: "deleted" }));
}

// Compara os arquivos de uma revisão com os mesmos caminhos no HEAD de agora. Vale também depois do
// merge (resposta 2). Devolve os caminhos que mudaram; lista vazia = a revisão cobre o HEAD.
export function staleFiles(revisados, atuais) {
  const porCaminho = new Map(atuais.map((arquivo) => [arquivo.path, arquivo]));
  return revisados.filter((revisado) => {
    const atual = porCaminho.get(revisado.path);
    if (!atual || atual.state !== revisado.state) return true;
    return revisado.state === "present" && atual.sha256 !== revisado.sha256;
  }).map((revisado) => revisado.path);
}

const ENTRY_KINDS = ["review", "failure", "waiver"];
const HEX64 = /^[0-9a-f]{64}$/;
const textoNaoVazio = (valor) => typeof valor === "string" && valor !== "";

function arquivoValido(arquivo) {
  if (!isPlainObject(arquivo) || !caminhoSeguro(arquivo.path)) return false;
  if (arquivo.state === "deleted") return true;
  return arquivo.state === "present" && typeof arquivo.sha256 === "string" && HEX64.test(arquivo.sha256);
}

const CAMPOS_DA_REVISAO = ["reviewer", "provider", "version", "session", "at", "language", "base", "baseCommit", "head"];

function entradaInvalida(entrada) {
  if (!isPlainObject(entrada) || !ENTRY_KINDS.includes(entrada.kind)) return "kind";
  if (entrada.kind === "waiver") {
    return ["by", "at", "reason", "failure"].find((campo) => !textoNaoVazio(entrada[campo]));
  }
  if (!textoNaoVazio(entrada.reviewer)) return "reviewer";
  if (!Number.isInteger(entrada.round) || entrada.round < 1) return "round";
  if (entrada.kind === "failure") return textoNaoVazio(entrada.code) ? undefined : "code";
  const faltando = CAMPOS_DA_REVISAO.find((campo) => !textoNaoVazio(entrada[campo]));
  if (faltando) return faltando;
  if (!Array.isArray(entrada.files) || entrada.files.length === 0 || !entrada.files.every(arquivoValido)) return "files";
  return isPlainObject(entrada.findings) ? undefined : "findings";
}

// Lê a prova (DT-6). `text` ausente (o arquivo não existe) é estado próprio, não prova vazia. Arquivo
// que não é a forma conhecida é `invalid` com o detalhe, e a cola recusa sobrescrevê-lo.
export function parseProof(text, slug) {
  if (text === undefined) return { state: "absent" };
  let proof;
  try {
    proof = JSON.parse(text);
  } catch {
    return { state: "invalid", detail: "json" };
  }
  if (!isPlainObject(proof)) return { state: "invalid", detail: "json" };
  if (proof.schemaVersion !== PROOF_SCHEMA_VERSION) return { state: "invalid", detail: "schemaVersion" };
  if (proof.slug !== slug) return { state: "invalid", detail: "slug" };
  if (!Array.isArray(proof.entries)) return { state: "invalid", detail: "entries" };
  for (const [posicao, entrada] of proof.entries.entries()) {
    const campo = entradaInvalida(entrada);
    if (campo !== undefined) return { state: "invalid", detail: `entries[${posicao}].${campo}` };
  }
  return { state: "valid", proof };
}

// A rodada da próxima revisão: entradas `review` anteriores + 1 (resposta 4).
export const nextRound = (proofState) =>
  (proofState.state === "valid" ? proofState.proof.entries.filter((entrada) => entrada.kind === "review").length : 0) + 1;

// Acrescenta uma entrada sem apagar as anteriores. Só aceita prova ausente ou válida: a inválida nunca
// é sobrescrita (a cola recusa antes).
export function appendEntry(proofState, slug, entrada) {
  const anteriores = proofState.state === "valid" ? proofState.proof.entries : [];
  return { schemaVersion: PROOF_SCHEMA_VERSION, slug, entries: [...anteriores, entrada] };
}

// A última entrada que decide o archive: `review` ou `waiver`. A `failure` não é prova.
export function lastDecisive(proof) {
  const decisivas = proof.entries.filter((entrada) => entrada.kind !== "failure");
  return decisivas.length ? { found: true, entry: decisivas.at(-1) } : { found: false };
}
