// Regras sobre a documentação declarada num artefato de fechamento (ADR-0020). O `parse` é **puro**;
// o `check` recebe o parse e devolve findings, e **resolve caminho em disco** para saber se o que a
// seção nomeia existe — a mesma divisão que o par `provenance.js`/`prov-rules.js` tem na prática.
//
// Por que este eixo existe: a Fase 6 do fluxo manda atualizar a documentação do projeto a cada
// feature, e nada verificava. Documentação defasada é documentação que mente — quem lê não tem como
// distinguir a linha velha da corrente. Lei sem gatilho é conselho.
//
// O que estas regras NÃO fazem, e é limite declarado: julgar se a documentação está CORRETA. Isso
// não é verificável por leitura sem julgamento arbitrário, e regra que depende de gosto é o que o
// método proíbe. Aqui se confere que o passo ACONTECEU e foi declarado; o conteúdo é do eixo de
// review, pela DOC-1 e DOC-2 da fonte única.
import path from "node:path";
import { existsSync } from "node:fs";
import { create } from "./findings.js";
import { stripFencedBlocks } from "./markdown.js";

// O artefato que estas regras alcançam, e só ele. A declaração de diff pertence ao fechamento: exigi-la
// de um brief ou de uma spec seria acusar ausência de algo que aquele artefato nunca prometeu.
export const COMPLETION_FILE = "06-completion.md";

// Reconhecimento por CONTEÚDO do cabeçalho, não por título exato. Medido em 2026-09-17: os 14
// completions em disco usam SETE títulos diferentes para a mesma seção — "SDD atualizada (diff)",
// "Diff da SDD", "3. Diff do SDD — atualização incremental" e outros quatro. Exigir um título
// reprovaria dez deles por convenção de nome, e não por defeito.
//
// A condição é `diff` mais (`sdd` ou `doc`), sem acento e sem caixa. É a MESMA condição que a
// linha de base usou para medir a adesão — se as duas divergirem, a fixture passa a mentir.
const semAcento = (texto) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const isDiffHeading = (texto) => {
  const limpo = semAcento(texto);
  return limpo.includes("diff") && (limpo.includes("sdd") || limpo.includes("doc"));
};

// DOC-3 — fechamento sem a declaração do diff da documentação.
//
// Erro, e não aviso: a adesão medida é de 13 em 14, então a regra formaliza prática existente em vez
// de impor prática nova. O precedente inverso está no ADR-0016, que rejeitou cobrar etiqueta de
// proveniência porque ali a adesão era ZERO — a diferença é de grau, e ela é grande.
const semDeclaracaoDeDiff = (file) => create({
  code: "DOC-3", severity: "error", file, line: 1,
  message: "fechamento sem a declaração do diff da documentação: a Fase 6 pede a atualização incremental, e nada a registra aqui",
  remediation: "Acrescente uma seção nomeando o que mudou na documentação do projeto, e os arquivos tocados. O título é livre — a seção é reconhecida por conter `diff` e `sdd` ou `doc`.",
  example: "## Diff do SDD\n\n- `docs/sdd/02-architecture.md` — o módulo novo entrou no diagrama",
});

// DOC-4 — a seção existe e não diz NADA verificável: nem arquivo que exista, nem a declaração de que
// não houve alteração.
//
// **Aceitar "nenhuma alteração" é deliberado, e foi medido.** Dois completions em disco declaram
// exatamente isso, com a razão escrita — *"Nenhuma alteração necessária. A feature não muda stack,
// arquitetura, contratos externos nem domínio"*. Reprovar isso forçaria uma feature que não mexe em
// documentação a **inventar** um arquivo para o gate passar, que é o oposto do que o método quer.
//
// **Por onde alguém pode escapar, declarado:** escrever "nenhuma alteração" numa feature que mudou
// documentação. Este gate não pega — ele verifica DECLARAÇÃO, não correção (RN-4 da spec). Quem pega
// é a DOC-1/DOC-2 da fonte única, por julgamento com citação, no gate de review. É por isso que os
// dois mecanismos existem juntos.
const diffSemFato = (secao, file) => create({
  code: "DOC-4", severity: "error", file, line: secao.line,
  message: `a seção \`${secao.title}\` não nomeia arquivo que exista nem declara que não houve alteração: não há o que verificar`,
  remediation: "Nomeie os arquivos de documentação que a feature tocou, ou declare que nenhuma alteração foi necessária — com a razão. Caminho que não resolve é o defeito que a DOC-2 da fonte única reprova.",
  example: "## Diff do SDD\n\n- `03-contracts.md` — o comando novo entrou na tabela\n\nou\n\n## Diff do SDD\n\nNenhuma alteração necessária: a feature não muda contrato nem arquitetura.",
});

const HEADING = /^(#{1,6})\s+(.+?)\s*$/;

// Arquivo citado entre crases, COM ou SEM diretório.
//
// Medido em 2026-09-17, e a primeira versão desta regra errou por não medir: os completions em disco
// citam **`03-contracts.md`** — nome puro, sem o diretório —, porque dentro da seção de diff do SDD o
// diretório é óbvio para quem lê. Exigir a barra reprovaria **10 dos 14** por convenção de citação,
// que é exatamente o erro que a DOC-3 evita ao não exigir título exato.
const ARQUIVO_CITADO = /`(\/?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.[A-Za-z0-9]+)`/g;

/**
 * Parse mínimo: os cabeçalhos do artefato e os caminhos citados sob cada um.
 *
 * Puro, sem IO — o mesmo desenho de `plan-parser` e `spec-parser`. Blocos cercados saem antes, por
 * `stripFencedBlocks`: um completion que documenta o próprio formato num exemplo não pode declarar
 * a seção por acidente, e é a mesma razão que aquele utilitário já registra.
 *
 * Os caminhos e o corpo de um cabeçalho vão até o **próximo cabeçalho de nível igual ou superior** —
 * uma subseção continua pertencendo à seção que a contém.
 */
export function parse(text) {
  const linhas = stripFencedBlocks(text).split("\n");
  const headings = [];

  linhas.forEach((linha, indice) => {
    const achado = linha.match(HEADING);
    if (!achado) return;
    headings.push({ level: achado[1].length, title: achado[2], line: indice + 1, paths: [], body: "" });
  });

  headings.forEach((heading, ordem) => {
    const seguinte = headings.slice(ordem + 1).find(({ level }) => level <= heading.level);
    const fim = seguinte ? seguinte.line - 1 : linhas.length;
    heading.body = linhas.slice(heading.line, fim).join("\n");
    heading.paths = [...heading.body.matchAll(ARQUIVO_CITADO)].map((achado) => achado[1]);
  });

  return { headings };
}

// Onde um nome puro é procurado. O diretório do SDD é o único lugar em que o nome sem caminho é
// inequívoco, e é lá que a Fase 6 manda atualizar — então é onde se resolve.
//
// A lista é FECHADA de propósito: procurar o nome em qualquer diretório faria `README.md` casar com
// um README de subpasta qualquer, e a regra passaria a aceitar o arquivo errado.
const RAIZES = ["", "docs/sdd"];

// Caminho que escapa da raiz não conta como fato, mesmo que o arquivo exista: um fato que vive fora
// do repositório não é conferível por quem clonar. É a mesma guarda que o eixo de proveniência tem,
// com a mesma razão escrita lá — e ela faltava aqui, apontado pelo gate de fechamento.
//
// A barra INICIAL de um caminho é aceita e normalizada, porque `/docs/sdd/x.md` e `docs/sdd/x.md`
// são a mesma citação para quem escreve. **A justificativa é por convenção, não por medição:** os
// títulos em disco escrevem "Diff do `/docs/sdd/`", mas aquilo é **diretório sem extensão** e o
// regex de caminho não o captura de nenhum jeito — o gate de fechamento apontou que o comentário
// anterior usava essa forma como evidência do que ela não prova.
function resolve(repo, citado) {
  const raiz = path.resolve(repo ?? ".");
  const relativo = citado.replace(/^\/+/, "");
  return RAIZES.some((prefixo) => {
    const alvo = path.resolve(raiz, prefixo, relativo);
    // A citação sempre termina em `.extensão`, então `alvo` nunca é a própria raiz — a contenção
    // basta, e comparar com a raiz seria ramo inalcançável.
    if (!alvo.startsWith(raiz + path.sep)) return false;
    return existsSync(alvo);
  });
}

// A declaração de que não houve alteração, por LOCUÇÃO e não por heurística de proximidade.
//
// **A versão anterior era heurística — negação + palavra de mudança numa janela de 40 caracteres —,
// e ela errava nos dois sentidos.** O gate de fechamento demonstrou os dois com frase exata:
//
//   - **falso NEGATIVO, o pior:** a alternativa nua `no` é preposição corrente em português, então
//     *"Entrou **no** README a **mudança** de superfície"* satisfazia a exceção e a seção **passava**
//     — exatamente onde o `CA-6` manda reprovar, e sem declarar nada;
//   - **falso positivo:** *"**Não** houve alteração"*, que é a negação mais canônica em português e a
//     redação que o próprio `CA-6` usa, **não** casava. `\b` em JavaScript é definido sobre
//     `[A-Za-z0-9_]`, e "ã" não é word char — "não" não contém a sequência "no".
//
// Locução fechada não tem nenhum dos dois problemas: ela case o que alguém escreve para **declarar**
// que nada mudou, e não a coincidência de duas palavras perto uma da outra.
//
// **Nos dois idiomas, porque o validador viaja.** O ADR-0003 faz o idioma do artefato configurável:
// num projeto em inglês, uma feature que honestamente não mexeu em documentação não teria como
// declarar isso e levaria `DOC-4`. As quatro primeiras formas foram **medidas em disco**; as demais
// são as equivalentes naturais, e o teste afirma cada uma.
const DECLARACOES_DE_NADA = [
  // Medidas em disco nos completions deste projeto.
  "nenhuma alteracao", "nenhuma atualizacao", "nada mais da sdd mudou", "nada mais mudou",
  // Equivalentes em português.
  "nenhuma mudanca", "nenhuma modificacao", "nada mudou", "nao houve alteracao",
  "nao houve mudanca", "nao houve atualizacao", "sem alteracao", "sem mudanca",
  // Inglês.
  "no change", "no changes", "no update", "no updates", "no documentation change",
  "nothing changed", "nothing else changed", "no amendment", "unchanged",
];

// O corpo passa pelo MESMO `semAcento` do título — sem isso, "não houve alteração" nunca casaria uma
// locução escrita sem acento, e o acento é escolha de quem escreve, não fato do artefato.
const declaraQueNadaMudou = (corpo) => {
  const limpo = semAcento(corpo);
  return DECLARACOES_DE_NADA.some((locucao) => limpo.includes(locucao));
};

/**
 * As regras sobre a documentação declarada. **Só roda no artefato de fechamento** — quem decide isso
 * é quem chama, passando o caminho, e a guarda aqui é a segunda trava.
 *
 * `repo` serve apenas para resolver o caminho citado. Nenhuma descoberta de artefato acontece aqui:
 * quem descobre é o `spec-status`, e duplicar essa descoberta foi reprovação de gate numa fatia
 * anterior.
 */
export function check(parsed, file, { repo } = {}) {
  if (path.basename(file) !== COMPLETION_FILE) return [];

  const secoes = parsed.headings.filter(({ title }) => isDiffHeading(title));
  if (!secoes.length) return [semDeclaracaoDeDiff(file)];

  // Basta UMA seção com fato. Um fechamento que declare o diff em duas seções — e há um em disco que
  // o faz — não pode ser reprovado por causa da segunda.
  const comFato = secoes.some(({ paths, body }) =>
    paths.some((citado) => resolve(repo, citado)) || declaraQueNadaMudou(body));
  return comFato ? [] : [diffSemFato(secoes[0], file)];
}
