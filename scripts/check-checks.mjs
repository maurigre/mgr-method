#!/usr/bin/env node
// Verificador da coerencia entre o registro de verificacoes do codigo e as tabelas da documentacao.
// Ferramenta de desenvolvimento do repo — fora do tarball npm, como o check-laws.mjs.
//
// Uso:
//   node scripts/check-checks.mjs [--repo <dir>]
//   node scripts/check-checks.mjs --self-test
//
// Verifica o que e ESTRUTURAL, e so isso:
//   CHK-1  ID no codigo ausente da tabela de um documento
//   CHK-2  linha na tabela de um documento sem verificacao correspondente no codigo
//   CHK-3  cabecalho da tabela nao encontrado em um documento
//
// A analise e ESTRUTURAL (regex sobre a forma da linha de tabela), nunca busca de substring em prosa.
// Um documento que enumere verificacoes e nao seja registrado aqui nao e visto pelo guarda.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Registro de ids do codigo. Fonte unica.
import { CHECKS } from "../src/doctor.js";

// Documentos que declaram a enumeracao de verificacoes. Lista fechada, e EXPORTADA: o teste
// consome esta mesma lista em vez de declarar a sua, porque duas copias divergiriam na primeira
// mudanca — foi o que aconteceu na primeira versao deste arquivo.
//
// `versionado: false` marca documento que NAO esta no repositorio git (o `docs/sdd/` deste projeto e
// gitignored por decisao registrada). Ele e conferido quando existe e PULADO COM AVISO quando nao —
// nunca em silencio. Medido em 2026-09-24: sem esta distincao o guarda falharia em toda execucao de
// CI, onde `docs/sdd/` nao existe, e eu so nao vi porque validei localmente.
export const DOCUMENTS = [
  {
    path: "docs/sdd/03-contracts.md",
    header: "| Verificação | Severidade | Compara | Remediação |",
    versionado: false,
  },
  {
    path: "README.md",
    header: "| id | Compares |",
  },
  {
    path: "README.pt-BR.md",
    header: "| id | Compara |",
  },
];

// Regex que extrai o id da primeira coluna de uma linha de tabela markdown.
// A forma esperada e: | `id-string` | outros | valores |
const ID_PATTERN = /^\| `([a-z-]+)` \|/;

// Funcoes puras: recebem o que ja foi lido, devolvem problemas. Sem IO, sem process.exit.

/**
 * Extrai ids de uma tabela em um texto.
 * Retorna { ids, headerFound } onde ids e um conjunto e headerFound e booleano.
 */
export function extractIds(text, expectedHeader) {
  const linhas = text.split("\n");
  const headerIndex = linhas.findIndex((linha) => linha === expectedHeader);

  if (headerIndex === -1) {
    return { ids: new Set(), headerFound: false };
  }

  const ids = new Set();
  // Comeca da linha apos o cabecalho e os separadores
  for (let i = headerIndex + 2; i < linhas.length; i++) {
    const linha = linhas[i];
    if (linha.trim() === "") break; // Para na primeira linha vazia apos a tabela
    if (linha.startsWith("|")) {
      const match = linha.match(ID_PATTERN);
      if (match) {
        ids.add(match[1]);
      }
    } else {
      break; // Para quando nao e mais tabela
    }
  }

  return { ids, headerFound: true };
}

/**
 * Compara o conjunto de ids do codigo contra os ids extraidos de cada documento.
 * Retorna um array de problemas encontrados.
 */
export function checkConsistency(codeIds, documentResults) {
  const problems = [];

  for (const { path: docPath, ids, headerFound } of documentResults) {
    if (!headerFound) {
      problems.push(`CHK-3 ${docPath}: expected header not found`);
      continue;
    }

    // CHK-1: ids no codigo que nao estao no documento
    for (const id of codeIds) {
      if (!ids.has(id)) {
        problems.push(`CHK-1 ${docPath}: missing id '${id}'`);
      }
    }

    // CHK-2: ids no documento que nao estao no codigo
    for (const id of ids) {
      if (!codeIds.has(id)) {
        problems.push(`CHK-2 ${docPath}: extra id '${id}'`);
      }
    }
  }

  return problems;
}

function selfTest() {
  // Amostra valida: codigo e documentos com os mesmos ids
  const codeIds = new Set(["check-one", "check-two"]);
  const validDoc = `
| id | Compares |
|---|---|
| \`check-one\` | something |
| \`check-two\` | something else |
`.trim();

  const validResults = [
    { path: "README.md", ...extractIds(validDoc, "| id | Compares |") },
  ];
  const validProblems = checkConsistency(codeIds, validResults);
  if (validProblems.length) {
    console.error(`self-test FALHOU: amostra VALIDA acusada — ${validProblems.join("; ")}`);
    return 1;
  }

  // Amostra defeituosa
  const defectDoc1 = `
| id | Compares |
|---|---|
| \`check-one\` | something |
| \`check-three\` | extra |
`.trim();

  const defectDoc2 = `
| id | Compares |
no header found
`.trim();

  const defectResults = [
    { path: "file1.md", ...extractIds(defectDoc1, "| id | Compares |") },
    { path: "file2.md", ...extractIds(defectDoc2, "| id | Compares |") },
  ];
  const defectProblems = checkConsistency(codeIds, defectResults);

  const esperados = ["CHK-1", "CHK-2", "CHK-3"];
  const faltando = esperados.filter((code) => !defectProblems.some((problem) => problem.startsWith(code)));
  if (faltando.length) {
    console.error(`self-test FALHOU: regras que nao dispararam: ${faltando.join(", ")}`);
    return 1;
  }

  console.log(`self-test OK — ${defectProblems.length} problemas detectados na amostra defeituosa`);
  return 0;
}

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();

  const repoArg = argv.indexOf("--repo");
  const repo = repoArg === -1 ? process.cwd() : argv[repoArg + 1];

  // Conjunto de ids do codigo
  const codeIds = new Set(CHECKS.map((check) => check.id));

  // Lê e extrai ids de cada documento
  const documentResults = [];
  for (const doc of DOCUMENTS) {
    const fullPath = path.join(repo, doc.path);
    if (!existsSync(fullPath)) {
      // Ausencia de documento NAO versionado e estado legitimo (CI), e sai ANUNCIADA. Ausencia de
      // documento versionado e defeito: alguem apagou o que devia estar la.
      if (doc.versionado === false) {
        console.log(`check-checks: ${doc.path} ausente e nao versionado — pulado, NAO conferido`);
        continue;
      }
      console.error(`erro: documento versionado nao encontrado: ${fullPath}`);
      return 1;
    }
    const text = readFileSync(fullPath, "utf8");
    const result = extractIds(text, doc.header);
    documentResults.push({
      path: doc.path,
      ...result,
    });
  }

  // Verifica consistencia
  const problems = checkConsistency(codeIds, documentResults);

  if (problems.length) {
    console.error(`check-checks: ${problems.length} problema(s)`);
    for (const problem of problems) console.error(`  ${problem}`);
    return 1;
  }

  // `documentResults.length`, e nao `DOCUMENTS.length`: documento pulado por nao ser versionado nao
  // foi conferido, e dizer que foi seria a afirmacao falsa que este guarda existe para pegar.
  console.log(`check-checks OK — ${codeIds.size} ids no codigo, ${documentResults.length} documento(s) conferido(s)`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("check-checks.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
