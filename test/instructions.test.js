import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import {
  instructionBlock,
  instructionFilePath,
  installedEngines,
  instructionsToRemove,
  planInstructions,
  writeInstructionBlock,
} from "../src/instructions.js";
import {
  BLOCK_DECLINE,
  BLOCK_WRITE,
  REMOVAL_ASK,
  REMOVAL_ASSUMED,
  REMOVAL_NO_CONSENT,
  consentToBlock,
} from "../src/prompts.js";
import { instructions } from "../src/commands/instructions.js";
import { blockState } from "../src/managed-block.js";
import { getMessages } from "../src/messages.js";

const OPEN = "<!-- >>> mgr-method (managed block: mgr uninstall removes it) >>> -->";
const CLOSE = "<!-- <<< mgr-method <<< -->";

const comRepo = (corpo) => async () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mgr-instructions-"));
  try {
    return await corpo(repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
};

const criarConstituicao = (repo) => {
  mkdirSync(path.join(repo, "docs", "sdd"), { recursive: true });
  writeFileSync(path.join(repo, "docs", "sdd", "CONSTITUTION.md"), "# regras\n", "utf8");
};

const criarManifesto = (base, manifesto) => {
  mkdirSync(path.join(base, ".mgr-core"), { recursive: true });
  writeFileSync(path.join(base, ".mgr-core", "manifest.json"), JSON.stringify(manifesto), "utf8");
};

const blocoDesatualizado = (repo, file) => {
  const alvo = path.join(repo, file);
  writeFileSync(alvo, `${OPEN}\nlinha antiga\n${CLOSE}\n`, "utf8");
};

test("should return the literal import block for claude-code", () => {
  assert.deepEqual(instructionBlock("claude-code"), [
    "<!-- >>> mgr-method (managed block: mgr uninstall removes it) >>> -->",
    "Project constitution (non-negotiable rules, mgr-method): @docs/sdd/CONSTITUTION.md",
    "SDD tiers live in `docs/sdd/`; feature specs live in `specs/<slug>/`.",
    "<!-- <<< mgr-method <<< -->",
  ]);
});

test("should return the literal pointer block for copilot", () => {
  assert.deepEqual(instructionBlock("copilot"), [
    "<!-- >>> mgr-method (managed block: mgr uninstall removes it) >>> -->",
    "Project constitution (non-negotiable rules, mgr-method): read `docs/sdd/CONSTITUTION.md` before proposing or changing code.",
    "SDD tiers live in `docs/sdd/`; feature specs live in `specs/<slug>/`.",
    "<!-- <<< mgr-method <<< -->",
  ]);
});

test("should point claude-code to CLAUDE.md at the repository root", comRepo((repo) => {
  assert.equal(instructionFilePath("claude-code", repo), path.join(repo, "CLAUDE.md"));
}));

test("should point copilot to .github/copilot-instructions.md", comRepo((repo) => {
  assert.equal(instructionFilePath("copilot", repo), path.join(repo, ".github", "copilot-instructions.md"));
}));

test("should offer the engine when requested, constitution present and no block", comRepo((repo) => {
  criarConstituicao(repo);

  const plano = planInstructions(repo, { engines: ["claude-code"] });

  assert.deepEqual(plano.offer, [{ engine: "claude-code", file: "CLAUDE.md", state: "no-file" }]);
  assert.deepEqual(plano.kept, []);
  assert.equal(plano.constitution, "present");
}));

test("should not offer the engine when it was not requested", comRepo((repo) => {
  criarConstituicao(repo);

  const plano = planInstructions(repo, { engines: ["copilot"] });

  assert.ok(!plano.offer.some((item) => item.engine === "claude-code"));
}));

test("should not offer the engine when the constitution is absent", comRepo((repo) => {
  const plano = planInstructions(repo, { engines: ["claude-code"] });

  assert.deepEqual(plano.offer, []);
  assert.equal(plano.constitution, "absent");
}));

test("should not offer the engine when its block is already current", comRepo((repo) => {
  criarConstituicao(repo);
  writeInstructionBlock(repo, "claude-code");

  const plano = planInstructions(repo, { engines: ["claude-code"] });

  assert.deepEqual(plano.offer, []);
  assert.deepEqual(plano.kept, []);
}));

test("should offer the engine again when its block is outdated", comRepo((repo) => {
  criarConstituicao(repo);
  blocoDesatualizado(repo, "CLAUDE.md");

  const plano = planInstructions(repo, { engines: ["claude-code"] });

  assert.deepEqual(plano.offer, [{ engine: "claude-code", file: "CLAUDE.md", state: "outdated" }]);
  assert.deepEqual(plano.kept, []);
}));

test("should keep a current block of an engine that was not requested", comRepo((repo) => {
  criarConstituicao(repo);
  writeInstructionBlock(repo, "claude-code");

  const plano = planInstructions(repo, { engines: ["copilot"] });

  assert.deepEqual(plano.kept, [{ engine: "claude-code", file: "CLAUDE.md" }]);
  assert.ok(!plano.offer.some((item) => item.engine === "claude-code"));
}));

test("should keep an outdated block of an engine that was not requested", comRepo((repo) => {
  criarConstituicao(repo);
  blocoDesatualizado(repo, "CLAUDE.md");

  const plano = planInstructions(repo, { engines: ["copilot"] });

  assert.deepEqual(plano.kept, [{ engine: "claude-code", file: "CLAUDE.md" }]);
}));

test("should not keep an engine that was not requested and has no block", comRepo((repo) => {
  criarConstituicao(repo);

  const plano = planInstructions(repo, { engines: ["copilot"] });

  assert.deepEqual(plano.kept, []);
}));

test("should return no null anywhere in the plan", comRepo((repo) => {
  criarConstituicao(repo);
  writeInstructionBlock(repo, "claude-code");

  const plano = planInstructions(repo, { engines: ["copilot"] });

  assert.equal(JSON.stringify(plano).includes("null"), false);
}));

test("should remove the block when it is present and scope is project", comRepo((repo) => {
  writeInstructionBlock(repo, "claude-code");

  const remover = instructionsToRemove(repo, { scope: "project", projectInstalled: true });

  assert.deepEqual(remover, [{ engine: "claude-code", file: "CLAUDE.md" }]);
}));

test("should keep the block when scope is global and the project has its own install", comRepo((repo) => {
  writeInstructionBlock(repo, "claude-code");

  const remover = instructionsToRemove(repo, { scope: "global", projectInstalled: true });

  assert.deepEqual(remover, []);
}));

test("should neither read nor refuse an open block on global uninstall when the project has its own install", comRepo((repo) => {
  const file = path.join(repo, "CLAUDE.md");
  writeFileSync(file, "<!-- >>> mgr-method (managed block: mgr uninstall removes it) >>> -->\nsem fecho\n");
  const antes = readFileSync(file);

  const remover = instructionsToRemove(repo, { scope: "global", projectInstalled: true });

  assert.deepEqual(remover, []);
  assert.deepEqual(readFileSync(file), antes);
  assert.throws(() => instructionsToRemove(repo, { scope: "project", projectInstalled: true }), /sem linha de fecho/);
}));

test("should remove the block when scope is global and the project has no own install", comRepo((repo) => {
  writeInstructionBlock(repo, "claude-code");

  const remover = instructionsToRemove(repo, { scope: "global", projectInstalled: false });

  assert.deepEqual(remover, [{ engine: "claude-code", file: "CLAUDE.md" }]);
}));

test("should return an empty list when there is no block, whatever the scope", comRepo((repo) => {
  assert.deepEqual(instructionsToRemove(repo, { scope: "project", projectInstalled: true }), []);
  assert.deepEqual(instructionsToRemove(repo, { scope: "global", projectInstalled: false }), []);
}));

test("should remove an outdated block as well", comRepo((repo) => {
  blocoDesatualizado(repo, "CLAUDE.md");

  const remover = instructionsToRemove(repo, { scope: "project", projectInstalled: true });

  assert.deepEqual(remover, [{ engine: "claude-code", file: "CLAUDE.md" }]);
}));

test("should read the installed engines from the project manifest", comRepo((repo) => {
  criarManifesto(repo, { engines: ["claude-code"] });

  assert.deepEqual(installedEngines(repo), { source: "project", engines: ["claude-code"] });
}));

test("should read the installed engines from the global manifest when the project has none", comRepo(async (repo) => {
  const home = mkdtempSync(path.join(os.tmpdir(), "mgr-instructions-home-"));
  const homeAnterior = process.env.HOME;
  try {
    criarManifesto(home, { engines: ["copilot"] });
    process.env.HOME = home;

    assert.deepEqual(installedEngines(repo), { source: "global", engines: ["copilot"] });
  } finally {
    if (homeAnterior === undefined) delete process.env.HOME;
    else process.env.HOME = homeAnterior;
    rmSync(home, { recursive: true, force: true });
  }
}));

test("should report none when there is no manifest in the project or globally", comRepo(async (repo) => {
  const home = mkdtempSync(path.join(os.tmpdir(), "mgr-instructions-home-"));
  const homeAnterior = process.env.HOME;
  try {
    process.env.HOME = home;

    assert.deepEqual(installedEngines(repo), { source: "none", engines: [] });
  } finally {
    if (homeAnterior === undefined) delete process.env.HOME;
    else process.env.HOME = homeAnterior;
    rmSync(home, { recursive: true, force: true });
  }
}));

const stubAsk = (resposta) => {
  const chamadas = [];
  const ask = {
    confirm: async (opcoes) => {
      chamadas.push(opcoes);
      return resposta;
    },
    isCancel: () => false,
  };
  return { ask, chamadas };
};

test("should ask once with the received message and return write on yes", async () => {
  const { ask, chamadas } = stubAsk(true);

  const decisao = await consentToBlock(ask, { mode: REMOVAL_ASK, message: "gravar o bloco?" });

  assert.equal(decisao, BLOCK_WRITE);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].message, "gravar o bloco?");
  assert.equal(chamadas[0].initialValue, true);
});

test("should ask once with the received message and return decline on no", async () => {
  const { ask, chamadas } = stubAsk(false);

  const decisao = await consentToBlock(ask, { mode: REMOVAL_ASK, message: "gravar o bloco?" });

  assert.equal(decisao, BLOCK_DECLINE);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].message, "gravar o bloco?");
  assert.equal(chamadas[0].initialValue, true);
});

test("should return write without asking in assumed mode", async () => {
  const { ask, chamadas } = stubAsk(false);

  const decisao = await consentToBlock(ask, { mode: REMOVAL_ASSUMED, message: "gravar o bloco?" });

  assert.equal(decisao, BLOCK_WRITE);
  assert.equal(chamadas.length, 0);
});

test("should return decline without asking in no-consent mode", async () => {
  const { ask, chamadas } = stubAsk(true);

  const decisao = await consentToBlock(ask, { mode: REMOVAL_NO_CONSENT, message: "gravar o bloco?" });

  assert.equal(decisao, BLOCK_DECLINE);
  assert.equal(chamadas.length, 0);
});

const MGR = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
const RUNTIME = [".mgr-core", "runtime", "bin", "mgr-runtime.js"];
const CLAUDE = "CLAUDE.md";
const COPILOT = ".github/copilot-instructions.md";
const M = getMessages("en");
const BLOCO_CLAUDE = instructionBlock("claude-code");
const BLOCO_COPILOT = instructionBlock("copilot");
const PREVIO_CRLF = "# Regras locais\r\nlinha um\r\nfinal sem quebra";

const ambiente = (home) => ({ ...process.env, LC_ALL: "C", HOME: home });
const normaliza = (texto) => stripVTControlCharacters(texto).replace(/[│\s]+/g, " ");
const saidaDe = (resultado) => `${resultado.stdout}${resultado.stderr}`;
const contem = (saida, mensagem) => normaliza(saida).includes(normaliza(mensagem));
const posicao = (saida, mensagem) => normaliza(saida).indexOf(normaliza(mensagem));
const sha256 = (conteudo) => createHash("sha256").update(conteudo).digest("hex");
const shaDo = (arquivo) => sha256(readFileSync(arquivo));
const blocoComQuebra = (bloco) => `${bloco.join("\n")}\n`;
const abertoMensagem = (arquivo) => `bloco do mgr-method sem linha de fecho em ${arquivo}; corrija o arquivo à mão`;

const run = (args, { cwd, home, input = "" }) =>
  spawnSync(process.execPath, [MGR, ...args], { encoding: "utf8", input, cwd, env: ambiente(home) });
const runtime = (script, args, { cwd, home }) =>
  spawnSync(process.execPath, [script, ...args], { encoding: "utf8", input: "", cwd, env: ambiente(home) });
const git = (repo, home, args) => spawnSync("git", args, { encoding: "utf8", cwd: repo, env: ambiente(home) });

const comCasaERepo = (corpo) => async () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mgr-instructions-cli-"));
  const home = mkdtempSync(path.join(os.tmpdir(), "mgr-instructions-home-"));
  try {
    return await corpo({ repo, home });
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
};

const instalar = (repo, home, engine, { yes = true, extra = [] } = {}) =>
  run(
    ["install", "--engine", engine, "--scope", "project", "--all-skills", ...(yes ? ["-y"] : []), "--user-language", "en", ...extra, repo],
    { cwd: repo, home },
  );

const instalarGlobal = (repo, home) =>
  run(["install", "--engine", "claude-code", "--scope", "global", "--all-skills", "-y", "--user-language", "en", repo], { cwd: repo, home });

const iniciarRepoGit = (repo, home) => {
  git(repo, home, ["init", "-q"]);
  git(repo, home, ["-c", "user.name=Teste", "-c", "user.email=teste@example.invalid", "commit", "--allow-empty", "-q", "-m", "chore: base do teste"]);
};

const impressaoGit = (repo, home) => ({
  index: shaDo(path.join(repo, ".git", "index")),
  revs: git(repo, home, ["rev-list", "--all"]).stdout,
});

const arvore = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
  const caminho = path.join(dir, entrada.name);
  return entrada.isDirectory() ? arvore(caminho) : [[path.relative(dir, caminho), shaDo(caminho)]];
});

const manifestosAcima = (dir) => {
  const achados = [];
  let atual = dir;
  for (;;) {
    if (existsSync(path.join(atual, ".mgr-core", "manifest.json"))) achados.push(atual);
    const pai = path.dirname(atual);
    if (pai === atual) return achados;
    atual = pai;
  }
};

test("should write the literal import block to CLAUDE.md when installing claude-code", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);

  const resultado = instalar(repo, home, "claude-code");

  assert.equal(resultado.status, 0, saidaDe(resultado));
  assert.equal(readFileSync(path.join(repo, CLAUDE), "utf8"), blocoComQuebra(BLOCO_CLAUDE));
}));

test("should not create the copilot file or AGENTS.md when installing claude-code", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);

  const resultado = instalar(repo, home, "claude-code");

  assert.equal(resultado.status, 0, saidaDe(resultado));
  assert.equal(existsSync(path.join(repo, COPILOT)), false);
  assert.equal(existsSync(path.join(repo, "AGENTS.md")), false);
}));

test("should write the literal pointer block to copilot-instructions.md when installing copilot", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);

  const resultado = instalar(repo, home, "copilot");

  assert.equal(resultado.status, 0, saidaDe(resultado));
  assert.equal(readFileSync(path.join(repo, COPILOT), "utf8"), blocoComQuebra(BLOCO_COPILOT));
}));

test("should not create CLAUDE.md or AGENTS.md when installing copilot", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);

  const resultado = instalar(repo, home, "copilot");

  assert.equal(resultado.status, 0, saidaDe(resultado));
  assert.equal(existsSync(path.join(repo, CLAUDE)), false);
  assert.equal(existsSync(path.join(repo, "AGENTS.md")), false);
}));

test("should write each engine block literally when installing both engines", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);

  const resultado = instalar(repo, home, "both");

  assert.equal(resultado.status, 0, saidaDe(resultado));
  assert.equal(readFileSync(path.join(repo, CLAUDE), "utf8"), blocoComQuebra(BLOCO_CLAUDE));
  assert.equal(readFileSync(path.join(repo, COPILOT), "utf8"), blocoComQuebra(BLOCO_COPILOT));
}));

test("should announce one plan line per file before the first write when installing both engines", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);

  const resultado = instalar(repo, home, "both");

  const saida = saidaDe(resultado);
  const planos = [posicao(saida, M.planInstructions(CLAUDE)), posicao(saida, M.planInstructions(COPILOT))];
  const escritas = [posicao(saida, M.instructionsWritten(CLAUDE)), posicao(saida, M.instructionsWritten(COPILOT))];
  assert.equal(resultado.status, 0, saida);
  assert.ok(planos.every((indice) => indice >= 0), saida);
  assert.ok(escritas.every((indice) => indice >= 0), saida);
  assert.ok(Math.max(...planos) < Math.min(...escritas));
}));

test("should keep the prior CRLF content byte for byte and append the block with CRLF", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);
  writeFileSync(path.join(repo, CLAUDE), PREVIO_CRLF, "utf8");

  const resultado = instalar(repo, home, "claude-code");

  assert.equal(resultado.status, 0, saidaDe(resultado));
  assert.equal(readFileSync(path.join(repo, CLAUDE), "utf8"), `${PREVIO_CRLF}\r\n${BLOCO_CLAUDE.join("\r\n")}\r\n`);
}));

test("should keep the sha256 and announce no plan on a second install with the block current", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);
  writeFileSync(path.join(repo, CLAUDE), PREVIO_CRLF, "utf8");
  const primeira = instalar(repo, home, "claude-code");
  assert.equal(primeira.status, 0, saidaDe(primeira));
  const arquivo = path.join(repo, CLAUDE);
  const hashAntes = shaDo(arquivo);

  const segunda = instalar(repo, home, "claude-code");

  assert.equal(segunda.status, 0, saidaDe(segunda));
  assert.equal(contem(saidaDe(segunda), M.planInstructions(CLAUDE)), false);
  assert.equal(shaDo(arquivo), hashAntes);
  assert.equal(readFileSync(arquivo, "utf8").split(OPEN).length - 1, 1);
}));

test("should converge an outdated block and keep the text around it byte for byte on update", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);
  assert.equal(instalar(repo, home, "claude-code").status, 0);
  const arquivo = path.join(repo, CLAUDE);
  writeFileSync(arquivo, `antes\n${OPEN}\nlinha antiga\n${CLOSE}\ndepois\n`, "utf8");
  assert.equal(blockState(arquivo, BLOCO_CLAUDE), "outdated");

  const resultado = run(["update", "-y", repo], { cwd: repo, home });

  assert.equal(resultado.status, 0, saidaDe(resultado));
  assert.equal(readFileSync(arquivo, "utf8"), `antes\n${BLOCO_CLAUDE.join("\n")}\ndepois\n`);
}));

test("should neither announce nor write the block without a constitution on install and update", comCasaERepo(({ repo, home }) => {
  const instalacao = instalar(repo, home, "claude-code");
  assert.equal(instalacao.status, 0, saidaDe(instalacao));

  const atualizacao = run(["update", "-y", repo], { cwd: repo, home });

  const saida = `${saidaDe(instalacao)}${saidaDe(atualizacao)}`;
  assert.equal(atualizacao.status, 0, saida);
  assert.equal(contem(saida, M.planInstructions(CLAUDE)), false);
  assert.equal(contem(saida, M.instructionsWritten(CLAUDE)), false);
  assert.equal(existsSync(path.join(repo, CLAUDE)), false);
}));

test("should keep a prior file byte for byte and announce the decline without terminal or -y", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);
  const arquivo = path.join(repo, CLAUDE);
  writeFileSync(arquivo, "# meu\n", "utf8");

  const resultado = instalar(repo, home, "claude-code", { yes: false });

  assert.equal(resultado.status, 0, saidaDe(resultado));
  assert.equal(readFileSync(arquivo, "utf8"), "# meu\n");
  assert.ok(contem(saidaDe(resultado), M.instructionsDeclined(CLAUDE)));
}));

test("should not create the instruction file without terminal or -y when there is no prior file", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);

  const resultado = instalar(repo, home, "claude-code", { yes: false });

  assert.equal(resultado.status, 0, saidaDe(resultado));
  assert.equal(existsSync(path.join(repo, CLAUDE)), false);
}));

test("should show the plan on dry-run without writing, changing or asking about the block", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);
  const arquivo = path.join(repo, CLAUDE);
  writeFileSync(arquivo, "# meu\n", "utf8");

  const resultado = instalar(repo, home, "claude-code", { yes: false, extra: ["--dry-run"] });

  const saida = saidaDe(resultado);
  assert.equal(resultado.status, 0, saida);
  assert.ok(contem(saida, M.planInstructions(CLAUDE)));
  assert.equal(contem(saida, M.qInstructionsBlock(CLAUDE)), false);
  assert.equal(readFileSync(arquivo, "utf8"), "# meu\n");
}));

test("should show the plan on dry-run with -y and write neither the block nor the manifest", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);
  const arquivo = path.join(repo, CLAUDE);
  writeFileSync(arquivo, "# meu\n", "utf8");

  const resultado = run(
    ["install", "--dry-run", "-y", "--engine", "claude-code", "--scope", "project", "--all-skills", "--user-language", "en", repo],
    { cwd: repo, home },
  );

  const saida = saidaDe(resultado);
  assert.equal(resultado.status, 0, saida);
  assert.ok(contem(saida, M.planInstructions(CLAUDE)));
  assert.equal(contem(saida, M.instructionsWritten(CLAUDE)), false);
  assert.equal(readFileSync(arquivo, "utf8"), "# meu\n");
  assert.equal(existsSync(path.join(repo, ".mgr-core", "manifest.json")), false);
}));

test("should neither announce nor write the block on global scope with a constitution", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);

  const resultado = instalarGlobal(repo, home);

  assert.equal(resultado.status, 0, saidaDe(resultado));
  assert.equal(contem(saidaDe(resultado), M.planInstructions(CLAUDE)), false);
  assert.equal(existsSync(path.join(repo, CLAUDE)), false);
}));

test("should neither announce nor write the block when installing with --skills-dir", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);

  const resultado = run(
    ["install", "--skills-dir", path.join(repo, "custom"), "-y", "--user-language", "en", repo],
    { cwd: repo, home },
  );

  assert.equal(resultado.status, 0, saidaDe(resultado));
  assert.equal(contem(saidaDe(resultado), M.planInstructions(CLAUDE)), false);
  assert.equal(existsSync(path.join(repo, CLAUDE)), false);
}));

test("should refuse install with an open block and leave the file and the manifest untouched", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);
  const arquivo = path.join(repo, CLAUDE);
  const previo = `${OPEN}\nlinha solta\n`;
  writeFileSync(arquivo, previo, "utf8");

  const resultado = instalar(repo, home, "claude-code");

  assert.equal(resultado.status, 1, saidaDe(resultado));
  assert.ok(contem(saidaDe(resultado), abertoMensagem(arquivo)));
  assert.equal(readFileSync(arquivo, "utf8"), previo);
  assert.equal(existsSync(path.join(repo, ".mgr-core", "manifest.json")), false);
}));

test("should refuse update with an open block and leave the file byte for byte", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);
  assert.equal(instalar(repo, home, "claude-code").status, 0);
  const arquivo = path.join(repo, CLAUDE);
  const previo = `${OPEN}\nlinha solta\n`;
  writeFileSync(arquivo, previo, "utf8");

  const resultado = run(["update", "-y", repo], { cwd: repo, home });

  assert.equal(resultado.status, 1, saidaDe(resultado));
  assert.ok(contem(saidaDe(resultado), abertoMensagem(arquivo)));
  assert.equal(readFileSync(arquivo, "utf8"), previo);
}));

test("should refuse uninstall and runtime instructions with an open block and keep the core dir", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);
  assert.equal(instalar(repo, home, "claude-code").status, 0);
  const arquivo = path.join(repo, CLAUDE);
  const previo = `${OPEN}\nlinha solta\n`;
  writeFileSync(arquivo, previo, "utf8");

  const remocao = run(["uninstall", "--scope", "project", "-y", repo], { cwd: repo, home });
  const estado = runtime(path.join(repo, ...RUNTIME), ["instructions", "--json"], { cwd: repo, home });

  assert.equal(remocao.status, 1, saidaDe(remocao));
  assert.ok(contem(saidaDe(remocao), abertoMensagem(arquivo)));
  assert.equal(existsSync(path.join(repo, ".mgr-core")), true);
  assert.equal(readFileSync(arquivo, "utf8"), previo);
  assert.equal(estado.status, 1, saidaDe(estado));
  assert.ok(contem(saidaDe(estado), abertoMensagem(arquivo)));
}));

test("should decline the block on update without -y and write it on update with -y", comCasaERepo(({ repo, home }) => {
  assert.equal(instalar(repo, home, "claude-code").status, 0);
  criarConstituicao(repo);
  const arquivo = path.join(repo, CLAUDE);

  const semConsentimento = run(["update", repo], { cwd: repo, home });

  assert.equal(semConsentimento.status, 0, saidaDe(semConsentimento));
  assert.ok(contem(saidaDe(semConsentimento), M.planInstructions(CLAUDE)));
  assert.ok(contem(saidaDe(semConsentimento), M.instructionsDeclined(CLAUDE)));
  assert.equal(existsSync(arquivo), false);

  const comConsentimento = run(["update", "-y", repo], { cwd: repo, home });

  assert.equal(comConsentimento.status, 0, saidaDe(comConsentimento));
  assert.equal(readFileSync(arquivo, "utf8"), blocoComQuebra(BLOCO_CLAUDE));
}));

test("should keep the copilot block untouched and announce it when installing only claude-code", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);
  assert.equal(instalar(repo, home, "both").status, 0);
  const arquivoCopilot = path.join(repo, COPILOT);
  const hashAntes = shaDo(arquivoCopilot);

  const resultado = instalar(repo, home, "claude-code");

  assert.equal(resultado.status, 0, saidaDe(resultado));
  assert.equal(shaDo(arquivoCopilot), hashAntes);
  assert.ok(contem(saidaDe(resultado), M.instructionsKept(COPILOT, "copilot")));
}));

test("should announce the kept copilot block again on update", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);
  assert.equal(instalar(repo, home, "both").status, 0);
  assert.equal(instalar(repo, home, "claude-code").status, 0);

  const resultado = run(["update", "-y", repo], { cwd: repo, home });

  assert.equal(resultado.status, 0, saidaDe(resultado));
  assert.ok(contem(saidaDe(resultado), M.instructionsKept(COPILOT, "copilot")));
}));

test("should announce each block before removal, remove both and keep the prior user file", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);
  const previo = "# meu\n";
  writeFileSync(path.join(repo, CLAUDE), previo, "utf8");
  assert.equal(instalar(repo, home, "both").status, 0);

  const remocao = run(["uninstall", "--scope", "project", "-y", repo], { cwd: repo, home });

  const saida = saidaDe(remocao);
  assert.equal(remocao.status, 0, saida);
  const aRemover = [posicao(saida, M.instructionsToRemove(CLAUDE)), posicao(saida, M.instructionsToRemove(COPILOT))];
  const removidos = [posicao(saida, M.instructionsRemoved(CLAUDE)), posicao(saida, M.instructionsRemoved(COPILOT))];
  assert.ok(aRemover.every((indice) => indice >= 0), saida);
  assert.ok(removidos.every((indice) => indice >= 0), saida);
  assert.ok(Math.max(...aRemover) < Math.min(...removidos));
  assert.equal(readFileSync(path.join(repo, CLAUDE), "utf8"), previo);
  assert.equal(existsSync(path.join(repo, COPILOT)), false);
}));

test("should keep docs and specs with the same sha256 on uninstall", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);
  mkdirSync(path.join(repo, "specs", "slug"), { recursive: true });
  writeFileSync(path.join(repo, "specs", "slug", "01-spec.md"), "# spec\n", "utf8");
  const docsAntes = arvore(path.join(repo, "docs"));
  const specsAntes = arvore(path.join(repo, "specs"));
  assert.equal(instalar(repo, home, "both").status, 0);

  const remocao = run(["uninstall", "--scope", "project", "-y", repo], { cwd: repo, home });

  assert.equal(remocao.status, 0, saidaDe(remocao));
  assert.deepEqual(arvore(path.join(repo, "docs")), docsAntes);
  assert.deepEqual(arvore(path.join(repo, "specs")), specsAntes);
}));

test("should report no-file, write the block once and keep it current through the runtime", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);
  const instalacao = instalar(repo, home, "claude-code", { yes: false });
  assert.equal(instalacao.status, 0, saidaDe(instalacao));
  const script = path.join(repo, ...RUNTIME);
  const arquivo = path.join(repo, CLAUDE);

  const estado = runtime(script, ["instructions", "--json"], { cwd: repo, home });

  assert.equal(estado.status, 0, saidaDe(estado));
  const dados = JSON.parse(estado.stdout);
  assert.equal(dados.source, "project");
  assert.deepEqual(dados.files, [{ engine: "claude-code", file: CLAUDE, state: "no-file" }]);

  const escrita = runtime(script, ["instructions", "write", "--engine", "claude-code"], { cwd: repo, home });

  const saida = saidaDe(escrita);
  assert.equal(escrita.status, 0, saida);
  assert.ok(posicao(saida, M.instructionsWriting(CLAUDE)) >= 0);
  assert.ok(posicao(saida, M.instructionsWriting(CLAUDE)) < posicao(saida, M.instructionsWritten(CLAUDE)));
  assert.equal(readFileSync(arquivo, "utf8"), blocoComQuebra(BLOCO_CLAUDE));
  const hashAntes = shaDo(arquivo);

  const repetida = runtime(script, ["instructions", "write", "--engine", "claude-code"], { cwd: repo, home });

  assert.equal(repetida.status, 0, saidaDe(repetida));
  assert.ok(contem(saidaDe(repetida), M.instructionsCurrent(CLAUDE)));
  assert.equal(shaDo(arquivo), hashAntes);
}));

test("should refuse the runtime write for an engine not installed and for a missing constitution", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);
  assert.equal(instalar(repo, home, "claude-code", { yes: false }).status, 0);
  const script = path.join(repo, ...RUNTIME);

  const copilot = runtime(script, ["instructions", "write", "--engine", "copilot"], { cwd: repo, home });

  assert.equal(copilot.status, 1, saidaDe(copilot));
  assert.ok(contem(saidaDe(copilot), M.instructionsEngineNotInstalled("copilot", "claude-code")));
  assert.equal(existsSync(path.join(repo, COPILOT)), false);

  rmSync(path.join(repo, "docs", "sdd", "CONSTITUTION.md"));
  const semConstituicao = runtime(script, ["instructions", "write"], { cwd: repo, home });

  assert.equal(semConstituicao.status, 1, saidaDe(semConstituicao));
  assert.ok(contem(saidaDe(semConstituicao), M.instructionsNoConstitution()));
  assert.equal(existsSync(path.join(repo, CLAUDE)), false);
}));

test("should read the global install and write the block in the project root through the runtime", comCasaERepo(({ repo, home }) => {
  assert.deepEqual(manifestosAcima(path.dirname(repo)), []);
  criarConstituicao(repo);
  const instalacao = instalarGlobal(repo, home);
  assert.equal(instalacao.status, 0, saidaDe(instalacao));
  const script = path.join(home, ...RUNTIME);

  const estado = runtime(script, ["instructions", "--json"], { cwd: repo, home });

  assert.equal(estado.status, 0, saidaDe(estado));
  assert.equal(JSON.parse(estado.stdout).source, "global");
  const escrita = runtime(script, ["instructions", "write"], { cwd: repo, home });
  assert.equal(escrita.status, 0, saidaDe(escrita));
  assert.equal(readFileSync(path.join(repo, CLAUDE), "utf8"), blocoComQuebra(BLOCO_CLAUDE));
}));

test("should refuse the runtime write with no engine installed in the project or globally", comCasaERepo(({ repo, home }) => {
  assert.deepEqual(manifestosAcima(path.dirname(repo)), []);
  criarConstituicao(repo);
  assert.equal(instalarGlobal(repo, home).status, 0);
  rmSync(path.join(home, ".mgr-core", "manifest.json"));
  const script = path.join(home, ...RUNTIME);

  const escrita = runtime(script, ["instructions", "write"], { cwd: repo, home });

  assert.equal(escrita.status, 1, saidaDe(escrita));
  assert.ok(contem(saidaDe(escrita), M.instructionsNoEngine()));
  assert.equal(existsSync(path.join(repo, CLAUDE)), false);
}));

test("should keep the git index and history unchanged on install, update and uninstall", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);
  iniciarRepoGit(repo, home);
  const antes = impressaoGit(repo, home);

  const instalacao = instalar(repo, home, "claude-code");
  assert.equal(instalacao.status, 0, saidaDe(instalacao));
  assert.deepEqual(impressaoGit(repo, home), antes);

  const atualizacao = run(["update", "-y", repo], { cwd: repo, home });
  assert.equal(atualizacao.status, 0, saidaDe(atualizacao));
  assert.deepEqual(impressaoGit(repo, home), antes);

  const remocao = run(["uninstall", "--scope", "project", "-y", repo], { cwd: repo, home });
  assert.equal(remocao.status, 0, saidaDe(remocao));
  assert.deepEqual(impressaoGit(repo, home), antes);
}));

test("should keep the git index and history unchanged when the runtime writes the block", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);
  iniciarRepoGit(repo, home);
  assert.equal(instalar(repo, home, "claude-code", { yes: false }).status, 0);
  const antes = impressaoGit(repo, home);

  const escrita = runtime(path.join(repo, ...RUNTIME), ["instructions", "write"], { cwd: repo, home });

  assert.equal(escrita.status, 0, saidaDe(escrita));
  assert.ok(contem(saidaDe(escrita), M.instructionsWritten(CLAUDE)));
  assert.deepEqual(impressaoGit(repo, home), antes);
}));

const coletor = () => {
  const out = [];
  const err = [];
  return { io: { out: (linha) => out.push(linha), err: (linha) => err.push(linha) }, out, err };
};

const instalacaoSimulada = (repo) => {
  criarConstituicao(repo);
  criarManifesto(repo, { engines: ["claude-code"], scope: "project", version: "0.0.0" });
};

test("should print the instructions state as one JSON line with exit 0 in the documented key order", comCasaERepo(({ repo }) => {
  instalacaoSimulada(repo);
  const { io, out, err } = coletor();

  assert.equal(instructions({ root: repo, positional: [], flags: { json: true }, io, M }), 0);

  assert.equal(out.length, 1);
  assert.deepEqual(err, []);
  const dados = JSON.parse(out[0]);
  assert.deepEqual(Object.keys(dados), ["schemaVersion", "constitution", "source", "files"]);
  assert.deepEqual(dados, {
    schemaVersion: 1,
    constitution: "present",
    source: "project",
    files: [{ engine: "claude-code", file: "CLAUDE.md", state: "no-file" }],
  });
}));

test("should print the state line for each engine without --json", comCasaERepo(({ repo }) => {
  instalacaoSimulada(repo);
  const { io, out } = coletor();

  assert.equal(instructions({ root: repo, positional: [], flags: {}, io, M }), 0);

  assert.deepEqual(out, [M.instructionsStateLine(CLAUDE, "no-file")]);
}));

test("should write the block and print writing then written, then report current on a second write", comCasaERepo(({ repo }) => {
  instalacaoSimulada(repo);
  const primeira = coletor();

  assert.equal(instructions({ root: repo, positional: ["write"], flags: {}, io: primeira.io, M }), 0);

  assert.equal(readFileSync(path.join(repo, CLAUDE), "utf8"), `${instructionBlock("claude-code").join("\n")}\n`);
  assert.deepEqual(primeira.out, [M.instructionsWriting(CLAUDE), M.instructionsWritten(CLAUDE)]);

  const segunda = coletor();
  assert.equal(instructions({ root: repo, positional: ["write"], flags: {}, io: segunda.io, M }), 0);
  assert.deepEqual(segunda.out, [M.instructionsCurrent(CLAUDE)]);
}));

test("should refuse the write for an engine not installed and create no file for it", comCasaERepo(({ repo }) => {
  instalacaoSimulada(repo);
  const { io, out, err } = coletor();

  assert.equal(instructions({ root: repo, positional: ["write"], flags: { engines: ["copilot"] }, io, M }), 1);

  assert.deepEqual(out, []);
  assert.equal(err.length, 1);
  assert.ok(err[0].includes(M.instructionsEngineNotInstalled("copilot", "claude-code")));
  assert.equal(existsSync(path.join(repo, COPILOT)), false);
}));

test("should refuse the write without constitution and create no file", comCasaERepo(({ repo }) => {
  criarManifesto(repo, { engines: ["claude-code"], scope: "project", version: "0.0.0" });
  const { io, out, err } = coletor();

  assert.equal(instructions({ root: repo, positional: ["write"], flags: {}, io, M }), 1);

  assert.deepEqual(out, []);
  assert.equal(err.length, 1);
  assert.ok(err[0].includes(M.instructionsNoConstitution()));
  assert.equal(existsSync(path.join(repo, CLAUDE)), false);
}));

test("should refuse the write with no manifest in the project or globally", comCasaERepo(({ repo, home }) => {
  criarConstituicao(repo);
  const homeAnterior = process.env.HOME;
  const { io, out, err } = coletor();
  try {
    process.env.HOME = home;

    assert.equal(instructions({ root: repo, positional: ["write"], flags: {}, io, M }), 1);
  } finally {
    if (homeAnterior === undefined) delete process.env.HOME;
    else process.env.HOME = homeAnterior;
  }

  assert.deepEqual(out, []);
  assert.equal(err.length, 1);
  assert.ok(err[0].includes(M.instructionsNoEngine()));
  assert.equal(existsSync(path.join(repo, CLAUDE)), false);
}));

test("should refuse an unknown instructions subverb with exit 1 and write to err only", comCasaERepo(({ repo }) => {
  const { io, out, err } = coletor();

  assert.equal(instructions({ root: repo, positional: ["bogus"], flags: {}, io, M }), 1);

  assert.deepEqual(out, []);
  assert.equal(err.length, 1);
}));

test("should refuse --json with exit 1 and a message naming the missing closing line when the block is open", comCasaERepo(({ repo }) => {
  instalacaoSimulada(repo);
  writeFileSync(path.join(repo, CLAUDE), `${OPEN}\nlinha solta\n`, "utf8");
  const { io, out, err } = coletor();

  assert.equal(instructions({ root: repo, positional: [], flags: { json: true }, io, M }), 1);

  assert.deepEqual(out, []);
  assert.equal(err.length, 1);
  assert.ok(err[0].includes("sem linha de fecho"));
}));
