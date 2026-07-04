// Localiza os recursos bundlados do MGR (skills, constituição, templates, scripts) e
// centraliza constantes configuráveis. Funciona rodando do repo ou instalado via npm/npx.
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Raiz do pacote = um nível acima de src/.
const PKG_ROOT = fileURLToPath(new URL("../", import.meta.url));

// Nome da pasta de runtime criada no projeto. Configurável aqui (ou via --runtime-dir).
// Default `_mgr` (visível, espelha o `.bmad-core/` do BMAD v4 (escolha do Mauri).
// ferramentas). Para usar ".mgr-core", basta trocar esta linha.
export const RUNTIME_DIR_NAME = ".mgr-core";

export function pkgDir(name) {
  const p = path.join(PKG_ROOT, name);
  if (!existsSync(p)) {
    throw new Error(`recurso do MGR ausente: ${name} (esperado em ${p})`);
  }
  return p;
}

export const skillsDir = () => pkgDir("skills");
export const sharedDir = () => pkgDir("shared");

export function skillNames() {
  const base = skillsDir();
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(base, d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort();
}

export function readVersion() {
  const pj = path.join(PKG_ROOT, "package.json");
  return JSON.parse(readFileSync(pj, "utf8")).version;
}
