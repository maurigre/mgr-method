import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as bundle from "../src/bundle.js";
import { buildRuntime, buildSkill, installEngine } from "../src/builder.js";
import * as installer from "../src/installer.js";
import * as catalog from "../src/catalog.js";
import { validateAll, validateSkill, checkSkill } from "../src/validator.js";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "mgr-"));
const CORE = ["spec-init", "spec-create", "spec-execute", "adr-create", "code-analyzer"];

test("skills do fluxo SDD presentes e válidas", () => {
  const names = bundle.skillNames();
  for (const n of CORE) assert.ok(names.includes(n), `faltando ${n}`);
  for (const [n, problems] of Object.entries(validateAll())) {
    assert.equal(problems.length, 0, `${n}: ${problems.join("; ")}`);
  }
});

test("selectSkills monta o subconjunto por linguagem/arquitetura", () => {
  const s = catalog.selectSkills({ architecture: "hexagonal", language: "java" });
  for (const c of CORE) assert.ok(s.includes(c), c);
  assert.ok(s.includes("arch-hexagonal") && s.includes("junit-clean"));
  assert.ok(!s.includes("arch-clean") && !s.includes("arch-onion") && !s.includes("arch-layered"));
  assert.ok(!s.includes("evidence-capture"));

  const s2 = catalog.selectSkills({ architecture: "clean", optional: ["evidence-capture"] });
  assert.ok(s2.includes("arch-clean") && s2.includes("evidence-capture"));
  assert.ok(!s2.includes("junit-clean"));

  assert.throws(() => catalog.selectSkills({ architecture: "xyz" }), /arquitetura desconhecida/);
});

test("install autossuficiente: só o subconjunto na pasta do motor, sem .mgr-core", () => {
  const repo = tmp();
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { language: "java", architecture: "hexagonal" }));
  const sk = path.join(repo, ".claude", "skills");

  for (const n of [...CORE, "arch-hexagonal", "junit-clean"]) {
    assert.ok(existsSync(path.join(sk, n, "SKILL.md")), `deveria instalar ${n}`);
  }
  for (const n of ["arch-clean", "arch-onion", "arch-layered", "evidence-capture"]) {
    assert.ok(!existsSync(path.join(sk, n)), `${n} não deveria existir`);
  }
  assert.ok(!existsSync(path.join(repo, ".mgr-core")), "não deve criar .mgr-core");

  assert.ok(existsSync(path.join(sk, "_shared", "arch", "regras-transversais.md")));
  const archMd = readFileSync(path.join(sk, "arch-hexagonal", "SKILL.md"), "utf8");
  assert.ok(!archMd.includes("{{MGR_ARCH_RULES}}"), "token deve ser resolvido");
  assert.ok(archMd.includes("_shared/arch/regras-transversais.md"), "deve apontar para a fonte co-locada");

  const man = JSON.parse(readFileSync(path.join(sk, ".mgr-manifest.json"), "utf8"));
  assert.equal(man.model, "self-contained");
  assert.equal(man.architecture, "hexagonal");
  assert.equal(man.language, "java");
});

test("dois motores: cada um autossuficiente e independente", () => {
  const repo = tmp();
  installer.execute(installer.planInstall(["claude-code", "copilot"], "project", repo, { architecture: "onion" }));
  for (const dir of [".claude/skills", ".github/skills"]) {
    assert.ok(existsSync(path.join(repo, dir, "spec-init", "SKILL.md")), dir);
    assert.ok(existsSync(path.join(repo, dir, "arch-onion", "SKILL.md")), dir);
    assert.ok(existsSync(path.join(repo, dir, ".mgr-manifest.json")), dir);
  }
});

test("migra instalação antiga (runtime-launcher) para o novo layout", () => {
  const repo = tmp();
  const core = path.join(repo, ".mgr-core");
  mkdirSync(path.join(core, "skills"), { recursive: true });
  mkdirSync(path.join(repo, ".claude", "skills", "spec-init"), { recursive: true });
  writeFileSync(path.join(repo, ".claude", "skills", "spec-init", "SKILL.md"), "launcher antigo", "utf8");
  writeFileSync(path.join(core, "manifest.json"), JSON.stringify({
    model: "runtime-launcher", version: "0.0.1", engines: ["claude-code"], scope: "project",
    skillsDirs: [".claude/skills"], skills: ["spec-init"],
  }), "utf8");

  const res = installer.execute(installer.planInstall(["claude-code"], "project", repo, { architecture: "hexagonal" }));
  assert.ok(res.migrated, "deve reportar migração");
  assert.ok(!existsSync(core), ".mgr-core deve ser removido");
  const md = readFileSync(path.join(repo, ".claude/skills/spec-init/SKILL.md"), "utf8");
  assert.ok(md.includes("name: spec-init") && !md.includes("launcher antigo"));
});

test("uninstall remove skills e preserva docs/specs", () => {
  const repo = tmp();
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { architecture: "hexagonal" }));
  mkdirSync(path.join(repo, "docs", "sdd"), { recursive: true });
  mkdirSync(path.join(repo, "specs", "keep"), { recursive: true });

  installer.uninstall("project", repo);
  assert.ok(!existsSync(path.join(repo, ".claude/skills/spec-init")));
  assert.ok(!existsSync(path.join(repo, ".claude/skills/_shared")));
  assert.ok(existsSync(path.join(repo, "docs", "sdd")));
  assert.ok(existsSync(path.join(repo, "specs", "keep")));
});

test("update re-sincroniza preservando o conjunto instalado", () => {
  const repo = tmp();
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { architecture: "clean", language: "java" }));
  const res = installer.update("project", repo);
  assert.ok(res.skills.includes("arch-clean") && res.skills.includes("junit-clean"));
  assert.ok(!res.skills.includes("arch-hexagonal"));
});

test("copilot vai para .github/skills sem tocar .claude", () => {
  const repo = tmp();
  installer.execute(installer.planInstall(["copilot"], "project", repo, { architecture: "hexagonal" }));
  assert.ok(existsSync(path.join(repo, ".github/skills/code-analyzer/SKILL.md")));
  assert.ok(!existsSync(path.join(repo, ".claude")));
});

test("instalação com --skills-dir (custom)", () => {
  const repo = tmp();
  const custom = path.join(repo, "meus-skills");
  const plan = installer.planInstall([], "project", repo, { skillsDir: custom, names: ["spec-init"] });
  assert.deepEqual(plan.engines, ["custom"]);
  installer.execute(plan);
  assert.ok(existsSync(path.join(custom, "spec-init", "SKILL.md")));
});

test("planInstall rejeita motor desconhecido", () => {
  assert.throws(() => installer.planInstall(["motor-x"], "project", tmp(), { architecture: "hexagonal" }), /motor inválido/);
});

test("buildRuntime gera skills + shared num diretório", () => {
  const dir = path.join(tmp(), "rt");
  buildRuntime(dir, ["spec-init"]);
  assert.ok(existsSync(path.join(dir, "skills", "spec-init", "SKILL.md")));
  assert.ok(existsSync(path.join(dir, "shared", "arch", "regras-transversais.md")));
});

test("bundle.pkgDir lança para recurso ausente e readVersion retorna semver", () => {
  assert.throws(() => bundle.pkgDir("nao-existe"), /recurso do MGR ausente/);
  assert.match(bundle.readVersion(), /^\d+\.\d+\.\d+/);
  assert.ok(existsSync(bundle.skillsDir()) && existsSync(bundle.sharedDir()));
});

test("buildSkill lança para skill inexistente", () => {
  assert.throws(() => buildSkill("nao-existe", path.join(tmp(), "skills")), /skill inexistente/);
});

test("validateSkill reporta SKILL.md ausente", () => {
  assert.deepEqual(validateSkill("nao-existe"), ["nao-existe: falta SKILL.md"]);
});

test("checkSkill cobre frontmatter, name, description e tamanho", () => {
  const desc = "d".repeat(50);
  assert.deepEqual(checkSkill("x", "sem frontmatter"), ["x: sem frontmatter YAML (--- ... ---)"]);

  const semName = checkSkill("foo", `---\ndescription: ${desc}\n---\n`);
  assert.ok(semName.some((p) => p.includes("sem `name`")));

  const nomeRuim = checkSkill("foo", `---\nname: Foo Bar\ndescription: ${desc}\n---\n`);
  assert.ok(nomeRuim.some((p) => p.includes("kebab-case")));
  assert.ok(nomeRuim.some((p) => p.includes("difere do nome da pasta")));

  const descCurta = checkSkill("foo", "---\nname: foo\ndescription: curta\n---\n");
  assert.ok(descCurta.some((p) => p.includes("curta demais")));

  const longo = checkSkill("foo", `---\nname: foo\ndescription: ${desc}\n---\n${"\n".repeat(501)}`);
  assert.ok(longo.some((p) => p.includes("linhas")));

  assert.deepEqual(checkSkill("foo", `---\nname: foo\ndescription: ${desc}\n---\n`), []);
});
