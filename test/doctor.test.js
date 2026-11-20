import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFECT, FIX_RESTORE, FIX_UPDATE, NO_FIX, UNAVAILABLE, WARNING,
  SKILL_DECLARADA, SKILL_ORFA, SKILL_ORFA_SEM_PROVA, FONTE_COMPARTILHADA,
  PROVA_FUNCIONA, PROVA_NAO_FUNCIONA, PROVA_NAO_MEDIDA, SEM_REMEDIACAO,
  architectureSkill, bodyCheckAvailability, brokenHooks, divergentBody, lockfileDrift, missingAgents, missingShared, missingSkills,
  orphanSkills, runtimeBodies, runtimeLocations, sharedCheckAvailability, staleInstall, unresolvedTokens,
  AUDITED, NO_INSTALL, diagnose, hasDefect, CHECKS,
} from "../src/doctor.js";
import { INVALID_MANIFEST, blocks, manifestRemedyText } from "../src/doctor.js";
import path from "node:path";
import { Buffer } from "node:buffer";
import { diff } from "../src/lockfile.js";
import * as bundle from "../src/bundle.js";
import * as catalog from "../src/catalog.js";
import * as engineDescriptors from "../src/engines/index.js";
import { ORFA, VERSAO_VELHA, descartar, instalacaoComDefeitos, instalacaoComDefeitosDoisMotores, instalacaoLimpa, instalacaoLimpaDoisMotores, apagarFonteCompartilhada, plantarTokenEmShared, alterarCorpoEmShared, apagarRuntime, alterarVersaoDoRuntime, alterarUmByteDoRuntime, removerArquivoDoRuntime } from "./fixtures/instalacao.js";
import { layoutPorMotor } from "./fixtures/layout-por-motor.js";
import { tempDir } from "../scripts/lib/tmp.mjs";
import { manifestShapeProblems, readManifest, MANIFEST_NAME } from "../src/manifest.js";
import { problemText } from "../src/manifest.js";
import { UsageError } from "../src/errors.js";
import { getMessages } from "../src/messages.js";
import { renderText } from "../src/ui-text.js";
import { InvariantError } from "../src/errors.js";
import { findingText } from "../src/doctor.js";
import { runtimeVersioningCheck } from "../src/doctor.js";
import { FIELD_CATEGORY, fieldCategory, problemRemedy, DECLARATION_FLAGS, KNOWN_MODELS } from "../src/manifest.js";
import { readUserLanguage } from "../src/manifest.js";
import { renderError } from "../src/errors.js";

const DIR = ".claude/skills";

test("skill em disco fora do manifesto e achado", () => {
  const achados = orphanSkills({ declared: ["spec-init"], onDisk: ["spec-init", "junit-clean"], skillsDir: DIR });
  assert.equal(achados.length, 1);
  assert.equal(achados[0].check, "orphan-skill");
  assert.equal(achados[0].file, `${DIR}/junit-clean`);
  assert.equal(achados[0].found, "on disk and not in the manifest");
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

test("should name mgr update for orphans classified marked or distributed", () => {
  for (const classe of ["marked", "distributed"]) {
    const [achado] = orphanSkills({ declared: [], onDisk: ["x"], skillsDir: DIR, classOf: () => classe });
    assert.equal(achado.fix, FIX_UPDATE, `classe ${classe} e candidata do update`);
  }
});

test("should keep orphans classified unknown without remediation", () => {
  const [achado] = orphanSkills({ declared: [], onDisk: ["x"], skillsDir: DIR, classOf: () => "unknown" });
  assert.equal(achado.fix, NO_FIX);
});

test("should classify each orphan by its own name", () => {
  const achados = orphanSkills({
    declared: [], onDisk: ["a", "b"], skillsDir: DIR, classOf: (nome) => (nome === "a" ? "marked" : "unknown"),
  });
  assert.deepEqual(achados.map((a) => [a.file, a.fix]), [[`${DIR}/a`, FIX_UPDATE], [`${DIR}/b`, NO_FIX]]);
});

test("should declare consentimento only on the four PROVA_FUNCIONA entries new or changed by the F2", () => {
  const comConsentimento = CHECKS.flatMap(({ id, remediacoes }) => remediacoes
    .filter((r) => r.consentimento !== undefined).map((r) => [id, r.condicao, r.consentimento]));
  assert.deepEqual(comConsentimento, [
    ["orphan-skill", "marcada", "-y"], ["orphan-skill", "distribuida-sem-marca", "-y"],
    ["divergent-body", "skill-orfa", "-y"], ["unresolved-token", "skill-orfa", "-y"],
  ]);
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
  assert.equal(achados[0].expected, "present, because the installed set requires it");
  assert.equal(achados[0].found, "absent");
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
  assert.match(achado.found, /differs from line 1 of the body onward/, "a primeira linha do corpo e a linha 1, nao a 2");
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
  assert.match(achado.found, /differs from line 2 of the body onward/,
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
  assert.equal(achado.expected, "the package version, 0.7.0-beta.10");
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
  assert.match(achado.found, /\/nao\/existe\/mgr\.js does not exist/);
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
  assert.equal(achado.found, "absent");
  assert.equal(achado.fix, FIX_RESTORE);
  assert.match(achado.expected, /@mgr\/junit-clean/);
});

test("plugin em disco e fora do lockfile NAO vira achado aqui", () => {
  assert.deepEqual(lockfileDrift({ lockfile: { skills: {} }, installedPlugins: ["@mgr/x"], diff, file: "m" }), [],
    "quem reporta pasta em disco fora do declarado e orphan-skill; dois alarmes para o mesmo fato e o que a RN-3 proibe");
});

test("plugin travado e ausente do disco e defeito, e nomeia o comando", () => {
  const [achado] = lockfileDrift({ lockfile: { skills: { "@mgr/x": {} } }, installedPlugins: [], diff, file: "m" });
  assert.equal(achado.found, "absent");
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
  // Revisto pela D-5b (ADR-0024): a orfa plantada tem nome que o pacote distribui, entao e candidata e
  // o fix nomeia o update, que pergunta item a item. Orfa de origem desconhecida segue sem correcao,
  // afirmado nos testes de `orphanSkills` com `classOf` "unknown".
  const orfa = findings.find(({ check }) => check === "orphan-skill");
  assert.equal(orfa.fix, "mgr update",
    "orfa de nome distribuido e candidata: o update a oferece com consentimento, item a item");
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

test("CHECKS tem exatamente 12 entradas com id unico", () => {
  assert.equal(CHECKS.length, 12, "registro de verificacoes tem doze entradas e nada mais");
  const ids = CHECKS.map(({ id }) => id);
  const idsUnicos = new Set(ids);
  assert.equal(idsUnicos.size, 12, "cada id do registro deve ser unico");
  assert.ok(ids.includes("runtime-version"), "a verificacao nova esta no registro");
});

test("as 10 verificacoes antigas mantem remediacao e severidade de antes", () => {
  const antes = {
    "orphan-skill": [["em-disco", null, SEM_REMEDIACAO], ["marcada", FIX_UPDATE, PROVA_FUNCIONA],
      ["distribuida-sem-marca", FIX_UPDATE, PROVA_FUNCIONA]],
    "missing-skill": [["declarada-ausente", FIX_UPDATE, PROVA_FUNCIONA]],
    "missing-agent": [["declarado-ausente", FIX_UPDATE, PROVA_FUNCIONA]],
    "architecture-skill": [["skill-ausente", FIX_UPDATE, PROVA_FUNCIONA],
      ["arquitetura-fora-de-forma", null, SEM_REMEDIACAO]],
    "divergent-body": [["skill-declarada", FIX_UPDATE, PROVA_FUNCIONA], ["skill-orfa", FIX_UPDATE, PROVA_FUNCIONA],
      ["skill-orfa-sem-prova", null, SEM_REMEDIACAO],
      ["fonte-compartilhada", FIX_UPDATE, PROVA_FUNCIONA], ["manifesto-atrasado", FIX_UPDATE, PROVA_FUNCIONA]],
    "unresolved-token": [["skill-declarada", FIX_UPDATE, PROVA_FUNCIONA], ["skill-orfa", FIX_UPDATE, PROVA_FUNCIONA],
      ["skill-orfa-sem-prova", null, SEM_REMEDIACAO], ["fonte-compartilhada", FIX_UPDATE, PROVA_FUNCIONA]],
    "stale-install": [["manifesto-atrasado", FIX_UPDATE, PROVA_FUNCIONA]],
    "broken-hook": [["binario-ausente", null, SEM_REMEDIACAO]],
    "lockfile-drift": [["sem-lockfile", null, SEM_REMEDIACAO], ["travado-ausente", "mgr install", PROVA_NAO_MEDIDA]],
    "missing-shared": [["fonte-ausente", FIX_UPDATE, PROVA_FUNCIONA], ["manifesto-atrasado", FIX_UPDATE, PROVA_FUNCIONA]],
  };
  for (const [id, esperado] of Object.entries(antes)) {
    const entrada = CHECKS.find((c) => c.id === id);
    assert.ok(entrada, `${id} segue no registro`);
    assert.deepEqual(entrada.remediacoes.map((r) => [r.condicao, r.fix, r.prova]), esperado,
      `${id}: condicoes, fix e prova iguais as de antes`);
  }
});

const doRuntime = (findings) => findings.filter((f) => f.check === "runtime-version");
const corposDoRuntime = (findings) => findings.filter((f) => f.check === "divergent-body"
  && f.file.includes(path.join(".mgr-core", "runtime")));

const BIN_MGR = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
const rodarMgr = (comando, repo) => {
  const home = tempDir("mgr-doctor-home-");
  try {
    return spawnSync("node", [BIN_MGR, comando, repo], { env: { ...process.env, HOME: home }, encoding: "utf8" });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
};
const arquivosDe = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? arquivosDe(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const impressaoDaArvore = (raiz) => Object.fromEntries(arquivosDe(raiz).sort().map((f) =>
  [path.relative(raiz, f), readFileSync(f, "base64")]));

test("should flag a deleted core runtime as one runtime-version defect at .mgr-core/runtime and exit 1", () => {
  const repo = instalacaoLimpa();
  try {
    apagarRuntime(repo);
    const achados = doRuntime(diagnose(repo).findings);
    assert.equal(achados.length, 1);
    assert.equal(achados[0].severity, DEFECT);
    assert.equal(achados[0].file, path.join(".mgr-core", "runtime"));
    assert.equal(achados[0].fix, FIX_UPDATE);
    assert.equal(rodarMgr("doctor", repo).status, 1);
  } finally {
    descartar(repo);
  }
});

test("should clear runtime-version after mgr update restores the deleted core runtime", () => {
  const repo = instalacaoLimpa();
  try {
    apagarRuntime(repo);
    const atualizado = rodarMgr("update", repo);
    assert.equal(atualizado.status, 0, atualizado.stderr);
    assert.deepEqual(doRuntime(diagnose(repo).findings), []);
  } finally {
    descartar(repo);
  }
});

test("should warn and exit 0 when the core runtime version differs from the manifest", () => {
  const repo = instalacaoLimpa();
  try {
    alterarVersaoDoRuntime(repo, "0.0.0-copia");
    const achados = doRuntime(diagnose(repo).findings);
    assert.equal(achados.length, 1);
    assert.equal(achados[0].severity, WARNING);
    assert.equal(achados[0].file, path.join(".mgr-core", "runtime", "package.json"));
    assert.equal(rodarMgr("doctor", repo).status, 0);
  } finally {
    descartar(repo);
  }
});

test("should keep the per-engine layout free of runtime-version and change no byte of the tree", () => {
  const repo = instalacaoLimpa();
  try {
    layoutPorMotor(repo, { model: "self-contained-layered-config" });
    assert.ok(existsSync(path.join(repo, ".claude", "skills", "_shared", "mgr", "bin", "mgr-runtime.js")),
      "o layout por motor existe antes do doctor");
    const antes = impressaoDaArvore(repo);
    assert.deepEqual(doRuntime(diagnose(repo).findings), []);
    rodarMgr("doctor", repo);
    assert.deepEqual(impressaoDaArvore(repo), antes, "o doctor nao escreve em nada");
  } finally {
    descartar(repo);
  }
});

test("should locate the runtime at .mgr-core/runtime for the core model and per engine otherwise", () => {
  const repo = path.join(path.sep, "work", "proj");
  const arvores = [{ dir: path.join(repo, ".claude", "skills") }, { dir: path.join(repo, ".github", "skills") }];

  assert.deepEqual(runtimeLocations({ model: "self-contained-core-runtime" }, repo, arvores), {
    layout: "core",
    dirs: [path.join(repo, ".mgr-core", "runtime")],
  });
  assert.deepEqual(runtimeLocations({ model: "self-contained-layered-config" }, repo, arvores), {
    layout: "per-engine",
    dirs: [path.join(repo, ".claude", "skills", "_shared", "mgr"), path.join(repo, ".github", "skills", "_shared", "mgr")],
  });
});

test("runtime integro nao produz achado de runtime-version nem de divergent-body do runtime", () => {
  const repo = instalacaoLimpa();
  try {
    const { findings } = diagnose(repo);
    assert.deepEqual(doRuntime(findings), []);
    assert.deepEqual(corposDoRuntime(findings), []);
  } finally {
    descartar(repo);
  }
});

test("runtime ausente num motor acusa runtime-version como defeito e nenhum divergent-body do runtime", () => {
  const repo = instalacaoLimpa();
  try {
    apagarRuntime(repo);
    const { findings } = diagnose(repo);
    const achados = doRuntime(findings);
    assert.equal(achados.length, 1);
    assert.equal(achados[0].severity, DEFECT);
    assert.equal(achados[0].fix, FIX_UPDATE);
    assert.deepEqual(corposDoRuntime(findings), [], "ausencia e so da runtime-version");
  } finally {
    descartar(repo);
  }
});

test("bin/mgr-runtime.js ausente com o diretorio presente tambem e defeito de runtime-version", () => {
  const repo = instalacaoLimpa();
  try {
    removerArquivoDoRuntime(repo, "bin/mgr-runtime.js");
    const { findings } = diagnose(repo);
    const achados = doRuntime(findings);
    assert.equal(achados.length, 1);
    assert.equal(achados[0].severity, DEFECT);
    assert.deepEqual(corposDoRuntime(findings), [], "um fato, um alarme: a entrada ausente e so da runtime-version (D-14)");
  } finally {
    descartar(repo);
  }
});

test("package.json da copia ausente acusa runtime-version como aviso de versao ilegivel ou ausente", () => {
  const repo = instalacaoLimpa();
  try {
    removerArquivoDoRuntime(repo, "package.json");
    const achados = doRuntime(diagnose(repo).findings);
    assert.equal(achados.length, 1);
    assert.equal(achados[0].severity, WARNING);
    assert.equal(achados[0].found, "version unreadable or absent");
  } finally {
    descartar(repo);
  }
});

test("versao da copia diferente do manifesto acusa runtime-version como aviso", () => {
  const repo = instalacaoLimpa();
  try {
    alterarVersaoDoRuntime(repo, "0.0.0-copia");
    const { findings } = diagnose(repo);
    const achados = doRuntime(findings);
    assert.equal(achados.length, 1);
    assert.equal(achados[0].severity, WARNING);
    assert.equal(achados[0].found, "0.0.0-copia");
    assert.equal(achados[0].fix, FIX_UPDATE);
    assert.equal(hasDefect({ findings }), false, "aviso nao bloqueia");
  } finally {
    descartar(repo);
  }
});

test("um byte alterado num arquivo copiado do runtime acusa divergent-body naquele arquivo (D-14)", () => {
  const repo = instalacaoLimpa();
  try {
    alterarUmByteDoRuntime(repo, "src/catalog.js");
    const { findings } = diagnose(repo);
    const achados = corposDoRuntime(findings);
    assert.equal(achados.length, 1, "so o arquivo mutado");
    assert.equal(achados[0].file, path.join(".mgr-core", "runtime", "src", "catalog.js"));
    assert.equal(achados[0].severity, DEFECT);
    assert.equal(achados[0].fix, FIX_UPDATE);
    assert.deepEqual(doRuntime(findings), [], "o diretorio esta presente e a versao confere");
  } finally {
    descartar(repo);
  }
});

test("arquivo do runtime ausente com o diretorio presente acusa divergent-body com found ausente", () => {
  const repo = instalacaoLimpa();
  try {
    removerArquivoDoRuntime(repo, "src/detector.js");
    const achados = corposDoRuntime(diagnose(repo).findings);
    assert.equal(achados.length, 1);
    assert.equal(achados[0].found, "absent");
  } finally {
    descartar(repo);
  }
});

test("runtimeBodies nao acusa quando as copias sao identicas ao pacote", () => {
  const conteudoDoPacote = Buffer.from("igual");
  assert.deepEqual(runtimeBodies({ files: [{ rel: "a", file: "f", source: conteudoDoPacote, copy: Buffer.from("igual") }] }), []);
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
  assert.equal(daSkill.expected, "the body of spec-create as the package ships it",
    "a frase perdeu a palavra skill de proposito: ela tambem descreve fonte compartilhada, que nao e skill");

  const daFonte = divergentBody({
    name: "_shared/laws/execution-laws.md", source: "um\n", installed: "dois\n",
    file: ".claude/skills/_shared/laws/execution-laws.md",
    condicao: FONTE_COMPARTILHADA,
  })[0];
  assert.ok(!daFonte.expected.includes("skill"),
    "chamar de skill um arquivo de _shared/ seria mentira na cara de quem le o relatorio");
});

test("corpo divergente com skill orfa candidata nomeia mgr update", () => {
  const [achado] = divergentBody({
    name: "orfa", source: "a\nb", installed: "a\nc", file: "f",
    condicao: SKILL_ORFA,
  });
  assert.equal(achado.fix, FIX_UPDATE, "o update oferece remover a orfa candidata, com consentimento");
});

test("corpo divergente com skill orfa sem prova nao tem remediacao", () => {
  const [achado] = divergentBody({
    name: "orfa", source: "a\nb", installed: "a\nc", file: "f",
    condicao: SKILL_ORFA_SEM_PROVA,
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

test("token sobrando com skill orfa candidata nomeia mgr update", () => {
  const [achado] = unresolvedTokens({
    installed: "x {{MGR_FIXTURE}}", file: "f",
    condicao: SKILL_ORFA,
  });
  assert.equal(achado.fix, FIX_UPDATE, "o update oferece remover a orfa candidata, com consentimento");
});

test("token sobrando com skill orfa sem prova nao tem remediacao", () => {
  const [achado] = unresolvedTokens({
    installed: "x {{MGR_FIXTURE}}", file: "f",
    condicao: SKILL_ORFA_SEM_PROVA,
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

const erroDeCondicaoInvalida = (condicao) => (erro) => {
  const validas = [SKILL_DECLARADA, SKILL_ORFA, SKILL_ORFA_SEM_PROVA, FONTE_COMPARTILHADA].join(", ");
  assert.ok(erro instanceof InvariantError);
  assert.equal(erro.message, `invalid condition: "${condicao}"; valid values are ${validas}`);
  return true;
};

test("condicao ausente lanca em divergentBody", () => {
  assert.throws(
    () => divergentBody({
      name: "x", source: "a\nb", installed: "a\nc", file: "f",
      condicao: undefined,
    }),
    erroDeCondicaoInvalida(undefined),
    "deve lancar erro especifico mencionando os tres valores validos"
  );
});

test("condicao desconhecida lanca em divergentBody", () => {
  assert.throws(
    () => divergentBody({
      name: "x", source: "a\nb", installed: "a\nc", file: "f",
      condicao: "nao-existe",
    }),
    erroDeCondicaoInvalida("nao-existe"),
    "deve lancar erro especifico mencionando os tres valores validos"
  );
});

test("condicao ausente lanca em unresolvedTokens", () => {
  assert.throws(
    () => unresolvedTokens({
      installed: "x {{MGR_FIXTURE}}", file: "f",
      condicao: undefined,
    }),
    erroDeCondicaoInvalida(undefined),
    "deve lancar erro especifico mencionando os tres valores validos"
  );
});

test("condicao desconhecida lanca em unresolvedTokens", () => {
  assert.throws(
    () => unresolvedTokens({
      installed: "x {{MGR_FIXTURE}}", file: "f",
      condicao: "nao-existe",
    }),
    erroDeCondicaoInvalida("nao-existe"),
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

test("skill órfã candidata com corpo divergente nomeia o mgr update no diagnose", () => {
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
    assert.equal(corpo[0].fix, "mgr update",
      "D-5b (ADR-0024): a orfa tem nome que o pacote distribui, e o update converge oferecendo a "
      + "remocao item a item; antes da F2 o update so alcancava o declarado e o fix era null");
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

test("CHECKS tem exatamente doze entradas com id único", () => {
  assert.equal(CHECKS.length, 12, "registro tem doze entradas de verificacoes");
  const ids = CHECKS.map(({ id }) => id);
  const idsUnicos = new Set(ids);
  assert.equal(idsUnicos.size, 12, "cada id do registro deve ser único");
});

test("toda entrada de CHECKS tem remediacoes com pelo menos um item", () => {
  for (const entrada of CHECKS) {
    assert.ok(entrada.remediacoes && Array.isArray(entrada.remediacoes) && entrada.remediacoes.length > 0,
      `${entrada.id}: deve ter array remediacoes com pelo menos um item`);
  }
});

test("soma de todas as condicoes em remediacoes e exatamente vinte e sete", () => {
  const totalCondicoes = CHECKS.reduce((soma, entrada) => soma + entrada.remediacoes.length, 0);
  assert.equal(totalCondicoes, 27,
    "dezessete da tabela D-2, duas de runtime-version, as quatro da DT-14 da F2 (marcada, "
    + "distribuida-sem-marca e as duas skill-orfa-sem-prova), as tres de runtime-versioning e "
    + "a arquitetura-fora-de-forma do architecture-skill");
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

test("com sources null divergent-body e stale-install saem UM achado unavailable cada, com npx na versao do manifesto", () => {
  const repo = instalacaoLimpa();
  try {
    const versao = JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8")).version;
    const { outcome, findings } = diagnose(repo, { sources: null });
    assert.equal(outcome, AUDITED);
    for (const check of ["divergent-body", "stale-install"]) {
      const achados = findings.filter((f) => f.check === check);
      assert.equal(achados.length, 1, `${check}: um achado so, nao um por skill, motor ou arquivo`);
      assert.equal(achados[0].severity, UNAVAILABLE);
      assert.match(achados[0].found, /the package sources are not in the project/);
      assert.equal(achados[0].fix, `npx mgr-method@${versao} doctor`);
      assert.ok(achados[0].fix.startsWith("npx mgr-method@"));
    }
    assert.equal(hasDefect({ findings }), false, "sem fontes nao e defeito: falta o insumo");
  } finally {
    descartar(repo);
  }
});

test("com sources null as demais verificacoes rodam inteiras", () => {
  const repo = instalacaoLimpa();
  try {
    assert.deepEqual(doRuntime(diagnose(repo, { sources: null }).findings), [],
      "runtime-version nao depende das fontes e confere com o manifesto");

    const declaradas = JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8")).skills;
    rmSync(path.join(repo, ".claude", "skills", declaradas[0]), { recursive: true, force: true });
    apagarRuntime(repo);
    const { findings } = diagnose(repo, { sources: null });
    assert.equal(findings.filter((f) => f.check === "missing-skill" && f.severity === DEFECT).length, 1,
      "skill declarada e apagada continua acusada sem fontes");
    assert.equal(doRuntime(findings).filter((f) => f.severity === DEFECT).length, 1,
      "runtime ausente continua acusado sem fontes");
  } finally {
    descartar(repo);
  }
});

test("com sources null o corpo adulterado NAO e comparado e nada lanca", () => {
  const repo = instalacaoLimpa();
  try {
    const declaradas = JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8")).skills;
    const alvo = path.join(repo, ".claude", "skills", declaradas[0], "SKILL.md");
    writeFileSync(alvo, `${readFileSync(alvo, "utf8")}\nlinha que nao existe na fonte\n`);
    alterarUmByteDoRuntime(repo, "src/catalog.js");
    const { findings } = diagnose(repo, { sources: null });
    assert.deepEqual(findings.filter((f) => f.check === "divergent-body" && f.severity === DEFECT), [],
      "sem a fonte nao ha com o que comparar; o indisponivel declara isso");
  } finally {
    descartar(repo);
  }
});

test("sem sources o comportamento de hoje fica: fonte do pacote compara e acusa corpo adulterado", () => {
  const repo = instalacaoLimpa();
  try {
    const declaradas = JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8")).skills;
    const alvo = path.join(repo, ".claude", "skills", declaradas[0], "SKILL.md");
    writeFileSync(alvo, `${readFileSync(alvo, "utf8")}\nlinha que nao existe na fonte\n`);
    for (const opcoes of [undefined, {}, { sources: undefined }]) {
      const corpo = diagnose(repo, opcoes).findings
        .filter((f) => f.check === "divergent-body" && f.severity === DEFECT);
      assert.equal(corpo.length, 1);
    }
  } finally {
    descartar(repo);
  }
});

test("órfã sem divergência e sem token não produz achado algum", () => {
  const corpo = "---\nx: 1\n---\nigual\n";
  assert.deepEqual(divergentBody({ name: "x", source: corpo, installed: corpo, file: "f", condicao: SKILL_ORFA }), [],
    "a condição não fabrica achado: ela só decide a remediação de um achado que já existia");
  assert.deepEqual(unresolvedTokens({ installed: "nada aqui", file: "f", condicao: SKILL_ORFA }), [],
    "o mesmo para token: sem token sobrando não há achado, seja a skill órfã ou declarada");
});

const CAMPOS_ARRAY = ["skills", "skillsDirs", "engines", "agents"];
const FORMAS_NAO_ARRAY = [["objeto", { a: 1 }, "object"], ["string", "x", "string"], ["numero", 7, "number"], ["booleano", true, "boolean"]];
const comScope = (scope) => ({ engines: ["claude-code"], scope });
const VAZAMENTO = /is not a function|\.map|\.filter|undefined/;

test("should report a container problem when a skills, skillsDirs, engines or agents field is not an array", () => {
  for (const field of CAMPOS_ARRAY) {
    for (const [nome, valor, tipo] of FORMAS_NAO_ARRAY) {
      const problems = manifestShapeProblems({ [field]: valor });
      assert.equal(problems.length, 1, `${field} como ${nome} deve gerar exatamente um problema, senao o doctor repete o mesmo defeito`);
      assert.equal(problems[0].field, field);
      assert.equal(problems[0].kind, "container", `${field} como ${nome} quebra o consumidor que espera array`);
      assert.equal(problems[0].found, tipo, "o doctor deve dizer o tipo encontrado, nao o erro interno");
    }
  }
});

test("should not report a problem when a skills, skillsDirs, engines or agents field is absent or null", () => {
  assert.deepEqual(manifestShapeProblems({}), [], "campo ausente e estado legado tolerado pelos chamadores");
  for (const field of CAMPOS_ARRAY) {
    assert.deepEqual(manifestShapeProblems({ [field]: null }), [], `${field} null e estado legado tolerado pelos chamadores`);
  }
});

test("should report a scope problem for every non-valid scope form when a recognized engine is declared", () => {
  for (const [nome, valor, tipo] of [...FORMAS_NAO_ARRAY, ["null", null, "null"], ["ausente", undefined, "absent"]]) {
    const problems = manifestShapeProblems(comScope(valor));
    assert.equal(problems.length, 1, `scope ${nome} com motor reconhecido deve gerar um problema`);
    assert.equal(problems[0].field, "scope");
    assert.equal(problems[0].found, tipo, `scope ${nome} deve ser descrito pelo tipo`);
  }
});

test("should report found as absent when scope is missing and a recognized engine is declared", () => {
  const [problem] = manifestShapeProblems({ engines: ["claude-code"] });
  assert.equal(problem.found, "absent","ausente e a causa mais comum e deve ser nomeada como tal");
});

test("should accept every scope key declared by the claude-code descriptor", () => {
  for (const chave of Object.keys(engineDescriptors.get("claude-code").skillsDir)) {
    assert.deepEqual(manifestShapeProblems(comScope(chave)), [], `scope ${chave} e valido para o motor`);
  }
});

test("should report a scope problem when scope is a bogus string with a recognized engine", () => {
  const problems = manifestShapeProblems(comScope("bogus"));
  assert.equal(problems.length, 1);
  assert.equal(problems[0].field, "scope");
  assert.equal(problems[0].found, "string");
});

test("should not report a scope problem when no recognized engine is declared", () => {
  assert.deepEqual(manifestShapeProblems({ scope: "bogus" }), [], "sem engines o escopo nao tem descritor contra o que ser conferido");
  assert.deepEqual(manifestShapeProblems({ engines: ["custom"], scope: "bogus" }), [], "motor desconhecido nao tem descritor para julgar scope");
});

test("should list in scope allowed every key of the claude-code skillsDir descriptor", () => {
  const [problem] = manifestShapeProblems(comScope("bogus"));
  assert.equal(problem.expected, "scope-key");
  assert.deepEqual(problem.allowed, Object.keys(engineDescriptors.get("claude-code").skillsDir), "allowed deve oferecer as chaves do descritor, senao o doctor nao diz como corrigir");
});

test("should report element problems for non-string items in skillsDirs and agents", () => {
  for (const field of ["skillsDirs", "agents"]) {
    const problems = manifestShapeProblems({ [field]: [1] });
    assert.equal(problems.length, 1);
    assert.equal(problems[0].field, field);
    assert.equal(problems[0].kind, "element", `${field} com numero dentro quebra quem concatena caminho`);
  }
});

test("should report element for a non-string skill and unsafe-name for a traversal skill name", () => {
  assert.equal(manifestShapeProblems({ skills: [1] })[0].kind, "element");
  const [inseguro] = manifestShapeProblems({ skills: ["../x"] });
  assert.equal(inseguro.kind, "unsafe-name", "o nome da skill e concatenado a um diretorio removido com rmSync recursivo");
});

test("should not report an element problem for engines with a non-string item", () => {
  assert.deepEqual(manifestShapeProblems({ engines: [1] }), [], "engines desconhecido e filtrado pelo descritor, nao e defeito de forma");
});

test("should report exactly one root problem when the manifest is not an object", () => {
  for (const raiz of ["x", 7, [1, 2], null]) {
    const problems = manifestShapeProblems(raiz);
    assert.equal(problems.length, 1, `raiz ${JSON.stringify(raiz)} deve gerar um unico problema, sem varrer campos de algo que nao e objeto`);
    assert.equal(problems[0].kind, "root");
    assert.equal(problems[0].field, "manifest.json");
  }
});

test("should report only the engines problem when engines is not an array", () => {
  const problems = manifestShapeProblems({ engines: 7, scope: "bogus" });
  assert.deepEqual(problems.map((p) => p.field), ["engines"], "sem array de motores nao ha como julgar scope, e o defeito raiz e engines");
});

test("should report agentsDirs out of shape as a non-lethal derived problem", () => {
  for (const valor of [{ a: 1 }, "x", 7, true, [1]]) {
    const problems = manifestShapeProblems({ agentsDirs: valor });
    assert.equal(problems.length, 1, `agentsDirs ${JSON.stringify(valor)} deve gerar um unico problema`);
    assert.equal(problems[0].field, "agentsDirs");
    assert.equal(problems[0].kind, Array.isArray(valor) ? "element" : "container");
  }
  assert.deepEqual(manifestShapeProblems({ agentsDirs: null }), [], "agentsDirs null e tolerado");
});

test("should never leak variable names or array method names in found", () => {
  const manifestos = [
    ...CAMPOS_ARRAY.flatMap((f) => FORMAS_NAO_ARRAY.map(([, v]) => ({ [f]: v }))),
    { skillsDirs: [1] }, { agents: [1] }, { skills: [1] }, { skills: ["../x"] },
    ...[...FORMAS_NAO_ARRAY.map(([, v]) => v), null, undefined, "bogus"].map(comScope),
    "x", 7, [1, 2], null,
  ];
  for (const manifesto of manifestos) {
    for (const problem of manifestShapeProblems(manifesto)) {
      assert.doesNotMatch(String(problem.found), VAZAMENTO, `found e lido por humanos e nao pode expor internals: ${JSON.stringify(problem)}`);
    }
  }
});

const lancaComManifesto = (conteudo, mensagem) => {
  const dir = tempDir("mgr-manifest-shape-");
  try {
    writeFileSync(path.join(dir, MANIFEST_NAME), JSON.stringify(conteudo));
    assert.throws(() => readManifest(dir), { message: mensagem });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("should throw an invalid skills error from readManifest when skills is not an array", () => {
  lancaComManifesto({ skills: { a: 1 } }, 'invalid "skills" in manifest.json: {"a":1} (expected an array of skill names)');
  lancaComManifesto({ skills: "x" }, 'invalid "skills" in manifest.json: "x" (expected an array of skill names)');
  lancaComManifesto({ skills: null }, 'invalid "skills" in manifest.json: null (expected an array of skill names)');
});

test("should throw an unsafe skill name error from readManifest for a traversal or non-string skill", () => {
  lancaComManifesto({ skills: ["../x"] }, 'unsafe skill name in manifest.json: "../x"');
  lancaComManifesto({ skills: [1] }, "unsafe skill name in manifest.json: 1");
});

test("should not throw from readManifest for malformed fields other than skills", () => {
  for (const conteudo of [{ skillsDirs: "x" }, { agents: { a: 1 } }, { engines: 7 }, { engines: ["claude-code"] }]) {
    const dir = tempDir("mgr-manifest-shape-");
    try {
      writeFileSync(path.join(dir, MANIFEST_NAME), JSON.stringify(conteudo));
      assert.doesNotThrow(() => readManifest(dir), `${JSON.stringify(conteudo)} e problema do doctor, nao motivo para o install abortar`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

const caminhoManifesto = (repo) => path.join(repo, ".mgr-core", MANIFEST_NAME);
const gravarManifesto = (repo, conteudo) => writeFileSync(caminhoManifesto(repo), conteudo);
const gravarManifestoJson = (repo, conteudo) => gravarManifesto(repo, JSON.stringify(conteudo));

test("should return invalid-manifest as unreadable with no problems when the manifest is not JSON or is empty", () => {
  const repo = instalacaoLimpa();
  try {
    for (const conteudo of ["{ nao e json", ""]) {
      gravarManifesto(repo, conteudo);
      const { outcome, manifest } = diagnose(repo);
      assert.equal(outcome, INVALID_MANIFEST, `${JSON.stringify(conteudo)} nao parseia e nao pode virar NO_INSTALL nem auditoria`);
      assert.equal(manifest.state, "unreadable", "arquivo ilegivel precisa ser distinguido de arquivo lido com forma errada");
      assert.deepEqual(manifest.problems, [], "nao ha campo a apontar quando nada foi lido");
    }
  } finally {
    descartar(repo);
  }
});

test("should return invalid-manifest as read with a single root problem when the JSON root is not an object", () => {
  const repo = instalacaoLimpa();
  try {
    for (const conteudo of [null, "x", 7, [1, 2]]) {
      gravarManifestoJson(repo, conteudo);
      const { outcome, manifest } = diagnose(repo);
      assert.equal(outcome, INVALID_MANIFEST, `${JSON.stringify(conteudo)} e JSON valido mas nao e manifesto`);
      assert.equal(manifest.state, "read", "o arquivo foi lido; o defeito e a forma");
      assert.equal(manifest.problems.length, 1, "uma raiz errada e um problema so, sem derivados");
      assert.equal(manifest.problems[0].kind, "root", "a raiz e o que esta errado");
    }
  } finally {
    descartar(repo);
  }
});

test("should return invalid-manifest naming the field with no findings and a remedy that follows the field category for each lethal shape", () => {
  const repo = instalacaoLimpa();
  try {
    const instalado = JSON.parse(readFileSync(caminhoManifesto(repo), "utf8"));
    const casos = [
      ["skills", { skills: {} }, false],
      ["skillsDirs", { skillsDirs: "x" }, true],
      ["engines", { engines: 7 }, false],
      ["agents", { agents: true }, true],
      ["scope", { scope: "bogus" }, true],
      ["skillsDirs", { skillsDirs: [1] }, true],
      ["agents", { agents: [1] }, true],
    ];
    for (const [campo, alteracao, derivado] of casos) {
      gravarManifestoJson(repo, { ...instalado, ...alteracao });
      const rotulo = JSON.stringify(alteracao);
      const comFontes = diagnose(repo);
      const semFontes = diagnose(repo, { sources: null });
      assert.equal(comFontes.outcome, INVALID_MANIFEST, `${rotulo} estoura o doctor e tem de ser barrado na porta`);
      assert.equal(comFontes.checks, 0, "nenhuma verificacao roda sobre manifesto invalido");
      assert.deepEqual(comFontes.findings, [], "achado sobre manifesto invalido seria ruido");
      assert.ok(comFontes.manifest.problems.some((problema) => problema.field === campo), `o problema precisa nomear ${campo} para o time achar o que consertar`);
      assert.equal(comFontes.manifest.fix, derivado ? FIX_UPDATE : null,
        `${campo}: so o campo derivado e recalculado pelo update; registro e declaracao ficam a mao`);
      assert.equal(comFontes.manifest.prova, derivado ? PROVA_FUNCIONA : SEM_REMEDIACAO,
        `${campo}: a prova acompanha o fix`);
      assert.deepEqual(semFontes, comFontes, `${rotulo}: a porta vale com e sem sources null`);
    }
  } finally {
    descartar(repo);
  }
});

test("should keep auditing with findings when only skills elements, engines elements or agentsDirs are malformed", () => {
  const repo = instalacaoLimpa();
  try {
    const instalado = JSON.parse(readFileSync(caminhoManifesto(repo), "utf8"));
    const casos = [
      { skills: ["../x"] },
      { skills: ["arch-layered", "../x"] },
      { skills: [1] },
      { engines: [1] },
      { agentsDirs: "x" },
    ];
    for (const alteracao of casos) {
      gravarManifestoJson(repo, { ...instalado, ...alteracao });
      const resultado = diagnose(repo);
      const rotulo = JSON.stringify(alteracao);
      assert.equal(resultado.outcome, AUDITED, `${rotulo} nao e letal: bloquear aqui degradaria o que o doctor ja relata`);
      assert.ok(resultado.findings.length > 0, `${rotulo} tem de continuar produzindo achados`);
    }
  } finally {
    descartar(repo);
  }
});

const diagnosticaComAlteracao = (repo, alteracao) => {
  const instalado = JSON.parse(readFileSync(caminhoManifesto(repo), "utf8"));
  gravarManifestoJson(repo, { ...instalado, ...alteracao });
  return diagnose(repo);
};

test("should attach the remedy of each problem to the manifest block", () => {
  const repo = instalacaoLimpa();
  try {
    const { manifest } = diagnosticaComAlteracao(repo, { agentsDirs: "x", allSkills: "sim", userLanguage: 7 });
    const remedios = Object.fromEntries(manifest.problems.map(({ field, remedy }) => [field, remedy]));
    assert.deepEqual(remedios, { agentsDirs: "update", userLanguage: "by-hand", allSkills: "by-hand" },
      "o derivado e recalculado pelo update e a declaracao fica a mao: o remedio sai de problemRemedy e nao de uma lista do doctor");
  } finally {
    descartar(repo);
  }
});

test("should promise update in the aggregated fix when every problem is recalculated by it", () => {
  const repo = instalacaoLimpa();
  try {
    const { manifest } = diagnosticaComAlteracao(repo, { skillsDirs: "x", agents: true });
    assert.ok(manifest.problems.length > 0 && manifest.problems.every(({ remedy }) => remedy === "update"));
    assert.equal(manifest.fix, FIX_UPDATE, "so derivados: o update conserta tudo");
    assert.equal(manifest.prova, PROVA_FUNCIONA, "a prova acompanha o fix prometido");
  } finally {
    descartar(repo);
  }
});

test("should not promise update in the aggregated fix when one problem is by hand", () => {
  const repo = instalacaoLimpa();
  try {
    const { manifest } = diagnosticaComAlteracao(repo, { skillsDirs: "x", engines: 7 });
    assert.deepEqual(manifest.problems.map(({ field, remedy }) => [field, remedy]),
      [["skillsDirs", "update"], ["engines", "by-hand"]],
      "o caso e misto de verdade: um derivado e um a mao");
    assert.equal(manifest.fix, null, "o update recusa enquanto houver declaracao fora de forma");
    assert.equal(manifest.prova, SEM_REMEDIACAO);
  } finally {
    descartar(repo);
  }
});

test("should not promise update in the aggregated fix when the manifest is unreadable", () => {
  const repo = instalacaoLimpa();
  try {
    gravarManifesto(repo, "{ nao e json");
    const { manifest } = diagnose(repo);
    assert.deepEqual(manifest.problems, []);
    assert.equal(manifest.fix, null, "sem problema lido nao ha o que o update recalcule");
    assert.equal(manifest.prova, SEM_REMEDIACAO);
  } finally {
    descartar(repo);
  }
});

test("should describe the closing lines as update recalculates when every problem is derived", () => {
  const bloco = { problems: [{ field: "agents", remedy: "update" }], fix: FIX_UPDATE };
  assert.deepEqual(manifestRemedyText(bloco), [
    { key: "doctorManifestoUpdateRecalcula", params: [] },
    { key: "doctorResolvaCom", params: [FIX_UPDATE] },
  ]);
});

test("should describe the closing lines naming only the by-hand fields when the problems are mixed", () => {
  const bloco = {
    problems: [
      { field: "agents", remedy: "update" },
      { field: "engines", remedy: "by-hand" },
      { field: "engines", remedy: "by-hand" },
    ],
    fix: null,
  };
  assert.deepEqual(manifestRemedyText(bloco), [
    { key: "doctorManifestoMaoDepoisUpdate", params: ["`engines`"] },
  ], "os campos a mao vem primeiro, sem repeticao, e o derivado nao e nomeado");
});

test("should describe the closing lines as no automatic remedy when nothing is derived or unreadable", () => {
  const todosAMao = { problems: [{ field: "engines", remedy: "by-hand" }], fix: null };
  const ilegivel = { problems: [], fix: null };
  const esperado = [{ key: "doctorSemRemediacaoAutomatica", params: [] }];
  assert.deepEqual(manifestRemedyText(todosAMao), esperado);
  assert.deepEqual(manifestRemedyText(ilegivel), esperado);
});

test("should audit and block with the manifest block for each non-lethal out-of-shape field", () => {
  const repo = instalacaoLimpa();
  try {
    const casos = [
      ["optional", { optional: {} }],
      ["allSkills", { allSkills: "sim" }],
      ["userLanguage", { userLanguage: 7 }],
      ["agentsDirs", { agentsDirs: "x" }],
    ];
    for (const [campo, alteracao] of casos) {
      const resultado = diagnosticaComAlteracao(repo, alteracao);
      assert.equal(resultado.outcome, AUDITED, `${campo} fora de forma nao impede a auditoria`);
      assert.equal(resultado.checks, CHECKS.length, `${campo}: as verificacoes rodam todas`);
      assert.ok(resultado.manifest, `${campo}: o bloco manifest relata o defeito`);
      assert.ok(resultado.manifest.problems.some((problema) => problema.field === campo), `${campo}: o bloco nomeia o campo`);
      assert.equal(blocks(resultado), true, `${campo}: o problema de forma bloqueia mesmo sem achado de defeito`);
    }
  } finally {
    descartar(repo);
  }
});

test("should not return a manifest block when the manifest is in shape", () => {
  const repo = instalacaoLimpa();
  try {
    const resultado = diagnose(repo);
    assert.equal(resultado.outcome, AUDITED);
    assert.equal("manifest" in resultado, false, "manifesto valido nao ganha bloco de reparo");
  } finally {
    descartar(repo);
  }
});

test("should leave architecture-skill without fix when the declared architecture is out of the catalog", () => {
  const repo = instalacaoLimpa();
  try {
    const { findings } = diagnosticaComAlteracao(repo, { architecture: "mvc" });
    const achados = findings.filter((f) => f.check === "architecture-skill");
    assert.equal(achados.length, 1);
    assert.equal(achados[0].fix, null, "o update recusa arquitetura fora do catalogo: prometer o comando seria falso");
  } finally {
    descartar(repo);
  }
});

test("should name update for architecture-skill when the architecture is valid and its skill is missing", () => {
  const repo = instalacaoLimpa();
  try {
    const instalado = JSON.parse(readFileSync(caminhoManifesto(repo), "utf8"));
    assert.ok(instalado.architecture, "a instalacao limpa declara arquitetura");
    const skill = path.join(repo, instalado.skillsDirs[0], `arch-${instalado.architecture}`);
    rmSync(skill, { recursive: true, force: true });
    const achados = diagnose(repo).findings.filter((f) => f.check === "architecture-skill");
    assert.equal(achados.length, 1);
    assert.equal(achados[0].fix, FIX_UPDATE, "arquitetura do catalogo com skill ausente e o caso que o update repara");
  } finally {
    descartar(repo);
  }
});

test("should audit a legacy manifest with only model and version and report no defect", () => {
  const repo = instalacaoLimpa();
  try {
    const { model, version } = JSON.parse(readFileSync(caminhoManifesto(repo), "utf8"));
    gravarManifestoJson(repo, { model, version });
    const resultado = diagnose(repo);
    assert.equal(resultado.outcome, AUDITED, "manifesto legado e instalacao antiga valida, nao invalida");
    assert.equal(hasDefect(resultado), false, "instalacao antiga nao pode ficar vermelha so por ser antiga");
  } finally {
    descartar(repo);
  }
});

test("should block on an invalid manifest and not on no-install", () => {
  const invalido = { outcome: INVALID_MANIFEST, findings: [], checks: 0 };
  const semInstalacao = { outcome: NO_INSTALL, findings: [], checks: 0 };
  assert.equal(blocks(invalido), true, "manifesto invalido sem achado nao pode passar como saudavel");
  assert.equal(blocks(semInstalacao), false, "projeto sem o metodo nao e defeito");
});

test("should make blocks equal to hasDefect for an audited result", () => {
  const comDefeito = { outcome: AUDITED, findings: [{ severity: DEFECT }], checks: 1 };
  const semDefeito = { outcome: AUDITED, findings: [{ severity: WARNING }], checks: 1 };
  assert.equal(blocks(comDefeito), hasDefect(comDefeito), "para auditoria o bloqueio continua sendo o defeito");
  assert.equal(blocks(comDefeito), true, "defeito bloqueia");
  assert.equal(blocks(semDefeito), hasDefect(semDefeito), "para auditoria o bloqueio continua sendo o defeito");
  assert.equal(blocks(semDefeito), false, "aviso nao bloqueia");
});

test("should keep the closed list of checks at twelve", () => {
  assert.equal(CHECKS.length, 12, "a lista e FECHADA: mudar o numero exige decidir, nao descobrir depois");
});

const EXPECTED_FECHADO = ["object", "array-of-skill-names", "array-of-strings", "safe-skill-name", "scope-key"];
const FOUND_FECHADO = ["object", "string", "number", "boolean", "null", "array", "absent", "non-string-element", "unsafe-name"];
const MANIFESTOS_COM_PROBLEMA = [
  "x", null,
  { skills: {} }, { skillsDirs: "x" }, { engines: 7 }, { agents: true },
  { skills: [1] }, { skills: ["../x"] }, { skillsDirs: [1] }, { agents: [1] },
  comScope("bogus"), comScope(undefined), comScope(7),
];
const todosOsProblemas = () => MANIFESTOS_COM_PROBLEMA.flatMap((m) => manifestShapeProblems(m));

test("should emit only expected and found codes from the closed vocabulary, with position and allowed in their own kinds", () => {
  const problems = todosOsProblemas();
  assert.ok(problems.length >= MANIFESTOS_COM_PROBLEMA.length);
  for (const problem of problems) {
    assert.ok(EXPECTED_FECHADO.includes(problem.expected), `expected fora do vocabulario: ${JSON.stringify(problem)}`);
    assert.ok(FOUND_FECHADO.includes(problem.found), `found fora do vocabulario: ${JSON.stringify(problem)}`);
    assert.equal("position" in problem, problem.kind === "element" || problem.kind === "unsafe-name", `position fora de lugar: ${JSON.stringify(problem)}`);
    assert.equal("allowed" in problem, problem.field === "scope", `allowed fora de lugar: ${JSON.stringify(problem)}`);
  }
});

test("should make scope allowed equal to the claude-code skillsDir keys", () => {
  const [problem] = manifestShapeProblems(comScope(7));
  assert.deepEqual(problem.allowed, Object.keys(engineDescriptors.get("claude-code").skillsDir));
});

const AMOSTRAS_DE_TEXTO = {
  manifestProblemRoot: { field: MANIFEST_NAME, kind: "root", expected: "object", found: "string" },
  manifestProblemSkillsList: { field: "skills", kind: "container", expected: "array-of-skill-names", found: "object" },
  manifestProblemStringList: { field: "agents", kind: "container", expected: "array-of-strings", found: "boolean" },
  manifestProblemElement: { field: "agents", kind: "element", expected: "array-of-strings", found: "non-string-element", position: 0 },
  manifestProblemUnsafeName: { field: "skills", kind: "unsafe-name", expected: "safe-skill-name", found: "unsafe-name", position: 1 },
  manifestProblemScope: { field: "scope", kind: "container", expected: "scope-key", found: "string", allowed: ["project", "user"] },
  manifestProblemScopeAbsent: { field: "scope", kind: "container", expected: "scope-key", found: "absent", allowed: ["project", "user"] },
};

test("should pick one message key per problem combination", () => {
  for (const [chave, problem] of Object.entries(AMOSTRAS_DE_TEXTO)) {
    assert.equal(problemText(problem).key, chave);
  }
});

test("should render every returned key in en and pt-BR without throwing", () => {
  for (const problem of Object.values(AMOSTRAS_DE_TEXTO)) {
    const descritor = problemText(problem);
    for (const lang of ["en", "pt-BR"]) {
      const tabela = getMessages(lang);
      assert.ok(descritor.key in tabela, `${descritor.key} ausente em ${lang}`);
      assert.doesNotThrow(() => renderText(tabela, descritor));
      assert.ok(renderText(tabela, descritor).length > 0);
    }
  }
});

test("should keep the pt-BR sentence free of english form words and the en sentence free of portuguese ones", () => {
  for (const problem of [...Object.values(AMOSTRAS_DE_TEXTO), ...todosOsProblemas()]) {
    const descritor = problemText(problem);
    assert.doesNotMatch(renderText(getMessages("pt-BR"), descritor), /\b(expected|found)\b/);
    assert.doesNotMatch(renderText(getMessages("en"), descritor), /\b(esperado|esperados|encontrado)\b/);
  }
});

test("should throw a UsageError from readManifest with the english message of before", () => {
  const casos = [
    [{ skills: { a: 1 } }, 'invalid "skills" in manifest.json: {"a":1} (expected an array of skill names)'],
    [{ skills: ["../x"] }, 'unsafe skill name in manifest.json: "../x"'],
  ];
  for (const [conteudo, mensagem] of casos) {
    const dir = tempDir("mgr-manifest-usage-");
    try {
      writeFileSync(path.join(dir, MANIFEST_NAME), JSON.stringify(conteudo));
      assert.throws(() => readManifest(dir), (erro) => erro instanceof UsageError && erro.message === mensagem);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

const achadosDaFabrica = () => {
  const versaoVelha = { manifestVersion: "1.0.0", packageVersion: "1.1.0", file: "m" };
  const lockfile = { skills: { "@mgr/x": {} } };
  const achados = [
    ...orphanSkills({ declared: [], onDisk: ["x"], skillsDir: DIR }),
    ...missingSkills({ declared: ["y"], onDisk: [], skillsDir: DIR }),
    ...missingAgents({ declared: ["a.md"], exists: () => false }),
    ...missingShared({ expected: [{ installed: ["_shared", "laws", "execution-laws.md"] }], exists: () => false, skillsDir: DIR }),
    ...architectureSkill({ architecture: "layered", onDisk: [], skillsDir: DIR }),
    ...divergentBody({ name: "x", source: "a\nb", installed: "a\nc", file: "f", condicao: SKILL_DECLARADA }),
    ...unresolvedTokens({ installed: "x {{MGR_FIXTURE}}", file: "f", condicao: SKILL_DECLARADA }),
    ...bodyCheckAvailability(versaoVelha),
    ...sharedCheckAvailability(versaoVelha),
    ...staleInstall(versaoVelha),
    ...brokenHooks({ hooks: hookCom('node "/nao/existe/mgr.js"'), exists: () => false, file: "s" }),
    ...lockfileDrift({ lockfile: null, installedPlugins: [], diff, file: "m" }),
    ...lockfileDrift({ lockfile, installedPlugins: [], diff, file: "m" }),
    ...runtimeVersioningCheck({ choice: { state: "invalid", value: "Versioned" }, ignoreState: "current", file: "i", configFile: "c" }),
    ...runtimeVersioningCheck({ choice: { state: "absent" }, ignoreState: "absent", file: "i", configFile: "c" }),
    ...runtimeVersioningCheck({ choice: { state: "absent" }, ignoreState: "outdated", file: "i", configFile: "c" }),
    ...runtimeVersioningCheck({ choice: { state: "recorded", value: "versioned" }, ignoreState: "current", file: "i", configFile: "c" }),
    ...runtimeVersioningCheck({ choice: { state: "invalid", value: 42 }, ignoreState: "absent", file: "i", configFile: "c" }),
  ];
  const comDefeitos = instalacaoComDefeitos();
  const semRuntime = instalacaoLimpa();
  const semPackageJson = instalacaoLimpa();
  const semDetector = instalacaoLimpa();
  const semFontes = instalacaoLimpa();
  try {
    achados.push(...diagnose(comDefeitos).findings);
    apagarRuntime(semRuntime);
    achados.push(...diagnose(semRuntime).findings);
    removerArquivoDoRuntime(semPackageJson, "package.json");
    achados.push(...diagnose(semPackageJson).findings);
    removerArquivoDoRuntime(semDetector, "src/detector.js");
    achados.push(...diagnose(semDetector).findings);
    achados.push(...diagnose(semFontes, { sources: null }).findings);
  } finally {
    [comDefeitos, semRuntime, semPackageJson, semDetector, semFontes].forEach(descartar);
  }
  return achados;
};

test("should return the descriptors of every finding that came from the factory", () => {
  const achados = achadosDaFabrica();
  assert.ok(achados.length > 0);
  for (const achado of achados) {
    const { expected, found } = findingText(achado);
    for (const descritor of [expected, found]) {
      assert.ok(typeof descritor.key === "string" || "value" in descritor, `${achado.check}: sem descritor`);
    }
  }
});

test("should throw InvariantError from findingText for a spread copy of a finding", () => {
  const [achado] = orphanSkills({ declared: [], onDisk: ["x"], skillsDir: DIR });
  assert.throws(() => findingText({ ...achado }), InvariantError);
});

test("should render the en descriptor of each finding equal to its expected and found", () => {
  const tabela = getMessages("en");
  for (const achado of achadosDaFabrica()) {
    const { expected, found } = findingText(achado);
    assert.equal(achado.expected, renderText(tabela, expected), `${achado.check}: expected`);
    assert.equal(achado.found, renderText(tabela, found), `${achado.check}: found`);
  }
});

test("should refuse a corrupt manifest with a UsageError that names the file and keeps the parser text out", () => {
  const dir = tempDir("mgr-manifest-json-");
  try {
    writeFileSync(path.join(dir, MANIFEST_NAME), "{ nao e json", "utf8");
    assert.throws(() => readManifest(dir), (error) => {
      assert.ok(error instanceof UsageError, "a corrupt manifest is the user's file to fix, not an MGR defect");
      assert.equal(error.key, "fileNotJson");
      assert.match(error.message, /manifest\.json is not valid JSON/);
      assert.doesNotMatch(error.message, /Expected property name|Unexpected token/, "the platform text stays out of the shown sentence (P-10)");
      assert.ok(error.cause instanceof SyntaxError, "the original parser error stays as the cause, for diagnosis");
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const CATEGORIA_POR_CAMPO = {
  scope: FIELD_CATEGORY.DERIVED,
  agents: FIELD_CATEGORY.DERIVED,
  agentsDirs: FIELD_CATEGORY.DERIVED,
  skillsDirs: FIELD_CATEGORY.DERIVED,
  skills: FIELD_CATEGORY.RECORD,
  engines: FIELD_CATEGORY.DECLARATION,
  architecture: FIELD_CATEGORY.DECLARATION,
  language: FIELD_CATEGORY.DECLARATION,
  userLanguage: FIELD_CATEGORY.DECLARATION,
  optional: FIELD_CATEGORY.DECLARATION,
  allSkills: FIELD_CATEGORY.DECLARATION,
};

test("should classify each of the eleven manifest fields in its category", () => {
  assert.equal(Object.keys(CATEGORIA_POR_CAMPO).length, 11);
  for (const [campo, categoria] of Object.entries(CATEGORIA_POR_CAMPO)) {
    assert.equal(fieldCategory({ engines: ["claude-code"] }, campo), categoria, campo);
  }
});

test("should classify skillsDirs as a declaration when engines includes custom", () => {
  assert.equal(fieldCategory({ engines: ["custom"] }, "skillsDirs"), FIELD_CATEGORY.DECLARATION);
  assert.equal(fieldCategory({ engines: ["claude-code", "custom"] }, "skillsDirs"), FIELD_CATEGORY.DECLARATION);
});

test("should classify skillsDirs as derived when engines does not include custom", () => {
  assert.equal(fieldCategory({ engines: ["claude-code"] }, "skillsDirs"), FIELD_CATEGORY.DERIVED);
});

test("should classify skillsDirs as derived when engines is absent or not an array", () => {
  assert.equal(fieldCategory({}, "skillsDirs"), FIELD_CATEGORY.DERIVED);
  assert.equal(fieldCategory({ engines: "custom" }, "skillsDirs"), FIELD_CATEGORY.DERIVED);
  assert.equal(fieldCategory(null, "skillsDirs"), FIELD_CATEGORY.DERIVED);
});

test("should classify a field outside the three lists as a declaration", () => {
  assert.equal(fieldCategory({}, "campoQueNaoExiste"), FIELD_CATEGORY.DECLARATION);
});

test("should prescribe by-hand for a root problem", () => {
  const problem = { field: MANIFEST_NAME, kind: "root", expected: "object", found: "string" };
  assert.equal(problemRemedy({}, problem), "by-hand");
});

test("should prescribe update for a problem in a derived field", () => {
  const problem = { field: "agents", kind: "container", expected: "array-of-strings", found: "boolean" };
  assert.equal(problemRemedy({ engines: ["claude-code"] }, problem), "update");
});

test("should prescribe by-hand for a problem in a declaration field", () => {
  const problem = { field: "engines", kind: "container", expected: "array-of-strings", found: "number" };
  assert.equal(problemRemedy({ engines: 7 }, problem), "by-hand");
});

test("should prescribe by-hand for a problem in the skills record", () => {
  const problem = { field: "skills", kind: "container", expected: "array-of-skill-names", found: "object" };
  assert.equal(problemRemedy({ skills: {} }, problem), "by-hand");
});

test("should prescribe by-hand for skillsDirs of a custom target and update otherwise", () => {
  const problem = { field: "skillsDirs", kind: "container", expected: "array-of-strings", found: "string" };
  assert.equal(problemRemedy({ engines: ["custom"] }, problem), "by-hand");
  assert.equal(problemRemedy({ engines: ["claude-code"] }, problem), "update");
});

test("should map the declaration flags without optional and allSkills", () => {
  assert.deepEqual({ ...DECLARATION_FLAGS }, {
    engines: "--engine",
    architecture: "--arch",
    language: "--language",
    userLanguage: "--user-language",
    skillsDirs: "--skills-dir",
  });
  assert.ok(!("optional" in DECLARATION_FLAGS));
  assert.ok(!("allSkills" in DECLARATION_FLAGS));
});

test("should list the five known manifest models", () => {
  assert.deepEqual([...KNOWN_MODELS], [
    "self-contained-core-runtime",
    "self-contained-layered-config",
    "self-contained-runtime",
    "self-contained",
    "runtime-launcher",
  ]);
});

const CAMPOS_TEXTO = ["architecture", "language", "userLanguage"];
const FORMAS_NAO_TEXTO = [["objeto", { a: 1 }, "object"], ["numero", 7, "number"], ["booleano", true, "boolean"], ["array", [1], "array"]];

test("should not report a problem when architecture, language, userLanguage or allSkills is absent or null", () => {
  for (const campo of [...CAMPOS_TEXTO, "allSkills", "optional", "agentsDirs"]) {
    assert.deepEqual(manifestShapeProblems({ [campo]: null }), [], `${campo} null e estado legado tolerado`);
    assert.deepEqual(manifestShapeProblems({ [campo]: undefined }), [], `${campo} ausente e estado legado tolerado`);
  }
});

test("should report a type problem when architecture, language or userLanguage is not text", () => {
  for (const campo of CAMPOS_TEXTO) {
    for (const [nome, valor, tipo] of FORMAS_NAO_TEXTO) {
      assert.deepEqual(
        manifestShapeProblems({ [campo]: valor }),
        [{ field: campo, kind: "type", expected: "text-or-null", found: tipo }],
        `${campo} como ${nome}`,
      );
    }
  }
});

test("should report a type problem when allSkills is not a boolean", () => {
  for (const [nome, valor, tipo] of [["texto", "x", "string"], ["numero", 7, "number"], ["objeto", { a: 1 }, "object"], ["array", [], "array"]]) {
    assert.deepEqual(
      manifestShapeProblems({ allSkills: valor }),
      [{ field: "allSkills", kind: "type", expected: "boolean-or-null", found: tipo }],
      `allSkills como ${nome}`,
    );
  }
  assert.deepEqual(manifestShapeProblems({ allSkills: true }), []);
  assert.deepEqual(manifestShapeProblems({ allSkills: false }), []);
});

test("should report a container problem when optional is not an array and an element problem for a non-string item", () => {
  for (const [, valor, tipo] of FORMAS_NAO_ARRAY) {
    assert.deepEqual(
      manifestShapeProblems({ optional: valor }),
      [{ field: "optional", kind: "container", expected: "array-of-strings", found: tipo }],
    );
  }
  assert.deepEqual(
    manifestShapeProblems({ optional: ["a", 1] }),
    [{ field: "optional", kind: "element", expected: "array-of-strings", found: "non-string-element", position: 1 }],
  );
  assert.deepEqual(manifestShapeProblems({ optional: ["a"] }), []);
});

test("should report a value problem listing the catalog architectures when architecture is outside the catalog", () => {
  const [problem, ...resto] = manifestShapeProblems({ architecture: "mvc" });
  assert.equal(resto.length, 0);
  assert.equal(problem.field, "architecture");
  assert.equal(problem.kind, "value");
  assert.equal(problem.expected, "architecture-name");
  assert.equal(problem.found, "unknown-value");
  assert.deepEqual(problem.allowed, catalog.architectures());
});

test("should accept every architecture of the catalog", () => {
  for (const nome of catalog.architectures()) {
    assert.deepEqual(manifestShapeProblems({ architecture: nome }), [], nome);
  }
});

test("should accept a language outside the catalog and report a language that is not text", () => {
  assert.deepEqual(manifestShapeProblems({ language: "cobol" }), [], "language confere so o tipo");
  const problems = manifestShapeProblems({ language: [1] });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].field, "language");
  assert.equal(problems[0].kind, "type");
  assert.equal(problems[0].found, "array");
});

const TEXTOS_DOS_RAMOS_NOVOS = [
  ["manifestProblemNotText", { field: "language", kind: "type", expected: "text-or-null", found: "array" }, ["language", "array"]],
  ["manifestProblemNotBoolean", { field: "allSkills", kind: "type", expected: "boolean-or-null", found: "string" }, ["allSkills", "string"]],
  ["manifestProblemUnknownValue", { field: "architecture", kind: "value", expected: "architecture-name", found: "unknown-value", allowed: ["hexagonal", "clean"] }, ["architecture", "hexagonal | clean"]],
  ["manifestProblemEmptyEngines", { field: "engines", kind: "value", expected: "non-empty-engines", found: "empty-list" }, []],
];

test("should pick the message key and params of each new problemText branch", () => {
  for (const [chave, problem, params] of TEXTOS_DOS_RAMOS_NOVOS) {
    const descritor = problemText(problem);
    assert.equal(descritor.key, chave);
    assert.deepEqual(descritor.params, params);
  }
});

test("should have the key of each new problemText branch in both tables and render a non-empty sentence", () => {
  for (const [chave, problem] of TEXTOS_DOS_RAMOS_NOVOS) {
    for (const lang of ["en", "pt-BR"]) {
      const tabela = getMessages(lang);
      assert.ok(chave in tabela, `${chave} ausente em ${lang}`);
      assert.ok(renderText(tabela, problemText(problem)).length > 0);
    }
  }
});

test("should render the new problemText branches without english words in pt-BR", () => {
  for (const [, problem] of TEXTOS_DOS_RAMOS_NOVOS) {
    assert.doesNotMatch(renderText(getMessages("pt-BR"), problemText(problem)), /\b(expected|found)\b/);
    assert.doesNotMatch(renderText(getMessages("en"), problemText(problem)), /\b(esperado|encontrado|encontrada)\b/);
  }
});

test("should keep auditing when agentsDirs or optional is an empty object", () => {
  const repo = instalacaoLimpa();
  try {
    const instalado = JSON.parse(readFileSync(caminhoManifesto(repo), "utf8"));
    for (const alteracao of [{ agentsDirs: {} }, { optional: {} }]) {
      gravarManifestoJson(repo, { ...instalado, ...alteracao });
      assert.equal(diagnose(repo).outcome, AUDITED, `${JSON.stringify(alteracao)} nao e letal`);
    }
  } finally {
    descartar(repo);
  }
});

test("should keep refusing an empty object in skillsDirs as an invalid manifest", () => {
  const repo = instalacaoLimpa();
  try {
    const instalado = JSON.parse(readFileSync(caminhoManifesto(repo), "utf8"));
    gravarManifestoJson(repo, { ...instalado, skillsDirs: {} });
    const resultado = diagnose(repo);
    assert.equal(resultado.outcome, INVALID_MANIFEST);
    assert.ok(resultado.manifest.problems.some((problema) => problema.field === "skillsDirs"));
  } finally {
    descartar(repo);
  }
});

const comConteudoCruDoManifesto = (conteudo, acao) => {
  const dir = tempDir("mgr-manifest-raw-");
  try {
    if (conteudo !== undefined) writeFileSync(path.join(dir, MANIFEST_NAME), conteudo);
    return acao(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("should throw fileNotObject from readManifest for a root that is not an object", () => {
  for (const conteudo of ["null", "[]", '"x"', "7"]) {
    comConteudoCruDoManifesto(conteudo, (dir) => {
      assert.throws(() => readManifest(dir), (error) => {
        assert.ok(error instanceof UsageError, conteudo);
        assert.equal(error.key, "fileNotObject", conteudo);
        assert.deepEqual(error.params, [MANIFEST_NAME], conteudo);
        return true;
      });
    });
  }
});

test("should render fileNotObject from readManifest in both languages", () => {
  for (const idioma of ["en", "pt-BR"]) {
    const tabela = getMessages(idioma);
    comConteudoCruDoManifesto("[]", (dir) => {
      let capturado;
      try {
        readManifest(dir);
      } catch (error) {
        capturado = error;
      }
      assert.equal(renderError(tabela, capturado), tabela.fileNotObject(MANIFEST_NAME), idioma);
    });
  }
});

test("should return undeclared from readUserLanguage when the manifest file is absent", () => {
  comConteudoCruDoManifesto(undefined, (dir) => {
    assert.deepEqual(readUserLanguage(dir), { state: "undeclared" });
  });
});

test("should return undeclared from readUserLanguage for an empty or corrupt manifest", () => {
  for (const conteudo of ["", "{ nao e json"]) {
    comConteudoCruDoManifesto(conteudo, (dir) => {
      assert.deepEqual(readUserLanguage(dir), { state: "undeclared" }, JSON.stringify(conteudo));
    });
  }
});

test("should return undeclared from readUserLanguage for a root that is not an object", () => {
  for (const conteudo of ["null", "[]", '"x"', "7"]) {
    comConteudoCruDoManifesto(conteudo, (dir) => {
      assert.deepEqual(readUserLanguage(dir), { state: "undeclared" }, conteudo);
    });
  }
});

test("should return undeclared from readUserLanguage when userLanguage is absent, empty or not text", () => {
  for (const conteudo of [{}, { userLanguage: "" }, { userLanguage: 7 }]) {
    comConteudoCruDoManifesto(JSON.stringify(conteudo), (dir) => {
      assert.deepEqual(readUserLanguage(dir), { state: "undeclared" }, JSON.stringify(conteudo));
    });
  }
});

test("should return declared from readUserLanguage for a non-empty userLanguage", () => {
  comConteudoCruDoManifesto(JSON.stringify({ userLanguage: "pt-BR" }), (dir) => {
    assert.deepEqual(readUserLanguage(dir), { state: "declared", value: "pt-BR" });
  });
});

test("should return declared from readUserLanguage even when another field is malformed", () => {
  comConteudoCruDoManifesto(JSON.stringify({ userLanguage: "pt-BR", skills: { a: 1 } }), (dir) => {
    assert.deepEqual(readUserLanguage(dir), { state: "declared", value: "pt-BR" });
  });
});
