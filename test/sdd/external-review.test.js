import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  appendEntry,
  buildPrompt,
  checkCitations,
  fileHashes,
  lastDecisive,
  nextRound,
  parseProof,
  REVIEWER_FAILURES,
  reviewedPaths,
  staleFiles,
  validateResponse,
} from "../../src/sdd/external-review.js";

const SLUG = "revisor-externo";
const HASH = "a".repeat(64);
const OUTRO_HASH = "b".repeat(64);

const MINIMA = { specAxis: "reviewed", standards: [], spec: [], suggestions: [] };
const CAMPOS_DO_TOPO = ["specAxis", "standards", "spec", "suggestions"];

const ACHADO_NORMA = {
  rule: "SEC-4",
  quote: "Nunca logar segredos em texto puro.",
  violation: "Log de token",
  justification: "Vaza credencial",
  fix: "Remover o log",
  file: "src/a.js",
  line: 3,
};
const ACHADO_SPEC = {
  source: "specs/x/02-spec.md",
  quote: "O sistema deve validar a entrada.",
  finding: "Falta validação",
  justification: "Requisito não cumprido",
  fix: "Validar a entrada",
  file: "src/b.js",
  line: 4,
};
const GUIA = { present: true, text: "# Regras\n\n(SEC-4) Nunca logar segredos\nem texto puro.\n" };
const FONTES = [{ path: "specs/x/02-spec.md", text: "O sistema deve validar a entrada.\nFim." }];

const FALHA = { kind: "failure", round: 1, reviewer: "codex", at: "2026-11-26T10:00", code: "not-logged-in" };
const REVISAO = {
  kind: "review",
  reviewer: "codex",
  provider: "openai",
  version: "0.9.0",
  session: "sessao-1",
  at: "2026-11-26T10:05",
  language: "pt-BR",
  base: "release/mgr-evolution",
  baseCommit: "1111111",
  head: "2222222",
  round: 1,
  files: [{ path: "src/a.js", state: "present", sha256: HASH }],
  specAxis: "reviewed",
  findings: { standards: [{ id: "R1-S1", ...ACHADO_NORMA }], spec: [{ id: "R1-P1", ...ACHADO_SPEC }] },
  suggestions: [{ text: "s1" }, { text: "s2", demotedFrom: "standards", reason: "no-guide", rule: "SEC-4", quote: "q" }],
};
const DISPENSA = { kind: "waiver", by: "mr", at: "2026-11-26T11:00", reason: "cota", failure: "reviewer-failed" };

const semCampo = (objeto, campo) => Object.fromEntries(Object.entries(objeto).filter(([chave]) => chave !== campo));
const resposta = (sobrescritos = {}) => ({ ...MINIMA, ...sobrescritos });
const revisar = (sobrescritos = {}, guia = GUIA, round = 2) =>
  checkCitations(resposta(sobrescritos), { guide: guia, specSources: FONTES, round });
const provaCom = (entries) => ({ schemaVersion: 1, slug: SLUG, entries });
const textoDaProva = (entries, sobrescritos = {}) => JSON.stringify({ ...provaCom(entries), ...sobrescritos });

test("validateResponse should accept the minimal valid response and return it unchanged", () => {
  const valida = resposta();
  assert.deepEqual(validateResponse(valida), { ok: true, response: valida });
});

test("validateResponse should accept one finding per axis and one suggestion", () => {
  const valida = resposta({
    standards: [ACHADO_NORMA],
    spec: [ACHADO_SPEC],
    suggestions: [{ text: "Ajuste o log" }],
  });
  assert.deepEqual(validateResponse(valida), { ok: true, response: valida });
});

for (const campo of CAMPOS_DO_TOPO) {
  test(`validateResponse should report $.${campo} when ${campo} is missing`, () => {
    assert.deepEqual(validateResponse(semCampo(MINIMA, campo)), { ok: false, field: `$.${campo}` });
  });
}

test("validateResponse should report $.extra when the top level has an extra field", () => {
  assert.deepEqual(validateResponse(resposta({ extra: 1 })), { ok: false, field: "$.extra" });
});

test("validateResponse should report the extra field inside a standards finding", () => {
  assert.deepEqual(validateResponse(resposta({ standards: [{ ...ACHADO_NORMA, extra: "x" }] })), {
    ok: false,
    field: "$.standards[0].extra",
  });
});

test("validateResponse should report specAxis when the value is outside the enum", () => {
  assert.deepEqual(validateResponse(resposta({ specAxis: "maybe" })), { ok: false, field: "$.specAxis" });
});

test("validateResponse should report the line when it is zero", () => {
  assert.deepEqual(validateResponse(resposta({ standards: [{ ...ACHADO_NORMA, line: 0 }] })), {
    ok: false,
    field: "$.standards[0].line",
  });
});

test("validateResponse should report the line when it is not an integer", () => {
  assert.deepEqual(validateResponse(resposta({ standards: [{ ...ACHADO_NORMA, line: 1.5 }] })), {
    ok: false,
    field: "$.standards[0].line",
  });
});

test("validateResponse should report the line when it is a string", () => {
  assert.deepEqual(validateResponse(resposta({ standards: [{ ...ACHADO_NORMA, line: "1" }] })), {
    ok: false,
    field: "$.standards[0].line",
  });
});

test("validateResponse should report the file when it is an absolute path", () => {
  assert.deepEqual(validateResponse(resposta({ standards: [{ ...ACHADO_NORMA, file: "/etc/passwd" }] })), {
    ok: false,
    field: "$.standards[0].file",
  });
});

test("validateResponse should report the spec file when it climbs out with ..", () => {
  assert.deepEqual(validateResponse(resposta({ spec: [{ ...ACHADO_SPEC, file: "../x.js" }] })), {
    ok: false,
    field: "$.spec[0].file",
  });
});

test("validateResponse should report the file when it is a Windows drive path", () => {
  assert.deepEqual(validateResponse(resposta({ standards: [{ ...ACHADO_NORMA, file: "C:\\x.js" }] })), {
    ok: false,
    field: "$.standards[0].file",
  });
});

test("validateResponse should report $ when the response is an array", () => {
  assert.deepEqual(validateResponse([]), { ok: false, field: "$" });
});

test("validateResponse should report $ when the response is a string", () => {
  assert.deepEqual(validateResponse("texto"), { ok: false, field: "$" });
});

test("validateResponse should report the suggestion text when a suggestion has no text", () => {
  assert.deepEqual(validateResponse(resposta({ suggestions: [{}] })), {
    ok: false,
    field: "$.suggestions[0].text",
  });
});

test("checkCitations should demote a standards finding with reason no-guide when there is no guide", () => {
  assert.deepEqual(revisar({ standards: [ACHADO_NORMA] }, { present: false }), {
    specAxis: "reviewed",
    findings: { standards: [], spec: [] },
    suggestions: [{ text: "src/a.js:3 Log de token", demotedFrom: "standards", reason: "no-guide", rule: "SEC-4", quote: "Nunca logar segredos em texto puro." }],
  });
});

test("checkCitations should demote with rule-not-in-guide when the rule ID is absent from the guide", () => {
  assert.deepEqual(revisar({ standards: [{ ...ACHADO_NORMA, rule: "SEC-9" }] }).suggestions, [
    { text: "src/a.js:3 Log de token", demotedFrom: "standards", reason: "rule-not-in-guide", rule: "SEC-9", quote: ACHADO_NORMA.quote },
  ]);
});

test("checkCitations should demote with quote-not-in-guide when the rule exists but the quote does not", () => {
  assert.deepEqual(revisar({ standards: [{ ...ACHADO_NORMA, quote: "Texto inventado." }] }).suggestions, [
    { text: "src/a.js:3 Log de token", demotedFrom: "standards", reason: "quote-not-in-guide", rule: "SEC-4", quote: "Texto inventado." },
  ]);
});

test("checkCitations should keep a standards finding whose quote matches after whitespace normalization", () => {
  const resultado = revisar({
    standards: [{ ...ACHADO_NORMA, quote: "Nunca   logar segredos\n em texto puro." }],
  });
  assert.deepEqual(resultado.findings.standards, [
    { id: "R2-S1", ...ACHADO_NORMA, quote: "Nunca   logar segredos\n em texto puro." },
  ]);
});

test("checkCitations should demote with quote-not-in-guide when the quote is only whitespace", () => {
  assert.deepEqual(revisar({ standards: [{ ...ACHADO_NORMA, quote: "   " }] }).suggestions, [
    { text: "src/a.js:3 Log de token", demotedFrom: "standards", reason: "quote-not-in-guide", rule: "SEC-4", quote: "   " },
  ]);
});

test("checkCitations should number two valid standards findings S1 and S2 in order", () => {
  const resultado = revisar({ standards: [ACHADO_NORMA, { ...ACHADO_NORMA, file: "src/c.js", line: 9 }] });
  assert.deepEqual(resultado.findings.standards.map(({ id }) => id), ["R2-S1", "R2-S2"]);
});

test("checkCitations should demote with source-not-allowed when the spec source is outside the allowed list", () => {
  assert.deepEqual(revisar({ spec: [{ ...ACHADO_SPEC, source: "specs/y/02-spec.md" }] }).suggestions, [
    { text: "src/b.js:4 Falta validação", demotedFrom: "spec", reason: "source-not-allowed", source: "specs/y/02-spec.md", quote: ACHADO_SPEC.quote },
  ]);
});

test("checkCitations should demote with quote-not-in-source when the allowed source lacks the quote", () => {
  assert.deepEqual(revisar({ spec: [{ ...ACHADO_SPEC, quote: "Texto que não existe." }] }).suggestions, [
    { text: "src/b.js:4 Falta validação", demotedFrom: "spec", reason: "quote-not-in-source", source: ACHADO_SPEC.source, quote: "Texto que não existe." },
  ]);
});

test("checkCitations should keep a valid spec finding with id R2-P1", () => {
  const resultado = revisar({ spec: [ACHADO_SPEC] });
  assert.deepEqual(resultado.findings.spec.map(({ id }) => id), ["R2-P1"]);
});

test("checkCitations should number two valid spec findings P1 and P2 in order", () => {
  const resultado = revisar({ spec: [ACHADO_SPEC, { ...ACHADO_SPEC, quote: "Fim." }] });
  assert.deepEqual(resultado.findings.spec.map(({ id }) => id), ["R2-P1", "R2-P2"]);
});

test("checkCitations should list original suggestions first, keeping only their text, before demoted ones", () => {
  assert.deepEqual(revisar({ suggestions: [{ text: "Ajuste o log", extra: "x" }], standards: [ACHADO_NORMA] }, { present: false }).suggestions, [
    { text: "Ajuste o log" },
    { text: "src/a.js:3 Log de token", demotedFrom: "standards", reason: "no-guide", rule: "SEC-4", quote: "Nunca logar segredos em texto puro." },
  ]);
});

test("checkCitations should pass the specAxis through unchanged", () => {
  assert.equal(revisar({ specAxis: "abstained" }).specAxis, "abstained");
});

const PARAMETROS_DO_PROMPT = {
  slug: SLUG,
  base: "release/mgr-evolution",
  files: ["src/a.js", "src/b.js"],
  specSources: ["specs/x/02-spec.md", "specs/x/03-spec.md"],
  language: "pt-BR",
};

test("buildPrompt should name the slug and the diff range against the base", () => {
  const prompt = buildPrompt(PARAMETROS_DO_PROMPT);
  assert.ok(prompt.includes(SLUG));
  assert.ok(prompt.includes("git diff release/mgr-evolution...HEAD"));
});

test("buildPrompt should list each changed file on its own line", () => {
  const linhas = buildPrompt(PARAMETROS_DO_PROMPT).split("\n");
  assert.ok(linhas.includes("src/a.js"));
  assert.ok(linhas.includes("src/b.js"));
});

test("buildPrompt should point to the rules guide and the output language", () => {
  const prompt = buildPrompt(PARAMETROS_DO_PROMPT);
  assert.ok(prompt.includes("docs/sdd/09-review-rules.md"));
  assert.ok(prompt.includes("Output language: pt-BR"));
});

test("buildPrompt should list the spec paths and require verbatim quotes when there are spec sources", () => {
  const prompt = buildPrompt(PARAMETROS_DO_PROMPT);
  assert.ok(prompt.includes("specs/x/02-spec.md, specs/x/03-spec.md"));
  assert.ok(prompt.includes("Every spec finding MUST"));
});

test("buildPrompt should abstain on the spec axis and omit the verbatim requirement when there are no spec sources", () => {
  const prompt = buildPrompt({ ...PARAMETROS_DO_PROMPT, specSources: [] });
  assert.ok(prompt.includes('set specAxis to "abstained"'));
  assert.ok(!prompt.includes("Every spec finding MUST"));
});

test("reviewedPaths should drop the specs directory and the files inside it", () => {
  assert.deepEqual(reviewedPaths(["specs/x/03-spec.md", "specs", "src/a.js"]), ["src/a.js"]);
});

test("reviewedPaths should keep paths that only start with specs, deduplicate and sort", () => {
  assert.deepEqual(reviewedPaths(["src/a.js", "specsfoo.js", "src/a.js"]), ["specsfoo.js", "src/a.js"]);
});

test("fileHashes should hash the content of present files with sha256", () => {
  assert.deepEqual(fileHashes([{ path: "src/a.js", state: "present", content: Buffer.from("abc") }]), [
    { path: "src/a.js", state: "present", sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" },
  ]);
});

test("fileHashes should keep only path and state for deleted files", () => {
  assert.deepEqual(fileHashes([{ path: "src/gone.js", state: "deleted", content: Buffer.from("x") }]), [
    { path: "src/gone.js", state: "deleted" },
  ]);
});

test("staleFiles should return an empty list when the files are unchanged", () => {
  const revisados = [{ path: "src/a.js", state: "present", sha256: HASH }];
  assert.deepEqual(staleFiles(revisados, [{ path: "src/a.js", state: "present", sha256: HASH }]), []);
});

test("staleFiles should return the path when its hash changed", () => {
  const revisados = [{ path: "src/a.js", state: "present", sha256: HASH }];
  assert.deepEqual(staleFiles(revisados, [{ path: "src/a.js", state: "present", sha256: OUTRO_HASH }]), ["src/a.js"]);
});

test("staleFiles should return the path when a present file became deleted", () => {
  const revisados = [{ path: "src/a.js", state: "present", sha256: HASH }];
  assert.deepEqual(staleFiles(revisados, [{ path: "src/a.js", state: "deleted" }]), ["src/a.js"]);
});

test("staleFiles should return the path when a deleted file reappeared as present", () => {
  const revisados = [{ path: "src/a.js", state: "deleted" }];
  assert.deepEqual(staleFiles(revisados, [{ path: "src/a.js", state: "present", sha256: HASH }]), ["src/a.js"]);
});

test("staleFiles should return the path when it is missing from the current list", () => {
  const revisados = [{ path: "src/a.js", state: "present", sha256: HASH }];
  assert.deepEqual(staleFiles(revisados, []), ["src/a.js"]);
});

test("parseProof should return absent when the proof text is undefined", () => {
  assert.deepEqual(parseProof(undefined, SLUG), { state: "absent" });
});

test("parseProof should report detail json when the text is not JSON", () => {
  assert.deepEqual(parseProof("não é json", SLUG), { state: "invalid", detail: "json" });
});

test("parseProof should report detail json when the JSON is an array", () => {
  assert.deepEqual(parseProof("[]", SLUG), { state: "invalid", detail: "json" });
});

test("parseProof should report detail schemaVersion when the version is not 1", () => {
  assert.deepEqual(parseProof(textoDaProva([], { schemaVersion: 2 }), SLUG), { state: "invalid", detail: "schemaVersion" });
});

test("parseProof should report detail slug when the slug differs", () => {
  assert.deepEqual(parseProof(textoDaProva([], { slug: "outro" }), SLUG), { state: "invalid", detail: "slug" });
});

test("parseProof should report detail entries when entries is not an array", () => {
  assert.deepEqual(parseProof(textoDaProva({}), SLUG), { state: "invalid", detail: "entries" });
});

test("parseProof should report entries[0].kind when the entry kind is unknown", () => {
  assert.deepEqual(parseProof(textoDaProva([{ kind: "x" }]), SLUG), { state: "invalid", detail: "entries[0].kind" });
});

test("parseProof should accept a valid failure entry", () => {
  assert.deepEqual(parseProof(textoDaProva([FALHA]), SLUG), { state: "valid", proof: provaCom([FALHA]) });
});

test("parseProof should accept a complete valid review entry", () => {
  assert.deepEqual(parseProof(textoDaProva([REVISAO]), SLUG), { state: "valid", proof: provaCom([REVISAO]) });
});

test("parseProof should report entries[0].session when a review has no session", () => {
  assert.deepEqual(parseProof(textoDaProva([semCampo(REVISAO, "session")]), SLUG), {
    state: "invalid",
    detail: "entries[0].session",
  });
});

test("parseProof should report entries[0].files when a review has an empty files list", () => {
  assert.deepEqual(parseProof(textoDaProva([{ ...REVISAO, files: [] }]), SLUG), {
    state: "invalid",
    detail: "entries[0].files",
  });
});

test("parseProof should report entries[0].files when a file has a malformed sha256", () => {
  const arquivo = { path: "src/a.js", state: "present", sha256: "zzz" };
  assert.deepEqual(parseProof(textoDaProva([{ ...REVISAO, files: [arquivo] }]), SLUG), {
    state: "invalid",
    detail: "entries[0].files",
  });
});

test("parseProof should report entries[0].files when a file path climbs out with ..", () => {
  const arquivo = { path: "../a", state: "deleted" };
  assert.deepEqual(parseProof(textoDaProva([{ ...REVISAO, files: [arquivo] }]), SLUG), {
    state: "invalid",
    detail: "entries[0].files",
  });
});

test("parseProof should accept a valid waiver entry", () => {
  assert.deepEqual(parseProof(textoDaProva([DISPENSA]), SLUG), { state: "valid", proof: provaCom([DISPENSA]) });
});

test("parseProof should report entries[0].reason when a waiver has no reason", () => {
  assert.deepEqual(parseProof(textoDaProva([semCampo(DISPENSA, "reason")]), SLUG), {
    state: "invalid",
    detail: "entries[0].reason",
  });
});

test("parseProof should report entries[0].round when the round is zero", () => {
  assert.deepEqual(parseProof(textoDaProva([{ ...REVISAO, round: 0 }]), SLUG), {
    state: "invalid",
    detail: "entries[0].round",
  });
});

test("nextRound should return 1 when there is no proof", () => {
  assert.equal(nextRound({ state: "absent" }), 1);
});

test("nextRound should return the count of review entries plus one", () => {
  assert.equal(nextRound({ state: "valid", proof: provaCom([FALHA, REVISAO, REVISAO]) }), 3);
});

test("appendEntry should create a proof with the entry when there is no previous proof", () => {
  assert.deepEqual(appendEntry({ state: "absent" }, SLUG, FALHA), provaCom([FALHA]));
});

test("appendEntry should keep the previous entries in order and add the new one last", () => {
  assert.deepEqual(appendEntry({ state: "valid", proof: provaCom([FALHA]) }, SLUG, REVISAO), provaCom([FALHA, REVISAO]));
});

test("lastDecisive should return found false when there are only failures", () => {
  assert.deepEqual(lastDecisive(provaCom([FALHA, FALHA])), { found: false });
});

test("lastDecisive should return the review when a failure comes after it", () => {
  assert.deepEqual(lastDecisive(provaCom([REVISAO, FALHA])), { found: true, entry: REVISAO });
});

test("lastDecisive should return the waiver when a failure comes after the review and the waiver", () => {
  assert.deepEqual(lastDecisive(provaCom([REVISAO, DISPENSA, FALHA])), { found: true, entry: DISPENSA });
});

test("REVIEWER_FAILURES should list exactly the five reviewer failure codes and no precondition code", () => {
  assert.deepEqual([...REVIEWER_FAILURES].sort(), [
    "not-installed",
    "not-logged-in",
    "response-invalid",
    "reviewer-failed",
    "session-missing",
  ]);
});

test("validateResponse should report a text field that holds a number", () => {
  assert.deepEqual(validateResponse(resposta({ specAxis: 1 })), { ok: false, field: "$.specAxis" });
});

test("validateResponse should report a list field that holds an object", () => {
  assert.deepEqual(validateResponse(resposta({ standards: {} })), { ok: false, field: "$.standards" });
});

test("parseProof should accept a review whose files include a deleted file", () => {
  const revisao = { ...REVISAO, files: [{ path: "src/velho.js", state: "deleted" }] };
  assert.equal(parseProof(textoDaProva([revisao]), SLUG).state, "valid");
});

test("parseProof should report entries[0].reviewer when a failure has no reviewer", () => {
  assert.deepEqual(parseProof(textoDaProva([semCampo(FALHA, "reviewer")]), SLUG), { state: "invalid", detail: "entries[0].reviewer" });
});

test("parseProof should report entries[0].findings when a review has findings that are not an object", () => {
  assert.deepEqual(parseProof(textoDaProva([{ ...REVISAO, findings: [] }]), SLUG), { state: "invalid", detail: "entries[0].findings" });
});

for (const moldura of ["(SEC-4)", "`SEC-4`", " SEC-4 "]) {
  test(`checkCitations should accept the rule ID written as ${JSON.stringify(moldura)} and record it bare`, () => {
    const resultado = revisar({ standards: [{ ...ACHADO_NORMA, rule: moldura }] });
    assert.deepEqual(resultado.findings.standards.map(({ id, rule }) => [id, rule]), [["R2-S1", "SEC-4"]]);
    assert.deepEqual(resultado.suggestions, []);
  });
}

for (const [campo, valor, detalhe] of [
  ["specAxis", "talvez", "specAxis"],
  ["findings", { standards: {}, spec: [] }, "findings.standards"],
  ["findings", { standards: [], spec: [{ id: "R1-P1" }] }, "findings.spec[0]"],
  ["suggestions", [{ text: 1 }], "suggestions"],
  ["suggestions", [{ text: "s", extra: "x" }], "suggestions"],
  ["model", "", "model"],
  ["effort", 3, "effort"],
]) {
  test(`parseProof should report entries[0].${detalhe} when a review has an invalid ${campo}`, () => {
    assert.deepEqual(parseProof(textoDaProva([{ ...REVISAO, [campo]: valor }]), SLUG), { state: "invalid", detail: `entries[0].${detalhe}` });
  });
}

test("parseProof should report entries[0].at when a failure has no time", () => {
  assert.deepEqual(parseProof(textoDaProva([semCampo(FALHA, "at")]), SLUG), { state: "invalid", detail: "entries[0].at" });
});
