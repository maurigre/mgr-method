import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as bundle from "../src/bundle.js";
import { CURSOR_RULES, ROLE_STEMS, SDD_FILES } from "../src/sdd-check.js";
import { descartar, instalacaoLimpa } from "./fixtures/instalacao.js";

const BIN = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
const TEMPLATES_SDD = path.join(bundle.skillsDir(), "spec-init", "templates", "sdd");
const REVIEW_RULES = "09-review-rules.md";
const CANONICOS = SDD_FILES.map(({ file }) => file);
const ESPERADOS_TEMPLATES = CANONICOS.filter((arquivo) => arquivo !== REVIEW_RULES).sort();

const SECOES_POR_TEMPLATE = {
  "00-overview.md": ["What it is", "Purpose", "Product scope", "Main flow", "Supported platforms", "Current state"],
  "01-stack.md": ["Runtime and language", "Dependencies", "Build and distribution", "Tests", "CI/CD", "Monorepo"],
  "02-architecture.md": [
    "Structure",
    "Dependency rule",
    "Point exceptions and applied patterns",
    "Isolation boundaries",
    "Main use case flow",
    "Structural decisions",
    "Anti-patterns of this architecture",
  ],
  "03-contracts.md": [
    "Exposed interfaces",
    "Distribution contract",
    "File formats",
    "Configuration and state files",
    "Internal contracts between modules",
  ],
  "04-domain.md": ["Bounded context", "Entities and concepts", "Domain invariants", "Ubiquitous language"],
  "05-data.md": ["What the system persists", "Schemas", "Migrations", "Generated artifacts", "Retention"],
  "06-quality.md": ["What already exists (evidence)", "Automated gates", "Anti-inflation", "Mutation testing", "Test policy"],
  "07-operations.md": ["Pipelines", "Release and publication", "Versioning", "Observability"],
  "08-glossary.md": [],
  "CONSTITUTION.md": [
    "1. Identity",
    "2. Architectural principles",
    "3. Non-negotiable rules",
    "4. Quality standards",
    "5. Versioning policy",
    "6. Publication",
    "7. AI-First evidence",
    "8. Extended memory",
  ],
  "_self-assessment.md": [
    "Confidence per section",
    "Facts vs inferences",
    "Blind spots",
    "Questions to raise confidence",
    "Sampling applied",
    "Decisions left to define",
  ],
};

const titulosDo = (texto) =>
  texto.split(/\r?\n/).filter((linha) => linha.startsWith("## ")).map((linha) => linha.slice(3).trim());

test("should ship exactly one spec-init template per canonical file except the review guide", () => {
  assert.deepEqual(readdirSync(TEMPLATES_SDD).sort(), ESPERADOS_TEMPLATES);
});

test("should give each template the section headings of the spec in order", () => {
  for (const [arquivo, titulos] of Object.entries(SECOES_POR_TEMPLATE)) {
    const texto = readFileSync(path.join(TEMPLATES_SDD, arquivo), "utf8");
    assert.deepEqual(titulosDo(texto), titulos, `titulos divergem em ${arquivo}`);
  }
});

test("should name every canonical file, the four cursor rules and the extensions folder in spec-init", () => {
  const texto = readFileSync(path.join(bundle.skillsDir(), "spec-init", "SKILL.md"), "utf8");
  const citados = [...CANONICOS, ...CURSOR_RULES, "extensions/", "## Canonical SDD structure (both modes)", "git mv"];
  for (const nome of citados) {
    assert.ok(texto.includes(nome), `spec-init nao cita ${nome}`);
  }
  assert.ok((texto.match(/\n/g) ?? []).length <= 500, "spec-init/SKILL.md passa de 500 linhas");
});

const SEM_EXTENSAO = (nome) => nome.replace(/\.md$/, "");

const nomesComRadical = (texto) => (texto.match(/\b\d\d-[a-z-]+\b/g) ?? [])
  .filter((nome) => Object.values(ROLE_STEMS).flat().some((radical) => nome.includes(radical)));

test("should not hardcode SDD file names in spec-create, which resolves them with sdd-check --json", () => {
  const texto = readFileSync(path.join(bundle.skillsDir(), "spec-create", "SKILL.md"), "utf8");

  for (const nome of CANONICOS.filter((arquivo) => arquivo !== "CONSTITUTION.md")) {
    assert.equal(texto.includes(SEM_EXTENSAO(nome)), false, `spec-create cita ${nome}`);
  }
  assert.deepEqual(nomesComRadical(texto), [], "spec-create cita nome de SDD escrito a mao");
  assert.ok(texto.includes("sdd-check --json"), "spec-create nao cita sdd-check --json");
});

test("should let diagnosing-bugs read only canonical SDD names, without the runtime", () => {
  const texto = readFileSync(path.join(bundle.skillsDir(), "diagnosing-bugs", "SKILL.md"), "utf8");
  const canonicosSemExtensao = new Set(CANONICOS.map(SEM_EXTENSAO));

  assert.deepEqual(nomesComRadical(texto).filter((nome) => !canonicosSemExtensao.has(nome)), [],
    "diagnosing-bugs cita nome de SDD que nao e canonico");
  assert.equal(texto.includes("{{MGR_RUNTIME}}"), false, "diagnosing-bugs e exportada como plugin, que nao tem runtime");
});


test("should install the spec-init templates with the skill and leave doctor without divergent-body nor unresolved-token", () => {
  const repo = instalacaoLimpa();
  try {
    const templatesInstalados = path.join(repo, ".claude", "skills", "spec-init", "templates", "sdd");
    assert.deepEqual(readdirSync(templatesInstalados).sort(), ESPERADOS_TEMPLATES);
    const doctor = spawnSync(process.execPath, [BIN, "doctor", repo, "--json"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
    });
    const { findings } = JSON.parse(doctor.stdout);
    const achados = findings.filter(({ check }) => check === "divergent-body" || check === "unresolved-token");
    assert.deepEqual(achados, []);
  } finally {
    descartar(repo);
  }
});
