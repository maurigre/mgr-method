import { test } from "node:test";
import assert from "node:assert/strict";
import { DISTRIBUTED_SKILLS, LEGACY_SKILL_NAMES, distributesSkill } from "../src/catalog.js";
import * as bundle from "../src/bundle.js";
import { SKILL_MARKER, installEngine, isOurSkill, markSkill, orphanClass, routeReviewSkill } from "../src/builder.js";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frontmatter } from "../src/validator.js";
import { AUDITED, diagnose } from "../src/doctor.js";
import { descartar, instalacaoLimpa } from "./fixtures/instalacao.js";

const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/orfas-f0/", import.meta.url));

// Lista os arquivos da fixture com caminho relativo e separador `/`, como o SHA256SUMS.
function listFixtureFiles(dir = FIXTURE_DIR, base = dir) {
  const arquivos = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) arquivos.push(...listFixtureFiles(completo, base));
    else arquivos.push(path.relative(base, completo).split(path.sep).join("/"));
  }
  return arquivos.sort();
}

const SKILL_BASE = "---\nname: exemplo\ndescription: corpo de teste\n---\n# Corpo\n";

test("should list exactly the skill folders the package ships", () => {
  assert.deepEqual([...DISTRIBUTED_SKILLS].sort(), bundle.skillNames());
});

test("should keep legacy skill names disjoint from distributed ones", () => {
  assert.deepEqual(LEGACY_SKILL_NAMES.filter((name) => DISTRIBUTED_SKILLS.includes(name)), []);
});

test("should tell a shipped name from an unknown one", () => {
  assert.equal(distributesSkill("spec-create"), true);
  assert.equal(distributesSkill("evidence-capture"), true);
  assert.equal(distributesSkill("zz-nome-que-nao-existe"), false);
});

test("should treat a legacy name as shipped even though it is no longer distributed", () => {
  assert.equal(distributesSkill("skill-retirada", { legacy: ["skill-retirada"] }), true);
  assert.equal(distributesSkill("skill-retirada", { legacy: [] }), false);
});

test("should classify a renamed folder carrying its own mark as marked", () => {
  const skillText = markSkill(SKILL_BASE, "arch-antiga-renomeada");
  assert.equal(
    orphanClass({ name: "arch-antiga-renomeada", skillText, hasPluginManifest: false, lockedDirs: new Set() }),
    "marked",
  );
});

test("should not grant ownership when the mark names another folder", () => {
  const skillText = markSkill(SKILL_BASE, "spec-create");
  const classe = orphanClass({ name: "spec-create-copia", skillText, hasPluginManifest: false, lockedDirs: new Set() });
  assert.notEqual(classe, "marked");
  assert.equal(classe, "unknown");
});

test("should classify an unmarked shipped name as distributed", () => {
  assert.equal(
    orphanClass({ name: "spec-create", skillText: SKILL_BASE, hasPluginManifest: false, lockedDirs: new Set() }),
    "distributed",
  );
});

test("should never offer a folder with mgr-manifest.json", () => {
  const skillText = markSkill(SKILL_BASE, "spec-create");
  assert.equal(
    orphanClass({ name: "spec-create", skillText, hasPluginManifest: true, lockedDirs: new Set() }),
    "unknown",
  );
});

test("should treat a lockfile dir as unknown even when the name is shipped", () => {
  assert.equal(
    orphanClass({ name: "spec-create", skillText: SKILL_BASE, hasPluginManifest: false, lockedDirs: new Set(["spec-create"]) }),
    "unknown",
  );
});

test("should keep the orfas-f0 fixture byte-identical to SHA256SUMS", () => {
  const linhas = readFileSync(path.join(FIXTURE_DIR, "SHA256SUMS"), "utf8").split("\n").filter(Boolean);
  const listados = linhas.map((linha) => {
    const casa = linha.match(/^([0-9a-f]{64}) {2}(.+)$/);
    assert.ok(casa, `linha fora do formato sha256sum: ${linha}`);
    return { hash: casa[1], arquivo: casa[2] };
  });
  assert.deepEqual(listados.map((item) => item.arquivo), listFixtureFiles().filter((arquivo) => arquivo !== "SHA256SUMS"));
  for (const { hash, arquivo } of listados) {
    const real = createHash("sha256").update(readFileSync(path.join(FIXTURE_DIR, ...arquivo.split("/")))).digest("hex");
    assert.equal(real, hash, `hash diverge em ${arquivo}`);
  }
});

test("should carry no ownership mark and no mgr-manifest.json in the orfas-f0 fixture", () => {
  for (const arquivo of listFixtureFiles()) {
    if (path.posix.basename(arquivo) === "mgr-manifest.json") {
      assert.fail(`pasta da fixture contém mgr-manifest.json: ${arquivo}`);
    }
    if (path.posix.basename(arquivo) === "SKILL.md") {
      const texto = readFileSync(path.join(FIXTURE_DIR, ...arquivo.split("/")), "utf8");
      assert.equal(texto.includes("mgr-managed-skill"), false, `SKILL.md com marca: ${arquivo}`);
    }
  }
});

test("should mark a skill once even when marked twice", () => {
  const umaVez = markSkill(SKILL_BASE, "spec-create");
  const duasVezes = markSkill(umaVez, "spec-create");
  assert.equal(duasVezes, umaVez);
  assert.equal(duasVezes.split("\n").filter((linha) => linha.startsWith("# mgr-managed-skill:")).length, 1);
  assert.equal(duasVezes.split("\n").at(-4), "# mgr-managed-skill: spec-create");
});

test("should not grant ownership for a mark line that sits in the body", () => {
  const text = "---\nname: arch-hexagonal\n---\n\n# mgr-managed-skill: arch-hexagonal\n";
  assert.equal(isOurSkill(text, "arch-hexagonal"), false);
  assert.equal(isOurSkill(markSkill(text, "arch-hexagonal"), "arch-hexagonal"), true);
});

// Última linha do frontmatter: o texto começa em `---\n` e o fecho é o primeiro `\n---` depois.
function ultimaLinhaDoFrontmatter(texto) {
  const fim = texto.indexOf("\n---", 3);
  return texto.slice(4, fim).split("\n").at(-1);
}

test("should end every installed method skill frontmatter with its ownership mark", () => {
  const repo = instalacaoLimpa();
  try {
    const { skills } = JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8"));
    assert.ok(skills.length > 0, "a instalação declara skills");
    for (const name of skills) {
      const texto = readFileSync(path.join(repo, ".claude", "skills", name, "SKILL.md"), "utf8");
      assert.equal(ultimaLinhaDoFrontmatter(texto), `# mgr-managed-skill: ${name}`, `marca fora do fim do frontmatter em ${name}`);
    }
  } finally {
    descartar(repo);
  }
});

test("should keep the mark as the last frontmatter line of the routed review skill", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mgr-marca-"));
  try {
    installEngine(dir, ["code-analyzer"], { engineId: "claude-code", reviewGate: { enabled: true } });
    const texto = readFileSync(path.join(dir, "code-analyzer", "SKILL.md"), "utf8");
    assert.match(texto, /context: fork/, "a skill de review foi roteada");
    assert.equal(ultimaLinhaDoFrontmatter(texto), "# mgr-managed-skill: code-analyzer");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should parse the installed frontmatter to the same object as the routed source", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mgr-marca-"));
  try {
    installEngine(dir, ["code-analyzer"], { engineId: "claude-code", reviewGate: { enabled: true } });
    const instalada = readFileSync(path.join(dir, "code-analyzer", "SKILL.md"), "utf8");
    const fonte = readFileSync(path.join(bundle.skillsDir(), "code-analyzer", "SKILL.md"), "utf8");
    const roteada = routeReviewSkill("claude-code", fonte);
    assert.equal(frontmatter(instalada).context, "fork", "o objeto comparado tem o campo de roteamento");
    assert.deepEqual(frontmatter(instalada), frontmatter(roteada), "a marca é comentário e não altera o objeto");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should report no divergent-body nor unresolved-token on a fresh install", () => {
  const repo = instalacaoLimpa();
  try {
    const { outcome, findings } = diagnose(repo);
    assert.equal(outcome, AUDITED, "a instalação limpa sai auditada, senão o teste não afirma nada");
    const achados = findings.filter(({ check }) => check === "divergent-body" || check === "unresolved-token");
    assert.deepEqual(achados, []);
  } finally {
    descartar(repo);
  }
});

test("should fix the ownership mark literal of DT-5", () => {
  assert.equal(SKILL_MARKER, "mgr-managed-skill");
});

test("should refuse to mark a text without frontmatter and name the skill", () => {
  assert.throws(() => markSkill("sem frontmatter", "x"), /SKILL\.md of x has no YAML frontmatter/);
  assert.equal(isOurSkill("sem frontmatter", "x"), false);
});

test("should keep CRLF line endings when marking and leave the body byte for byte", () => {
  const marked = markSkill("---\r\nname: x\r\n---\r\ncorpo\r\n", "x");
  assert.equal(marked, "---\r\nname: x\r\n# mgr-managed-skill: x\r\n---\r\ncorpo\r\n");
  assert.equal(isOurSkill(marked, "x"), true);
});

test("should mark an empty frontmatter inside it even when the body has a horizontal rule", () => {
  assert.equal(markSkill("---\n---\ncorpo\n", "x"), "---\n# mgr-managed-skill: x\n---\ncorpo\n");
  assert.equal(markSkill("---\n---\ncorpo\n---\nfim\n", "x"), "---\n# mgr-managed-skill: x\n---\ncorpo\n---\nfim\n");
  assert.equal(isOurSkill("---\n---\ncorpo\n# mgr-managed-skill: x\n---\n", "x"), false);
});

test("should replace a mark naming another folder when remarking", () => {
  const remarked = markSkill(markSkill("---\nname: a\n---\n", "a"), "b");
  assert.equal(remarked, "---\nname: a\n# mgr-managed-skill: b\n---\n");
});
