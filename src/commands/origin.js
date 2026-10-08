// Cola do comando `mgr origin set`. Humble Object: só parse, formatação e exit code; o IO entra por
// `io` e a raiz por `root`. A decisão vive em src/registry.js.
import * as installer from "../installer.js";
import { ORIGINS, writeOrigin } from "../registry.js";

// `mgr origin set` — grava a ORIGEM do projeto e diz o que passou a valer.
//
// Sem `--scope`: a origem e fato do PROJETO, e um metodo instalado globalmente que revisa o projeto
// X precisa ler a origem de X. Sem leitor (`mgr origin` sozinho): capacidade sem demanda medida nao
// entra, e o estado ja e visivel na saida deste comando, no arquivo, e no cabecalho do relatorio de
// review.
export function origin({ root, positional, io, M }) {
  if (positional[0] === "set") return originSet({ root, positional: positional.slice(1), io, M });
  // A unica forma valida e `origin set <valor>`; a mensagem mostra a forma certa em vez de so
  // recusar, porque quem digita `mgr origin brownfield` esqueceu o `set` e nao errou o valor.
  io.err(M.errorPrefix(M.originSetNeedsValue(ORIGINS.join(" | "))));
  return 1;
}

function originSet({ root, positional, io, M }) {
  const repo = root;
  const core = installer.coreDir("project", repo);

  const valor = positional[0];
  if (!valor) {
    io.err(M.errorPrefix(M.originSetNeedsValue(ORIGINS.join(" | "))));
    return 1;
  }
  if (!ORIGINS.includes(valor)) {
    io.err(M.errorPrefix(M.originUnknown(valor, ORIGINS.join(" | "))));
    return 1;
  }

  // Instalacao ausente NAO e erro: e o caso do metodo instalado em escopo global, e o `writeConfig`
  // ja cria o diretorio. Mas o usuario ouve, para nao sair achando que configurou o lugar errado.
  if (!installer.detectPrior("project", repo)) io.out(M.originNoInstall(core));

  // LOG-1: informacao ANTES e logo depois de alterar estado em disco. Sem a de antes, um config
  // somente-leitura devolve so o erro cru e ninguem sabe qual arquivo o comando tentou escrever.
  io.out(M.originWriting(core));
  const { antes, depois } = writeOrigin(core, valor);
  io.out(M.originWritten(antes.estado === "ausente" ? "—" : antes.valor, depois));
  return 0;
}
