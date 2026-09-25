import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, writeFileSync, cpSync } from "node:fs";
import {
  DEFECT, FIX_RESTORE, FIX_UPDATE, NO_FIX, UNAVAILABLE, WARNING,
  SKILL_DECLARADA, SKILL_ORFA, FONTE_COMPARTILHADA,
  PROVA_FUNCIONA, PROVA_NAO_FUNCIONA, PROVA_NAO_MEDIDA, SEM_REMEDIACAO,
  architectureSkill, bodyCheckAvailability, brokenHooks, divergentBody, lockfileDrift, missingAgents, missingShared, missingSkills,
  orphanSkills, sharedCheckAvailability, staleInstall, unresolvedTokens,
  AUDITED, NO_INSTALL, diagnose, hasDefect, CHECKS,
} from "../src/doctor.js";
import path from "node:path";
import { diff } from "../src/lockfile.js";
import * as bundle from "../src/bundle.js";
import * as catalog from "../src/catalog.js";
import * as engineDescriptors from "../src/engines/index.js";
import { ORFA, VERSAO_VELHA, descartar, instalacaoComDefeitos, instalacaoComDefeitosDoisMotores, instalacaoLimpa, instalacaoLimpaDoisMotores, apagarFonteCompartilhada, plantarTokenEmShared, alterarCorpoEmShared } from "./fixtures/instalacao.js";

const DIR = ".claude/skills";

test("skill em disco fora do manifesto e achado", () => {
  const achados = orphanSkills({ declared: ["spec-init"], onDisk: ["spec-init", "junit-clean"], skillsDir: DIR });
  assert.equal(achados.length, 1);
  assert.equal(achados[0].check, "orphan-skill");
  assert.equal(achados[0].file, `${DIR}/junit-clean`);
  assert.equal(achados[0].found, "em disco e fora do manifesto");
});

test("skill declarada em disco NAO e achado", () => {
  assert.deepEqual(orphanSkills({ declared: ["spec-init", "adr-create"], onDisk: ["spec-init", "adr-create"], skillsDir: DIR }), [],
    "sete das dez deste repositorio estao no manifesto, e instalacao recem-feita tem zero orfas");
});

test("orfa NAO tem correcao automatica", () => {
  const [achado] = orphanSkills({ declared: [], onDisk: ["junit-clean"], skillsDir: DIR });
  assert.equal(achado.fix, NO_FIX,
    "na 0.6.0-beta.1 o remove apagou a skill do proprio metodo; no momento do diagnostico a origem de uma orfa e desconhecida");
});

test("skill declarada e ausente e achado, e tem correcao", () => {
  const achados = missingSkills({ declared: ["spec-init", "adr-create"], onDisk: ["spec-init"], skillsDir: DIR });
  assert.equal(achados.length, 1);
  assert.equal(achados[0].file, `${DIR}/adr-create/SKILL.md`);
  assert.equal(achados[0].fix, FIX_UPDATE, "medido: o update restaura skill declarada e apagada");
});

test("manifesto e disco batendo NAO produz achado de skill ausente", () => {
  assert.deepEqual(missingSkills({ declared: ["spec-init"], onDisk: ["spec-init", "extra"], skillsDir: DIR }), [],
    "sobra em disco e assunto da orfa, nao desta verificacao");
});

test("agente declarado sem arquivo e achado, e tem correcao", () => {
  const achados = missingAgents({
    declared: [".claude/agents/mgr-draft.md", ".claude/agents/mgr-review.md"],
    exists: (caminho) => caminho.endsWith("mgr-draft.md"),
  });
  assert.equal(achados.length, 1);
  assert.equal(achados[0].file, ".claude/agents/mgr-review.md");
  assert.equal(achados[0].fix, FIX_UPDATE, "medido: o update restaura agente apagado");
});

test("os tres agentes presentes NAO produzem achado", () => {
  assert.deepEqual(missingAgents({
    declared: [".claude/agents/mgr-draft.md", ".claude/agents/mgr-task.md", ".claude/agents/mgr-review.md"],
    exists: () => true,
  }), [], "e o estado deste repositorio e o da instalacao recem-feita");
});

test("nenhuma fonte compartilhada ausente NAO produz achado", () => {
  const esperadas = [
    { installed: ["_shared", "laws", "execution-laws.md"] },
    { installed: ["_shared", "charter", "core-principles.md"] },
  ];
  assert.deepEqual(missingShared({
    expected: esperadas,
    exists: () => true,
    skillsDir: DIR,
  }), [], "fontes incondicionais sao instaladas sempre, e o arquivo de verdade existe");
});

test("fonte compartilhada declarada e ausente produz um achado", () => {
  const esperadas = [
    { installed: ["_shared", "laws", "execution-laws.md"] },
  ];
  const achados = missingShared({
    expected: esperadas,
    exists: () => false,
    skillsDir: DIR,
  });
  assert.equal(achados.length, 1, "uma fonte ausente vira um achado");
  assert.equal(achados[0].check, "missing-shared");
  assert.equal(achados[0].severity, DEFECT);
  assert.match(achados[0].file, /_shared.*execution-laws/, "o arquivo e a fonte juntada com o diretorio");
  assert.equal(achados[0].expected, "presente, porque o conjunto instalado a exige");
  assert.equal(achados[0].found, "ausente");
  assert.equal(achados[0].fix, FIX_UPDATE, "medido: o update restaura fonte compartilhada apagada");
});

test("duas fontes compartilhadas ausentes produzem dois achados, um por descritor", () => {
  const esperadas = [
    { installed: ["_shared", "laws", "execution-laws.md"] },
    { installed: ["_shared", "charter", "core-principles.md"] },
  ];
  const achados = missingShared({
    expected: esperadas,
    exists: () => false,
    skillsDir: DIR,
  });
  assert.equal(achados.length, 2, "cada descritor ausente vira um achado (RN-11: um achado por subarvore)");
  assert.match(achados[0].file, /execution-laws/);
  assert.match(achados[1].file, /core-principles/);
});

test("fonte compartilhada condicional ausente nao e achado quando o conjunto nao a exige", () => {
  const conjuntoSemArqESemSpec = ["configure-agents"];
  const esperadas = catalog.requiredShared(conjuntoSemArqESemSpec);
  assert.equal(esperadas.length, 2, "o conjunto sem arch e sem spec-init tem so as duas incondicionais");
  const temArch = esperadas.some((e) => e.installed.includes("arch"));
  const temQuality = esperadas.some((e) => e.installed.includes("quality"));
  assert.ok(!temArch && !temQuality, "arch e quality nao sao exigidas");
  const achados = missingShared({
    expected: esperadas,
    exists: (caminho) => caminho.includes("laws") || caminho.includes("charter"),
    skillsDir: DIR,
  });
  assert.equal(achados.length, 0, "as fontes exigidas existem, nenhum achado mesmo que condicionais estejam ausentes");
});

test("arquitetura declarada sem a skill e achado", () => {
  const achados = architectureSkill({ architecture: "layered", onDisk: ["spec-init"], skillsDir: DIR });
  assert.equal(achados.length, 1);
  assert.equal(achados[0].file, `${DIR}/arch-layered/SKILL.md`);
  assert.match(achados[0].expected, /layered/);
  assert.equal(achados[0].fix, FIX_UPDATE, "medido com --arch layered: o update restaura");
});

test("arquitetura declarada COM a skill NAO e achado", () => {
  assert.deepEqual(architectureSkill({ architecture: "layered", onDisk: ["arch-layered"], skillsDir: DIR }), [],
    "e o estado deste repositorio");
});

test("arquitetura nula NAO e defeito", () => {
  assert.deepEqual(architectureSkill({ architecture: null, onDisk: [], skillsDir: DIR }), [],
    "o install permite instalar sem escolher arquitetura, e medido: o projeto temporario saiu com null");
});

test("todo achado carrega arquivo, esperado e encontrado", () => {
  const todos = [
    ...orphanSkills({ declared: [], onDisk: ["x"], skillsDir: DIR }),
    ...missingSkills({ declared: ["y"], onDisk: [], skillsDir: DIR }),
    ...missingAgents({ declared: ["a.md"], exists: () => false }),
    ...architectureSkill({ architecture: "onion", onDisk: [], skillsDir: DIR }),
  ];
  assert.equal(todos.length, 4);
  for (const achado of todos) {
    assert.ok(achado.file && achado.expected && achado.found,
      `${achado.check}: sem os tres, quem le nao consegue agir sem abrir o codigo`);
    assert.equal(achado.severity, DEFECT);
  }
});

test("a linha que carrega token na fonte NAO conta como divergencia", () => {
  const fonte = "---\nname: x\n---\nOutput language: {{MGR_USER_LANGUAGE}}\nigual";
  const instalado = "---\nname: x\ncontext: fork\n---\nOutput language: pt-BR\nigual";
  assert.deepEqual(divergentBody({ name: "x", source: fonte, installed: instalado, file: "f", condicao: SKILL_DECLARADA }), [],
    "o install resolve o token por construcao; compara-la acusaria 100% das instalacoes, inclusive as recem-feitas");
});

test("linha SEM token que difere e achado", () => {
  const fonte = "---\nname: x\n---\nlinha original";
  const instalado = "---\nname: x\n---\nlinha trocada";
  const [achado] = divergentBody({ name: "x", source: fonte, installed: instalado, file: "f", condicao: SKILL_DECLARADA });
  assert.equal(achado.check, "divergent-body");
  assert.match(achado.found, /a partir da linha 1/, "a primeira linha do corpo e a linha 1, nao a 2");
});

test("instalacao recem-feita NAO tem corpo divergente em skill nenhuma", () => {
  const repo = instalacaoLimpa();
  try {
    const instaladas = readdirSync(`${repo}/.claude/skills`).filter((nome) => nome !== "_shared");
    const divergem = instaladas.filter((nome) => divergentBody({
      name: nome,
      source: readFileSync(`skills/${nome}/SKILL.md`, "utf8"),
      installed: readFileSync(`${repo}/.claude/skills/${nome}/SKILL.md`, "utf8"),
      file: nome,
      condicao: SKILL_DECLARADA,
    }).length > 0);
    assert.deepEqual(divergem, [],
      "o metodo antigo acusava 7 de 7 aqui, so porque o install resolve token; pular a linha com token e o que corrigiu isso");
    assert.ok(instaladas.length >= 8, `a fixture tem de instalar de verdade, e instalou ${instaladas.length}`);
  } finally {
    descartar(repo);
  }
});

test("a divergencia reporta a PRIMEIRA linha, nao a contagem", () => {
  const fonte = "---\nn: x\n---\nigual\nSECAO NOVA\nresto";
  const instalado = "---\nn: x\n---\nigual\nresto";
  const [achado] = divergentBody({ name: "x", source: fonte, installed: instalado, file: "f", condicao: SKILL_DECLARADA });
  assert.match(achado.found, /a partir da linha 2/,
    "um bloco inserido desloca o indice: contar daria numero inflado, medido em 116 para uma secao a mais");
});

test("divergencia de corpo NOMEIA o comando que a resolve", () => {
  const [achado] = divergentBody({ name: "x", source: "a\nb", installed: "a\nc", file: "f", condicao: SKILL_DECLARADA });
  assert.equal(achado.fix, FIX_UPDATE,
    "a P0.3 mediu que o update restaura o corpo; a CA-8 cobra o comando exato, e dizer que nao ha correcao seria falso");
});

test("com o manifesto atras do pacote a comparacao de corpo se declara INDISPONIVEL", () => {
  const [achado] = bodyCheckAvailability({ manifestVersion: "1.0.0", packageVersion: "1.1.0", file: "m" });
  assert.equal(achado.check, "divergent-body");
  assert.equal(achado.severity, UNAVAILABLE,
    "instalacao velha divergir e o estado ESPERADO; chamar isso de defeito inverte a CA-4 e da o alarme mais grave ao caso normal");
  assert.equal(achado.fix, FIX_UPDATE);
});

test("com as versoes iguais a comparacao de corpo fica disponivel", () => {
  assert.deepEqual(bodyCheckAvailability({ manifestVersion: "1.0.0", packageVersion: "1.0.0", file: "m" }), [],
    "versoes iguais e corpo divergente e adulteracao ou install parcial, e ai o alarme e devido");
});

test("com as versoes iguais a disponibilidade de fonte compartilhada e garantida", () => {
  assert.deepEqual(sharedCheckAvailability({ manifestVersion: "1.0.0", packageVersion: "1.0.0", file: "m" }), [],
    "versoes iguais indicam que manifesto e pacote estao em sincronia; fontes compartilhadas disponiveis");
});

test("com o manifesto atras do pacote a disponibilidade de fonte compartilhada se declara INDISPONIVEL", () => {
  const [achado] = sharedCheckAvailability({ manifestVersion: "1.0.0", packageVersion: "1.1.0", file: "m" });
  assert.equal(achado.check, "missing-shared");
  assert.equal(achado.severity, UNAVAILABLE,
    "manifesto atras e o estado ESPERADO de instalacao recem-atualizada; chamar isso de defeito deixaria quase todo projeto vermelho");
  assert.equal(achado.fix, FIX_UPDATE);
});

test("o achado de indisponibilidade de fonte compartilhada e um mesmo havendo varias fontes", () => {
  const [achado] = sharedCheckAvailability({ manifestVersion: "1.0.0", packageVersion: "1.1.0", file: "m" });
  assert.equal(achado.severity, UNAVAILABLE,
    "a causa e uma so (manifesto velho); dois alarmes para o mesmo fato seria ruido, nao um por fonte");
});

test("token que sobrou no instalado e achado, e nomeia qual", () => {
  const [achado] = unresolvedTokens({ installed: "x {{MGR_LAWS}} y {{MGR_LAWS}}", file: "f", condicao: SKILL_DECLARADA });
  assert.equal(achado.found, "{{MGR_LAWS}}", "repetido nao vira dois achados, e quem le precisa saber qual token sobrou");
  assert.equal(achado.fix, FIX_UPDATE);
});

test("instalado sem token NAO e achado", () => {
  assert.deepEqual(unresolvedTokens({ installed: "nada aqui", file: "f", condicao: SKILL_DECLARADA }), [],
    "e o estado deste repositorio e o da instalacao recem-feita: zero tokens sobrando");
});

test("manifesto atras do pacote e AVISO, nao defeito", () => {
  const [achado] = staleInstall({ manifestVersion: "0.7.0-beta.9", packageVersion: "0.7.0-beta.10", file: "m" });
  assert.equal(achado.severity, WARNING,
    "e o estado normal de quem nao rodou update; trata-lo como defeito deixaria o comando vermelho em quase todo projeto");
  assert.equal(achado.expected, "a versao do pacote, 0.7.0-beta.10");
  assert.equal(achado.found, "0.7.0-beta.9");
});

test("versoes iguais NAO produzem achado", () => {
  assert.deepEqual(staleInstall({ manifestVersion: "1.0.0", packageVersion: "1.0.0", file: "m" }), [],
    "e o que a instalacao recem-feita produz, medido no P0");
});

const hookCom = (comando) => ({ SessionStart: [{ hooks: [{ type: "command", command: comando }] }] });

test("hook apontando para binario inexistente e achado", () => {
  const [achado] = brokenHooks({ hooks: hookCom('node "/nao/existe/mgr.js"'), exists: () => false, file: "s" });
  assert.equal(achado.check, "broken-hook");
  assert.match(achado.found, /\/nao\/existe\/mgr\.js nao existe/);
  assert.match(achado.expected, /SessionStart/, "sem o evento, quem le nao sabe qual hook conferir");
});

test("hook apontando para binario que existe NAO e achado", () => {
  assert.deepEqual(brokenHooks({ hooks: hookCom('node "/existe/mgr.js"'), exists: () => true, file: "s" }), [],
    "e o estado deste repositorio: o SessionStart resolve");
});

test("comando de hook sem caminho entre aspas nao produz achado", () => {
  assert.deepEqual(brokenHooks({ hooks: hookCom("echo oi"), exists: () => false, file: "s" }), [],
    "acusar comando que nao invoca binario do metodo seria reclamar do que nao e nosso");
});

test("hook ausente no arquivo nao produz achado", () => {
  assert.deepEqual(brokenHooks({ hooks: undefined, exists: () => false, file: "s" }), []);
});

test("hook de instalacao recem-feita resolve", () => {
  const repo = instalacaoLimpa();
  try {
    const arquivo = `${repo}/.claude/settings.local.json`;
    if (!existsSync(arquivo)) return;
    const { hooks } = JSON.parse(readFileSync(arquivo, "utf8"));
    assert.deepEqual(brokenHooks({ hooks, exists: (caminho) => existsSync(caminho), file: "s" }), [],
      "o caminho e absoluto e de maquina: o install tem de escreve-lo apontando para binario que existe");
  } finally {
    descartar(repo);
  }
});

test("sem lockfile a verificacao se declara INDISPONIVEL, e isso nao e defeito", () => {
  const [achado] = lockfileDrift({ lockfile: null, installedPlugins: [], diff, file: "m" });
  assert.equal(achado.severity, UNAVAILABLE,
    "o lockfile so existe onde ha skill plugavel, e a maioria dos projetos nao tem");
  assert.notEqual(achado.severity, DEFECT);
});

test("plugin travado e nao instalado e achado, e reusa o diff do lockfile", () => {
  const [achado] = lockfileDrift({ lockfile: { skills: { "@mgr/junit-clean": {} } }, installedPlugins: [], diff, file: "m" });
  assert.equal(achado.found, "ausente");
  assert.equal(achado.fix, FIX_RESTORE);
  assert.match(achado.expected, /@mgr\/junit-clean/);
});

test("plugin em disco e fora do lockfile NAO vira achado aqui", () => {
  assert.deepEqual(lockfileDrift({ lockfile: { skills: {} }, installedPlugins: ["@mgr/x"], diff, file: "m" }), [],
    "quem reporta pasta em disco fora do declarado e orphan-skill; dois alarmes para o mesmo fato e o que a RN-3 proibe");
});

test("plugin travado e ausente do disco e defeito, e nomeia o comando", () => {
  const [achado] = lockfileDrift({ lockfile: { skills: { "@mgr/x": {} } }, installedPlugins: [], diff, file: "m" });
  assert.equal(achado.found, "ausente");
  assert.equal(achado.fix, FIX_RESTORE);
});

test("lockfile e disco batendo NAO produzem achado", () => {
  assert.deepEqual(lockfileDrift({ lockfile: { skills: { "@mgr/x": {} } }, installedPlugins: ["@mgr/x"], diff, file: "m" }), []);
});

test("projeto sem instalacao do metodo devolve outcome proprio, nao erro", () => {
  const resultado = diagnose("/tmp/nao-existe-projeto-algum");
  assert.equal(resultado.outcome, NO_INSTALL);
  assert.deepEqual(resultado.findings, [], "sem manifesto nao ha o que comparar, e isso nao e defeito");
});

test("diagnose acha cada defeito plantado na fixture", () => {
  const repo = instalacaoComDefeitos();
  try {
    const { outcome, findings, checks } = diagnose(repo);
    assert.equal(outcome, AUDITED);
    assert.equal(checks, CHECKS.length, "a lista e FECHADA: mudar o numero aqui exige decidir, nao descobrir depois");
    const porTipo = (nome) => findings.filter(({ check }) => check === nome);
    assert.equal(porTipo("orphan-skill").length, 1, `a fixture planta ${ORFA} fora do manifesto, e so ela`);
    assert.equal(porTipo("broken-hook").length, 1, "a fixture aponta o SessionStart para um binario que nao existe");
    assert.equal(porTipo("stale-install").length, 1, `a fixture poe ${VERSAO_VELHA} no manifesto contra a versao do pacote`);
    const corpo = porTipo("divergent-body");
    assert.equal(corpo.length, 1, "com o manifesto atras do pacote a comparacao e UMA declaracao, nao um alarme por skill");
    assert.equal(corpo[0].severity, UNAVAILABLE, "atras do pacote ela nao separa velho de adulterado");
  } finally {
    descartar(repo);
  }
});

test("o manifesto atras do pacote entra como AVISO e nao faz bloquear sozinho", () => {
  const repo = instalacaoComDefeitos();
  const soAviso = { findings: diagnose(repo).findings.filter(({ check }) => check === "stale-install") };
  descartar(repo);
  assert.equal(hasDefect(soAviso), false,
    "instalacao velha e o estado normal de quem nao rodou update; bloquear por isso deixaria quase todo projeto vermelho");
});

test("hasDefect ignora indisponivel", () => {
  assert.equal(hasDefect({ findings: [{ severity: "unavailable" }, { severity: "warning" }] }), false);
  assert.equal(hasDefect({ findings: [{ severity: "unavailable" }, { severity: DEFECT }] }), true);
});

test("diagnose NAO escreve nada em disco", () => {
  const repo = instalacaoComDefeitos();
  const estado = () => readdirSync(`${repo}/.claude/skills`).sort().join("|")
    + readFileSync(`${repo}/.mgr-core/manifest.json`, "utf8")
    + readFileSync(`${repo}/.claude/settings.local.json`, "utf8");
  const antes = estado();
  diagnose(repo);
  const depois = estado();
  descartar(repo);
  assert.equal(depois, antes,
    "nao ha --fix e o comando e diagnostico: a garantia e nao escrever, nao apenas nao escrever sem confirmacao");
});

test("toda verificacao declara remediacao ou a razao de nao haver", () => {
  const repo = instalacaoComDefeitos();
  const { findings } = diagnose(repo);
  descartar(repo);
  for (const achado of findings) {
    const temRemediacao = typeof achado.fix === "string" && achado.fix.length > 0;
    assert.ok(temRemediacao || achado.fix === null,
      `${achado.check}: fica sem as duas coisas, e o CA-8 exige uma`);
  }
  const semCorrecao = findings.filter(({ fix }) => fix === null).map(({ check }) => check);
  assert.ok(semCorrecao.includes("orphan-skill"),
    "a orfa nao tem correcao segura: na 0.6.0-beta.1 o remove apagou a skill do proprio metodo");
});

test("com um motor a saida do diagnose continua identica", () => {
  const repo = instalacaoLimpa();
  try {
    const { outcome, findings, checks } = diagnose(repo);
    assert.equal(outcome, AUDITED, "instalacao limpa de um motor sai auditado");
    assert.deepEqual(findings.filter(({ severity }) => severity !== UNAVAILABLE), [],
      "instalacao limpa de um motor nao ganha defeito nem aviso ao passar a iterar por motor");
    assert.equal(checks, CHECKS.length, "a contagem de verificacoes nao mudou");
  } finally {
    descartar(repo);
  }
});

test("com dois motores defeito plantado no segundo diretorio e acusado", () => {
  const repo = instalacaoComDefeitosDoisMotores();
  try {
    const { outcome, findings } = diagnose(repo);
    assert.equal(outcome, AUDITED, "instalacao com defeito sai auditado");
    const tokensBuscando = findings.filter(({ check }) => check === "unresolved-token");
    assert.ok(tokensBuscando.length > 0, "defeito plantado no segundo motor foi acusado");
    const achado = tokensBuscando[0];
    assert.match(achado.file, /\.github[/\\]skills/,
      "o file aponta para o segundo diretorio onde o defeito foi plantado");
    assert.match(achado.found, /MGR_UNRESOLVED/, "nomeia qual token ficou nao resolvido");
  } finally {
    descartar(repo);
  }
});

test("instalacao limpa de dois motores nao ganha achado de corpo", () => {
  const repo = instalacaoLimpaDoisMotores();
  try {
    const corpos = diagnose(repo).findings.filter(({ check, severity }) => check === "divergent-body"
      && severity !== UNAVAILABLE);
    assert.deepEqual(corpos, [],
      "cada motor transforma a skill do gate do seu jeito; comparar contra a fonte crua acusaria "
      + "toda instalacao limpa daquele motor");
  } finally {
    descartar(repo);
  }
});

test("a derivacao do gate de review esta travada contra o instalador", () => {
  const repo = instalacaoLimpaDoisMotores();
  try {
    const manifesto = JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8"));
    for (const engine of manifesto.engines) {
      const arquivoDoAgente = engineDescriptors.get(engine).agentFile(catalog.REVIEW_GATE.agent);
      assert.ok(manifesto.agents.some((caminho) => path.basename(caminho) === arquivoDoAgente),
        "o doctor DERIVA o gate da presenca deste arquivo porque o manifesto nao o grava; se o "
        + "instalador deixar de instalar o agente junto do gate, o doctor passa a julgar errado "
        + "em silencio e e esta assercao que tem de reprovar");
      const instalada = readFileSync(
        path.join(repo, engine === "copilot" ? ".github/skills" : ".claude/skills",
          catalog.REVIEW_GATE.skill, "SKILL.md"), "utf8");
      const daFonte = readFileSync(path.join(bundle.skillsDir(), catalog.REVIEW_GATE.skill, "SKILL.md"), "utf8");
      assert.notEqual(instalada, daFonte,
        "o gate ligado tem de transformar a skill instalada; se nao transformar, a derivacao acima "
        + "perde o sentido");
    }
  } finally {
    descartar(repo);
  }
});

test("CHECKS tem exatamente 10 entradas com id unico", () => {
  assert.equal(CHECKS.length, 10, "registro de verificacoes tem dez entradas e nada mais");
  const ids = CHECKS.map(({ id }) => id);
  const idsUnicos = new Set(ids);
  assert.equal(idsUnicos.size, 10, "cada id do registro deve ser unico");
});

test("diagnose devolve contagem derivada do registro CHECKS", () => {
  const repo = instalacaoLimpa();
  try {
    const { checks } = diagnose(repo);
    assert.equal(checks, CHECKS.length, "a contagem deve ser derivada do registro, nao escrita no codigo");
  } finally {
    descartar(repo);
  }
});

test("instalacao limpa produz zero achado de missing-shared", () => {
  const repo = instalacaoLimpa();
  try {
    const { findings } = diagnose(repo);
    const achados = findings.filter(({ check }) => check === "missing-shared");
    assert.deepEqual(achados, [], "fontes compartilhadas exigidas estao presentes na instalacao limpa");
  } finally {
    descartar(repo);
  }
});

test("instalacao limpa produz zero achado de token nao resolvido em _shared/", () => {
  const repo = instalacaoLimpa();
  try {
    const { findings } = diagnose(repo);
    const arquivosDeSuaFonte = findings
      .filter(({ check, file }) => check === "unresolved-token" && file.includes("_shared"))
      .map(({ file }) => file);
    assert.deepEqual(arquivosDeSuaFonte, [], "tokens em _shared/ sao resolvidos no install");
  } finally {
    descartar(repo);
  }
});

test("instalacao limpa produz zero achado de corpo divergente em _shared/", () => {
  const repo = instalacaoLimpa();
  try {
    const { findings } = diagnose(repo);
    const corposEmShared = findings
      .filter(({ check, file, severity }) => check === "divergent-body" && file.includes("_shared") && severity !== UNAVAILABLE)
      .map(({ file }) => file);
    assert.deepEqual(corposEmShared, [], "corpo em _shared/ bate com a fonte na instalacao limpa");
  } finally {
    descartar(repo);
  }
});

test("com manifesto atras do pacote missing-shared e indisponivel", () => {
  const repo = instalacaoComDefeitos();
  try {
    const { findings } = diagnose(repo);
    const compartilhado = findings.filter(({ check }) => check === "missing-shared");
    assert.equal(compartilhado.length, 1, "um unico achado, nao um por motor ou fonte");
    assert.equal(compartilhado[0].severity, UNAVAILABLE,
      "manifesto atras e o estado ESPERADO; separar indisponivel de defeito e o que a RN-3 pede");
    assert.equal(compartilhado[0].file, ".mgr-core/manifest.json",
      "o achado tem de apontar o artefato de que a mensagem fala; apontava `_shared`, que nao e "
      + "caminho, e a correcao foi DECLARADA numa fatia anterior sem ser aplicada — sem esta "
      + "assercao, reverter o valor deixa a suite verde de novo");
  } finally {
    descartar(repo);
  }
});

test("com manifesto atras do pacote hasDefect nao e bloqueado pelo achado de missing-shared", () => {
  const repo = instalacaoComDefeitos();
  try {
    const soCompartilhado = { findings: diagnose(repo).findings.filter(({ check }) => check === "missing-shared") };
    assert.equal(hasDefect(soCompartilhado), false,
      "indisponivel nao e defeito, e quem so tem esse achado nao bloqueia");
  } finally {
    descartar(repo);
  }
});

test("a frase do divergent-body serve para skill e para fonte compartilhada", () => {
  const daSkill = divergentBody({
    name: "spec-create", source: "---\nx: 1\n---\num\n", installed: "---\nx: 1\n---\ndois\n",
    file: ".claude/skills/spec-create/SKILL.md",
    condicao: SKILL_DECLARADA,
  })[0];
  assert.equal(daSkill.expected, "o corpo de spec-create como o pacote o traz",
    "a frase perdeu a palavra skill de proposito: ela tambem descreve fonte compartilhada, que nao e skill");

  const daFonte = divergentBody({
    name: "_shared/laws/execution-laws.md", source: "um\n", installed: "dois\n",
    file: ".claude/skills/_shared/laws/execution-laws.md",
    condicao: FONTE_COMPARTILHADA,
  })[0];
  assert.ok(!daFonte.expected.includes("skill"),
    "chamar de skill um arquivo de _shared/ seria mentira na cara de quem le o relatorio");
});

test("corpo divergente com skill orfa nao tem remediacao", () => {
  const [achado] = divergentBody({
    name: "orfa", source: "a\nb", installed: "a\nc", file: "f",
    condicao: SKILL_ORFA,
  });
  assert.equal(achado.fix, NO_FIX, "mgr update nao alcanca o que nao esta no manifesto");
});

test("corpo divergente com skill declarada tem remediacao", () => {
  const [achado] = divergentBody({
    name: "declarada", source: "a\nb", installed: "a\nc", file: "f",
    condicao: SKILL_DECLARADA,
  });
  assert.equal(achado.fix, FIX_UPDATE, "mgr update alcanca skill declarada");
});

test("corpo divergente com fonte compartilhada tem remediacao", () => {
  const [achado] = divergentBody({
    name: "_shared/laws/execution-laws.md", source: "a\nb", installed: "a\nc", file: "f",
    condicao: FONTE_COMPARTILHADA,
  });
  assert.equal(achado.fix, FIX_UPDATE, "mgr update alcanca fonte compartilhada");
});

test("token sobrando com skill orfa nao tem remediacao", () => {
  const [achado] = unresolvedTokens({
    installed: "x {{MGR_FIXTURE}}", file: "f",
    condicao: SKILL_ORFA,
  });
  assert.equal(achado.fix, NO_FIX, "mgr update nao alcanca o que nao esta no manifesto");
});

test("token sobrando com skill declarada tem remediacao", () => {
  const [achado] = unresolvedTokens({
    installed: "x {{MGR_FIXTURE}}", file: "f",
    condicao: SKILL_DECLARADA,
  });
  assert.equal(achado.fix, FIX_UPDATE, "mgr update alcanca skill declarada");
});

test("condicao ausente lanca em divergentBody", () => {
  assert.throws(
    () => divergentBody({
      name: "x", source: "a\nb", installed: "a\nc", file: "f",
      condicao: undefined,
    }),
    /condicao invalida/,
    "deve lancar erro especifico mencionando os tres valores validos"
  );
});

test("condicao desconhecida lanca em divergentBody", () => {
  assert.throws(
    () => divergentBody({
      name: "x", source: "a\nb", installed: "a\nc", file: "f",
      condicao: "nao-existe",
    }),
    /condicao invalida/,
    "deve lancar erro especifico mencionando os tres valores validos"
  );
});

test("condicao ausente lanca em unresolvedTokens", () => {
  assert.throws(
    () => unresolvedTokens({
      installed: "x {{MGR_FIXTURE}}", file: "f",
      condicao: undefined,
    }),
    /condicao invalida/,
    "deve lancar erro especifico mencionando os tres valores validos"
  );
});

test("condicao desconhecida lanca em unresolvedTokens", () => {
  assert.throws(
    () => unresolvedTokens({
      installed: "x {{MGR_FIXTURE}}", file: "f",
      condicao: "nao-existe",
    }),
    /condicao invalida/,
    "deve lancar erro especifico mencionando os tres valores validos"
  );
});

test("charter apagada do primeiro motor e achado como missing-shared", () => {
  const repo = instalacaoLimpaDoisMotores();
  try {
    apagarFonteCompartilhada(repo, ".claude/skills", catalog.CHARTER_INSTALLED);
    const { findings } = diagnose(repo);
    const achados = findings.filter(({ check }) => check === "missing-shared");
    assert.equal(achados.length, 1, "apagar uma fonte compartilhada gera exatamente um achado");
    assert.equal(achados[0].severity, DEFECT);
    assert.match(achados[0].file, /\.claude[/\\]skills[/\\]_shared[/\\]charter[/\\]core-principles\.md/,
      "o arquivo aponta o caminho correto da fonte no motor");
    assert.equal(achados[0].fix, FIX_UPDATE, "a correcao e mgr update");
  } finally {
    descartar(repo);
  }
});

test("token nao resolvido em laws do segundo motor e achado", () => {
  const repo = instalacaoLimpaDoisMotores();
  try {
    plantarTokenEmShared(repo, ".github/skills", catalog.LAWS_INSTALLED);
    const { findings } = diagnose(repo);
    const achados = findings.filter(({ check }) => check === "unresolved-token");
    assert.ok(achados.length > 0, "plantar token nao resolvido gera achado");
    const emShared = achados.find(({ file }) => file.includes("_shared") && file.includes("laws"));
    assert.ok(emShared, "um dos achados aponta para o arquivo em .github/skills/_shared/laws/");
    assert.match(emShared.found, /MGR_FIXTURE/, "nomeia qual token ficou nao resolvido");
  } finally {
    descartar(repo);
  }
});

test("corpo alterado em quality do primeiro motor e achado como divergent-body", () => {
  const repo = instalacaoLimpaDoisMotores();
  try {
    alterarCorpoEmShared(repo, ".claude/skills", catalog.QUALITY_INSTALLED);
    const { findings } = diagnose(repo);
    const achados = findings.filter(({ check, severity }) => check === "divergent-body" && severity !== UNAVAILABLE);
    assert.ok(achados.some(({ file }) => file.includes("_shared") && file.includes("quality")),
      "alterar uma linha gera achado de corpo divergente apontando aquele arquivo");
  } finally {
    descartar(repo);
  }
});

test("instalacao limpa de dois motores nao ganha achado de corpo em _shared/ mesmo para execution-laws", () => {
  const repo = instalacaoLimpaDoisMotores();
  try {
    const { findings } = diagnose(repo);
    const corposEmSharedDefectivos = findings
      .filter(({ check, file, severity }) => check === "divergent-body" && file.includes("_shared") && severity === DEFECT);
    assert.deepEqual(corposEmSharedDefectivos, [],
      "comparar sem pular a linha do token acusaria toda instalacao limpa; inclusive para execution-laws.md "
      + "cuja fonte do pacote tem {{MGR_CHARTER}} que o install resolve");
  } finally {
    descartar(repo);
  }
});

test("com as tres mutacoes juntas o diagnose encontra achados dos tres tipos", () => {
  const repo = instalacaoLimpaDoisMotores();
  try {
    apagarFonteCompartilhada(repo, ".claude/skills", catalog.CHARTER_INSTALLED);
    plantarTokenEmShared(repo, ".github/skills", catalog.LAWS_INSTALLED);
    alterarCorpoEmShared(repo, ".claude/skills", catalog.QUALITY_INSTALLED);
    const { findings } = diagnose(repo);
    assert.ok(hasDefect({ findings }), "com tres mutacoes o resultado e defectivo");
    const temMissing = findings.some(({ check }) => check === "missing-shared");
    const temToken = findings.some(({ check }) => check === "unresolved-token");
    const temCorpo = findings.some(({ check, severity }) => check === "divergent-body" && severity !== UNAVAILABLE);
    assert.ok(temMissing && temToken && temCorpo,
      "todos os tres tipos de achado estao presentes");
  } finally {
    descartar(repo);
  }
});

test("token em _shared/ continua defeito com o manifesto atrás do pacote", () => {
  const repo = instalacaoLimpa();
  try {
    const manifesto = path.join(repo, ".mgr-core", "manifest.json");
    const dados = JSON.parse(readFileSync(manifesto, "utf8"));
    writeFileSync(manifesto, JSON.stringify({ ...dados, version: VERSAO_VELHA }, null, 2));
    plantarTokenEmShared(repo, ".claude/skills", catalog.LAWS_INSTALLED);

    const { findings } = diagnose(repo);
    const token = findings.filter(({ check }) => check === "unresolved-token");
    assert.ok(token.length > 0,
      "o escudo de versão cobre existência e corpo, nunca token: subárvore pode faltar numa versão "
      + "antiga, mas token sobrando significa que o install falhou em resolvê-lo, e isso não é "
      + "legítimo em versão alguma");
    assert.ok(token.every(({ severity }) => severity === DEFECT),
      "e sai como defeito, não como indisponível");

    const ausencia = findings.filter(({ check }) => check === "missing-shared");
    assert.ok(ausencia.every(({ severity }) => severity === UNAVAILABLE),
      "a existência, essa sim, fica indisponível: é o estado esperado de quem não rodou mgr update");
  } finally {
    descartar(repo);
  }
});

test("manifesto sem motor reconhecido cai para os skillsDirs em vez de não conferir nada", () => {
  const repo = instalacaoLimpa();
  try {
    const manifesto = path.join(repo, ".mgr-core", "manifest.json");
    const dados = JSON.parse(readFileSync(manifesto, "utf8"));
    writeFileSync(manifesto, JSON.stringify({ ...dados, engines: ["custom"] }, null, 2));
    plantarTokenEmShared(repo, ".claude/skills", catalog.LAWS_INSTALLED);

    const token = diagnose(repo).findings.filter(({ check }) => check === "unresolved-token");
    assert.ok(token.length > 0,
      "instalação com --skills-dir grava engines: ['custom'], e manifesto legado pode não ter "
      + "engines: filtrar só por motor conhecido deixava a lista de árvores vazia e o comando saía "
      + "0 sem conferir nada, que é a degradação medida em 2026-09-24 contra o commit de partida");
  } finally {
    descartar(repo);
  }
});

test("skill órfã com corpo divergente não tem remediação no diagnose", () => {
  const repo = instalacaoLimpa();
  try {
    const skills = path.join(repo, ".claude", "skills");
    const declaradas = JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8")).skills;
    cpSync(path.join(skills, declaradas[0]), path.join(skills, ORFA), { recursive: true });
    const alvo = path.join(skills, ORFA, "SKILL.md");
    writeFileSync(alvo, `${readFileSync(alvo, "utf8")}\nlinha que nao existe na fonte\n`);

    const corpo = diagnose(repo).findings
      .filter(({ check, file }) => check === "divergent-body" && file.includes(ORFA));
    assert.equal(corpo.length, 1,
      "a instalacao e limpa e o manifesto esta na versao do pacote, entao a comparacao de corpo roda "
      + "e o achado sai por skill; com manifesto atrasado ela sairia indisponivel e este caso nao "
      + "afirmaria nada");
    assert.equal(corpo[0].fix, null,
      "o mgr update so re-sincroniza o que o manifesto declara, entao nomear o comando aqui mandaria "
      + "a pessoa gastar uma acao que nao resolve");
  } finally {
    descartar(repo);
  }
});

test("skill declarada com corpo divergente mantém a remediação no diagnose", () => {
  const repo = instalacaoLimpa();
  try {
    const declaradas = JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8")).skills;
    const alvo = path.join(repo, ".claude", "skills", declaradas[0], "SKILL.md");
    writeFileSync(alvo, `${readFileSync(alvo, "utf8")}\nlinha que nao existe na fonte\n`);

    const corpo = diagnose(repo).findings
      .filter(({ check, file }) => check === "divergent-body" && file.includes(declaradas[0]));
    assert.equal(corpo.length, 1, "o mesmo estado da orfa, mudando so a declaracao no manifesto");
    assert.equal(corpo[0].fix, FIX_UPDATE,
      "e o negativo do caso anterior: a fatia so muda o caso orfao, e aqui o comando foi medido e "
      + "resolve");
  } finally {
    descartar(repo);
  }
});

test("CHECKS tem exatamente dez entradas com id único", () => {
  assert.equal(CHECKS.length, 10, "registro tem dez entradas de verificacoes");
  const ids = CHECKS.map(({ id }) => id);
  const idsUnicos = new Set(ids);
  assert.equal(idsUnicos.size, 10, "cada id do registro deve ser único");
});

test("toda entrada de CHECKS tem remediacoes com pelo menos um item", () => {
  for (const entrada of CHECKS) {
    assert.ok(entrada.remediacoes && Array.isArray(entrada.remediacoes) && entrada.remediacoes.length > 0,
      `${entrada.id}: deve ter array remediacoes com pelo menos um item`);
  }
});

test("soma de todas as condicoes em remediacoes e exatamente dezessete", () => {
  const totalCondicoes = CHECKS.reduce((soma, entrada) => soma + entrada.remediacoes.length, 0);
  assert.equal(totalCondicoes, 17,
    "a tabela D-2 do plano declara dezessete condicoes no total");
});

test("todo item de remediacao tem condicao, fix e prova obrigatorios", () => {
  for (const entrada of CHECKS) {
    for (const item of entrada.remediacoes) {
      assert.ok(item.condicao, `${entrada.id}: item sem condicao`);
      assert.ok(item.fix !== undefined, `${entrada.id}: item sem fix`);
      assert.ok(item.prova, `${entrada.id}: item sem prova`);
    }
  }
});

test("toda remediacao tem prova em um dos quatro valores possíveis", () => {
  const validos = [PROVA_FUNCIONA, PROVA_NAO_FUNCIONA, PROVA_NAO_MEDIDA, SEM_REMEDIACAO];
  for (const entrada of CHECKS) {
    for (const item of entrada.remediacoes) {
      assert.ok(validos.includes(item.prova),
        `${entrada.id}/${item.condicao}: prova "${item.prova}" não é um dos quatro valores`);
    }
  }
});

test("remediacao com PROVA_NAO_MEDIDA ou PROVA_NAO_FUNCIONA tem razao não vazia", () => {
  for (const entrada of CHECKS) {
    for (const item of entrada.remediacoes) {
      if (item.prova === PROVA_NAO_FUNCIONA || item.prova === PROVA_NAO_MEDIDA) {
        assert.ok(item.razao && item.razao.length > 0,
          `${entrada.id}/${item.condicao}: prova=${item.prova} exige razao não vazia`);
      }
    }
  }
});

test("remediacao com PROVA_NAO_FUNCIONA tem candidato definido", () => {
  for (const entrada of CHECKS) {
    for (const item of entrada.remediacoes) {
      if (item.prova === PROVA_NAO_FUNCIONA) {
        assert.ok(item.candidato !== undefined,
          `${entrada.id}/${item.condicao}: PROVA_NAO_FUNCIONA exige candidato`);
      }
    }
  }
});

test("coerência: fix é nulo quando prova é SEM_REMEDIACAO ou PROVA_NAO_FUNCIONA", () => {
  for (const entrada of CHECKS) {
    for (const item of entrada.remediacoes) {
      if (item.prova === SEM_REMEDIACAO || item.prova === PROVA_NAO_FUNCIONA) {
        assert.equal(item.fix, null,
          `${entrada.id}/${item.condicao}: prova=${item.prova} exige fix nulo`);
      }
    }
  }
});

test("coerência: fix não é nulo quando prova é PROVA_FUNCIONA", () => {
  for (const entrada of CHECKS) {
    for (const item of entrada.remediacoes) {
      if (item.prova === PROVA_FUNCIONA) {
        assert.ok(item.fix !== null && typeof item.fix === "string" && item.fix.length > 0,
          `${entrada.id}/${item.condicao}: PROVA_FUNCIONA exige fix não nulo`);
      }
    }
  }
});

test("órfã sem divergência e sem token não produz achado algum", () => {
  const corpo = "---\nx: 1\n---\nigual\n";
  assert.deepEqual(divergentBody({ name: "x", source: corpo, installed: corpo, file: "f", condicao: SKILL_ORFA }), [],
    "a condição não fabrica achado: ela só decide a remediação de um achado que já existia");
  assert.deepEqual(unresolvedTokens({ installed: "nada aqui", file: "f", condicao: SKILL_ORFA }), [],
    "o mesmo para token: sem token sobrando não há achado, seja a skill órfã ou declarada");
});
