import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { tempDir } from "../scripts/lib/tmp.mjs";
import { getMessages } from "../src/messages.js";
import { DEFECT } from "../src/doctor.js";

const BIN = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
const PACOTE = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const msg = getMessages("en");

const CORE = ".mgr-core";
const RUNTIME = ".mgr-core/runtime";
const IGNORE = ".mgr-core/runtime/.gitignore";
const CONFIG = ".mgr-core/config.json";
const TEXTO_IGNORE = "# mgr-method: derived from runtimeVersioning in .mgr-core/config.json; install and update rewrite this file\n*\n";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const limpar = (texto) => texto
  .replace(ANSI, "")
  .split("\n")
  .map((linha) => linha.replace(/^[\s│]+|[\s│]+$/g, ""))
  .join(" ")
  .replace(/\s+/g, " ");

const tem = (saida, texto) => limpar(saida).includes(limpar(texto));

const ocorrencias = (saida, texto) => limpar(saida).split(limpar(texto)).length - 1;

const emOrdem = (saida, textos) => {
  const limpa = limpar(saida);
  let posicao = -1;
  for (const texto of textos) {
    const indice = limpa.indexOf(limpar(texto), posicao + 1);
    assert.ok(indice > posicao, `missing or out of order: ${texto}`);
    posicao = indice;
  }
};

const git = (repo, ...args) => {
  const resultado = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(resultado.status, 0, resultado.stderr);
  return resultado.stdout;
};

const commitar = (repo, mensagem) => git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", mensagem);

const iniciarGit = (repo) => {
  git(repo, "init", "-q");
  commitar(repo, "init");
};

const cli = (args, { cwd, home, env = {} }) => {
  const resultado = spawnSync(process.execPath, [BIN, ...args, "--user-language", "en"], {
    cwd,
    input: "",
    encoding: "utf8",
    env: { ...process.env, HOME: home, LC_ALL: "C", ...env },
  });
  return { code: resultado.status, stdout: resultado.stdout, stderr: resultado.stderr, out: `${resultado.stdout}${resultado.stderr}` };
};

const projeto = ({ git: comGit = false } = {}) => {
  const repo = tempDir("mgr-rv-repo-");
  const cwd = tempDir("mgr-rv-cwd-");
  const home = tempDir("mgr-rv-home-");
  if (comGit) iniciarGit(repo);
  return {
    repo,
    cwd,
    home,
    path: (...partes) => path.join(repo, ...partes),
    roda: (args, { dentro = false, env = {} } = {}) => cli(args, { cwd: dentro ? repo : cwd, home, env }),
  };
};

const instala = (projetoAlvo, ...extra) => projetoAlvo.roda(["install", "-y", "--engine", "claude-code", ...extra, projetoAlvo.repo]);
const atualiza = (projetoAlvo, ...extra) => projetoAlvo.roda(["update", ...extra, projetoAlvo.repo]);
const define = (projetoAlvo, valor, opcoes) => projetoAlvo.roda(["runtime-versioning", "set", valor], { dentro: true, ...opcoes });
const le = (projetoAlvo, ...args) => projetoAlvo.roda(["runtime-versioning", ...args], { dentro: true });
const desinstala = (projetoAlvo) => projetoAlvo.roda(["uninstall", "-y", projetoAlvo.repo]);
const diagnostica = (projetoAlvo) => JSON.parse(projetoAlvo.roda(["doctor", projetoAlvo.repo, "--json"]).stdout).findings;

const lerJson = (arquivo) => JSON.parse(readFileSync(arquivo, "utf8"));
const lerConfig = (projetoAlvo) => (existsSync(projetoAlvo.path(CONFIG)) ? lerJson(projetoAlvo.path(CONFIG)) : {});

const gravaJson = (arquivo, conteudo) => {
  mkdirSync(path.dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, `${JSON.stringify(conteudo, null, 2)}\n`, "utf8");
};

const gravaConfig = (projetoAlvo, conteudo) => gravaJson(projetoAlvo.path(CONFIG), conteudo);

const bytes = (arquivo) => (existsSync(arquivo) ? readFileSync(arquivo, "base64") : null);

const arquivosDe = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entrada) =>
  (entrada.isDirectory() ? arquivosDe(path.join(dir, entrada.name)) : [path.join(dir, entrada.name)]));

const instantaneo = (dir) => Object.fromEntries(arquivosDe(dir).sort().map((arquivo) => [path.relative(dir, arquivo), readFileSync(arquivo, "base64")]));

const statusDoGit = (repo) => git(repo, "status", "--porcelain", "--untracked-files=all").split("\n").filter(Boolean);

const sobOrRuntime = (linhas) => linhas.filter((linha) => linha.includes(RUNTIME));

const hashDoIndice = (repo) => createHash("sha256").update(readFileSync(path.join(repo, ".git", "index"))).digest("hex");

const reduzAoAnterior = (projetoAlvo) => {
  if (existsSync(projetoAlvo.path(CONFIG))) {
    const config = lerConfig(projetoAlvo);
    delete config.runtimeVersioning;
    gravaConfig(projetoAlvo, config);
  }
  rmSync(projetoAlvo.path(IGNORE), { force: true });
};

const semErroDeGit = (resultado) => {
  assert.equal(resultado.code, 0, resultado.out);
  assert.ok(tem(resultado.out, msg.gitIndexUnavailable), resultado.out);
  assert.ok(!tem(resultado.out, msg.runtimeTracked(RUNTIME)));
  assert.doesNotMatch(resultado.out, /ENOENT|spawnSync git|fatal: not a git repository/);
};

const doRuntimeVersioning = (achados) => achados.filter((achado) => achado.check === "runtime-versioning");

const recorte = (achado) => ({ severity: achado.severity, file: achado.file, expected: achado.expected, found: achado.found });

test("should keep the runtime out of git status and print the default lines on a clean install", () => {
  const projetoAlvo = projeto({ git: true });
  const resultado = instala(projetoAlvo);
  assert.equal(resultado.code, 0, resultado.out);
  assert.equal(readFileSync(projetoAlvo.path(IGNORE), "utf8"), TEXTO_IGNORE);
  assert.deepEqual(sobOrRuntime(statusDoGit(projetoAlvo.repo)), []);
  assert.ok(tem(resultado.out, msg.planRuntimeUnversioned(msg.runtimeSourceDefault)), resultado.out);
  assert.ok(tem(resultado.out, msg.runtimeDefaultApplied), resultado.out);
  assert.ok(!("runtimeVersioning" in lerConfig(projetoAlvo)));
});

test("should leave the runtime files untracked and write no ignore file when versioned is recorded", () => {
  const projetoAlvo = projeto({ git: true });
  gravaConfig(projetoAlvo, { runtimeVersioning: "versioned" });
  const resultado = instala(projetoAlvo);
  assert.equal(resultado.code, 0, resultado.out);
  assert.ok(!existsSync(projetoAlvo.path(IGNORE)));
  assert.ok(statusDoGit(projetoAlvo.repo).includes("?? .mgr-core/runtime/package.json"));
});

for (const [valor, plano] of [["versioned", msg.planRuntimeVersioned], ["unversioned", msg.planRuntimeUnversioned]]) {
  test(`should announce the recorded ${valor} choice on install and keep config.json byte for byte`, () => {
    const projetoAlvo = projeto();
    gravaConfig(projetoAlvo, { runtimeVersioning: valor });
    const antes = bytes(projetoAlvo.path(CONFIG));
    const resultado = instala(projetoAlvo);
    assert.equal(resultado.code, 0, resultado.out);
    assert.ok(tem(resultado.out, plano(msg.runtimeSourceRecorded)), resultado.out);
    assert.equal(bytes(projetoAlvo.path(CONFIG)), antes);
  });
}

test("should neither ask nor write the ignore file on a global install", () => {
  const projetoAlvo = projeto();
  const resultado = projetoAlvo.roda(["install", "--scope", "global", "-y", "--engine", "claude-code", projetoAlvo.repo]);
  assert.equal(resultado.code, 0, resultado.out);
  assert.ok(existsSync(path.join(projetoAlvo.home, RUNTIME)));
  assert.ok(!existsSync(path.join(projetoAlvo.home, IGNORE)));
  assert.ok(!tem(resultado.out, msg.planRuntimeUnversioned(msg.runtimeSourceDefault)));
  assert.ok(!tem(resultado.out, msg.planRuntimeVersioned(msg.runtimeSourceDefault)));
  assert.ok(!tem(resultado.out, msg.runtimeDefaultApplied));
});

for (const flags of [[], ["-y"]]) {
  test(`should announce, write and apply the default on update ${flags.join(" ") || "without a terminal"} for a project from before the feature`, () => {
    const projetoAlvo = projeto();
    instala(projetoAlvo);
    reduzAoAnterior(projetoAlvo);
    const antes = bytes(projetoAlvo.path(CONFIG));
    const resultado = atualiza(projetoAlvo, ...flags);
    assert.equal(resultado.code, 0, resultado.out);
    emOrdem(resultado.stdout, [msg.runtimeVersioningNew(PACOTE), msg.runtimeIgnoreToWrite(IGNORE), msg.runtimeIgnoreWritten(IGNORE)]);
    assert.ok(tem(resultado.out, msg.runtimeDefaultApplied), resultado.out);
    assert.equal(readFileSync(projetoAlvo.path(IGNORE), "utf8"), TEXTO_IGNORE);
    assert.equal(bytes(projetoAlvo.path(CONFIG)), antes);
  });
}

for (const valor of ["unversioned", "versioned"]) {
  test(`should print no news, plan or ignore line on update when ${valor} is recorded and the disk conforms`, () => {
    const projetoAlvo = projeto();
    instala(projetoAlvo);
    define(projetoAlvo, valor);
    const antes = bytes(projetoAlvo.path(CONFIG));
    const resultado = atualiza(projetoAlvo);
    assert.equal(resultado.code, 0, resultado.out);
    const ausentes = [
      msg.runtimeVersioningNew(PACOTE),
      msg.planRuntimeUnversioned(msg.runtimeSourceRecorded),
      msg.planRuntimeVersioned(msg.runtimeSourceRecorded),
      msg.runtimeIgnoreToWrite(IGNORE),
      msg.runtimeIgnoreToRewrite(IGNORE),
      msg.runtimeIgnoreToRemove(IGNORE),
      msg.runtimeIgnoreWritten(IGNORE),
      msg.runtimeIgnoreRemoved(IGNORE),
    ];
    for (const texto of ausentes) assert.ok(!tem(resultado.out, texto), texto);
    assert.equal(bytes(projetoAlvo.path(CONFIG)), antes);
  });
}

test("should print the writing, change, ignore-file and git lines in order on set unversioned", () => {
  const projetoAlvo = projeto({ git: true });
  gravaConfig(projetoAlvo, { origin: "greenfield", runtimeVersioning: "versioned" });
  instala(projetoAlvo);
  const antes = lerConfig(projetoAlvo);
  assert.ok(!existsSync(projetoAlvo.path(IGNORE)));
  const resultado = define(projetoAlvo, "unversioned");
  assert.equal(resultado.code, 0, resultado.out);
  emOrdem(resultado.stdout, [
    msg.rvWriting(projetoAlvo.path(CORE)),
    msg.rvWritten("versioned", "unversioned"),
    msg.runtimeIgnoreToWrite(IGNORE),
    msg.runtimeIgnoreWritten(IGNORE),
    msg.gitIndexChecking(RUNTIME),
    msg.gitIndexNone(RUNTIME),
  ]);
  assert.equal(readFileSync(projetoAlvo.path(IGNORE), "utf8"), TEXTO_IGNORE);
  assert.deepEqual(lerConfig(projetoAlvo), { ...antes, runtimeVersioning: "unversioned" });
});

test("should remove the ignore file on set versioned and make git list the runtime files", () => {
  const projetoAlvo = projeto({ git: true });
  instala(projetoAlvo);
  define(projetoAlvo, "unversioned");
  assert.deepEqual(sobOrRuntime(statusDoGit(projetoAlvo.repo)), []);
  const resultado = define(projetoAlvo, "versioned");
  assert.equal(resultado.code, 0, resultado.out);
  emOrdem(resultado.stdout, [msg.runtimeIgnoreToRemove(IGNORE), msg.runtimeIgnoreRemoved(IGNORE)]);
  assert.ok(!existsSync(projetoAlvo.path(IGNORE)));
  assert.ok(statusDoGit(projetoAlvo.repo).includes("?? .mgr-core/runtime/package.json"));
});

const comandosSobreRuntimeRastreado = {
  update: (projetoAlvo) => atualiza(projetoAlvo),
  install: (projetoAlvo) => instala(projetoAlvo),
  set: (projetoAlvo) => define(projetoAlvo, "unversioned"),
};

const instalaRastreado = () => {
  const projetoAlvo = projeto({ git: true });
  instala(projetoAlvo);
  git(projetoAlvo.repo, "add", "-f", RUNTIME);
  return projetoAlvo;
};

for (const [nome, executa] of Object.entries(comandosSobreRuntimeRastreado)) {
  test(`should warn about the tracked runtime on ${nome} and leave the git index and history untouched`, () => {
    const projetoAlvo = instalaRastreado();
    const arquivos = git(projetoAlvo.repo, "ls-files", "--", RUNTIME).split("\n").filter(Boolean).length;
    assert.ok(arquivos > 0);
    const indiceAntes = hashDoIndice(projetoAlvo.repo);
    const historicoAntes = git(projetoAlvo.repo, "rev-list", "--all");
    const resultado = executa(projetoAlvo);
    assert.equal(resultado.code, 0, resultado.out);
    assert.ok(tem(resultado.out, msg.gitIndexListed(RUNTIME, arquivos)), resultado.out);
    assert.ok(tem(resultado.out, msg.runtimeTracked(RUNTIME)), resultado.out);
    assert.equal(hashDoIndice(projetoAlvo.repo), indiceAntes);
    assert.equal(git(projetoAlvo.repo, "rev-list", "--all"), historicoAntes);
  });
}

test("should leave the folder on disk and the index empty when the printed git rm command is run", () => {
  const projetoAlvo = instalaRastreado();
  const resultado = atualiza(projetoAlvo);
  const impresso = /git rm -r --cached \S+/.exec(limpar(resultado.out));
  assert.ok(impresso, resultado.out);
  git(projetoAlvo.repo, ...impresso[0].split(" ").slice(1));
  assert.ok(existsSync(projetoAlvo.path(RUNTIME)));
  assert.equal(git(projetoAlvo.repo, "ls-files", "--", RUNTIME), "");
});

const ambientesSemGit = {
  "outside a git repository": () => {
    const projetoAlvo = projeto();
    return { projetoAlvo, env: { GIT_CEILING_DIRECTORIES: path.dirname(projetoAlvo.repo) } };
  },
  "with git missing from PATH": () => {
    const projetoAlvo = projeto({ git: true });
    const bin = tempDir("mgr-rv-path-");
    symlinkSync(process.execPath, path.join(bin, "node"));
    return { projetoAlvo, env: { PATH: bin } };
  },
};

for (const [nome, monta] of Object.entries(ambientesSemGit)) {
  test(`should install, update and set unversioned ${nome} printing the skipped check and no git error`, () => {
    const { projetoAlvo, env } = monta();
    semErroDeGit(projetoAlvo.roda(["install", "-y", "--engine", "claude-code", projetoAlvo.repo], { env }));
    assert.ok(existsSync(projetoAlvo.path(IGNORE)));
    rmSync(projetoAlvo.path(IGNORE));
    semErroDeGit(projetoAlvo.roda(["update", projetoAlvo.repo], { env }));
    assert.ok(existsSync(projetoAlvo.path(IGNORE)));
    rmSync(projetoAlvo.path(IGNORE));
    semErroDeGit(define(projetoAlvo, "unversioned", { env }));
    assert.ok(existsSync(projetoAlvo.path(IGNORE)));
  });
}

test("should record versioned, check the index zero times and warn once when the root gitignore ignores .mgr-core", () => {
  const projetoAlvo = projeto({ git: true });
  writeFileSync(projetoAlvo.path(".gitignore"), ".mgr-core/\n", "utf8");
  instala(projetoAlvo);
  const resultado = define(projetoAlvo, "versioned");
  assert.equal(resultado.code, 0, resultado.out);
  assert.equal(lerConfig(projetoAlvo).runtimeVersioning, "versioned");
  assert.equal(ocorrencias(resultado.out, msg.gitIndexChecking(RUNTIME)), 0);
  assert.equal(ocorrencias(resultado.out, msg.gitignoreTeamIgnored(".mgr-core/")), 1);
});

test("should announce the rewrite before the write and restore a hand edited ignore file on update", () => {
  const projetoAlvo = projeto();
  instala(projetoAlvo);
  define(projetoAlvo, "unversioned");
  writeFileSync(projetoAlvo.path(IGNORE), "# edited by hand\n", "utf8");
  const resultado = atualiza(projetoAlvo);
  assert.equal(resultado.code, 0, resultado.out);
  emOrdem(resultado.stdout, [msg.runtimeIgnoreToRewrite(IGNORE), msg.runtimeIgnoreWritten(IGNORE)]);
  assert.equal(readFileSync(projetoAlvo.path(IGNORE), "utf8"), TEXTO_IGNORE);
});

const estadosDaLeitura = [
  {
    nome: "absent",
    prepara: () => {},
    texto: msg.rvNotRecorded,
    json: { schemaVersion: 1, state: "absent", default: "unversioned" },
    code: 0,
  },
  {
    nome: "recorded versioned",
    prepara: (projetoAlvo) => gravaConfig(projetoAlvo, { origin: "greenfield", runtimeVersioning: "versioned" }),
    texto: msg.rvRecorded("versioned"),
    json: { schemaVersion: 1, state: "recorded", value: "versioned" },
    code: 0,
  },
  {
    nome: "recorded unversioned",
    prepara: (projetoAlvo) => gravaConfig(projetoAlvo, { runtimeVersioning: "unversioned" }),
    texto: msg.rvRecorded("unversioned"),
    json: { schemaVersion: 1, state: "recorded", value: "unversioned" },
    code: 0,
  },
  {
    nome: "invalid",
    prepara: (projetoAlvo) => gravaConfig(projetoAlvo, { runtimeVersioning: "Versioned" }),
    texto: msg.rvInvalid("Versioned"),
    json: { schemaVersion: 1, state: "invalid", value: "Versioned" },
    code: 1,
  },
];

for (const { nome, prepara, texto, json, code } of estadosDaLeitura) {
  test(`should read the ${nome} state as text and as json with exit ${code} and write nothing`, () => {
    const projetoAlvo = projeto();
    prepara(projetoAlvo);
    const antes = bytes(projetoAlvo.path(CONFIG));
    const lido = le(projetoAlvo);
    const lidoJson = le(projetoAlvo, "--json");
    assert.equal(lido.code, code, lido.out);
    assert.ok(tem(lido.stdout, texto), lido.out);
    assert.equal(lidoJson.code, code, lidoJson.out);
    assert.deepEqual(JSON.parse(lidoJson.stdout), json);
    assert.equal(bytes(projetoAlvo.path(CONFIG)), antes);
    if (antes === null) assert.ok(!existsSync(projetoAlvo.path(CORE)));
  });
}

for (const [nome, executa] of [["install", (projetoAlvo) => instala(projetoAlvo)], ["update", (projetoAlvo) => atualiza(projetoAlvo)]]) {
  test(`should refuse ${nome} with an invalid recorded value and leave .mgr-core byte for byte`, () => {
    const projetoAlvo = projeto();
    instala(projetoAlvo);
    gravaConfig(projetoAlvo, { ...lerConfig(projetoAlvo), runtimeVersioning: "Versioned" });
    const antes = instantaneo(projetoAlvo.path(CORE));
    const resultado = executa(projetoAlvo);
    assert.equal(resultado.code, 1, resultado.out);
    assert.ok(tem(resultado.out, msg.rvInvalidRefused(CONFIG, "Versioned")), resultado.out);
    assert.deepEqual(instantaneo(projetoAlvo.path(CORE)), antes);
  });
}

for (const escolha of ["unversioned", "versioned"]) {
  test(`should report no runtime-versioning finding on a clean ${escolha} install`, () => {
    const projetoAlvo = projeto();
    instala(projetoAlvo);
    define(projetoAlvo, escolha);
    assert.deepEqual(doRuntimeVersioning(diagnostica(projetoAlvo)), []);
  });
}

test("should report one defect when the choice is unversioned by default and the ignore file is missing", () => {
  const projetoAlvo = projeto();
  instala(projetoAlvo);
  rmSync(projetoAlvo.path(IGNORE));
  const achados = doRuntimeVersioning(diagnostica(projetoAlvo));
  assert.deepEqual(achados.map(recorte), [{
    severity: DEFECT,
    file: IGNORE,
    expected: "o arquivo de ignorar como o metodo o grava (runtimeVersioning: unversioned)",
    found: "ausente",
  }]);
});

test("should report one defect when the choice is unversioned and the ignore file differs", () => {
  const projetoAlvo = projeto();
  instala(projetoAlvo);
  define(projetoAlvo, "unversioned");
  writeFileSync(projetoAlvo.path(IGNORE), "# edited by hand\n", "utf8");
  const achados = doRuntimeVersioning(diagnostica(projetoAlvo));
  assert.deepEqual(achados.map(recorte), [{
    severity: DEFECT,
    file: IGNORE,
    expected: "o arquivo de ignorar como o metodo o grava (runtimeVersioning: unversioned)",
    found: "difere do que o metodo grava",
  }]);
});

test("should report one defect when the choice is versioned and the ignore file is present", () => {
  const projetoAlvo = projeto();
  instala(projetoAlvo);
  define(projetoAlvo, "versioned");
  writeFileSync(projetoAlvo.path(IGNORE), TEXTO_IGNORE, "utf8");
  const achados = doRuntimeVersioning(diagnostica(projetoAlvo));
  assert.deepEqual(achados.map(recorte), [{
    severity: DEFECT,
    file: IGNORE,
    expected: "sem arquivo de ignorar (runtimeVersioning: versioned)",
    found: "presente",
  }]);
});

test("should report one defect when the recorded value is invalid", () => {
  const projetoAlvo = projeto();
  instala(projetoAlvo);
  gravaConfig(projetoAlvo, { ...lerConfig(projetoAlvo), runtimeVersioning: "Versioned" });
  const achados = doRuntimeVersioning(diagnostica(projetoAlvo));
  assert.deepEqual(achados.map(recorte), [{
    severity: DEFECT,
    file: CONFIG,
    expected: "runtimeVersioning: versioned | unversioned, ou ausente",
    found: "valor \"Versioned\"",
  }]);
});

test("should leave only runtime-version when the runtime folder is gone", () => {
  const projetoAlvo = projeto();
  instala(projetoAlvo);
  rmSync(projetoAlvo.path(RUNTIME), { recursive: true, force: true });
  const achados = diagnostica(projetoAlvo).filter((achado) => achado.check === "runtime-version" || achado.check === "runtime-versioning");
  assert.deepEqual(achados.map((achado) => achado.check), ["runtime-version"]);
});

test("should report no runtime-versioning finding when the manifest is older than the package", () => {
  const projetoAlvo = projeto();
  instala(projetoAlvo);
  rmSync(projetoAlvo.path(IGNORE));
  const manifesto = projetoAlvo.path(CORE, "manifest.json");
  gravaJson(manifesto, { ...lerJson(manifesto), version: "0.0.1" });
  assert.deepEqual(doRuntimeVersioning(diagnostica(projetoAlvo)), []);
});

test("should keep the root gitignore identical across installs and across every later command", () => {
  const projetoA = projeto({ git: true });
  instala(projetoA);
  const raiz = bytes(projetoA.path(".gitignore"));
  const projetoB = projeto({ git: true });
  gravaConfig(projetoB, { runtimeVersioning: "versioned" });
  instala(projetoB);
  assert.equal(bytes(projetoB.path(".gitignore")), raiz);
  atualiza(projetoA);
  define(projetoA, "versioned");
  define(projetoA, "unversioned");
  diagnostica(projetoA);
  assert.equal(bytes(projetoA.path(".gitignore")), raiz);
});

test("should refuse runtime-versioning in the project runtime as a lifecycle command", () => {
  const projetoAlvo = projeto();
  instala(projetoAlvo);
  const versao = lerJson(projetoAlvo.path(CORE, "manifest.json")).version;
  const resultado = spawnSync(process.execPath, [projetoAlvo.path(RUNTIME, "bin", "mgr-runtime.js"), "runtime-versioning", "--user-language", "en"], {
    cwd: projetoAlvo.repo,
    input: "",
    encoding: "utf8",
    env: { ...process.env, HOME: projetoAlvo.home, LC_ALL: "C" },
  });
  assert.equal(resultado.status, 1, resultado.stderr);
  const recusa = getMessages("en", { lifecycle: `npx mgr-method@${versao}` }).runtimeLifecycleRefused("runtime-versioning");
  assert.ok(tem(resultado.stderr, recusa), resultado.stderr);
});

test("should not list runtime-versioning in the runtime help", () => {
  const projetoAlvo = projeto();
  instala(projetoAlvo);
  const resultado = spawnSync(process.execPath, [projetoAlvo.path(RUNTIME, "bin", "mgr-runtime.js"), "help", "--user-language", "en"], {
    cwd: projetoAlvo.repo,
    input: "",
    encoding: "utf8",
    env: { ...process.env, HOME: projetoAlvo.home, LC_ALL: "C" },
  });
  assert.equal(resultado.status, 0, resultado.stderr);
  assert.ok(!resultado.stdout.includes("runtime-versioning"));
});

test("should remove the whole .mgr-core including the runtime ignore file on uninstall", () => {
  const projetoAlvo = projeto();
  instala(projetoAlvo);
  assert.ok(existsSync(projetoAlvo.path(IGNORE)));
  const resultado = desinstala(projetoAlvo);
  assert.equal(resultado.code, 0, resultado.out);
  assert.ok(!existsSync(projetoAlvo.path(CORE)));
});

test("should ignore runtimeVersioning in config.local.json, warn on stderr and keep the effective choice", () => {
  const projetoAlvo = projeto();
  instala(projetoAlvo);
  gravaJson(projetoAlvo.path(CORE, "config.local.json"), { runtimeVersioning: "versioned" });
  const resultado = atualiza(projetoAlvo);
  assert.equal(resultado.code, 0, resultado.out);
  assert.ok(tem(resultado.stderr, msg.personalKeysIgnored(".mgr-core/config.local.json", "runtimeVersioning")), resultado.stderr);
  assert.ok(existsSync(projetoAlvo.path(IGNORE)));
  assert.deepEqual(JSON.parse(le(projetoAlvo, "--json").stdout), { schemaVersion: 1, state: "absent", default: "unversioned" });
});

test("should restore a clone without runtime on update, without asking and without changing the choice", () => {
  const origem = projeto({ git: true });
  instala(origem);
  define(origem, "unversioned");
  git(origem.repo, "add", "-A");
  commitar(origem.repo, "project");
  const commitado = git(origem.repo, "show", `HEAD:${CONFIG}`);
  const clone = projeto();
  git(clone.cwd, "clone", "-q", origem.repo, clone.repo);
  assert.ok(!existsSync(clone.path(RUNTIME)));
  const resultado = atualiza(clone);
  assert.equal(resultado.code, 0, resultado.out);
  assert.equal(readFileSync(clone.path(IGNORE), "utf8"), TEXTO_IGNORE);
  assert.ok(!tem(resultado.out, msg.runtimeVersioningNew(PACOTE)));
  assert.equal(readFileSync(clone.path(CONFIG), "utf8"), commitado);
});

for (const [nome, executa] of [["install", (projetoAlvo) => instala(projetoAlvo)], ["update", (projetoAlvo) => atualiza(projetoAlvo)]]) {
  test(`should show a non-string invalid value as JSON when ${nome} refuses it`, () => {
    const projetoAlvo = projeto();
    instala(projetoAlvo);
    gravaConfig(projetoAlvo, { ...lerConfig(projetoAlvo), runtimeVersioning: ["versioned"] });
    const resultado = executa(projetoAlvo);
    assert.equal(resultado.code, 1, resultado.out);
    assert.ok(tem(resultado.out, msg.rvInvalidRefused(CONFIG, '["versioned"]')), resultado.out);
  });
}

test("should ignore an invalid value recorded in the global config on a global install and update", () => {
  const projetoAlvo = projeto();
  gravaJson(path.join(projetoAlvo.home, CORE, "config.json"), { runtimeVersioning: "Versioned" });
  const instalado = projetoAlvo.roda(["install", "--scope", "global", "-y", "--engine", "claude-code", projetoAlvo.repo]);
  assert.equal(instalado.code, 0, instalado.out);
  const atualizado = projetoAlvo.roda(["update", "--scope", "global", projetoAlvo.repo]);
  assert.equal(atualizado.code, 0, atualizado.out);
  for (const resultado of [instalado, atualizado]) {
    assert.doesNotMatch(resultado.out, /runtimeVersioning Versioned/);
  }
});

test("should refuse set versioned without writing when the root gitignore has an open block", () => {
  const projetoAlvo = projeto();
  instala(projetoAlvo);
  gravaConfig(projetoAlvo, { ...lerConfig(projetoAlvo), runtimeVersioning: "unversioned" });
  writeFileSync(projetoAlvo.path(".gitignore"), "# >>> mgr-method (managed block: mgr uninstall removes it) >>>\n.mgr-core/.env\n", "utf8");
  assert.equal(le(projetoAlvo, "--json").code, 0);
  const antesConfig = bytes(projetoAlvo.path(CONFIG));
  const antesIgnore = bytes(projetoAlvo.path(IGNORE));
  const recusado = define(projetoAlvo, "versioned");
  assert.equal(recusado.code, 1, recusado.out);
  assert.ok(!tem(recusado.out, msg.rvWriting(projetoAlvo.path(CORE))), recusado.out);
  assert.equal(bytes(projetoAlvo.path(CONFIG)), antesConfig);
  assert.equal(bytes(projetoAlvo.path(IGNORE)), antesIgnore);
  assert.equal(define(projetoAlvo, "unversioned").code, 0);
});
