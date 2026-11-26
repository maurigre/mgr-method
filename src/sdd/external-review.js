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
const PROOF_SCHEMA_VERSION = 1;
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
  pathWithNewline: "path-with-newline",
  changedDuringReview: "changed-during-review",
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

// Confere `valor` contra a forma do schema. Resultado discriminado (DES-1): `{ ok: true }` ou
// `{ ok: false, field }` com o caminho do PRIMEIRO campo errado.
const certo = { ok: true };
const errado = (field) => ({ ok: false, field });

function conferirLista(valor, schema, caminho) {
  if (!Array.isArray(valor)) return errado(caminho);
  for (const [posicao, item] of valor.entries()) {
    const conferido = conferir(item, schema.items, `${caminho}[${posicao}]`);
    if (!conferido.ok) return conferido;
  }
  return certo;
}

function conferirObjeto(valor, schema, caminho) {
  if (!isPlainObject(valor)) return errado(caminho);
  const extra = Object.keys(valor).find((chave) => !Object.hasOwn(schema.properties, chave));
  if (extra !== undefined) return errado(`${caminho}.${extra}`);
  for (const chave of schema.required) {
    if (!Object.hasOwn(valor, chave)) return errado(`${caminho}.${chave}`);
    const conferido = conferir(valor[chave], schema.properties[chave], `${caminho}.${chave}`);
    if (!conferido.ok) return conferido;
  }
  return certo;
}

function conferir(valor, schema, caminho) {
  if (schema.type === "string") {
    return typeof valor === "string" && (!schema.enum || schema.enum.includes(valor)) ? certo : errado(caminho);
  }
  if (schema.type === "integer") return Number.isInteger(valor) && valor >= schema.minimum ? certo : errado(caminho);
  if (schema.type === "array") return conferirLista(valor, schema, caminho);
  return conferirObjeto(valor, schema, caminho);
}

// Revalida a resposta já interpretada como JSON. Devolve o caminho do PRIMEIRO campo errado.
export function validateResponse(valor) {
  const conferido = conferir(valor, RESPONSE_SCHEMA, "$");
  if (!conferido.ok) return conferido;
  const achados = [...valor.standards.map((achado, posicao) => [achado, `$.standards[${posicao}].file`]),
    ...valor.spec.map((achado, posicao) => [achado, `$.spec[${posicao}].file`])];
  const inseguro = achados.find(([achado]) => !caminhoSeguro(achado.file));
  if (inseguro) return errado(inseguro[1]);
  return { ok: true, response: valor };
}

// As regras do guia quebram linha no meio da frase: sem colapsar o espaço, citação fiel falharia.
// Limite declarado: não remove marcação Markdown.
const normalizar = (valor) => valor.replace(/\s+/g, " ").trim();
const contem = (fonte, citacao) => normalizar(citacao) !== "" && normalizar(fonte).includes(normalizar(citacao));

// O ID como o guia o escreve, sem a moldura: o revisor pode devolver `(SEC-4)` ou `` `SEC-4` ``, e o guia
// é conferido pelo texto `(SEC-4)` (medido na primeira revisão real, 2026-11-26).
const ruleId = (valor) => valor.trim().replace(/^[(`\s]+|[)`\s]+$/g, "");

// Citação conferida ou o motivo do rebaixamento, discriminados (DES-1).
const confirmada = { confirmed: true };
const rebaixar = (reason) => ({ confirmed: false, reason });

function citacaoDoGuia(achado, guide) {
  if (!guide.present) return rebaixar("no-guide");
  if (!guide.text.includes(`(${ruleId(achado.rule)})`)) return rebaixar("rule-not-in-guide");
  return contem(guide.text, achado.quote) ? confirmada : rebaixar("quote-not-in-guide");
}

function citacaoDaSpec(achado, specSources) {
  const fonte = specSources.find((candidata) => candidata.path === achado.source);
  if (!fonte) return rebaixar("source-not-allowed");
  return contem(fonte.text, achado.quote) ? confirmada : rebaixar("quote-not-in-source");
}

// Confere cada citação no texto da fonte (DT-8). `guide` é `{ present: false }` ou `{ present: true,
// text }`; `specSources` é a lista PERMITIDA de `{ path, text }` (os 02/03 da fatia). Achado conferido
// ganha id `R<rodada>-S<n>`/`R<rodada>-P<n>`; o resto vira sugestão com o motivo do rebaixamento.
export function checkCitations(response, { guide, specSources, round }) {
  const rebaixadas = [];
  const standards = [];
  for (const achado of response.standards) {
    const citacao = citacaoDoGuia(achado, guide);
    if (citacao.confirmed) standards.push({ id: `R${round}-S${standards.length + 1}`, ...achado, rule: ruleId(achado.rule) });
    else rebaixadas.push({ text: `${achado.file}:${achado.line} ${achado.violation}`, demotedFrom: "standards", reason: citacao.reason, rule: achado.rule, quote: achado.quote });
  }
  const spec = [];
  for (const achado of response.spec) {
    const citacao = citacaoDaSpec(achado, specSources);
    if (citacao.confirmed) spec.push({ id: `R${round}-P${spec.length + 1}`, ...achado });
    else rebaixadas.push({ text: `${achado.file}:${achado.line} ${achado.finding}`, demotedFrom: "spec", reason: citacao.reason, source: achado.source, quote: achado.quote });
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
const comId = (schema) => ({ ...schema, required: ["id", ...schema.required], properties: { id: texto, ...schema.properties } });
const ACHADO_GRAVADO = Object.freeze({
  standards: comId(RESPONSE_SCHEMA.properties.standards.items),
  spec: comId(RESPONSE_SCHEMA.properties.spec.items),
});
const CAMPOS_DA_SUGESTAO = ["text", "demotedFrom", "reason", "rule", "quote", "source"];

const sugestaoValida = (sugestao) => isPlainObject(sugestao) && typeof sugestao.text === "string"
  && Object.entries(sugestao).every(([chave, valor]) => CAMPOS_DA_SUGESTAO.includes(chave) && typeof valor === "string");

function achadosValidos(findings) {
  if (!isPlainObject(findings)) return errado("findings");
  for (const eixo of ["standards", "spec"]) {
    if (!Array.isArray(findings[eixo])) return errado(`findings.${eixo}`);
    for (const [posicao, achado] of findings[eixo].entries()) {
      if (!conferir(achado, ACHADO_GRAVADO[eixo], "").ok) return errado(`findings.${eixo}[${posicao}]`);
    }
  }
  return certo;
}

// A forma inteira de cada entrada (spec DT-6; R1-P5): `{ ok: true }` ou o campo errado.
function conferirRevisao(entrada) {
  const faltando = CAMPOS_DA_REVISAO.find((campo) => !textoNaoVazio(entrada[campo]));
  if (faltando) return errado(faltando);
  const opcional = ["model", "effort"].find((campo) => Object.hasOwn(entrada, campo) && !textoNaoVazio(entrada[campo]));
  if (opcional) return errado(opcional);
  if (!Array.isArray(entrada.files) || entrada.files.length === 0 || !entrada.files.every(arquivoValido)) return errado("files");
  if (!["reviewed", "abstained"].includes(entrada.specAxis)) return errado("specAxis");
  const achados = achadosValidos(entrada.findings);
  if (!achados.ok) return achados;
  return Array.isArray(entrada.suggestions) && entrada.suggestions.every(sugestaoValida) ? certo : errado("suggestions");
}

function conferirEntrada(entrada) {
  if (!isPlainObject(entrada) || !ENTRY_KINDS.includes(entrada.kind)) return errado("kind");
  if (entrada.kind === "waiver") {
    const faltando = ["by", "at", "reason", "failure"].find((campo) => !textoNaoVazio(entrada[campo]));
    return faltando ? errado(faltando) : certo;
  }
  if (!textoNaoVazio(entrada.reviewer)) return errado("reviewer");
  if (!Number.isInteger(entrada.round) || entrada.round < 1) return errado("round");
  if (entrada.kind === "failure") {
    const faltando = ["at", "code"].find((campo) => !textoNaoVazio(entrada[campo]));
    return faltando ? errado(faltando) : certo;
  }
  return conferirRevisao(entrada);
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
    const conferida = conferirEntrada(entrada);
    if (!conferida.ok) return { state: "invalid", detail: `entries[${posicao}].${conferida.field}` };
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
