import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execute, planInstall, runtimeRef } from "../src/installer.js";
import { resolveRuntime } from "../src/builder.js";
import { RUNTIME_FILES, RUNTIME_TOKEN } from "../src/catalog.js";
import { MODEL_CORE_RUNTIME } from "../src/manifest.js";
import { fileURLToPath } from "node:url";

const PKG_ROOT_FOR_TESTS = fileURLToPath(new URL("../", import.meta.url));
const MGR_BIN = path.resolve(import.meta.dirname, "..", "bin", "mgr.js");
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const ENGINE_DIRS = [".claude/skills", ".github/skills"];
const RUNTIME_REL = [".mgr-core", "runtime"];
const ENTRY_REL = [...RUNTIME_REL, "bin", "mgr-runtime.js"];
const ENTRY_REF = ".mgr-core/runtime/bin/mgr-runtime.js";

function installBoth() {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mgr-runtime-"));
  execute(planInstall(["claude-code", "copilot"], "project", repo, { all: true }));
  return repo;
}

function runMgr(args, env = {}, cwd = undefined) {
  return spawnSync(process.execPath, [MGR_BIN, ...args], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, LC_ALL: "C", ...env },
    cwd,
  });
}

test("should install one runtime entry point in .mgr-core shared by both engines", () => {
  const repo = installBoth();
  try {
    assert.ok(existsSync(path.join(repo, ...ENTRY_REL)));
    for (const rel of ENGINE_DIRS) {
      assert.equal(existsSync(path.join(repo, rel, "_shared", "mgr")), false, rel);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("should generate a package.json that is private, module, versioned and nameless", () => {
  const repo = installBoth();
  const version = JSON.parse(readFileSync(path.join(PKG_ROOT_FOR_TESTS, "package.json"), "utf8")).version;
  try {
    const generated = JSON.parse(readFileSync(path.join(repo, ...RUNTIME_REL, "package.json"), "utf8"));
    assert.equal(generated.type, "module");
    assert.equal(generated.private, true);
    assert.equal(generated.version, version);
    assert.equal("name" in generated, false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("should copy every runtime file byte for byte into the core runtime", () => {
  const repo = installBoth();
  try {
    for (const file of RUNTIME_FILES) {
      const copy = path.join(repo, ...RUNTIME_REL, ...file.split("/"));
      assert.equal(sha(copy), sha(path.join(PKG_ROOT_FOR_TESTS, ...file.split("/"))), file);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("should resolve the runtime token to a root-relative path that exists when using --skills-dir", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mgr-runtime-custom-"));
  try {
    const skillsDir = path.join(repo, "minhas-skills");
    execute(planInstall([], "project", repo, { skillsDir, names: ["spec-init"] }));
    const text = readFileSync(path.join(skillsDir, "spec-init", "SKILL.md"), "utf8");
    assert.ok(text.includes(ENTRY_REF), "caminho relativo à raiz ausente");
    assert.equal(text.includes(RUNTIME_TOKEN), false, "token cru sobrou");
    assert.ok(existsSync(path.join(repo, ...ENTRY_REF.split("/"))), "o caminho não existe no disco");
    assert.equal(existsSync(path.join(skillsDir, "_shared", "mgr")), false, "minhas-skills/_shared/mgr existe");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("should leave no stale file behind in the core runtime when reinstalling", () => {
  const repo = installBoth();
  try {
    const stale = path.join(repo, ...RUNTIME_REL, "old", "stale.js");
    mkdirSync(path.dirname(stale), { recursive: true });
    writeFileSync(stale, "x", "utf8");
    execute(planInstall(["claude-code", "copilot"], "project", repo, { all: true }));
    assert.equal(existsSync(stale), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("should resolve the runtime path relative to the repo with slashes in project scope", () => {
  const repo = path.join(os.tmpdir(), "mgr-ref-repo");
  assert.equal(runtimeRef("project", repo), ENTRY_REF);
});

test("should resolve the runtime path as absolute in global scope", () => {
  const entry = path.join(os.homedir(), ".mgr-core", "runtime", "bin", "mgr-runtime.js");
  assert.equal(runtimeRef("global", "/ignored"), entry);
  assert.ok(path.isAbsolute(runtimeRef("global", "/ignored")));
});

test("should replace every runtime token with the given reference", () => {
  const text = `run ${RUNTIME_TOKEN} a\nand ${RUNTIME_TOKEN} b`;
  assert.equal(resolveRuntime(text, "x/mgr-runtime.js"), "run x/mgr-runtime.js a\nand x/mgr-runtime.js b");
});

test("should fall back to the core runtime path when no reference is given", () => {
  assert.equal(resolveRuntime(RUNTIME_TOKEN), ENTRY_REF);
});

test("should leave no runtime token in any installed SKILL.md", () => {
  const repo = installBoth();
  try {
    for (const rel of ENGINE_DIRS) {
      const root = path.join(repo, rel);
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        const md = path.join(root, entry.name, "SKILL.md");
        if (!entry.isDirectory() || !existsSync(md)) continue;
        assert.equal(readFileSync(md, "utf8").includes(RUNTIME_TOKEN), false, `${rel}/${entry.name}`);
      }
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("should leave one core runtime and no per-engine copy after a project install with both engines", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mgr-runtime-cli-"));
  try {
    const run = runMgr(["install", "--engine", "both", "--scope", "project", "--all-skills", "-y", "--user-language", "en", repo]);
    assert.equal(run.status, 0, run.stderr);
    const manifest = JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8"));
    assert.ok(existsSync(path.join(repo, ...ENTRY_REL)));
    const pkg = JSON.parse(readFileSync(path.join(repo, ...RUNTIME_REL, "package.json"), "utf8"));
    assert.equal(pkg.type, "module");
    assert.equal(pkg.private, true);
    assert.equal(pkg.version, manifest.version);
    assert.equal("name" in pkg, false);
    for (const rel of ENGINE_DIRS) {
      assert.equal(existsSync(path.join(repo, rel, "_shared", "mgr")), false, rel);
      assert.ok(existsSync(path.join(repo, rel, "_shared", "laws", "execution-laws.md")), rel);
      assert.ok(existsSync(path.join(repo, rel, "_shared", "charter", "core-principles.md")), rel);
    }
    assert.equal(manifest.model, MODEL_CORE_RUNTIME);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("should install the runtime under the global home and reference it by absolute path when installing globally", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "mgr-runtime-home-"));
  const projeto = mkdtempSync(path.join(os.tmpdir(), "mgr-runtime-home-cwd-"));
  try {
    const run = runMgr(["install", "--engine", "both", "--scope", "global", "--all-skills", "-y", "--user-language", "en", projeto], { HOME: home }, projeto);
    assert.equal(run.status, 0, run.stderr);
    const entry = path.join(home, ...ENTRY_REL);
    assert.ok(existsSync(entry));
    assert.equal(existsSync(path.join(home, ".claude", "skills", "_shared", "mgr")), false);
    assert.equal(existsSync(path.join(home, ".copilot", "skills", "_shared", "mgr")), false);
    const spec = readFileSync(path.join(home, ".claude", "skills", "spec-init", "SKILL.md"), "utf8");
    assert.ok(spec.includes(entry));
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(projeto, { recursive: true, force: true });
  }
});
