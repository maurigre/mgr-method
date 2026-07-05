import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as bundle from "../src/bundle.js";
import { buildRuntime, generateLauncher } from "../src/builder.js";
import * as installer from "../src/installer.js";
import { readManifest } from "../src/manifest.js";
import { validateAll } from "../src/validator.js";

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
