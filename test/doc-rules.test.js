import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { COMPLETION_FILE, check, isDiffHeading, parse } from "../src/doc-rules.js";

const repoTemporario = () => mkdtempSync(path.join(tmpdir(), "mgr-doc-"));

const comDoc = (nomes) => {
  const repo = repoTemporario();
  mkdirSync(path.join(repo, "docs", "sdd"), { recursive: true });
  for (const nome of nomes) writeFileSync(path.join(repo, "docs", "sdd", nome), "# doc\n", "utf8");
  return repo;
};

const doFechamento = (corpo) => check(parse(corpo), `specs/x/${COMPLETION_FILE}`, { repo: comDoc([]) });

// Os SETE títulos medidos em disco em 2026-09-17. Não são nomes inventados: é a fixture que a linha
// de base gravou, e exigir um título exato reprovaria dez dos quatorze completions por convenção.
const TITULOS_REAIS = [
  "SDD atualizada (diff)",
  "Diff da SDD",
  "10. Diff do `/docs/sdd/`",
  "13. Diff do `/docs/sdd/`",
  "9. Diff do `/docs/sdd/`",
  "3. SDD atualizada — o diff",
  "3. Diff do SDD — atualização incremental",
];

test("os sete títulos reais medidos em disco são reconhecidos", () => {
  for (const titulo of TITULOS_REAIS) {
    assert.ok(isDiffHeading(titulo), `"${titulo}": exigir título exato reprovaria por convenção, não por defeito`);
  }
});

test("título sem as duas palavras NÃO é a seção de diff", () => {
  for (const titulo of ["Diff do código", "Documentação", "Testes", "O que mudou", "SDD"]) {
    assert.ok(!isDiffHeading(titulo), `"${titulo}": casar largo faria qualquer seção satisfazer o gate`);
  }
});

test("o reconhecimento ignora acento e caixa", () => {
  assert.ok(isDiffHeading("DIFF DA SDD"));
  assert.ok(isDiffHeading("Diff da documentação"));
  assert.ok(isDiffHeading("diff do sdd"));
});

test("fechamento sem a seção de diff reprova com DOC-3", () => {
  const [achado] = doFechamento("# Completion\n\n## O que mudou\n\nalgo\n\n## Testes\n\nverdes\n");
  assert.equal(achado.code, "DOC-3");
  assert.equal(achado.severity, "error");
  assert.match(achado.message, /sem a declaração do diff/);
});

test("a seção com arquivo que EXISTE passa, e o nome vale sem o diretório", () => {
  const repo = comDoc(["03-contracts.md"]);
  const corpo = "# Completion\n\n## Diff do SDD\n\n- `03-contracts.md`: o comando novo entrou\n";
  assert.deepEqual(check(parse(corpo), `specs/x/${COMPLETION_FILE}`, { repo }), [],
    "os completions em disco citam o nome puro: exigir a barra reprovaria dez deles");
});

test("a seção com caminho completo também passa", () => {
  const repo = comDoc(["02-architecture.md"]);
  const corpo = "# Completion\n\n## Diff da SDD\n\n- `docs/sdd/02-architecture.md` — o módulo entrou\n";
  assert.deepEqual(check(parse(corpo), `specs/x/${COMPLETION_FILE}`, { repo }), []);
});

test("a seção que só cita arquivo INEXISTENTE reprova com DOC-4", () => {
  const [achado] = doFechamento("# Completion\n\n## Diff do SDD\n\n- `99-nao-existe.md`: algo\n");
  assert.equal(achado.code, "DOC-4");
  assert.equal(achado.severity, "error");
  assert.match(achado.message, /não nomeia arquivo que exista nem declara/);
});

// As QUATRO formas medidas em disco, mais a negação canônica em português, que a primeira heurística
// deixava de fora. Reprovar qualquer uma forçaria uma feature que não mexe em documentação a
// INVENTAR um arquivo para o gate passar.
test("a declaração de que nada mudou passa, nas formas medidas em disco e na canônica", () => {
  const formas = [
    "Nenhuma alteração necessária. A feature não muda stack, arquitetura nem contratos.",
    "**Nenhuma alteração em `docs/sdd/`.** A feature adiciona uma skill e a registra.",
    "Nenhuma atualização necessária: nada de novo no contrato.",
    "Nada mais da SDD mudou nesta fatia.",
    "Não houve alteração necessária: a feature não toca contrato.",
    "Sem alteração na documentação: nada externo mudou.",
  ];
  for (const forma of formas) {
    assert.deepEqual(doFechamento(`# Completion\n\n## Diff do SDD\n\n${forma}\n`), [],
      `"${forma.slice(0, 34)}...": e a canônica em pt-BR é a redação que o próprio CA-6 usa`);
  }
});

// O ADR-0003 faz o idioma do artefato configurável, e este validador viaja para todo projeto que
// instala o método. Só em português, uma feature honesta num projeto em inglês levaria DOC-4.
test("a negação é reconhecida em inglês, porque o método não é só para projeto em pt-BR", () => {
  const formas = [
    "No documentation change was needed: the feature touches no contract.",
    "**No changes to `docs/sdd/`.** The feature only registers a skill.",
    "Nothing else changed in the documentation.",
  ];
  for (const forma of formas) {
    assert.deepEqual(doFechamento(`# Completion\n\n## Documentation diff\n\n${forma}\n`), [],
      `"${forma.slice(0, 34)}...": o título já era agnóstico; a negação também tem de ser`);
  }
});

test("negação sobre OUTRA coisa não satisfaz o gate", () => {
  const [achado] = doFechamento("# Completion\n\n## Diff do SDD\n\nNenhum arquivo de teste novo foi criado.\n");
  assert.equal(achado.code, "DOC-4",
    "a negação tem de ser sobre alteração de documentação, senão qualquer frase com `nenhum` passaria");
});

// O gate de fechamento demonstrou este falso negativo com frase exata: a heurística anterior aceitava
// negação + palavra de mudança numa janela de 40 caracteres, e `no` é preposição corrente em
// português. Estas frases AFIRMAM alteração, e passavam pela exceção de "nada mudou".
test("frase que AFIRMA alteração não satisfaz a exceção, mesmo contendo `no`", () => {
  const afirmam = [
    "Entrou no README a mudança de superfície.",
    "O comando novo entrou no contrato, e o README foi atualizado.",
    "A skill nova entrou no índice; o glossário mudou junto.",
  ];
  for (const frase of afirmam) {
    const [achado] = doFechamento(`# Completion\n\n## Diff do SDD\n\n${frase}\n`);
    assert.equal(achado?.code, "DOC-4",
      `"${frase.slice(0, 40)}...": afirmar alteração sem nomear arquivo não é declarar que nada mudou`);
  }
});

// A barra inicial é a forma que os próprios títulos em disco usam — "Diff do `/docs/sdd/`".
// Recusá-la reprovaria por convenção de citação, que é o erro que esta regra já corrigiu uma vez.
test("caminho com barra inicial é aceito, e normalizado", () => {
  const repo = comDoc(["05-data.md"]);
  const corpo = "# Completion\n\n## Diff do SDD\n\n- `/docs/sdd/05-data.md` — a tabela nova\n";
  assert.deepEqual(check(parse(corpo), `specs/x/${COMPLETION_FILE}`, { repo }), []);
});

// O eixo de proveniência guarda isto, com a razão escrita lá: um fato que vive fora do repositório
// não é conferível por quem clonar.
//
// **A primeira versão deste teste era VACUOSA**, e o gate de fechamento provou: ela citava
// `../../etc/hostname`, que **não tem extensão** — o regex de caminho nem produzia a citação, e o
// `DOC-4` vinha do mesmo ramo do teste da seção vazia. Passaria igual sem a guarda existir, e
// passaria igual com a guarda invertida. Agora o arquivo citado **existe de fato** fora da raiz, com
// extensão, e o fato é controlado em vez de depender do host.
test("caminho que ESCAPA da raiz não conta como fato, mesmo o arquivo existindo", () => {
  // O arquivo de fora mora num diretório que ENVOLVE o repo, e não na raiz de `/tmp`: o resto deste
  // arquivo já vaza um diretório temporário por caso, e vazar arquivo solto ao lado seria sujeira de
  // ordem diferente na máquina de quem roda a suíte.
  const envolve = mkdtempSync(path.join(tmpdir(), "mgr-doc-fora-"));
  const repo = path.join(envolve, "repo");
  mkdirSync(path.join(repo, "docs", "sdd"), { recursive: true });
  writeFileSync(path.join(envolve, "fora.md"), "# vive fora do repositorio\n", "utf8");

  const corpo = "# Completion\n\n## Diff do SDD\n\n- `../fora.md` — fora do repositório\n";
  const [achado] = check(parse(corpo), `specs/x/${COMPLETION_FILE}`, { repo });
  assert.equal(achado?.code, "DOC-4",
    "sem a guarda este arquivo existe e satisfaria o gate com fato que ninguém que clonar confere");
});

test("a seção vazia reprova", () => {
  const [achado] = doFechamento("# Completion\n\n## Diff do SDD\n\n## Pendências\n\nnenhuma\n");
  assert.equal(achado.code, "DOC-4");
});

test("duas seções de diff, e basta UMA com fato", () => {
  const repo = comDoc(["04-domain.md"]);
  const corpo = "# Completion\n\n## Diff do SDD\n\nver abaixo\n\n## 9. Diff do `/docs/sdd/`\n\n- `04-domain.md`: invariante nova\n";
  assert.deepEqual(check(parse(corpo), `specs/x/${COMPLETION_FILE}`, { repo }), [],
    "há um completion em disco que declara o diff em duas seções: reprovar pela segunda seria defeito");
});

test("a regra NÃO roda fora do artefato de fechamento", () => {
  const corpo = "# Spec\n\n## O que muda\n\nnada de diff aqui\n";
  for (const artefato of ["01-brief.md", "02-prd.md", "03-spec.md", "04-plan.md", "05-execution.md"]) {
    assert.deepEqual(check(parse(corpo), `specs/x/${artefato}`, { repo: comDoc([]) }), [],
      `${artefato}: exigir a seção de um artefato que nunca a prometeu é acusar ausência inventada`);
  }
});

// A mesma razão que o `stripFencedBlocks` já registra: um artefato que documenta o próprio formato
// não pode declarar a seção por acidente.
test("seção dentro de bloco cercado não conta como declaração", () => {
  const corpo = "# Completion\n\n## O que mudou\n\n```md\n## Diff do SDD\n\n- `03-contracts.md`\n```\n";
  const [achado] = doFechamento(corpo);
  assert.equal(achado.code, "DOC-3", "exemplo que documenta o formato não é o formato cumprido");
});

test("a subseção pertence à seção que a contém", () => {
  const repo = comDoc(["08-glossary.md"]);
  const corpo = "# Completion\n\n## Diff do SDD\n\n### Glossário\n\n- `08-glossary.md`: termos novos\n";
  assert.deepEqual(check(parse(corpo), `specs/x/${COMPLETION_FILE}`, { repo }), [],
    "quem escreve organiza em subseções, e o fato citado nelas continua sendo da seção");
});

test("o parse devolve cabeçalho, linha e corpo, sem tocar disco", () => {
  const { headings } = parse("# Um\n\ntexto\n\n## Dois\n\n- `a/b.md`\n");
  assert.deepEqual(headings.map(({ title, level, line }) => ({ title, level, line })),
    [{ title: "Um", level: 1, line: 1 }, { title: "Dois", level: 2, line: 5 }]);
  assert.deepEqual(headings[1].paths, ["a/b.md"]);
});
