#!/usr/bin/env node
// Verificador estrutural de tradução (feature idioma-canonico-ingles, task P0.1).
// Compara um arquivo do working tree com o original em um ref do git (default: main),
// aplicando o mapa de renames da spec. Ferramenta de desenvolvimento do repo — fora do
// tarball npm de propósito (ver D3 na spec).
//
// Uso:
//   node scripts/check-translation.mjs <arquivo> [...] [--against <ref>] [--allow-fences 1,3]
//   node scripts/check-translation.mjs --self-test
//
// Falha (exit 1) quando a tradução perde estrutura: headings, IDs de regra, blocos de
// código, itens de lista, linhas de tabela ou chaves de frontmatter.
// --allow-fences isenta blocos cercados (índices 1-based, por arquivo único) cujo
// conteúdo é prosa/diagrama legitimamente traduzível — o bloco continua tendo de existir.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RENAMES = {
  "shared/arch/cross-cutting-rules.md": "shared/arch/regras-transversais.md",
  "shared/quality/quality-rules.md": "shared/quality/regras-qualidade.md",
  "skills/evidence-capture/templates/reviews.md": "skills/evidence-capture/templates/revisoes.md",
};

const RULE_ID = /\b(?:INV|DES|TST|LOG|MUT|NAM|QUAL|JQ|JS)-\d+\b/g;

export function parseDoc(text) {
  const lines = text.split("\n");
  let i = 0;
  const frontmatterKeys = [];
  if (lines[0] === "---") {
    i = 1;
    while (i < lines.length && lines[i] !== "---") {
      const m = /^([A-Za-z][\w-]*):/.exec(lines[i]);
      if (m) frontmatterKeys.push(m[1]);
      i++;
    }
    i++;
  }
  const headings = [];
  const fences = [];
  let fence = null;
  let listItems = 0;
  let tableRows = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const mark = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (mark && mark[1][0] === fence.marker[0] && mark[1].length >= fence.marker.length && mark[2].trim() === "") {
        fences.push({ info: fence.info, content: fence.content.join("\n") });
        fence = null;
      } else {
        fence.content.push(line);
      }
      continue;
    }
    if (mark) {
      fence = { marker: mark[1], info: mark[2].trim(), content: [] };
      continue;
    }
    const h = /^(#{1,6})\s/.exec(line);
    if (h) {
      headings.push(h[1].length);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s/.test(line)) listItems++;
    if (/^\s*\|/.test(line)) tableRows++;
  }
  const ids = new Map();
  for (const m of text.match(RULE_ID) || []) ids.set(m, (ids.get(m) || 0) + 1);
  return { frontmatterKeys, headings, fences, listItems, tableRows, ids };
}

export function compareDocs(orig, curr, { allowFences = new Set() } = {}) {
  const errors = [];
  const warnings = [];

  const fmOrig = [...orig.frontmatterKeys].sort().join(",");
  const fmCurr = [...curr.frontmatterKeys].sort().join(",");
  if (fmOrig !== fmCurr) {
    errors.push(`frontmatter: chaves divergem (original: [${fmOrig}] vs atual: [${fmCurr}])`);
  }

  if (orig.headings.length !== curr.headings.length) {
    errors.push(`headings: contagem diverge (original: ${orig.headings.length} vs atual: ${curr.headings.length})`);
  } else {
    for (let i = 0; i < orig.headings.length; i++) {
      if (orig.headings[i] !== curr.headings[i]) {
        errors.push(`headings: nível diverge no heading ${i + 1} (original: h${orig.headings[i]} vs atual: h${curr.headings[i]})`);
        break;
      }
    }
  }

  if (orig.fences.length !== curr.fences.length) {
    errors.push(`fences: contagem de blocos cercados diverge (original: ${orig.fences.length} vs atual: ${curr.fences.length})`);
  } else {
    for (let i = 0; i < orig.fences.length; i++) {
      const a = orig.fences[i];
      const b = curr.fences[i];
      if (a.info !== b.info) {
        errors.push(`fences: info string do bloco ${i + 1} diverge ("${a.info}" vs "${b.info}")`);
      }
      if (a.content !== b.content && !allowFences.has(i + 1)) {
        errors.push(`fences: conteúdo do bloco ${i + 1} diverge (use --allow-fences ${i + 1} se a divergência for tradução legítima de prosa/diagrama)`);
      }
    }
  }

  if (orig.listItems !== curr.listItems) {
    errors.push(`listas: contagem de itens diverge (original: ${orig.listItems} vs atual: ${curr.listItems})`);
  }
  if (orig.tableRows !== curr.tableRows) {
    errors.push(`tabelas: contagem de linhas diverge (original: ${orig.tableRows} vs atual: ${curr.tableRows})`);
  }

  for (const id of orig.ids.keys()) {
    if (!curr.ids.has(id)) errors.push(`ids: ${id} presente no original e AUSENTE na tradução`);
  }
  for (const id of curr.ids.keys()) {
    if (!orig.ids.has(id)) errors.push(`ids: ${id} não existe no original (regra inventada?)`);
  }
  for (const [id, n] of orig.ids) {
    const m = curr.ids.get(id);
    if (m !== undefined && m !== n) warnings.push(`ids: ${id} citado ${n}x no original e ${m}x na tradução`);
  }

  return { errors, warnings };
}

function originalPath(file) {
  const norm = file.replace(/\\/g, "/").replace(/^\.\//, "");
  return { curr: norm, orig: RENAMES[norm] || norm };
}

function checkFile(file, ref, allowFences) {
  const { curr, orig } = originalPath(file);
  let origText;
  try {
    origText = execFileSync("git", ["show", `${ref}:${orig}`], { encoding: "utf8" });
  } catch {
    return { errors: [`não foi possível ler ${orig} em ${ref} (arquivo novo? ref errado?)`], warnings: [] };
  }
  const currText = readFileSync(curr, "utf8");
  return compareDocs(parseDoc(origText), parseDoc(currText), { allowFences });
}

function report(label, { errors, warnings }) {
  for (const w of warnings) console.log(`  aviso: ${w}`);
  if (errors.length === 0) {
    console.log(`OK: ${label}`);
    return true;
  }
  console.error(`FALHOU: ${label}`);
  for (const e of errors) console.error(`  erro: ${e}`);
  return false;
}

const SELF_TEST_DOC = `---
name: exemplo
description: doc sintético do self-test
---
# Título

## Regras

- INV-1 vale sempre
- INV-2 também, junto com TST-3

| id | efeito |
|---|---|
| INV-1 | topo |

\`\`\`js
const x = 1;
\`\`\`
`;

function selfTest() {
  const base = parseDoc(SELF_TEST_DOC);
  const cases = [
    ["idêntico passa", SELF_TEST_DOC, new Set(), true],
    ["heading removido falha", SELF_TEST_DOC.replace("## Regras\n", ""), new Set(), false],
    ["ID perdido falha", SELF_TEST_DOC.replace("junto com TST-3", "sozinho"), new Set(), false],
    ["fence alterada falha", SELF_TEST_DOC.replace("const x = 1;", "const y = 2;"), new Set(), false],
    ["fence alterada com --allow-fences passa", SELF_TEST_DOC.replace("const x = 1;", "const y = 2;"), new Set([1]), true],
    ["item de lista removido falha", SELF_TEST_DOC.replace("- INV-1 vale sempre\n", "").replace("| INV-1 | topo |", "| INV-1 | topo | INV-1"), new Set(), false],
  ];
  let ok = true;
  for (const [label, text, allow, expectPass] of cases) {
    const { errors } = compareDocs(base, parseDoc(text), { allowFences: allow });
    const passed = errors.length === 0;
    if (passed === expectPass) {
      console.log(`OK: self-test — ${label}`);
    } else {
      console.error(`FALHOU: self-test — ${label} (esperava ${expectPass ? "passar" : "falhar"}; erros: ${errors.join(" | ") || "nenhum"})`);
      ok = false;
    }
  }
  return ok ? 0 : 1;
}

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  const files = [];
  let ref = "main";
  const allowFences = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--against") ref = argv[++i];
    else if (a === "--allow-fences") for (const n of argv[++i].split(",")) allowFences.add(Number(n));
    else if (a.startsWith("-")) { console.error(`flag desconhecida: ${a}`); return 1; }
    else files.push(a);
  }
  if (files.length === 0) { console.error("uso: check-translation.mjs <arquivo> [--against <ref>] [--allow-fences 1,3] | --self-test"); return 1; }
  if (files.length > 1 && allowFences.size > 0) { console.error("--allow-fences só vale com arquivo único"); return 1; }
  let ok = true;
  for (const f of files) ok = report(f, checkFile(f, ref, allowFences)) && ok;
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  process.exit(main(process.argv.slice(2)));
}
