import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ARCHIVE_DIR,
  SPECS_DIR,
  archivedEntries,
  artifactFiles,
  locate,
  repoRoot,
  slugs,
} from "../../src/sdd/artifacts.js";
import { tempDir } from "../../scripts/lib/tmp.mjs";

const repoCom = (arvore) => {
  const repo = tempDir("mgr-art-");
  for (const [slug, arquivos] of Object.entries(arvore)) {
    mkdirSync(path.join(repo, SPECS_DIR, slug), { recursive: true });
    for (const nome of arquivos) writeFileSync(path.join(repo, SPECS_DIR, slug, nome), "x");
  }
  return repo;
};

test("slugs devolve os diretórios de specs/ em ordem estável", () => {
  const repo = repoCom({ zebra: ["01-brief.md"], alfa: ["01-brief.md"], meio: [] });
  assert.deepEqual(slugs(repo), ["alfa", "meio", "zebra"], "ordem estável, não a do readdir");
});

test("slugs devolve vazio quando specs/ não existe, sem lançar", () => {
  const repo = tempDir("mgr-art-");
  assert.deepEqual(slugs(repo), [], "ausência legítima não é exceção");
});

test("slugs ignora arquivo solto dentro de specs/", () => {
  const repo = repoCom({ alfa: ["01-brief.md"] });
  writeFileSync(path.join(repo, SPECS_DIR, "leiame.md"), "x");
  assert.deepEqual(slugs(repo), ["alfa"]);
});

// artifactFiles passou a consumir `slugs`. O contrato dele não pode ter mudado.
test("artifactFiles continua devolvendo só o que existe, por slug e de todos", () => {
  const repo = repoCom({ alfa: ["04-plan.md"], beta: ["03-spec.md"], gama: ["04-plan.md"] });
  const relativo = (caminhos) => caminhos.map((c) => path.relative(repo, c));

  assert.deepEqual(relativo(artifactFiles(repo, "alfa", "04-plan.md")),
    [path.join(SPECS_DIR, "alfa", "04-plan.md")]);
  assert.deepEqual(relativo(artifactFiles(repo, null, "04-plan.md")),
    [path.join(SPECS_DIR, "alfa", "04-plan.md"), path.join(SPECS_DIR, "gama", "04-plan.md")],
    "beta não tem plano e por isso não aparece");
  assert.deepEqual(artifactFiles(repo, "beta", "04-plan.md"), [], "slug sem o arquivo devolve vazio");
  assert.deepEqual(artifactFiles(repo, "inexistente", "04-plan.md"), []);
});

test("artifactFiles devolve vazio quando specs/ não existe", () => {
  assert.deepEqual(artifactFiles(tempDir("mgr-art-"), null, "04-plan.md"), []);
});

// `repoRoot` existe porque os comandos `spec` tratavam o diretório atual como raiz: rodados de
// dentro de `specs/<slug>/`, procuravam artefato em `specs/<slug>/specs`. Defeito entregue na
// fatia 1 e nunca exercitado, porque todo teste rodava a partir da raiz.
test("repoRoot sobe até o diretório que tem specs/", () => {
  const repo = repoCom({ demo: ["01-brief.md"] });
  assert.equal(repoRoot(path.join(repo, SPECS_DIR, "demo")), repo, "de dentro da feature");
  assert.equal(repoRoot(repo), repo, "da raiz, devolve a própria raiz");
});

test("repoRoot não atravessa a fronteira do projeto", () => {
  const fora = tempDir("mgr-art-");
  mkdirSync(path.join(fora, SPECS_DIR), { recursive: true });
  const interno = path.join(fora, "sub");
  mkdirSync(interno);
  writeFileSync(path.join(interno, "package.json"), "{}");

  assert.equal(repoRoot(interno), interno,
    "com package.json e sem specs/, para ali em vez de responder sobre as specs de cima");
});

test("repoRoot sem specs/ em lugar nenhum devolve o ponto de partida", () => {
  const solto = tempDir("mgr-art-");
  writeFileSync(path.join(solto, "package.json"), "{}");
  assert.equal(repoRoot(solto), solto, "mesma mensagem de erro de hoje, sem mudar comportamento");
});

const arquivar = (repo, nome) =>
  mkdirSync(path.join(repo, SPECS_DIR, ARCHIVE_DIR, nome), { recursive: true });

test("should exclude the archive folder from slugs", () => {
  const repo = repoCom({ alfa: ["01-brief.md"] });
  arquivar(repo, "2026-01-01-velha");
  assert.deepEqual(slugs(repo), ["alfa"]);
});

test("should return an empty list from archivedEntries when specs/archive does not exist", () => {
  assert.deepEqual(archivedEntries(tempDir("mgr-art-")), []);
});

test("should order archived entries by date descending and then by slug ascending", () => {
  const repo = tempDir("mgr-art-");
  for (const nome of ["2026-01-01-beta", "2026-03-05-zeta", "2026-03-05-alfa", "2026-02-10-gama"]) {
    arquivar(repo, nome);
  }
  assert.deepEqual(archivedEntries(repo).map((entrada) => entrada.name),
    ["2026-03-05-alfa", "2026-03-05-zeta", "2026-02-10-gama", "2026-01-01-beta"]);
});

test("should keep an unrecognized archive name at the end marked as not recognized", () => {
  const repo = tempDir("mgr-art-");
  arquivar(repo, "rascunho");
  arquivar(repo, "2026-01-01-velha");
  assert.deepEqual(archivedEntries(repo), [
    { name: "2026-01-01-velha", path: path.join(SPECS_DIR, ARCHIVE_DIR, "2026-01-01-velha"),
      recognized: true, date: "2026-01-01", slug: "velha" },
    { name: "rascunho", path: path.join(SPECS_DIR, ARCHIVE_DIR, "rascunho"), recognized: false },
  ]);
});

test("should return an empty list and locate as absent when specs/archive is a file", () => {
  const repo = tempDir("mgr-art-");
  mkdirSync(path.join(repo, SPECS_DIR), { recursive: true });
  writeFileSync(path.join(repo, SPECS_DIR, ARCHIVE_DIR), "nao e pasta");
  assert.deepEqual(archivedEntries(repo), []);
  assert.deepEqual(locate(repo, "x"), { state: "absent" });
});

test("should ignore loose files inside specs/archive", () => {
  const repo = tempDir("mgr-art-");
  arquivar(repo, "2026-01-01-velha");
  writeFileSync(path.join(repo, SPECS_DIR, ARCHIVE_DIR, "leiame.md"), "x");
  assert.deepEqual(archivedEntries(repo).map((entrada) => entrada.name), ["2026-01-01-velha"]);
});

test("should locate the archive name as reserved", () => {
  assert.deepEqual(locate(tempDir("mgr-art-"), ARCHIVE_DIR), { state: "reserved" });
});

test("should locate a slug present in specs as active", () => {
  const repo = repoCom({ alfa: ["01-brief.md"] });
  assert.deepEqual(locate(repo, "alfa"), { state: "active" });
});

test("should locate a slug present only in the archive as archived with its path", () => {
  const repo = tempDir("mgr-art-");
  arquivar(repo, "2026-01-01-velha");
  assert.deepEqual(locate(repo, "velha"),
    { state: "archived", paths: [path.join(SPECS_DIR, ARCHIVE_DIR, "2026-01-01-velha")] });
});

test("should locate an unknown slug as absent", () => {
  const repo = repoCom({ alfa: ["01-brief.md"] });
  arquivar(repo, "2026-01-01-velha");
  assert.deepEqual(locate(repo, "inexistente"), { state: "absent" });
});

test("should prefer active over archived when the same slug exists in both", () => {
  const repo = repoCom({ velha: ["01-brief.md"] });
  arquivar(repo, "2026-01-01-velha");
  assert.deepEqual(locate(repo, "velha"), { state: "active" });
});

test("should return every archived path of a slug archived on different dates", () => {
  const repo = tempDir("mgr-art-");
  arquivar(repo, "2026-01-01-velha");
  arquivar(repo, "2026-02-01-velha");
  assert.deepEqual(locate(repo, "velha"), {
    state: "archived",
    paths: [
      path.join(SPECS_DIR, ARCHIVE_DIR, "2026-02-01-velha"),
      path.join(SPECS_DIR, ARCHIVE_DIR, "2026-01-01-velha"),
    ],
  });
});
