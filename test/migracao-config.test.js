import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { needsConfigMigration, needsRuntimeMigration, resolveProjectId } from "../src/installer.js";
import { MODEL_LAYERED, MODEL_RUNTIME, writeManifest } from "../src/manifest.js";

test("should write the layered-config model on a fresh manifest", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mgr-migracao-config-"));
  try {
    writeManifest(dir, { version: "0.0.0-test" });
    const written = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
    assert.equal(written.model, "self-contained-layered-config");
    assert.equal(written.model, MODEL_LAYERED);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should require both migrations for runtime-launcher, self-contained and absent model", () => {
  for (const prior of [{ model: "runtime-launcher" }, { model: "self-contained" }, {}]) {
    assert.equal(needsRuntimeMigration(prior), true, `runtime migration for ${JSON.stringify(prior)}`);
    assert.equal(needsConfigMigration(prior), true, `config migration for ${JSON.stringify(prior)}`);
  }
});

test("should require only the config migration for self-contained-runtime", () => {
  const prior = { model: MODEL_RUNTIME };
  assert.equal(needsRuntimeMigration(prior), false);
  assert.equal(needsConfigMigration(prior), true);
});

test("should require no migration for self-contained-layered-config", () => {
  const prior = { model: MODEL_LAYERED };
  assert.equal(needsRuntimeMigration(prior), false);
  assert.equal(needsConfigMigration(prior), false);
});

test("should require nothing when there is no prior install", () => {
  for (const prior of [null, undefined]) {
    assert.equal(needsRuntimeMigration(prior), false);
    assert.equal(needsConfigMigration(prior), false);
  }
});

// `mgr precompact` e `mgr status` como processo filho, com HOME temporário: o manifesto de contexto vai
// para ~/.mgr-core/context/ e o teste não pode tocar o escopo global do usuário. LC_ALL=C fixa o idioma
// das mensagens em inglês, que é o texto que os asserts comparam.
const BIN = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
const ambiente = (home) => ({ ...process.env, LC_ALL: "C", HOME: home });
const cenario = (fn) => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mgr-repo-"));
  const home = mkdtempSync(path.join(os.tmpdir(), "mgr-home-"));
  try {
    fn(repo, home);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
};
const instalar = (repo, home, projectId) => {
  const r = spawnSync("node", [BIN, "install", repo, "--engine", "claude-code", "--scope", "project",
    "-y", "--project-id", projectId], { env: ambiente(home), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};
const conversa = (home) => {
  const arquivo = path.join(home, "sessao-1.jsonl");
  writeFileSync(arquivo, '{"type":"user"}\n{"type":"assistant"}\n', "utf8");
  return arquivo;
};
const hookPrecompact = (repo, home, transcript) => spawnSync("node", [BIN, "precompact", "--hook", "claude-code"], {
  cwd: repo, env: ambiente(home), encoding: "utf8",
  input: JSON.stringify({ trigger: "auto", transcript_path: transcript, session_id: "sessao-1" }),
});
const contextoGlobal = (home) => path.join(home, ".mgr-core", "context");

test("should reference the context under the personal projectId", () => cenario((repo, home) => {
  instalar(repo, home, "proj-pessoal");
  // Um manifesto com outro id não pode vencer a camada pessoal (DT-16).
  const manifesto = path.join(repo, ".mgr-core", "manifest.json");
  writeFileSync(manifesto, JSON.stringify({ ...JSON.parse(readFileSync(manifesto, "utf8")), projectId: "proj-do-manifesto" }, null, 2), "utf8");

  const saida = hookPrecompact(repo, home, conversa(home));
  assert.equal(saida.status, 0);
  assert.ok(existsSync(path.join(contextoGlobal(home), "proj-pessoal.json")), "a referência fica sob o projectId pessoal");
  assert.equal(existsSync(path.join(contextoGlobal(home), "proj-do-manifesto.json")), false,
    "o manifesto só vale quando a camada pessoal não tem projectId");
}));

test("should fall back to the manifest projectId on a non-migrated project", () => cenario((repo, home) => {
  // Projeto anterior à DT-16: o projectId ainda mora no manifesto e não existe config.local.json.
  mkdirSync(path.join(repo, ".mgr-core"), { recursive: true });
  writeFileSync(path.join(repo, ".mgr-core", "manifest.json"),
    JSON.stringify({ version: "0.0.0-test", projectId: "proj-antigo" }, null, 2), "utf8");

  const saida = hookPrecompact(repo, home, conversa(home));
  assert.equal(saida.status, 0);
  assert.ok(existsSync(path.join(contextoGlobal(home), "proj-antigo.json")),
    "sem a camada pessoal, o projectId do manifesto ainda endereça a referência");
}));

test("should write nothing under the global context without any projectId", () => cenario((repo, home) => {
  // Sem instalação e sem manifesto: não há id para endereçar, e inventar um pelo nome da pasta é proibido (D-17).
  const saida = hookPrecompact(repo, home, conversa(home));
  assert.equal(saida.status, 0, "derrubar a sessão de quem só abriu o editor é o que o hook proíbe");
  assert.equal(existsSync(contextoGlobal(home)), false, "sem projectId nenhum manifesto de contexto nasce");
}));

test("should keep the personal projectId when config.json also declares one", () => cenario((repo, home) => {
  instalar(repo, home, "proj-pessoal");
  // A chave pessoal escrita no config do time: o método a ignora e avisa (CA-6).
  const cfgPath = path.join(repo, ".mgr-core", "config.json");
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
  writeFileSync(cfgPath, JSON.stringify({ ...cfg, projectId: "proj-do-time" }, null, 2), "utf8");

  const saida = hookPrecompact(repo, home, conversa(home));
  assert.equal(saida.status, 0);
  assert.ok(existsSync(path.join(contextoGlobal(home), "proj-pessoal.json")), "o projectId efetivo é o da camada pessoal");
  assert.equal(existsSync(path.join(contextoGlobal(home), "proj-do-time.json")), false);

  const status = spawnSync("node", [BIN, "status", repo], { env: ambiente(home), encoding: "utf8" });
  assert.equal(status.status, 0, status.stderr);
  assert.ok(status.stderr.includes(".mgr-core/config.json: projectId is personal and belongs in .mgr-core/config.local.json; it was ignored."),
    "o aviso da L-1 chega pelo stderr do status");
  assert.match(status.stdout, /proj-pessoal/);
  assert.doesNotMatch(status.stdout, /proj-do-time/, "o status mostra o id efetivo, não o do time");
}));

// --- P1.16: migração DT-16 de ponta a ponta ---------------------------------------------------------
const MARCA = "# mgr-managed-skill:";
const COMO_F1 = "proj-f1";

const lerJson = (arquivo) => JSON.parse(readFileSync(arquivo, "utf8"));
const arquivosDe = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? arquivosDe(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const impressaoDaArvore = (raiz) => Object.fromEntries(arquivosDe(raiz).sort().map((f) =>
  [path.relative(raiz, f), createHash("sha256").update(readFileSync(f)).digest("hex")]));
const skillsMd = (repo) => {
  const dir = path.join(repo, ".claude", "skills");
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "_shared" && existsSync(path.join(dir, e.name, "SKILL.md")))
    .map((e) => path.join(dir, e.name, "SKILL.md"));
};

// Monta um projeto no layout da F1 (`self-contained-runtime`): instala e reescreve à mão o que a F2 grava.
const comoF1 = (repo, home) => {
  assert.notEqual(spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: repo, encoding: "utf8" }).status, 0,
    "o projeto do teste precisa estar fora de um repositório git");
  instalar(repo, home, COMO_F1);
  const core = path.join(repo, ".mgr-core");
  const manifesto = lerJson(path.join(core, "manifest.json"));
  delete manifesto.optional;
  delete manifesto.allSkills;
  writeFileSync(path.join(core, "manifest.json"),
    JSON.stringify({ ...manifesto, model: MODEL_RUNTIME, projectId: COMO_F1 }, null, 2), "utf8");
  rmSync(path.join(core, "config.local.json"), { force: true });
  for (const arquivo of skillsMd(repo)) {
    const texto = readFileSync(arquivo, "utf8").split("\n").filter((l) => !l.startsWith(MARCA)).join("\n");
    writeFileSync(arquivo, texto, "utf8");
  }
};
const atualizar = (repo, home) => spawnSync("node", [BIN, "update", repo], { env: ambiente(home), encoding: "utf8" });

test("should resolve projectId as flag then personal then manifest then env then folder", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mgr-fontes-"));
  try {
    const core = path.join(repo, ".mgr-core");
    mkdirSync(core, { recursive: true });
    writeFileSync(path.join(core, "config.local.json"), JSON.stringify({ projectId: "do-pessoal" }), "utf8");
    writeFileSync(path.join(core, ".env"), "MGR_PROJECT_ID=do-env\n", "utf8");
    const prior = { projectId: "do-manifesto" };
    const resolver = (flag, p) => resolveProjectId({ flag, coreDir: core, prior: p, repo });

    assert.equal(resolver("da-flag", prior), "da-flag");
    assert.equal(resolver(null, prior), "do-pessoal");
    rmSync(path.join(core, "config.local.json"));
    assert.equal(resolver(null, prior), "do-manifesto");
    assert.equal(resolver(null, {}), "do-env");
    rmSync(path.join(core, ".env"));
    assert.equal(resolver(null, {}), path.basename(repo));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("should migrate a self-contained-runtime install announcing before the first difference", () => cenario((repo, home) => {
  comoF1(repo, home);
  // Preparação da CA-10: a versão anterior não tinha a `configure-agents`, então ela tem de ENTRAR.
  rmSync(path.join(repo, ".claude", "skills", "configure-agents"), { recursive: true, force: true });
  const manifestoAntigo = lerJson(path.join(repo, ".mgr-core", "manifest.json"));
  writeFileSync(path.join(repo, ".mgr-core", "manifest.json"),
    JSON.stringify({ ...manifestoAntigo, skills: manifestoAntigo.skills.filter((nome) => nome !== "configure-agents") }), "utf8");
  const r = atualizar(repo, home);
  assert.equal(r.status, 0, r.stderr);

  const saida = r.stdout + r.stderr;
  const anuncio = saida.indexOf("Installation in the previous layout");
  const primeira = saida.indexOf("skill entering: configure-agents");
  assert.ok(anuncio >= 0, "a migração é anunciada");
  assert.ok(primeira >= 0, "a skill que a versão anterior não tinha entra e é anunciada");
  assert.ok(anuncio < primeira, "o anúncio vem antes da primeira linha de diferença");

  const core = path.join(repo, ".mgr-core");
  assert.equal(lerJson(path.join(core, "config.local.json")).projectId, COMO_F1, "o id anterior passa para a camada pessoal");
  const manifesto = lerJson(path.join(core, "manifest.json"));
  assert.equal(manifesto.model, MODEL_LAYERED);
  assert.equal("projectId" in manifesto, false, "o manifesto versionado deixa de carregar o projectId");
  const skills = skillsMd(repo);
  assert.ok(skills.length > 0);
  for (const arquivo of skills) {
    assert.ok(readFileSync(arquivo, "utf8").includes(MARCA), `${arquivo} carrega a marca de posse`);
  }
}));

test("should change no file of an F1-layout project on doctor and runtime agents", () => cenario((repo, home) => {
  comoF1(repo, home);
  const antes = impressaoDaArvore(repo);
  assert.ok(Object.keys(antes).length > 0);

  const doctor = spawnSync("node", [BIN, "doctor", repo], { env: ambiente(home), encoding: "utf8" });
  assert.notEqual(doctor.status, null, "o doctor termina por conta própria");
  assert.deepEqual(impressaoDaArvore(repo), antes, "o doctor não escreve em nada");

  const runtime = path.join(repo, ".claude", "skills", "_shared", "mgr", "bin", "mgr-runtime.js");
  const agents = spawnSync("node", [runtime, "agents", "--json"], { cwd: repo, env: ambiente(home), encoding: "utf8" });
  assert.equal(agents.status, 0, agents.stderr);
  assert.deepEqual(impressaoDaArvore(repo), antes, "o runtime agents não escreve em nada");
}));

test("should be idempotent on a layered-config manifest", () => cenario((repo, home) => {
  comoF1(repo, home);
  const primeiro = atualizar(repo, home);
  assert.equal(primeiro.status, 0, primeiro.stderr);
  const local = path.join(repo, ".mgr-core", "config.local.json");
  const antes = readFileSync(local, "utf8");

  const segundo = atualizar(repo, home);
  assert.equal(segundo.status, 0, segundo.stderr);
  assert.doesNotMatch(segundo.stdout + segundo.stderr, /Installation in the previous layout/);
  assert.equal(readFileSync(local, "utf8"), antes, "o config.local.json fica byte a byte igual");
  assert.equal(lerJson(path.join(repo, ".mgr-core", "manifest.json")).model, MODEL_LAYERED);
}));
