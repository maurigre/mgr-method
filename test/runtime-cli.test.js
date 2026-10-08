import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(ROOT, "bin", "mgr-runtime.js");

const runIn = (cwd, ...args) => spawnSync(process.execPath, [ENTRY, ...args], {
  cwd,
  encoding: "utf8",
  env: { ...process.env, LC_ALL: "C" },
});

const run = (...args) => runIn(ROOT, ...args);

const comProjeto = (teste) => () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mgr-runtime-"));
  try {
    mkdirSync(path.join(dir, "docs", "sdd"), { recursive: true });
    mkdirSync(path.join(dir, "specs", "demo"), { recursive: true });
    writeFileSync(path.join(dir, "docs", "sdd", "CONSTITUTION.md"), "# Constituicao\n");
    writeFileSync(path.join(dir, "docs", "sdd", "00-overview.md"), "# Visao geral\n");
    writeFileSync(path.join(dir, "specs", "demo", "01-brief.md"), "# Brief\n");
    teste(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("should list the runtime commands on help", () => {
  const helpRun = run("help");
  assert.equal(helpRun.status, 0);
  assert.match(helpRun.stdout, /spec status/);
});

test("should print valid JSON on spec status --all --json", comProjeto((dir) => {
  const statusRun = runIn(dir, "spec", "status", "--all", "--json");
  assert.equal(statusRun.status, 0);
  assert.doesNotThrow(() => JSON.parse(statusRun.stdout));
}));

test("should exit 0 on agents --json", comProjeto((dir) => {
  const agentsRun = runIn(dir, "agents", "--json");
  assert.equal(agentsRun.status, 0);
}));

test("should report SDD OK on sdd-check", comProjeto((dir) => {
  const checkRun = runIn(dir, "sdd-check");
  assert.equal(checkRun.status, 0);
  assert.match(checkRun.stdout, /SDD OK/);
}));

test("should print the runtime version line on version", () => {
  const versionRun = run("version");
  assert.equal(versionRun.status, 0);
  assert.match(versionRun.stdout, /\(runtime do projeto\)/);
});

test("should refuse a lifecycle command and point to npx", () => {
  const lifecycleRun = run("install");
  assert.equal(lifecycleRun.status, 1);
  assert.match(lifecycleRun.stderr, /npx mgr-method@/);
});

test("should exit 1 on an unknown flag", () => {
  const flagRun = run("help", "--nope");
  assert.equal(flagRun.status, 1);
  assert.match(flagRun.stderr, /--nope/);
});

test("should exit 1 on an unknown spec subcommand", comProjeto((dir) => {
  const subRun = runIn(dir, "spec", "zzz");
  assert.equal(subRun.status, 1);
  assert.match(subRun.stderr, /unknown command: spec zzz/);
}));

test("should exit 1 on detect without --hook", comProjeto((dir) => {
  const detectRun = runIn(dir, "detect");
  assert.equal(detectRun.status, 1);
  assert.match(detectRun.stderr, /detect requires --hook/);
}));

test("should exit 1 as unknown command when the command starts with a dash", comProjeto((dir) => {
  const dashRun = runIn(dir, "--zzz");
  assert.equal(dashRun.status, 1);
  assert.match(dashRun.stderr, /unknown command/);
}));

test("should refuse a lifecycle command in pt-BR when the manifest userLanguage is pt-BR", comProjeto((dir) => {
  mkdirSync(path.join(dir, ".mgr-core"), { recursive: true });
  writeFileSync(path.join(dir, ".mgr-core", "manifest.json"), JSON.stringify({ userLanguage: "pt-BR" }));
  const ptRun = runIn(dir, "install");
  assert.equal(ptRun.status, 1);
  assert.match(ptRun.stderr, /install é ciclo de vida e não roda no runtime do projeto: rode npx mgr-method@latest install/);
}));

test("should answer help and an unknown flag in pt-BR when the manifest userLanguage is pt-BR", comProjeto((dir) => {
  mkdirSync(path.join(dir, ".mgr-core"), { recursive: true });
  writeFileSync(path.join(dir, ".mgr-core", "manifest.json"), JSON.stringify({ userLanguage: "pt-BR", version: "1.2.3" }));
  const helpRun = runIn(dir, "help");
  assert.equal(helpRun.status, 0);
  assert.match(helpRun.stdout, /^runtime do projeto mgr-method$/m);
  assert.match(helpRun.stdout, /rodam por npx mgr-method@1\.2\.3\./);
  const flagRun = runIn(dir, "help", "--nope");
  assert.equal(flagRun.status, 1);
  assert.equal(flagRun.stderr, "flag desconhecida: --nope\n");
}));

test("should answer help and an unknown flag in English when the manifest userLanguage is en", comProjeto((dir) => {
  mkdirSync(path.join(dir, ".mgr-core"), { recursive: true });
  writeFileSync(path.join(dir, ".mgr-core", "manifest.json"), JSON.stringify({ userLanguage: "en" }));
  const helpRun = runIn(dir, "help");
  assert.match(helpRun.stdout, /^mgr-method project runtime$/m);
  assert.match(helpRun.stdout, /run through npx mgr-method@latest\./);
  assert.equal(runIn(dir, "help", "--nope").stderr, "unknown flag: --nope\n");
}));
