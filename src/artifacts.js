// Descoberta dos artefatos de spec em disco, compartilhada pelos validadores (ADR-0012, ADR-0013).
//
// Existe porque `planFiles` e `specFiles` eram o mesmo corpo com um nome de arquivo diferente, e
// `SPECS_DIR` estava declarado duas vezes. Espelhar o papel do outro validador é o desenho; copiar
// o código não era necessário para isso.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export const SPECS_DIR = "specs";

// Um arquivo por slug, ou de todos os slugs. Nunca inventa caminho: só devolve o que existe.
export function artifactFiles(repo, slug, nomeDoArquivo) {
  const raiz = path.join(repo, SPECS_DIR);
  if (!existsSync(raiz)) return [];
  const slugs = slug
    ? [slug]
    : readdirSync(raiz, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  return slugs.map((nome) => path.join(raiz, nome, nomeDoArquivo)).filter(existsSync);
}
