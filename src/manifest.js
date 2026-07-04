// Manifesto de instalação: fonte de verdade do que o MGR escreveu num projeto.
// Gravado em <runtime>/manifest.json. Habilita status/update/uninstall.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MANIFEST_NAME = "manifest.json";

export function manifestPath(runtimeDir) {
  return path.join(runtimeDir, MANIFEST_NAME);
}

export function writeManifest(runtimeDir, data) {
  const manifest = {
    model: "runtime-launcher",
    installedAt: new Date().toISOString(),
    ...data,
  };
  mkdirSync(runtimeDir, { recursive: true });
  const dest = manifestPath(runtimeDir);
  writeFileSync(dest, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return dest;
}

export function readManifest(runtimeDir) {
  const p = manifestPath(runtimeDir);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}
