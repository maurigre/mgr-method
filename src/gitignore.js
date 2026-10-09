// Bloco que o MGR gerencia no `.gitignore` do USUÁRIO (DT-4, D-6). Ele protege as duas camadas
// pessoais da config (`config.local.json` e `.env`) para que não vazem para o repositório do time.
//
// Fica FORA do fecho do runtime: só a borda (`bin/mgr.js`) o importa, e a borda não faz `fs` direto
// (INV-4). Por isso este módulo lê e escreve o arquivo, mas nenhum comando do runtime o alcança.
//
// A marca de posse são as DUAS linhas de borda. Tudo o que está fora do bloco é preservado byte a
// byte: a escrita troca só as linhas do bloco, e a remoção tira só essas linhas.
//
// LIMITE DECLARADO: o aviso de config do time ignorada considera só as linhas LITERAIS listadas em
// `TEAM_IGNORED_LINES`. Padrões glob e negação (`!`) não são avaliados, porque avaliá-los seria
// reimplementar o git. A ausência do aviso não atesta que a config viaja.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const GITIGNORE_BLOCK = Object.freeze([
  "# >>> mgr-method (managed block: mgr uninstall removes it) >>>",
  ".mgr-core/config.local.json",
  ".mgr-core/.env",
  "# <<< mgr-method <<<",
]);

export const PERSONAL_LINES = Object.freeze([".mgr-core/config.local.json", ".mgr-core/.env"]);

const BLOCK_START = GITIGNORE_BLOCK[0];
const BLOCK_END = GITIGNORE_BLOCK[GITIGNORE_BLOCK.length - 1];

// Linhas literais que tornam a config do time ignorada pelo git (DT-4).
const TEAM_IGNORED_LINES = [".mgr-core", ".mgr-core/", "/.mgr-core", "/.mgr-core/", ".mgr-core/config.json"];

const arquivo = (repo) => path.join(repo, ".gitignore");

// CRLF não muda a comparação: a marca é reconhecida com ou sem o `\r` do fim da linha.
const semCr = (linha) => linha.replace(/\r$/, "");

// Posição do bloco nas linhas, ou null. Bloco aberto e sem fecho é recusado: acrescentar outro
// bloco por cima dele duplicaria a marca, e remover às cegas apagaria linhas que não são do MGR.
const localizarBloco = (linhas, file) => {
  const start = linhas.findIndex((linha) => semCr(linha) === BLOCK_START);
  if (start === -1) return null;
  const end = linhas.findIndex((linha, i) => i > start && semCr(linha) === BLOCK_END);
  if (end === -1) {
    throw new Error(`bloco do mgr-method sem linha de fecho em ${file}; corrija o arquivo à mão`);
  }
  return { start, end };
};

const lerTexto = (file) => (existsSync(file) ? readFileSync(file, "utf8") : null);

// O bloco novo usa o fim de linha que o arquivo já usa, e as linhas vizinhas são copiadas como estão
// (com o `\r` delas, se houver): é isso que mantém o resto do arquivo byte a byte.
const eolDe = (texto) => (texto.includes("\r\n") ? "\r\n" : "\n");
const antesDoBloco = (linhas, start) => linhas.slice(0, start).map((linha) => linha + "\n").join("");
const depoisDoBloco = (linhas, end) => linhas.slice(end + 1).join("\n");
// Terminador da linha de fecho, que o bloco substituído carregava. Só existe se há conteúdo depois.
const terminadorDoFecho = (linhas, end) => (linhas[end].endsWith("\r") ? "\r\n" : "\n");

/**
 * Estado do `.gitignore` do repositório, para a borda ANUNCIAR antes de gravar:
 * `no-file` (não existe), `present` (bloco do MGR já está lá) ou `absent` (existe, sem o bloco).
 * `teamIgnoredLines` lista as linhas literais que ignoram a config do time.
 */
export function planGitignore(repo) {
  const file = arquivo(repo);
  const texto = lerTexto(file);
  if (texto === null) return { file, state: "no-file", teamIgnoredLines: [] };

  const linhas = texto.split("\n");
  const state = localizarBloco(linhas, file) ? "present" : "absent";
  const teamIgnoredLines = linhas.map(semCr).filter((linha) => TEAM_IGNORED_LINES.includes(linha));
  return { file, state, teamIgnoredLines };
}

// Idempotente: troca o bloco no lugar, ou acrescenta ao fim. Sem bloco e sem arquivo, cria o arquivo.
export function writeGitignoreBlock(repo) {
  const file = arquivo(repo);
  const texto = lerTexto(file) ?? "";

  const eol = eolDe(texto);
  const bloco = GITIGNORE_BLOCK.join(eol);
  const linhas = texto.split("\n");
  const posicao = localizarBloco(linhas, file);
  let atualizado;
  if (posicao) {
    const { start, end } = posicao;
    const temDepois = end + 1 < linhas.length;
    atualizado = antesDoBloco(linhas, start) + bloco
      + (temDepois ? terminadorDoFecho(linhas, end) + depoisDoBloco(linhas, end) : "");
  } else if (texto === "") {
    atualizado = bloco + eol;
  } else {
    // Arquivo sem quebra final ganha a quebra antes do bloco; o resto do conteúdo fica como estava.
    const separador = texto.endsWith("\n") ? "" : eol;
    atualizado = texto + separador + bloco + eol;
  }

  if (atualizado !== texto) writeFileSync(file, atualizado, "utf8");
  return file;
}

// Remove só o bloco. Se o arquivo ficar só com espaço em branco, apaga o arquivo: foi o MGR que o
// criou, e é o mesmo critério do `removeHook`. Devolve `{ outcome, file }`: `removed` (bloco tirado),
// `absent` (arquivo sem o bloco, intocado) ou `no-file` (não há `.gitignore`).
export function removeGitignoreBlock(repo) {
  const file = arquivo(repo);
  const texto = lerTexto(file);
  if (texto === null) return { outcome: "no-file", file };

  const linhas = texto.split("\n");
  const posicao = localizarBloco(linhas, file);
  if (!posicao) return { outcome: "absent", file };

  const restante = antesDoBloco(linhas, posicao.start) + depoisDoBloco(linhas, posicao.end);
  if (restante.trim() === "") {
    rmSync(file, { force: true });
    return { outcome: "removed", file };
  }
  writeFileSync(file, restante, "utf8");
  return { outcome: "removed", file };
}
