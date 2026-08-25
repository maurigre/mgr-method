#!/usr/bin/env node
// Exporta uma skill do core para o formato de skill plugavel (DT-7 da spec
// fase1-fundacao-plugins): copia a pasta `skills/<nome>/`, gera o `mgr-manifest.json` e
// valida com o mesmo `src/plugin.js` que o instalador usa. Ferramenta de desenvolvimento
// do repo, fora do tarball npm (precedente: D3 da spec idioma-canonico-ingles).
//
//   node scripts/export-plugin.mjs junit-clean diagnosing-bugs [--out dist/plugins]
//        [--registry mgr] [--version 1.0.0]
//
// A saida e a pasta do plugin pronta para ser publicada no repo do registry (ADR-0005).
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateChecksum, assertValidManifest, MANIFEST_NAME } from "../src/plugin.js";
import { ARCH_RULES_TOKEN, USER_LANGUAGE_FALLBACK, USER_LANGUAGE_TOKEN } from "../src/catalog.js";
import { FRONTMATTER_RE } from "../src/adapters.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_REGISTRY = "mgr";
const DEFAULT_VERSION = "1.0.0";

// Metadados do manifest que NAO existem na SKILL.md (o frontmatter do padrao agentskills.io
// so tem name/description). Cada valor abaixo e uma decisao do autor da skill, ancorada no
// conteudo dela:
//   junit-clean      escreve e reescreve arquivos de teste Java; model/effort conforme o
//                    exemplo de manifest da spec (DT-1).
//   diagnosing-bugs  le codigo, escreve o teste que vai vermelho e RODA o loop de
//                    reproducao (SKILL.md, fase 1: "voce ja rodou o comando ao menos uma
//                    vez"), dai `run-shell`.
export const PLUGIN_METADATA = {
  "junit-clean": {
    category: "language",
    permissions: ["read-files", "write-files"],
    model: { "claude-code": "sonnet", copilot: "Claude Sonnet 4.5" },
    effort: "medium",
  },
  "diagnosing-bugs": {
    category: "workflow",
    permissions: ["read-files", "write-files", "run-shell"],
  },
};

export function readFrontmatter(text) {
  const match = text.match(FRONTMATTER_RE);
  if (!match) throw new Error("SKILL.md sem frontmatter YAML");
  const field = (key) => {
    const found = match[1].match(new RegExp(`^${key}:[ ]*(.*)$`, "m"));
    if (!found) throw new Error(`SKILL.md sem o campo "${key}" no frontmatter`);
    return found[1].trim();
  };
  return { name: field("name"), description: field("description") };
}

// O token de idioma so e resolvido pelo instalador do METODO (builder.installEngine); um
// plugin e instalado por outro caminho, entao o token e resolvido aqui, no export, para o
// texto padrao do pacote. Idioma de saida por plugin fica para a Fase 2.
export function resolveTokens(text, skill) {
  if (text.includes(ARCH_RULES_TOKEN)) {
    throw new Error(`${skill}: skill de arquitetura depende de _shared/arch e nao e exportavel como plugin nesta versao`);
  }
  return text.replaceAll(USER_LANGUAGE_TOKEN, USER_LANGUAGE_FALLBACK);
}

export function buildManifest(skill, frontmatter, { registry, version, author }) {
  const metadata = PLUGIN_METADATA[skill];
  if (!metadata) {
    throw new Error(`sem metadados de plugin para "${skill}": declare category/permissions em PLUGIN_METADATA`);
  }
  return assertValidManifest({
    name: `@${registry}/${skill}`,
    version,
    author,
    description: frontmatter.description,
    category: metadata.category,
    compatibility: { mgr: ">=0.6.0" },
    extends: null,
    permissions: metadata.permissions,
    ...(metadata.model ? { model: metadata.model } : {}),
    ...(metadata.effort ? { effort: metadata.effort } : {}),
  });
}

// Lista os arquivos do plugin em caminhos relativos (a ordem nao importa: o checksum
// agregado ordena por path — ADR-0005).
export function collectFiles(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? collectFiles(path.join(dir, entry.name), relative)
      : [{ path: relative, content: readFileSync(path.join(dir, entry.name)) }];
  });
}

export function exportPlugin(skill, { outDir, registry = DEFAULT_REGISTRY, version = DEFAULT_VERSION, author, skillsDir } = {}) {
  const source = path.join(skillsDir || path.join(ROOT, "skills"), skill);
  const skillMd = path.join(source, "SKILL.md");
  const frontmatter = readFrontmatter(readFileSync(skillMd, "utf8"));
  if (frontmatter.name !== skill) {
    throw new Error(`${skill}: o "name" do frontmatter (${frontmatter.name}) tem de ser o nome da pasta`);
  }
  const manifest = buildManifest(skill, frontmatter, {
    registry, version,
    author: author || JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).author.replace(/ <.*$/, ""),
  });

  const dest = path.join(outDir, skill);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(source, dest, { recursive: true });
  for (const file of collectFiles(dest)) {
    if (!file.path.endsWith(".md")) continue;
    const resolved = resolveTokens(file.content.toString("utf8"), skill);
    writeFileSync(path.join(dest, file.path), resolved, "utf8");
  }
  writeFileSync(path.join(dest, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  const files = collectFiles(dest);
  return { skill, name: manifest.name, dir: dest, files: files.map((file) => file.path), checksum: aggregateChecksum(files) };
}

function main() {
  const argv = process.argv.slice(2);
  const skills = [];
  const options = { outDir: path.join(ROOT, "dist", "plugins") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") options.outDir = path.resolve(argv[++i]);
    else if (argv[i] === "--registry") options.registry = argv[++i];
    else if (argv[i] === "--version") options.version = argv[++i];
    else skills.push(argv[i]);
  }
  const chosen = skills.length ? skills : Object.keys(PLUGIN_METADATA);
  for (const skill of chosen) {
    const result = exportPlugin(skill, options);
    console.log(`${result.name} -> ${result.dir}`);
    console.log(`  files:    ${result.files.join(", ")}`);
    console.log(`  checksum: ${result.checksum}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("export-plugin.mjs")) main();
