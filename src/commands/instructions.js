// Cola do comando `instructions` do runtime. Humble Object: só parse, formatação e exit code; o IO entra
// por `io` e a raiz por `root`. A decisão, o arquivo e o estado do bloco vivem em src/instructions.js.
import { installedEngines, instructionStates, planInstructions, writeInstructionBlock } from "../instructions.js";

// `instructions [--json]` — só lê. `instructions write [--engine <id>]` — grava com o consentimento
// já dado pela skill (o comando nunca pergunta).
export function instructions({ root, flags = {}, positional = [], io, M }) {
  if (positional.length === 0) return instructionsList({ root, flags, io, M });
  if (positional[0] === "write") return instructionsWrite({ root, flags, io, M });
  io.err(M.errorPrefix(M.unknownCommand(`instructions ${positional[0]}`)));
  return 1;
}

function instructionsList({ root, flags, io, M }) {
  const { source, engines } = installedEngines(root);
  let constitution;
  let files;
  try {
    constitution = planInstructions(root, { engines }).constitution;
    files = instructionStates(root, engines);
  } catch (erro) {
    io.err(M.errorPrefix(erro.message));
    return 1;
  }
  if (flags.json) {
    io.out(JSON.stringify({ schemaVersion: 1, constitution, source, files }));
  } else {
    files.forEach(({ file, state }) => io.out(M.instructionsStateLine(file, state)));
  }
  return 0;
}

function instructionsWrite({ root, flags, io, M }) {
  const instalados = installedEngines(root).engines;
  let constitution;
  try {
    constitution = planInstructions(root, { engines: instalados }).constitution;
  } catch (erro) {
    io.err(M.errorPrefix(erro.message));
    return 1;
  }
  // Recusas ANTES de qualquer escrita: nada é gravado quando uma delas dispara.
  if (constitution === "absent") {
    io.err(M.errorPrefix(M.instructionsNoConstitution()));
    return 1;
  }
  if (instalados.length === 0) {
    io.err(M.errorPrefix(M.instructionsNoEngine()));
    return 1;
  }
  const pedidos = [...new Set(flags.engines ?? [])];
  const naoInstalado = pedidos.find((engine) => !instalados.includes(engine));
  if (naoInstalado !== undefined) {
    io.err(M.errorPrefix(M.instructionsEngineNotInstalled(naoInstalado, instalados.join(", "))));
    return 1;
  }

  const alvos = pedidos.length > 0 ? pedidos : instalados;
  for (const { engine, file, state } of instructionStates(root, alvos)) {
    if (state === "current") {
      io.out(M.instructionsCurrent(file));
      continue;
    }
    // LOG-1: informação ANTES e logo depois de alterar estado em disco.
    io.out(M.instructionsWriting(file));
    writeInstructionBlock(root, engine);
    io.out(M.instructionsWritten(file));
  }
  return 0;
}
