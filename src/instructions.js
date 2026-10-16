// Bloco que o MGR gerencia no arquivo de instruções do motor do USUÁRIO (DT-2, DT-4): ele aponta toda
// sessão para a constituição (`docs/sdd/CONSTITUTION.md`), mesmo a que nunca invoca uma skill do MGR.
//
// A mecânica do bloco mora em `managed-block.js`; aqui ficam o texto, o caminho de cada motor (que vem
// do descritor, `instructions.file`) e a decisão de quem recebe, mantém ou perde o bloco.
//
// Texto em inglês e fixo (Q-4): o estado `current` compara texto, e um texto que dependesse do idioma
// do usuário mudaria junto. As duas linhas de borda são a marca de posse, iguais nos dois formatos.
//
// Módulo de núcleo: não imprime nada e não devolve sentinela nula. Bloco aberto em qualquer arquivo
// consultado lança (via `blockState`) antes de qualquer escrita.
import { existsSync } from "node:fs";
import path from "node:path";
import * as engineDescriptors from "./engines/index.js";
import * as installer from "./installer.js";
import { blockState, removeBlock, writeBlock } from "./managed-block.js";

const CONSTITUTION_PATH = "docs/sdd/CONSTITUTION.md";

const OPEN = "<!-- >>> mgr-method (managed block: mgr uninstall removes it) >>> -->";
const CLOSE = "<!-- <<< mgr-method <<< -->";
const TIERS = "SDD tiers live in `docs/sdd/`; feature specs live in `specs/<slug>/`.";

const BLOCKS = Object.freeze({
  import: Object.freeze([
    OPEN,
    "Project constitution (non-negotiable rules, mgr-method): @docs/sdd/CONSTITUTION.md",
    TIERS,
    CLOSE,
  ]),
  pointer: Object.freeze([
    OPEN,
    "Project constitution (non-negotiable rules, mgr-method): read `docs/sdd/CONSTITUTION.md` before proposing or changing code.",
    TIERS,
    CLOSE,
  ]),
});

// Caminho relativo à raiz, sempre com `/`, para a saída ser a mesma em qualquer sistema.
const relativo = (engine) => engineDescriptors.get(engine).instructions.file.join("/");

/** Linhas do bloco do motor, escolhidas por `instructions.constitution` do descritor. */
export function instructionBlock(engine) {
  return BLOCKS[engineDescriptors.get(engine).instructions.constitution];
}

/** Caminho absoluto do arquivo de instruções do motor no repositório. */
export function instructionFilePath(engine, repo) {
  return path.join(repo, ...engineDescriptors.get(engine).instructions.file);
}

const estadoDe = (repo, engine) => blockState(instructionFilePath(engine, repo), instructionBlock(engine));

/**
 * Estado do bloco de cada motor pedido: `[{ engine, file, state }]`, com `file` relativo à raiz e `/`.
 * É a fonte única do arquivo e do estado para o plano e para o comando do runtime. Bloco aberto lança.
 */
export function instructionStates(repo, engines) {
  return engines.map((engine) => ({ engine, file: relativo(engine), state: estadoDe(repo, engine) }));
}

/**
 * Plano read-only para a borda ANUNCIAR antes de gravar. `offer` são os arquivos a oferecer (motor
 * pedido, constituição presente, bloco ainda não `current`); `kept` são os blocos de motores que NÃO
 * foram pedidos e continuam no disco (RN-9). O estado é calculado para todo motor conhecido, então um
 * bloco aberto em qualquer arquivo consultado lança aqui.
 */
export function planInstructions(repo, { engines }) {
  const conhecidos = engineDescriptors.ids();
  const pedidos = engines.filter((engine) => conhecidos.includes(engine));
  const constitution = existsSync(path.join(repo, ...CONSTITUTION_PATH.split("/"))) ? "present" : "absent";

  const offer = [];
  const kept = [];
  for (const { engine, file, state } of instructionStates(repo, conhecidos)) {
    if (pedidos.includes(engine)) {
      if (constitution === "present" && state !== "current") offer.push({ engine, file, state });
    } else if (state === "current" || state === "outdated") {
      kept.push({ engine, file });
    }
  }
  return { constitution, offer, kept };
}

/** Grava (ou atualiza) o bloco no arquivo do motor e devolve o caminho absoluto. */
export function writeInstructionBlock(repo, engine) {
  return writeBlock(instructionFilePath(engine, repo), instructionBlock(engine));
}

/**
 * Blocos que o `uninstall` remove (DT-7): presentes, em qualquer motor (a posse é provada pela marca),
 * e só quando o escopo é project ou o projeto não tem instalação própria.
 */
export function instructionsToRemove(repo, { scope, projectInstalled }) {
  if (scope !== "project" && projectInstalled) return [];
  return engineDescriptors.ids()
    .filter((engine) => ["current", "outdated"].includes(estadoDe(repo, engine)))
    .map((engine) => ({ engine, file: relativo(engine) }));
}

/** Tira só o bloco do arquivo do motor: `{ outcome, file }` (ver `removeBlock`). */
export function removeInstructionBlock(repo, engine) {
  return removeBlock(instructionFilePath(engine, repo), instructionBlock(engine));
}

/**
 * Motores instalados, lidos do manifesto do projeto e, sem ele, do global. `custom` fica de fora (RN-4).
 * Aceita o campo legado `engine` quando `engines` não existe.
 */
export function installedEngines(repo) {
  for (const source of ["project", "global"]) {
    const manifesto = installer.detectPrior(source, repo);
    if (!manifesto) continue;
    const lista = manifesto.engines || [manifesto.engine];
    return { source, engines: lista.filter((engine) => installer.ENGINES.includes(engine)) };
  }
  return { source: "none", engines: [] };
}
