// Diretorio temporario unico por processo, sob <tmpdir>/mgr-method/<pid>-XXXXXX (feature tmp-organizado, task P0.1).
// Ferramenta de desenvolvimento do repo — fora do tarball npm.
//
// Na primeira chamada de tempDir o processo confere a base, cria a sua pasta, varre as sobras de
// processos encerrados e registra a limpeza no `exit`. Nada acontece no import.
//
// Calado no caminho de sucesso, por excecao a LOG-1 (ADR-0027): o stderr so recebe o aviso de falha,
// as duas linhas da varredura de sobras e a linha do MGR_KEEP_TMP=1.

import { lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const KEEP_MARKER = ".mgr-keep";

let pastaDoProcesso = null;

export function tmpBase() {
  return path.join(os.tmpdir(), "mgr-method");
}

export function runOwner(name) {
  const casamento = /^(\d+)-./.exec(name);
  return casamento ? { kind: "run", pid: Number(casamento[1]) } : { kind: "foreign" };
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    return erro.code === "EPERM";
  }
}

function aviso(caminho, erro) {
  return `tmp: AVISO: ${caminho} ficou em disco (${erro.message}); o check-tmp vai acusa-lo`;
}

// O `exit` nao pode lancar (DT-4): com o stderr fechado, o aviso se perde e o check acusa a sobra.
function avisarSemLancar(texto) {
  try {
    writeSync(2, texto + "\n");
  } catch {
    // stderr fechado: nao ha onde avisar; lancar aqui faria o exit lancar (DT-4) e o processo sairia com erro.
  }
}

function conferirBase(base) {
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const stat = lstatSync(base);
  if (stat.isSymbolicLink()) {
    throw new Error(`base temporaria insegura: ${base} e link simbolico; aponte TMPDIR para um diretorio so seu`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`base temporaria insegura: ${base} nao e diretorio; aponte TMPDIR para um diretorio so seu`);
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error(`base temporaria insegura: ${base} pertence ao uid ${stat.uid}; aponte TMPDIR para um diretorio so seu`);
  }
}

function varrer(base, propria) {
  let entradas;
  try {
    entradas = readdirSync(base);
  } catch (erro) {
    if (erro.code !== "ENOENT") process.stderr.write(aviso(base, erro) + "\n");
    return;
  }
  for (const nome of entradas) {
    const caminho = path.join(base, nome);
    if (caminho === propria) continue;
    try {
      const dono = runOwner(nome);
      if (dono.kind !== "run" || isAlive(dono.pid)) continue;
      if (existsSync(path.join(caminho, KEEP_MARKER))) continue;
      process.stderr.write(`tmp: varrendo sobra do processo encerrado ${dono.pid}: ${caminho}\n`);
      rmSync(caminho, { recursive: true, force: true });
      process.stderr.write(`tmp: sobra varrida: ${caminho}\n`);
    } catch (erro) {
      if (erro.code === "ENOENT") continue;
      process.stderr.write(aviso(caminho, erro) + "\n");
    }
  }
}

function iniciarProcesso() {
  const base = tmpBase();
  conferirBase(base);
  const pasta = mkdtempSync(path.join(base, `${process.pid}-`));
  const preservar = process.env.MGR_KEEP_TMP === "1";
  if (preservar) {
    writeFileSync(path.join(pasta, KEEP_MARKER), "");
    process.stderr.write(`MGR_KEEP_TMP=1: temporarios deste processo preservados em ${pasta}\n`);
  }
  varrer(base, pasta);
  if (!preservar) {
    process.once("exit", () => {
      try {
        rmSync(pasta, { recursive: true, force: true });
      } catch (erro) {
        avisarSemLancar(aviso(pasta, erro));
      }
    });
  }
  return pasta;
}

export function tempDir(prefix) {
  if (typeof prefix !== "string" || !/^[A-Za-z0-9._-]+$/.test(prefix) || prefix === "." || prefix === "..") {
    throw new Error(`tempDir: prefixo invalido ${JSON.stringify(prefix)}; use so letras, digitos, '.', '_' e '-'`);
  }
  if (pastaDoProcesso === null) pastaDoProcesso = iniciarProcesso();
  return mkdtempSync(path.join(pastaDoProcesso, prefix));
}
