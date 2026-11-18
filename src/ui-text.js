// Descritor de texto mostrado (ADR-0033, DT-12): o nucleo devolve DADO, nunca frase. Um descritor
// diz qual chave de `src/messages.js` monta a frase e com quais parametros, ou carrega um valor que
// sai igual em qualquer idioma (versao, token, valor gravado). Quem renderiza e a borda, com a
// tabela do idioma escolhido; o `--json` renderiza com a tabela `en`, o ingles canonico.
//
// Este modulo nao importa `src/messages.js`: a tabela chega por parametro, para o nucleo nunca
// decidir idioma.

/** Descritor de frase: a chave da mensagem e os parametros dela, sem texto. */
export const text = (key, ...params) => ({ key, params });

/** Descritor de dado: o valor sai como esta, em qualquer idioma. */
export const datum = (value) => ({ value });

/**
 * Monta o texto do descritor com a `tabela` de mensagens do idioma escolhido.
 *
 * A mensagem pode ser texto fixo ou funcao, como em todo `src/messages.js`. Chave que a tabela nao
 * tem cai na chamada e lanca: falha alta, nunca texto vazio.
 */
export const renderText = (tabela, descritor) => {
  if (!("key" in descritor)) return descritor.value;
  const mensagem = tabela[descritor.key];
  return typeof mensagem === "string" ? mensagem : mensagem(...descritor.params);
};
