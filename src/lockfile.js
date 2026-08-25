// Lockfile de skills plugáveis (`mgr-skills.lock`, ADR-0006): contrato do TIME, na raiz do
// projeto e versionado no Git — é a única fonte de verdade do conjunto de plugins.
// Chaves gravadas em ordem determinística para minimizar conflito de merge.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const LOCKFILE_NAME = "mgr-skills.lock";
export const LOCKFILE_VERSION = 1;

export const lockfilePath = (repo) => path.join(repo, LOCKFILE_NAME);

// Forma válida da pasta instalada: kebab da skill + sufixo "--<registry>" opcional (Q1).
// O checksum protege os ARQUIVOS da skill, não este campo — um lockfile adulterado com
// "dir" malicioso alcançaria rmSync/write fora da pasta do motor; daí validar na leitura.
const INSTALL_DIR_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

// `replaces` guarda o nome CURTO da skill do metodo substituida (ADR-0008): skill do
// metodo nao tem scope nem sufixo de registry. Campo opcional — ausencia significa
// instalada ao lado ou sem colisao, e e o estado de todo lockfile anterior ao ADR-0008.
const METHOD_SKILL_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const emptyLockfile = () => ({ lockfileVersion: LOCKFILE_VERSION, registries: {}, skills: {} });

// Ausência de lockfile é estado legítimo (projeto sem plugins) — devolve null, mesmo
// contrato do readManifest. Versão desconhecida é erro explícito, nunca silencioso.
export function readLockfile(repo) {
  const file = lockfilePath(repo);
  if (!existsSync(file)) return null;
  const lockfile = JSON.parse(readFileSync(file, "utf8"));
  if (lockfile.lockfileVersion !== LOCKFILE_VERSION) {
    throw new Error(`unsupported lockfileVersion in ${LOCKFILE_NAME}: ${lockfile.lockfileVersion} (expected ${LOCKFILE_VERSION})`);
  }
  for (const [name, entry] of Object.entries(lockfile.skills || {})) {
    if (!INSTALL_DIR_RE.test(entry?.dir || "")) {
      throw new Error(`unsafe install dir in ${LOCKFILE_NAME} for ${name}: ${JSON.stringify(entry?.dir)}`);
    }
    if (entry.replaces !== undefined && !METHOD_SKILL_RE.test(entry.replaces)) {
      throw new Error(`invalid "replaces" in ${LOCKFILE_NAME} for ${name}: ${JSON.stringify(entry.replaces)} (expected a method skill name in kebab-case)`);
    }
  }
  return lockfile;
}

const sortedByKey = (entries) => Object.fromEntries(
  Object.entries(entries).sort(([left], [right]) => (left < right ? -1 : 1)),
);

export function writeLockfile(repo, lockfile) {
  const normalized = {
    lockfileVersion: LOCKFILE_VERSION,
    registries: sortedByKey(lockfile.registries || {}),
    skills: sortedByKey(lockfile.skills || {}),
  };
  const dest = lockfilePath(repo);
  writeFileSync(dest, JSON.stringify(normalized, null, 2) + "\n", "utf8");
  return dest;
}

// Registra/atualiza a skill e a origem dela — imutável: devolve um lockfile novo.
// `origin` = {name, url, trusted}; `entry` = {version, registry, checksum, category,
// engines, applied, extends?} (schema do ADR-0006).
export function upsertSkill(lockfile, name, entry, origin) {
  const base = lockfile || emptyLockfile();
  return {
    ...base,
    registries: { ...base.registries, [origin.name]: { url: origin.url, trusted: origin.trusted === true } },
    skills: { ...base.skills, [name]: entry },
  };
}

export function removeSkill(lockfile, name) {
  if (!lockfile || !lockfile.skills[name]) {
    throw new Error(`skill not in ${LOCKFILE_NAME}: ${name}`);
  }
  const skills = { ...lockfile.skills };
  delete skills[name];
  const inUse = new Set(Object.values(skills).map((entry) => entry.registry));
  const registries = Object.fromEntries(
    Object.entries(lockfile.registries).filter(([registryName]) => inUse.has(registryName)),
  );
  return { ...lockfile, registries, skills };
}

// Compara o lockfile com os plugins presentes em disco (lista de nomes namespaced):
// `missing` = travado mas não instalado; `unexpected` = instalado mas fora do lockfile.
export function diff(lockfile, installedNames) {
  const locked = Object.keys(lockfile?.skills || {});
  const installed = new Set(installedNames);
  return {
    missing: locked.filter((name) => !installed.has(name)),
    unexpected: [...installed].filter((name) => !locked.includes(name)),
  };
}

// Skills do MÉTODO substituídas, por motor: `{ motor: { skill: plugin } }` (DT-6/ADR-0008).
// Consulta pura: quem instala o método recebe este mapa pronto da borda e continua sem
// conhecer plugins (INV-3/INV-5). Sem lockfile, ou sem nenhum `replaces`, devolve `{}`.
export function replacedByEngine(lockfile) {
  const byEngine = {};
  for (const [plugin, entry] of Object.entries(lockfile?.skills || {})) {
    if (!entry.replaces) continue;
    for (const engine of entry.engines || []) {
      byEngine[engine] = { ...byEngine[engine], [entry.replaces]: plugin };
    }
  }
  return byEngine;
}
