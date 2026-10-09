// Cola do comando `mgr origin set`. Humble Object: só parse, formatação e exit code; o IO entra por
// `io` e a raiz por `root`. A decisão vive em src/registry.js.
import * as installer from "../installer.js";
import { ORIGINS, readOrigin, writeOrigin } from "../registry.js";

// `mgr origin set` — grava a ORIGEM do projeto e diz o que passou a valer.
//
// Sem `--scope`: a origem e fato do PROJETO, e um metodo instalado globalmente que revisa o projeto
// X precisa ler a origem de X. Sem posicional (`mgr origin [--json]`): le a origem gravada. A demanda
// medida e a D-8 (o spec-init precisa ler a origem gravada em vez de perguntar de novo).
export function origin({ root, positional, flags = {}, io, M }) {
  if (positional.length === 0) return originRead({ root, flags, io, M });
  if (positional[0] === "set") return originSet({ root, positional: positional.slice(1), io, M });
  // A unica forma valida e `origin set <valor>`; a mensagem mostra a forma certa em vez de so
  // recusar, porque quem digita `mgr origin brownfield` esqueceu o `set` e nao errou o valor.
  io.err(M.errorPrefix(M.originSetNeedsValue(ORIGINS.join(" | "))));
  return 1;
}

// Leitura (DT-15): `recorded` e `absent` saem 0; `invalid` sai 1, porque um valor escrito a mao que o
// metodo nao reconhece nao pode ser tratado como origem valida por quem consome o JSON.
function originRead({ root, flags, io, M }) {
  const core = installer.coreDir("project", root);
  const lida = readOrigin(core);
  if (flags.json) {
    const linha = lida.state === "recorded"
      ? { schemaVersion: 1, state: "recorded", origin: lida.origin }
      : lida.state === "absent"
        ? { schemaVersion: 1, state: "absent" }
        : { schemaVersion: 1, state: "invalid", value: lida.value };
    io.out(JSON.stringify(linha));
  } else if (lida.state === "recorded") {
    io.out(M.originRecorded(lida.origin));
  } else if (lida.state === "absent") {
    io.out(M.originNotRecorded);
  } else {
    io.out(M.originInvalid(typeof lida.value === "string" ? lida.value : JSON.stringify(lida.value)));
  }
  return lida.state === "invalid" ? 1 : 0;
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
