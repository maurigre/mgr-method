import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import * as catalog from "../core/catalog.js";
import { RUNTIME_DIR_NAME } from "../core/bundle.js";
import { MANIFEST_NAME } from "../install/manifest.js";

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

// O guia não fica para trás da fonte (DT-26). As famílias universais e o arquivo de onde vêm; os
// perfis de linguagem ficam fora, porque cada projeto registra só o seu. A comparação é por ID: o guia
// é traduzido e adaptado, e o texto nunca bate.
//
// Confiança nos dados do manifesto (SEC-2, achado R4-2): `architecture` é um NOME e só vira caminho
// depois de casar com a lista do catálogo, que dá o nome da pasta; `skillsDirs` é um LOCAL que o
// próprio install gravou, legitimamente absoluto no escopo global e com `--skills-dir`, e é usado
// como o install o usa (`path.resolve`).
const FONTES_DO_GUIA = Object.freeze([
  Object.freeze({ arquivo: () => catalog.QUALITY_INSTALLED, familias: ["QUAL", "SEC", "PERF"], secao: /^## Universal rules/m }),
  Object.freeze({ arquivo: () => catalog.ARCH_INSTALLED, familias: ["DES", "NAM", "PAT", "MNT", "TST", "LOG", "DOC", "MUT"] }),
  Object.freeze({ arquivo: (pastaDaArquitetura) => [pastaDaArquitetura, "SKILL.md"], familias: ["INV"] }),
]);
const ORDEM_DAS_FAMILIAS = FONTES_DO_GUIA.flatMap(({ familias }) => familias);
const PADRAO_DE_ID = new RegExp(`\\b(${ORDEM_DAS_FAMILIAS.join("|")})-(\\d+)\\b`, "g");
const MANIFESTO = path.posix.join(RUNTIME_DIR_NAME, MANIFEST_NAME);
const GUIA = SDD_FILES.find(({ role }) => role === "review-rules").file;

const idsDe = (texto, familias) => new Set(
  [...texto.matchAll(PADRAO_DE_ID)].map(([id]) => id).filter((id) => familias.includes(id.split("-")[0])),
);

// Só a seção pedida: da linha do título até o próximo título de mesmo nível; sem o título, nada.
const secaoDe = (texto, titulo) => {
  const inicio = texto.search(titulo);
  if (inicio < 0) return { encontrada: false };
  const resto = texto.slice(inicio + 1);
  const fim = resto.search(/^## /m);
  return { encontrada: true, texto: fim < 0 ? texto.slice(inicio) : texto.slice(inicio, inicio + 1 + fim) };
};

const posicaoDoId = (id) => {
  const [familia, numero] = id.split("-");
  return { familia: ORDEM_DAS_FAMILIAS.indexOf(familia), numero: Number(numero) };
};
const porFamiliaENumero = (primeiro, segundo) => {
  const daEsquerda = posicaoDoId(primeiro);
  const daDireita = posicaoDoId(segundo);
  return daEsquerda.familia - daDireita.familia || daEsquerda.numero - daDireita.numero;
};

// Leitura que não derruba o comando (DT-26 itens 3 e 4): permissão negada ou diretório no lugar do
// arquivo viram `lida: false`, e o chamador devolve o aviso de fonte indisponível.
const lerTexto = (arquivo, readFile) => {
  try {
    return { lida: true, texto: readFile(arquivo) };
  } catch {
    return { lida: false };
  }
};

const lerManifesto = (arquivo, readFile) => {
  const leitura = lerTexto(arquivo, readFile);
  if (!leitura.lida) return { estado: "ilegivel" };
  try {
    const manifesto = JSON.parse(leitura.texto);
    const objeto = manifesto !== null && typeof manifesto === "object" && !Array.isArray(manifesto);
    return objeto ? { estado: "lido", manifesto } : { estado: "ilegivel" };
  } catch {
    return { estado: "ilegivel" };
  }
};

/**
 * Compara os IDs citáveis das fontes instaladas com os do guia (DT-26).
 *
 * `not-applicable`: sem instalação, ou sem guia (que já tem o aviso `no-review-rules`).
 * `unavailable`: há instalação, mas o manifesto, uma fonte ou o guia não pôde ser usado; `file` diz qual e, quando o
 * problema é um campo do manifesto, `field` diz qual (L2.6).
 * `checked`: `missing` traz os IDs das fontes que o guia não contém, em ordem estável.
 */
function guideAgainstSource(root, { exists = existsSync, readFile = (arquivo) => readFileSync(arquivo, "utf8") } = {}) {
  const guia = path.join(root, "docs", "sdd", GUIA);
  const manifestoPath = path.join(root, MANIFESTO);
  if (!exists(manifestoPath) || !exists(guia)) return { status: "not-applicable" };
  const indisponivel = (file, field) => ({ status: "unavailable", file, ...(field ? { field } : {}) });
  const leitura = lerManifesto(manifestoPath, readFile);
  if (leitura.estado !== "lido") return indisponivel(MANIFESTO);
  const { architecture, skillsDirs } = leitura.manifesto;
  if (typeof architecture !== "string" || !Object.hasOwn(catalog.ARCHITECTURES, architecture)) {
    return indisponivel(MANIFESTO, "architecture");
  }
  const pastaDaArquitetura = catalog.ARCHITECTURES[architecture];
  const dirs = Array.isArray(skillsDirs) ? skillsDirs.filter((dir) => typeof dir === "string") : [];
  const comFontes = dirs.map((dir) => path.resolve(root, dir)).filter((dir) => exists(path.join(dir, catalog.SHARED_DIR)));
  if (comFontes.length === 0) return indisponivel(MANIFESTO, "skillsDirs");
  const [base] = comFontes;

  const esperados = new Set();
  for (const fonte of FONTES_DO_GUIA) {
    const arquivo = path.join(base, ...fonte.arquivo(pastaDaArquitetura));
    const relativo = path.relative(root, arquivo);
    const fonteLida = exists(arquivo) ? lerTexto(arquivo, readFile) : { lida: false };
    if (!fonteLida.lida) return indisponivel(relativo);
    const secao = fonte.secao ? secaoDe(fonteLida.texto, fonte.secao) : { encontrada: true, texto: fonteLida.texto };
    if (!secao.encontrada) return indisponivel(relativo);
    for (const id of idsDe(secao.texto, fonte.familias)) esperados.add(id);
  }
  const guiaLido = lerTexto(guia, readFile);
  if (!guiaLido.lida) return indisponivel(path.relative(root, guia));
  const noGuia = idsDe(guiaLido.texto, ORDEM_DAS_FAMILIAS);
  return { status: "checked", missing: [...esperados].filter((id) => !noGuia.has(id)).sort(porFamiliaENumero) };
}

const avisoDoGuia = (resultado) => {
  if (resultado.status === "unavailable") {
    const { file, field } = resultado;
    return [{ code: "guide-source-unavailable", file, ...(field ? { field } : {}) }];
  }
  if (resultado.status === "checked" && resultado.missing.length) {
    return [{ code: "guide-behind-source", file: GUIA, missing: resultado.missing }];
  }
  return [];
};

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
      ...avisoDoGuia(guideAgainstSource(root, deps)),
    ]
    : foraDaLista;
  return { ok: checagem.ok, reason: checagem.reason, dir: checagem.dir, roles, warnings };
}
