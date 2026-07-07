// Manifesto de instalação: fonte de verdade do que o MGR escreveu num motor.
// Modelo novo (self-contained): um manifesto POR motor, gravado dentro da pasta de skills
// do motor, em `.mgr-manifest.json` — cada instalação se autodescreve e é independente.
// Modelo antigo (runtime-launcher): `manifest.json` dentro de `.mgr-core/` (lido só p/ migração).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MANIFEST_NAME = ".mgr-manifest.json";
export const LEGACY_MANIFEST_NAME = "manifest.json";

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

// Lê o manifesto do modelo antigo (runtime-launcher) em `<runtimeDir>/manifest.json`.
export function readLegacyManifest(runtimeDir) {
  const p = path.join(runtimeDir, LEGACY_MANIFEST_NAME);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}
