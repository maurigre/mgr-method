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

export const SDD_FILES = Object.freeze([
  Object.freeze({ role: "overview", file: "00-overview.md" }),
  Object.freeze({ role: "stack", file: "01-stack.md" }),
  Object.freeze({ role: "architecture", file: "02-architecture.md" }),
  Object.freeze({ role: "contracts", file: "03-contracts.md" }),
  Object.freeze({ role: "domain", file: "04-domain.md" }),
  Object.freeze({ role: "data", file: "05-data.md" }),
  Object.freeze({ role: "quality", file: "06-quality.md" }),
  Object.freeze({ role: "operations", file: "07-operations.md" }),
  Object.freeze({ role: "glossary", file: "08-glossary.md" }),
  Object.freeze({ role: "review-rules", file: "09-review-rules.md" }),
  Object.freeze({ role: "constitution", file: "CONSTITUTION.md" }),
  Object.freeze({ role: "self-assessment", file: "_self-assessment.md" }),
]);

// Nomes fixos das regras derivadas para o Cursor (RN-15): um arquivo por tópico.
export const CURSOR_RULES = Object.freeze(["architecture.mdc", "domain.mdc", "contracts.mdc", "conventions.mdc"]);

export const ROLE_STEMS = Object.freeze({
  overview: Object.freeze(["overview"]),
  stack: Object.freeze(["stack"]),
  architecture: Object.freeze(["architecture"]),
  contracts: Object.freeze(["contract", "contrato"]),
  domain: Object.freeze(["domain", "dominio"]),
  data: Object.freeze(["data", "persistence"]),
  quality: Object.freeze(["quality"]),
  operations: Object.freeze(["operations"]),
  glossary: Object.freeze(["glossary"]),
  "review-rules": Object.freeze(["review-rules"]),
  constitution: Object.freeze([]),
  "self-assessment": Object.freeze([]),
});

const NOMES_CANONICOS = new Set(SDD_FILES.map(({ file }) => file));

const casaRadical = (nome, radicais) => radicais.some((radical) => nome.toLowerCase().includes(radical));

const resolverPapel = (dir, candidatos) => {
  if (candidatos.length === 0) return { status: "absent", path: null, candidates: [] };
  if (candidatos.length > 1) return { status: "ambiguous", path: null, candidates: candidatos };
  return { status: "legacy", path: path.join(dir, candidatos[0]), candidates: candidatos };
};

// `docs/sdd` que existe como arquivo comum não tem o que listar. Só o ENOTDIR é absorvido; qualquer
// outro erro de leitura sobe.
const listarSeDiretorio = (dir, listMd) => {
  try {
    return listMd(dir);
  } catch (erro) {
    if (erro.code === "ENOTDIR") return [];
    throw erro;
  }
};

export function describeSdd(root, { exists = existsSync, listMd = listarMarkdown } = {}) {
  const dir = path.resolve(root, "docs", "sdd");
  const naoCanonicos = (exists(dir) ? listarSeDiretorio(dir, listMd) : [])
    .filter((nome) => !NOMES_CANONICOS.has(nome) && !nome.startsWith("_"))
    .sort();
  const roles = {};
  const missing = [];

  for (const { role, file } of SDD_FILES) {
    const caminho = path.join(dir, file);
    if (exists(caminho)) {
      roles[role] = { status: "canonical", path: caminho, candidates: [] };
      continue;
    }
    missing.push(file);
    const candidatos = naoCanonicos.filter((nome) => casaRadical(nome, ROLE_STEMS[role]));
    roles[role] = resolverPapel(dir, candidatos);
  }

  const outOfList = naoCanonicos;
  return { roles, missing, outOfList };
}

// Os avisos da checagem nascem aqui, e não na borda (INV-5). O `09-review-rules.md` ausente já tem o
// aviso próprio, `no-review-rules`, e não se repete como `missing-canonical`. Com a checagem em
// falha, só o `out-of-list` continua: é ele que mostra à spec-init, numa re-execução sem
// constituição, o arquivo antigo que nenhum radical reconhece.
export function inspectSdd(root, deps = {}) {
  const checagem = checkSdd(root, deps);
  const { roles, missing, outOfList } = describeSdd(root, deps);
  const foraDaLista = outOfList.map((file) => ({ code: "out-of-list", file }));
  const warnings = checagem.ok
    ? [
      ...checagem.warnings.map((code) => ({ code })),
      ...missing.filter((file) => file !== "09-review-rules.md").map((file) => ({ code: "missing-canonical", file })),
      ...foraDaLista,
    ]
    : foraDaLista;
  return { ok: checagem.ok, reason: checagem.reason, dir: checagem.dir, roles, warnings };
}
