import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execute, planInstall, runtimeRef } from "../src/installer.js";
import { resolveRuntime } from "../src/builder.js";
import { RUNTIME_FILES, RUNTIME_TOKEN } from "../src/catalog.js";
import { fileURLToPath } from "node:url";

const PKG_ROOT_FOR_TESTS = fileURLToPath(new URL("../", import.meta.url));
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const ENGINE_DIRS = [".claude/skills", ".github/skills"];

function installBoth() {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mgr-runtime-"));
  execute(planInstall(["claude-code", "copilot"], "project", repo, { all: true }));
  return repo;
}

test("should install the runtime entry point in both engines", () => {
  const repo = installBoth();
  try {
    for (const rel of ENGINE_DIRS) {
      assert.ok(existsSync(path.join(repo, rel, "_shared", "mgr", "bin", "mgr-runtime.js")), rel);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("should generate a package.json that is private, module, versioned and nameless", () => {
  const repo = installBoth();
  const version = JSON.parse(readFileSync(path.join(PKG_ROOT_FOR_TESTS, "package.json"), "utf8")).version;
  try {
    for (const rel of ENGINE_DIRS) {
      const generated = JSON.parse(readFileSync(path.join(repo, rel, "_shared", "mgr", "package.json"), "utf8"));
      assert.equal(generated.type, "module");
      assert.equal(generated.private, true);
      assert.equal(generated.version, version);
      assert.equal("name" in generated, false);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("should copy every runtime file byte for byte in each engine", () => {
  const repo = installBoth();
  try {
    for (const rel of ENGINE_DIRS) {
      for (const file of RUNTIME_FILES) {
        const copy = path.join(repo, rel, "_shared", "mgr", ...file.split("/"));
        assert.equal(sha(copy), sha(path.join(PKG_ROOT_FOR_TESTS, ...file.split("/"))), `${rel}/${file}`);
      }
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
    const expected = "minhas-skills/_shared/mgr/bin/mgr-runtime.js";
    assert.ok(text.includes(expected), "caminho relativo à raiz ausente");
    assert.equal(text.includes(RUNTIME_TOKEN), false, "token cru sobrou");
    assert.ok(existsSync(path.join(repo, ...expected.split("/"))), "o caminho não existe no disco");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("should leave no stale file behind when reinstalling", () => {
  const repo = installBoth();
  try {
    const stale = path.join(repo, ".claude/skills", "_shared", "mgr", "old", "stale.js");
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
  assert.equal(
    runtimeRef(path.join(repo, ".claude", "skills"), "project", repo),
    ".claude/skills/_shared/mgr/bin/mgr-runtime.js",
  );
  assert.equal(
    runtimeRef(path.join(repo, ".github", "skills"), "project", repo),
    ".github/skills/_shared/mgr/bin/mgr-runtime.js",
  );
});

test("should resolve the runtime path as absolute in global scope", () => {
  const home = path.join(os.tmpdir(), "mgr-ref-home");
  const claude = path.join(home, ".claude", "skills");
  const copilot = path.join(home, ".copilot", "skills");
  assert.equal(runtimeRef(claude, "global", "/ignored"), path.join(claude, "_shared", "mgr", "bin", "mgr-runtime.js"));
  assert.equal(runtimeRef(copilot, "global", "/ignored"), path.join(copilot, "_shared", "mgr", "bin", "mgr-runtime.js"));
  assert.ok(path.isAbsolute(runtimeRef(copilot, "global", "/ignored")));
});

test("should replace every runtime token with the given reference", () => {
  const text = `run ${RUNTIME_TOKEN} a\nand ${RUNTIME_TOKEN} b`;
  assert.equal(resolveRuntime(text, "x/mgr-runtime.js"), "run x/mgr-runtime.js a\nand x/mgr-runtime.js b");
});

test("should fall back to the default relative path when no reference is given", () => {
  assert.equal(resolveRuntime(RUNTIME_TOKEN), "_shared/mgr/bin/mgr-runtime.js");
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
