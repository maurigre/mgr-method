#!/usr/bin/env node
// Verificador da fonte única de leis de execução e das fontes de regras arquiteturais
// (features mgr-hardening-core task P1.5 + corte-regra-obrigatoria task P1.2).
// Ferramenta de desenvolvimento do repo — fora do tarball npm, como o check-translation.mjs.
//
// Uso:
//   node scripts/check-laws.mjs [--laws <arquivo>] [--charter <arquivo>] [--skills <dir>]
//     [--installed <dir>] [--arch-rules <arquivo>] [--quality-rules <arquivo>]
//   node scripts/check-laws.mjs --self-test
//
// Verifica o que é MECÂNICO, e só isso:
//   LAW-1  ID de lei duplicado
//   LAW-2  papel fora da matriz declarada
//   LAW-3  skill do CORE sem a linha-ponteiro {{MGR_LAWS}}
//   LAW-4  lei órfã: papel que não mapeia para nenhuma skill do CORE
//   LAW-5  QUALQUER token {{MGR_*}} sobrando numa arvore instalada, em qualquer .md
//          -> a versao anterior so olhava <skill>/SKILL.md, e nada sob `_shared/` era conferido
//   LAW-6  a escada da L0.1 fora de forma, ou a afirmacao falsa de fidelidade ao ADR-0007 de volta
//          -> compara FORMA (aridade, ordem, caminhos do nivel 2, par datado), nunca texto x texto
//   CHT-1  ID de primícia duplicado na carta
//   CHT-2  primícia sem uma das três partes obrigatórias
//   CHT-3  cabeçalho `###` na carta fora do formato `CP-<n>`
//   CHT-4  a L0.1 sem o ponteiro {{MGR_CHARTER}}
//   RUL-1  conjunto ORDENADO de cabeçalhos ## de uma fonte não é o declarado
//   RUL-2  cabeçalho de forca reprove perdeu "they reprove" OU de no-reprove perdeu "do not reprove"
//   RUL-3  item numerado sob seção que reprova SEM (PREFIX-n) OU sob no-reprove COM
//   RUL-4  censo divergiu: prefixo desconhecido, contagem diferente, lacuna, ID duplicado, extração vazia
//   RUL-5  instrução de montagem arch-* nomeia a seção de autoria "Rule force"
//
// Por que o CHT-3 existe, e foi medido antes de escrito: `parseLaws` pula em SILÊNCIO todo
// cabeçalho que não comece com `### L`. Um erro de digitação no cabeçalho de uma primícia a faria
// desaparecer sem uma palavra, e carta que perde primícia calada é pior que carta nenhuma.
//
// O que ele NÃO verifica, de propósito: se a lei "diz a mesma coisa" que a skill dizia. Isso é
// julgamento, não parsing, e cabe ao inventário de não-regressão. Um verificador que prometesse
// isso daria falsa segurança — o que a L1.9 proíbe. Também não decide se a evidência de uma
// cláusula está dentro do artefato — esse é o resíduo, fica no texto. O parser é de prefixo de
// linha: um ## dentro de bloco cercado seria lido como cabeçalho, mas nenhuma fonte o tem hoje
// (limitação herdada e declarada).
//
// Nota de desenho, paga com sangue na task P0.4: a análise é ESTRUTURAL (regex sobre o cabeçalho
// da lei), nunca busca de substring em prosa. Uma busca por substring produziu falso positivo
// naquela task — acusou perda de uma invariante que estava íntegra, só porque a string de busca
// omitia dois asteriscos. Verificador que dá falso positivo é tão perigoso quanto o que dá falso
// negativo: os dois ensinam a ignorá-lo.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const LAWS_TOKEN = "{{MGR_LAWS}}";
export const ROLES = ["All", "Planner", "Executor", "Verifier", "Diagnostician"];

// Skills do CORE e o papel de cada uma. Espelha a matriz de shared/laws/execution-laws.md.
export const CORE_ROLES = {
  "spec-init": "Planner",
  "spec-create": "Planner",
  "spec-execute": "Executor",
  "adr-create": "Planner",
  "code-analyzer": "Verifier",
  "diagnosing-bugs": "Diagnostician",
};

const LAW_HEADER = /^### (L\d+\.\d+) — (.+?) +`\[([A-Za-z, ]+)\]`$/;

// Parsing puro, sem IO — o padrão de checkSkill em src/validator.js.
export function parseLaws(text) {
  const laws = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.startsWith("### L")) continue;
    const match = line.match(LAW_HEADER);
    if (!match) {
      laws.push({ id: null, line: index + 1, raw: line, roles: [] });
      continue;
    }
    const [, id, title, roles] = match;
    laws.push({ id, title, line: index + 1, roles: roles.split(",").map((role) => role.trim()) });
  }
  return laws;
}

// Regras puras: recebem o que já foi lido, devolvem problemas. Sem IO, sem process.exit.
export function checkLaws(laws, pointers) {
  const problems = [];

  for (const law of laws) {
    if (!law.id) {
      problems.push(`LAW-2 line ${law.line}: law header does not declare a role — ${law.raw}`);
      continue;
    }
    for (const role of law.roles) {
      if (!ROLES.includes(role)) {
        problems.push(`LAW-2 ${law.id}: unknown role "${role}" (expected ${ROLES.join(" | ")})`);
      }
    }
  }

  const seen = new Map();
  for (const law of laws.filter((candidate) => candidate.id)) {
    if (seen.has(law.id)) {
      problems.push(`LAW-1 ${law.id}: duplicate id (also at line ${seen.get(law.id)})`);
    } else {
      seen.set(law.id, law.line);
    }
  }

  for (const [skill, expected] of Object.entries(CORE_ROLES)) {
    const pointer = pointers[skill];
    if (pointer === undefined) continue;
    if (!pointer.hasPointer) {
      problems.push(`LAW-3 ${skill}: CORE skill without the ${LAWS_TOKEN} pointer line`);
    }
    if (pointer.hasPointer && !pointer.declaresRole) {
      problems.push(`LAW-3 ${skill}: pointer present but the skill does not name its role (${expected})`);
    }
  }

  // Uma lei é órfã quando nenhum papel dela corresponde a uma skill do CORE instalada.
  const activeRoles = new Set(["All", ...Object.values(CORE_ROLES)]);
  for (const law of laws.filter((candidate) => candidate.id && candidate.roles.length)) {
    if (!law.roles.some((role) => activeRoles.has(role))) {
      problems.push(`LAW-4 ${law.id}: orphan law — no CORE skill carries any of [${law.roles.join(", ")}]`);
    }
  }

  return problems;
}

// CHT-4 (segunda metade): numa árvore INSTALADA o ponteiro da carta tem de estar resolvido E o
// caminho apontado tem de existir. Isto é o que o `guarda.md` seção 5 especificou, e o que faz a
// mitigação do ADR-0022 ser verdadeira: sem isto, o ponteiro pode apontar para o vazio.
// Desde 2026-09-24 o `mgr doctor` alcança `_shared/` — token não resolvido e fonte ausente são
// achados dele. O que continua SÓ aqui é a parte SEMÂNTICA: se o ponteiro nomeia um caminho que
// existe mas é o errado, o `doctor` não sabe; este guarda sabe. E este script não é distribuído.
export function checkCharterResolved(installedSkillsDir) {
  const problems = [];
  const leis = path.join(installedSkillsDir, ...LAWS_INSTALLED_SEGMENTS);
  if (!existsSync(leis)) return problems;
  const texto = readFileSync(leis, "utf8");
  if (texto.includes(CHARTER_TOKEN)) {
    problems.push(`CHT-4 ${leis}: ${CHARTER_TOKEN} left unresolved in the installed laws`);
    return problems;
  }
  const apontado = texto.match(/core principles are the charter at (\S+?),/)?.[1];
  if (!apontado) {
    problems.push(`CHT-4 ${leis}: the installed laws do not name the charter path`);
    return problems;
  }
  const repo = path.resolve(installedSkillsDir, "..", "..");
  if (!existsSync(path.resolve(repo, apontado))) {
    problems.push(`CHT-4 ${leis}: the charter pointer resolves to ${apontado}, which does not exist`);
  }
  return problems;
}

// Qualquer token do metodo, e nao so o das leis: o `{{MGR_CHARTER}}` mora DENTRO do arquivo de
// leis, e o `{{MGR_ARCH_RULES}}` e o `{{MGR_USER_LANGUAGE}}` moram nas skills. Um so padrao cobre
// os quatro e os que vierem.
const QUALQUER_TOKEN = /\{\{MGR_[A-Z_]+\}\}/;

// Todo arquivo de texto de uma arvore instalada, e nao so `SKILL.md`. A versao anterior olhava
// apenas `<skill>/SKILL.md`, entao NENHUM arquivo sob `_shared/` era conferido — foi o buraco que a
// emenda do ADR-0022 declarou, e que fazia o ponteiro da carta ficar sem guarda.
function arquivosDeTexto(dir, prefixo = "") {
  const arquivos = [];
  for (const entrada of readdirSync(path.join(dir, prefixo), { withFileTypes: true })) {
    const relativo = path.join(prefixo, entrada.name);
    if (entrada.isDirectory()) arquivos.push(...arquivosDeTexto(dir, relativo));
    else if (relativo.endsWith(".md")) arquivos.push(relativo);
  }
  return arquivos;
}

// LAW-5: nenhum token do metodo pode sobrar numa árvore INSTALADA (onde já deveria estar resolvido).
export function checkResolved(installedSkillsDir) {
  const problems = [];
  if (!existsSync(installedSkillsDir)) return problems;
  for (const relativo of arquivosDeTexto(installedSkillsDir)) {
    const encontrado = readFileSync(path.join(installedSkillsDir, relativo), "utf8").match(QUALQUER_TOKEN);
    if (encontrado) {
      problems.push(`LAW-5 ${relativo}: ${encontrado[0]} left unresolved in an installed tree`);
    }
  }
  return problems;
}

export const CHARTER_TOKEN = "{{MGR_CHARTER}}";
// This is a deliberate copy of what src/catalog.js declares as SHARED_DIR. It exists so that the
// verifier does not depend on the source it verifies; a divergence must turn red, never silent.
// A test locks both copies against divergence.
export const SHARED_TREE_NAME = "_shared";
const LAWS_INSTALLED_SEGMENTS = [SHARED_TREE_NAME, "laws", "execution-laws.md"];
const CHARTER_HEADER = /^### (CP-\d+) — (.+)$/;
const CHARTER_PARTS = ["**Statement.**", "**Case.**", "**Provenance.**"];

// Deliberate copy of section headers from shared rule sources. Divergence must turn red, never
// silent. RUL-1 compares section headers and ordering across these sources — the list below is
// measured and locked. Section titles must match exactly; force ("reprove", "no-reprove", or
// "none") is declared per architecture/design decision and appears in each section header.
// Why "none" exists and is not a breach: Rule force and authoring criterion (who writes the
// rule); Checklist addresses code generators and repeats existing IDs; Application (gates)
// describes gates which measure instead of judge. None of these three create citable norms, so
// RUL-2 and RUL-3 do not apply to them.
export const RULE_SOURCES = {
  "shared/arch/cross-cutting-rules.md": [
    { title: "## Rule force (authoring criterion — not assembled into the project guide)", force: "none" },
    { title: "## Mandatory rules (they reprove in review)", force: "reprove" },
    { title: "## Good Practices (they do not reprove — opt-in, adopted per project)", force: "no-reprove" },
    { title: "## Cross-cutting anti-patterns (they reprove)", force: "reprove" },
    { title: "## Checklist (AI guard-rails — check before and after generating/changing code)", force: "none" },
  ],
  "shared/quality/quality-rules.md": [
    { title: "## Universal rules (language-agnostic) — they reprove", force: "reprove" },
    { title: "## Language profile (record only the project's one) — they reprove", force: "reprove" },
    { title: "## Application (gates)", force: "none" },
  ],
};

// Deliberate copy of rule ID baseline from six sources measured on 2026-09-30. Divergence must
// turn red, never silent. RUL-4 measures the census: prefixes must match, counts must match,
// prefixes must be contiguous (1..n), IDs must not duplicate, and extraction must not be empty.
// The guide (docs/sdd/09-review-rules.md) is not included — it is a project artifact, gitignored,
// and has known divergence against the source (QUAL 6 vs 7, TS 10 vs 9). Locking the number here
// would trap a known divergence. When a slice adds a rule family (SEC-*), it updates the baseline
// in the same diff — rule never enters nor exits silent (CP-2).
export const ID_BASELINE = {
  "shared/arch/cross-cutting-rules.md": { total: 75, prefixes: { DES: 10, NAM: 2, TST: 5, LOG: 4, DOC: 2, MUT: 3, JAVA: 8, GO: 9, PY: 9, NET: 8, TS: 9, GEN: 6 } },
  "shared/quality/quality-rules.md": { total: 19, prefixes: { QUAL: 7, JQ: 8, JS: 4 } },
  "skills/arch-clean/SKILL.md": { total: 8, prefixes: { INV: 8 } },
  "skills/arch-hexagonal/SKILL.md": { total: 7, prefixes: { INV: 7 } },
  "skills/arch-onion/SKILL.md": { total: 7, prefixes: { INV: 7 } },
  "skills/arch-layered/SKILL.md": { total: 6, prefixes: { INV: 6 } },
};

// Parsing puro, sem IO — o mesmo desenho do parseLaws ao lado.
export function parseCharter(text) {
  const principles = [];
  const linhas = text.split("\n");
  for (const [index, line] of linhas.entries()) {
    if (!line.startsWith("### ")) continue;
    const match = line.match(CHARTER_HEADER);
    if (!match) {
      principles.push({ id: null, line: index + 1, raw: line, body: "" });
      continue;
    }
    // Fecha em `### `, `## ` ou `---`: sem os dois últimos, o corpo da ÚLTIMA primícia absorvia a
    // prosa final do arquivo, e um `**Case.**` escrito ali passaria a satisfazer a CHT-2 por acaso.
    const fim = linhas.findIndex((l, i) => i > index && (l.startsWith("### ") || l.startsWith("## ") || l === "---"));
    principles.push({
      id: match[1],
      title: match[2],
      line: index + 1,
      body: linhas.slice(index + 1, fim === -1 ? linhas.length : fim).join("\n"),
    });
  }
  return principles;
}

// Regras puras da carta. Recebem o que já foi lido, devolvem problemas. Sem IO, sem process.exit.
export function checkCharter(principles, lawsText) {
  const problems = [];

  for (const principle of principles) {
    if (!principle.id) {
      problems.push(`CHT-3 line ${principle.line}: heading is not a principle — ${principle.raw}`);
      continue;
    }
    for (const part of CHARTER_PARTS) {
      if (!principle.body.includes(part)) {
        problems.push(`CHT-2 ${principle.id}: missing the ${part.replaceAll("*", "").replace(".", "")} part`);
      }
    }
  }

  const seen = new Map();
  for (const principle of principles.filter((candidate) => candidate.id)) {
    if (seen.has(principle.id)) {
      problems.push(`CHT-1 ${principle.id}: duplicate id (also at line ${seen.get(principle.id)})`);
    } else {
      seen.set(principle.id, principle.line);
    }
  }

  if (lawsText !== undefined && !lawsText.includes(CHARTER_TOKEN)) {
    problems.push(`CHT-4 L0.1: the laws source does not carry the ${CHARTER_TOKEN} pointer to the charter`);
  }

  return problems;
}

function readPointers(skillsDir) {
  const pointers = {};
  for (const skill of Object.keys(CORE_ROLES)) {
    const md = path.join(skillsDir, skill, "SKILL.md");
    if (!existsSync(md)) continue;
    const text = readFileSync(md, "utf8");
    pointers[skill] = {
      hasPointer: text.includes(LAWS_TOKEN),
      declaresRole: new RegExp(`role is \\*\\*${CORE_ROLES[skill]}\\*\\*`).test(text),
    };
  }
  return pointers;
}

// LAW-6: a escada da L0.1 e a hierarquia do ADR-0007 tem de continuar coincidindo na FORMA, e a
// afirmacao falsa nao pode voltar. Comparacao de TEXTO entre os dois documentos NAO existe aqui, de
// proposito: eles estao em idiomas diferentes e, depois da emenda de 2026-09-26, divergem
// legitimamente no nivel 2 — um comparador de igualdade reprovaria o estado correto. O ADR-0011 ja
// rejeitou esse comparador por escrito: "conferir que duas copias dizem a mesma coisa e julgamento,
// nao parsing, e o verificador daria falsa seguranca".
//
// Copia deliberada: os cinco rotulos abaixo espelham a escada da L0.1, como o SHARED_TREE_NAME
// espelha o SHARED_DIR. Divergencia tem de ficar VERMELHA, nunca silenciosa. O mapeamento para os
// quatro niveis do ADR-0007, que e pt-BR, foi feito UMA vez por humano e esta aqui como comentario —
// julgamento explicito, em vez de julgamento fingindo ser parsing:
//   principios do MGR core  -> MGR core principles
//   regras do projeto       -> project rules
//   convencoes do workspace -> workspace conventions
//   instrucoes da skill     -> skill instructions
const LADDER = [
  "MGR core principles",
  "project rules",
  "workspace conventions",
  "skill instructions",
  "runtime-injected content",
];
const NIVEL_2_CAMINHOS = ["`.mgr-core/`", "`docs/sdd/`"];
const FRASE_PROIBIDA = "unchanged and in the same order";
const DATA_DA_EMENDA = /the amendment of (\d{4}-\d{2}-\d{2}) to that ADR/;

// Resolve o ADR-0007 por prefixo. Zero resultados OU mais de um viram ACHADO, nunca passagem
// silenciosa: instrumento que devolve "ok" por nao ter encontrado nada e o que a L2.6 proibe.
export function resolveAdr(adrDir = "docs/adr") {
  if (!existsSync(adrDir)) return { path: null, problem: `LAW-6c: diretorio de ADR nao encontrado: ${adrDir}` };
  const candidatos = readdirSync(adrDir).filter((nome) => nome.startsWith("0007-") && nome.endsWith(".md"));
  if (candidatos.length !== 1) {
    return { path: null, problem: `LAW-6c: esperado exatamente 1 arquivo 0007-*.md em ${adrDir}, encontrados ${candidatos.length}` };
  }
  return { path: path.join(adrDir, candidatos[0]), problem: null };
}

export function checkLadder(lawsText, adrPath) {
  const problems = [];
  const inicio = lawsText.indexOf("### L0.1 ");
  if (inicio === -1) {
    problems.push("LAW-6: L0.1 nao encontrada na fonte de leis — a escada nao pode ser conferida");
    return problems;
  }
  // Fecha em `### `, `## ` ou `---`, como o parseCharter: nao fechar nos tres foi bug medido.
  const linhas = lawsText.slice(inicio).split("\n");
  const fim = linhas.findIndex((linha, ordem) => ordem > 0 && (linha.startsWith("### ") || linha.startsWith("## ") || linha === "---"));
  const corpo = (fim === -1 ? linhas : linhas.slice(0, fim)).join("\n");

  // O primeiro paragrafo DEPOIS do cabecalho e a escada. Espacos sao normalizados antes de dividir:
  // a primeira versao deste arquivo reprovou 45 leis integras por um espaco a mais na regex.
  const escada = (corpo.split("\n\n")[1] ?? "").replace(/\s+/g, " ").trim();
  const niveis = escada.split(">").map((nivel) => nivel.trim()).filter(Boolean);
  if (niveis.length !== LADDER.length) {
    problems.push(`LAW-6a: a escada da L0.1 tem ${niveis.length} niveis, esperados ${LADDER.length}`);
  }
  for (const [ordem, esperado] of LADDER.entries()) {
    if (niveis[ordem] !== undefined && !niveis[ordem].includes(esperado)) {
      problems.push(`LAW-6a: nivel ${ordem + 1} e "${niveis[ordem]}", esperado conter "${esperado}"`);
    }
  }
  // A clausula OPERATIVA da escada: sem ela, inverter a direcao de resolucao — a mudanca normativa
  // mais grave possivel neste arquivo — passava verde (achado O-1 do gate).
  if (!escada.includes("Conflicts resolve upward, always.")) {
    problems.push('LAW-6a: a escada da L0.1 nao declara "Conflicts resolve upward, always."');
  }
  for (const caminho of NIVEL_2_CAMINHOS) {
    if (!(niveis[1] ?? "").includes(caminho)) problems.push(`LAW-6b: o nivel 2 da escada nao nomeia ${caminho}`);
  }
  if (lawsText.includes(FRASE_PROIBIDA)) {
    problems.push(`LAW-6d: a fonte de leis afirma "${FRASE_PROIBIDA}" — era falso desde 4826d6d`);
  }

  const data = corpo.match(DATA_DA_EMENDA);
  if (!data) {
    problems.push("LAW-6c: a L0.1 nao cita a data da emenda ao ADR-0007");
    return problems;
  }
  if (!adrPath || !existsSync(adrPath)) {
    problems.push(`LAW-6c: ADR nao encontrado (${adrPath ?? "sem caminho"}) — o par datado nao pode ser conferido`);
    return problems;
  }
  const cabecalho = `## Emenda de ${data[1]}`;
  if (!readFileSync(adrPath, "utf8").includes(cabecalho)) {
    problems.push(`LAW-6c: ${adrPath} nao tem "${cabecalho}", citada pela L0.1`);
  }
  return problems;
}

// Parsing puro, sem IO. Extrai as seções ## na ordem, cada uma com título e corpo.
// Espaçamento irregular depois do ## passa O PARSER, e o título devolvido PRESERVA os espaços
// extras. A RUL-1 compara título por igualdade exata, então um cabeçalho real com dois espaços
// vira achado — o que é correto, e é o que esta nota evita que o próximo leitor conclua ao contrário
// (achado O-7 do gate isolado).
export function parseSections(text) {
  const sections = [];
  const lines = text.split("\n");
  let currentSection = null;
  let sectionBody = [];

  for (const line of lines) {
    // `###` NAO e cabecalho de secao. `startsWith("##")` sozinho casava `###` e `####`, e deixava
    // a RUL-1 VERMELHA na fonte integra: 17 secoes onde ha 5. Foi exatamente assim que a primeira
    // versao deste arquivo reprovou 45 leis corretas, e o comentario do selfTest ja avisava.
    // Espacamento irregular DEPOIS do `##` passa O PARSER, de proposito (ha teste positivo); a
    // conferencia de titulo adiante e que e exata.
    if (line.startsWith("##") && !line.startsWith("###")) {
      if (currentSection) {
        sections.push({ title: currentSection, lines: sectionBody });
      }
      currentSection = line;
      sectionBody = [];
    } else if (currentSection) {
      sectionBody.push(line);
    }
  }

  if (currentSection) {
    sections.push({ title: currentSection, lines: sectionBody });
  }

  return sections;
}

// Extração de DEFINIÇÃO: só item numerado com ID inicial, com o ponto e UM espaço antes do
// parêntese. Não conta citação de ID no meio do texto — é o que separa 48 de 56 no guia, e 75 de
// 76 no `cross-cutting`, onde o `## Checklist` cita `(DES-10)`.
// Fonte ÚNICA do padrão, de propósito: ele nasceu copiado em três lugares (as duas conferências e
// um teste), e duas cópias de um extrator divergem em silêncio — a `CONSTITUTION 3.5` é sobre isto,
// e esta fatia existe para não deixar regra em dois lugares.
const ID_EXTRACTION_PATTERN = /^\s*\d+\. \(([A-Z]{2,}-\d+)\)/;

export function extractDefinedIds(text) {
  const ids = [];
  for (const line of text.split("\n")) {
    const match = line.match(ID_EXTRACTION_PATTERN);
    if (match) ids.push(match[1]);
  }
  return ids;
}

// Regras puras de força de regra: recebem seções já parseadas e a declaração esperada.
// Verifica RUL-1 (ordem e presença dos cabeçalhos), RUL-2 (frases de força) e RUL-3
// (presença/ausência de IDs conforme a força da seção).
export function checkRuleForce(sections, declared) {
  const problems = [];

  const actualTitles = sections.map((s) => s.title);
  const declaredTitles = declared.map((d) => d.title);

  // RUL-2 na DECLARAÇÃO, antes de olhar a fonte: a `RULE_SOURCES` é cópia deliberada, e um autor
  // que declarasse força `reprove` num título sem a frase de força criaria uma regra que reprova
  // sem o leitor saber disso pelo título — que é justamente o que o `UC-2` diz ser a única coisa
  // que separa uma Good Practice de uma reprovação. Sem esta metade, a `RUL-2` NUNCA seria o único
  // achado: perder a frase também muda o título, então a `RUL-1` chegaria primeiro e a `RUL-2`
  // ficaria escrita e inalcançável — foi o que aconteceu com a `LAW-5`, e é o que o `--self-test`
  // passou a cobrar desde então.
  for (const declaration of declared) {
    if (declaration.force === "reprove" && !declaration.title.includes("they reprove")) {
      problems.push(`RUL-2: declared section "${declaration.title}" has force "reprove" but the declared title is missing "they reprove"`);
    }
    if (declaration.force === "no-reprove" && !declaration.title.includes("do not reprove")) {
      problems.push(`RUL-2: declared section "${declaration.title}" has force "no-reprove" but the declared title is missing "do not reprove"`);
    }
  }

  // Título repetido na FONTE é achado por si: a força de uma cláusula é lida no título da seção em
  // que ela está, e duas seções com o mesmo título tornam ambígua tanto a força quanto a citação
  // por nome de seção, que é como um anti-pattern é citado sob a `L1.1`.
  const vistos = new Set();
  for (const title of actualTitles) {
    if (vistos.has(title)) problems.push(`RUL-1: duplicated section title "${title}"`);
    vistos.add(title);
  }

  if (actualTitles.length !== declaredTitles.length) {
    // Aridade diferente é o único caso em que paramos: a força é casada por ÍNDICE, e sobre uma
    // lista desalinhada a RUL-2 e a RUL-3 produziriam achado sobre a seção errada.
    problems.push(`RUL-1: expected ${declaredTitles.length} section(s), found ${actualTitles.length}`);
    return problems;
  }

  for (const [i, expected] of declaredTitles.entries()) {
    if (actualTitles[i] !== expected) {
      problems.push(`RUL-1: section ${i + 1} is "${actualTitles[i]}", expected "${expected}"`);
    }
  }

  // Sem `return` aqui: com a aridade igual o índice está alinhado, então a RUL-2 e a RUL-3 ainda
  // valem. Um cabeçalho que PERDEU a frase de força é as duas coisas — renomeação e perda de força
  // — e o relatório nomear as duas informa mais, não menos.
  for (const [i, section] of sections.entries()) {
    const force = declared[i].force;

    if (force === "reprove" && !section.title.includes("they reprove")) {
      problems.push(`RUL-2: section "${section.title}" has force "reprove" but is missing "they reprove"`);
    }
    if (force === "no-reprove" && !section.title.includes("do not reprove")) {
      problems.push(`RUL-2: section "${section.title}" has force "no-reprove" but is missing "do not reprove"`);
    }

    const bodyText = section.lines.join("\n");
    const itemsWithIds = [];
    const itemsWithoutIds = [];

    for (const line of bodyText.split("\n")) {
      if (line.match(ID_EXTRACTION_PATTERN)) {
        itemsWithIds.push(line.trim());
      } else if (line.match(/^\s*\d+\./)) {
        itemsWithoutIds.push(line.trim());
      }
    }

    if (force === "reprove" && itemsWithoutIds.length) {
      problems.push(`RUL-3: section "${section.title}" (force "reprove") has items without ID: ${itemsWithoutIds[0]}`);
    }

    if (force === "no-reprove" && itemsWithIds.length) {
      problems.push(`RUL-3: section "${section.title}" (force "no-reprove") has items with ID: ${itemsWithIds[0]}`);
    }

    // Forca "none" nao cria norma citavel, logo nao pode conter item com identificador: o formato
    // `(PREFIX-n)` e o que o guia preserva e o que o `code-analyzer` cita. Sem este ramo, uma secao
    // declarada "none" nao tinha conferencia NENHUMA — nem frase de forca nem identificador — e era
    // por ela que um autor futuro enfiaria regra citavel sem titulo que declare a forca
    // (achado O-4 do gate isolado, resposta a pergunta 1 que eu lhe fiz).
    if (force === "none" && itemsWithIds.length) {
      problems.push(`RUL-3: section "${section.title}" (force "none") has items with ID: ${itemsWithIds[0]}`);
    }
  }

  return problems;
}

// Fonte unica dos nomes das skills de arquitetura: derivada do ID_BASELINE, que e onde elas sao
// declaradas uma vez. Uma skill que entre na linha-base passa a ser conferida pelas duas vias no
// mesmo diff, sem ninguem lembrar de uma segunda lista.
export function archSkillNames() {
  return Object.keys(ID_BASELINE)
    .filter((source) => source.startsWith("skills/arch-"))
    .map((source) => source.split("/")[1]);
}

// RUL-5: verifica se uma instrução de montagem arch-* nomeia a seção de autoria "Rule force".
// Se um SKILL.md menciona a seção de critério de autoria (que NÃO deve ir ao guia), é um achado.
export function checkSkillRuleForceReferences(skillsDir) {
  const problems = [];
  // As skills de arquitetura saem da PROPRIA linha-base, nunca de uma segunda lista fixa. Havia
  // duas listas das mesmas quatro skills — as chaves `skills/arch-*` do ID_BASELINE e um array aqui
  // — e ninguem as mantinha em sincronia: e "regra em dois lugares", a familia do defeito D2 desta
  // fatia, e a DT-3 preve `SEC-*` entrando na linha-base (achado O-5 do gate isolado).
  for (const skill of archSkillNames()) {
    const skillPath = path.join(skillsDir, skill, "SKILL.md");
    // Fonte ausente é ACHADO, nunca pulo silencioso. O `continue` daqui fazia a RUL-5 devolver
    // "ok" por não ter encontrado nada — exatamente o que a `L2.6` proíbe, e o precedente está
    // neste arquivo: `resolveAdr` trata 0 e >1 resultados como achado.
    if (!existsSync(skillPath)) {
      problems.push(`RUL-5 ${skill}: SKILL.md não encontrado em ${skillPath} — a conferência não foi feita`);
      continue;
    }

    const skillContent = readFileSync(skillPath, "utf8");
    if (skillContent.includes("Rule force") || skillContent.includes("authoring criterion")) {
      problems.push(`RUL-5 ${skill}: SKILL.md references the "Rule force" (authoring criterion) section, which is not assembled into the guide`);
    }
  }

  return problems;
}

// Regras puras de censo de IDs: recebem os IDs extraídos de um arquivo e conferem contra linha-base.
// Verifica RUL-4: prefixo desconhecido, contagem diferente, lacuna (1..n não contíguo),
// ID duplicado, ou extração vazia (arquivo sem nenhum item numerado = achado, nunca silêncio).
export function checkIdCensus(fileContent, baseline, sourceFile) {
  const problems = [];

  // O `total` e usado no ramo de extracao vazia e somado na linha de sucesso. Se alguem atualizar
  // `prefixes` e esquecer o `total`, a divergencia seria SILENCIOSA e o numero impresso mentiria —
  // e a DT-3 promete o contrario: divergencia fica VERMELHA (achado O-6 do gate isolado).
  const somaDosPrefixos = Object.values(baseline.prefixes).reduce((soma, n) => soma + n, 0);
  if (baseline.total !== somaDosPrefixos) {
    problems.push(`RUL-4 ${sourceFile}: linha-base incoerente — total ${baseline.total}, soma dos prefixos ${somaDosPrefixos}`);
  }

  const extractedIds = extractDefinedIds(fileContent);

  if (extractedIds.length === 0 && baseline.total > 0) {
    problems.push(`RUL-4 ${sourceFile}: extração vazia — esperados ${baseline.total} IDs, encontrados 0 (fonte sem item numerado é achado)`);
    return problems;
  }

  const countByPrefix = {};
  const seenIds = new Set();

  // Sem guarda de prefixo: o unico produtor de `extractedIds` e `extractDefinedIds`, que devolve o
  // grupo 1 do `ID_EXTRACTION_PATTERN` — todo id tem a forma `PREFIX-n` por construcao. A guarda que
  // estava aqui era ramo inalcancavel, e um `continue` SILENCIOSO se algum dia deixasse de ser:
  // a mesma forma do defeito que a RUL-5 tinha (achado S-1 do gate isolado).
  for (const id of extractedIds) {
    const prefix = id.slice(0, id.indexOf("-"));

    if (seenIds.has(id)) {
      problems.push(`RUL-4 ${sourceFile}: ID duplicado "${id}"`);
    }
    seenIds.add(id);

    if (!baseline.prefixes[prefix]) {
      problems.push(`RUL-4 ${sourceFile}: prefixo desconhecido "${prefix}" em "${id}"`);
    } else {
      countByPrefix[prefix] = (countByPrefix[prefix] || 0) + 1;
    }
  }

  for (const [prefix, expectedCount] of Object.entries(baseline.prefixes)) {
    const actualCount = countByPrefix[prefix] || 0;
    if (actualCount !== expectedCount) {
      problems.push(`RUL-4 ${sourceFile}: prefixo "${prefix}" tem ${actualCount} IDs, esperados ${expectedCount}`);
    }

    for (let i = 1; i <= expectedCount; i++) {
      if (!extractedIds.includes(`${prefix}-${i}`)) {
        problems.push(`RUL-4 ${sourceFile}: lacuna no prefixo "${prefix}" — esperado ${prefix}-${i}`);
      }
    }
  }

  return problems;
}

function selfTest() {
  // Caminho POSITIVO primeiro. Um verificador testado só contra amostra defeituosa prova que
  // sabe falhar, não que sabe passar — e foi assim que a primeira versão deste arquivo reprovou
  // as 45 leis de uma fonte íntegra, por um espaço a mais na regex.
  const valida = [
    "### L1.1 — One space  `[Verifier]`",
    "### L2.1 — Aligned with many spaces      `[All]`",
    "### L3.1 — Two roles `[Executor, Verifier]`",
  ].join("\n");
  const problemasNaAmostraValida = checkLaws(parseLaws(valida), {
    "spec-create": { hasPointer: true, declaresRole: true },
  });
  if (problemasNaAmostraValida.length) {
    console.error(`self-test FALHOU: amostra VÁLIDA acusada — ${problemasNaAmostraValida.join("; ")}`);
    return 1;
  }

  const amostra = [
    "### L1.1 — First  `[Verifier]`",
    "### L1.1 — Duplicated  `[All]`",
    "### L2.1 — No role",
    "### L3.1 — Bad role  `[Architect]`",
    "### L4.1 — Orphan  `[Reviewer]`",
  ].join("\n");
  const problems = checkLaws(parseLaws(amostra), { "spec-create": { hasPointer: false, declaresRole: false } });

  // LAW-5 tem de disparar no self-test: sem isso ela ficava escrita e nunca exercitada pelo
  // próprio script — foi assim que ela passou a existir sem ser alcançável por `main`.
  console.log("self-test: criando a arvore da LAW-5 em disco");
  const arvore = mkdtempSync(path.join(tmpdir(), "mgr-law5-"));
  mkdirSync(path.join(arvore, "spec-create"), { recursive: true });
  writeFileSync(path.join(arvore, "spec-create", "SKILL.md"), `x ${LAWS_TOKEN}\n`, "utf8");
  console.log(`self-test: arvore da LAW-5 criada em ${arvore}`);
  problems.push(...checkResolved(arvore));

  // A amostra defeituosa nao tem L0.1: a LAW-6 tem de acusar isso, e nao passar calada.
  problems.push(...checkLadder(amostra, null));
  // E uma L0.1 DEFORMADA, para exercitar as subconferencias de verdade: sem isto o self-test tocava
  // so o ramo "L0.1 nao encontrada", que e o mais fraco que existe (achado O-5 do gate).
  problems.push(...checkLadder([
    "### L0.1 — Fixed precedence `[All]`",
    "",
    "MGR core principles > project rules (`.mgr-core/`) > workspace conventions > skill instructions.",
    "",
    "unchanged and in the same order",
  ].join("\n"), null));

  const esperados = ["LAW-1", "LAW-2", "LAW-3", "LAW-5", "LAW-6", "RUL-1", "RUL-2", "RUL-3", "RUL-4", "RUL-5"];

  console.log("self-test: criando a arvore temporaria das conferencias de regra");
  const arvoreDeRegras = mkdtempSync(path.join(tmpdir(), "mgr-rules-"));
  console.log(`self-test: arvore das conferencias de regra criada em ${arvoreDeRegras}`);

  problems.push(
    ...checkRuleForce(
      parseSections([
        "## Section 2",
        "",
        "## Section 1",
      ].join("\n")),
      [
        { title: "## Section 1", force: "reprove" },
        { title: "## Section 2", force: "reprove" },
      ],
    ),
  );

  problems.push(
    ...checkRuleForce(
      parseSections([
        "## Mandatory rules (missing phrase)",
        "1. (TEST-1) A",
      ].join("\n")),
      [{ title: "## Mandatory rules (missing phrase)", force: "reprove" }],
    ),
  );

  problems.push(
    ...checkRuleForce(
      parseSections([
        "## Mandatory rules (they reprove in review)",
        "1. (TEST-1) A",
        "2. B",
      ].join("\n")),
      [{ title: "## Mandatory rules (they reprove in review)", force: "reprove" }],
    ),
  );

  problems.push(
    ...checkRuleForce(
      parseSections([
        "## Good Practices (they do not reprove — opt-in)",
        "1. (TEST-1) A",
      ].join("\n")),
      [{ title: "## Good Practices (they do not reprove — opt-in)", force: "no-reprove" }],
    ),
  );

  problems.push(
    ...checkIdCensus("1. (TEST-1) A", { total: 2, prefixes: { TEST: 2 } }, "test-file"),
  );

  problems.push(
    ...checkIdCensus("no items\n", { total: 1, prefixes: { TEST: 1 } }, "test-file"),
  );

  console.log("self-test: criando a arvore da RUL-5 em disco");
  mkdirSync(path.join(arvoreDeRegras, "arch-clean"), { recursive: true });
  writeFileSync(
    path.join(arvoreDeRegras, "arch-clean", "SKILL.md"),
    "Rule force is the authoring criterion\n",
    "utf8",
  );
  console.log(`self-test: arvore da RUL-5 criada em ${arvoreDeRegras}`);
  problems.push(...checkSkillRuleForceReferences(arvoreDeRegras));

  // A segunda condicao do `||` da RUL-5, mostrada decidindo SOZINHA: `authoring criterion` sem
  // `Rule force`. Com a fixture unica anterior os dois operandos eram satisfeitos juntos, e a
  // TST-4 (MC/DC) exige cada condicao variando de forma independente (achado S-2 do gate isolado).
  mkdirSync(path.join(arvoreDeRegras, "arch-onion"), { recursive: true });
  writeFileSync(
    path.join(arvoreDeRegras, "arch-onion", "SKILL.md"),
    "assemble the authoring criterion section\n",
    "utf8",
  );
  console.log("self-test: segunda arvore da RUL-5 criada");
  problems.push(...checkSkillRuleForceReferences(arvoreDeRegras));

  const faltando = esperados.filter((code) => !problems.some((problem) => problem.startsWith(code)));
  if (faltando.length) {
    console.error(`self-test FALHOU: regras que não dispararam: ${faltando.join(", ")}`);
    return 1;
  }
  console.log(`self-test OK — ${problems.length} problemas detectados na amostra defeituosa`);
  return 0;
}

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();

  const charterArg = argv.indexOf("--charter");
  const lawsArg = argv.indexOf("--laws");
  const skillsArg = argv.indexOf("--skills");
  const installedArg = argv.indexOf("--installed");
  const archRulesArg = argv.indexOf("--arch-rules");
  const qualityRulesArg = argv.indexOf("--quality-rules");
  const lawsFile = lawsArg === -1 ? "shared/laws/execution-laws.md" : argv[lawsArg + 1];
  const skillsDir = skillsArg === -1 ? "skills" : argv[skillsArg + 1];
  const installedDir = installedArg === -1 ? null : argv[installedArg + 1];
  const charterFile = charterArg === -1 ? "shared/charter/core-principles.md" : argv[charterArg + 1];
  const archRulesFile = archRulesArg === -1 ? "shared/arch/cross-cutting-rules.md" : argv[archRulesArg + 1];
  const qualityRulesFile = qualityRulesArg === -1 ? "shared/quality/quality-rules.md" : argv[qualityRulesArg + 1];

  if (!existsSync(lawsFile)) {
    console.error(`erro: fonte de leis não encontrada: ${lawsFile}`);
    return 1;
  }

  if (!existsSync(charterFile)) {
    console.error(`erro: carta de primícias não encontrada: ${charterFile}`);
    return 1;
  }

  if (!existsSync(archRulesFile)) {
    console.error(`erro: fonte de regras arquiteturais não encontrada: ${archRulesFile}`);
    return 1;
  }

  if (!existsSync(qualityRulesFile)) {
    console.error(`erro: fonte de regras de qualidade não encontrada: ${qualityRulesFile}`);
    return 1;
  }

  const lawsText = readFileSync(lawsFile, "utf8");
  const laws = parseLaws(lawsText);
  const charter = parseCharter(readFileSync(charterFile, "utf8"));
  const archRulesText = readFileSync(archRulesFile, "utf8");
  const qualityRulesText = readFileSync(qualityRulesFile, "utf8");
  const adrArg = argv.indexOf("--adr");
  const adr = adrArg === -1 ? resolveAdr() : { path: argv[adrArg + 1], problem: null };

  const problems = [...checkLaws(laws, readPointers(skillsDir)), ...checkCharter(charter, lawsText)];
  if (adr.problem) problems.push(adr.problem);
  else problems.push(...checkLadder(lawsText, adr.path));

  // LAW-5 só faz sentido contra uma árvore INSTALADA, onde o token já deveria estar resolvido.
  if (installedDir) problems.push(...checkResolved(installedDir), ...checkCharterResolved(installedDir));

  // RUL-* conferências de regras arquiteturais e de qualidade
  problems.push(...checkRuleForce(parseSections(archRulesText), RULE_SOURCES["shared/arch/cross-cutting-rules.md"]));
  problems.push(...checkRuleForce(parseSections(qualityRulesText), RULE_SOURCES["shared/quality/quality-rules.md"]));
  problems.push(...checkIdCensus(archRulesText, ID_BASELINE["shared/arch/cross-cutting-rules.md"], archRulesFile));
  problems.push(...checkIdCensus(qualityRulesText, ID_BASELINE["shared/quality/quality-rules.md"], qualityRulesFile));

  // Fonte ausente e ACHADO, nunca pulo silencioso. O `if (existsSync)` sem ramo falso que estava
  // aqui ficava mascarado por acidente — a `checkSkillRuleForceReferences` percorre uma lista fixa
  // das quatro arch e acusaria o arquivo ausente —, e a mascara cairia na primeira entrada de
  // `ID_BASELINE` fora daquela lista, que e justamente o que a DT-3 preve com a `SEC-*`
  // (achado O-5 do gate isolado).
  for (const sourceFile of Object.keys(ID_BASELINE)) {
    if (!sourceFile.startsWith("skills/arch-")) continue;
    if (!existsSync(sourceFile)) {
      problems.push(`RUL-4 ${sourceFile}: fonte declarada na linha-base nao encontrada — o censo nao foi conferido`);
      continue;
    }
    problems.push(...checkIdCensus(readFileSync(sourceFile, "utf8"), ID_BASELINE[sourceFile], sourceFile));
  }

  problems.push(...checkSkillRuleForceReferences(skillsDir));

  if (problems.length) {
    console.error(`check-laws: ${problems.length} problema(s) em leis, carta ou regras`);
    for (const problem of problems) console.error(`  ${problem}`);
    return 1;
  }

  const law5 = installedDir ? `; LAW-5 conferida em ${installedDir}` : "; LAW-5 não conferida (sem --installed)";
  const principios = charter.filter((candidate) => candidate.id).length;
  // Sem ternario: neste ponto `problems` esta vazio, o que exige `adr.problem === null` e
  // `checkLadder` sem achado — e ele empurra LAW-6c quando `adrPath` e falsy. Logo `adr.path` e
  // sempre verdadeiro aqui, e o ramo falso era inalcancavel (achado S-2 do gate).
  const escada = `, escada conferida contra ${adr.path}`;
  const rulesCensus = Object.values(ID_BASELINE).reduce((sum, source) => sum + source.total, 0);
  console.log(`check-laws OK — ${laws.length} leis, ${principios} primícias, ${rulesCensus} regras (arquiteturais, qualidade, e skills), ${Object.keys(CORE_ROLES).length} skills do CORE com ponteiro${law5}${escada}`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("check-laws.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
