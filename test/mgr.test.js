import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as bundle from "../src/bundle.js";
import { buildRuntime, generateLauncher, buildSkill } from "../src/builder.js";
import * as installer from "../src/installer.js";
import { readManifest } from "../src/manifest.js";
import { validateAll, validateSkill, checkSkill } from "../src/validator.js";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "mgr-"));
const CORE = ["spec-init", "spec-create", "spec-execute", "adr-create", "code-analyzer", "junit-clean", "arch-hexagonal", "evidence-capture"];

test("skills do fluxo SDD presentes e válidas", () => {
  const names = bundle.skillNames();
  for (const n of CORE) assert.ok(names.includes(n), `faltando ${n}`);
  for (const [n, problems] of Object.entries(validateAll())) {
    assert.equal(problems.length, 0, `${n}: ${problems.join("; ")}`);
  }
});

test("runtime .mgr-core com skills e launcher apontando pra lá", () => {
  const dir = tmp();
  const runtime = path.join(dir, ".mgr-core");
  const names = buildRuntime(runtime);
  for (const n of names) assert.ok(existsSync(path.join(runtime, "skills", n, "SKILL.md")));
  assert.ok(existsSync(path.join(runtime, "shared", "scripts", "sdd-check.sh")));

  const launchers = path.join(dir, ".claude", "skills");
  generateLauncher("spec-create", ".mgr-core/skills/spec-create", launchers);
  const text = readFileSync(path.join(launchers, "spec-create", "SKILL.md"), "utf8");
  assert.ok(text.includes("name: spec-create"));
  assert.ok(text.includes(".mgr-core/skills/spec-create/SKILL.md"));
});

test("templates do spec-create acompanham o runtime", () => {
  const runtime = path.join(tmp(), ".mgr-core");
  buildRuntime(runtime);
  for (const f of ["01-brief.md", "04-plan.md", "06-completion.md", "handoff.md"]) {
    assert.ok(existsSync(path.join(runtime, "skills", "spec-create", "templates", f)), f);
  }
});

test("ciclo install/update/uninstall preserva specs e docs", () => {
  const repo = tmp();
  installer.execute(installer.planInstall(["claude-code", "copilot"], "project", repo));
  const man = readManifest(path.join(repo, ".mgr-core"));
  assert.deepEqual(man.engines, ["claude-code", "copilot"]);
  assert.ok(existsSync(path.join(repo, ".claude/skills/spec-init/SKILL.md")));

  installer.update("project", repo);

  mkdirSync(path.join(repo, "docs", "sdd"), { recursive: true });
  mkdirSync(path.join(repo, "specs", "keep"), { recursive: true });
  installer.uninstall("project", repo);
  assert.ok(!existsSync(path.join(repo, ".mgr-core")));
  assert.ok(!existsSync(path.join(repo, ".claude/skills/spec-init")));
  assert.ok(!existsSync(path.join(repo, ".github/skills/spec-init")));
  assert.ok(existsSync(path.join(repo, "docs", "sdd")));
  assert.ok(existsSync(path.join(repo, "specs", "keep")));
});

test("copilot vai para .github/skills sem tocar .claude", () => {
  const repo = tmp();
  installer.execute(installer.planInstall(["copilot"], "project", repo));
  assert.ok(existsSync(path.join(repo, ".github/skills/code-analyzer/SKILL.md")));
  assert.ok(!existsSync(path.join(repo, ".claude")));
});

test("detect e detectPrior enxergam a instalação de projeto", () => {
  const repo = tmp();
  assert.equal(installer.detectPrior("project", repo), null);
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { names: ["spec-init"] }));

  const found = installer.detect(repo);
  const claude = found.find((f) => f.path.endsWith(path.join(".claude", "skills")));
  assert.ok(claude, "deveria detectar .claude/skills");
  assert.ok(claude.count >= 1, "deveria contar as skills instaladas");

  const man = installer.detectPrior("project", repo);
  assert.ok(man && man.engines.includes("claude-code"));
});

test("instalação com --skills-dir (custom) e update reutilizam o diretório", () => {
  const repo = tmp();
  const custom = path.join(repo, "meus-skills");
  const plan = installer.planInstall([], "project", repo, { skillsDir: custom, names: ["spec-init"] });
  assert.deepEqual(plan.engines, ["custom"]);
  installer.execute(plan);
  assert.ok(existsSync(path.join(custom, "spec-init", "SKILL.md")));

  const res = installer.update("project", repo);
  assert.ok(res.targets.some((t) => path.resolve(t.dir) === path.resolve(custom)));
});

test("planInstall rejeita motor desconhecido", () => {
  assert.throws(() => installer.planInstall(["motor-x"], "project", tmp()), /motor inválido/);
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
