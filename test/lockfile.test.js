import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  diff, emptyLockfile, lockfilePath, readLockfile, removeSkill, upsertSkill,
  writeLockfile, LOCKFILE_NAME, LOCKFILE_VERSION,
} from "../src/lockfile.js";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "mgr-lock-"));

const MGR_ORIGIN = { name: "mgr", url: "https://raw.example/mgr/index.json", trusted: true };
const COMPANY_ORIGIN = { name: "empresa", url: "https://registry.empresa.dev/index.json", trusted: false };

const entry = (overrides = {}) => ({
  version: "1.0.0",
  registry: "mgr",
  checksum: `sha256-${"a".repeat(64)}`,
  category: "language",
  dir: "junit-clean",
  engines: ["claude-code", "copilot"],
  applied: { "claude-code": { model: "sonnet", effort: "medium" }, copilot: { warnings: ["effort not supported; global only"] } },
  ...overrides,
});

test("readLockfile devolve null sem arquivo e roundtrip write→read é idêntico", () => {
  const repo = tmp();
  assert.equal(readLockfile(repo), null);

  const lockfile = upsertSkill(emptyLockfile(), "@mgr/junit-clean", entry(), MGR_ORIGIN);
  writeLockfile(repo, lockfile);
  assert.deepEqual(readLockfile(repo), lockfile);
});

test("writeLockfile grava chaves de skills e registries em ordem determinística", () => {
  const repo = tmp();
  let lockfile = upsertSkill(emptyLockfile(), "@mgr/zeta", entry(), MGR_ORIGIN);
  lockfile = upsertSkill(lockfile, "@empresa/alfa", entry({ registry: "empresa" }), COMPANY_ORIGIN);
  writeLockfile(repo, lockfile);

  const raw = readFileSync(lockfilePath(repo), "utf8");
  assert.ok(raw.indexOf("@empresa/alfa") < raw.indexOf("@mgr/zeta"), "skills ordenadas por nome");
  assert.ok(raw.indexOf('"empresa"') < raw.indexOf('"mgr"'), "registries ordenados por nome");
  assert.equal(JSON.parse(raw).lockfileVersion, LOCKFILE_VERSION);
});

test("readLockfile rejeita lockfileVersion desconhecida com erro explícito", () => {
  const repo = tmp();
  writeFileSync(path.join(repo, LOCKFILE_NAME), JSON.stringify({ lockfileVersion: 9 }), "utf8");
  assert.throws(() => readLockfile(repo), /unsupported lockfileVersion .*9 \(expected 1\)/);
});

test("upsertSkill é imutável e registra a procedência do registry", () => {
  const original = emptyLockfile();
  const updated = upsertSkill(original, "@mgr/junit-clean", entry(), MGR_ORIGIN);
  assert.deepEqual(original.skills, {}, "lockfile original não pode ser mutado");
  assert.deepEqual(updated.registries.mgr, { url: MGR_ORIGIN.url, trusted: true });
  assert.equal(updated.skills["@mgr/junit-clean"].applied.copilot.warnings.length, 1);

  const reinstalled = upsertSkill(updated, "@mgr/junit-clean", entry({ version: "1.1.0" }), MGR_ORIGIN);
  assert.equal(reinstalled.skills["@mgr/junit-clean"].version, "1.1.0");
});

test("removeSkill limpa a skill e o registry órfão; ausência é erro", () => {
  let lockfile = upsertSkill(emptyLockfile(), "@mgr/junit-clean", entry(), MGR_ORIGIN);
  lockfile = upsertSkill(lockfile, "@empresa/postgres", entry({ registry: "empresa", category: "database" }), COMPANY_ORIGIN);

  const withoutCompany = removeSkill(lockfile, "@empresa/postgres");
  assert.deepEqual(Object.keys(withoutCompany.skills), ["@mgr/junit-clean"]);
  assert.deepEqual(Object.keys(withoutCompany.registries), ["mgr"], "registry sem skill em uso sai do lockfile");

  assert.throws(() => removeSkill(withoutCompany, "@empresa/postgres"), /skill not in mgr-skills\.lock/);
  assert.throws(() => removeSkill(null, "@mgr/x"), /skill not in mgr-skills\.lock/);
});

test("diff aponta travadas ausentes do disco e instaladas fora do lockfile", () => {
  const lockfile = upsertSkill(emptyLockfile(), "@mgr/junit-clean", entry(), MGR_ORIGIN);
  assert.deepEqual(diff(lockfile, []), { missing: ["@mgr/junit-clean"], unexpected: [] });
  assert.deepEqual(diff(lockfile, ["@mgr/junit-clean", "@empresa/postgres"]), {
    missing: [],
    unexpected: ["@empresa/postgres"],
  });
  assert.deepEqual(diff(null, ["@mgr/junit-clean"]), { missing: [], unexpected: ["@mgr/junit-clean"] });
});

test("readLockfile rejeita dir adulterado (fora do checksum, alcançaria rmSync)", () => {
  const repo = tmp();
  const lockfile = upsertSkill(emptyLockfile(), "@mgr/junit-clean", entry(), MGR_ORIGIN);
  for (const evil of ["../..", "/etc", "junit/../..", "Junit-Clean", ""]) {
    const tampered = {
      ...lockfile,
      skills: { "@mgr/junit-clean": { ...lockfile.skills["@mgr/junit-clean"], dir: evil } },
    };
    writeFileSync(lockfilePath(repo), JSON.stringify(tampered), "utf8");
    assert.throws(() => readLockfile(repo), /unsafe install dir/, JSON.stringify(evil));
  }
  const sufixado = {
    ...lockfile,
    skills: { "@mgr/junit-clean": { ...lockfile.skills["@mgr/junit-clean"], dir: "junit-clean--empresa" } },
  };
  writeFileSync(lockfilePath(repo), JSON.stringify(sufixado), "utf8");
  assert.equal(readLockfile(repo).skills["@mgr/junit-clean"].dir, "junit-clean--empresa");
});
