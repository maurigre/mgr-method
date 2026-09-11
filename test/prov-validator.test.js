import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateProvenance } from "../src/prov-validator.js";

const repoTemporario = () => mkdtempSync(path.join(os.tmpdir(), "mgr-prov-"));

const feature = (repo, slug, arquivos) => {
  mkdirSync(path.join(repo, "specs", slug), { recursive: true });
  for (const [nome, texto] of Object.entries(arquivos)) {
    writeFileSync(path.join(repo, "specs", slug, nome), texto);
  }
  return repo;
};

test("a proveniência é lida em TODOS os artefatos canônicos, não só no plano e na spec", () => {
  const repo = feature(repoTemporario(), "demo", {
    "01-brief.md": "sumiu [code:src/a.js:1]\n",
    "02-prd.md": "sumiu também [code:src/b.js:1]\n",
    "05-execution.md": "e aqui [code:src/c.js:1]\n",
  });
  const { files, findings } = validateProvenance(repo, { slug: "demo" });
  assert.deepEqual(files, ["specs/demo/01-brief.md", "specs/demo/02-prd.md", "specs/demo/05-execution.md"]);
  assert.deepEqual(findings.map((f) => f.code), ["PROV-2", "PROV-2", "PROV-2"]);
});

test("arquivo que não é artefato canônico não é lido", () => {
  const repo = feature(repoTemporario(), "demo", {
    "01-brief.md": "ok\n",
    "risk-closure.md": "sumiu [code:src/a.js:1]\n",
    "regression-baseline.json": "{}\n",
  });
  const { files, findings } = validateProvenance(repo, { slug: "demo" });
  assert.deepEqual(files, ["specs/demo/01-brief.md"]);
  assert.deepEqual(findings, []);
});

test("`closed` vem da existência de 06-completion.md, e nada mais", () => {
  const aberta = feature(repoTemporario(), "demo", { "01-brief.md": "o prazo [A DEFINIR]\n" });
  assert.deepEqual(validateProvenance(aberta, { slug: "demo" }).findings, []);

  const fechada = feature(repoTemporario(), "demo", {
    "01-brief.md": "o prazo [A DEFINIR]\n",
    "06-completion.md": "fechada\n",
  });
  const { findings } = validateProvenance(fechada, { slug: "demo" });
  assert.deepEqual(findings.map((f) => f.code), ["PROV-3"]);
  assert.equal(findings[0].severity, "warning");
});

test("sem slug, varre todas as features, cada uma com o próprio estado de fechamento", () => {
  const repo = repoTemporario();
  feature(repo, "alfa", { "01-brief.md": "o prazo [A DEFINIR]\n" });
  feature(repo, "beta", { "01-brief.md": "o prazo [A DEFINIR]\n", "06-completion.md": "fechada\n" });
  const { files, findings } = validateProvenance(repo);
  assert.equal(files.length, 3);
  assert.deepEqual(findings.map((f) => f.file), ["specs/beta/01-brief.md"], "só a fechada é apontada");
});

test("slug que não existe devolve vazio, sem lançar", () => {
  const repo = feature(repoTemporario(), "demo", { "01-brief.md": "ok\n" });
  assert.deepEqual(validateProvenance(repo, { slug: "nao-existe" }), {
    files: [], findings: [], summary: { errors: 0, warnings: 0 },
  });
});

test("repositório sem specs/ devolve vazio, sem lançar", () => {
  assert.deepEqual(validateProvenance(repoTemporario()).files, []);
});

test("o caminho do achado é relativo à raiz — nenhum caminho absoluto da máquina", () => {
  const repo = feature(repoTemporario(), "demo", { "01-brief.md": "sumiu [code:src/a.js:1]\n" });
  const { findings } = validateProvenance(repo, { slug: "demo" });
  assert.equal(findings[0].file, "specs/demo/01-brief.md");
  assert.ok(!JSON.stringify(findings).includes(repo));
});
