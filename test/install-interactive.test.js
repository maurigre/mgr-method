import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { askInstall } from "../src/install-interactive.js";
import * as installer from "../src/installer.js";
import { manifestPath } from "../src/manifest.js";
import { getMessages } from "../src/messages.js";
import { writeOrigin } from "../src/registry.js";
import { UsageError } from "../src/errors.js";
import { tempDir } from "../scripts/lib/tmp.mjs";

process.env.HOME = tempDir("mgr-install-interativo-home-");

const msg = getMessages("en");
const ENV = { LC_ALL: "C" };
const FLAGS = { engines: [], scope: null, language: null, arch: null, userLanguage: null, projectId: null, allSkills: false };

const stubAsk = (respostas = {}) => {
  const chamadas = [];
  const responder = (tipo) => async (opcoes) => {
    chamadas.push({ tipo, ...opcoes });
    if (opcoes.message in respostas) return respostas[opcoes.message];
    return opcoes.initialValue ?? opcoes.initialValues ?? opcoes.options?.[0]?.value;
  };
  return {
    chamadas,
    ask: {
      multiselect: responder("multiselect"),
      select: responder("select"),
      text: responder("text"),
      confirm: responder("confirm"),
      isCancel: () => false,
    },
  };
};

const instalado = (opcoes) => {
  const repo = tempDir("mgr-install-interativo-");
  installer.execute(installer.planInstall(["copilot"], "project", repo, { userLanguage: "en", ...opcoes }));
  return repo;
};

const plantar = (repo, alteracao) => {
  const arquivo = manifestPath(installer.coreDir("project", repo));
  writeFileSync(arquivo, JSON.stringify({ ...JSON.parse(readFileSync(arquivo, "utf8")), ...alteracao }));
};

const recusaDe = async (acao) => {
  try {
    await acao();
  } catch (erro) {
    return erro;
  }
  return null;
};

test("should answer with the previous valid declarations as defaults when the person only presses enter", async () => {
  const repo = instalado({ architecture: "clean", language: "java", projectId: "id-gravado" });
  const { ask } = stubAsk();
  const respostas = await askInstall(ask, { flags: FLAGS, repo, env: ENV, msg });
  assert.deepEqual(respostas.engines, ["copilot"]);
  assert.equal(respostas.architecture, "clean");
  assert.equal(respostas.language, "java");
  assert.equal(respostas.userLanguage, "en");
  assert.equal(respostas.projectId, "id-gravado");
});

test("should answer with the fixed defaults on a project with no installation", async () => {
  const repo = tempDir("mgr-install-interativo-novo-");
  const { ask } = stubAsk();
  const respostas = await askInstall(ask, { flags: FLAGS, repo, env: ENV, msg });
  assert.deepEqual(respostas.engines, ["claude-code"]);
  assert.equal(respostas.architecture, "hexagonal");
  assert.equal(respostas.language, "java");
  assert.equal(respostas.projectId, path.basename(repo));
});

test("should refuse an unreadable manifest before the first question", async () => {
  const repo = instalado({ architecture: "clean" });
  writeFileSync(manifestPath(installer.coreDir("project", repo)), "{ nao e json");
  const { ask, chamadas } = stubAsk();
  const erro = await recusaDe(() => askInstall(ask, { flags: FLAGS, repo, env: ENV, msg }));
  assert.ok(erro instanceof UsageError);
  assert.equal(erro.key, "fileNotJson");
  assert.equal(chamadas.length, 0);
});

test("should refuse allSkills out of shape before the first question even with the engine flag", async () => {
  const repo = instalado({ architecture: "clean" });
  plantar(repo, { allSkills: "sim" });
  const { ask, chamadas } = stubAsk();
  const erro = await recusaDe(() => askInstall(ask, { flags: { ...FLAGS, engines: ["claude-code"] }, repo, env: ENV, msg }));
  assert.equal(erro.key, "manifestRefused");
  assert.equal(chamadas.length, 0);
});

test("should accept allSkills out of shape when the all-skills flag covers it and skip architecture and language", async () => {
  const repo = instalado({ architecture: "clean", language: "java" });
  plantar(repo, { allSkills: "sim" });
  const { ask, chamadas } = stubAsk();
  await askInstall(ask, { flags: { ...FLAGS, allSkills: true }, repo, env: ENV, msg });
  assert.equal(chamadas.some((c) => c.message === msg.qArchitecture), false);
  assert.equal(chamadas.some((c) => c.message === msg.qLanguage), false);
});

test("should not ask the origin again when it is already recorded in the chosen scope", async () => {
  const repo = instalado({ architecture: "clean" });
  writeOrigin(installer.coreDir("project", repo), "brownfield");
  const { ask, chamadas } = stubAsk();
  await askInstall(ask, { flags: FLAGS, repo, env: ENV, msg });
  assert.equal(chamadas.some((c) => c.message === msg.qOrigin), false);
});

test("should ask the origin when nothing is recorded", async () => {
  const repo = instalado({ architecture: "clean" });
  const { ask, chamadas } = stubAsk();
  await askInstall(ask, { flags: FLAGS, repo, env: ENV, msg });
  assert.equal(chamadas.some((c) => c.message === msg.qOrigin), true);
});

const instaladoNoGlobal = (opcoes) => {
  installer.execute(installer.planInstall(["claude-code"], "global", tempDir("mgr-install-interativo-g-"), { userLanguage: "en", ...opcoes }));
};

test("should take the defaults from the global manifest when the scope flag is global", async () => {
  instaladoNoGlobal({ architecture: "onion", language: "java" });
  const repo = instalado({ architecture: "clean" });
  const { ask } = stubAsk();
  const respostas = await askInstall(ask, { flags: { ...FLAGS, scope: "global" }, repo, env: ENV, msg });
  assert.equal(respostas.scope, "global");
  assert.equal(respostas.architecture, "onion");
});

test("should switch the defaults to the manifest of the answered scope when it differs from the guess", async () => {
  instaladoNoGlobal({ architecture: "onion", language: "java" });
  const repo = tempDir("mgr-install-interativo-sem-projeto-");
  const { ask } = stubAsk({ [msg.qScope]: "project" });
  const respostas = await askInstall(ask, { flags: FLAGS, repo, env: ENV, msg });
  assert.equal(respostas.scope, "project");
  assert.equal(respostas.architecture, "hexagonal");
});

test("should not refuse because of the project manifest when the scope flag chooses the global one", async () => {
  instaladoNoGlobal({ architecture: "onion", language: "java" });
  const repo = instalado({ architecture: "clean" });
  writeFileSync(manifestPath(installer.coreDir("project", repo)), "{ nao e json");
  const { ask } = stubAsk();
  const respostas = await askInstall(ask, { flags: { ...FLAGS, scope: "global" }, repo, env: ENV, msg });
  assert.equal(respostas.architecture, "onion");
});
