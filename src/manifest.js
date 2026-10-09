// Config do projeto MGR, em `.mgr-core/` (leve, sem skills — só metadados):
//   manifest.json  fonte de verdade do que foi instalado (motores, skills, linguagem, arquitetura)
//   .env           MGR_PROJECT_ID=<id>, usado pela memória estendida (mgr-code)
// O campo `model` no manifesto distingue as gerações de instalação e habilita a migração:
//   "self-contained-layered-config" — atual (DT-16 da F2): config em duas camadas, sem migração pendente;
//   "self-contained-runtime"        — geração da F1: runtime dentro do motor, precisa só da migração de config;
//   "self-contained" e "runtime-launcher" — antigas: precisam das duas migrações.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { INSTALL_DIR_RE } from "./lockfile.js";

export const MANIFEST_NAME = "manifest.json";
export const ENV_NAME = ".env";

export const MODEL_RUNTIME = "self-contained-runtime";
export const MODEL_LAYERED = "self-contained-layered-config";

export const manifestPath = (dir) => path.join(dir, MANIFEST_NAME);

export function writeManifest(dir, data) {
  const manifest = {
    model: MODEL_LAYERED,
    installedAt: new Date().toISOString(),
    ...data,
  };
  mkdirSync(dir, { recursive: true });
  const dest = manifestPath(dir);
  writeFileSync(dest, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return dest;
}

// Ausência de manifesto é estado legítimo (projeto sem instalação) — devolve null, mesmo contrato
// do readLockfile. Forma inválida é erro explícito, nunca silencioso: o nome em `skills` é
// concatenado ao diretório do motor e removido com rmSync recursivo (src/installer.js:130-131 e
// :307-308), e até esta fatia o manifesto recebia a mesma classe de entrada do lockfile sem
// nenhuma validação. O `Array.isArray` não é zelo: com `skills` string, o `for...of` dos dois
// chamadores itera CARACTERES, e cada caractere passa no INSTALL_DIR_RE.
// Campo ausente continua sendo estado tolerado — os chamadores fazem `man.skills || []`.
export function readManifest(dir) {
  const p = manifestPath(dir);
  if (!existsSync(p)) return null;
  const manifest = JSON.parse(readFileSync(p, "utf8"));
  if (manifest.skills !== undefined) {
    if (!Array.isArray(manifest.skills)) {
      throw new Error(`invalid "skills" in ${MANIFEST_NAME}: ${JSON.stringify(manifest.skills)} (expected an array of skill names)`);
    }
    for (const name of manifest.skills) {
      if (typeof name !== "string" || !INSTALL_DIR_RE.test(name)) {
        throw new Error(`unsafe skill name in ${MANIFEST_NAME}: ${JSON.stringify(name)}`);
      }
    }
  }
  return manifest;
}

// Lê `MGR_PROJECT_ID=` do `.env` derivado. Forma discriminada: ausência do arquivo, da chave ou valor
// vazio é `absent`, sem `null` como sentinela. É a 4ª fonte da migração (DT-16).
export function readEnvProjectId(dir) {
  const arquivo = path.join(dir, ENV_NAME);
  if (!existsSync(arquivo)) return { state: "absent" };
  for (const line of readFileSync(arquivo, "utf8").split(/\r?\n/)) {
    const casou = /^MGR_PROJECT_ID=(.*)$/.exec(line);
    if (casou && casou[1].trim() !== "") return { state: "present", projectId: casou[1].trim() };
  }
  return { state: "absent" };
}

// Grava `.mgr-core/.env` com o identificador do projeto para o mgr-code.
export function writeEnv(dir, projectId) {
  mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, ENV_NAME);
  writeFileSync(dest, `MGR_PROJECT_ID=${projectId}\n`, "utf8");
  return dest;
}
