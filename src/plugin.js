// Skill plugável (plugin): schema e validação do mgr-manifest.json + checksum de conteúdo.
// O plugin é uma pasta de skill 100% padrão Agent Skills mais o mgr-manifest.json na raiz
// (ADR-0004). O frontmatter do SKILL.md é o contrato com as plataformas; o manifest é o
// contrato com o MGR. Mensagens de validação em inglês: o manifest é conteúdo distribuído
// (ADR-0003) e as mesmas mensagens rodam na validação de publicação do registry.
import { createHash } from "node:crypto";

export const MANIFEST_NAME = "mgr-manifest.json";

// Listas fechadas da v1 (ADR-0004). Ampliar categoria/permissão = mudança de contrato.
export const CATEGORIES = [
  "architecture", "language", "database", "infra", "monitoring", "testing", "docs",
  "workflow", "other",
];
export const PERMISSIONS = ["read-files", "write-files", "run-shell", "network"];
export const EFFORT_LEVELS = ["low", "medium", "high", "max"];

// `@registry/skill` — registry e skill em kebab-case (mesma regra de `name` do padrão
// Agent Skills: minúsculas/dígitos, sem hífen nas pontas, sem hífen duplo).
const KEBAB = "[a-z0-9]+(?:-[a-z0-9]+)*";
const NAME_RE = new RegExp(`^@(${KEBAB})/(${KEBAB})$`);
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export const DESCRIPTION_MIN = 40;
export const DESCRIPTION_MAX = 1024;

// Decompõe o nome namespaced. Erro específico — o nome é a chave de tudo (lockfile, index).
export function parseSkillName(name) {
  const match = typeof name === "string" ? name.match(NAME_RE) : null;
  if (!match) {
    throw new Error(`invalid skill name: ${JSON.stringify(name)} (expected "@registry/skill" in kebab-case)`);
  }
  return { registry: match[1], skill: match[2] };
}

const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);

// Valida o manifest e devolve a lista de problemas (vazia = válido) — mesmo contrato do
// validator.js (checkSkill). Quem precisa de exceção usa assertValidManifest.
export function validateManifest(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["manifest must be a JSON object"];
  }

  if (typeof manifest.name !== "string" || !NAME_RE.test(manifest.name)) {
    problems.push(`"name" must be namespaced "@registry/skill" in kebab-case (got ${JSON.stringify(manifest.name)})`);
  }
  if (typeof manifest.version !== "string" || !SEMVER_RE.test(manifest.version)) {
    problems.push(`"version" must be semver "MAJOR.MINOR.PATCH" (got ${JSON.stringify(manifest.version)})`);
  }
  if (typeof manifest.author !== "string" || manifest.author.trim() === "") {
    problems.push('"author" is required and must be a non-empty string');
  }
  if (typeof manifest.description !== "string"
    || manifest.description.length < DESCRIPTION_MIN
    || manifest.description.length > DESCRIPTION_MAX) {
    problems.push(`"description" must be a string of ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} characters stating what the skill does and when to use it`);
  }
  if (!CATEGORIES.includes(manifest.category)) {
    problems.push(`"category" must be one of: ${CATEGORIES.join(", ")} (got ${JSON.stringify(manifest.category)})`);
  }

  if (manifest.compatibility !== undefined) {
    if (!manifest.compatibility || typeof manifest.compatibility !== "object" || typeof manifest.compatibility.mgr !== "string") {
      problems.push('"compatibility" must be an object with an "mgr" version range string, e.g. {"mgr": ">=0.6.0"}');
    }
  }
  if (manifest.extends !== undefined && manifest.extends !== null && !NAME_RE.test(manifest.extends)) {
    problems.push(`"extends" must be a namespaced skill name "@registry/skill" or null (got ${JSON.stringify(manifest.extends)})`);
  }
  if (manifest.permissions !== undefined) {
    if (!isStringArray(manifest.permissions) || !manifest.permissions.every((p) => PERMISSIONS.includes(p))) {
      problems.push(`"permissions" must be an array of: ${PERMISSIONS.join(", ")}`);
    }
  }
  if (manifest.capabilities !== undefined) {
    const caps = manifest.capabilities;
    const validLists = caps && typeof caps === "object"
      && (caps.requires === undefined || isStringArray(caps.requires))
      && (caps.optional === undefined || isStringArray(caps.optional));
    if (!validLists) {
      problems.push('"capabilities" must be an object with optional "requires" and "optional" string arrays');
    }
  }
  if (manifest.model !== undefined) {
    const model = manifest.model;
    const validMap = model && typeof model === "object" && !Array.isArray(model)
      && Object.values(model).every((display) => typeof display === "string" && display.length > 0);
    if (!validMap) {
      problems.push('"model" must map platform to a model display name, e.g. {"claude-code": "sonnet"}');
    }
  }
  if (manifest.effort !== undefined && !EFFORT_LEVELS.includes(manifest.effort)) {
    problems.push(`"effort" must be one of: ${EFFORT_LEVELS.join(", ")} (got ${JSON.stringify(manifest.effort)})`);
  }
  if (manifest.testedModels !== undefined && !isStringArray(manifest.testedModels)) {
    problems.push('"testedModels" must be an array of model display names');
  }
  return problems;
}

export function assertValidManifest(manifest) {
  const problems = validateManifest(manifest);
  if (problems.length) {
    throw new Error(`invalid ${MANIFEST_NAME}: ${problems.join("; ")}`);
  }
  return manifest;
}

// sha256 em hex de um conteúdo (Buffer ou string utf8).
export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

// Checksum agregado do conjunto de arquivos da skill (ADR-0005): sha256 sobre os paths em
// ordem lexicográfica, cada um seguido dos bytes do arquivo. Determinístico: a ordem de
// entrada não importa; qualquer byte alterado muda o hash. Formato "sha256-<hex>" — o
// mesmo valor vai ao index do registry e ao lockfile (ADR-0006).
export function aggregateChecksum(files) {
  const sorted = [...files].sort((left, right) => (left.path < right.path ? -1 : 1));
  const hash = createHash("sha256");
  for (const file of sorted) {
    hash.update(file.path);
    hash.update("\n");
    hash.update(file.content);
  }
  return `sha256-${hash.digest("hex")}`;
}
