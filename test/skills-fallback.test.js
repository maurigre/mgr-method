import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A regressão mais grave possível nesta feature é o método deixar de funcionar SEM a CLI
// instalada — hoje ele funciona. As skills passaram a preferir `mgr spec status --json`, e a
// única coisa que impede isso de virar dependência dura é o fallback estar ESCRITO.
//
// Este arquivo é o gate disso. Remover o fallback de qualquer uma das duas skills quebra aqui.
const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const BIN = path.join(RAIZ, "bin", "mgr.js");

const SKILLS_DO_FLUXO = ["spec-create", "spec-execute"];

// Os três sinais, medidos separadamente: a consulta, o fallback e o alvo do fallback.
// Sem limite de distância isto viraria `.*` depois de `semQuebras`, que remove todo `\n`:
// a asserção passaria com a consulta e o `--json` em pontas opostas do arquivo.
const CONSULTA = /mgr spec status[^.]{0,40}--json/;
const FALLBACK = /Fallback — when the `mgr` CLI is NOT installed/;
const ALVO_DO_FALLBACK = /\/specs\/<slug>\/\.handoff\.md/;


// Normaliza o espaço em branco antes de casar: as skills quebram linha em ~95 colunas, e uma
// frase partida no meio é a MESMA frase. Exigir linha única transformaria convenção de wrap em
// falha de teste — e o texto é o contrato, não o layout.
const semQuebras = (texto) => texto.replace(/\s+/g, " ");
const fonteDa = (skill) =>
  semQuebras(readFileSync(path.join(RAIZ, "skills", skill, "SKILL.md"), "utf8"));

test("as duas skills do fluxo consultam o comando E declaram o fallback", () => {
  for (const skill of SKILLS_DO_FLUXO) {
    const texto = fonteDa(skill);
    assert.match(texto, CONSULTA, `${skill}: precisa preferir o caminho resolvido`);
    assert.match(texto, FALLBACK, `${skill}: sem o fallback escrito, a CLI vira dependência dura`);
    assert.match(texto, ALVO_DO_FALLBACK, `${skill}: o fallback precisa dizer QUAL caminho usar`);
  }
});

test("o fallback aparece junto da consulta, não numa seção esquecida do arquivo", () => {
  for (const skill of SKILLS_DO_FLUXO) {
    const texto = fonteDa(skill);
    const distancia = Math.abs(texto.search(FALLBACK) - texto.search(CONSULTA));
    assert.ok(distancia < 600,
      `${skill}: consulta e fallback a ${distancia} caracteres de distância; quem lê um tem de ler o outro`);
  }
});

test("nenhuma das duas afirma que a CLI é obrigatória", () => {
  for (const skill of SKILLS_DO_FLUXO) {
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
    for (const skill of SKILLS_DO_FLUXO) {
      const texto = semQuebras(readFileSync(path.join(repo, ...base, skill, "SKILL.md"), "utf8"));
      assert.match(texto, CONSULTA, `${base[0]}/${skill}`);
      assert.match(texto, FALLBACK, `${base[0]}/${skill}: o usuário sem CLI depende desta frase`);
    }
  }
});

// O aviso do payload também é contrato com quem lê a skill: ela não pode ensinar que
// existência de arquivo é aprovação.
test("as skills repetem que artefato em disco não é artefato aprovado", () => {
  for (const skill of SKILLS_DO_FLUXO) {
    // `\*{0,2}` porque uma das duas põe `not` em negrito. O contrato é a frase, não a ênfase.
    assert.match(fonteDa(skill), /\bnot\*{0,2} an approved artifact/,
      `${skill}: sem isto, o verde do comando seria lido como aprovação`);
  }
});
