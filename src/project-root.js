// Raiz do projeto para o runtime e para a CLI (DT-3, ADR-0023).
//
// O marcador é `.mgr-core/manifest.json`, escrito só pelo install e pelo update (DT-2). A subida
// não para em `.git` nem em `package.json`: num monorepo, o pacote interno não é a raiz.
// O diretório home nunca conta como raiz, porque o escopo global grava `~/.mgr-core/manifest.json`.
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { RUNTIME_DIR_NAME } from "./bundle.js";
import { MANIFEST_NAME } from "./manifest.js";
import { repoRoot } from "./artifacts.js";

export function projectRoot(start, { home = os.homedir(), exists = existsSync } = {}) {
  const partida = path.resolve(start);
  const casa = path.resolve(home);
  let atual = partida;
  for (;;) {
    if (atual !== casa && exists(path.join(atual, RUNTIME_DIR_NAME, MANIFEST_NAME))) {
      return { root: atual, via: "marker" };
    }
    const pai = path.dirname(atual);
    if (pai === atual) break;
    atual = pai;
  }
  return { root: repoRoot(partida), via: "fallback" };
}
