import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "../../scripts/lib/tmp.mjs";

// Executa a CLI real em diretorio temporario fora de qualquer repositorio git, com HOME isolado.
const MGR_BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "mgr.js");

export function tempOutsideGit(label, prefix) {
  const dir = fs.realpathSync(tempDir(`${prefix}-${label}-`));
  const probe = spawnSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  assert.equal(probe.error, undefined, "git must be runnable to prove the temp dir is outside a repository");
  assert.notEqual(probe.status, 0, "the temp dir must not be inside a git work tree");
  return dir;
}

export function runMgr(args, { cwd, home }) {
  return spawnSync(process.execPath, [MGR_BIN, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120000,
    env: { ...process.env, LC_ALL: "C", HOME: home },
  });
}
