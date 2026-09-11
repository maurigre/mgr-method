// Etiqueta de proveniência e marca de pendência num artefato de spec (ADR-0016).
//
// A L1.10 manda toda asserção normativa carregar a origem. Este módulo NÃO cobra essa presença —
// a regra que a cobraria foi rejeitada por decisão de produto, com medição: adesão zero, e o custo
// cairia sobre cada linha escrita para sempre. Aqui se confere só FATO: a etiqueta que está escrita
// tem a forma declarada, e o ponteiro que ela carrega resolve em disco.
//
// Fronteira com o `prov-rules`: este módulo diz o que está escrito e o que resolve; ele não decide
// severidade, não escolhe código de achado e não escreve mensagem. Espelha o par
// `spec-parser`/`spec-rules`.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { stripFencedBlocks } from "./markdown.js";

// As oito formas da L1.10, e quantos argumentos cada uma aceita. `TO DEFINE` está aqui porque a
// lei a lista entre as oito — ela é etiqueta E marca de pendência ao mesmo tempo, e por isso sai
// nas duas listas do `parse`. Não é acidente: "a origem ainda não existe" é uma origem declarada.
const TOKENS = {
  brief: 0,
  user: 0,
  "analogical-extension": 0,
  quarantined: 0,
  "TO DEFINE": 0,
  prd: 1,
  adr: 1,
  code: 2,
};

// As três formas de marca de pendência reconhecidas. Identidade parseável dependendo de idioma é
// DÍVIDA declarada no ADR-0016, não conforto: canonizar uma só obrigaria a migrar o acervo ou a
// reprovar o que existe, e a RN-1 proíbe reprovar.
export const MARK_FORMS = ["TO DEFINE", "A DEFINIR", "A CONFIRMAR"];

// Qualquer par de colchetes numa linha. A triagem pelo vocabulário vem depois: um colchete que não
// abre com token conhecido nem é marca conhecida NÃO é etiqueta e some aqui mesmo. Sem essa
// triagem, todo link de markdown e toda caixa de tarefa viraria candidato a achado.
const COLCHETE = /\[([^\]\n]+)\]/g;

// Resultados de `checkPointer`, em constante para o `prov-rules` casar sem repetir string.
export const POINTER_OK = "ok";
export const POINTER_ESCAPES_ROOT = "escapes-root";
export const POINTER_NO_FILE = "no-file";
export const POINTER_NO_LINE = "no-line";

// Posição de marca é o `]` como ÚLTIMO caractere da linha, e vale igual para etiqueta e para marca
// (Medição E, CHECKPOINT do P0 em 2026-09-11).
//
// A definição tolerante — que aceitaria crase ou pontuação depois do `]` — foi medida e descartada:
// ela produz achado de ERRO sobre `[prd:<seção>]` e `[code:<caminho>:<linha>]` escritos com
// marcador de exemplo no lugar do caminho, dentro de features já fechadas. O invariante 3 da spec
// proíbe reprovar artefato existente.
//
// Isto também é o que dispensa um removedor de código inline: etiqueta entre crases nunca está em
// posição de marca, porque a crase de fechamento vem depois do `]`. O `src/markdown.js` recusou
// esse removedor de propósito, e a razão continua escrita lá.
//
// Espaço em branco depois do `]` continua contando como posição de marca: espaço à direita é
// invisível para quem escreve, e reprovar por ele seria um falso negativo impossível de enxergar.
const emPosicaoDeMarca = (linha, fim) => linha.slice(fim).trim() === "";

// A forma da etiqueta, sem tocar em disco. Linha zero ou negativa é MALFORMADA, não ponteiro
// quebrado (DT-3): o defeito está no que foi escrito, e mandar o autor procurar o arquivo o faria
// procurar a coisa errada.
function formaDaEtiqueta(token, argumento) {
  const esperado = TOKENS[token];
  if (esperado === 0) return { wellFormed: argumento === null, pointer: null };
  if (argumento === null) return { wellFormed: false, pointer: null };

  if (token === "prd") return { wellFormed: argumento.trim().length > 0, pointer: null };
  if (token === "adr") return { wellFormed: /^\d+$/.test(argumento.trim()), pointer: null };

  // `code:<caminho>:<linha>` — o caminho pode conter `:`, então a linha é o que vem depois do
  // ÚLTIMO `:`. Partir pelo primeiro quebraria qualquer caminho com dois-pontos no nome.
  const corte = argumento.lastIndexOf(":");
  if (corte <= 0) return { wellFormed: false, pointer: null };
  const caminho = argumento.slice(0, corte).trim();
  const numero = argumento.slice(corte + 1).trim();
  if (!caminho || !/^\d+$/.test(numero)) return { wellFormed: false, pointer: null };
  const linha = Number(numero);
  if (linha < 1) return { wellFormed: false, pointer: null };
  return { wellFormed: true, pointer: { path: caminho, line: linha } };
}

// Lê o texto e devolve o que está escrito, sem julgar. Puro: nenhum IO.
//
// Bloco cercado sai antes, pelo `stripFencedBlocks` de `src/markdown.js` — a fonte única que a
// fatia 2 criou. Exemplo dentro de cerca é documentação, não asserção, e contar a etiqueta de um
// exemplo faria a spec que documenta o formato declarar proveniência por acidente.
export function parse(texto) {
  const labels = [];
  const marks = [];

  stripFencedBlocks(texto).split("\n").forEach((linha, indice) => {
    let achado;
    COLCHETE.lastIndex = 0;
    while ((achado = COLCHETE.exec(linha))) {
      const conteudo = achado[1].trim();
      const fim = achado.index + achado[0].length;
      const posicao = { line: indice + 1, column: achado.index + 1, atMarkPosition: emPosicaoDeMarca(linha, fim) };

      if (MARK_FORMS.includes(conteudo)) marks.push({ raw: achado[0], form: conteudo, ...posicao });

      const separador = conteudo.indexOf(":");
      const token = separador === -1 ? conteudo : conteudo.slice(0, separador);
      if (!Object.hasOwn(TOKENS, token)) continue;
      const argumento = separador === -1 ? null : conteudo.slice(separador + 1);
      labels.push({ raw: achado[0], token, argument: argumento, ...posicao, ...formaDaEtiqueta(token, argumento) });
    }
  });

  return { labels, marks };
}

// O número de linhas REAIS do arquivo. O `\n` final não abre uma linha vazia a mais, e contá-lo
// deixaria passar um ponteiro para exatamente uma linha além do fim — o limite que a CA-2 mede.
//
// Arquivo de zero bytes tem ZERO linhas, não uma vazia. Sem esta guarda, `[code:vazio.js:1]`
// resolveria como válido, e a DT-3 diz que linha que não existe é linha maior que o número de
// linhas do arquivo — num arquivo vazio, isso é qualquer linha.
function contarLinhas(conteudo) {
  if (!conteudo) return 0;
  const linhas = conteudo.split("\n");
  if (linhas.length > 1 && linhas[linhas.length - 1] === "") linhas.pop();
  return linhas.length;
}

// Confere o ponteiro de uma etiqueta `code` contra o disco, ancorado na raiz do repositório
// (`repoRoot` do ADR-0015, resolvido na borda e recebido aqui — INV-5: a borda não faz IO, e o
// núcleo não descobre a raiz duas vezes).
//
// GITIGNORED CONTA COMO EXISTENTE: `specs/` é gitignored neste projeto e é exatamente onde as
// asserções vivem; conferir contra o que o git rastreia reprovaria toda âncora legítima. O
// trade-off é que o resultado depende da máquina, e a saída não promete portabilidade.
//
// A ordem das checagens é deliberada. O escape da raiz é decidido ANTES de qualquer `stat`: um
// caminho que aponta para fora do projeto não deve ser tocado, e juntá-lo com "o arquivo sumiu"
// mandaria o autor procurar a coisa errada.
export function checkPointer(repo, label) {
  const { path: relativo, line } = label.pointer;
  const raiz = path.resolve(repo);
  const alvo = path.resolve(raiz, relativo);
  if (alvo !== raiz && !alvo.startsWith(raiz + path.sep)) {
    return { outcome: POINTER_ESCAPES_ROOT, path: relativo, line, lines: null };
  }

  // Diretório não é arquivo: sem esta guarda o `readFileSync` lançaria `EISDIR` e o comando
  // morreria no lugar de devolver um achado.
  let conteudo;
  try {
    if (!statSync(alvo).isFile()) return { outcome: POINTER_NO_FILE, path: relativo, line, lines: null };
    conteudo = readFileSync(alvo, "utf8");
  } catch {
    return { outcome: POINTER_NO_FILE, path: relativo, line, lines: null };
  }

  const linhas = contarLinhas(conteudo);
  if (line > linhas) return { outcome: POINTER_NO_LINE, path: relativo, line, lines: linhas };
  return { outcome: POINTER_OK, path: relativo, line, lines: linhas };
}
