#!/usr/bin/env node
// Reproduz a condicao do CI num comando (feature leis-de-verificacao, task P1.5).
// Ferramenta de desenvolvimento do repo — fora do tarball npm.
//
// POR QUE ELE EXISTE, e e um erro real medido: duas vezes nesta serie o CI reprovou algo que passava
// na maquina. Nas duas o motivo foi o ambiente, nao o codigo:
//   1. dez testes liam a instalacao de dogfooding do repo (`.claude/`, `.mgr-core/`), que e
//      gitignored e NAO existe no checkout do CI;
//   2. uma fixture herdava o idioma do ambiente, e o runner nao tem locale pt_BR.
// E na segunda vez a conferencia manual nao pegou porque eu a rodei COM o locale desta maquina, e
// depois nao a repeti apos mudar codigo. Virou comando para deixar de depender de eu lembrar.
//
// O QUE ELE NAO FAZ: nao substitui o CI. Ele reproduz duas condicoes — arvore sem os arquivos
// gitignored e locale neutro — e nao reproduz sistema operacional, versao de Node nem rede do
// runner. Verde aqui NAO prova verde la; vermelho aqui prova vermelho la.

import { execFileSync, execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const RAIZ = process.cwd();

// Locale neutro e sem LANG: e a condicao do runner, e foi o que a conferencia manual nao reproduziu.
const AMBIENTE_NEUTRO = () => {
  const env = { ...process.env, LC_ALL: "C" };
  delete env.LANG;
  delete env.LANGUAGE;
  return env;
};

/** Arquivos versionaveis ainda nao commitados: eles precisam ir para a arvore limpa. */
export function pendentes(raiz = RAIZ) {
  // LOG-2: par de logs em volta do subprocesso.
  console.log("  lendo os arquivos pendentes (git status)");
  const saida = execSync("git status --porcelain", { cwd: raiz, encoding: "utf8" });
  console.log(`  lidos: ${saida.split("\n").filter(Boolean).length} caminho(s) em stage ou modificados`);
  return saida
    .split("\n")
    .map((linha) => linha.slice(3).trim())
    .filter(Boolean)
    .filter((relativo) => existsSync(path.join(raiz, relativo)));
}

// Remove a arvore e nunca lanca: ela roda no `finally` e no caminho de erro, e uma excecao aqui
// substituiria o motivo real da falha pelo problema da limpeza.
function removeArvore(destino) {
  console.log(`  removendo a arvore ${destino}`);
  try {
    execFileSync("git", ["worktree", "remove", "--force", destino], { cwd: RAIZ });
    console.log("  arvore removida");
  } catch (erro) {
    console.error(`  AVISO: a arvore ${destino} ficou em disco (${erro.message}). Rode: git worktree prune`);
  }
}

// A arvore e criada DENTRO do try de quem chama? Nao: ela e criada aqui, e por isso a limpeza do
// caminho de erro tambem e daqui. Sem isso, uma falha entre o `worktree add` e o `return` deixava
// arvore registrada em `.git/worktrees` e diretorio temporario orfaos.
function montaArvore() {
  const destino = mkdtempSync(path.join(os.tmpdir(), "mgr-limpo-"));
  console.log(`  criando a arvore em ${destino}`);
  execFileSync("git", ["worktree", "add", "-q", "--detach", destino, "HEAD"], { cwd: RAIZ });
  console.log("  arvore criada no HEAD");
  try {
    const copiados = pendentes();
    console.log(`  copiando ${copiados.length} arquivo(s) pendente(s) para a arvore`);
    for (const relativo of copiados) {
      mkdirSync(path.dirname(path.join(destino, relativo)), { recursive: true });
      cpSync(path.join(RAIZ, relativo), path.join(destino, relativo), { recursive: true });
    }
    console.log("  copia concluida; ligando node_modules");
    symlinkSync(path.join(RAIZ, "node_modules"), path.join(destino, "node_modules"), "dir");
    console.log("  node_modules ligado");
  } catch (erro) {
    removeArvore(destino);
    throw erro;
  }
  return destino;
}

const PASSOS = [
  ["npm test", ["npm", "test"]],
  ["npm run check:laws", ["npm", "run", "check:laws"]],
  ["npm run check:claims", ["npm", "run", "check:claims"]],
  ["npx eslint .", ["npx", "eslint", "."]],
];

function main() {
  const arvore = montaArvore();
  const gitignorados = [".claude", ".mgr-core"].filter((d) => existsSync(path.join(arvore, d)));
  const falhas = [];

  try {
    console.log(`arvore limpa em ${arvore}`);
    console.log(`  gitignorados presentes: ${gitignorados.length ? gitignorados.join(", ") : "nenhum (e a condicao do CI)"}`);
    console.log("  ambiente: LC_ALL=C, sem LANG e sem LANGUAGE");
    console.log("");

    for (const [rotulo, comando] of PASSOS) {
      // O codigo de saida vem do PROCESSO, nunca depois de um pipe: `cmd | tail` faz `$?` ser do
      // tail, e isso ja mascarou lint quebrado numa sessao inteira.
      let codigo = 0;
      console.log(`  rodando ${rotulo}`);
      try {
        execFileSync(comando[0], comando.slice(1), { cwd: arvore, env: AMBIENTE_NEUTRO(), stdio: "pipe" });
      } catch (erro) {
        codigo = erro.status ?? 1;
        falhas.push([rotulo, `${erro.stdout ?? ""}${erro.stderr ?? ""}`]);
      }
      console.log(`  ${codigo === 0 ? "ok  " : "FALHOU"} ${rotulo} (exit ${codigo})`);
    }
  } finally {
    removeArvore(arvore);
  }

  console.log("");
  if (falhas.length) {
    for (const [rotulo, saida] of falhas) {
      console.error(`--- ${rotulo} ---`);
      console.error(saida.split("\n").slice(-30).join("\n"));
    }
    console.error(`check-clean: ${falhas.length} passo(s) falharam em ambiente limpo`);
    console.error("Isto reproduz o CI em duas condicoes. Vermelho aqui e vermelho la.");
    return 1;
  }
  console.log("check-clean OK — os quatro passos passam sem os gitignorados e com locale neutro");
  console.log("Isto NAO prova verde no CI: sistema, versao de Node e rede do runner nao sao reproduzidos.");
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("check-clean.mjs")) {
  process.exit(main());
}

export { montaArvore };
