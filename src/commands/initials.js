// Cola do comando `mgr spec initials`. Humble Object: só parse, formatação e exit code; o IO entra por
// `io` e a raiz por `root`. A decisão vive em src/registry.js.
import path from "node:path";
import * as installer from "../installer.js";
import { INITIALS_PATTERN, LOCAL_CONFIG_NAME, readInitials, writeInitials } from "../registry.js";

// `mgr spec initials [--json]` — lê as iniciais pessoais da pessoa (camada pessoal, DT-5).
// `mgr spec initials set <x>` — grava. Sem posicional, lê; o `set` é o único verbo aceito.
export function initials({ root, positional, flags = {}, io, M }) {
  if (positional.length === 0) return initialsRead({ root, flags, io, M });
  if (positional[0] === "set") return initialsSet({ root, positional: positional.slice(1), io, M });
  io.err(M.errorPrefix(M.unknownCommand(`spec initials ${positional[0]}`)));
  return 1;
}

// Leitura (DT-6): `recorded` e `absent` saem 0; `invalid` sai 1, porque um valor escrito a mão que o
// método não reconhece não pode ser tratado como inicial válida por quem consome o JSON.
function initialsRead({ root, flags, io, M }) {
  const core = installer.coreDir("project", root);
  const lida = readInitials(core);
  if (flags.json) {
    const linha = lida.state === "recorded"
      ? { schemaVersion: 1, state: "recorded", initials: lida.initials }
      : lida.state === "absent"
        ? { schemaVersion: 1, state: "absent" }
        : { schemaVersion: 1, state: "invalid", value: lida.value };
    io.out(JSON.stringify(linha));
  } else if (lida.state === "recorded") {
    io.out(M.initialsRecorded(lida.initials));
  } else if (lida.state === "absent") {
    io.out(M.initialsNotRecorded());
  } else {
    io.err(M.initialsInvalid(valorExibido(lida.value)));
  }
  return lida.state === "invalid" ? 1 : 0;
}

const valorExibido = (valor) => (typeof valor === "string" ? valor : JSON.stringify(valor));

// O estado anterior chega em tres formas (DES-1: sem sentinela), e so aqui vira texto.
const textoDoEstado = (estado, M) => {
  if (estado.state === "recorded") return estado.initials;
  if (estado.state === "invalid") return valorExibido(estado.value);
  return M.initialsNone();
};

function initialsSet({ root, positional, io, M }) {
  const core = installer.coreDir("project", root);

  const valor = positional[0];
  if (!valor) {
    io.err(M.errorPrefix(M.initialsSetNeedsValue()));
    return 1;
  }
  // Recusa ANTES de qualquer escrita: valor fora do padrão não toca o `config.local.json`.
  if (!INITIALS_PATTERN.test(valor)) {
    io.err(M.errorPrefix(M.initialsRefused(valor)));
    return 1;
  }

  // LOG-1: informação ANTES e logo depois de alterar estado em disco, como o `origin set`.
  io.out(M.initialsWriting(path.join(core, LOCAL_CONFIG_NAME)));
  const { before, after } = writeInitials(core, valor);
  io.out(M.initialsWritten(textoDoEstado(before, M), after));
  return 0;
}
