import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readManifest, writeManifest, MANIFEST_NAME,
} from "../src/manifest.js";
import { INSTALL_DIR_RE, readLockfile } from "../src/lockfile.js";
import { diagnose } from "../src/doctor.js";
import { migrateOld, uninstall } from "../src/installer.js";
import { skillNames } from "../src/bundle.js";


const tempDir = () => mkdtempSync(path.join(os.tmpdir(), "mgr-sec-"));

test("shouldAcceptEveryRealSkillNameOfTheMethod", () => {
  const names = skillNames();
  assert.ok(names.length > 0, "must find at least one skill");
  for (const name of names) {
    assert.ok(INSTALL_DIR_RE.test(name), `skill name must pass INSTALL_DIR_RE: ${name}`);
  }
});

test("shouldRoundtripAFullManifestUnchanged", () => {
  const tmpdir = tempDir();
  try {
    const original = {
      engines: ["test-engine"],
      skills: ["spec-create", "spec-execute"],
      agents: { agent1: { version: "1.0.0" } },
      skillsDirs: ["skills"],
      language: "en",
      architecture: "monolith",
    };

    writeManifest(tmpdir, original);
    const read = readManifest(tmpdir);

    assert.ok(read);
    assert.equal(read.model, "self-contained");
    assert.ok(read.installedAt);
    assert.deepEqual(read.engines, original.engines);
    assert.deepEqual(read.skills, original.skills);
    assert.deepEqual(read.agents, original.agents);
    assert.deepEqual(read.skillsDirs, original.skillsDirs);
    assert.equal(read.language, original.language);
    assert.equal(read.architecture, original.architecture);
  } finally {
    rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("shouldAcceptASkillNameWithARegistrySuffix", () => {
  const tmpdir = tempDir();
  try {
    writeManifest(tmpdir, { skills: ["foo--acme"] });
    const read = readManifest(tmpdir);
    assert.ok(read);
    assert.deepEqual(read.skills, ["foo--acme"]);
  } finally {
    rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("shouldReadAManifestWithoutTheSkillsFieldAndAnAbsentOne", () => {
  const tmpdir = tempDir();
  try {
    writeManifest(tmpdir, { engines: ["test"] });
    const read = readManifest(tmpdir);
    assert.ok(read);
    assert.equal(read.skills, undefined);

    const absentDir = path.join(tmpdir, "absent");
    const absent = readManifest(absentDir);
    assert.equal(absent, null);
  } finally {
    rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("shouldStillReportFromTheDoctorWhenAManifestNameIsInvalid", () => {
  const base = tempDir();
  try {
    const core = path.join(base, ".mgr-core");
    mkdirSync(core, { recursive: true });
    mkdirSync(path.join(base, ".claude", "skills"), { recursive: true });
    writeFileSync(
      path.join(core, MANIFEST_NAME),
      JSON.stringify({
        model: "self-contained",
        version: "0.7.0",
        scope: "project",
        skillsDirs: [".claude/skills"],
        engines: ["claude-code"],
        skills: ["../../etc"],
      }),
    );
    assert.throws(() => readManifest(core), /unsafe skill name in manifest\.json/);
    const relatorio = diagnose(base, { packageVersion: "0.7.0" });
    assert.ok(relatorio.findings.length > 0);
    assert.equal(typeof relatorio.outcome, "string");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("shouldRejectAPathTraversalName", () => {
  const tmpdir = tempDir();
  try {
    writeManifest(tmpdir, { skills: ["../../etc"] });
    assert.throws(
      () => readManifest(tmpdir),
      /unsafe skill name in manifest.json/,
    );
  } finally {
    rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("shouldRejectANameWithASeparator", () => {
  const tmpdir = tempDir();
  try {
    writeManifest(tmpdir, { skills: ["a/b"] });
    assert.throws(
      () => readManifest(tmpdir),
      /unsafe skill name in manifest.json/,
    );
  } finally {
    rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("shouldRejectAParentDirectoryName", () => {
  const tmpdir = tempDir();
  try {
    writeManifest(tmpdir, { skills: [".."] });
    assert.throws(
      () => readManifest(tmpdir),
      /unsafe skill name in manifest.json/,
    );
  } finally {
    rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("shouldRejectAnUppercaseAndAnEmptyName", () => {
  const tmpdir = tempDir();
  try {
    writeManifest(tmpdir, { skills: ["Foo"] });
    assert.throws(
      () => readManifest(tmpdir),
      /unsafe skill name in manifest.json/,
    );

    writeManifest(tmpdir, { skills: [""] });
    assert.throws(
      () => readManifest(tmpdir),
      /unsafe skill name in manifest.json/,
    );
  } finally {
    rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("shouldRejectAStringInsteadOfAnArrayWithoutIteratingCharacters", () => {
  const tmpdir = tempDir();
  try {
    writeManifest(tmpdir, { skills: "ab" });
    assert.throws(
      () => readManifest(tmpdir),
      /invalid "skills" in manifest.json/,
    );
  } finally {
    rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("shouldRejectANonStringElement", () => {
  const tmpdir = tempDir();
  try {
    writeManifest(tmpdir, { skills: [null] });
    assert.throws(
      () => readManifest(tmpdir),
      /unsafe skill name in manifest.json/,
    );

    writeManifest(tmpdir, { skills: [{}] });
    assert.throws(
      () => readManifest(tmpdir),
      /unsafe skill name in manifest.json/,
    );
  } finally {
    rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("shouldThrowBeforeRemovingAnythingOnATamperedManifest", () => {
  const tmpdir = tempDir();
  try {
    const coreDir_ = path.join(tmpdir, ".mgr-core");
    mkdirSync(coreDir_, { recursive: true });
    writeFileSync(
      path.join(coreDir_, MANIFEST_NAME),
      JSON.stringify({
        model: "runtime-launcher",
        skills: ["../../etc"],
        skillsDirs: ["."],
      }),
    );

    const targetDir = path.join(tmpdir, "target");
    mkdirSync(targetDir, { recursive: true });
    const targetFile = path.join(targetDir, "test.txt");
    writeFileSync(targetFile, "content");

    assert.ok(existsSync(targetFile), "target file must exist before");

    assert.throws(
      () => migrateOld("project", tmpdir),
      /unsafe skill name in manifest.json/,
    );

    assert.ok(existsSync(targetFile), "target file must still exist after throwing");
  } finally {
    rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("shouldGiveTheSameVerdictInBothReadersForTheSameShapes", () => {
  const cases = [
    { name: "spec-create", shouldPass: true },
    { name: "foo--acme", shouldPass: true },
    { name: "junit-clean", shouldPass: true },
    { name: "../../etc", shouldPass: false },
    { name: "a/b", shouldPass: false },
    { name: "..", shouldPass: false },
    { name: "Foo", shouldPass: false },
    { name: "", shouldPass: false },
  ];

  const tmpdir = tempDir();
  try {
    for (const testCase of cases) {
      const lockfileVerdictPasses = INSTALL_DIR_RE.test(testCase.name);

      const manifestDir = path.join(tmpdir, `manifest-${testCase.name.replace(/\//g, "-")}`);
      mkdirSync(manifestDir, { recursive: true });
      writeManifest(manifestDir, { skills: [testCase.name] });

      let manifestVerdictPasses = true;
      try {
        readManifest(manifestDir);
      } catch {
        manifestVerdictPasses = false;
      }

      assert.equal(
        manifestVerdictPasses,
        lockfileVerdictPasses,
        `both readers must agree on "${testCase.name}": lockfile=${lockfileVerdictPasses}, manifest=${manifestVerdictPasses}`,
      );
    }
  } finally {
    rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("shouldThrowBeforeRemovingAnythingOnUninstallToo", () => {
  const base = tempDir();
  try {
    const core = path.join(base, ".mgr-core");
    mkdirSync(core, { recursive: true });
    writeFileSync(
      path.join(core, MANIFEST_NAME),
      JSON.stringify({ model: "self-contained", skills: ["../../etc"], skillsDirs: ["."] }),
    );
    const alvo = path.join(base, "alvo");
    mkdirSync(alvo, { recursive: true });
    const arquivo = path.join(alvo, "nao-remover.txt");
    writeFileSync(arquivo, "conteudo");
    assert.ok(existsSync(arquivo));
    assert.throws(() => uninstall("project", base), /unsafe skill name in manifest\.json/);
    assert.ok(existsSync(arquivo));
    assert.ok(existsSync(path.join(core, MANIFEST_NAME)));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("shouldGiveTheSameVerdictInBothActualReadersNotJustTheRegex", () => {
  const formas = [
    { nome: "spec-create", valida: true },
    { nome: "foo--acme", valida: true },
    { nome: "../../etc", valida: false },
    { nome: "a/b", valida: false },
    { nome: "..", valida: false },
    { nome: "Foo", valida: false },
    { nome: "", valida: false },
  ];
  for (const forma of formas) {
    const base = tempDir();
    try {
      const core = path.join(base, ".mgr-core");
      mkdirSync(core, { recursive: true });
      writeFileSync(path.join(core, MANIFEST_NAME), JSON.stringify({ skills: [forma.nome] }));
      writeFileSync(
        path.join(base, "mgr-skills.lock"),
        JSON.stringify({ lockfileVersion: 1, registries: {}, skills: { x: { dir: forma.nome } } }),
      );
      const manifestoAceita = (() => {
        try {
          readManifest(core);
          return true;
        } catch {
          return false;
        }
      })();
      const lockfileAceita = (() => {
        try {
          readLockfile(base);
          return true;
        } catch {
          return false;
        }
      })();
      assert.equal(manifestoAceita, forma.valida);
      assert.equal(lockfileAceita, forma.valida);
      assert.equal(manifestoAceita, lockfileAceita);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }
});
