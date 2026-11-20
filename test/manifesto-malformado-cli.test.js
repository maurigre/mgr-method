import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CLASS_ARCHITECTURE } from "../src/skill-class.js";
import { getMessages } from "../src/messages.js";
import { DECLARATION_FLAGS, MANIFEST_NAME, manifestShapeProblems, problemText } from "../src/manifest.js";
import { renderText, text } from "../src/ui-text.js";
import { tempDir } from "../scripts/lib/tmp.mjs";
import { CHECKS } from "../src/doctor.js";
import {
  VAZAMENTOS_DE_EXCECAO, controleValido, formasLetaisDoManifesto, rodar,
} from "./fixtures/manifesto-malformado.js";

const M = getMessages("pt-BR");
const caminhoDoManifesto = (repo) => path.join(repo, ".mgr-core", "manifest.json");
const lerManifesto = (repo) => JSON.parse(readFileSync(caminhoDoManifesto(repo), "utf8"));

const plantar = (repo, campo, valor) => {
  const manifesto = { ...lerManifesto(repo), [campo]: valor };
  writeFileSync(caminhoDoManifesto(repo), JSON.stringify(manifesto, null, 2));
  return JSON.parse(readFileSync(caminhoDoManifesto(repo), "utf8"));
};

const COMANDOS = [
  ["update", (repo) => ["update", "-y", repo]],
  ["install", (repo) => ["install", "-y", "--engine", "claude-code", repo]],
];

const afirmarSaidaLimpa = (saida) => {
  for (const vazamento of VAZAMENTOS_DE_EXCECAO) assert.doesNotMatch(saida, vazamento);
  assert.doesNotMatch(saida, /unexpected error|erro inesperado/i);
  assert.doesNotMatch(saida, /MGR defect|defeito do MGR/i);
};

const afirmarReparoAnunciado = (saida, plantado) => {
  const problemas = manifestShapeProblems(plantado);
  assert.ok(problemas.length >= 1, "o manifesto plantado precisa ter ao menos um problema de forma");
  assert.ok(saida.includes(M.manifestRepairTitle(MANIFEST_NAME)), saida);
  for (const problema of problemas) {
    assert.ok(saida.includes(renderText(M, problemText(problema))), saida);
  }
};

const afirmarBaseMantida = (manifesto) => {
  assert.equal(manifesto.architecture, "hexagonal");
  assert.equal(manifesto.language, "java");
  assert.equal(manifesto.skills.length, 9);
};

const comRepo = (corpo) => {
  const repo = controleValido();
  try {
    corpo(repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
};

const CASOS_SKILLSDIRS = [["string", "x"], ["array com elemento numerico", [1]]];

for (const [comando, argv] of COMANDOS) {
  for (const [rotulo, valor] of CASOS_SKILLSDIRS) {
    test(`shouldRepairSkillsDirsAsDerivedFieldOnCommand_${comando}_when_${rotulo.replace(/ /g, "_")}`, () => {
      comRepo((repo) => {
        const plantado = plantar(repo, "skillsDirs", valor);
        const { code, stdout, stderr } = rodar(argv(repo), repo);
        const saida = `${stdout}${stderr}`;
        assert.equal(code, 0, saida);
        const final = lerManifesto(repo);
        assert.deepEqual(final.skillsDirs, [".claude/skills"]);
        afirmarBaseMantida(final);
        afirmarReparoAnunciado(saida, plantado);
        afirmarSaidaLimpa(saida);
      });
    });
  }
}

const CASOS_AGENTS_E_SCOPE = [
  ["agents objeto", "agents", { a: 1 }],
  ["agents array com elemento numerico", "agents", [1]],
  ["scope ausente", "scope", undefined],
  ["scope bogus", "scope", "bogus"],
];

for (const [comando, argv] of COMANDOS) {
  for (const [rotulo, campo, valor] of CASOS_AGENTS_E_SCOPE) {
    test(`shouldRepairAgentsAndScopeOnCommand_${comando}_when_${rotulo.replace(/ /g, "_")}`, () => {
      comRepo((repo) => {
        const plantado = plantar(repo, campo, valor);
        const { code, stdout, stderr } = rodar(argv(repo), repo);
        const saida = `${stdout}${stderr}`;
        assert.equal(code, 0, saida);
        const final = lerManifesto(repo);
        assert.equal(final.scope, "project");
        assert.ok(Array.isArray(final.agents), "agents recalculado como array");
        assert.ok(final.agents.every((agente) => typeof agente === "string"), "agents so com strings");
        afirmarBaseMantida(final);
        afirmarReparoAnunciado(saida, plantado);
        afirmarSaidaLimpa(saida);
      });
    });
  }
}

for (const [comando, argv] of COMANDOS) {
  test(`shouldRewriteAgentsDirsOnCommand_${comando}_when_agentsDirsIsString`, () => {
    comRepo((repo) => {
      const plantado = plantar(repo, "agentsDirs", "x");
      const { code, stdout, stderr } = rodar(argv(repo), repo);
      const saida = `${stdout}${stderr}`;
      assert.equal(code, 0, saida);
      const final = lerManifesto(repo);
      assert.ok(Array.isArray(final.agentsDirs), "agentsDirs reescrito como array");
      assert.ok(final.agentsDirs.every((pasta) => typeof pasta === "string"), "agentsDirs so com strings");
      afirmarBaseMantida(final);
      afirmarReparoAnunciado(saida, plantado);
      afirmarSaidaLimpa(saida);
    });
  });
}

const EN = getMessages("en");

const bytesDoManifesto = (repo) => readFileSync(caminhoDoManifesto(repo));

const afirmarRecusaNoUpdate = (repo, plantado, argv, tabela, antes) => {
  const { code, stdout, stderr } = rodar(argv, repo);
  const saida = `${stdout}${stderr}`;
  assert.equal(code, 1, saida);
  assert.ok(saida.includes(tabela.manifestRefused(MANIFEST_NAME)), saida);
  const problemas = manifestShapeProblems(plantado);
  assert.ok(problemas.length >= 1, "o manifesto plantado precisa ter ao menos um problema de forma");
  for (const problema of problemas) {
    assert.ok(saida.includes(renderText(tabela, problemText(problema))), saida);
  }
  assert.ok(saida.includes(tabela.manifestRefusedFixByHand(MANIFEST_NAME)), saida);
  const flags = [...new Set(problemas.map((p) => DECLARATION_FLAGS[p.field]).filter(Boolean))].join(", ");
  if (flags) assert.ok(saida.includes(tabela.manifestRefusedOrInstall(flags)), saida);
  assert.ok(!saida.includes(tabela.manifestRepairTitle(MANIFEST_NAME)), saida);
  assert.ok(bytesDoManifesto(repo).equals(antes), "o manifesto precisa ficar byte a byte igual");
  afirmarSaidaLimpa(saida);
  return saida;
};

const CASOS_DE_RECUSA_NO_UPDATE = [
  ["engines numero", "engines", 7, "--engine", M],
  ["engines objeto", "engines", {}, "--engine", M],
  ["architecture numero", "architecture", 7, "--arch", M],
  ["architecture mvc", "architecture", "mvc", "--arch", M],
  ["language array com elemento numerico", "language", [1], "--language", M],
  ["optional string", "optional", "x", null, M],
  ["optional array com elemento numerico", "optional", [1], null, M],
  ["allSkills string", "allSkills", "sim", null, M],
  ["userLanguage numero", "userLanguage", 7, "--user-language", EN],
];

for (const [rotulo, campo, valor, flag, tabela] of CASOS_DE_RECUSA_NO_UPDATE) {
  test(`shouldRefuseUpdateAndKeepManifestBytesWhen_${rotulo.replace(/ /g, "_")}`, () => {
    comRepo((repo) => {
      const plantado = plantar(repo, campo, valor);
      const antes = bytesDoManifesto(repo);
      const saida = afirmarRecusaNoUpdate(repo, plantado, ["update", "-y", repo], tabela, antes);
      if (flag) assert.ok(saida.includes(tabela.manifestRefusedOrInstall(flag)), saida);
    });
  });
}

test("shouldListAllowedArchitecturesWhenUpdateRefusesUnknownArchitecture", () => {
  comRepo((repo) => {
    const plantado = plantar(repo, "architecture", "mvc");
    const antes = bytesDoManifesto(repo);
    const saida = afirmarRecusaNoUpdate(repo, plantado, ["update", "-y", repo], M, antes);
    assert.ok(saida.includes("hexagonal | clean | onion | layered"), saida);
  });
});

test("shouldNotInstallThirteenSkillsWhenUpdateRefusesLanguageOutOfShape", () => {
  comRepo((repo) => {
    const plantado = plantar(repo, "language", [1]);
    const antes = bytesDoManifesto(repo);
    afirmarRecusaNoUpdate(repo, plantado, ["update", "-y", repo], M, antes);
    assert.equal(JSON.parse(antes.toString("utf8")).skills.length, 9);
    assert.equal(lerManifesto(repo).skills.length, 9);
  });
});

test("shouldAcceptUnknownLanguageTextOnUpdateAndAnnounceSkillLeaving", () => {
  comRepo((repo) => {
    plantar(repo, "language", "cobol");
    const { code, stdout, stderr } = rodar(["update", "-y", repo], repo);
    const saida = `${stdout}${stderr}`;
    assert.equal(code, 0, saida);
    assert.equal(lerManifesto(repo).language, "cobol");
    assert.match(saida, /skill sai: .*junit-clean/);
    assert.ok(!saida.includes(M.manifestRefused(MANIFEST_NAME)), saida);
    afirmarSaidaLimpa(saida);
  });
});

test("shouldRefuseUpdateWithEngineFlagWhenEnginesOutOfShapeAndSuggestNoUpdateFlag", () => {
  comRepo((repo) => {
    const plantado = plantar(repo, "engines", 7);
    const antes = bytesDoManifesto(repo);
    const saida = afirmarRecusaNoUpdate(repo, plantado, ["update", "-y", "--engine", "copilot", repo], M, antes);
    assert.ok(saida.includes(M.manifestRefusedOrInstall("--engine")), saida);
    assert.doesNotMatch(saida, /update --[a-z]/);
  });
});

test("shouldRefuseUpdateWithEmptyEnginesAndNoLegacyEngine", () => {
  comRepo((repo) => {
    plantar(repo, "engine", undefined);
    plantar(repo, "engines", []);
    const antes = bytesDoManifesto(repo);
    const { code, stdout, stderr } = rodar(["update", "-y", repo], repo);
    const saida = `${stdout}${stderr}`;
    assert.equal(code, 1, saida);
    assert.ok(saida.includes(M.manifestRefused(MANIFEST_NAME)), saida);
    assert.ok(saida.includes(renderText(M, text("manifestProblemEmptyEngines"))), saida);
    assert.ok(bytesDoManifesto(repo).equals(antes), "o manifesto precisa ficar byte a byte igual");
    afirmarSaidaLimpa(saida);
  });
});

test("shouldTakeEnginesFromLegacyEngineWhenUpdateFindsEmptyEngines", () => {
  comRepo((repo) => {
    plantar(repo, "engine", "copilot");
    plantar(repo, "engines", []);
    const { code, stdout, stderr } = rodar(["update", "-y", repo], repo);
    const saida = `${stdout}${stderr}`;
    assert.equal(code, 0, saida);
    assert.deepEqual(lerManifesto(repo).engines, ["copilot"]);
    afirmarSaidaLimpa(saida);
  });
});

test("shouldDefaultEnginesToClaudeCodeWhenUpdateFindsEnginesAbsent", () => {
  comRepo((repo) => {
    plantar(repo, "engines", undefined);
    const { code, stdout, stderr } = rodar(["update", "-y", repo], repo);
    const saida = `${stdout}${stderr}`;
    assert.equal(code, 0, saida);
    assert.deepEqual(lerManifesto(repo).engines, ["claude-code"]);
    afirmarSaidaLimpa(saida);
  });
});

const INSTALL_SEM_MOTOR = (repo) => ["install", "-y", repo];
const INSTALL_COM_MOTOR = (repo, ...extras) => ["install", "-y", "--engine", "claude-code", ...extras, repo];

const prefixoDaLinhaDeFlags = (tabela) => tabela.manifestRefusedOrFlags("@@").split("@@")[0];

const afirmarRecusaNoInstall = (repo, plantado, argv, tabela, antes) => {
  const { code, stdout, stderr } = rodar(argv, repo);
  const saida = `${stdout}${stderr}`;
  assert.equal(code, 1, saida);
  assert.ok(saida.includes(tabela.manifestRefused(MANIFEST_NAME)), saida);
  const problemas = manifestShapeProblems(plantado);
  assert.ok(problemas.length >= 1, "o manifesto plantado precisa ter ao menos um problema de forma");
  for (const problema of problemas) {
    assert.ok(saida.includes(renderText(tabela, problemText(problema))), saida);
  }
  assert.ok(saida.includes(tabela.manifestRefusedFixByHand(MANIFEST_NAME)), saida);
  const flags = [...new Set(problemas.map((p) => DECLARATION_FLAGS[p.field]).filter(Boolean))].join(", ");
  if (flags) assert.ok(saida.includes(tabela.manifestRefusedOrFlags(flags)), saida);
  else assert.ok(!saida.includes(prefixoDaLinhaDeFlags(tabela)), saida);
  assert.ok(!saida.includes(tabela.manifestRepairTitle(MANIFEST_NAME)), saida);
  assert.ok(bytesDoManifesto(repo).equals(antes), "o manifesto precisa ficar byte a byte igual");
  afirmarSaidaLimpa(saida);
  return saida;
};

for (const [rotulo, valor] of [["numero", 7], ["objeto", {}]]) {
  test(`shouldResolveEnginesOutOfShapeWithEngineFlagOnInstallWhen_${rotulo}`, () => {
    comRepo((repo) => {
      plantar(repo, "engines", valor);
      const { code, stdout, stderr } = rodar(INSTALL_COM_MOTOR(repo), repo);
      const saida = `${stdout}${stderr}`;
      assert.equal(code, 0, saida);
      const final = lerManifesto(repo);
      assert.deepEqual(final.engines, ["claude-code"]);
      afirmarBaseMantida(final);
      afirmarSaidaLimpa(saida);
    });
  });

  test(`shouldRefuseInstallWithoutEngineFlagAndKeepManifestBytesWhenEnginesIs_${rotulo}`, () => {
    comRepo((repo) => {
      const plantado = plantar(repo, "engines", valor);
      const antes = bytesDoManifesto(repo);
      const saida = afirmarRecusaNoInstall(repo, plantado, INSTALL_SEM_MOTOR(repo), M, antes);
      assert.ok(saida.includes(M.manifestRefusedOrFlags("--engine")), saida);
    });
  });
}

const CASOS_DE_INSTALL_COM_E_SEM_FLAG = [
  ["architecture numero", "architecture", 7, ["--arch", "layered"], "architecture", "layered", M],
  ["architecture mvc", "architecture", "mvc", ["--arch", "layered"], "architecture", "layered", M],
  ["language array com elemento numerico", "language", [1], ["--language", "java"], "language", "java", M],
  ["userLanguage numero", "userLanguage", 7, ["--user-language", "en"], "userLanguage", "en", EN],
  ["optional string", "optional", "x", null, null, null, M],
  ["optional array com elemento numerico", "optional", [1], null, null, null, M],
  ["allSkills string", "allSkills", "sim", null, null, null, M],
];

for (const [rotulo, campo, valor, flagArgs, , , tabela] of CASOS_DE_INSTALL_COM_E_SEM_FLAG) {
  test(`shouldRefuseInstallAndKeepManifestBytesWithoutFlagWhen_${rotulo.replace(/ /g, "_")}`, () => {
    comRepo((repo) => {
      const plantado = plantar(repo, campo, valor);
      const antes = bytesDoManifesto(repo);
      const saida = afirmarRecusaNoInstall(repo, plantado, INSTALL_COM_MOTOR(repo), tabela, antes);
      if (flagArgs) assert.ok(saida.includes(tabela.manifestRefusedOrFlags(flagArgs[0])), saida);
    });
  });
}

for (const [rotulo, campo, valor, flagArgs, campoFinal, valorFinal] of CASOS_DE_INSTALL_COM_E_SEM_FLAG.filter((caso) => caso[3])) {
  test(`shouldWriteFlagValueOnInstallWhen_${rotulo.replace(/ /g, "_")}`, () => {
    comRepo((repo) => {
      plantar(repo, campo, valor);
      const { code, stdout, stderr } = rodar(INSTALL_COM_MOTOR(repo, ...flagArgs), repo);
      const saida = `${stdout}${stderr}`;
      assert.equal(code, 0, saida);
      assert.deepEqual(lerManifesto(repo)[campoFinal], valorFinal);
      afirmarSaidaLimpa(saida);
    });
  });
}

test("shouldKeepFiveDeclarationsAndNineSkillsAndShowPlanNoteWhenInstallingOverValidControl", () => {
  comRepo((repo) => {
    const antes = lerManifesto(repo);
    const { code, stdout, stderr } = rodar(INSTALL_COM_MOTOR(repo), repo);
    const saida = `${stdout}${stderr}`;
    assert.equal(code, 0, saida);
    const final = lerManifesto(repo);
    assert.equal(final.architecture, "hexagonal");
    assert.equal(final.language, "java");
    assert.equal(final.userLanguage, "pt-BR");
    assert.deepEqual(final.optional, antes.optional);
    assert.deepEqual(final.allSkills, antes.allSkills);
    assert.equal(final.skills.length, 9);
    assert.ok(saida.includes(M.planStack("java", "hexagonal")), saida);
    assert.ok(saida.includes(M.planOutput("pt-BR")), saida);
    assert.ok(!saida.includes(M.planAbandoned([]).split(" (")[0]), saida);
    assert.ok(!saida.includes(M.removedSkills([]).split(" 0")[0]), saida);
    afirmarSaidaLimpa(saida);
  });
});

for (const [comando, argv] of COMANDOS) {
  test(`shouldWritePtBrUserLanguageOnCommand_${comando}_whenManifestHasNoUserLanguage`, () => {
    comRepo((repo) => {
      plantar(repo, "userLanguage", undefined);
      assert.equal(lerManifesto(repo).userLanguage, undefined);
      const { code, stdout, stderr } = rodar(argv(repo), repo);
      assert.equal(code, 0, `${stdout}${stderr}`);
      assert.equal(lerManifesto(repo).userLanguage, "pt-BR");
    });
  });
}

test("shouldWriteEnUserLanguageOnInstallWithoutPriorManifestUnderCLocale", () => {
  const repo = tempDir("mgr-sem-manifesto-");
  try {
    const { code, stdout, stderr } = rodar(["install", "-y", "--engine", "claude-code", "--language", "java",
      "--arch", "hexagonal", "--project-id", "fixture", repo], repo);
    assert.equal(code, 0, `${stdout}${stderr}`);
    assert.equal(lerManifesto(repo).userLanguage, "en");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("shouldKeepBothEnginesAndFoldersWhenInstallWithoutEngineFlagOverClaudeCodeAndCopilot", () => {
  comRepo((repo) => {
    plantar(repo, "engines", ["claude-code", "copilot"]);
    const { code, stdout, stderr } = rodar(INSTALL_SEM_MOTOR(repo), repo);
    const saida = `${stdout}${stderr}`;
    assert.equal(code, 0, saida);
    const final = lerManifesto(repo);
    assert.deepEqual(final.engines, ["claude-code", "copilot"]);
    assert.ok(final.skillsDirs.includes(".claude/skills"), JSON.stringify(final.skillsDirs));
    assert.ok(final.skillsDirs.includes(".github/skills"), JSON.stringify(final.skillsDirs));
    afirmarSaidaLimpa(saida);
  });
});

test("shouldRefuseInstallWithoutEngineFlagAndKeepManifestBytesWhenEnginesEmptyAndNoLegacyEngine", () => {
  comRepo((repo) => {
    plantar(repo, "engine", undefined);
    plantar(repo, "engines", []);
    const antes = bytesDoManifesto(repo);
    const { code, stdout, stderr } = rodar(INSTALL_SEM_MOTOR(repo), repo);
    const saida = `${stdout}${stderr}`;
    assert.equal(code, 1, saida);
    assert.ok(saida.includes(M.manifestRefused(MANIFEST_NAME)), saida);
    assert.ok(saida.includes(renderText(M, text("manifestProblemEmptyEngines"))), saida);
    assert.ok(saida.includes(M.manifestRefusedOrFlags("--engine")), saida);
    assert.ok(bytesDoManifesto(repo).equals(antes), "o manifesto precisa ficar byte a byte igual");
    assert.deepEqual(JSON.parse(bytesDoManifesto(repo).toString("utf8")).engines, []);
    afirmarSaidaLimpa(saida);
  });
});

test("shouldAnnounceArchitectureLeavingAndRemoveFolderAndKeepNullWhenArchitectureEditedToNull", () => {
  comRepo((repo) => {
    plantar(repo, "architecture", null);
    const pasta = path.join(repo, ".claude", "skills", "arch-hexagonal");
    assert.ok(existsSync(pasta), "a pasta da arquitetura existe antes do update");
    const { code, stdout, stderr } = rodar(["update", "-y", repo], repo);
    const saida = `${stdout}${stderr}`;
    assert.equal(code, 0, saida);
    assert.ok(saida.includes(M.updateSkillLeaving(M.removalReason("arch-hexagonal", CLASS_ARCHITECTURE))), saida);
    assert.ok(!existsSync(pasta), "a pasta arch-hexagonal precisa sair do disco");
    assert.equal(lerManifesto(repo).architecture, null);
    afirmarSaidaLimpa(saida);
    const seguinte = rodar(INSTALL_SEM_MOTOR(repo), repo);
    assert.equal(seguinte.code, 0, `${seguinte.stdout}${seguinte.stderr}`);
    assert.equal(lerManifesto(repo).architecture, null);
    assert.ok(!existsSync(pasta), "o install seguinte nao traz a arquitetura de volta");
  });
});

test("shouldSwitchArchitectureAndKeepJavaWhenInstallWithArchLayeredOverControl", () => {
  comRepo((repo) => {
    const { code, stdout, stderr } = rodar(INSTALL_COM_MOTOR(repo, "--arch", "layered"), repo);
    const saida = `${stdout}${stderr}`;
    assert.equal(code, 0, saida);
    const final = lerManifesto(repo);
    assert.equal(final.architecture, "layered");
    assert.equal(final.language, "java");
    afirmarSaidaLimpa(saida);
  });
});

const pastasDeSkill = (pasta) => readdirSync(pasta).filter((nome) => !nome.startsWith("_"));

test("shouldKeepCustomTargetThroughInstallUpdateAndUninstallWithSkillsDirInsideProject", () => {
  const repo = tempDir("mgr-custom-");
  try {
    const pasta = path.join(repo, "minhas-skills");
    const instalar = rodar(["install", "-y", "--skills-dir", pasta, "--language", "java", "--arch", "layered",
      "--project-id", "fixture", repo], repo);
    assert.equal(instalar.code, 0, `${instalar.stdout}${instalar.stderr}`);
    const depoisDoInstall = lerManifesto(repo);
    assert.deepEqual(depoisDoInstall.engines, ["custom"]);
    assert.deepEqual(depoisDoInstall.skillsDirs, ["minhas-skills"]);
    const instaladas = pastasDeSkill(pasta);
    assert.ok(instaladas.length > 0, "as skills precisam estar na pasta declarada");

    rmSync(path.join(pasta, instaladas[0]), { recursive: true, force: true });
    const atualizar = rodar(["update", "-y", repo], repo);
    assert.equal(atualizar.code, 0, `${atualizar.stdout}${atualizar.stderr}`);
    const depoisDoUpdate = lerManifesto(repo);
    assert.deepEqual(depoisDoUpdate.engines, ["custom"]);
    assert.deepEqual(depoisDoUpdate.skillsDirs, ["minhas-skills"]);
    assert.deepEqual(pastasDeSkill(pasta).sort(), instaladas.sort());
    assert.ok(!existsSync(path.join(repo, ".claude", "skills")), "o update nao pode trocar o alvo declarado");

    const remover = rodar(["uninstall", "-y", repo], repo);
    assert.equal(remover.code, 0, `${remover.stdout}${remover.stderr}`);
    for (const nome of instaladas) {
      assert.ok(!existsSync(path.join(pasta, nome)), `${nome} precisa sair da pasta custom`);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

const fragmentoEntre = (frase, antes, depois) => frase.split(antes)[1].split(depois)[0];
const FRAGMENTO_COPY = fragmentoEntre(M.runtimeMigrated("@@V", "@@D"), "@@V", "@@D");
const FRAGMENTO_RELOCATE = fragmentoEntre(M.runtimeRelocated("@@V", "@@D"), "@@V", "@@D");
const FRAGMENTO_CONFIG = fragmentoEntre(M.configMigrated("@@V", "@@F"), "@@V", "@@F");

test("shouldUseSpecificNonEmptyFragmentsToDetectMigrationTexts", () => {
  for (const fragmento of [FRAGMENTO_COPY, FRAGMENTO_RELOCATE, FRAGMENTO_CONFIG]) {
    assert.ok(fragmento.length > 20, fragmento);
  }
  assert.equal(new Set([FRAGMENTO_COPY, FRAGMENTO_RELOCATE, FRAGMENTO_CONFIG]).size, 3);
});

for (const [comando, argv] of COMANDOS) {
  test(`shouldTreatUnknownModelAsCurrentAndAnnounceNoMigrationOnCommand_${comando}`, () => {
    comRepo((repo) => {
      plantar(repo, "model", "bogus");
      const { code, stdout, stderr } = rodar(argv(repo), repo);
      const saida = `${stdout}${stderr}`;
      assert.equal(code, 0, saida);
      assert.equal(lerManifesto(repo).model, "self-contained-core-runtime");
      assert.ok(!saida.includes(FRAGMENTO_COPY), saida);
      assert.ok(!saida.includes(FRAGMENTO_RELOCATE), saida);
      assert.ok(!saida.includes(FRAGMENTO_CONFIG), saida);
      afirmarSaidaLimpa(saida);
    });
  });

  test(`shouldAnnounceRelocationAndConfigMigrationOnCommand_${comando}_whenModelIsSelfContainedRuntime`, () => {
    comRepo((repo) => {
      plantar(repo, "model", "self-contained-runtime");
      const { code, stdout, stderr } = rodar(argv(repo), repo);
      const saida = `${stdout}${stderr}`;
      assert.equal(code, 0, saida);
      assert.ok(saida.includes(FRAGMENTO_RELOCATE), saida);
      assert.ok(saida.includes(FRAGMENTO_CONFIG), saida);
      assert.ok(!saida.includes(FRAGMENTO_COPY), saida);
      assert.equal(lerManifesto(repo).model, "self-contained-core-runtime");
    });
  });

  test(`shouldAnnounceRelocationWithoutConfigMigrationOnCommand_${comando}_whenModelIsLayeredConfig`, () => {
    comRepo((repo) => {
      plantar(repo, "model", "self-contained-layered-config");
      const { code, stdout, stderr } = rodar(argv(repo), repo);
      const saida = `${stdout}${stderr}`;
      assert.equal(code, 0, saida);
      assert.ok(saida.includes(FRAGMENTO_RELOCATE), saida);
      assert.ok(!saida.includes(FRAGMENTO_CONFIG), saida);
      assert.ok(!saida.includes(FRAGMENTO_COPY), saida);
      assert.equal(lerManifesto(repo).model, "self-contained-core-runtime");
    });
  });
}

test("shouldConvergeProjectOnUpdateWhenGlobalManifestRootIsString", () => {
  const home = tempDir("mgr-home-global-");
  try {
    mkdirSync(path.join(home, ".mgr-core"), { recursive: true });
    writeFileSync(path.join(home, ".mgr-core", "manifest.json"), JSON.stringify("x"));
    comRepo((repo) => {
      const { code, stdout, stderr } = rodar(["update", "-y", repo], repo, { HOME: home });
      const saida = `${stdout}${stderr}`;
      assert.equal(code, 0, saida);
      const final = lerManifesto(repo);
      assert.deepEqual(final.skillsDirs, [".claude/skills"]);
      afirmarBaseMantida(final);
      assert.ok(!saida.includes(M.manifestRefused(MANIFEST_NAME)), saida);
      afirmarSaidaLimpa(saida);
    });
    assert.equal(readFileSync(path.join(home, ".mgr-core", "manifest.json"), "utf8"), "\"x\"");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("shouldPrintNoRepairNorRefusalOnUpdateOfValidControl", () => {
  comRepo((repo) => {
    const { code, stdout, stderr } = rodar(["update", "-y", repo], repo);
    const saida = `${stdout}${stderr}`;
    assert.equal(code, 0, saida);
    afirmarBaseMantida(lerManifesto(repo));
    assert.ok(!saida.includes(M.manifestRepairTitle(MANIFEST_NAME)), saida);
    assert.ok(!saida.includes(M.manifestRefused(MANIFEST_NAME)), saida);
    afirmarSaidaLimpa(saida);
  });
});

const linhasDaSaida = (saida) => saida.split("\n");
const gravarBruto = (repo, conteudo) => writeFileSync(caminhoDoManifesto(repo), conteudo);
const listarSkills = (repo) => {
  const pasta = path.join(repo, ".claude", "skills");
  return existsSync(pasta) ? readdirSync(pasta).sort() : null;
};
const linhaDeErro = (tabela, chave, ...args) => tabela.errorPrefix(tabela[chave](...args));

const CASOS_CA21 = [
  ["skills objeto", { a: 1 }, "manifestInvalidSkills", JSON.stringify({ a: 1 }),
    'error: invalid "skills" in manifest.json: {"a":1} (expected an array of skill names)'],
  ["skills com nome inseguro", ["../x"], "manifestUnsafeSkillName", JSON.stringify("../x"),
    'error: unsafe skill name in manifest.json: "../x"'],
];

for (const [comando, argv] of COMANDOS) {
  for (const [rotulo, valor, chave, parametro, linhaEn] of CASOS_CA21) {
    const nome = rotulo.replace(/ /g, "_");
    test(`shouldPrintEnglishLineAndKeepManifestBytesOnCommand_${comando}_when_${nome}`, () => {
      comRepo((repo) => {
        plantar(repo, "skills", valor);
        const antes = bytesDoManifesto(repo);
        const { code, stdout, stderr } = rodar([...argv(repo), "--user-language", "en"], repo);
        const saida = `${stdout}${stderr}`;
        assert.equal(code, 1, saida);
        assert.ok(linhasDaSaida(saida).includes(linhaEn), saida);
        assert.ok(bytesDoManifesto(repo).equals(antes), "o manifesto precisa ficar byte a byte igual");
        afirmarSaidaLimpa(saida);
      });
    });

    test(`shouldPrintPtBrLineFromManifestLanguageAndKeepManifestBytesOnCommand_${comando}_when_${nome}`, () => {
      comRepo((repo) => {
        plantar(repo, "skills", valor);
        const antes = bytesDoManifesto(repo);
        const { code, stdout, stderr } = rodar(argv(repo), repo);
        const saida = `${stdout}${stderr}`;
        assert.equal(code, 1, saida);
        assert.ok(linhasDaSaida(saida).includes(linhaDeErro(M, chave, MANIFEST_NAME, parametro)), saida);
        assert.ok(bytesDoManifesto(repo).equals(antes), "o manifesto precisa ficar byte a byte igual");
        afirmarSaidaLimpa(saida);
      });
    });
  }
}

const RAIZES_NAO_OBJETO = [["string", "\"x\""], ["array", "[]"], ["null", "null"]];

for (const [comando, argv] of COMANDOS) {
  for (const [rotulo, conteudo] of RAIZES_NAO_OBJETO) {
    test(`shouldRefuseRootWithoutTouchingSkillsOrAnnouncingMigrationOnCommand_${comando}_when_root_${rotulo}`, () => {
      comRepo((repo) => {
        gravarBruto(repo, conteudo);
        const antes = bytesDoManifesto(repo);
        const pastas = listarSkills(repo);
        assert.ok(pastas.length > 0, "o controle tem skills instaladas");
        const { code, stdout, stderr } = rodar(argv(repo), repo);
        const saida = `${stdout}${stderr}`;
        assert.equal(code, 1, saida);
        assert.ok(linhasDaSaida(saida).includes(linhaDeErro(EN, "fileNotObject", MANIFEST_NAME)), saida);
        assert.ok(bytesDoManifesto(repo).equals(antes), "o manifesto precisa ficar byte a byte igual");
        assert.deepEqual(listarSkills(repo), pastas);
        for (const fragmento of [FRAGMENTO_COPY, FRAGMENTO_RELOCATE, FRAGMENTO_CONFIG]) {
          assert.ok(!saida.includes(fragmento), saida);
        }
        afirmarSaidaLimpa(saida);
      });
    });
  }

  test(`shouldCreateNoSkillsFolderOnCommand_${comando}_when_root_string_on_fresh_repo`, () => {
    const repo = tempDir("mgr-raiz-x-");
    try {
      mkdirSync(path.join(repo, ".mgr-core"), { recursive: true });
      gravarBruto(repo, "\"x\"");
      const { code, stdout, stderr } = rodar(argv(repo), repo);
      const saida = `${stdout}${stderr}`;
      assert.equal(code, 1, saida);
      assert.ok(linhasDaSaida(saida).includes(linhaDeErro(EN, "fileNotObject", MANIFEST_NAME)), saida);
      assert.equal(readFileSync(caminhoDoManifesto(repo), "utf8"), "\"x\"");
      assert.ok(!existsSync(path.join(repo, ".claude", "skills")), "nenhuma pasta de skill pode aparecer");
      afirmarSaidaLimpa(saida);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test(`shouldPrintPtBrFileNotObjectOnCommand_${comando}_when_root_null_with_user_language_flag`, () => {
    comRepo((repo) => {
      gravarBruto(repo, "null");
      const antes = bytesDoManifesto(repo);
      const { code, stdout, stderr } = rodar([...argv(repo), "--user-language", "pt-BR"], repo);
      const saida = `${stdout}${stderr}`;
      assert.equal(code, 1, saida);
      assert.ok(linhasDaSaida(saida).includes(linhaDeErro(M, "fileNotObject", MANIFEST_NAME)), saida);
      assert.ok(bytesDoManifesto(repo).equals(antes), "o manifesto precisa ficar byte a byte igual");
      afirmarSaidaLimpa(saida);
    });
  });
}

const caminhoDoRuntime = (repo) => path.join(repo, ".mgr-core", "runtime", "bin", "mgr-runtime.js");
const BIN_MGR = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));

const rodarNode = (args, dir, entrada = "") => {
  const home = tempDir("mgr-home-consumidor-");
  try {
    const ambiente = { ...process.env, HOME: home, LC_ALL: "C", NO_COLOR: "1" };
    for (const chave of ["LANG", "LANGUAGE", "LC_MESSAGES"]) delete ambiente[chave];
    const r = spawnSync("node", args, { encoding: "utf8", cwd: dir, env: ambiente, input: entrada, timeout: 60000 });
    return { code: r.status, stdout: `${r.stdout}`, stderr: `${r.stderr}` };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
};

const CONSUMIDORES_QUE_RECUSAM = [
  ["status", (repo) => [BIN_MGR, "status", repo]],
  ["uninstall", (repo) => [BIN_MGR, "uninstall", "-y", repo]],
  ["instructions", (repo) => [caminhoDoRuntime(repo), "instructions"]],
];

for (const [comando, argv] of CONSUMIDORES_QUE_RECUSAM) {
  for (const [rotulo, conteudo] of RAIZES_NAO_OBJETO) {
    test(`shouldRefuseRootInEnglishAndLeakNothingOnConsumer_${comando}_when_root_${rotulo}`, () => {
      comRepo((repo) => {
        gravarBruto(repo, conteudo);
        const antes = bytesDoManifesto(repo);
        const pastas = listarSkills(repo);
        const { code, stdout, stderr } = rodarNode(argv(repo), repo);
        const saida = `${stdout}${stderr}`;
        assert.equal(code, 1, saida);
        assert.ok(linhasDaSaida(saida).includes(linhaDeErro(EN, "fileNotObject", MANIFEST_NAME)), saida);
        assert.ok(bytesDoManifesto(repo).equals(antes), "o manifesto precisa ficar byte a byte igual");
        assert.deepEqual(listarSkills(repo), pastas);
        assert.ok(existsSync(path.join(repo, ".mgr-core")), saida);
        assert.ok(existsSync(path.join(repo, ".claude", "skills")), saida);
        afirmarSaidaLimpa(saida);
      });
    });
  }
}

const CONSUMIDORES_COM_SAIDA_DA_BASE = [
  ["agents", () => [BIN_MGR, "agents"], 0],
  ["origin", () => [BIN_MGR, "origin"], 0],
  ["runtime-versioning", () => [BIN_MGR, "runtime-versioning"], 0],
  ["add", (repo) => [BIN_MGR, "add", "@mgr/inexistente", repo], 1],
  ["remove", (repo) => [BIN_MGR, "remove", "@mgr/inexistente", repo], 1],
  ["hook", (repo) => [caminhoDoRuntime(repo), "detect", "--hook", "claude-code"], 0],
];

for (const [comando, argv, saidaEsperada] of CONSUMIDORES_COM_SAIDA_DA_BASE) {
  test(`shouldKeepBaselineExitOnConsumer_${comando}_overRootsStringArrayAndNull`, () => {
    for (const [rotulo, conteudo] of RAIZES_NAO_OBJETO) {
      comRepo((repo) => {
        gravarBruto(repo, conteudo);
        const { code, stdout, stderr } = rodarNode(argv(repo), repo, "{\"hook_event_name\":\"SessionStart\"}");
        assert.equal(code, saidaEsperada, `raiz ${rotulo}: ${stdout}${stderr}`);
      });
    }
  });
}

const MANIFESTOS_ILEGIVEIS = [["vazio", ""], ["json corrompido", "{\"skills\": [\"a\","]];

for (const [comando, argv] of COMANDOS) {
  for (const [rotulo, conteudo] of MANIFESTOS_ILEGIVEIS) {
    test(`shouldRefuseUnreadableManifestAndKeepBytesOnCommand_${comando}_when_${rotulo.replace(/ /g, "_")}`, () => {
      comRepo((repo) => {
        gravarBruto(repo, conteudo);
        const antes = bytesDoManifesto(repo);
        const { code, stdout, stderr } = rodar(argv(repo), repo);
        const saida = `${stdout}${stderr}`;
        assert.equal(code, 1, saida);
        assert.ok(linhasDaSaida(saida).includes(linhaDeErro(EN, "fileNotJson", MANIFEST_NAME)), saida);
        assert.ok(bytesDoManifesto(repo).equals(antes), "o manifesto precisa ficar byte a byte igual");
        afirmarSaidaLimpa(saida);
      });
    });
  }
}

const REMEDIO_UPDATE = "update";
const FIX_DO_UPDATE = "mgr update";
const PROVA_DO_UPDATE = "prova-funciona";
const CHECK_DA_ARQUITETURA = "architecture-skill";
const CHECK_DO_LOCKFILE = "lockfile-drift";
const ARQUIVO_DO_LOCKFILE = "mgr-skills.lock";

const ENVELOPE_DO_CONTROLE_MEDIDO_NO_COMMIT_5F449B8_EM_2026_11_19 = `{
  "schemaVersion": 1,
  "blocks": false,
  "outcome": "audited",
  "findings": [
    {
      "check": "lockfile-drift",
      "severity": "unavailable",
      "file": "mgr-skills.lock",
      "expected": "a lockfile, so there is something to compare",
      "found": "no lockfile: the project has no pluggable skill",
      "fix": null
    }
  ],
  "checks": 12
}
`;

const FORMAS_NAO_LETAIS_DA_LISTA = [
  { rotulo: "agentsDirs string", campo: "agentsDirs", valor: "x" },
  { rotulo: "optional objeto", campo: "optional", valor: {} },
  { rotulo: "allSkills string", campo: "allSkills", valor: "sim" },
  { rotulo: "userLanguage numero", campo: "userLanguage", valor: 7 },
  { rotulo: "architecture mvc", campo: "architecture", valor: "mvc" },
  { rotulo: "language array com elemento numerico", campo: "language", valor: [1] },
  { rotulo: "skills com nome inseguro", campo: "skills", valor: ["../x"] },
];

const FORMAS_DE_AGENTSDIRS_EXTRAS = [
  { rotulo: "agentsDirs array com elemento numerico", campo: "agentsDirs", valor: [1] },
  { rotulo: "agentsDirs objeto", campo: "agentsDirs", valor: {} },
];

const nomeSeguro = (rotulo) => rotulo.replace(/[^A-Za-z0-9]+/g, "_");

const doctorJson = (repo) => {
  const { code, stdout, stderr } = rodar(["doctor", "--json", repo], repo);
  return { code, bruto: stdout, json: JSON.parse(stdout), saida: `${stdout}${stderr}` };
};

const chaveDoProblema = ({ field, kind }) => `${field}/${kind}`;

const CASOS_DE_PROPRIEDADE = [
  ...formasLetaisDoManifesto().map((forma) => ({
    rotulo: forma.rotulo,
    aplicar: (repo) => plantar(repo, forma.campo, forma.valor),
  })),
  ...RAIZES_NAO_OBJETO.map(([rotulo, conteudo]) => ({
    rotulo: `raiz ${rotulo}`,
    aplicar: (repo) => gravarBruto(repo, conteudo),
  })),
  ...FORMAS_NAO_LETAIS_DA_LISTA.map((forma) => ({
    rotulo: `nao letal ${forma.rotulo}`,
    aplicar: (repo) => plantar(repo, forma.campo, forma.valor),
  })),
  ...FORMAS_NAO_LETAIS_DA_LISTA.map((forma) => ({
    rotulo: `letal derivado scope bogus junto de ${forma.rotulo}`,
    aplicar: (repo) => {
      plantar(repo, "scope", "bogus");
      plantar(repo, forma.campo, forma.valor);
    },
  })),
];

test("shouldKeepDoctorRemedyAndUpdateOutcomeEquivalentOverEveryMalformedManifestForm", () => {
  assert.ok(CASOS_DE_PROPRIEDADE.length >= 7 + 3 + 20, "a lista de casos nao pode encolher em silencio");
  for (const caso of CASOS_DE_PROPRIEDADE) {
    comRepo((repo) => {
      const dizer = (mensagem) => `[${caso.rotulo}] ${mensagem}`;
      caso.aplicar(repo);
      const antes = bytesDoManifesto(repo);
      const diagnostico = doctorJson(repo);
      const bloco = diagnostico.json.manifest;
      assert.ok(bloco, dizer(`o doctor precisa relatar o manifesto: ${diagnostico.saida}`));
      const problemas = bloco.problems;
      assert.ok(problemas.length >= 1, dizer("o doctor precisa relatar ao menos um problema"));
      for (const problema of problemas) {
        assert.ok(["update", "by-hand"].includes(problema.remedy), dizer(`remedy invalido: ${problema.remedy}`));
      }
      const todosUpdate = problemas.every(({ remedy }) => remedy === REMEDIO_UPDATE);

      assert.equal(bloco.fix === FIX_DO_UPDATE, todosUpdate, dizer(`manifest.fix: ${bloco.fix}`));
      assert.equal(bloco.prova === PROVA_DO_UPDATE, todosUpdate, dizer(`manifest.prova: ${bloco.prova}`));

      const atualizacao = rodar(["update", "-y", repo], repo);
      const saidaDoUpdate = `${atualizacao.stdout}${atualizacao.stderr}`;
      assert.equal(atualizacao.code, todosUpdate ? 0 : 1, dizer(saidaDoUpdate));

      if (todosUpdate) {
        const seguinte = doctorJson(repo);
        assert.equal(seguinte.json.outcome, "audited", dizer(seguinte.saida));
        const restantes = new Set((seguinte.json.manifest?.problems ?? []).map(chaveDoProblema));
        for (const problema of problemas) {
          assert.ok(!restantes.has(chaveDoProblema(problema)), dizer(`problema persiste: ${chaveDoProblema(problema)}`));
        }
      } else {
        assert.ok(bytesDoManifesto(repo).equals(antes), dizer("o manifesto precisa ficar byte a byte igual"));
        const prometidos = diagnostico.json.findings.filter(({ fix }) => fix === FIX_DO_UPDATE);
        assert.deepEqual(prometidos, [], dizer("achado promete mgr update que o update recusa"));
      }
    });
  }
});

const CASOS_DE_RELATO = [...FORMAS_NAO_LETAIS_DA_LISTA, ...FORMAS_DE_AGENTSDIRS_EXTRAS];

for (const forma of CASOS_DE_RELATO) {
  test(`shouldReportManifestProblemAsAuditedAndBlockWhen_${nomeSeguro(forma.rotulo)}`, () => {
    comRepo((repo) => {
      const plantado = plantar(repo, forma.campo, forma.valor);
      const esperados = manifestShapeProblems(plantado).map(chaveDoProblema).sort();
      assert.ok(esperados.length >= 1, "o manifesto plantado precisa ter ao menos um problema de forma");
      const { code, json, saida } = doctorJson(repo);
      assert.equal(code, 1, saida);
      assert.equal(json.outcome, "audited", saida);
      assert.equal(json.checks, CHECKS.length, saida);
      assert.equal(json.blocks, true, saida);
      assert.deepEqual(json.manifest.problems.map(chaveDoProblema).sort(), esperados, saida);
      const remedioEsperado = forma.campo === "agentsDirs" ? REMEDIO_UPDATE : "by-hand";
      for (const problema of json.manifest.problems) assert.equal(problema.remedy, remedioEsperado, saida);
      const lockfile = json.findings.find(({ check }) => check === CHECK_DO_LOCKFILE);
      assert.ok(lockfile, `o achado de antes precisa continuar: ${saida}`);
      assert.equal(lockfile.file, ARQUIVO_DO_LOCKFILE, saida);
    });
  });
}

test("shouldKeepArchitectureSkillFindingWithoutFixWhenArchitectureIsMvc", () => {
  comRepo((repo) => {
    plantar(repo, "architecture", "mvc");
    const { json, saida } = doctorJson(repo);
    const achado = json.findings.find(({ check }) => check === CHECK_DA_ARQUITETURA);
    assert.ok(achado, `architecture-skill precisa continuar emitido: ${saida}`);
    assert.equal(achado.fix, null, saida);
  });
});

test("shouldKeepAuditedEnvelopeByteForByteAndWithoutManifestKeyOnValidControl", () => {
  comRepo((repo) => {
    const { code, bruto, json } = doctorJson(repo);
    assert.equal(code, 0, bruto);
    assert.ok(!("manifest" in json), bruto);
    assert.equal(bruto, ENVELOPE_DO_CONTROLE_MEDIDO_NO_COMMIT_5F449B8_EM_2026_11_19);
  });
});

test("shouldPrintOutOfShapeBlockBeforeSummaryOnHumanDoctorWhenOptionalIsObject", () => {
  comRepo((repo) => {
    plantar(repo, "optional", {});
    const { json } = doctorJson(repo);
    const cabecalho = M.doctorManifestoCamposForaDeForma(json.manifest.file);
    const resumo = M.doctorResumo(json.checks, json.findings.length);
    const { code, stdout, stderr } = rodar(["doctor", repo], repo);
    const saida = `${stdout}${stderr}`;
    assert.equal(code, 1, saida);
    const posicaoDoBloco = saida.indexOf(cabecalho);
    const posicaoDoResumo = saida.indexOf(resumo);
    assert.ok(posicaoDoBloco >= 0, saida);
    assert.ok(posicaoDoResumo >= 0, saida);
    assert.ok(posicaoDoBloco < posicaoDoResumo, saida);
  });
});

for (const comando of ["update", "install"]) {
  test(`shouldAnnounceTheIgnoredLegacyDirectoryOnCommand_${comando}_whenTheOldLayoutDeclaresAnotherSkillsDir`, () => {
    comRepo((repo) => {
      plantar(repo, "model", "runtime-launcher");
      plantar(repo, "skillsDirs", ["../fora"]);
      const args = comando === "install" ? ["install", "-y", "--engine", "claude-code", repo] : ["update", "-y", repo];
      const { code, stdout, stderr } = rodar(args, repo);
      const saida = `${stdout}${stderr}`;
      assert.equal(code, 0, saida);
      assert.ok(saida.includes(M.uninstallPathIgnored("../fora")), saida);
      afirmarSaidaLimpa(saida);
    });
  });
}

test("shouldPointDerivedManifestProblemsToTheVersionedUpdateCommandThroughTheRuntime", () => {
  comRepo((repo) => {
    plantar(repo, "scope", "bogus");
    const versao = lerManifesto(repo).version;
    const { code, stdout, stderr } = rodarNode([caminhoDoRuntime(repo), "doctor"], repo);
    const saida = `${stdout}${stderr}`;
    assert.equal(code, 2, saida);
    assert.ok(saida.includes(M.doctorManifestoUpdateRecalcula), saida);
    assert.ok(saida.includes(M.doctorResolvaCom(`npx mgr-method@${versao} update`)), saida);
    assert.ok(!saida.includes(M.doctorResolvaCom("mgr update")), saida);
    afirmarSaidaLimpa(saida);
  });
});

test("shouldRefuseAnInvalidScopeFlagBeforeWritingAnything", () => {
  const repo = tempDir("mgr-escopo-invalido-");
  try {
    const { code, stdout, stderr } = rodar(["install", "-y", "--scope", "bogus", repo], repo);
    const saida = `${stdout}${stderr}`;
    assert.equal(code, 1, saida);
    assert.ok(saida.includes(getMessages("en").invalidScope("bogus")), saida);
    assert.equal(existsSync(path.join(repo, ".mgr-core")), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

const TEM_SCRIPT = spawnSync("script", ["--version"], { encoding: "utf8" }).status === 0;

test("shouldRefuseAnInvalidScopeFlagWithTheSameMessageInARealTerminal", { skip: TEM_SCRIPT ? false : "sem o utilitario script, nao ha pty para o caminho com terminal" }, () => {
  comRepo((repo) => {
    const home = tempDir("mgr-escopo-tty-home-");
    try {
      const comando = `stty cols 200 rows 50; node ${BIN_MGR} install --scope bogus ${repo}`;
      const r = spawnSync("script", ["-qec", comando, "/dev/null"], {
        encoding: "utf8", cwd: home, input: "", timeout: 60000,
        env: { ...process.env, HOME: home, LC_ALL: "C", NO_COLOR: "1", TERM: "xterm" },
      });
      const saida = `${r.stdout}${r.stderr}`;
      assert.ok(saida.includes(M.invalidScope("bogus")), saida);
      assert.ok(!saida.includes(M.qEngines), saida);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
