// Cola do comando `mgr runtime-versioning`. Humble Object: só parse, formatação e exit code; o IO entra
// por `io`, a raiz por `root`, a leitura do git por `gitIndex` e as linhas da raiz por `rootIgnoredLines` (função, chamada só no `set versioned`).
// A decisão vive em src/registry.js e src/builder.js (DT-4, DT-7).
import path from "node:path";
import { RUNTIME_IGNORE_FILE, RUNTIME_VERSIONING } from "../catalog.js";
import { runtimeIgnoreEffect, runtimeIgnoreFileFor, runtimeIgnoreState, removeRuntimeIgnore, writeRuntimeIgnore } from "../builder.js";
import * as installer from "../installer.js";
import { configPath, readRuntimeVersioning, writeRuntimeVersioning } from "../registry.js";

export function runtimeVersioning({ root, positional, flags = {}, io, M, gitIndex, rootIgnoredLines = () => [] }) {
  if (positional.length === 0) return rvRead({ root, flags, io, M });
  if (positional[0] === "set") return rvSet({ root, positional: positional.slice(1), io, M, gitIndex, rootIgnoredLines });
  io.err(M.errorPrefix(M.rvSetNeedsValue(RUNTIME_VERSIONING.join(" | "))));
  return 1;
}

const rawRuntimeValue = (value) => (typeof value === "string" ? value : JSON.stringify(value));

// DT-11: valor gravado invalido recusa ANTES de escrever. Lanca (TS-3): o `catch` do `main` imprime
// a mensagem com o prefixo de erro e sai 1, entao quem chama nao decide nada.
export function refuseInvalidRuntimeVersioning({ scope, core, repo, M }) {
  if (scope !== "project") return;
  const gravada = readRuntimeVersioning(core);
  if (gravada.state !== "invalid") return;
  throw new Error(M.rvInvalidRefused(posixRelative(repo, configPath(core)), rawRuntimeValue(gravada.value)));
}

// Leitura (DT-7): diz o que está GRAVADO; `invalid` sai 1.
function rvRead({ root, flags, io, M }) {
  const lida = readRuntimeVersioning(installer.coreDir("project", root));
  if (flags.json) {
    const linha = lida.state === "recorded"
      ? { schemaVersion: 1, state: "recorded", value: lida.value }
      : lida.state === "absent"
        ? { schemaVersion: 1, state: "absent", default: "unversioned" }
        : { schemaVersion: 1, state: "invalid", value: lida.value };
    io.out(JSON.stringify(linha));
  } else if (lida.state === "recorded") {
    io.out(M.rvRecorded(lida.value));
  } else if (lida.state === "absent") {
    io.out(M.rvNotRecorded);
  } else {
    io.out(M.rvInvalid(rawRuntimeValue(lida.value)));
  }
  return lida.state === "invalid" ? 1 : 0;
}

function rvSet({ root, positional, io, M, gitIndex, rootIgnoredLines }) {
  const valid = RUNTIME_VERSIONING.join(" | ");
  const valor = positional[0];
  if (!valor) {
    io.err(M.errorPrefix(M.rvSetNeedsValue(valid)));
    return 1;
  }
  if (!RUNTIME_VERSIONING.includes(valor)) {
    io.err(M.errorPrefix(M.rvUnknown(valor, valid)));
    return 1;
  }
  const core = installer.coreDir("project", root);
  if (!installer.detectPrior("project", root)) {
    io.err(M.errorPrefix(M.rvNoInstall(".mgr-core")));
    return 1;
  }

  // Config ilegivel e recusa do passo 1 (DT-7): a leitura lanca ANTES da linha "gravando".
  readRuntimeVersioning(core);
  // `.gitignore` da raiz com bloco aberto e recusa do passo 1, como no `install` (S-1): as linhas sao
  // lidas antes da primeira escrita, e so com `versioned`, o unico caminho que as usa.
  const linhasDaRaiz = valor === "versioned" ? rootIgnoredLines() : [];
  io.out(M.rvWriting(core));
  const { antes, depois } = writeRuntimeVersioning(core, valor);
  io.out(M.rvWritten(antes.estado === "ausente" ? "—" : rawRuntimeValue(antes.valor), depois));

  const runtime = installer.runtimeDir("project", root);
  const relDir = posixRelative(root, runtime);
  const state = runtimeIgnoreState(runtime);
  if (state === "no-runtime") {
    io.out(M.rvRuntimeAbsent(relDir));
    return 0;
  }

  const effect = runtimeIgnoreEffect({ state, ignoreFile: runtimeIgnoreFileFor(valor) });
  if (effect !== "none") applyEffect({ rel: `${relDir}/${RUNTIME_IGNORE_FILE}`, runtime, effect, io, M });

  if (valor === "versioned") {
    for (const linha of linhasDaRaiz) io.out(M.gitignoreTeamIgnored(linha));
  } else {
    const out = (texto) => io.out(texto);
    reportGitIndex({ repo: root, relDir, gitIndex, M, info: out, warn: out });
  }
  return 0;
}

// Caminho POSIX relativo à raiz: as mensagens e o git usam `/`.
export function posixRelative(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

function applyEffect({ rel, runtime, effect, io, M }) {
  reportRuntimeIgnoreBefore({ effect, rel, M, out: (texto) => io.out(texto) });
  if (effect === "remove") removeRuntimeIgnore(runtime);
  else writeRuntimeIgnore(runtime);
  reportRuntimeIgnoreAfter({ effect, rel, M, out: (texto) => io.out(texto) });
}

// LOG-1: a linha de ANTES do efeito no arquivo de ignorar; `none` não diz nada.
export function reportRuntimeIgnoreBefore({ effect, rel, M, out }) {
  if (effect === "write") out(M.runtimeIgnoreToWrite(rel));
  else if (effect === "rewrite") out(M.runtimeIgnoreToRewrite(rel));
  else if (effect === "remove") out(M.runtimeIgnoreToRemove(rel));
}

// LOG-1: a linha de DEPOIS, logo após a escrita.
export function reportRuntimeIgnoreAfter({ effect, rel, M, out }) {
  if (effect === "write" || effect === "rewrite") out(M.runtimeIgnoreWritten(rel));
  else if (effect === "remove") out(M.runtimeIgnoreRemoved(rel));
}

// A escolha gravada (`answered`) ou o padrão aplicado (`default`); `recorded` e global não dizem nada.
export function reportRuntimeChoice({ runtimeVersioning: escolha, M, out }) {
  if (escolha?.source === "answered") out(M.runtimeChoiceRecorded(escolha.value));
  else if (escolha?.source === "default") out(M.runtimeDefaultApplied);
}

// A linha do plano com a fonte da escolha; `null` quando não se aplica (escopo global).
export function planRuntimeLine({ runtimeVersioning: escolha, M }) {
  if (!escolha || escolha.source === "not-applicable") return null;
  const fonte = {
    answered: M.runtimeSourceAnswered, recorded: M.runtimeSourceRecorded, default: M.runtimeSourceDefault,
  }[escolha.source];
  return escolha.value === "unversioned" ? M.planRuntimeUnversioned(fonte) : M.planRuntimeVersioned(fonte);
}

// DT-8 (LOG-2): a linha "antes" sempre sai; o git só é lido, nunca alterado (RN-10).
export function reportGitIndex({ repo, relDir, gitIndex, M, info, warn }) {
  info(M.gitIndexChecking(relDir));
  const lido = gitIndex(repo, relDir);
  if (lido.state !== "listed") {
    info(M.gitIndexUnavailable);
  } else if (lido.files.length === 0) {
    info(M.gitIndexNone(relDir));
  } else {
    info(M.gitIndexListed(relDir, lido.files.length));
    warn(M.runtimeTracked(relDir));
  }
}
