import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "../../scripts/lib/tmp.mjs";
import { CHECKS } from "../../src/doctor/doctor.js";
import { getMessages } from "../../src/core/messages.js";
import {
  caminhoDoRuntime,
  descartar,
  instalacaoComDefeitos,
  instalacaoLimpa,
} from "../fixtures/instalacao.js";
import { CASOS_DE_CLI, CASOS_FORA_DO_LACO, controleValido } from "../fixtures/manifesto-malformado.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BIN = path.join(ROOT, "bin", "mgr.js");
const IDIOMAS = ["en", "pt-BR"];
const OUTRO = { en: "pt-BR", "pt-BR": "en" };
const LOCALE_CONTRARIO = { en: "pt_BR.UTF-8", "pt-BR": "C" };
const SENTINELA = "\u0001";
const TITULO = /MGR(?:-METHOD)? — Método Governado por Rastreabilidade/g;
const HOME = tempDir("mgr-home-");

const MARCADORES_PT = [
  "A inferência é a fonte de verdade",
  "Ausência de achado NÃO é atestado",
  "SKILL.md não pôde ser lido",
  "nenhuma das quatro classes",
  "esperado:",
  "encontrado:",
  "resolva com:",
  "sem correcao automatica",
  "declarado:",
  "inferido:",
  " · linha ",
];
const MARCADORES_EN = ['invalid "skills" in manifest.json'];
const PADRAO_DOCTOR = /^(doctor|finding|manifestProblem)/;
const PADRAO_AUDIT = /^audit/;
const PADRAO_UPDATE = /^(errorPrefix|manifestInvalidSkills)/;
const PADRAO_RUNTIME = /^runtimeVersion/;
const PADRAO_DIST = /^distVersionMismatch/;

const ambiente = (extra = {}) => {
  const env = { ...process.env, HOME, LC_ALL: "C", NO_COLOR: "1", ...extra };
  delete env.FORCE_COLOR;
  delete env.LC_MESSAGES;
  return env;
};

const rodar = (args, { cwd = HOME, env = {} } = {}) => {
  const resultado = spawnSync(process.execPath, args, { cwd, encoding: "utf8", env: ambiente(env) });
  return { status: resultado.status, out: `${resultado.stdout}`, err: `${resultado.stderr}` };
};

const cli = (args, opcoes) => rodar([BIN, ...args], opcoes);
const runtimeDe = (repo) => caminhoDoRuntime(repo, "bin", "mgr-runtime.js");
const pelRuntime = (repo, args, env) => rodar([runtimeDe(repo), ...args], { cwd: repo, env });

const manifestoDe = (repo) => path.join(repo, ".mgr-core", "manifest.json");
const lerManifesto = (repo) => JSON.parse(readFileSync(manifestoDe(repo), "utf8"));
const gravarManifesto = (repo, conteudo) => writeFileSync(
  manifestoDe(repo), typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo, null, 2));

const renderizar = (valor) => {
  if (typeof valor === "string") return valor;
  if (typeof valor !== "function") return null;
  for (const arg of [SENTINELA, [SENTINELA]]) {
    try {
      const texto = valor(arg, arg, arg, arg);
      if (typeof texto === "string") return texto;
    } catch {
      continue;
    }
  }
  return null;
};

const corposCache = new Map();
const corpoDe = (lang) => {
  if (!corposCache.has(lang)) {
    corposCache.set(lang, Object.values(getMessages(lang)).map(renderizar).filter((t) => t !== null).join("\n"));
  }
  return corposCache.get(lang);
};

const fragmentosDe = (lang, padrao) => Object.entries(getMessages(lang))
  .filter(([chave]) => padrao.test(chave))
  .flatMap(([, valor]) => (renderizar(valor) ?? "").split(SENTINELA))
  .filter((trecho) => /\p{L}/u.test(trecho));

const trechosDoOutroIdioma = (lang, padrao) => {
  const proprio = corpoDe(lang);
  return [...new Set(fragmentosDe(OUTRO[lang], padrao))].filter((trecho) => !proprio.includes(trecho));
};

const fixo = (lang, chave) => (renderizar(getMessages(lang)[chave]) ?? "").split(SENTINELA)[0];

const IDS_DE_CHECK = CHECKS.map(({ id }) => id).sort((a, b) => b.length - a.length);

const mascarar = (texto, caminhos = []) => {
  let limpo = texto.replace(TITULO, "<titulo>");
  for (const id of IDS_DE_CHECK) limpo = limpo.split(id).join("<check>");
  for (const caminho of caminhos) {
    for (const forma of new Set([caminho, existsSync(caminho) ? realpathSync(caminho) : caminho])) {
      limpo = limpo.split(forma).join("<repo>");
    }
  }
  return limpo;
};

const exigirIdiomaUnico = (lang, saidas, padrao, caminhos, cenario) => {
  const texto = mascarar(saidas.join("\n"), caminhos);
  const marcadores = lang === "en" ? MARCADORES_PT : MARCADORES_EN;
  for (const marcador of marcadores) {
    assert.ok(!texto.includes(marcador),
      `${cenario} em ${lang}: o marcador "${marcador}" so existe na tabela ${OUTRO[lang]}, e texto de outro idioma na saida mistura a interface`);
  }
  for (const trecho of trechosDoOutroIdioma(lang, padrao)) {
    assert.ok(!texto.includes(trecho),
      `${cenario} em ${lang}: o trecho fixo ${JSON.stringify(trecho)} e da tabela ${OUTRO[lang]} e nao ocorre em nenhuma frase ${lang}`);
  }
};

const comRepo = (criar, corpo) => {
  const repo = criar();
  try {
    corpo(repo);
  } finally {
    descartar(repo);
  }
};

const CLASSES = (base) => [
  ["A", { ...base, skills: { a: 1 } }, "doctorManifestoInvalido"],
  ["B", "{ nao e json", "doctorManifestoIlegivel"],
  ["C", '"x"', "doctorManifestoInvalido"],
];

for (const idioma of IDIOMAS) {
  test(`should print the doctor defect output only in ${idioma} when the manifest declares it`, () => {
    comRepo(() => instalacaoComDefeitos({ userLanguage: idioma }), (repo) => {
      const resultado = cli(["doctor", repo], { env: { LC_ALL: LOCALE_CONTRARIO[idioma] } });
      assert.equal(resultado.status, 1, `a fixture planta orfa e instalacao velha, e defeito sai 1: ${resultado.err}`);
      for (const chave of ["doctorEsperado", "doctorEncontrado", "doctorResolvaCom"]) {
        assert.ok(resultado.out.includes(fixo(idioma, chave)),
          `${chave} em ${idioma} tem de aparecer: sem o rotulo no idioma configurado o achado nao diz o que esperava`);
      }
      assert.ok(resultado.out.includes(getMessages(idioma).doctorSemCorrecao),
        "a orfa nao tem remediacao e a saida tem de dizer isso no idioma configurado");
      exigirIdiomaUnico(idioma, [resultado.out, resultado.err], PADRAO_DOCTOR, [repo], "doctor com defeito");
    });
  });

  test(`should print the invalid manifest block entirely in ${idioma} for classes A, B and C`, () => {
    comRepo(() => instalacaoLimpa({ userLanguage: idioma }), (repo) => {
      const base = lerManifesto(repo);
      for (const [classe, conteudo, cabecalho] of CLASSES(base)) {
        gravarManifesto(repo, conteudo);
        const resultado = cli(["doctor", "--user-language", idioma, repo], { env: { LC_ALL: LOCALE_CONTRARIO[idioma] } });
        const linhas = mascarar(resultado.out, [repo]).split("\n").filter(Boolean);
        assert.equal(resultado.status, 2, `classe ${classe}: manifesto invalido nao tem o que diagnosticar e sai 2: ${resultado.err}`);
        assert.ok(resultado.out.includes(fixo(idioma, cabecalho)),
          `classe ${classe} em ${idioma}: o cabecalho ${cabecalho} tem de vir da tabela do idioma configurado`);
        assert.equal(linhas.at(-1), getMessages(idioma).doctorSemRemediacaoAutomatica,
          `classe ${classe} em ${idioma}: o bloco fecha com a linha de que nenhum comando corrige`);
        const esperadoDeLinhas = cabecalho === "doctorManifestoIlegivel" ? 2 : 3;
        assert.ok(cabecalho === "doctorManifestoIlegivel" ? linhas.length === 2 : linhas.length >= 3,
          `classe ${classe}: ilegivel tem so cabecalho e a ultima linha (problems vazio); as outras, ao menos uma linha de problema; esperado ${esperadoDeLinhas}, saiu ${linhas.length}`);
        assert.ok(!resultado.out.includes(fixo(idioma, "doctorNaoAtesta")),
          `classe ${classe}: o bloco nao tem as duas linhas de resumo (DT-9)`);
        exigirIdiomaUnico(idioma, [resultado.out, resultado.err], PADRAO_DOCTOR, [repo], `doctor classe ${classe}`);
        const json = cli(["doctor", "--json", "--user-language", idioma, repo]);
        assert.equal(json.status, 2, `classe ${classe} em --json tambem sai 2`);
        assert.equal(JSON.parse(json.out).outcome, "invalid-manifest",
          `classe ${classe}: o --json e dado e tem de ser JSON valido mesmo com manifesto invalido`);
      }
    });
  });

  test(`should print the no-installation doctor sentence only in ${idioma}`, () => {
    const vazio = tempDir("mgr-vazio-");
    const resultado = cli(["doctor", "--user-language", idioma, vazio], { env: { LC_ALL: LOCALE_CONTRARIO[idioma] } });
    assert.equal(resultado.status, 0, `sem instalacao nao e defeito: ${resultado.err}`);
    assert.equal(resultado.out.trim(), getMessages(idioma).doctorSemInstalacao,
      `a frase sem instalacao em ${idioma} vem da tabela do idioma da flag, nao do locale`);
    exigirIdiomaUnico(idioma, [resultado.out, resultado.err], PADRAO_DOCTOR, [vazio], "doctor sem instalacao");
  });

  test(`should print the audit output only in ${idioma}`, () => {
    const resultado = cli(["audit", "--user-language", idioma], { env: { LC_ALL: LOCALE_CONTRARIO[idioma] } });
    assert.equal(resultado.status, 0, `o audit sem EXCEEDS sai 0: ${resultado.err}`);
    assert.ok(resultado.out.includes(getMessages(idioma).auditFooterNoAttestation),
      `o veto a atestado de seguranca tem de aparecer em ${idioma}`);
    assert.ok(resultado.out.includes(getMessages(idioma).auditFooterInference),
      `o rodape sobre inferencia tem de aparecer em ${idioma}`);
    exigirIdiomaUnico(idioma, [resultado.out, resultado.err], PADRAO_AUDIT, [], "audit humano");
  });

  test(`should report the invalid skills manifest error only in ${idioma} on update`, () => {
    comRepo(() => instalacaoLimpa({ userLanguage: idioma }), (repo) => {
      gravarManifesto(repo, { ...lerManifesto(repo), skills: { a: 1 } });
      const resultado = cli(["update", "-y", repo, "--user-language", idioma], { env: { LC_ALL: LOCALE_CONTRARIO[idioma] } });
      const tabela = getMessages(idioma);
      const esperada = tabela.errorPrefix(tabela.manifestInvalidSkills("manifest.json", '{"a":1}'));
      assert.equal(resultado.status, 1, `erro de uso sai 1: ${resultado.err}`);
      assert.ok(resultado.err.split("\n").includes(esperada),
        `a linha de erro de ${idioma} tem de ser a da tabela ${idioma}, e saiu ${JSON.stringify(resultado.err)}`);
      if (idioma === "en") {
        assert.ok(resultado.err.split("\n").includes(
          'error: invalid "skills" in manifest.json: {"a":1} (expected an array of skill names)'),
        "em en a linha e byte a byte a de hoje (CA-24)");
      } else {
        assert.ok(!resultado.err.includes('invalid "skills" in manifest.json'),
          "em pt-BR o texto em ingles do erro de uso nao pode vazar (CA-24)");
      }
      exigirIdiomaUnico(idioma, [resultado.out, resultado.err], PADRAO_UPDATE, [repo], "update com skills invalido");
    });
  });

  test(`should print the project runtime version and the skew warning only in ${idioma}`, () => {
    comRepo(() => instalacaoLimpa({ userLanguage: idioma }), (repo) => {
      const versao = lerManifesto(repo).version;
      const alterada = "9.9.9-skew";
      gravarManifesto(repo, { ...lerManifesto(repo), version: alterada });
      const resultado = pelRuntime(repo, ["--version"], { LC_ALL: LOCALE_CONTRARIO[idioma] });
      const tabela = getMessages(idioma);
      assert.equal(resultado.status, 0, `--version do runtime sai 0: ${resultado.err}`);
      assert.equal(resultado.out.trim(), tabela.runtimeVersionLine(versao),
        `a linha de versao do runtime em ${idioma} vem da tabela do manifesto`);
      assert.equal(resultado.err.trim(), tabela.runtimeVersionSkew(versao, alterada),
        `o aviso de defasagem em ${idioma} vem da tabela do manifesto`);
      exigirIdiomaUnico(idioma, [resultado.out, resultado.err], PADRAO_RUNTIME, [repo], "runtime --version");
    });
  });

  test(`should print the mgr version line the same in ${idioma}`, () => {
    const versao = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
    const resultado = cli(["--version", "--user-language", idioma]);
    assert.equal(resultado.out.trim(), `mgr-method ${versao}`,
      "a linha de versao do mgr e identica nos dois idiomas (CA-26)");
  });

  test(`should print the doctor output of a fresh install without the ignore-file divergence in ${idioma}`, () => {
    comRepo(() => instalacaoLimpa({ userLanguage: idioma }), (repo) => {
      const humano = cli(["doctor", repo]);
      const json = cli(["doctor", "--json", repo]);
      for (const saida of [humano.out, json.out]) {
        assert.ok(!saida.includes("differs from what the method writes"),
          `instalacao recem-feita em ${idioma} nao pode acusar runtime-versioning divergente: o conteudo ignorado nao depende de idioma`);
      }
      assert.equal(json.status, 0, `recem-instalado nao tem defeito: ${json.err}`);
    });
  });
}

test("should print doctor --json byte for byte equal between languages on a planted defect", () => {
  comRepo(() => instalacaoComDefeitos(), (repo) => {
    const en = cli(["doctor", "--json", "--user-language", "en", repo]);
    const pt = cli(["doctor", "--json", "--user-language", "pt-BR", repo]);
    assert.equal(en.status, 1, `defeito plantado sai 1: ${en.err}`);
    assert.ok(en.out.startsWith("{"), "o --json tem de ser o envelope");
    assert.equal(pt.out, en.out, "o --json e dado: nao muda com o idioma da interface (CA-20)");
    assert.equal(pt.status, en.status, "o exit do --json tambem nao muda com o idioma");
  });
});

test("should print doctor --json byte for byte equal between languages on the legacy manifest", () => {
  comRepo(() => instalacaoLimpa(), (repo) => {
    const { model, version } = lerManifesto(repo);
    gravarManifesto(repo, { model, version });
    const en = cli(["doctor", "--json", "--user-language", "en", repo]);
    const pt = cli(["doctor", "--json", "--user-language", "pt-BR", repo]);
    assert.ok(en.out.startsWith("{"), `o manifesto legado tem de produzir o envelope: ${en.err}`);
    assert.equal(pt.out, en.out, "o --json do manifesto legado nao muda com o idioma (CA-20)");
  });
});

test("should print doctor --json byte for byte equal between languages for classes A, B and C", () => {
  comRepo(() => instalacaoLimpa(), (repo) => {
    const base = lerManifesto(repo);
    for (const [classe, conteudo] of CLASSES(base)) {
      gravarManifesto(repo, conteudo);
      const en = cli(["doctor", "--json", "--user-language", "en", repo]);
      const pt = cli(["doctor", "--json", "--user-language", "pt-BR", repo]);
      assert.ok(en.out.startsWith("{"), `classe ${classe}: o --json tem de ser o envelope: ${en.err}`);
      assert.equal(pt.out, en.out, `classe ${classe}: o --json nao muda com o idioma (CA-20)`);
      assert.equal(pt.status, en.status, `classe ${classe}: o exit nao muda com o idioma`);
    }
  });
});

test("should print doctor --json byte for byte equal through the runtime when the manifest language changes", () => {
  comRepo(() => instalacaoComDefeitos(), (repo) => {
    const base = lerManifesto(repo);
    gravarManifesto(repo, { ...base, userLanguage: "en" });
    const en = pelRuntime(repo, ["doctor", "--json"]);
    gravarManifesto(repo, { ...base, userLanguage: "pt-BR" });
    const pt = pelRuntime(repo, ["doctor", "--json"]);
    assert.ok(en.out.startsWith("{"), `o runtime tem de produzir o envelope: ${en.err}`);
    assert.equal(pt.out, en.out, "pelo runtime o --json tambem nao muda com o userLanguage do manifesto (CA-20)");
  });
});

test("should print doctor --json byte for byte equal through the runtime for classes A, B and C", () => {
  comRepo(() => instalacaoLimpa(), (repo) => {
    const base = lerManifesto(repo);
    for (const [classe, conteudo] of CLASSES(base)) {
      gravarManifesto(repo, conteudo);
      const en = pelRuntime(repo, ["doctor", "--json", "--user-language", "en"]);
      const pt = pelRuntime(repo, ["doctor", "--json", "--user-language", "pt-BR"]);
      assert.ok(en.out.startsWith("{"), `classe ${classe}: o runtime tem de produzir o envelope: ${en.err}`);
      assert.equal(pt.out, en.out, `classe ${classe}: pelo runtime o --json nao muda com o idioma (CA-20)`);
    }
  });
});

test("should print audit --json byte for byte equal between languages", () => {
  const en = cli(["audit", "--json", "--user-language", "en"]);
  const pt = cli(["audit", "--json", "--user-language", "pt-BR"]);
  assert.ok(en.out.startsWith("{"), `o audit --json tem de ser o envelope: ${en.err}`);
  assert.equal(pt.out, en.out, "o audit --json e dado e nao muda com o idioma (CA-23)");
});

const CASOS_SEM_MANIFESTO_LEGIVEL = () => [
  ["ausente", null],
  ["ilegivel", "{ nao e json"],
  ["null", "null"],
  ["string", '"x"'],
];

const exigirFraseNoIdioma = (resultado, lang, rotulo) => {
  const propria = [getMessages(lang).doctorSemInstalacao, getMessages(lang).doctorSemRemediacaoAutomatica];
  const alheia = [getMessages(OUTRO[lang]).doctorSemInstalacao, getMessages(OUTRO[lang]).doctorSemRemediacaoAutomatica];
  assert.ok(propria.some((frase) => resultado.out.includes(frase)),
    `${rotulo}: a saida tem de trazer a frase de ${lang}, e saiu ${JSON.stringify(resultado.out)}`);
  assert.ok(!alheia.some((frase) => resultado.out.includes(frase)),
    `${rotulo}: a frase de ${OUTRO[lang]} nao pode aparecer quando o idioma resolvido e ${lang}`);
};

for (const [locale, esperado] of [["pt_BR.UTF-8", "pt-BR"], ["C", "en"]]) {
  test(`should follow the locale ${locale} to ${esperado} when the manifest cannot be read`, () => {
    comRepo(() => instalacaoLimpa({ userLanguage: OUTRO[esperado] }), (repo) => {
      const base = lerManifesto(repo);
      for (const [rotulo, conteudo] of CASOS_SEM_MANIFESTO_LEGIVEL()) {
        if (conteudo === null) rmSync(manifestoDe(repo));
        else gravarManifesto(repo, conteudo);
        const resultado = cli(["doctor", repo], { env: { LC_ALL: locale } });
        exigirFraseNoIdioma(resultado, esperado, `manifesto ${rotulo} sob ${locale}`);
        if (conteudo === null) writeFileSync(manifestoDe(repo), JSON.stringify(base));
      }
    });
  });
}

test("should resolve es-ES to en and pt-PT to pt-BR in the user language chain", () => {
  const vazio = tempDir("mgr-vazio-");
  const es = cli(["doctor", "--user-language", "es-ES", vazio], { env: { LC_ALL: "pt_BR.UTF-8" } });
  const pt = cli(["doctor", "--user-language", "pt-PT", vazio], { env: { LC_ALL: "C" } });
  assert.equal(es.out.trim(), getMessages("en").doctorSemInstalacao,
    "es-ES nao tem tabela e cai em en, mesmo sob locale pt_BR (CA-33)");
  assert.equal(pt.out.trim(), getMessages("pt-BR").doctorSemInstalacao,
    "pt-PT e variante pt e cai em pt-BR, mesmo sob locale C (CA-33)");
});

test("should keep the manifest language en over the pt_BR locale when engines is invalid", () => {
  comRepo(() => instalacaoLimpa({ userLanguage: "en" }), (repo) => {
    gravarManifesto(repo, { ...lerManifesto(repo), engines: 7, userLanguage: "en" });
    const resultado = cli(["doctor", repo], { env: { LC_ALL: "pt_BR.UTF-8" } });
    exigirFraseNoIdioma(resultado, "en", "engines 7 com userLanguage en sob pt_BR");
  });
});

const PADRAO_MANIFESTO = /^(doctor|finding|manifest|errorPrefix|uninstallPathIgnored)/;
const CORPO_FORA_DE_FORMA = { skills: { a: 1 } };

const CENARIOS_DE_IDIOMA = (lang) => [
  ["por flag", OUTRO[lang], ["--user-language", lang]],
  ["por userLanguage", lang, []],
];

const saidaJunta = (resultado) => `${resultado.out}\n${resultado.err}`;

test("should keep the manifest language en over the pt_BR locale on doctor, runtime doctor and update when skills is out of shape", () => {
  comRepo(() => instalacaoLimpa({ userLanguage: "en" }), (repo) => {
    gravarManifesto(repo, { ...lerManifesto(repo), userLanguage: "en", ...CORPO_FORA_DE_FORMA });
    const env = { LC_ALL: "pt_BR.UTF-8" };
    const pelaCli = cli(["doctor", repo], { env });
    const pelaRuntime = pelRuntime(repo, ["doctor"], env);
    const noUpdate = cli(["update", "-y", repo], { env });
    assert.ok(pelaCli.out.includes(fixo("en", "doctorManifestoInvalido")), "o doctor da CLI diz o cabecalho em en");
    assert.ok(pelaRuntime.out.includes(fixo("en", "doctorManifestoInvalido")), "o doctor do runtime diz o cabecalho em en");
    exigirIdiomaUnico("en", [saidaJunta(pelaCli)], PADRAO_MANIFESTO, [repo], "doctor da CLI com skills objeto (CA-34)");
    exigirIdiomaUnico("en", [saidaJunta(pelaRuntime)], PADRAO_MANIFESTO, [repo], "doctor do runtime com skills objeto (CA-34)");
    exigirIdiomaUnico("en", [saidaJunta(noUpdate)], PADRAO_MANIFESTO, [repo], "update com skills objeto (CA-34)");
  });
});

test("should print everything in pt-BR when the manifest declares pt-BR with skills out of shape under the C locale", () => {
  comRepo(() => instalacaoLimpa({ userLanguage: "pt-BR" }), (repo) => {
    gravarManifesto(repo, { ...lerManifesto(repo), userLanguage: "pt-BR", ...CORPO_FORA_DE_FORMA });
    const env = { LC_ALL: "C" };
    const pelaCli = cli(["doctor", repo], { env });
    const pelaRuntime = pelRuntime(repo, ["doctor"], env);
    const noUpdate = cli(["update", "-y", repo], { env });
    assert.ok(pelaCli.out.includes(fixo("pt-BR", "doctorManifestoInvalido")), "o doctor da CLI diz o cabecalho em pt-BR");
    assert.ok(pelaRuntime.out.includes(fixo("pt-BR", "doctorManifestoInvalido")), "o doctor do runtime diz o cabecalho em pt-BR");
    exigirIdiomaUnico("pt-BR", [saidaJunta(pelaCli)], PADRAO_MANIFESTO, [repo], "doctor da CLI (CA-21)");
    exigirIdiomaUnico("pt-BR", [saidaJunta(pelaRuntime)], PADRAO_MANIFESTO, [repo], "doctor do runtime (CA-21)");
    exigirIdiomaUnico("pt-BR", [saidaJunta(noUpdate)], PADRAO_MANIFESTO, [repo], "update (CA-21)");
  });
});

const ROTULO_ESCOPO = { en: "[project]", "pt-BR": "[projeto]" };

test("should label the existing skills line as project under the C locale, as projeto with the pt-BR flag and never mix", () => {
  comRepo(() => instalacaoLimpa({ userLanguage: "en" }), (repo) => {
    const argumentos = ["install", "-y", "--dry-run", "--engine", "claude-code"];
    const emEn = cli([...argumentos, repo], { env: { LC_ALL: "C" } });
    const emPt = cli([...argumentos, "--user-language", "pt-BR", repo], { env: { LC_ALL: "C" } });
    assert.ok(emEn.out.includes(ROTULO_ESCOPO.en), `a linha de skills existentes em en traz [project]: ${emEn.out}`);
    assert.ok(!mascarar(emEn.out, [repo]).includes("projeto"), "a saida en nao pode trazer o rotulo projeto (CA-33)");
    assert.ok(emPt.out.includes(ROTULO_ESCOPO["pt-BR"]), `a flag pt-BR troca o rotulo para [projeto]: ${emPt.out}`);
    assert.ok(!emPt.out.includes(ROTULO_ESCOPO.en), "a saida pt-BR nao pode trazer [project] (CA-33)");
  });
});

for (const idioma of IDIOMAS) {
  for (const [via, idiomaDoManifesto, flag] of CENARIOS_DE_IDIOMA(idioma)) {
    const env = { LC_ALL: LOCALE_CONTRARIO[idioma] };

    for (const comando of ["update", "install"]) {
      test(`should print the ${comando} refusal block only in ${idioma} ${via}`, () => {
        comRepo(() => instalacaoLimpa(), (repo) => {
          gravarManifesto(repo, { ...lerManifesto(repo), userLanguage: idiomaDoManifesto, architecture: 7 });
          const resultado = cli([comando, "-y", ...flag, repo], { env });
          const saida = saidaJunta(resultado);
          assert.notEqual(resultado.status, 0, `a declaracao fora de forma recusa o ${comando}: ${saida}`);
          assert.ok(saida.includes(getMessages(idioma).manifestRefused("manifest.json")),
            `o cabecalho da recusa em ${idioma} vem da tabela ${idioma}, e saiu ${JSON.stringify(saida)}`);
          exigirIdiomaUnico(idioma, [saida], PADRAO_MANIFESTO, [repo], `recusa do ${comando} ${via}`);
        });
      });
    }

    test(`should print the repair announcement only in ${idioma} ${via}`, () => {
      comRepo(() => instalacaoLimpa(), (repo) => {
        gravarManifesto(repo, { ...lerManifesto(repo), userLanguage: idiomaDoManifesto, scope: "bogus" });
        const resultado = cli(["update", "-y", ...flag, repo], { env });
        const saida = saidaJunta(resultado);
        assert.ok(saida.includes(getMessages(idioma).manifestRepairTitle("manifest.json")),
          `o anuncio de reparo em ${idioma} vem da tabela ${idioma}, e saiu ${JSON.stringify(saida)}`);
        exigirIdiomaUnico(idioma, [saida], PADRAO_MANIFESTO, [repo], `anuncio de reparo ${via}`);
      });
    });

    test(`should print the ignored uninstall path line only in ${idioma} ${via}`, () => {
      comRepo(() => instalacaoLimpa(), (repo) => {
        gravarManifesto(repo, { ...lerManifesto(repo), userLanguage: idiomaDoManifesto, skillsDirs: ["../fora"] });
        const resultado = cli(["uninstall", "-y", ...flag, repo], { env });
        const saida = saidaJunta(resultado);
        assert.ok(saida.includes(getMessages(idioma).uninstallPathIgnored(path.resolve(repo, "../fora"))),
          `a linha de caminho ignorado em ${idioma} vem da tabela ${idioma}, e saiu ${JSON.stringify(saida)}`);
        exigirIdiomaUnico(idioma, [saida], PADRAO_MANIFESTO, [repo], `uninstall com caminho ignorado ${via}`);
      });
    });
  }
}

const BASE_DOS_PADROES = "manifest|errorPrefix|fileNot";
const PADRAO_POR_COMANDO = {
  update: new RegExp(`^(${BASE_DOS_PADROES}|update|plan|removed|keptBy|existingSkills|installing|installedAt|migrationInfo|done|dryRun|runtime(Migrated|Relocated|Written|Ignore)|configMigrated)`),
  install: new RegExp(`^(${BASE_DOS_PADROES}|install|plan|removed|keptBy|existingSkills|migrationInfo|done|dryRun|runtime(Migrated|Relocated|Written|Ignore)|configMigrated|instructions)`),
  uninstall: new RegExp(`^(${BASE_DOS_PADROES}|uninstall|removedItem|removedSkills)`),
  doctor: PADRAO_MANIFESTO,
  status: new RegExp(`^(${BASE_DOS_PADROES}|status)`),
  instructions: new RegExp(`^(${BASE_DOS_PADROES}|instructions)`),
};

const MODOS_DE_IDIOMA = [
  { rotulo: "with the pt-BR flag", flag: ["--user-language", "pt-BR"], locale: "C", esperado: () => "pt-BR" },
  { rotulo: "with the en flag", flag: ["--user-language", "en"], locale: "pt_BR.UTF-8", esperado: () => "en" },
  {
    rotulo: "from the manifest language alone",
    flag: [],
    locale: "C",
    esperado: (caso) => (caso.idiomaNoManifesto === false ? "en" : "pt-BR"),
    declaraIdioma: true,
  },
];

const plantarCaso = (repo, caso, modo) => {
  const planejado = caso.plantar(lerManifesto(repo));
  if (planejado.bruto !== undefined) {
    writeFileSync(manifestoDe(repo), planejado.bruto);
    return;
  }
  const idioma = modo.declaraIdioma && caso.idiomaNoManifesto !== false ? { userLanguage: "pt-BR" } : {};
  gravarManifesto(repo, { ...planejado, ...idioma });
};

const rodarCaso = (repo, caso, modo) => {
  const env = { LC_ALL: modo.locale };
  const args = typeof caso.args === "function" ? caso.args(repo) : caso.args;
  if (caso.comando === "instructions") return pelRuntime(repo, [caso.comando, ...args, ...modo.flag], env);
  return cli([caso.comando, ...args, ...modo.flag, repo], { env });
};

for (const caso of CASOS_DE_CLI.filter((candidato) => candidato.jaCoberto === undefined)) {
  for (const modo of MODOS_DE_IDIOMA) {
    const esperado = modo.esperado(caso);
    test(`should print the ${caso.id} output only in ${esperado} ${modo.rotulo}`, () => {
      comRepo(() => controleValido(), (repo) => {
        plantarCaso(repo, caso, modo);
        const resultado = rodarCaso(repo, caso, modo);
        const saida = saidaJunta(resultado);
        assert.ok(saida.trim().length > 0, `${caso.id}: o comando tem de dizer alguma coisa, e saiu vazio`);
        exigirIdiomaUnico(esperado, [saida], PADRAO_POR_COMANDO[caso.comando], [repo], `${caso.id} ${modo.rotulo}`);
      });
    });
  }
}

let copiaDoDist = null;
const obterCopiaDoDist = () => {
  if (copiaDoDist) return copiaDoDist;
  const destino = tempDir("mgr-dist-");
  for (const dir of ["bin", "src", "scripts", "skills", "shared", "agents"]) {
    cpSync(path.join(ROOT, dir), path.join(destino, dir), { recursive: true });
  }
  cpSync(path.join(ROOT, "package.json"), path.join(destino, "package.json"));
  symlinkSync(path.join(ROOT, "node_modules"), path.join(destino, "node_modules"), "dir");
  const build = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: destino, encoding: "utf8", env: ambiente() });
  assert.equal(build.status, 0, `o build da copia tem de passar: ${build.stderr}`);
  const pacote = path.join(destino, "package.json");
  const versaoBuild = JSON.parse(readFileSync(pacote, "utf8")).version;
  const versaoPacote = `${versaoBuild}-defasado`;
  writeFileSync(pacote, `${JSON.stringify({ ...JSON.parse(readFileSync(pacote, "utf8")), version: versaoPacote }, null, 2)}\n`);
  copiaDoDist = { destino, versaoBuild, versaoPacote };
  return copiaDoDist;
};

after(() => {
  if (copiaDoDist) rmSync(copiaDoDist.destino, { recursive: true, force: true });
});

for (const idioma of IDIOMAS) {
  test(`should warn about a stale dist before any command and only in ${idioma}`, () => {
    const { destino, versaoBuild, versaoPacote } = obterCopiaDoDist();
    const resultado = rodar([path.join(destino, "bin", "mgr.cjs"), "--version", "--user-language", idioma],
      { cwd: destino, env: { LC_ALL: LOCALE_CONTRARIO[idioma] } });
    assert.equal(resultado.status, 1, "o dist defasado recusa o comando com exit 1");
    assert.equal(resultado.out, "", "o aviso sai antes de qualquer comando rodar, entao o stdout fica vazio");
    assert.equal(resultado.err.trim(), getMessages(idioma).distVersionMismatch(versaoBuild, versaoPacote),
      `o aviso do dist em ${idioma} vem da tabela do idioma da cadeia (CA-26)`);
    exigirIdiomaUnico(idioma, [resultado.out, resultado.err], PADRAO_DIST, [destino], "aviso do dist");
  });
}

import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import vm from "node:vm";
import { findingTexts } from "../../src/sdd/findings.js";
import { renderText } from "../../src/core/ui-text.js";
import * as planValidator from "../../src/sdd/plan-validator.js";
import * as specValidator from "../../src/sdd/spec-validator.js";
import * as provValidator from "../../src/sdd/prov-validator.js";
import * as docValidator from "../../src/sdd/doc-validator.js";
import { assemble } from "../../src/session/precompact.js";
import { problemasDosDezesseteRamos } from "../fixtures/skills-dos-17-ramos.js";
import { add as addPlugin } from "../../src/install/plugin-installer.js";
import { aggregateChecksum, sha256 } from "../../src/plugin.js";
import { addRegistry } from "../../src/plugins/registry.js";
import { readLockfile } from "../../src/install/lockfile.js";

const CODIGOS_DAS_CINCO_FAMILIAS = ["PLAN-1", "PLAN-4", "SPEC-1", "PROV-2", "DOC-3"];

const plantarFeatureComUmDefeitoDeCadaFamilia = (repo) => {
  const dir = path.join(repo, "specs", "alfa");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "04-plan.md"), [
    "<!-- mgr-plan-format: 1 -->",
    "### P0.1 — a", "- **depends_on:** [P9.9]", "- **artifact:** 1 x", "- **done_when:** y",
    "### P0.2 — b", "",
  ].join("\n"), "utf8");
  writeFileSync(path.join(dir, "03-spec.md"), "<!-- mgr-spec-format: 1 -->\n# spec sem critério\n", "utf8");
  writeFileSync(path.join(dir, "01-brief.md"), "a origem disto [code:src/sumiu.js:1]\n", "utf8");
  writeFileSync(path.join(dir, "05-execution.md"), "# Execução\n", "utf8");
  writeFileSync(path.join(dir, "06-completion.md"), "# Completion\n\n## Testes\n\nverdes\n", "utf8");
};

const achadosDoRepo = (repo) => [
  ...planValidator.validatePlans(repo, { slug: null }).findings,
  ...specValidator.validateSpecs(repo, { slug: null }).findings,
  ...provValidator.validateProvenance(repo, { slug: null }).findings,
  ...docValidator.validateDocs(repo, { slug: null }).findings,
];

const chavesDosTextos = (achados) => [...new Set(achados.flatMap((achado) => {
  const textos = findingTexts(achado);
  return [textos.message, textos.remediation, textos.example].filter((d) => "key" in d).map((d) => d.key);
}))];

const exigirChavesNoIdioma = (lang, saida, chaves, caminhos, cenario) => {
  const texto = mascarar(saida, caminhos);
  const proprio = corpoDe(lang);
  const alheios = chaves
    .flatMap((chave) => (renderizar(getMessages(OUTRO[lang])[chave]) ?? "").split(SENTINELA))
    .filter((trecho) => /\p{L}/u.test(trecho) && !proprio.includes(trecho));
  for (const trecho of new Set(alheios)) {
    assert.ok(!texto.includes(trecho),
      `${cenario} em ${lang}: o trecho fixo ${JSON.stringify(trecho)} e da tabela ${OUTRO[lang]} e nao ocorre em nenhuma frase ${lang}`);
  }
};

const porRepoComDefeitos = (corpo) => {
  const repo = tempDir("mgr-spec-");
  plantarFeatureComUmDefeitoDeCadaFamilia(repo);
  corpo(repo);
};

for (const idioma of IDIOMAS) {
  test(`should print the spec validate human output only in ${idioma} for one defect of each family`, () => {
    porRepoComDefeitos((repo) => {
      const achados = achadosDoRepo(repo);
      const codigos = achados.map((achado) => achado.code);
      for (const codigo of CODIGOS_DAS_CINCO_FAMILIAS) {
        assert.ok(codigos.includes(codigo), `a fixture tem de produzir ${codigo}, e produziu ${codigos.join(", ")}`);
      }
      const resultado = cli(["spec", "validate", "--all", "--user-language", idioma], { cwd: repo, env: { LC_ALL: LOCALE_CONTRARIO[idioma] } });
      const tabela = getMessages(idioma);
      const outraTabela = getMessages(OUTRO[idioma]);
      assert.equal(resultado.status, 1, `defeito de artefato bloqueia com exit 1: ${resultado.err}`);
      for (const achado of achados) {
        const textos = findingTexts(achado);
        for (const campo of ["message", "remediation"]) {
          const proprio = renderText(tabela, textos[campo]);
          const alheio = renderText(outraTabela, textos[campo]);
          assert.ok(resultado.out.includes(proprio), `${achado.code} em ${idioma}: o ${campo} tem de sair na tabela ${idioma}`);
          if (alheio !== proprio) {
            assert.ok(!resultado.out.includes(alheio), `${achado.code} em ${idioma}: o ${campo} de ${OUTRO[idioma]} vazou`);
          }
        }
        for (const linha of renderText(tabela, textos.example).split("\n")) {
          assert.ok(resultado.out.includes(tabela.specValidateExample(linha)), `${achado.code} em ${idioma}: a linha de exemplo tem de sair em ${idioma}`);
        }
      }
      assert.ok(resultado.out.includes(tabela.specValidateSummary(achados.filter((a) => a.severity === "error").length,
        achados.filter((a) => a.severity === "warning").length)), `o rodape de resumo em ${idioma} vem da tabela ${idioma}`);
      exigirIdiomaUnico(idioma, [resultado.out, resultado.err], /^specValidate/, [repo], "spec validate humano");
      exigirChavesNoIdioma(idioma, resultado.out, chavesDosTextos(achados), [repo], "spec validate humano");
    });
  });

  test(`should print the spec status human output only in ${idioma}`, () => {
    porRepoComDefeitos((repo) => {
      const tabela = getMessages(idioma);
      const slug = cli(["spec", "status", "alfa", "--user-language", idioma], { cwd: repo, env: { LC_ALL: LOCALE_CONTRARIO[idioma] } });
      const todas = cli(["spec", "status", "--all", "--user-language", idioma], { cwd: repo, env: { LC_ALL: LOCALE_CONTRARIO[idioma] } });
      for (const saida of [slug, todas]) {
        assert.equal(saida.status, 0, `spec status sai 0: ${saida.err}`);
        assert.ok(saida.out.includes(tabela.specStatusWarning), `o aviso de existencia nao e progresso sai na tabela ${idioma}`);
        assert.ok(tabela.specStatusWarning === getMessages(OUTRO[idioma]).specStatusWarning
          || !saida.out.includes(getMessages(OUTRO[idioma]).specStatusWarning),
        `o aviso de ${OUTRO[idioma]} nao pode aparecer na saida humana de ${idioma}`);
        exigirIdiomaUnico(idioma, [saida.out, saida.err], /^specStatus/, [repo], "spec status humano");
      }
    });
  });
}

test("should print spec validate --all --json byte for byte equal between languages with the canonical texts", () => {
  porRepoComDefeitos((repo) => {
    const achados = achadosDoRepo(repo);
    const en = cli(["spec", "validate", "--all", "--json", "--user-language", "en"], { cwd: repo, env: { LC_ALL: "pt_BR.UTF-8" } });
    const pt = cli(["spec", "validate", "--all", "--json", "--user-language", "pt-BR"], { cwd: repo, env: { LC_ALL: "C" } });
    assert.ok(en.out.startsWith("{"), `o --json tem de ser o envelope: ${en.err}`);
    assert.equal(pt.out, en.out, "o spec validate --json e dado e nao muda com o idioma (CA-35)");
    assert.equal(pt.status, en.status, "o exit do --json tambem nao muda com o idioma");
    const envelope = JSON.parse(en.out);
    assert.equal(envelope.findings.length, achados.length, "o envelope traz um achado por achado do nucleo");
    const canonica = getMessages("en");
    envelope.findings.forEach((achado, indice) => {
      const textos = findingTexts(achados[indice]);
      assert.equal(achado.code, achados[indice].code, `achado ${indice}: a ordem do envelope e a do nucleo`);
      for (const campo of ["message", "remediation", "example"]) {
        assert.equal(achado[campo], renderText(canonica, textos[campo]),
          `${achado.code}: o ${campo} do --json e o ingles canonico (CA-35)`);
      }
    });
  });
});

test("should print spec status --json byte for byte equal between languages with the canonical warning", () => {
  porRepoComDefeitos((repo) => {
    for (const args of [["spec", "status", "alfa", "--json"], ["spec", "status", "--all", "--json"]]) {
      const en = cli([...args, "--user-language", "en"], { cwd: repo, env: { LC_ALL: "pt_BR.UTF-8" } });
      const pt = cli([...args, "--user-language", "pt-BR"], { cwd: repo, env: { LC_ALL: "C" } });
      assert.ok(en.out.startsWith("{"), `${args.join(" ")}: o --json tem de ser o envelope: ${en.err}`);
      assert.equal(pt.out, en.out, `${args.join(" ")}: o --json nao muda com o idioma (CA-40 a)`);
      assert.equal(JSON.parse(pt.out).warning, getMessages("en").specStatusWarning,
        `${args.join(" ")}: o warning do --json e o canonico em ingles`);
    }
  });
});

const INSTANTE_FIXO = 1767323045000;

const relogioFixo = () => {
  const arquivo = path.join(tempDir("mgr-relogio-"), "relogio.cjs");
  writeFileSync(arquivo, [
    "const Real = Date;",
    `class Fixa extends Real { constructor(...args) { if (args.length === 0) super(${INSTANTE_FIXO}); else super(...args); } static now() { return ${INSTANTE_FIXO}; } }`,
    "globalThis.Date = Fixa;",
    "",
  ].join("\n"), "utf8");
  return arquivo;
};

const PLANO_DO_HANDOFF = [
  "<!-- mgr-plan-format: 1 -->", "# Plano", "", "## P1 — Core", "",
  "### P1.1 — task de teste", "- **priority:** P1", "- **depends_on:** []",
  "- **files:** [src/a.js]", "- **artifact:** 1 coisa declarada", "- **done_when:** pronto",
  "- **helper_skill:** none", "- **status:** todo",
].join("\n");

const MARCADORES_PT_DO_HANDOFF = [
  "Hand-off automático", "O que este hand-off NÃO sabe", "Próxima task", "Não foi pedido por ninguém",
];

for (const idioma of IDIOMAS) {
  test(`should write the hand-off through the runtime in ${idioma} from the manifest language alone`, () => {
    comRepo(() => instalacaoLimpa({ userLanguage: idioma }), (repo) => {
      mkdirSync(path.join(repo, "specs", "alfa"), { recursive: true });
      writeFileSync(path.join(repo, "specs", "alfa", "04-plan.md"), `${PLANO_DO_HANDOFF}\n`, "utf8");
      const tabela = getMessages(idioma);
      const iso = new Date(INSTANTE_FIXO).toISOString();
      const esperado = assemble(repo, {
        engine: "claude-code", trigger: "auto", changedFiles: [], now: new Date(INSTANTE_FIXO), tabela,
      }).text;
      const resultado = spawnSync(process.execPath,
        ["--require", relogioFixo(), runtimeDe(repo), "precompact", "--hook", "claude-code"],
        { cwd: repo, encoding: "utf8", input: '{"trigger":"auto"}', env: ambiente({ LC_ALL: LOCALE_CONTRARIO[idioma] }) });
      const arquivo = path.join(repo, "specs", "alfa", ".handoff.md");
      assert.ok(existsSync(arquivo), `o hook tem de gravar o hand-off: ${resultado.stderr}`);
      const conteudo = readFileSync(arquivo, "utf8");
      assert.equal(conteudo, esperado, `o hand-off em ${idioma} e byte a byte o que o codigo monta para a mesma data (CA-37)`);
      assert.ok(conteudo.includes(tabela.handoffTitle(iso)), `o titulo em ${idioma} vem da tabela do manifesto`);
      assert.ok(conteudo.includes(tabela.handoffUnknownTitle), `o titulo da secao de limites em ${idioma} vem da tabela do manifesto`);
      assert.ok(conteudo.includes(tabela.handoffOpeningAuto("claude-code", "auto")), `a abertura em ${idioma} vem da tabela do manifesto`);
      for (const marcador of MARCADORES_PT_DO_HANDOFF) {
        assert.equal(conteudo.includes(marcador), idioma === "pt-BR",
          `o marcador pt-BR ${JSON.stringify(marcador)} so pode estar no hand-off de pt-BR (estava em ${idioma}: ${conteudo.includes(marcador)})`);
      }
      exigirIdiomaUnico(idioma, [conteudo], /^handoff/, [repo], "hand-off");
    });
  });
}

const LAUNCHER = path.join(ROOT, "bin", "mgr.cjs");
const requireDoTeste = createRequire(import.meta.url);

class SaidaDoLauncher extends Error {
  constructor(codigo) {
    super(`exit ${codigo}`);
    this.codigo = codigo;
  }
}

const rodarLauncherNoVm = ({ argv = [], locale, cwd, home }) => {
  const mensagens = [];
  const processo = {
    versions: { node: "18.0.0" },
    version: "v18.0.0",
    argv: ["node", LAUNCHER, ...argv],
    env: { LC_ALL: locale },
    cwd: () => cwd,
    exit: (codigo) => { throw new SaidaDoLauncher(codigo); },
  };
  const contexto = {
    process: processo,
    console: { error: (mensagem) => mensagens.push(mensagem) },
    require: (modulo) => (modulo === "os" ? { homedir: () => home } : requireDoTeste(modulo)),
    __dirname: path.dirname(LAUNCHER),
  };
  let codigo = null;
  try {
    vm.runInNewContext(readFileSync(LAUNCHER, "utf8"), contexto, { filename: LAUNCHER });
  } catch (erro) {
    if (!(erro instanceof SaidaDoLauncher)) throw erro;
    codigo = erro.codigo;
  }
  return { mensagens, codigo };
};

const CASOS_DO_LAUNCHER = [
  { rotulo: "a: a flag en vence o manifesto pt-BR e o locale pt_BR", esperado: "en", argv: ["--user-language", "en"], manifesto: { userLanguage: "pt-BR" }, locale: "pt_BR.UTF-8" },
  { rotulo: "a: a flag pt-BR vence o manifesto en e o locale C", esperado: "pt-BR", argv: ["--user-language", "pt-BR"], manifesto: { userLanguage: "en" }, locale: "C" },
  { rotulo: "b: o manifesto en do projeto vence o locale pt_BR", esperado: "en", manifesto: { userLanguage: "en" }, locale: "pt_BR.UTF-8" },
  { rotulo: "b: o manifesto pt-BR do projeto vence o locale C", esperado: "pt-BR", manifesto: { userLanguage: "pt-BR" }, locale: "C" },
  { rotulo: "b: o manifesto do diretorio pai vale para um subdiretorio", esperado: "en", manifesto: { userLanguage: "en" }, locale: "pt_BR.UTF-8", subdiretorio: true },
  { rotulo: "c: sem flag e sem manifesto, o locale pt_BR resolve pt-BR", esperado: "pt-BR", locale: "pt_BR.UTF-8" },
  { rotulo: "c: sem flag e sem manifesto, o locale C resolve en", esperado: "en", locale: "C" },
  { rotulo: "d: manifesto ilegivel cai no locale pt_BR", esperado: "pt-BR", manifesto: "{ nao e json", locale: "pt_BR.UTF-8" },
  { rotulo: "d: manifesto ilegivel cai no locale C", esperado: "en", manifesto: "{ nao e json", locale: "C" },
];

for (const caso of CASOS_DO_LAUNCHER) {
  test(`should print the Node too old text in ${caso.esperado} for case ${caso.rotulo}`, () => {
    const base = tempDir("mgr-launcher-");
    const home = path.join(base, "home");
    const projeto = path.join(base, "projeto");
    mkdirSync(home, { recursive: true });
    mkdirSync(path.join(projeto, ".mgr-core"), { recursive: true });
    if (caso.manifesto !== undefined) {
      writeFileSync(path.join(projeto, ".mgr-core", "manifest.json"),
        typeof caso.manifesto === "string" ? caso.manifesto : JSON.stringify(caso.manifesto), "utf8");
    } else {
      rmSync(path.join(projeto, ".mgr-core"), { recursive: true, force: true });
    }
    const cwd = caso.subdiretorio ? path.join(projeto, "pacote", "interno") : projeto;
    mkdirSync(cwd, { recursive: true });
    const resultado = rodarLauncherNoVm({ argv: caso.argv, locale: caso.locale, cwd, home });
    assert.equal(resultado.codigo, 1, "o launcher recusa o Node antigo com exit 1");
    assert.deepEqual(resultado.mensagens, [getMessages(caso.esperado).nodeTooOld("22", "v18.0.0")],
      `o texto do launcher em ${caso.esperado} e o da tabela ${caso.esperado} (paridade das duas copias)`);
  });
}

for (const idioma of IDIOMAS) {
  test(`should render the skill problems of all 17 branches only in ${idioma}`, () => {
    const problemas = problemasDosDezesseteRamos();
    assert.equal(new Set(problemas.map((problema) => problema.key)).size, 17, "a fixture passa pelos 17 ramos de problema");
    const tabela = getMessages(idioma);
    const textos = problemas.map((problema) => renderText(tabela, problema));
    exigirIdiomaUnico(idioma, [textos.join("\n")], /^skillIssue/, [], "checkSkill nos 17 ramos");
  });
}

const subirRegistryComSkillDoCopilot = async () => {
  const nome = "copilot-degrade";
  const skillMd = `---\nname: ${nome}\ndescription: Variante de teste para o motor copilot, com modelo e esforco declarados.\n---\n\n# ${nome}\n`;
  const manifest = {
    name: `@acme/${nome}`, version: "1.0.0", author: "Acme",
    description: "Variante de teste para o motor copilot. Use when the user asks for the copilot degradation.",
    category: "language", permissions: ["read-files"], model: { copilot: "gpt-5" }, effort: "high",
  };
  const contents = [
    { path: "SKILL.md", content: Buffer.from(skillMd, "utf8") },
    { path: "mgr-manifest.json", content: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
  ];
  let index;
  const server = createServer((request, response) => {
    if (request.url === "/index.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(index));
      return;
    }
    const arquivo = contents.find((candidato) => request.url === `/${nome}/${candidato.path}`);
    if (!arquivo) { response.statusCode = 404; response.end("nf"); return; }
    response.end(arquivo.content);
  });
  await new Promise((pronto) => server.listen(0, "127.0.0.1", pronto));
  const base = `http://127.0.0.1:${server.address().port}`;
  index = {
    indexVersion: 1, registry: "acme", generatedAt: "2026-08-25T00:00:00.000Z",
    categories: {
      language: [{
        name: manifest.name, version: "1.0.0", description: manifest.description,
        checksum: aggregateChecksum(contents),
        files: contents.map((arquivo) => ({ path: arquivo.path, url: `${base}/${nome}/${arquivo.path}`, sha256: sha256(arquivo.content) })),
      }],
    },
  };
  return { server, indexUrl: `${base}/index.json`, name: manifest.name };
};

const adicionarSkillDoCopilot = async (repo, stub) => {
  const coreDir = path.join(repo, ".mgr-core");
  mkdirSync(coreDir, { recursive: true });
  addRegistry(coreDir, { name: "acme", url: stub.indexUrl });
  return addPlugin(stub.name, {
    repo, coreDir,
    targets: [{ engine: "copilot", dir: path.join(repo, ".github", "skills") }],
    fetchImpl: globalThis.fetch, confirm: async () => true, resolveCollision: async () => "alongside",
  });
};

const linhasDeAvisoDaTela = (tabela, instaladas) => instaladas
  .flatMap((skill) => skill.warnings.map(({ engine, warning }) => tabela.pluginWarning(engine, renderText(tabela, warning))));

for (const idioma of IDIOMAS) {
  test(`should print the plugin warning lines in ${idioma} and never as [object Object]`, async () => {
    const repo = tempDir("mgr-plugin-");
    const stub = await subirRegistryComSkillDoCopilot();
    try {
      const resultado = await adicionarSkillDoCopilot(repo, stub);
      const tabela = getMessages(idioma);
      const linhas = linhasDeAvisoDaTela(tabela, resultado.installed);
      assert.deepEqual(linhas, [
        tabela.pluginWarning("copilot", tabela.copilotModelIgnored("gpt-5")),
        tabela.pluginWarning("copilot", tabela.copilotEffortUnsupported("high")),
      ], `as duas degradacoes do copilot saem como linhas ${idioma}`);
      for (const linha of linhas) {
        assert.ok(!linha.includes("[object Object]"), `a linha ${JSON.stringify(linha)} nao pode carregar o descritor sem renderizar`);
      }
      exigirIdiomaUnico(idioma, linhas, /^(pluginWarning|copilot)/, [repo], "aviso do plugin");
    } finally {
      stub.server.closeAllConnections();
      stub.server.close();
    }
  });
}

test("should keep the lockfile copilot warnings in english after the screen is rendered in pt-BR", async () => {
  const repo = tempDir("mgr-plugin-");
  const stub = await subirRegistryComSkillDoCopilot();
  try {
    const resultado = await adicionarSkillDoCopilot(repo, stub);
    const tela = linhasDeAvisoDaTela(getMessages("pt-BR"), resultado.installed).join("\n");
    assert.ok(tela.includes(getMessages("pt-BR").copilotModelIgnored("gpt-5")), "controle: a tela saiu em pt-BR");
    const gravados = readLockfile(repo).skills[stub.name].applied.copilot.warnings;
    const canonica = getMessages("en");
    assert.deepEqual(gravados, [canonica.copilotModelIgnored("gpt-5"), canonica.copilotEffortUnsupported("high")],
      "o lockfile e dado: grava o ingles canonico mesmo com a tela em pt-BR (CA-40 b)");
  } finally {
    stub.server.closeAllConnections();
    stub.server.close();
  }
});

test("should run every CLI acceptance criterion from CA-1 to CA-33 in the language loop or name why it is outside", () => {
  const noLaco = new Set(CASOS_DE_CLI.map(({ id }) => id.split(":")[0]));
  const fora = new Map(CASOS_FORA_DO_LACO.map(({ id, razao }) => [id, razao]));
  for (let numero = 1; numero <= 33; numero += 1) {
    const criterio = `CA-${numero}`;
    assert.ok(noLaco.has(criterio) || fora.has(criterio), `${criterio} nao esta no laco de idioma nem fora dele com motivo`);
    assert.ok(!(noLaco.has(criterio) && fora.has(criterio)), `${criterio} nao pode estar no laco e fora dele ao mesmo tempo`);
  }
  for (const razao of fora.values()) assert.ok(razao.trim().length > 0);
});
