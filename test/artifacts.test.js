import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SPECS_DIR, artifactFiles, repoRoot, slugs } from "../src/artifacts.js";

const repoCom = (arvore) => {
  const repo = mkdtempSync(path.join(tmpdir(), "mgr-art-"));
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
  const repo = mkdtempSync(path.join(tmpdir(), "mgr-art-"));
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
  assert.deepEqual(artifactFiles(mkdtempSync(path.join(tmpdir(), "mgr-art-")), null, "04-plan.md"), []);
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
  const fora = mkdtempSync(path.join(tmpdir(), "mgr-art-"));
  mkdirSync(path.join(fora, SPECS_DIR), { recursive: true });
  const interno = path.join(fora, "sub");
  mkdirSync(interno);
  writeFileSync(path.join(interno, "package.json"), "{}");

  assert.equal(repoRoot(interno), interno,
    "com package.json e sem specs/, para ali em vez de responder sobre as specs de cima");
});

test("repoRoot sem specs/ em lugar nenhum devolve o ponto de partida", () => {
  const solto = mkdtempSync(path.join(tmpdir(), "mgr-art-"));
  writeFileSync(path.join(solto, "package.json"), "{}");
  assert.equal(repoRoot(solto), solto, "mesma mensagem de erro de hoje, sem mudar comportamento");
});
