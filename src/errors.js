// Erros com texto vindo da camada de idioma (ADR-0033, DT-14): todo erro que o usuario le carrega
// uma CHAVE de `src/messages.js` e os parametros dela, nunca uma frase montada no ponto do throw.
// Quem mostra o erro e `renderError`, com a tabela do idioma escolhido. O texto da plataforma
// (`error.message`) nao entra na frase em ramo nenhum (P-10): ele muda por sistema e por versao.
//
// Sem ciclo de imports, pela MNT-2: `errors -> messages -> skill-class`. O ciclo
// `catalog -> errors -> messages -> catalog` que existiu durante a fatia foi quebrado em 2026-11-17
// pelo modulo folha `src/skill-class.js` (achado R4-1).

import { getMessages } from "./messages.js";
import { text, renderText } from "./ui-text.js";

/** Erro com chave de mensagem e parametros; `message` sai no ingles canonico, para log e stack. */
export class LocalizedError extends Error {
  constructor(key, params = [], options) {
    super(renderText(getMessages("en"), text(key, ...params)), options);
    this.key = key;
    this.params = params;
  }
}

/** Defeito de uso: culpa da entrada do usuario. */
export class UsageError extends LocalizedError {}

/** Invariante violada: defeito do MGR, nao da entrada do usuario. */
export class InvariantError extends LocalizedError {}

const hasMessage = (tabela, error) => tabela[error.key] !== undefined;

/** Texto para o usuario, na `tabela` de mensagens do idioma. Nunca usa `error.message`. */
export function renderError(tabela, error) {
  if (error instanceof UsageError && hasMessage(tabela, error)) {
    return renderText(tabela, text(error.key, ...error.params));
  }
  if (error instanceof InvariantError && hasMessage(tabela, error)) {
    return `${tabela.internalDefect}\n${renderText(tabela, text(error.key, ...error.params))}`;
  }
  if (typeof error?.code === "string" && typeof error?.syscall === "string") {
    return typeof error.path === "string"
      ? tabela.systemError(error.code, error.syscall, error.path)
      : tabela.systemErrorNoPath(error.code, error.syscall);
  }
  return tabela.unexpectedError(error?.name ?? "Error");
}
