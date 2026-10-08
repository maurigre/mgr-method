// IO de PROCESSO dos hooks (stdin, fd de saída, git). Fica na borda, sem dependência externa: só
// `node:*`. A cola testável em src/commands/hooks.js recebe estas funções por injeção (`proc`).
import { writeSync } from "node:fs";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import process from "node:process";

// Escrita SÍNCRONA nos dois canais do hook, e isto não é preferência de estilo: o processo termina em
// `process.exit`, e em pipe o stdout do Node é assíncrono — o `write` enfileira e a saída pode ser
// truncada antes do flush. Perder o envelope aqui é perder a única mensagem que chega ao usuário.
// Tentativas em canal que não drenou. NÃO é medição: é escolha de desenho declarada. Existe porque
// dentro do hook a espera é limitada pelo teto de 15s da entrada, mas numa invocação à mão com o
// stdout redirecionado para um pipe non-blocking não há teto nenhum — girar sem limite queimaria CPU
// até alguém ler. Passado o teto, trata-se o canal como indisponível, que é o que o desenho já faz
// para qualquer outro erro.
const MAX_TENTATIVAS_DE_ESCRITA = 1000;

// Erros retentáveis: canal non-blocking que ainda não drenou, e chamada interrompida por sinal. Os
// dois são "tente de novo", e não "o canal morreu".
const RETENTAVEIS = new Set(["EAGAIN", "EINTR"]);

// Devolve se a mensagem saiu INTEIRA. O retorno importa: escrita parcial seguida de canal fechado
// deixaria um envelope truncado, e quem chamou precisa saber para não agir como se tivesse avisado.
export const escreverSync = (fd, texto) => {
  const bytes = Buffer.from(texto, "utf8");
  let escrito = 0;
  let tentativas = 0;
  // Laço porque `writeSync` devolve QUANTOS bytes escreveu: em pipe a escrita pode ser parcial, e
  // parar na primeira chamada truncaria a mensagem no meio de um JSON.
  while (escrito < bytes.length) {
    try {
      const n = writeSync(fd, bytes, escrito);
      // Zero byte escrito sem erro não progride: repetir seria laço infinito.
      if (n <= 0) return false;
      escrito += n;
      tentativas = 0;
    } catch (erro) {
      if (!RETENTAVEIS.has(erro.code)) return false;
      if (++tentativas > MAX_TENTATIVAS_DE_ESCRITA) return false;
    }
  }
  return true;
};

// O payload chega por stdin. Vazio e JSON inválido são entrada legítima de uma sessão estranha, não
// erro do usuário: viram objeto vazio, e o gatilho desconhecido não bloqueia (`decide`).
export async function lerPayload() {
  const pedacos = [];
  for await (const pedaco of process.stdin) pedacos.push(pedaco);
  try {
    return JSON.parse(Buffer.concat(pedacos).toString("utf8")) ?? {};
  } catch {
    return {};
  }
}

export const modificados = (repo) => {
  try {
    // `stdio` ignora o stderr do git de propósito: em repositório sem git ele imprime "not a git
    // repository", e isso cairia no contexto do agente — o ruído que a DT-8 quer impedir.
    return execFileSync("git", ["status", "--short"], {
      cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n").map((linha) => linha.trim()).filter(Boolean);
  } catch {
    return [];
  }
};
