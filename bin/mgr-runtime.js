#!/usr/bin/env node
// Runtime do MGR dentro do projeto (ADR-0023, DT-4/DT-5): borda fina sobre a mesma cola da CLI do pacote.
import console from "node:console";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { RUNTIME_DIR_NAME, readVersion } from "../src/core/bundle.js";
import { agents } from "../src/commands/agents.js";
import { doctor } from "../src/commands/doctor.js";
import { detectHook, precompactHook } from "../src/commands/hooks.js";
import { initials } from "../src/commands/initials.js";
import { instructions } from "../src/commands/instructions.js";
import { origin } from "../src/commands/origin.js";
import { review } from "../src/commands/review.js";
import { sddCheck } from "../src/commands/sdd-check.js";
import { specArchive, specNext, specStatus, specValidate } from "../src/commands/spec.js";
import { PACKAGE_COMMANDS, RUNTIME_COMMANDS, checkFlags, parseArgs, resolveEntry } from "../src/core/cli-args.js";
import { ids as engineIds } from "../src/engines/index.js";
import { readManifest, readUserLanguage } from "../src/install/manifest.js";
import { renderError } from "../src/core/errors.js";
import { getMessages } from "../src/core/messages.js";
import { projectRoot } from "../src/sdd/project-root.js";
import { confirmInTerminal, detectUserLanguage } from "../src/install/prompts.js";
import { escreverSync, lerPayload, modificados } from "./hook-io.js";
import { createReviewIo } from "./review-io.js";

const hookProc = {
  escreverSync, lerPayload, modificados, stdoutFd: 1, stderrFd: 2,
  write: (texto) => process.stdout.write(texto),
};

const identity = (texto) => texto;

function readManifestSafe(root) {
  try {
    return readManifest(path.join(root, RUNTIME_DIR_NAME)) ?? {};
  } catch {
    return {};
  }
}

function specCommand(base, positional) {
  const sub = positional[0];
  // O archive recebe a borda do git: com a revisão externa ligada, a condição (4) confere o HEAD (DT-13).
  const arquivar = (contexto) => specArchive({ ...contexto, reviewIo: createReviewIo() });
  const table = { status: specStatus, validate: specValidate, next: specNext, initials, archive: arquivar };
  if (!table[sub]) {
    console.error(base.M.runtimeUnknownSpecSub(sub || ""));
    return 1;
  }
  return table[sub]({ ...base, positional: positional.slice(1) });
}

// No runtime, so o que nao muda a politica do projeto: revisar e consultar. Ligar, desligar, consentir e
// configurar sao do ciclo de vida (DT-14), e consentir exige um humano no terminal.
const REVIEW_NO_RUNTIME = ["external", "status"];

function reviewCommand(base, positional, lang) {
  const sub = positional[0];
  if (sub !== undefined && !REVIEW_NO_RUNTIME.includes(sub)) {
    base.io.err(base.M.runtimeLifecycleRefused(`review ${sub}`));
    return 1;
  }
  return review({ ...base, reviewIo: createReviewIo(), confirm: confirmInTerminal({}, false), language: lang });
}

async function main() {
  const [, , command, ...rest] = process.argv;
  const { flags, positional, unknownFlag, missingValue, seen } = parseArgs(rest, { engines: engineIds() });
  const root = projectRoot(process.cwd()).root;
  const manifest = readManifestSafe(root);
  // DT-4: o idioma nao depende dos outros campos do manifesto; um manifesto malformado nao o apaga.
  const declarado = readUserLanguage(path.join(root, RUNTIME_DIR_NAME));
  const lang = flags.userLanguage || (declarado.state === "declared" ? declarado.value : null) || detectUserLanguage(process.env);
  const self = path.relative(root, fileURLToPath(import.meta.url)).split(path.sep).join("/");
  const invocation = `node ${self}`;
  const lifecycle = `npx mgr-method@${manifest.version ?? "latest"}`;
  const M = getMessages(lang, { invocation, lifecycle });
  if (unknownFlag) { console.error(M.unknownFlag(unknownFlag)); return 1; }
  // Flag de valor sem valor: só no comando com entrada no runtime; o de ciclo de vida mantém a frase dele (P8).
  if (missingValue && resolveEntry(RUNTIME_COMMANDS, command, positional, seen).state === "entry") {
    console.error(M.flagNeedsValue(missingValue));
    return 1;
  }
  // ADR-0040: a flag conhecida que o comando não usa é recusada antes do despacho; a que só um comando de
  // ciclo de vida aceita aponta para o `npx mgr-method@<versão>`.
  const julgamento = checkFlags({ commands: RUNTIME_COMMANDS, fallback: PACKAGE_COMMANDS, command, positional, seen });
  if (!julgamento.ok) {
    const frase = julgamento.lifecycle ? M.flagNotAcceptedLifecycle : M.flagNotAccepted;
    console.error(frase(julgamento.flag, julgamento.entry, julgamento.acceptedBy));
    return 1;
  }
  const base = {
    root,
    cwd: process.cwd(),
    flags,
    positional,
    M,
    io: {
      out: (l) => console.log(l),
      err: (l) => console.error(l),
      style: { dim: identity, yellow: identity, green: identity, red: identity, bold: identity },
      invocation,
      lifecycle,
    },
  };

  try {
    switch (command) {
      case "spec": return specCommand(base, positional);
      case "agents": return agents(base);
      case "origin": return origin(base);
      case "review": return await reviewCommand(base, positional, lang);
      case "doctor": return doctor(base);
      case "sdd-check": return sddCheck(base);
      case "instructions": return instructions(base);
      case "detect":
        if (!flags.hook) { console.error(M.runtimeDetectNeedsHook()); return 1; }
        try { return await detectHook({ ...base, proc: hookProc }); } catch { return 0; }
      case "precompact": return await precompactHook({ ...base, positional: [], proc: hookProc });
      case "version": case "--version": case "-v": {
        let version = manifest.version;
        try { version = readVersion(); } catch { /* fica a versão do manifesto */ }
        console.log(version == null ? M.runtimeVersionLineUnknown : M.runtimeVersionLine(version));
        if (manifest.version && version !== manifest.version) {
          console.error(M.runtimeVersionSkew(version, manifest.version));
        }
        return 0;
      }
      case undefined: case "help": case "--help": case "-h":
        process.stdout.write(M.runtimeHelp);
        return 0;
      default:
        if (command.startsWith("-")) { console.error(M.runtimeUnknownCommand(command)); return 1; }
        console.error(M.runtimeLifecycleRefused(command));
        return 1;
    }
  } catch (commandError) {
    console.error(M.errorPrefix(renderError(M, commandError)));
    return 1;
  }
}

main().then((code) => process.exit(code ?? 0));
