#!/usr/bin/env node
// Runtime do MGR dentro do projeto (ADR-0023, DT-4/DT-5): borda fina sobre a mesma cola da CLI do pacote.
import console from "node:console";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { RUNTIME_DIR_NAME, readVersion } from "../src/bundle.js";
import { agents } from "../src/commands/agents.js";
import { doctor } from "../src/commands/doctor.js";
import { detectHook, precompactHook } from "../src/commands/hooks.js";
import { origin } from "../src/commands/origin.js";
import { sddCheck } from "../src/commands/sdd-check.js";
import { specNext, specStatus, specValidate } from "../src/commands/spec.js";
import { parseArgs } from "../src/cli-args.js";
import { ids as engineIds } from "../src/engines/index.js";
import { readManifest } from "../src/manifest.js";
import { getMessages } from "../src/messages.js";
import { projectRoot } from "../src/project-root.js";
import { detectUserLanguage } from "../src/prompts.js";
import { escreverSync, lerPayload, modificados } from "./hook-io.js";

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
  const table = { status: specStatus, validate: specValidate, next: specNext };
  if (!table[sub]) {
    console.error(base.M.runtimeUnknownSpecSub(sub || ""));
    return 1;
  }
  return table[sub]({ ...base, positional: positional.slice(1) });
}

async function main() {
  const [, , command, ...rest] = process.argv;
  const { flags, positional, unknownFlag } = parseArgs(rest, { engines: engineIds() });
  const root = projectRoot(process.cwd()).root;
  const manifest = readManifestSafe(root);
  const lang = flags.userLanguage || manifest.userLanguage || detectUserLanguage(process.env);
  const self = path.relative(root, fileURLToPath(import.meta.url)).split(path.sep).join("/");
  const invocation = `node ${self}`;
  const lifecycle = `npx mgr-method@${manifest.version ?? "latest"}`;
  const M = getMessages(lang, { invocation, lifecycle });
  if (unknownFlag) { console.error(M.unknownFlag(unknownFlag)); return 1; }
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
      case "doctor": return doctor(base);
      case "sdd-check": return sddCheck(base);
      case "detect":
        if (!flags.hook) { console.error(M.runtimeDetectNeedsHook()); return 1; }
        try { return await detectHook({ ...base, proc: hookProc }); } catch { return 0; }
      case "precompact": return await precompactHook({ ...base, positional: [], proc: hookProc });
      case "version": case "--version": case "-v": {
        let version = manifest.version;
        try { version = readVersion(); } catch { /* fica a versão do manifesto */ }
        console.log(`mgr-method ${version ?? "unknown"} (runtime do projeto)`);
        if (manifest.version && version !== manifest.version) {
          console.error(`runtime em ${version}, manifesto em ${manifest.version}: rode npx mgr-method@${manifest.version} update`);
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
    console.error(M.errorPrefix(commandError.message));
    return 1;
  }
}

main().then((code) => process.exit(code ?? 0));
