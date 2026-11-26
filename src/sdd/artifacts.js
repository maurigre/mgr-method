// Descoberta dos artefatos de spec em disco, compartilhada pelos validadores (ADR-0012, ADR-0013).
//
// Existe porque `planFiles` e `specFiles` eram o mesmo corpo com um nome de arquivo diferente, e
// `SPECS_DIR` estava declarado duas vezes. Espelhar o papel do outro validador é o desenho; copiar
// o código não era necessário para isso.
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const SPECS_DIR = "specs";
export const ARCHIVE_DIR = "archive";

const NOME_ARQUIVADO = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

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
    // specs/archive/ guarda as fatias arquivadas e nunca é feature.
    .filter((nome) => nome !== ARCHIVE_DIR)
    .sort();
}

// Um arquivo por slug, ou de todos os slugs. Nunca inventa caminho: só devolve o que existe.
export function artifactFiles(repo, slug, nomeDoArquivo) {
  const nomes = slug ? [slug] : slugs(repo);
  return nomes.map((nome) => path.join(repo, SPECS_DIR, nome, nomeDoArquivo)).filter(existsSync);
}

// As fatias em specs/archive/, uma entrada por subpasta. A entrada é discriminada por `recognized`
// (DES-1, sem `null` como sentinela): reconhecida carrega `date` e `slug`; fora do padrão
// AAAA-MM-DD-<slug> carrega só `name` e `path`, e NÃO some, porque a listagem mostra exatamente o que
// está no archive. Sem a pasta, ou com `specs/archive` que não é diretório, devolve vazio sem lançar.
export function archivedEntries(repo) {
  const raiz = path.join(repo, SPECS_DIR, ARCHIVE_DIR);
  if (!existsSync(raiz) || !statSync(raiz).isDirectory()) return [];
  return readdirSync(raiz, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => {
      const base = { name: entrada.name, path: path.join(SPECS_DIR, ARCHIVE_DIR, entrada.name) };
      const casou = NOME_ARQUIVADO.exec(entrada.name);
      return casou ? { ...base, recognized: true, date: casou[1], slug: casou[2] } : { ...base, recognized: false };
    })
    .sort(ordemDeArquivada);
}

// Reconhecidos por data decrescente e slug crescente; os fora do padrão no fim, por nome.
function ordemDeArquivada(primeira, segunda) {
  if (!primeira.recognized || !segunda.recognized) {
    if (primeira.recognized) return -1;
    if (segunda.recognized) return 1;
    return comparaTexto(primeira.name, segunda.name);
  }
  return comparaTexto(segunda.date, primeira.date) || comparaTexto(primeira.slug, segunda.slug);
}

function comparaTexto(esquerda, direita) {
  if (esquerda === direita) return 0;
  return esquerda < direita ? -1 : 1;
}

// Onde um slug vive. `reserved` é o nome do próprio archive; ativa vence arquivada.
export function locate(repo, slug) {
  if (slug === ARCHIVE_DIR) return { state: "reserved" };
  if (slugs(repo).includes(slug)) return { state: "active" };
  const paths = archivedEntries(repo)
    .filter((entrada) => entrada.recognized && entrada.slug === slug)
    .map((entrada) => entrada.path);
  if (paths.length > 0) return { state: "archived", paths };
  return { state: "absent" };
}
