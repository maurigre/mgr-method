import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const BIN = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
const CONFIG = path.join(".mgr-core", "config.json");
const SKILLS = path.join(".claude", "skills");

const repoTemporario = () => mkdtempSync(path.join(os.tmpdir(), "mgr-origem-"));

// `mgr origin set` resolve o repositorio pelo CWD, entao o subprocesso roda DENTRO dele. Subprocesso
// tambem nao herda terminal, que e o caminho sem consentimento que o install exercita.
const cli = (args, cwd) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

const instala = (repo, ...args) => cli(["install", "--engine", "claude-code", "--user-language", "en", ...args, "-y", repo]);

const config = (repo) => JSON.parse(readFileSync(path.join(repo, CONFIG), "utf8"));

test("negativo: origin set sem valor sai 1 e nao cria o config", () => {
  const repo = repoTemporario();
  try {
    const r = cli(["origin", "set"], repo);
    assert.equal(r.code, 1);
    assert.ok(!existsSync(path.join(repo, CONFIG)), "recusar antes de escrever e o que impede o arquivo de nascer errado");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("negativo: valor fora do vocabulario sai 1 e nao cria o config", () => {
  const repo = repoTemporario();
  try {
    const r = cli(["origin", "set", "legacy"], repo);
    assert.equal(r.code, 1);
    assert.match(r.out, /greenfield \| brownfield/);
    assert.ok(!existsSync(path.join(repo, CONFIG)));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("origin set grava, anuncia, e avisa quando nao ha instalacao local", () => {
  const repo = repoTemporario();
  try {
    const r = cli(["origin", "set", "brownfield", "--user-language", "en"], repo);
    assert.equal(r.code, 0);
    assert.equal(config(repo).origin, "brownfield");
    assert.match(r.out, /Writing the project origin/, "LOG-1: informacao ANTES de alterar estado em disco");
    assert.match(r.out, /project origin: . -> brownfield/);
    assert.match(r.out, /no MGR installation found/,
      "sem esta asserção, apagar o aviso deixava a suite verde e o terceiro verbo do nome nao provava nada");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a segunda execucao mostra o valor anterior", () => {
  const repo = repoTemporario();
  try {
    cli(["origin", "set", "brownfield"], repo);
    const r = cli(["origin", "set", "greenfield"], repo);
    assert.equal(r.code, 0);
    assert.match(r.out, /brownfield/);
    assert.match(r.out, /greenfield/);
    assert.equal(config(repo).origin, "greenfield");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("negativo: config ilegivel nao e sobrescrito", () => {
  const repo = repoTemporario();
  try {
    mkdirSync(path.join(repo, ".mgr-core"), { recursive: true });
    writeFileSync(path.join(repo, CONFIG), "{ isto nao e json\n");
    const antes = readFileSync(path.join(repo, CONFIG), "utf8");
    const r = cli(["origin", "set", "brownfield"], repo);
    assert.equal(r.code, 1);
    assert.equal(readFileSync(path.join(repo, CONFIG), "utf8"), antes,
      "apagar a configuracao de quem usa seria pior que o erro que o comando esta relatando");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("gravar a origem preserva o default do config e nao inventa chave alem dele", () => {
  const repo = repoTemporario();
  try {
    cli(["origin", "set", "greenfield"], repo);
    assert.deepEqual(Object.keys(config(repo)).sort(), ["origin", "registries"],
      "`registries: []` e o default documentado do readConfig, nao invencao: parar de grava-lo faria `listRegistries` devolver undefined");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("install duas vezes com flags diferentes e depois update nao apagam a origem", () => {
  const repo = repoTemporario();
  try {
    instala(repo, "--arch", "hexagonal");
    assert.equal(cli(["origin", "set", "brownfield"], repo).code, 0);
    instala(repo, "--arch", "layered");
    assert.equal(cli(["update", repo], repo).code, 0);
    assert.equal(config(repo).origin, "brownfield",
      "o manifesto e reescrito inteiro a cada install; e por isso que a origem mora no config");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("negativo: sem config nenhum, nem o install nem o update criam um so para ter origem", () => {
  const repo = repoTemporario();
  try {
    instala(repo, "--arch", "hexagonal");
    assert.ok(!existsSync(path.join(repo, CONFIG)), "o install nunca escreveu config, e a fatia nao o faz comecar");
    assert.equal(cli(["update", repo], repo).code, 0);
    assert.ok(!existsSync(path.join(repo, CONFIG)),
      "default silencioso e o que a fatia proibe: sem origem gravada, o estado e desconhecido e declarado");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("negativo: com config existente e sem origem, o update nao acrescenta a chave nem mexe nas outras", () => {
  const repo = repoTemporario();
  try {
    instala(repo, "--arch", "hexagonal");
    mkdirSync(path.join(repo, ".mgr-core"), { recursive: true });
    writeFileSync(path.join(repo, CONFIG), JSON.stringify({ registries: [], detectionMode: "off" }, null, 2) + "\n");
    assert.equal(cli(["update", repo], repo).code, 0);
    const depois = config(repo);
    assert.equal(depois.origin, undefined);
    assert.equal(depois.detectionMode, "off", "o update nao toca no config, e e isso que faz a origem sobreviver");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a origem ausente nao muda o doctor: 10 verificacoes e o mesmo exit code", () => {
  const repo = repoTemporario();
  try {
    instala(repo, "--arch", "hexagonal");
    const r = cli(["doctor", repo], repo);
    assert.equal(r.code, 0);
    assert.match(r.out, /10 checks/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("negativo: a fatia nao introduziu token — a arvore instalada nao tem MGR_ por resolver", () => {
  const repo = repoTemporario();
  try {
    instala(repo, "--arch", "hexagonal");
    const sobraram = spawnSync("grep", ["-rl", "{{MGR_", path.join(repo, SKILLS)], { encoding: "utf8" });
    assert.equal(sobraram.error, undefined, "grep ausente devolve stdout vazio, e vazio contra vazio nao e prova");
    assert.ok([0, 1].includes(sobraram.status), `grep falhou: status ${sobraram.status}`);
    assert.equal(`${sobraram.stdout}`.trim(), "",
      "token novo seria resolvido no install, quando a origem ainda nao existe, e a copia ficaria errada sem o doctor poder ver");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("o code-analyzer INSTALADO manda ler a origem e nomeia os tres estados", () => {
  const repo = repoTemporario();
  try {
    instala(repo, "--arch", "hexagonal");
    const instalada = readFileSync(path.join(repo, SKILLS, "code-analyzer", "SKILL.md"), "utf8");
    assert.match(instalada, /Reading the project origin/);
    assert.match(instalada, /apply the calibration in \*\*L6\.6\*\*/,
      "as tres palavras soltas casavam na linha do campo de peso, entao apagar os passos deixava isto verde");
    assert.match(instalada, /Key absent, file absent, JSON unreadable/);
    assert.match(instalada, /Never infer the origin/);
    assert.match(instalada, /\*\*Weight:\*\*.*origin/,
      "a CA-13 inteira vive nesta linha, e nenhuma guarda a tocava");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a lei L6.6 declara as clausulas que a fatia inteira depende de ela declarar", () => {
  const leis = readFileSync(fileURLToPath(new URL("../shared/laws/execution-laws.md", import.meta.url)), "utf8");
  const inicio = leis.indexOf("### L6.6");
  assert.notEqual(inicio, -1, "`indexOf` devolve -1 e `slice(-1)` devolve o ULTIMO caractere, nunca vazio: sem esta asserção o instrumento nao poderia falhar");
  const fim = leis.indexOf("\n### ", inicio + 1);
  const corpo = fim === -1 ? leis.slice(inicio) : leis.slice(inicio, fim);
  for (const clausula of [
    "Do not calibrate",
    "L1.1 governs",
    "L1.3",
    "never the set of rules checked",
    "new code reproves in any origin",
    "there is no gate",
  ]) {
    assert.ok(corpo.includes(clausula), `L6.6 sem a clausula: ${clausula}`);
  }
});
