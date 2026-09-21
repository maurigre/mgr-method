#!/usr/bin/env node
// Verificador da fonte única de leis de execução (feature mgr-hardening-core, task P1.5).
// Ferramenta de desenvolvimento do repo — fora do tarball npm, como o check-translation.mjs.
//
// Uso:
//   node scripts/check-laws.mjs [--laws <arquivo>] [--skills <dir>] [--installed <dir>]
//   node scripts/check-laws.mjs --self-test
//
// Verifica o que é MECÂNICO, e só isso:
//   LAW-1  ID de lei duplicado
//   LAW-2  papel fora da matriz declarada
//   LAW-3  skill do CORE sem a linha-ponteiro {{MGR_LAWS}}
//   LAW-4  lei órfã: papel que não mapeia para nenhuma skill do CORE
//   LAW-5  token {{MGR_LAWS}} sobrando (fonte instalada com o token cru)
//   CHT-1  ID de primícia duplicado na carta
//   CHT-2  primícia sem uma das três partes obrigatórias
//   CHT-3  cabeçalho `###` na carta fora do formato `CP-<n>`
//   CHT-4  a L0.1 sem o ponteiro {{MGR_CHARTER}}
//
// Por que o CHT-3 existe, e foi medido antes de escrito: `parseLaws` pula em SILÊNCIO todo
// cabeçalho que não comece com `### L`. Um erro de digitação no cabeçalho de uma primícia a faria
// desaparecer sem uma palavra, e carta que perde primícia calada é pior que carta nenhuma.
//
// O que ele NÃO verifica, de propósito: se a lei "diz a mesma coisa" que a skill dizia. Isso é
// julgamento, não parsing, e cabe ao inventário de não-regressão. Um verificador que prometesse
// isso daria falsa segurança — o que a L1.9 proíbe.
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
// mitigação do ADR-0022 ser verdadeira: sem isto, o ponteiro pode apontar para o vazio e o único
// guarda seria um teste. O `mgr doctor` NÃO alcança isto — a verificação `unresolved-token` dele só
// lê `SKILL.md` de skill em disco, e `_shared` é excluído por construção.
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
  if (!existsSync(path.resolve(repo, apontado)) && !existsSync(apontado)) {
    problems.push(`CHT-4 ${leis}: the charter pointer resolves to ${apontado}, which does not exist`);
  }
  return problems;
}

// LAW-5: o token não pode sobrar numa árvore INSTALADA (onde já deveria estar resolvido).
export function checkResolved(installedSkillsDir) {
  const problems = [];
  if (!existsSync(installedSkillsDir)) return problems;
  for (const entry of readdirSync(installedSkillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const md = path.join(installedSkillsDir, entry.name, "SKILL.md");
    if (!existsSync(md)) continue;
    if (readFileSync(md, "utf8").includes(LAWS_TOKEN)) {
      problems.push(`LAW-5 ${entry.name}: ${LAWS_TOKEN} left unresolved in an installed skill`);
    }
  }
  return problems;
}

export const CHARTER_TOKEN = "{{MGR_CHARTER}}";
const LAWS_INSTALLED_SEGMENTS = ["_shared", "laws", "execution-laws.md"];
const CHARTER_HEADER = /^### (CP-\d+) — (.+)$/;
const CHARTER_PARTS = ["**Statement.**", "**Case.**", "**Provenance.**"];

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
  const arvore = mkdtempSync(path.join(tmpdir(), "mgr-law5-"));
  mkdirSync(path.join(arvore, "spec-create"), { recursive: true });
  writeFileSync(path.join(arvore, "spec-create", "SKILL.md"), `x ${LAWS_TOKEN}\n`, "utf8");
  problems.push(...checkResolved(arvore));

  const esperados = ["LAW-1", "LAW-2", "LAW-3", "LAW-5"];
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
  const lawsFile = lawsArg === -1 ? "shared/laws/execution-laws.md" : argv[lawsArg + 1];
  const skillsDir = skillsArg === -1 ? "skills" : argv[skillsArg + 1];
  const installedDir = installedArg === -1 ? null : argv[installedArg + 1];
  const charterFile = charterArg === -1 ? "shared/charter/core-principles.md" : argv[charterArg + 1];

  if (!existsSync(lawsFile)) {
    console.error(`erro: fonte de leis não encontrada: ${lawsFile}`);
    return 1;
  }

  if (!existsSync(charterFile)) {
    console.error(`erro: carta de primícias não encontrada: ${charterFile}`);
    return 1;
  }

  const lawsText = readFileSync(lawsFile, "utf8");
  const laws = parseLaws(lawsText);
  const charter = parseCharter(readFileSync(charterFile, "utf8"));
  const problems = [...checkLaws(laws, readPointers(skillsDir)), ...checkCharter(charter, lawsText)];
  // LAW-5 só faz sentido contra uma árvore INSTALADA, onde o token já deveria estar resolvido.
  if (installedDir) problems.push(...checkResolved(installedDir), ...checkCharterResolved(installedDir));

  if (problems.length) {
    console.error(`check-laws: ${problems.length} problema(s) em ${lawsFile}`);
    for (const problem of problems) console.error(`  ${problem}`);
    return 1;
  }
  const law5 = installedDir ? `; LAW-5 conferida em ${installedDir}` : "; LAW-5 não conferida (sem --installed)";
  const principios = charter.filter((candidate) => candidate.id).length;
  console.log(`check-laws OK — ${laws.length} leis, ${principios} primícias, ${Object.keys(CORE_ROLES).length} skills do CORE com ponteiro${law5}`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("check-laws.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
