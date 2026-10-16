// Bloco que o MGR gerencia no `.gitignore` do USUÁRIO (DT-4, D-6). Ele protege as duas camadas
// pessoais da config (`config.local.json` e `.env`) para que não vazem para o repositório do time.
//
// A mecânica do bloco mora em `managed-block.js`; aqui ficam só o conteúdo e o caminho do `.gitignore`.
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
import path from "node:path";
import { inspectBlock, removeBlock, writeBlock } from "./managed-block.js";

export const GITIGNORE_BLOCK = Object.freeze([
  "# >>> mgr-method (managed block: mgr uninstall removes it) >>>",
  ".mgr-core/config.local.json",
  ".mgr-core/.env",
  "# <<< mgr-method <<<",
]);

export const PERSONAL_LINES = Object.freeze([".mgr-core/config.local.json", ".mgr-core/.env"]);

// Linhas literais que tornam a config do time ignorada pelo git (DT-4).
const TEAM_IGNORED_LINES = [".mgr-core", ".mgr-core/", "/.mgr-core", "/.mgr-core/", ".mgr-core/config.json"];

const arquivo = (repo) => path.join(repo, ".gitignore");

/**
 * Estado do `.gitignore` do repositório, para a borda ANUNCIAR antes de gravar:
 * `no-file` (não existe), `present` (bloco do MGR já está lá) ou `absent` (existe, sem o bloco).
 * `teamIgnoredLines` lista as linhas literais que ignoram a config do time.
 */
export function planGitignore(repo) {
  const file = arquivo(repo);
  const { state: estado, lines } = inspectBlock(file, GITIGNORE_BLOCK);
  if (estado === "no-file") return { file, state: "no-file", teamIgnoredLines: [] };

  const state = estado === "absent" ? "absent" : "present";
  const teamIgnoredLines = lines.filter((linha) => TEAM_IGNORED_LINES.includes(linha));
  return { file, state, teamIgnoredLines };
}

// Idempotente: troca o bloco no lugar, ou acrescenta ao fim. Sem bloco e sem arquivo, cria o arquivo.
export function writeGitignoreBlock(repo) {
  return writeBlock(arquivo(repo), GITIGNORE_BLOCK);
}

// Remove só o bloco. Devolve `{ outcome, file }`: `removed`, `absent` ou `no-file`.
export function removeGitignoreBlock(repo) {
  return removeBlock(arquivo(repo), GITIGNORE_BLOCK);
}
