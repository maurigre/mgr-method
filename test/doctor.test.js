import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import {
  DEFECT, FIX_RESTORE, FIX_UPDATE, NO_FIX, UNAVAILABLE, WARNING,
  architectureSkill, bodyCheckAvailability, brokenHooks, divergentBody, lockfileDrift, missingAgents, missingSkills,
  orphanSkills, staleInstall, unresolvedTokens,
  AUDITED, NO_INSTALL, diagnose, hasDefect,
} from "../src/doctor.js";
import { diff } from "../src/lockfile.js";

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
    "na 0.6.0-beta.1 o remove apagou a skill do proprio metodo; ninguem sabe de onde uma orfa veio");
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

const AS_TREZE = readdirSync("skills").filter((nome) => existsSync(`skills/${nome}/SKILL.md`)).sort();
const daFonte = (nome) => readFileSync(`skills/${nome}/SKILL.md`, "utf8");
const doInstalado = (nome) => readFileSync(`.claude/skills/${nome}/SKILL.md`, "utf8");

test("a linha que carrega token na fonte NAO conta como divergencia", () => {
  const fonte = "---\nname: x\n---\nOutput language: {{MGR_USER_LANGUAGE}}\nigual";
  const instalado = "---\nname: x\ncontext: fork\n---\nOutput language: pt-BR\nigual";
  assert.deepEqual(divergentBody({ name: "x", source: fonte, installed: instalado, file: "f" }), [],
    "o install resolve o token por construcao; compara-la acusaria 100% das instalacoes, inclusive as recem-feitas");
});

test("linha SEM token que difere e achado", () => {
  const fonte = "---\nname: x\n---\nlinha original";
  const instalado = "---\nname: x\n---\nlinha trocada";
  const [achado] = divergentBody({ name: "x", source: fonte, installed: instalado, file: "f" });
  assert.equal(achado.check, "divergent-body");
  assert.match(achado.found, /a partir da linha 1/, "a primeira linha do corpo e a linha 1, nao a 2");
});

test("a instalacao deste repositorio esta velha em parte das skills, e integra no resto", () => {
  const instaladas = AS_TREZE.filter((nome) => existsSync(`.claude/skills/${nome}/SKILL.md`));
  const divergem = instaladas.filter((nome) =>
    divergentBody({ name: nome, source: daFonte(nome), installed: doInstalado(nome), file: nome }).length > 0);
  const integras = instaladas.filter((nome) => !divergem.includes(nome));
  assert.ok(divergem.includes("spec-create"),
    "a copia instalada do spec-create nao tem a secao de comissionamento que a fonte tem: instalacao velha de verdade");
  assert.ok(integras.includes("code-analyzer"),
    "e o metodo antigo acusava esta tambem, so porque o install resolve token nela");
  assert.ok(integras.length >= 3 && divergem.length >= 3,
    "o repositorio tem os dois casos, e por isso serve de fixture para os dois");
});

test("a divergencia reporta a PRIMEIRA linha, nao a contagem", () => {
  const fonte = "---\nn: x\n---\nigual\nSECAO NOVA\nresto";
  const instalado = "---\nn: x\n---\nigual\nresto";
  const [achado] = divergentBody({ name: "x", source: fonte, installed: instalado, file: "f" });
  assert.match(achado.found, /a partir da linha 2/,
    "um bloco inserido desloca o indice: contar daria numero inflado, medido em 116 para uma secao a mais");
});

test("divergencia de corpo NOMEIA o comando que a resolve", () => {
  const [achado] = divergentBody({ name: "x", source: "a\nb", installed: "a\nc", file: "f" });
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

test("token que sobrou no instalado e achado, e nomeia qual", () => {
  const [achado] = unresolvedTokens({ installed: "x {{MGR_LAWS}} y {{MGR_LAWS}}", file: "f" });
  assert.equal(achado.found, "{{MGR_LAWS}}", "repetido nao vira dois achados, e quem le precisa saber qual token sobrou");
  assert.equal(achado.fix, FIX_UPDATE);
});

test("instalado sem token NAO e achado", () => {
  assert.deepEqual(unresolvedTokens({ installed: "nada aqui", file: "f" }), [],
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

test("hook do proprio repositorio resolve", () => {
  const { hooks } = JSON.parse(readFileSync(".claude/settings.local.json", "utf8"));
  assert.deepEqual(brokenHooks({ hooks, exists: (caminho) => existsSync(caminho), file: "s" }), [],
    "o caminho e absoluto e de maquina: se o projeto mudar de lugar, este teste avisa");
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

test("diagnose acha os defeitos reais deste repositorio", () => {
  const { outcome, findings, checks } = diagnose(".");
  assert.equal(outcome, AUDITED);
  assert.equal(checks, 9, "a lista e FECHADA: mudar o numero aqui exige decidir, nao descobrir depois");
  const porTipo = (nome) => findings.filter(({ check }) => check === nome);
  assert.equal(porTipo("orphan-skill").length, 3, "arch-hexagonal, evidence-capture e junit-clean estao fora do manifesto");
  const corpo = porTipo("divergent-body");
  assert.equal(corpo.length, 1, "este repositorio esta atras do pacote, entao a comparacao de corpo e UMA declaracao, nao um alarme por skill");
  assert.equal(corpo[0].severity, UNAVAILABLE, "com o manifesto atras do pacote ela nao separa velho de adulterado");
  assert.equal(porTipo("stale-install").length, 1, "beta.9 no manifesto contra a versao do pacote");
});

test("o manifesto atras do pacote entra como AVISO e nao faz bloquear sozinho", () => {
  const soAviso = { findings: diagnose(".").findings.filter(({ check }) => check === "stale-install") };
  assert.equal(hasDefect(soAviso), false,
    "instalacao velha e o estado normal de quem nao rodou update; bloquear por isso deixaria quase todo projeto vermelho");
});

test("hasDefect ignora indisponivel", () => {
  assert.equal(hasDefect({ findings: [{ severity: "unavailable" }, { severity: "warning" }] }), false);
  assert.equal(hasDefect({ findings: [{ severity: "unavailable" }, { severity: DEFECT }] }), true);
});

test("diagnose NAO escreve nada em disco", () => {
  const antes = readdirSync(".claude/skills").sort().join("|")
    + readFileSync(".mgr-core/manifest.json", "utf8")
    + readFileSync(".claude/settings.local.json", "utf8");
  diagnose(".");
  const depois = readdirSync(".claude/skills").sort().join("|")
    + readFileSync(".mgr-core/manifest.json", "utf8")
    + readFileSync(".claude/settings.local.json", "utf8");
  assert.equal(depois, antes,
    "nao ha --fix e o comando e diagnostico: a garantia e nao escrever, nao apenas nao escrever sem confirmacao");
});

test("toda verificacao declara remediacao ou a razao de nao haver", () => {
  const { findings } = diagnose(".");
  for (const achado of findings) {
    const temRemediacao = typeof achado.fix === "string" && achado.fix.length > 0;
    assert.ok(temRemediacao || achado.fix === null,
      `${achado.check}: fica sem as duas coisas, e o CA-8 exige uma`);
  }
  const semCorrecao = findings.filter(({ fix }) => fix === null).map(({ check }) => check);
  assert.ok(semCorrecao.includes("orphan-skill"),
    "a orfa nao tem correcao segura: na 0.6.0-beta.1 o remove apagou a skill do proprio metodo");
});
