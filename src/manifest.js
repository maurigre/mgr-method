// Config do projeto MGR, em `.mgr-core/` (leve, sem skills — só metadados):
//   manifest.json  fonte de verdade do que foi instalado (motores, skills, linguagem, arquitetura)
//   .env           MGR_PROJECT_ID=<id>, usado pela memória estendida (mgr-code)
// O campo `model` no manifesto distingue instalações novas ("self-contained") das antigas
// ("runtime-launcher"), habilitando a migração.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MANIFEST_NAME = "manifest.json";
export const ENV_NAME = ".env";

export const manifestPath = (dir) => path.join(dir, MANIFEST_NAME);

export function writeManifest(dir, data) {
  const manifest = {
    model: "self-contained",
    installedAt: new Date().toISOString(),
    ...data,
  };
  mkdirSync(dir, { recursive: true });
  const dest = manifestPath(dir);
  writeFileSync(dest, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return dest;
}

export function readManifest(dir) {
  const p = manifestPath(dir);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

// Grava `.mgr-core/.env` com o identificador do projeto para o mgr-code.
export function writeEnv(dir, projectId) {
  mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, ENV_NAME);
  writeFileSync(dest, `MGR_PROJECT_ID=${projectId}\n`, "utf8");
  return dest;
}
