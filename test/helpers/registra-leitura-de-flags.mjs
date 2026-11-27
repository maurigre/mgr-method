// Pré-carga SÓ DE TESTE (`node --import`), usada pela guarda de test/arquitetura/flags-por-comando.test.js
// (ADR-0040, DT-7): redireciona todo import de `.../src/core/cli-args.js` para um invólucro que envolve o
// `flags` devolvido por `parseArgs` num Proxy e anota cada chave lida (`get`, `has`,
// `getOwnPropertyDescriptor`). Vale para a CLI do pacote e para a cópia do runtime dentro do projeto,
// porque casa pelo fim do caminho. Na saída do processo, grava as chaves lidas em `FLAG_READS_OUT`.
// O código de produção não ganha gancho nenhum.
import { writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import process from "node:process";

const SUFIXO = "/src/core/cli-args.js";
const lidas = new Set();

globalThis.__mgrFlagReads = (chave) => {
  if (typeof chave === "string") lidas.add(chave);
};

// Sem `FLAG_READS_OUT` a pré-carga não faz nada: o `node --test` sem lista de arquivos também executa este
// `.mjs` como se fosse teste, e ele não pode falhar nem medir nada nesse caso.
const destino = process.env.FLAG_READS_OUT;
if (destino) process.on("exit", () => writeFileSync(destino, JSON.stringify([...lidas].sort())));

function involucro(urlReal) {
  const fonte = `
import * as real from ${JSON.stringify(urlReal)};
export * from ${JSON.stringify(urlReal)};
const anota = (chave) => globalThis.__mgrFlagReads(chave);
const espia = (alvo) => new Proxy(alvo, {
  get(destino, chave, receptor) { anota(chave); return Reflect.get(destino, chave, receptor); },
  has(destino, chave) { anota(chave); return Reflect.has(destino, chave); },
  getOwnPropertyDescriptor(destino, chave) { anota(chave); return Reflect.getOwnPropertyDescriptor(destino, chave); },
});
export function parseArgs(...args) {
  const saida = real.parseArgs(...args);
  return { ...saida, flags: espia(saida.flags) };
}
`;
  return `data:text/javascript,${encodeURIComponent(fonte)}`;
}

// `module.registerHooks` existe a partir do Node 22.15.0 (doc oficial); antes dele a pré-carga não faz nada e a
// guarda se declara pulada.
if (destino && typeof nodeModule.registerHooks === "function") nodeModule.registerHooks({
  resolve(specifier, context, next) {
    const resolvido = next(specifier, context);
    // Quem importa do invólucro (`data:`) recebe o módulo real, na mesma URL de sempre: sem sufixo, a
    // cobertura da suíte o conta como um arquivo só.
    if (context.parentURL?.startsWith("data:")) return resolvido;
    if (!resolvido.url.endsWith(SUFIXO)) return resolvido;
    return { url: involucro(resolvido.url), shortCircuit: true };
  },
});
