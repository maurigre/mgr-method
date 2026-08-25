// Registries de skills plugáveis (ADR-0005): config em `.mgr-core/config.json` (lista
// `registries[]` {name, url, trusted}) + fetch/validação do index e resolução de skill.
// O config é arquivo próprio — o manifest.json continua sendo só estado de instalação.
// O fetch é INJETADO (mesmo padrão do adaptador de prompts): o núcleo não abre rede em
// teste; a borda passa o fetch global.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseSkillName } from "./plugin.js";

export const CONFIG_NAME = "config.json";

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CHECKSUM_RE = /^sha256-[0-9a-f]{64}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export const configPath = (coreDir) => path.join(coreDir, CONFIG_NAME);

export function readConfig(coreDir) {
  const file = configPath(coreDir);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { registries: [] };
}

export function writeConfig(coreDir, config) {
  mkdirSync(coreDir, { recursive: true });
  const dest = configPath(coreDir);
  writeFileSync(dest, JSON.stringify(config, null, 2) + "\n", "utf8");
  return dest;
}

export function listRegistries(coreDir) {
  return readConfig(coreDir).registries;
}

export function addRegistry(coreDir, { name, url, trusted = false }) {
  if (!KEBAB_RE.test(name || "")) {
    throw new Error(`invalid registry name: ${JSON.stringify(name)} (kebab-case, it is the "@name" scope of the skills)`);
  }
  if (!/^https?:\/\//.test(url || "")) {
    throw new Error(`invalid registry url: ${JSON.stringify(url)} (expected the http(s) URL of the registry index.json)`);
  }
  const config = readConfig(coreDir);
  if (config.registries.some((registry) => registry.name === name)) {
    throw new Error(`registry already configured: ${name} (remove it first to change the URL)`);
  }
  config.registries.push({ name, url, trusted });
  writeConfig(coreDir, config);
  return config.registries;
}

export function removeRegistry(coreDir, name) {
  const config = readConfig(coreDir);
  const remaining = config.registries.filter((registry) => registry.name !== name);
  if (remaining.length === config.registries.length) {
    throw new Error(`registry not configured: ${name}`);
  }
  writeConfig(coreDir, { ...config, registries: remaining });
  return remaining;
}

// Valida a forma do index (gerado pelo registry a partir dos manifests — ADR-0005).
// Devolve lista de problemas, vazia = válido (mesmo contrato do validateManifest).
export function validateIndex(index) {
  if (!index || typeof index !== "object" || Array.isArray(index)) return ["index must be a JSON object"];
  const problems = [];
  if (index.indexVersion !== 1) problems.push(`unsupported "indexVersion": ${JSON.stringify(index.indexVersion)} (expected 1)`);
  if (typeof index.registry !== "string" || index.registry === "") problems.push('"registry" must be a non-empty string');
  if (!index.categories || typeof index.categories !== "object" || Array.isArray(index.categories)) {
    problems.push('"categories" must be an object mapping category to skill entries');
    return problems;
  }
  for (const [category, entries] of Object.entries(index.categories)) {
    if (!Array.isArray(entries)) { problems.push(`category "${category}" must be an array`); continue; }
    for (const entry of entries) {
      const id = entry?.name ?? `<entry in ${category}>`;
      try { parseSkillName(entry?.name); } catch { problems.push(`${id}: invalid "name"`); }
      if (typeof entry?.version !== "string") problems.push(`${id}: missing "version"`);
      if (typeof entry?.description !== "string") problems.push(`${id}: missing "description"`);
      if (!CHECKSUM_RE.test(entry?.checksum || "")) problems.push(`${id}: "checksum" must be "sha256-<hex>"`);
      const files = entry?.files;
      const validFiles = Array.isArray(files) && files.length > 0 && files.every(
        (file) => typeof file?.path === "string" && /^https?:\/\//.test(file?.url || "") && SHA256_RE.test(file?.sha256 || ""),
      );
      if (!validFiles) problems.push(`${id}: "files" must be a non-empty array of {path, url, sha256}`);
    }
  }
  return problems;
}

// Baixa e valida o index de um registry. `fetchImpl` injetado pela borda.
export async function fetchIndex(url, { fetchImpl }) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`registry index unavailable: ${url} (HTTP ${response.status})`);
  }
  let index;
  try {
    index = await response.json();
  } catch {
    throw new Error(`registry index is not valid JSON: ${url}`);
  }
  const problems = validateIndex(index);
  if (problems.length) {
    throw new Error(`invalid registry index at ${url}: ${problems.join("; ")}`);
  }
  return index;
}

// Resolve `@registry/skill` na lista de registries configurados: encontra o registry pelo
// scope do nome, baixa o index e devolve a entrada da skill com a origem.
export async function resolve(name, registries, { fetchImpl }) {
  const { registry: scope } = parseSkillName(name);
  const origin = registries.find((registry) => registry.name === scope);
  if (!origin) {
    throw new Error(`registry not configured for scope "@${scope}": run \`mgr registry add ${scope} <index-url>\` first`);
  }
  const index = await fetchIndex(origin.url, { fetchImpl });
  for (const [category, entries] of Object.entries(index.categories)) {
    const entry = entries.find((candidate) => candidate.name === name);
    if (entry) return { entry, category, origin };
  }
  throw new Error(`skill not found in registry "${scope}": ${name}`);
}
