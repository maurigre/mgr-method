import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const BIN = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
const SKILLS = path.join(".claude", "skills");

const repoTemporario = () => mkdtempSync(path.join(os.tmpdir(), "mgr-reconcilia-"));

// Subprocesso nao herda terminal: e justamente o caminho sem consentimento possivel que estes casos
// precisam exercitar, e que nenhum stub alcanca.
const roda = (...args) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

const instala = (repo, ...args) => roda("install", "--engine", "claude-code", "--user-language", "en", ...args, repo);

const manifesto = (repo) => JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8"));

test("negativo: pasta que o metodo nunca declarou sobrevive a instalacao e nao e nomeada", () => {
  const repo = repoTemporario();
  try {
    assert.equal(instala(repo, "--arch", "hexagonal", "-y").code, 0);
    const plantada = path.join(repo, SKILLS, "skill-do-usuario");
    mkdirSync(plantada, { recursive: true });
    writeFileSync(path.join(plantada, "SKILL.md"), "posta a mao\n");
    const r = instala(repo, "--arch", "layered", "-y");
    assert.equal(r.code, 0);
    assert.ok(existsSync(path.join(plantada, "SKILL.md")),
      "na 0.6.0-beta.1 o remove apagou a skill do proprio metodo; nunca apagar pasta que nao instalou");
    assert.ok(!r.out.includes("skill-do-usuario"),
      "nem sequer NOMEAR: a lista sai de dois conjuntos que o metodo escreveu, nunca do disco");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("negativo: sem terminal e sem -y, nada sai do disco e a saida diz por que", () => {
  const repo = repoTemporario();
  try {
    instala(repo, "--arch", "hexagonal", "--language", "java", "-y");
    const r = instala(repo, "--arch", "layered");
    assert.equal(r.code, 0, "recusar nunca transforma a instalacao em erro");
    assert.ok(existsSync(path.join(repo, SKILLS, "arch-hexagonal")));
    assert.ok(existsSync(path.join(repo, SKILLS, "junit-clean")));
    assert.match(r.out, /stayed on disk and stay declared/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("negativo: --dry-run nomeia o que sairia, sem perguntar, sem remover e sem reescrever", () => {
  const repo = repoTemporario();
  try {
    instala(repo, "--arch", "hexagonal", "--language", "java", "-y");
    const antes = manifesto(repo);
    const r = instala(repo, "--arch", "layered", "--dry-run");
    assert.equal(r.code, 0);
    assert.match(r.out, /leaving the declared set \(2\)/);
    assert.ok(!r.out.includes("Removed"));
    assert.deepEqual(manifesto(repo).skills, antes.skills);
    assert.ok(existsSync(path.join(repo, SKILLS, "arch-hexagonal")));
    assert.ok(existsSync(path.join(repo, SKILLS, "junit-clean")));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("negativo: a remocao nao alcanca _shared, agentes, .mgr-core, docs nem specs", () => {
  const repo = repoTemporario();
  try {
    instala(repo, "--arch", "hexagonal", "--language", "java", "-y");
    const agentes = path.join(repo, ".claude", "agents");
    const tinhaAgentes = existsSync(agentes);
    mkdirSync(path.join(repo, "docs"), { recursive: true });
    writeFileSync(path.join(repo, "docs", "meu.md"), "meu\n");
    mkdirSync(path.join(repo, "specs"), { recursive: true });
    writeFileSync(path.join(repo, "specs", "minha.md"), "minha\n");
    const r = instala(repo, "--arch", "layered", "-y");
    assert.match(r.out, /Removed 2 skill/);
    assert.ok(existsSync(path.join(repo, SKILLS, "_shared")));
    assert.ok(existsSync(path.join(repo, ".mgr-core", "manifest.json")));
    assert.ok(existsSync(path.join(repo, "docs", "meu.md")));
    assert.ok(existsSync(path.join(repo, "specs", "minha.md")));
    assert.equal(existsSync(agentes), tinhaAgentes);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("apos a recusa por falta de terminal, nada vira orfa: o manifesto continua declarando", () => {
  const repo = repoTemporario();
  try {
    instala(repo, "--arch", "hexagonal", "--language", "java", "-y");
    instala(repo, "--arch", "layered");
    const declaradas = manifesto(repo).skills;
    assert.ok(declaradas.includes("arch-hexagonal"));
    assert.ok(declaradas.includes("junit-clean"));
    assert.ok(declaradas.includes("arch-layered"));
    const diagnostico = roda("doctor", repo);
    assert.match(diagnostico.out, /checks, \d+ finding/,
      "sem confirmar que o doctor RODOU, a ausencia de `orphan-skill` tambem passaria com ele quebrado");
    assert.ok(!diagnostico.out.includes("orphan-skill"),
      "a orfa e o unico achado sem remediacao: recusar a remocao nao pode fabricar uma");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("depois da recusa, a execucao seguinte com -y remove mesmo: a mensagem diz a verdade", () => {
  const repo = repoTemporario();
  try {
    instala(repo, "--arch", "hexagonal", "--language", "java", "-y");
    instala(repo, "--arch", "layered");
    const r = instala(repo, "--arch", "layered", "-y");
    assert.match(r.out, /Removed 2 skill/);
    assert.ok(!existsSync(path.join(repo, SKILLS, "arch-hexagonal")));
    assert.ok(!existsSync(path.join(repo, SKILLS, "junit-clean")));
    const diagnostico = roda("doctor", repo);
    assert.match(diagnostico.out, /checks, \d+ finding/);
    assert.ok(!diagnostico.out.includes("orphan-skill"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a ordem do consentimento e estrutural: o --dry-run retorna ANTES de qualquer pergunta", () => {
  const borda = readFileSync(BIN, "utf8");
  const saidaDoDryRun = borda.indexOf("if (flags.dryRun)");
  const pergunta = borda.indexOf("consentToRemove(");
  assert.ok(saidaDoDryRun > 0 && pergunta > 0);
  assert.ok(saidaDoDryRun < pergunta,
    "sem terminal o consentToRemove nao pergunta nada, entao nenhum teste por subprocesso ve a diferenca; a ordem so e observavel COM terminal, e e por isso que aqui ela e conferida na fonte");
});

test("negativo: skill que esta versao ja nao distribui nao derruba a instalacao, e e anunciada", () => {
  const repo = repoTemporario();
  try {
    instala(repo, "--arch", "hexagonal", "-y");
    const arquivo = path.join(repo, ".mgr-core", "manifest.json");
    const man = JSON.parse(readFileSync(arquivo, "utf8"));
    man.skills.push("skill-fantasma");
    writeFileSync(arquivo, JSON.stringify(man, null, 2));
    mkdirSync(path.join(repo, SKILLS, "skill-fantasma"), { recursive: true });
    const r = instala(repo, "--arch", "layered");
    assert.equal(r.code, 0, "a spec promete exit 0 nos quatro caminhos; reconstruir nome ausente do pacote dava 1");
    assert.match(r.out, /no longer ships skill-fantasma/);
    assert.ok(!manifesto(repo).skills.includes("skill-fantasma"),
      "declarar o que o pacote nao tem quebraria o proximo update pelo mesmo caminho");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("negativo: a migracao do modelo antigo nao ressuscita o lancador que ela descarta", () => {
  const repo = repoTemporario();
  try {
    mkdirSync(path.join(repo, ".mgr-core"), { recursive: true });
    mkdirSync(path.join(repo, SKILLS, "arch-onion"), { recursive: true });
    writeFileSync(path.join(repo, SKILLS, "arch-onion", "SKILL.md"), "lancador antigo\n");
    writeFileSync(path.join(repo, ".mgr-core", "manifest.json"), JSON.stringify({
      model: "runtime-launcher", version: "0.0.1", engines: ["claude-code"], scope: "project",
      skillsDirs: [".claude/skills"], skills: ["arch-onion"], projectId: "x",
    }, null, 2));
    const r = instala(repo, "--arch", "hexagonal");
    assert.equal(r.code, 0);
    assert.ok(!existsSync(path.join(repo, SKILLS, "arch-onion")),
      "o migrateOld descarta o lancador; mante-lo declarado o traria de volta como skill de verdade");
    assert.ok(!manifesto(repo).skills.includes("arch-onion"),
      "duas skills de arquitetura instaladas e o estado que o PRD chama de defeito");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
