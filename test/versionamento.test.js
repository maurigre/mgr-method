import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as bundle from "../src/bundle.js";

const TEMPLATE_CONSTITUICAO = path.join(bundle.skillsDir(), "spec-init", "templates", "sdd", "CONSTITUTION.md");
const SPEC_INIT = readFileSync(path.join(bundle.skillsDir(), "spec-init", "SKILL.md"), "utf8");
const SPEC_CREATE = readFileSync(path.join(bundle.skillsDir(), "spec-create", "SKILL.md"), "utf8");

const normaliza = (texto) => texto.replace(/\s+/g, " ");

const secao5 = (texto) => texto.slice(texto.indexOf("## 5."), texto.indexOf("## 6."));

test("should give the constitution template three versioning subsections and the two fixed lines", () => {
  const secao = secao5(readFileSync(TEMPLATE_CONSTITUICAO, "utf8"));
  const ordem = ["### Commits", "### Branches", "### Confirmation"].map((titulo) => secao.indexOf(titulo));

  assert.ok(ordem.every((posicao) => posicao >= 0), "falta uma subsecao da secao 5");
  assert.ok(ordem[0] < ordem[1] && ordem[1] < ordem[2], "subsecoes fora de ordem");
  assert.match(secao, /^Commit header max: \[TO CONFIRM\]/m);
  assert.match(secao, /^Branch model: \[TO CONFIRM\]/m);
});

test("should state the commit rules and the commitlint precedence in spec-init", () => {
  const texto = normaliza(SPEC_INIT);
  const trechos = [
    "Commit header max: 72",
    "build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test",
    "≤ 100",
    "ASCII",
    "Co-Authored-By",
    "commitlint.config.",
    ".commitlintrc",
    "NEVER install",
    "no scope",
    "in the imperative",
    "no trailing period",
    "not starting with an uppercase letter",
    "blank line after the header",
    "a convention detected in brownfield wins over these defaults",
    "a project commitlint config wins over the defaults",
  ];

  for (const trecho of trechos) {
    assert.ok(texto.includes(trecho), `spec-init nao cita ${trecho}`);
  }
});

test("should offer the four branch models literally and never record initials in spec-init", () => {
  const modelos = [
    "<type>/<TICKET>/<initials>_<description_snake>",
    "<type>/<initials>_<description_snake>",
    "<initials>_<description_snake>",
    "feat/<slug>",
  ];
  modelos.forEach((modelo, indice) => {
    const linha = new RegExp(`^\\s+${indice + 1}\\. \`${modelo.replaceAll("/", "\\/")}\`$`, "m");
    assert.match(SPEC_INIT, linha, `spec-init nao lista o modelo ${indice + 1}: ${modelo}`);
  });
  const trechos = [
    "git for-each-ref",
    "the value in backticks",
    "\"other\"",
    "NEVER write anyone's initials",
    "ZERO questions",
  ];

  for (const trecho of trechos) {
    assert.ok(SPEC_INIT.includes(trecho), `spec-init nao cita ${trecho}`);
  }
});

test("should build the branch from Branch model and check it with git check-ref-format in spec-create", () => {
  const texto = normaliza(SPEC_CREATE.slice(SPEC_CREATE.indexOf("### Phase 0"), SPEC_CREATE.indexOf("### Phase 1")));
  const trechos = [
    "Branch model:",
    "spec initials --json",
    "spec initials set",
    "git check-ref-format --branch",
    "without surrounding backticks",
    "default `feat/<slug>`",
    "explicit \"yes\"",
  ];

  for (const trecho of trechos) {
    assert.ok(texto.includes(trecho), `spec-create nao cita ${trecho}`);
  }
});

test("should take the commit header limit from the constitution and not hardcode 72 in spec-create", () => {
  assert.ok(SPEC_CREATE.includes("Commit header max:"));
  assert.equal(SPEC_CREATE.includes("≤72"), false);
  assert.equal(SPEC_CREATE.includes("≤ 72"), false);
});

test("should keep the confirmation guards in spec-init and spec-create", () => {
  const trechosInit = ["NEVER force-push", "diverged remote", "PR flow detected", "opening order", "explicit \"yes\"", "never main/protected"];
  const trechosCreate = ["never force-push", "SEMANTIC conflicts", "diverged remote", "PR flow", "opening order", "protected branch", "explicit \"yes\""];

  for (const trecho of trechosInit) {
    assert.ok(SPEC_INIT.includes(trecho), `spec-init nao cita ${trecho}`);
  }
  for (const trecho of trechosCreate) {
    assert.ok(SPEC_CREATE.includes(trecho), `spec-create nao cita ${trecho}`);
  }
});
