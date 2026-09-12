import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as catalogo from "../src/catalog.js";
import { get as engineDescriptor } from "../src/engines/index.js";

// A regressão mais grave possível nesta feature é o método deixar de funcionar SEM a CLI
// instalada — hoje ele funciona. As skills passaram a preferir `mgr spec status --json`, e a
// única coisa que impede isso de virar dependência dura é o fallback estar ESCRITO.
//
// Este arquivo é o gate disso. Remover o fallback de qualquer uma das três skills quebra aqui.
const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const BIN = path.join(RAIZ, "bin", "mgr.js");

// O alvo do fallback é POR SKILL: as duas do fluxo retomam por `.handoff.md`; o `code-analyzer`
// não retoma nada — ele carrega a spec de origem. Exigir o mesmo alvo das três faria o teste cobrar
// da terceira um caminho que ela não tem razão de citar.
const SKILLS_DO_FLUXO = {
  "spec-create": /\/specs\/<slug>\/\.handoff\.md/,
  "spec-execute": /\/specs\/<slug>\/\.handoff\.md/,
  "code-analyzer": /\/specs\/<slug>\/03-spec\.md/,
};

// Os três sinais, medidos separadamente: a consulta, o fallback e o alvo do fallback.
// Sem limite de distância isto viraria `.*` depois de `semQuebras`, que remove todo `\n`:
// a asserção passaria com a consulta e o `--json` em pontas opostas do arquivo.
const CONSULTA = /mgr spec status[^.]{0,40}--json/;
const FALLBACK = /Fallback — when the `mgr` CLI is NOT installed/;


// Normaliza o espaço em branco antes de casar: as skills quebram linha em ~95 colunas, e uma
// frase partida no meio é a MESMA frase. Exigir linha única transformaria convenção de wrap em
// falha de teste — e o texto é o contrato, não o layout.
const semQuebras = (texto) => texto.replace(/\s+/g, " ");
const fonteDa = (skill) =>
  semQuebras(readFileSync(path.join(RAIZ, "skills", skill, "SKILL.md"), "utf8"));

test("as três skills consultam o comando E declaram o fallback", () => {
  for (const [skill, alvoDoFallback] of Object.entries(SKILLS_DO_FLUXO)) {
    const texto = fonteDa(skill);
    assert.match(texto, CONSULTA, `${skill}: precisa preferir o caminho resolvido`);
    assert.match(texto, FALLBACK, `${skill}: sem o fallback escrito, a CLI vira dependência dura`);
    assert.match(texto, alvoDoFallback, `${skill}: o fallback precisa dizer QUAL caminho usar`);
  }
});

test("o fallback aparece junto da consulta, não numa seção esquecida do arquivo", () => {
  for (const skill of Object.keys(SKILLS_DO_FLUXO)) {
    const texto = fonteDa(skill);
    const distancia = Math.abs(texto.search(FALLBACK) - texto.search(CONSULTA));
    assert.ok(distancia < 600,
      `${skill}: consulta e fallback a ${distancia} caracteres de distância; quem lê um tem de ler o outro`);
  }
});

test("nenhuma das três afirma que a CLI é obrigatória", () => {
  for (const skill of Object.keys(SKILLS_DO_FLUXO)) {
    const texto = fonteDa(skill);
    assert.match(texto, /MUST keep working with the skills alone/,
      `${skill}: a promessa de operar sem a CLI é explícita, não subentendida`);
    // A afirmação positiva sozinha não é gate: a skill poderia prometer isso num parágrafo e
    // exigir a CLI noutro. A asserção negativa é a que fecha o eixo.
    assert.doesNotMatch(texto, /requires the `mgr` CLI|the `mgr` CLI is required|CLI is mandatory/i,
      `${skill}: nenhuma frase pode transformar a CLI em dependência dura`);
  }
});

// O que vale é o que chega ao disco do usuário. Instalação real, nos dois motores.
test("o fallback sobrevive à instalação, nos dois motores", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "mgr-fb-"));
  execFileSync("node", [BIN, "install", repo, "--engine", "both", "--scope", "project",
    "--all-skills", "-y"], { encoding: "utf8" });

  const instalados = [
    [".claude", "skills"],
    [".github", "skills"],
  ];
  for (const base of instalados) {
    for (const skill of Object.keys(SKILLS_DO_FLUXO)) {
      const texto = semQuebras(readFileSync(path.join(repo, ...base, skill, "SKILL.md"), "utf8"));
      assert.match(texto, CONSULTA, `${base[0]}/${skill}`);
      assert.match(texto, FALLBACK, `${base[0]}/${skill}: o usuário sem CLI depende desta frase`);
    }
  }
});

// O aviso do payload também é contrato com quem lê a skill: ela não pode ensinar que
// existência de arquivo é aprovação.
test("as skills repetem que artefato em disco não é artefato aprovado", () => {
  for (const skill of Object.keys(SKILLS_DO_FLUXO)) {
    // `\*{0,2}` porque uma das duas põe `not` em negrito. O contrato é a frase, não a ênfase.
    assert.match(fonteDa(skill), /\bnot\*{0,2} an approved artifact/,
      `${skill}: sem isto, o verde do comando seria lido como aprovação`);
  }
});

// A delegação da redação e da execução a agentes (ADR-0017). O que o gate protege aqui não é o
// caminho feliz: é que NENHUM checkpoint humano tenha ido junto com o trabalho para o agente.
const CONSULTA_DE_AGENTE = /mgr agents [a-z]+[^.]{0,20}--json/;
const FALLBACK_SEM_CLI = /The `mgr` CLI is NOT installed/;
const FALLBACK_AGENTE_AUSENTE = /the agent does not exist/;

const CHECKPOINTS_QUE_NAO_PODEM_SUMIR = {
  "spec-create": [
    /\*\*CHECKPOINT 1 \(blocking\)/,
    /\*\*CHECKPOINT 2 \(blocking\)/,
    /\*\*CHECKPOINT 3 \(blocking\)/,
  ],
  "spec-execute": [/\*\*Execution checkpoint:\*\*/],
};

// Quem já delega. A P2.2 acrescenta o `spec-execute` a esta lista — escopar por task mantém a
// suíte verde entre elas, em vez de deixar vermelho declarado atravessando o bloco.
const SKILLS_QUE_DELEGAM = ["spec-create", "spec-execute"];

test("a skill que delega consulta o `mgr agents` e declara os DOIS fallbacks", () => {
  for (const skill of SKILLS_QUE_DELEGAM) {
    const texto = fonteDa(skill);
    assert.match(texto, CONSULTA_DE_AGENTE, `${skill}: pergunta qual modelo, não assume`);
    assert.match(texto, FALLBACK_SEM_CLI, `${skill}: o método opera sem a CLI`);
    assert.match(texto, FALLBACK_AGENTE_AUSENTE,
      `${skill}: agente recém-instalado demora a aparecer, e isso é recuperável`);
  }
});

test("NENHUM checkpoint humano foi junto com o trabalho para o agente", () => {
  for (const [skill, checkpoints] of Object.entries(CHECKPOINTS_QUE_NAO_PODEM_SUMIR)) {
    const texto = fonteDa(skill);
    for (const checkpoint of checkpoints) {
      assert.match(texto, checkpoint,
        `${skill}: checkpoint que some é o método deixando de ser o método (RN-5)`);
    }
  }
});

test("a skill diz que o agente NÃO vê a conversa", () => {
  for (const skill of SKILLS_QUE_DELEGAM) {
    assert.match(fonteDa(skill), /agent cannot see this conversation|cannot see the conversation/,
      `${skill}: sem isto, quem escreve a skill esquece de pôr o contexto em disco`);
  }
});

// A skill da P2.1: ela CONDUZ a escolha de modelo e esforço, e a regra soberana é que ela nunca
// sugira. Sem gate, a próxima edição acrescenta "use opus para redação" achando que ajuda — e isso
// é palpite sobre a conta e sobre o bolso de quem instala (RN-1).
const CONFIGURA = "configure-agents";
const ALIASES = /\b(sonnet|opus|haiku|fable)\b/;

test("a skill de configuração lê o estado pelo comando e declara os três fallbacks", () => {
  const texto = fonteDa(CONFIGURA);
  assert.match(texto, /mgr agents --json/, "lê o estado antes de propor mudança");
  assert.match(texto, /mgr agents set <intent>/, "e escreve pelo comando, não editando o JSON");
  const fallbacks = texto.match(new RegExp(FALLBACK.source, "g")) || [];
  assert.equal(fallbacks.length, 3,
    "os três caminhos que dependem da CLI — ler o estado, ler os motores e escrever — têm fallback");
  assert.match(texto, /`\.mgr-core\/manifest\.json`/,
    "mostrar alias de motor que o projeto não tem é oferecer o que o comando vai recusar");
  assert.match(texto, /`\.mgr-core\/config\.json`/, "o fallback diz QUAL arquivo abrir");
  assert.match(texto, /MUST keep working with the skills alone/);
});

test("a skill NÃO sugere modelo por intenção, em nenhuma das duas ordens", () => {
  const texto = fonteDa(CONFIGURA);
  assert.match(texto, /\*\*Never suggest which model to use for an intent\.\*\*/,
    "a proibição é escrita, não subentendida");

  const recomendando = new RegExp(
    `\\b(use|prefer|recommend\\w*|best|ideal|suited)\\b.{0,60}${ALIASES.source}`, "i");
  assert.doesNotMatch(texto, recomendando, "nenhum alias aparece atrás de verbo de recomendação");

  const INTENCOES = /\b(drafting|execution|review)\b/;
  // `.` e não `[^.]`: com o texto colapsado numa linha só, um ponto qualquer — dentro de uma URL,
  // inclusive — desarmava a janela e deixava a asserção passar sem olhar nada.
  assert.doesNotMatch(texto, new RegExp(`${INTENCOES.source}.{0,80}${ALIASES.source}`, "i"),
    "alias perto de intenção é sugestão, mesmo sem verbo");
  assert.doesNotMatch(texto, new RegExp(`${ALIASES.source}.{0,80}${INTENCOES.source}`, "i"),
    "e a ordem inversa diria a mesma coisa");
});

test("a skill entra no catálogo FORA do CORE, que segue com seis", () => {
  assert.deepEqual(catalogo.CORE.length, 6, "um sétimo item no CORE é regressão até prova em contrário");
  assert.ok(!catalogo.CORE.includes(CONFIGURA), "ela configura o método, não conduz o fluxo");
  assert.ok(catalogo.TOOLING.includes(CONFIGURA));
  assert.ok(catalogo.selectSkills({}).includes(CONFIGURA), "mas acompanha toda instalação");
});

// A duplicação declarada da P2.1: os aliases vivem no descritor do motor E no texto da skill,
// porque a CLI não expõe o campo. Sem este gate, "divergem de forma visível" é promessa; com ele,
// não divergem.
test("a lista de aliases da skill é a MESMA do descritor do motor", () => {
  const texto = fonteDa(CONFIGURA);
  for (const alias of engineDescriptor("claude-code").documentedModels) {
    assert.match(texto, new RegExp(`\\b${alias}\\b`), `${alias} está no descritor e sumiu da skill`);
  }
  assert.deepEqual(engineDescriptor("copilot").documentedModels, [],
    "e a skill diz que ali não há o que oferecer, em vez de listar nome plausível");
});
