// Descoberta dos artefatos de spec em disco, compartilhada pelos validadores (ADR-0012, ADR-0013).
//
// Existe porque `planFiles` e `specFiles` eram o mesmo corpo com um nome de arquivo diferente, e
// `SPECS_DIR` estava declarado duas vezes. Espelhar o papel do outro validador é o desenho; copiar
// o código não era necessário para isso.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export const SPECS_DIR = "specs";

// A raiz do repositório, subindo a partir de um diretório qualquer.
//
// Existe porque os comandos `spec` tratavam `path.resolve(".")` como raiz: rodados de dentro de
// `specs/<slug>/`, procuravam artefato em `specs/<slug>/specs` e não achavam nada. O `slugFromCwd`
// nunca devolvia slug pela CLI, porque recebia `repo === cwd` e a relativização dava sempre `..`.
//
// A subida PARA na fronteira do projeto — diretório com `.git` ou `package.json` — para nunca
// atravessar para um repositório de cima e responder sobre as specs de outra pessoa. Sem `specs/`
// no caminho, devolve o ponto de partida, que é o comportamento de hoje e a mensagem de hoje.
export function repoRoot(partida) {
  let atual = path.resolve(partida);
  for (;;) {
    if (existsSync(path.join(atual, SPECS_DIR))) return atual;
    if (existsSync(path.join(atual, ".git")) || existsSync(path.join(atual, "package.json"))) break;
    const pai = path.dirname(atual);
    if (pai === atual) break;
    atual = pai;
  }
  return path.resolve(partida);
}

// Os slugs que existem em disco, em ordem estável. Vazio quando `specs/` não existe — quem chama
// decide o que fazer, em vez de receber uma exceção por algo que é ausência legítima (DES-1).
//
// Fonte ÚNICA da listagem: o `artifactFiles` abaixo consome esta função em vez de repetir o
// `readdirSync`. Duplicar descoberta foi reprovação do gate isolado na fatia 2, e este módulo
// nasceu justamente daquela reprovação.
export function slugs(repo) {
  const raiz = path.join(repo, SPECS_DIR);
  if (!existsSync(raiz)) return [];
  return readdirSync(raiz, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => entrada.name)
    .sort();
}

// Um arquivo por slug, ou de todos os slugs. Nunca inventa caminho: só devolve o que existe.
export function artifactFiles(repo, slug, nomeDoArquivo) {
  const nomes = slug ? [slug] : slugs(repo);
  return nomes.map((nome) => path.join(repo, SPECS_DIR, nome, nomeDoArquivo)).filter(existsSync);
}
