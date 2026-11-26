import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SPECS_DIR, archivedEntries, locate, slugs } from "../../src/sdd/artifacts.js";

const RAIZ_DO_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// `specs/` e gitignored neste projeto: em CI e em clone novo a pasta nao existe. Um teste que a
// leia tem de tolerar a ausencia DECLARANDO-A, nunca em silencio — e quem chama ainda deve usar
// `t.skip()`, para o runner dizer "skipped" em vez de "pass". Extraido em 2026-10-02 porque as
// mesmas 9 linhas estavam copiadas em dois arquivos de teste (`QUAL-6`), e a familia seguinte
// criaria a terceira copia.
export const fontePresente = (caminho) => {
  const existe = existsSync(caminho);
  if (!existe) {
    console.error(
      `[declarado] ${caminho} ausente (specs/ e gitignored): este caso NAO foi conferido nesta execucao`,
    );
  }
  return existe;
};

// Uma fatia ativa vence; senão, a única arquivada com o mesmo slug. Duas arquivadas com o mesmo
// slug são ambiguidade e lançam, para o teste não ler a fatia errada em silêncio.
export const caminhoDaFatia = (slug, raiz = RAIZ_DO_REPO) => {
  const onde = locate(raiz, slug);
  if (onde.state !== "archived") return path.join(raiz, SPECS_DIR, slug);
  if (onde.paths.length > 1) {
    throw new Error(`ha mais de um arquivado com o slug "${slug}": ${onde.paths.join(", ")}`);
  }
  return path.join(raiz, onde.paths[0]);
};

export const pastasDasFatias = (raiz = RAIZ_DO_REPO) => [
  ...slugs(raiz).map((slug) => path.join(raiz, SPECS_DIR, slug)),
  ...archivedEntries(raiz).map((entrada) => path.join(raiz, entrada.path)),
];
