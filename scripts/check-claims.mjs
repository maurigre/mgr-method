#!/usr/bin/env node
// Verificador de PADRAO de verificacao defeituosa (feature leis-de-verificacao, task P1.1).
// Ferramenta de desenvolvimento do repo — fora do tarball npm, como o check-laws.mjs.
//
// Uso:
//   node scripts/check-claims.mjs [--root <dir>]
//   node scripts/check-claims.mjs --self-test
//
// Verifica tres padroes, e cada um existe porque um erro REAL desta serie o produziu:
//   CLM-1  `\n` ou `\t` literal em markdown que vai para quem instala
//          -> vazou nos dois READMEs em 2026-09-20, e ficou dois commits no repo
//   CLM-2  codigo de saida lido DEPOIS de um pipe (`cmd | tail; echo $?`)
//          -> `$?` ali e o status do tail. Uma sessao inteira reportou lint verde sobre isso
//   CLM-3  faixa de caracteres com limite nao-ASCII, usada para achar letra acentuada
//          -> `[<acentuado>-<acentuado>]` casa o sinal de multiplicacao. Aconteceu DUAS vezes
//
// O QUE ELE NAO FAZ, e vem antes do que ele faz:
//   - Ele ve FORMA, nunca intencao. Nao sabe se a faixa era proposital, nem se o `\n` era literal
//     de proposito. Lista vazia significa "nenhum dos tres padroes apareceu", NUNCA "esta correto".
//   - A CLM-3 le o TEXTO DA FONTE. Uma faixa escrita por escape (\u00C0 em vez do caractere)
//     passa, porque na fonte ela e ASCII. Limite conhecido: quem escreve por escape sabe o que
//     faz; quem cola o caractere e quem erra, e foi assim nas duas vezes.
//   - A CLM-2 exige o `;` e o `$?` na MESMA linha. `cmd | tail` com `RC=$?` na linha seguinte
//     passa. Falso negativo declarado: o padrao medido foi o de uma linha.
//   - A CLM-3 nao atravessa quebra de linha, e limita a 20 caracteres antes da faixa. Classe longa
//     ou quebrada em duas linhas passa. Preferido a alternativa: casar o texto sem casar linha
//     nenhuma fazia a mensagem sair com `arquivo:0`, uma linha que nao existe.
//   - Arquivo acima de 2 MB e pulado, e a contagem da mensagem de sucesso nao desconta o pulado.
//   - Ele NAO julga se uma afirmacao de cobertura e verdadeira. Isso nao e parsing, e ficou como
//     lei (grupo L2) em vez de virar check que prometeria o que nao entrega.
//
// Este verificador e conveniencia: falha cedo, na maquina de quem escreve. O gate REAL e o CI,
// porque `--no-verify` contorna hook local e o CI nao. E a clausula do `.githooks/commit-msg`,
// escrita antes desta e repetida aqui de proposito.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// `\n` ou `\t` como DOIS caracteres — a barra seguida da letra — e nao o caractere de controle.
const ESCAPE_LITERAL = /\\[nt]/;

// Pipe e, no mesmo comando, leitura de `$?`. O status e do ULTIMO processo do pipe.
const SAIDA_APOS_PIPE = /\|[^|\n]*;[^\n]{0,20}\$\?/;

// Faixa em que QUALQUER um dos limites e caractere nao-ASCII. Cobre as duas formas do erro:
// limite inferior acentuado e limite superior acentuado.
const NAO_ASCII = "\\u0080-\\u024F";
const FAIXA_NAO_ASCII = new RegExp(
  `\\[[^\\]\\n]{0,20}(?:[${NAO_ASCII}][ \\t]*-|-[ \\t]*[${NAO_ASCII}])[^\\]\\n]{0,20}\\]`,
);

const MARKDOWN_DISTRIBUIDO = ["shared", "skills", "agents"];
const CODIGO = [".js", ".mjs", ".cjs", ".sh"];

/** Um markdown que chega a quem instala, ou que e a vitrine do pacote. */
export const ehMarkdownDistribuido = (relativo) =>
  (relativo.endsWith(".md") && MARKDOWN_DISTRIBUIDO.includes(relativo.split(path.sep)[0]))
  || /^README(\.[\w-]+)?\.md$/.test(relativo);

/** Script de shell, onde `$?` depois de pipe engana. */
export const ehShell = (relativo) => relativo.endsWith(".sh") || relativo.startsWith(`.githooks${path.sep}`);

export const ehCodigo = (relativo) => CODIGO.includes(path.extname(relativo)) || ehShell(relativo);

/**
 * Regras puras: recebem o texto ja lido, devolvem problemas. Sem IO, sem process.exit.
 *
 * Devolve UM achado por arquivo e por padrao, com a primeira linha — contar produziria numero
 * inflado quando o mesmo padrao aparece varias vezes pela mesma causa.
 */
export function checkText(relativo, text) {
  const problems = [];
  const linhas = text.split("\n");
  const primeira = (padrao) => linhas.findIndex((linha) => padrao.test(linha)) + 1;

  if (ehMarkdownDistribuido(relativo) && ESCAPE_LITERAL.test(text)) {
    problems.push(`CLM-1 ${relativo}:${primeira(ESCAPE_LITERAL)}: literal \\n or \\t in distributed markdown`);
  }
  if (ehShell(relativo) && SAIDA_APOS_PIPE.test(text)) {
    problems.push(`CLM-2 ${relativo}:${primeira(SAIDA_APOS_PIPE)}: exit code read after a pipe reads the last process, not the one you mean`);
  }
  if (ehCodigo(relativo) && FAIXA_NAO_ASCII.test(text)) {
    problems.push(`CLM-3 ${relativo}:${primeira(FAIXA_NAO_ASCII)}: character range with a non-ASCII bound — enumerate the letters instead`);
  }
  return problems;
}

const IGNORADOS = new Set(["node_modules", ".git", "dist", "coverage", "lcov.info", "specs", "exemplos"]);

/** Caminhos relativos de todo arquivo sob `root`, pulando o que nao e fonte deste repo. */
export function sourceFiles(root, prefixo = "") {
  const arquivos = [];
  for (const entrada of readdirSync(path.join(root, prefixo), { withFileTypes: true })) {
    if (IGNORADOS.has(entrada.name)) continue;
    const relativo = path.join(prefixo, entrada.name);
    if (entrada.isDirectory()) arquivos.push(...sourceFiles(root, relativo));
    else if (ehMarkdownDistribuido(relativo) || ehCodigo(relativo)) arquivos.push(relativo);
  }
  return arquivos;
}

export function checkTree(root) {
  const problems = [];
  for (const relativo of sourceFiles(root)) {
    const completo = path.join(root, relativo);
    if (statSync(completo).size > 2_000_000) continue;
    problems.push(...checkText(relativo, readFileSync(completo, "utf8")));
  }
  return problems;
}

// O caso NEGATIVO de cada padrao vive aqui: um verificador testado so contra defeito prova que
// sabe falhar, nao que sabe passar. O positivo usa o ERRO REAL, nunca exemplo inventado.
function selfTest() {
  const casos = [
    ["README.md", "linha ok |", 0],
    ["README.md", "tabela |\\n", 1],
    [".githooks/pre-commit", "npm test | tail -1; echo $?", 1],
    [".githooks/pre-commit", "npm test > out.txt; echo $?", 0],
    ["src/x.js", "const OK = /[a-z0-9.-]+/;", 0],
    ["src/x.js", `const R = /[${String.fromCharCode(0xC0)}-${String.fromCharCode(0xFF)}]/;`, 1],
    ["src/x.js", `const E = /[a-z${String.fromCharCode(0xE1)}${String.fromCharCode(0xE9)}]/;`, 0],
    ["docs/x.md", "nao distribuido |\\n", 0],
  ];
  let falhas = 0;
  for (const [arquivo, texto, esperado] of casos) {
    const obtido = checkText(arquivo, texto).length;
    if (obtido !== esperado) {
      falhas += 1;
      console.error(`self-test: ${arquivo} esperava ${esperado} achado(s), obteve ${obtido} — ${texto}`);
    }
  }
  console.log(falhas ? `self-test: ${falhas} falha(s)` : `self-test OK — ${casos.length} casos, positivo e negativo de cada padrao`);
  return falhas ? 1 : 0;
}

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();

  const rootArg = argv.indexOf("--root");
  const root = rootArg === -1 ? process.cwd() : argv[rootArg + 1];
  const problems = checkTree(root);

  if (problems.length) {
    console.error(`check-claims: ${problems.length} problema(s)`);
    for (const problem of problems) console.error(`  ${problem}`);
    console.error("");
    console.error("Estes tres padroes vem de erros reais. Um achado NAO significa que o resto esta correto:");
    console.error("o verificador ve forma, nunca intencao.");
    return 1;
  }
  console.log(`check-claims OK — ${sourceFiles(root).length} arquivos, nenhum dos 3 padroes encontrado`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("check-claims.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
