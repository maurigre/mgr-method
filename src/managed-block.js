// Mecânica genérica de um bloco que o MGR gerencia dentro de um arquivo de texto do USUÁRIO (DT-1).
// O `.gitignore` é o primeiro consumidor; o módulo não conhece nenhum arquivo específico.
//
// `block` é o array completo, com as DUAS linhas de borda como primeiro e último elementos. A marca
// de posse são essas duas linhas. Tudo o que está fora do bloco é preservado byte a byte: a escrita
// troca só as linhas do bloco, e a remoção tira só essas linhas.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// CRLF não muda a comparação: a marca é reconhecida com ou sem o `\r` do fim da linha.
const semCr = (linha) => linha.replace(/\r$/, "");

const lerTexto = (file) => (existsSync(file) ? readFileSync(file, "utf8") : null);

// O bloco novo usa o fim de linha que o arquivo já usa, e as linhas vizinhas são copiadas como estão
// (com o `\r` delas, se houver): é isso que mantém o resto do arquivo byte a byte.
const eolDe = (texto) => (texto.includes("\r\n") ? "\r\n" : "\n");
const antesDoBloco = (linhas, start) => linhas.slice(0, start).map((linha) => linha + "\n").join("");
const depoisDoBloco = (linhas, end) => linhas.slice(end + 1).join("\n");
// Terminador da linha de fecho, que o bloco substituído carregava. Só existe se há conteúdo depois.
const terminadorDoFecho = (linhas, end) => (linhas[end].endsWith("\r") ? "\r\n" : "\n");

/**
 * Posição do bloco nas linhas: `{ found: false }` ou `{ found: true, start, end }`. Bloco aberto e
 * sem fecho é recusado: acrescentar outro bloco por cima dele duplicaria a marca, e remover às cegas
 * apagaria linhas que não são do MGR.
 */
export function locateBlock(lines, block, file) {
  const abertura = block[0];
  const fecho = block[block.length - 1];
  const start = lines.findIndex((linha) => semCr(linha) === abertura);
  if (start === -1) return { found: false };
  const end = lines.findIndex((linha, i) => i > start && semCr(linha) === fecho);
  if (end === -1) {
    throw new Error(`bloco do mgr-method sem linha de fecho em ${file}; corrija o arquivo à mão`);
  }
  return { found: true, start, end };
}

/**
 * Estado do bloco e as linhas do arquivo, numa leitura só: `state` é `no-file`, `absent` (arquivo sem
 * as marcas), `current` (marcas presentes e o miolo igual ao de `block`) ou `outdated` (marcas
 * presentes, miolo diferente); `lines` são as linhas sem o `\r` final, vazias quando não há arquivo.
 * Quem precisa ler o arquivo além do bloco (o `.gitignore`, para as linhas do time) usa `lines` em vez
 * de lê-lo de novo.
 */
export function inspectBlock(file, block) {
  const texto = lerTexto(file);
  if (texto === null) return { state: "no-file", lines: [] };

  const linhas = texto.split("\n");
  const lines = linhas.map(semCr);
  const posicao = locateBlock(linhas, block, file);
  if (!posicao.found) return { state: "absent", lines };

  const atual = lines.slice(posicao.start + 1, posicao.end);
  const esperado = block.slice(1, -1);
  const igual = atual.length === esperado.length && atual.every((linha, i) => linha === esperado[i]);
  return { state: igual ? "current" : "outdated", lines };
}

// Só o estado (ver `inspectBlock`).
export function blockState(file, block) {
  return inspectBlock(file, block).state;
}

// Idempotente: troca o bloco no lugar, ou acrescenta ao fim. Sem bloco e sem arquivo, cria o arquivo
// (e o diretório pai, se faltar).
export function writeBlock(file, block) {
  const texto = lerTexto(file) ?? "";

  const eol = eolDe(texto);
  const bloco = block.join(eol);
  const linhas = texto.split("\n");
  const posicao = locateBlock(linhas, block, file);
  let atualizado;
  if (posicao.found) {
    const { start, end } = posicao;
    const temDepois = end + 1 < linhas.length;
    atualizado = antesDoBloco(linhas, start) + bloco
      + (temDepois ? terminadorDoFecho(linhas, end) + depoisDoBloco(linhas, end) : "");
  } else if (texto === "") {
    atualizado = bloco + eol;
  } else {
    // Arquivo sem quebra final ganha a quebra antes do bloco; o resto do conteúdo fica como estava.
    const separador = texto.endsWith("\n") ? "" : eol;
    atualizado = texto + separador + bloco + eol;
  }

  if (atualizado !== texto) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, atualizado, "utf8");
  }
  return file;
}

// Remove só o bloco. Se o arquivo ficar só com espaço em branco, apaga o arquivo: foi o MGR que o
// criou, e é o mesmo critério do `removeHook`. Devolve `{ outcome, file }`: `removed` (bloco tirado),
// `absent` (arquivo sem o bloco, intocado) ou `no-file` (não há o arquivo).
export function removeBlock(file, block) {
  const texto = lerTexto(file);
  if (texto === null) return { outcome: "no-file", file };

  const linhas = texto.split("\n");
  const posicao = locateBlock(linhas, block, file);
  if (!posicao.found) return { outcome: "absent", file };

  const restante = antesDoBloco(linhas, posicao.start) + depoisDoBloco(linhas, posicao.end);
  if (restante.trim() === "") {
    rmSync(file, { force: true });
    return { outcome: "removed", file };
  }
  writeFileSync(file, restante, "utf8");
  return { outcome: "removed", file };
}
