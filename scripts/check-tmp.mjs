#!/usr/bin/env node
// Verifica sobras de temporario do mgr-method no diretorio temporario do sistema (feature tmp-organizado, task P0.2).
// Ferramenta de desenvolvimento do repo — fora do tarball npm, como o check-clean.mjs.
//
// Uso:
//   node scripts/check-tmp.mjs
//
// Encadeado no fim dos scripts `test` e `coverage` do package.json. Sai 0 sem sobra, 1 com sobra
// e 2 se receber qualquer argumento: `npm test -- arquivo` entregaria o argumento a ele.
//
// O QUE ELE NAO FAZ: nao apaga nada. Ele so acusa. A limpeza e do modulo scripts/lib/tmp.mjs, no
// `exit` do processo; esta checagem pega o que a limpeza nao alcancou (Ctrl+C, pasta preservada,
// pid reaproveitado por outro processo vivo, ferramenta de fora que usa o prefixo mgr-).

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { KEEP_MARKER, isAlive, runOwner, tmpBase } from "./lib/tmp.mjs";

/**
 * Regra pura: recebe os nomes e as entradas da base, devolve sobras e entradas vivas. Sem IO.
 * Cada `tmpNames` ja vem filtrado para nomes `mgr-*`; o `mgr-method` e a propria base e nao conta.
 */
export function findLeftovers({ tmpNames, baseEntries, isAlive }) {
  const problems = [];
  const ignored = [];

  for (const name of tmpNames) {
    if (name !== "mgr-method") problems.push({ kind: "outside-base", name });
  }

  for (const { name, kept } of baseEntries) {
    const dono = runOwner(name);
    if (dono.kind !== "run") {
      problems.push({ kind: "unknown", name });
    } else if (isAlive(dono.pid)) {
      ignored.push({ pid: dono.pid, name });
    } else if (kept) {
      problems.push({ kind: "kept", name });
    } else {
      problems.push({ kind: "dead-run", name });
    }
  }

  return { problems, ignored };
}

// Base ausente equivale a base vazia (P-4): a base vazia pode ficar entre execucoes.
function lerBase(base) {
  if (!existsSync(base)) return [];
  return readdirSync(base).map((name) => ({
    name,
    kept: existsSync(path.join(base, name, KEEP_MARKER)),
  }));
}

const MENSAGEM_POR_KIND = {
  "outside-base": (caminho) =>
    `check-tmp: sobra fora da base: ${caminho} (temporario so por tempDir de scripts/lib/tmp.mjs)`,
  "dead-run": (caminho) => `check-tmp: sobra de processo encerrado: ${caminho}`,
  kept: (caminho) =>
    `check-tmp: preservado a pedido (MGR_KEEP_TMP=1): ${caminho}; apague quando terminar`,
  unknown: (caminho) => `check-tmp: entrada desconhecida na base: ${caminho}`,
};

export function main(argv) {
  if (argv.length > 0) {
    console.error("check-tmp: nao recebe argumentos; para rodar um arquivo de teste use node --test <arquivo>");
    return 2;
  }

  const sistema = path.dirname(tmpBase());
  const base = tmpBase();
  const tmpNames = readdirSync(sistema).filter((name) => name.startsWith("mgr-"));
  const { problems, ignored } = findLeftovers({
    tmpNames,
    baseEntries: lerBase(base),
    isAlive,
  });

  for (const { pid, name } of ignored) {
    console.log(`check-tmp: ignorado, processo ${pid} vivo: ${path.join(base, name)}`);
  }

  if (problems.length) {
    for (const { kind, name } of problems) {
      const caminho = kind === "outside-base" ? path.join(sistema, name) : path.join(base, name);
      console.error(MENSAGEM_POR_KIND[kind](caminho));
    }
    console.error(`check-tmp: ${problems.length} sobra(s) no diretorio temporario`);
    return 1;
  }

  console.log(`check-tmp OK — nenhuma sobra em ${sistema}`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("check-tmp.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
