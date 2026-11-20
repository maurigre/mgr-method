// Utilitários de leitura de markdown compartilhados pelos parsers de artefato (ADR-0013).

// Cerca de bloco: três ou mais crases OU três ou mais tis. O grupo captura a cerca inteira, porque
// o comprimento importa para o fechamento.
const FENCE = /^[ \t]*(`{3,}|~{3,})/;

// Remove blocos cercados antes de parsear: o que está dentro de um exemplo é documentação, não
// conteúdo. Sem isto, uma spec que documenta o próprio formato passa a declará-lo por acidente, e
// as tasks do exemplo viram tasks — foi o que aconteceu com a spec desta feature.
//
// Substitui por vazio em vez de apagar a linha, para que o número de linha do achado continue
// apontando para o lugar certo no arquivo original.
//
// O fechamento segue a regra do CommonMark (§4.5): fecha só cerca do MESMO caractere, de
// comprimento MAIOR OU IGUAL ao da abertura, e sem texto depois. Alternar em qualquer cerca —
// como a primeira versão fazia — reabria o bloco no meio de um exemplo que documenta markdown
// dentro de markdown (```` envolvendo ```), e o resto do exemplo voltava a contar como conteúdo:
// exatamente o buraco que esta função existe para fechar.
//
// Cerca sem fechamento vale até o fim do arquivo, também pelo CommonMark. É deliberado e tem
// custo: um artefato com cerca desbalanceada perde tudo o que vem depois dela. Preferimos isso a
// adivinhar onde o autor quis fechar — e o `SPEC-1`/`PLAN-1` que resulta aponta para o defeito.
//
// NÃO remove código inline: o corpo de um critério legitimamente cita `comando` entre crases, e
// removê-lo mutilaria o texto do achado. O marcador citado em prosa é tratado de outro jeito —
// ele só conta quando ocupa a linha inteira (ver FORMAT_MARKER nos parsers).
export function stripFencedBlocks(text) {
  let abertura = null;
  return text.split("\n").map((linha) => {
    const cerca = linha.match(FENCE);
    if (!abertura) {
      if (!cerca) return linha;
      abertura = { caractere: cerca[1][0], tamanho: cerca[1].length };
      return "";
    }
    const fecha = cerca
      && cerca[1][0] === abertura.caractere
      && cerca[1].length >= abertura.tamanho
      && !linha.slice(cerca[0].length).trim();
    if (fecha) abertura = null;
    return "";
  }).join("\n");
}
