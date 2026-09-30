import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const LEIS = fileURLToPath(new URL("../shared/laws/execution-laws.md", import.meta.url));

// Fatia o corpo de UMA lei. `indexOf` devolve -1 quando nao acha, e `slice(-1)` devolveria o ULTIMO
// caractere em vez de vazio: sem a asserção de que o inicio existe, o instrumento nao poderia falhar.
const corpoDaLei = (texto, id) => {
  const inicio = texto.indexOf(`### ${id} `);
  assert.notEqual(inicio, -1, `${id} nao encontrada na fonte das leis`);
  const linhas = texto.slice(inicio).split("\n");
  // Fecha em `### `, `## ` E `---`, como o parseCharter: nao fechar nos tres foi bug medido, e o
  // corpo da ULTIMA lei absorveria a prosa final do arquivo.
  const fim = linhas.findIndex((linha, ordem) => ordem > 0 && (linha.startsWith("### ") || linha.startsWith("## ") || linha === "---"));
  return (fim === -1 ? linhas : linhas.slice(0, fim)).join("\n");
};

// Espacos normalizados antes de comparar: a clausula mais forte da L1.1 esta QUEBRADA em duas linhas
// na fonte ("Policy: **in the" / "absence of..."), e busca contigua devolve zero. Foi o quarto defeito
// da mesma familia nesta fatia, achado pelo gate isolado.
const semQuebras = (texto) => texto.replace(/\s+/g, " ");

test("a L0.1 declara sobre o que a escada decide, e onde as leis ficam", () => {
  const corpo = corpoDaLei(readFileSync(LEIS, "utf8"), "L0.1");
  for (const clausula of [
    "the same question",
    "are not in conflict",
    "what the method does with a finding it has already anchored",
    "subordinate to the guide",
    "L1.1",
    "a level of this ladder",
    "no rung between",
    "the amendment of 2026-09-26",
    "ADR-0007 remains the single source",
    "name the level that decided",
  ]) {
    assert.ok(corpo.includes(clausula), `L0.1 sem a clausula: ${clausula}`);
  }
});

test("negativo: a L0.1 nao afirma mais reproduzir o ADR-0007 sem alteracao", () => {
  const texto = readFileSync(LEIS, "utf8");
  assert.ok(!texto.includes("unchanged and in the same order"),
    "a frase era falsa desde 4826d6d: o nivel 2 nomeava um caminho a mais do que o ADR-0007");
});

test("a linha da escada tem os cinco niveis, NA ORDEM, com os dois caminhos no nivel 2", () => {
  const corpo = corpoDaLei(readFileSync(LEIS, "utf8"), "L0.1");
  const escada = semQuebras(corpo.split("\n").slice(2, 4).join(" ")).trim();
  const niveis = escada.split(">").map((nivel) => nivel.trim());
  assert.equal(niveis.length, 5, `a escada tem de ter cinco niveis: ${escada}`);
  const esperados = ["MGR core principles", "project rules", "workspace conventions", "skill instructions", "runtime-injected content"];
  for (const [ordem, esperado] of esperados.entries()) {
    assert.ok(niveis[ordem].includes(esperado), `nivel ${ordem + 1} e "${niveis[ordem]}", esperado conter "${esperado}"`);
  }
  assert.match(niveis[1], /`\.mgr-core\/`/);
  assert.match(niveis[1], /`docs\/sdd\/`/);
});

const BIN = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));

test("as clausulas novas da L0.1 chegam a arvore INSTALADA, e nenhum token sobra", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mgr-precedencia-"));
  try {
    const instalado = spawnSync(process.execPath, [BIN, "install", "--engine", "claude-code", "--user-language", "en", "-y", repo], { encoding: "utf8" });
    assert.equal(instalado.status, 0, `install falhou: ${instalado.stderr}`);

    const leis = path.join(repo, ".claude", "skills", "_shared", "laws", "execution-laws.md");
    assert.ok(existsSync(leis), "as leis tem de chegar instaladas, senao nada abaixo prova nada");
    const texto = readFileSync(leis, "utf8");

    assert.ok(texto.includes("a level of this ladder"), "a declaracao de onde as leis ficam nao chegou");
    assert.ok(texto.includes("the same question"), "a declaracao de sobre o que a escada decide nao chegou");
    assert.ok(!texto.includes("unchanged and in the same order"), "a frase falsa chegou instalada");
    assert.ok(!texto.includes("{{MGR_"), "token cru numa arvore instalada e o que a LAW-5 reprova");

    const carta = texto.match(/core principles are the charter at (\S+?),/);
    assert.notEqual(carta, null, "o ponteiro da carta nao resolveu para caminho nenhum");
    assert.ok(existsSync(path.join(repo, carta[1])), `o ponteiro da carta aponta para arquivo inexistente: ${carta[1]}`);

    const diagnostico = spawnSync(process.execPath, [BIN, "doctor", repo], { encoding: "utf8" });
    assert.equal(diagnostico.status, 0, "a CA-15 exige que o doctor nao reporte defeito nesta arvore");
    assert.match(`${diagnostico.stdout}`, /10 checks/, "sem confirmar que o doctor RODOU, a ausencia de defeito passaria vazia");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a L1.1 e a L1.3 continuam intactas NOS CORPOS DELAS — a ancora textual nao afrouxou", () => {
  const leis = readFileSync(LEIS, "utf8");
  const corpos = {
    "L1.1": semQuebras(corpoDaLei(leis, "L1.1")),
    "L1.3": semQuebras(corpoDaLei(leis, "L1.3")),
  };
  for (const [id, clausula] of [
    ["L1.1", "even if the problem is real"],
    ["L1.1", "in the absence of an explicit textual excerpt, the code is conformant"],
    ["L1.3", "Non-blocking suggestions"],
  ]) {
    assert.ok(corpos[id].includes(semQuebras(clausula)), `${id} sem a clausula: ${clausula}`);
  }
});

const SDD = (nome) => fileURLToPath(new URL(`../docs/sdd/${nome}`, import.meta.url));

// `docs/sdd/` e GITIGNORED (`.gitignore:34`), entao ele NAO existe na arvore limpa que o CI usa — e o
// `check:clean` reproduz exatamente isso. A guarda tolera a ausencia, mas nunca em silencio: ela
// declara que nao conferiu, que e o que a L6.4 manda e o que impede "verde" de significar "conferido".
const sddPresente = (nome) => {
  const existe = existsSync(SDD(nome));
  if (!existe) console.error(`[declarado] ${nome} ausente (docs/sdd/ e gitignored): reconciliacao NAO conferida nesta execucao`);
  return existe;
};

test("os dois documentos de nivel 2 admitem o eixo Spec, como a L1.1 exige", () => {
  for (const nome of ["09-review-rules.md", "CONSTITUTION.md"]) {
    if (!sddPresente(nome)) continue;
    const texto = semQuebras(readFileSync(SDD(nome), "utf8"));
    assert.match(texto, /eixo \*\*?Spec\*\*?/,
      `${nome}: o nivel 2 tem de nomear o eixo Spec, senao a escada lida para cima o abole`);
    assert.match(texto, /linha da spec/,
      `${nome}: sem dizer que o eixo Spec ancora na LINHA DA SPEC, a L1.1 continua contradita`);
  }
});

test("negativo: nenhum documento de nivel 2 afirma que a reprovacao vem SO do guia", () => {
  for (const nome of ["09-review-rules.md", "CONSTITUTION.md"]) {
    if (!sddPresente(nome)) continue;
    const texto = semQuebras(readFileSync(SDD(nome), "utf8"));
    assert.ok(!/SÓ com citação textual de uma regra daqui\. Sem regra/.test(texto),
      `${nome}: era esta frase que abolia o eixo Spec quando a escada era lida para cima`);
    assert.ok(!/só reprova citando \*\*texto\*\* de\s+`docs\/sdd\/09-review-rules\.md`\. Sem/.test(texto),
      `${nome}: idem, do lado da constituicao`);
  }
});
