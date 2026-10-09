import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { diagnose } from "../src/doctor.js";
import { descartar, instalacaoLimpa, ORFA } from "./fixtures/instalacao.js";

// E-13 do review do P1: a orfa numa pasta travada no lockfile, SEM `mgr-manifest.json`, tem de sair
// `unknown` (DT-6, classe 1). Sem esta guarda, zerar `lockedDirs` no `diagnose` passava verde e o
// doctor nomearia `mgr update` para uma pasta que o update nunca oferece.
test("should give no fix to an orphan whose folder is a lockfile dir even without mgr-manifest.json", () => {
  const repo = instalacaoLimpa();
  try {
    const skills = path.join(repo, ".claude", "skills");
    const declaradas = JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8")).skills;
    cpSync(path.join(skills, declaradas[0]), path.join(skills, ORFA), { recursive: true });
    writeFileSync(path.join(repo, "mgr-skills.lock"),
      JSON.stringify({ version: 1, skills: { "@time/plugin": { dir: ORFA } } }, null, 2) + "\n", "utf8");

    const orfa = diagnose(repo).findings.find(({ check, file }) => check === "orphan-skill" && file.endsWith(ORFA));
    assert.ok(orfa, "a pasta continua acusada como orfa");
    assert.equal(orfa.fix, null, "pasta do lockfile nunca e candidata: o doctor nao pode nomear o update");
  } finally {
    descartar(repo);
  }
});
