// Skill plugável (plugin): schema e validação do mgr-manifest.json + checksum de conteúdo.
// O plugin é uma pasta de skill 100% padrão Agent Skills mais o mgr-manifest.json na raiz
// (ADR-0004). O frontmatter do SKILL.md é o contrato com as plataformas; o manifest é o
// contrato com o MGR. Mensagens de validação em inglês: o manifest é conteúdo distribuído
// (ADR-0003) e as mesmas mensagens rodam na validação de publicação do registry.
// Este arquivo e vendorizado pelo registry (copia literal): por isso so importa node:crypto
// e o texto en das chaves pluginManifest* (o contrato com o registry) mora aqui, em PLUGIN_MANIFEST_TEXT_EN;
// src/messages.js tem uma copia igual byte a byte, guardada por teste em test/plugin.test.js.
import { createHash } from "node:crypto";

export const MANIFEST_NAME = "mgr-manifest.json";

// Listas fechadas da v1 (ADR-0004). Ampliar categoria/permissão = mudança de contrato.
export const CATEGORIES = [
  "architecture", "language", "database", "infra", "monitoring", "testing", "docs",
  "workflow", "other",
];
export const PERMISSIONS = ["read-files", "write-files", "run-shell", "network"];
// Cinco níveis: a escala de quatro do ADR-0004 (decisão 6) foi emendada pelo ADR-0010 —
// a razão de excluir `xhigh` ("não endereçável via manifest na v1") expirou quando o
// método passou a escrever arquivo de agente, onde a plataforma documenta os cinco.
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];

// `@registry/skill` — registry e skill em kebab-case (mesma regra de `name` do padrão
// Agent Skills: minúsculas/dígitos, sem hífen nas pontas, sem hífen duplo).
const KEBAB = "[a-z0-9]+(?:-[a-z0-9]+)*";
const NAME_RE = new RegExp(`^@(${KEBAB})/(${KEBAB})$`);
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// `ecosystems`: a que ecossistema de projeto a skill serve (ADR-0009). Vocabulário ABERTO —
// só a forma é validada. Uma skill pode declarar um ecossistema que o detector ainda não
// conhece: ela apenas não é sugerida até o CLI aprender, e nada quebra. Lista fechada
// travaria skill de terceiro na velocidade do CLI.
const ECOSYSTEM_RE = new RegExp(`^${KEBAB}$`);

export const DESCRIPTION_MIN = 40;
export const DESCRIPTION_MAX = 1024;

// Decompõe o nome namespaced. Erro específico — o nome é a chave de tudo (lockfile, index).
/** A regra do nome de skill plugavel como dado: nao lanca, para o chamador escolher como recusar. */
export const isSkillName = (name) => typeof name === "string" && NAME_RE.test(name);

export function parseSkillName(name) {
  const match = typeof name === "string" ? name.match(NAME_RE) : null;
  if (!match) {
    throw new Error(`invalid skill name: ${JSON.stringify(name)} (expected "@registry/skill" in kebab-case)`);
  }
  return { registry: match[1], skill: match[2] };
}

const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);

// Texto en dos problemas do manifest (contrato com o registry). Fixo ou funcao dos params.
export const PLUGIN_MANIFEST_TEXT_EN = {
  pluginManifestNotObject: "manifest must be a JSON object",
  pluginManifestNameInvalid: (got) => `"name" must be namespaced "@registry/skill" in kebab-case (got ${got})`,
  pluginManifestVersionInvalid: (got) => `"version" must be semver "MAJOR.MINOR.PATCH" (got ${got})`,
  pluginManifestAuthorRequired: '"author" is required and must be a non-empty string',
  pluginManifestDescriptionInvalid: (min, max) => `"description" must be a string of ${min}-${max} characters stating what the skill does and when to use it`,
  pluginManifestCategoryInvalid: (allowed, got) => `"category" must be one of: ${allowed.join(", ")} (got ${got})`,
  pluginManifestCompatibilityInvalid: '"compatibility" must be an object with an "mgr" version range string, e.g. {"mgr": ">=0.6.0"}',
  pluginManifestExtendsInvalid: (got) => `"extends" must be a namespaced skill name "@registry/skill" or null (got ${got})`,
  pluginManifestPermissionsInvalid: (allowed) => `"permissions" must be an array of: ${allowed.join(", ")}`,
  pluginManifestCapabilitiesInvalid: '"capabilities" must be an object with optional "requires" and "optional" string arrays',
  pluginManifestModelInvalid: '"model" must map platform to a model display name, e.g. {"claude-code": "sonnet"}',
  pluginManifestEffortInvalid: (allowed, got) => `"effort" must be one of: ${allowed.join(", ")} (got ${got})`,
  pluginManifestEcosystemsInvalid: '"ecosystems" must be an array of kebab-case project ecosystem tokens, e.g. ["java", "postgres"]',
  pluginManifestTestedModelsInvalid: '"testedModels" must be an array of model display names',
};

const text = (key, ...params) => ({ key, params });

// Valida o manifest e devolve a lista de problemas como DESCRITORES (vazia = válido): uma frase
// inteira por item, que a borda renderiza com a tabela do idioma (DT-14, item 2).
export function manifestProblems(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return [text("pluginManifestNotObject")];
  }

  if (typeof manifest.name !== "string" || !NAME_RE.test(manifest.name)) {
    problems.push(text("pluginManifestNameInvalid", JSON.stringify(manifest.name)));
  }
  if (typeof manifest.version !== "string" || !SEMVER_RE.test(manifest.version)) {
    problems.push(text("pluginManifestVersionInvalid", JSON.stringify(manifest.version)));
  }
  if (typeof manifest.author !== "string" || manifest.author.trim() === "") {
    problems.push(text("pluginManifestAuthorRequired"));
  }
  if (typeof manifest.description !== "string"
    || manifest.description.length < DESCRIPTION_MIN
    || manifest.description.length > DESCRIPTION_MAX) {
    problems.push(text("pluginManifestDescriptionInvalid", DESCRIPTION_MIN, DESCRIPTION_MAX));
  }
  if (!CATEGORIES.includes(manifest.category)) {
    problems.push(text("pluginManifestCategoryInvalid", CATEGORIES, JSON.stringify(manifest.category)));
  }

  if (manifest.compatibility !== undefined) {
    if (!manifest.compatibility || typeof manifest.compatibility !== "object" || typeof manifest.compatibility.mgr !== "string") {
      problems.push(text("pluginManifestCompatibilityInvalid"));
    }
  }
  if (manifest.extends !== undefined && manifest.extends !== null && !NAME_RE.test(manifest.extends)) {
    problems.push(text("pluginManifestExtendsInvalid", JSON.stringify(manifest.extends)));
  }
  if (manifest.permissions !== undefined) {
    if (!isStringArray(manifest.permissions) || !manifest.permissions.every((p) => PERMISSIONS.includes(p))) {
      problems.push(text("pluginManifestPermissionsInvalid", PERMISSIONS));
    }
  }
  if (manifest.capabilities !== undefined) {
    const caps = manifest.capabilities;
    const validLists = caps && typeof caps === "object"
      && (caps.requires === undefined || isStringArray(caps.requires))
      && (caps.optional === undefined || isStringArray(caps.optional));
    if (!validLists) {
      problems.push(text("pluginManifestCapabilitiesInvalid"));
    }
  }
  if (manifest.model !== undefined) {
    const model = manifest.model;
    const validMap = model && typeof model === "object" && !Array.isArray(model)
      && Object.values(model).every((display) => typeof display === "string" && display.length > 0);
    if (!validMap) {
      problems.push(text("pluginManifestModelInvalid"));
    }
  }
  if (manifest.effort !== undefined && !EFFORT_LEVELS.includes(manifest.effort)) {
    problems.push(text("pluginManifestEffortInvalid", EFFORT_LEVELS, JSON.stringify(manifest.effort)));
  }
  if (manifest.ecosystems !== undefined) {
    const ecosystems = manifest.ecosystems;
    const validos = Array.isArray(ecosystems)
      && ecosystems.every((token) => typeof token === "string" && ECOSYSTEM_RE.test(token));
    if (!validos) {
      problems.push(text("pluginManifestEcosystemsInvalid"));
    }
  }
  if (manifest.testedModels !== undefined && !isStringArray(manifest.testedModels)) {
    problems.push(text("pluginManifestTestedModelsInvalid"));
  }
  return problems;
}

// Mesmo contrato do validator.js (checkSkill): lista de problemas, vazia = válido, em frases do
// inglês canônico (ADR-0003: o manifest é conteúdo distribuído, e a validação de publicação do
// registry roda as mesmas frases). Quem precisa de exceção usa assertValidManifest (plugin-installer).
export function validateManifest(manifest) {
  return manifestProblems(manifest).map(({ key, params }) => {
    const message = PLUGIN_MANIFEST_TEXT_EN[key];
    return typeof message === "string" ? message : message(...params);
  });
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
