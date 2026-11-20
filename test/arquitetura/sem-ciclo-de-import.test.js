import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const IMPORT_RELATIVO = /(?:^|\n)\s*(?:import|export)[^;]*?from\s+["'](\.[^"']+)["']/g;

function modulosDe(diretorio) {
  return readdirSync(diretorio).flatMap((nome) => {
    const caminho = path.join(diretorio, nome);
    if (statSync(caminho).isDirectory()) return modulosDe(caminho);
    return nome.endsWith(".js") ? [caminho] : [];
  });
}

function grafoDeImports(modulos) {
  const conhecidos = new Set(modulos);
  return new Map(modulos.map((modulo) => [
    modulo,
    [...readFileSync(modulo, "utf8").matchAll(IMPORT_RELATIVO)]
      .map(([, relativo]) => path.resolve(path.dirname(modulo), relativo))
      .filter((alvo) => conhecidos.has(alvo)),
  ]));
}

function ciclosDe(grafo) {
  const ciclos = [];
  const estado = new Map();
  const pilha = [];
  const visitar = (modulo) => {
    estado.set(modulo, "aberto");
    pilha.push(modulo);
    for (const alvo of grafo.get(modulo)) {
      if (estado.get(alvo) === "aberto") ciclos.push([...pilha.slice(pilha.indexOf(alvo)), alvo].map((caminho) => path.relative(RAIZ, caminho)).join(" -> "));
      else if (!estado.has(alvo)) visitar(alvo);
    }
    pilha.pop();
    estado.set(modulo, "fechado");
  };
  for (const modulo of grafo.keys()) if (!estado.has(modulo)) visitar(modulo);
  return ciclos;
}

test("should have no circular import among the modules of src and bin (MNT-2)", () => {
  const grafo = grafoDeImports([...modulosDe(path.join(RAIZ, "src")), ...modulosDe(path.join(RAIZ, "bin"))]);
  assert.deepEqual(ciclosDe(grafo), []);
});

test("should report a cycle that the import graph closes", () => {
  const modulo = (nome) => path.join(RAIZ, "src", nome);
  const grafo = new Map([
    [modulo("catalog.js"), [modulo("errors.js")]],
    [modulo("errors.js"), [modulo("messages.js")]],
    [modulo("messages.js"), [modulo("catalog.js")]],
  ]);
  assert.deepEqual(ciclosDe(grafo), ["src/catalog.js -> src/errors.js -> src/messages.js -> src/catalog.js"]);
});
