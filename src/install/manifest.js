// Config do projeto MGR, em `.mgr-core/` (sem skills; o runtime fica em `.mgr-core/runtime/`):
//   manifest.json  fonte de verdade do que foi instalado (motores, skills, linguagem, arquitetura)
//   .env           MGR_PROJECT_ID=<id>, usado pela memória estendida (mgr-code)
// O campo `model` no manifesto distingue as gerações de instalação e habilita a migração:
//   "self-contained-core-runtime"   — atual (fatia runtime-em-mgr-core): runtime único em `.mgr-core/runtime/`;
//   "self-contained-layered-config" — geração da F2 (DT-16): config em duas camadas, runtime em cada motor (realoca);
//   "self-contained-runtime"        — geração da F1: runtime dentro do motor, precisa da migração de config e realoca;
//   "self-contained" e "runtime-launcher" — antigas: precisam das duas migrações.
// A categoria de cada campo (derivado, declaracao, registro) e dado consultado por todo consumidor:
// ninguem mais guarda lista propria de campos nem literal de categoria.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { INSTALL_DIR_RE } from "./lockfile.js";
import * as catalog from "../core/catalog.js";
import * as engineDescriptors from "../engines/index.js";
import { UsageError } from "../core/errors.js";
import { text } from "../core/ui-text.js";

export const MANIFEST_NAME = "manifest.json";
export const ENV_NAME = ".env";

export const MODEL_RUNTIME = "self-contained-runtime";
export const MODEL_LAYERED = "self-contained-layered-config";
export const MODEL_CORE_RUNTIME = "self-contained-core-runtime";

export const manifestPath = (dir) => path.join(dir, MANIFEST_NAME);

export const FIELD_CATEGORY = Object.freeze({ DERIVED: "derived", DECLARATION: "declaration", RECORD: "record" });

export const DECLARATION_FLAGS = Object.freeze({
  engines: "--engine",
  architecture: "--arch",
  language: "--language",
  userLanguage: "--user-language",
  skillsDirs: "--skills-dir",
});

// Declaracoes que a resolucao produz (DT-6), em ordem. Fonte unica: o instalador itera esta lista, e nao as
// chaves de um objeto de padroes (achado N-11 do gate isolado).
export const RESOLVED_DECLARATIONS = Object.freeze(["engines", "architecture", "language", "userLanguage", "optional", "allSkills"]);

// Declaracoes que tem pergunta no `install` com terminal (DT-15): em `asked`, elas nao recusam na resolucao.
export const QUESTION_FIELDS = Object.freeze(["engines", "architecture", "language", "userLanguage", "optional"]);

// Declaracoes que o `uninstall` consome (spec, secao 1): os motores e a pasta do `custom`. As demais nao
// mudam o que ele remove, e fora de forma nao o recusam (achado E-5 do gate isolado).
export const UNINSTALL_DECLARATIONS = Object.freeze(["engines", "skillsDirs"]);

export const KNOWN_MODELS = Object.freeze([
  MODEL_CORE_RUNTIME,
  MODEL_LAYERED,
  MODEL_RUNTIME,
  "self-contained",
  "runtime-launcher",
]);

const DERIVED_FIELDS = ["scope", "agents", "agentsDirs", "skillsDirs"];

// Categoria do campo (DT-1), pura. `skillsDirs` e derivado, salvo no alvo `custom`, onde a pessoa o declara.
// Campo fora das tres listas cai em `declaration`: nao e recalculavel, entao nunca vira "update".
export function fieldCategory(manifest, field) {
  if (field === "skills") return FIELD_CATEGORY.RECORD;
  if (field === "skillsDirs" && Array.isArray(manifest?.engines) && manifest.engines.includes("custom")) {
    return FIELD_CATEGORY.DECLARATION;
  }
  if (DERIVED_FIELDS.includes(field)) return FIELD_CATEGORY.DERIVED;
  return FIELD_CATEGORY.DECLARATION;
}

// Remedio do problema (DT-1), puro: so o derivado e recalculado pelo `update`; a raiz e o resto sao a mao.
export const REMEDY = Object.freeze({ UPDATE: "update", BY_HAND: "by-hand" });

export function problemRemedy(manifest, problem) {
  if (problem.kind === "root") return REMEDY.BY_HAND;
  return fieldCategory(manifest, problem.field) === FIELD_CATEGORY.DERIVED ? REMEDY.UPDATE : REMEDY.BY_HAND;
}

export function writeManifest(dir, data) {
  const manifest = {
    model: MODEL_CORE_RUNTIME,
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
// concatenado ao diretório do motor e removido com rmSync recursivo (src/install/installer.js:130-131 e
// :307-308), e até esta fatia o manifesto recebia a mesma classe de entrada do lockfile sem
// nenhuma validação. O `Array.isArray` não é zelo: com `skills` string, o `for...of` dos dois
// chamadores itera CARACTERES, e cada caractere passa no INSTALL_DIR_RE.
// Campo ausente continua sendo estado tolerado — os chamadores fazem `man.skills || []`.
export function readManifest(dir) {
  const p = manifestPath(dir);
  if (!existsSync(p)) return null;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(p, "utf8"));
  } catch (cause) {
    // O texto do JSON.parse e da plataforma e nao entra na frase mostrada (P-10); fica como causa.
    throw new UsageError("fileNotJson", [MANIFEST_NAME], { cause });
  }
  if (!isObjectRoot(manifest)) {
    throw new UsageError("fileNotObject", [MANIFEST_NAME]);
  }
  if (manifest.skills !== undefined) {
    // `null` e tolerado pela funcao de forma (campo-array ausente), mas aqui sempre lancou: preserva.
    if (!Array.isArray(manifest.skills)) {
      throw new UsageError("manifestInvalidSkills", [MANIFEST_NAME, JSON.stringify(manifest.skills)]);
    }
    const [primeiro] = problemasDeSkills(manifest.skills);
    if (primeiro) {
      throw new UsageError("manifestUnsafeSkillName", [MANIFEST_NAME, JSON.stringify(manifest.skills[primeiro.posicao])]);
    }
  }
  return manifest;
}

// Raiz do manifesto como objeto (DT-3): a mesma condicao para quem le e para quem confere a forma.
const isObjectRoot = (valor) => valor !== null && typeof valor === "object" && !Array.isArray(valor);

// Idioma declarado pela pessoa (DT-4), lido sem depender dos outros campos: so conta arquivo existente,
// JSON valido, raiz objeto e `userLanguage` string nao vazia. Qualquer outro caso e `undeclared`; nunca lanca.
export function readUserLanguage(dir) {
  try {
    const caminho = manifestPath(dir);
    if (!existsSync(caminho)) return { state: "undeclared" };
    const manifest = JSON.parse(readFileSync(caminho, "utf8"));
    if (isObjectRoot(manifest) && typeof manifest.userLanguage === "string" && manifest.userLanguage !== "") {
      return { state: "declared", value: manifest.userLanguage };
    }
  } catch {
    return { state: "undeclared" };
  }
  return { state: "undeclared" };
}

const tipoDe = (v) => (v === undefined ? "absent" : v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

// Unica casa da regra de elemento de `skills` (typeof e INSTALL_DIR_RE), consumida pelo readManifest
// e por manifestShapeProblems, para que as duas nunca divirjam.
function problemasDeSkills(skills) {
  const achados = [];
  skills.forEach((nome, posicao) => {
    if (typeof nome !== "string") achados.push({ kind: "element", posicao });
    else if (!INSTALL_DIR_RE.test(nome)) achados.push({ kind: "unsafe-name", posicao });
  });
  return achados;
}

// Regra de forma do manifesto, pura (sem IO, sem throw): devolve o que esta fora de forma e deixa a
// decisao de lancar ou relatar para cada consumidor, porque cada um age sobre a classe que o afeta
// (`readManifest` so lanca em `skills`; o doctor relata so o que o mata). Cobre os campos-array
// (`skills`, `skillsDirs`, `engines`, `agents`, `agentsDirs`, `optional`) e as declaracoes
// (`architecture`, `language`, `userLanguage`, `allSkills`). Ausente/null e tolerado (manifesto
// legado). `language` confere so o tipo; `architecture` tem vocabulario fechado no catalogo.
export function manifestShapeProblems(manifest) {
  if (!isObjectRoot(manifest)) {
    return [{ field: MANIFEST_NAME, kind: "root", expected: "object", found: tipoDe(manifest) }];
  }
  const problems = [];
  for (const field of ["skills", "skillsDirs", "engines", "agents", "agentsDirs", "optional"]) {
    const valor = manifest[field];
    if (valor === undefined || valor === null) continue;
    const expected = field === "skills" ? "array-of-skill-names" : "array-of-strings";
    if (!Array.isArray(valor)) {
      problems.push({ field, kind: "container", expected, found: tipoDe(valor) });
    } else if (field === "skills") {
      for (const { kind, posicao } of problemasDeSkills(valor)) {
        problems.push(kind === "element"
          ? { field, kind, expected, found: "non-string-element", position: posicao }
          : { field, kind, expected: "safe-skill-name", found: "unsafe-name", position: posicao });
      }
    } else if (field !== "engines") {
      valor.forEach((item, i) => {
        if (typeof item !== "string") {
          problems.push({ field, kind: "element", expected, found: "non-string-element", position: i });
        }
      });
    }
  }
  if (Array.isArray(manifest.engines)) {
    const reconhecidos = manifest.engines.filter((e) => engineDescriptors.ids().includes(e));
    if (reconhecidos.length > 0) {
      const invalido = reconhecidos.some((e) => engineDescriptors.get(e).skillsDir[manifest.scope] === undefined);
      if (invalido) {
        const chaves = [...new Set(reconhecidos.flatMap((e) => Object.keys(engineDescriptors.get(e).skillsDir)))];
        problems.push({ field: "scope", kind: "container", expected: "scope-key", found: tipoDe(manifest.scope), allowed: chaves });
      }
    }
  }
  for (const field of ["architecture", "language", "userLanguage"]) {
    const valor = manifest[field];
    if (valor === undefined || valor === null) continue;
    if (typeof valor !== "string") {
      problems.push({ field, kind: "type", expected: "text-or-null", found: tipoDe(valor) });
    } else if (field === "architecture" && !catalog.architectures().includes(valor)) {
      problems.push({ field, kind: "value", expected: "architecture-name", found: "unknown-value", allowed: catalog.architectures() });
    }
  }
  if (manifest.allSkills !== undefined && manifest.allSkills !== null && typeof manifest.allSkills !== "boolean") {
    problems.push({ field: "allSkills", kind: "type", expected: "boolean-or-null", found: tipoDe(manifest.allSkills) });
  }
  return problems;
}

// Escolhe a chave de mensagem do problema (DT-13), pura: nenhum idioma aqui, so a chave e os
// parametros. `unsafe-name` tem frase propria (`manifestProblemUnsafeName`) e e checado antes de `element`.
// Conjunto LETAL do doctor (DT-2, DT-5): formas em que ele nao consegue seguir sem estourar. Mora aqui
// porque e lista de campos do manifesto, e a classificacao tem um lugar so (CA-28). `element` em
// `skills` e `unsafe-name` ficam fora: o doctor sobrevive e relata achados, e isso nao pode degradar.
const LETHAL_ELEMENT_FIELDS = Object.freeze(["skillsDirs", "agents"]);
const LETHAL_CONTAINER_FIELDS = Object.freeze(["skills", "skillsDirs", "engines", "agents", "scope"]);
export const isLethalShapeProblem = ({ kind, field }) => kind === "root"
  || (kind === "container" && LETHAL_CONTAINER_FIELDS.includes(field))
  || (kind === "element" && LETHAL_ELEMENT_FIELDS.includes(field));

export function problemText(problem) {
  const { field, kind, expected, found, position, allowed } = problem;
  if (kind === "root") return text("manifestProblemRoot", field, found);
  if (field === "scope") {
    return found === "absent"
      ? text("manifestProblemScopeAbsent", allowed.join(" | "))
      : text("manifestProblemScope", allowed.join(" | "), found);
  }
  if (kind === "type") {
    return expected === "boolean-or-null"
      ? text("manifestProblemNotBoolean", field, found)
      : text("manifestProblemNotText", field, found);
  }
  if (kind === "value") {
    if (expected === "architecture-name") return text("manifestProblemUnknownValue", field, allowed.join(" | "));
    return expected === "non-empty-custom-dir" ? text("manifestProblemEmptyCustomDir") : text("manifestProblemEmptyEngines");
  }
  if (kind === "unsafe-name") return text("manifestProblemUnsafeName", field, position);
  if (kind === "element") return text("manifestProblemElement", field, position);
  if (expected === "array-of-skill-names") return text("manifestProblemSkillsList", found);
  return text("manifestProblemStringList", field, found);
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
