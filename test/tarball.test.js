import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// O tarball publicado tem de conter TODO recurso que o instalador exige em tempo de execução.
//
// Este arquivo nasce de um defeito real: `agents/` virou artefato instalável na 0.7.0-beta.2 e a
// whitelist `files` do package.json nunca foi atualizada. Nenhum teste pegou, porque todos instalam
// a partir do working tree, e as betas 2 a 7 não foram publicadas. A 0.7.0-beta.8 foi a primeira
// versão publicada com o gate, e `npx mgr-method install` morria com
// `recurso do MGR ausente: agents`.
//
// A lista de recursos é DERIVADA de `src/bundle.js`, nunca escrita à mão: acrescentar um
// `pkgDir("x")` sem pôr `x/` em `files` quebra aqui. Uma lista copiada envelheceria em silêncio,
// que é exatamente como o defeito original sobreviveu a três releases.
const RAIZ = fileURLToPath(new URL("..", import.meta.url));

const recursosExigidos = () => {
  const fonte = readFileSync(path.join(RAIZ, "src", "bundle.js"), "utf8");
  return [...new Set([...fonte.matchAll(/pkgDir\("([^"]+)"\)/g)].map((achado) => achado[1]))].sort();
};

// `--ignore-scripts` pula o `prepack`, que roda o esbuild: aqui interessa a LISTA de arquivos, e
// nenhum recurso do `pkgDir` mora em `dist/`. Sem a flag o teste passaria a depender do build.
const arquivosDoTarball = () => {
  const saida = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(saida)[0].files.map((arquivo) => arquivo.path);
};

test("todo recurso que o instalador exige está no tarball publicado", () => {
  const recursos = recursosExigidos();
  assert.ok(recursos.length >= 3, `esperava ao menos skills, agents e shared; achei ${recursos}`);

  const arquivos = arquivosDoTarball();
  const faltando = recursos.filter((recurso) => !arquivos.some((a) => a.startsWith(`${recurso}/`)));
  assert.deepEqual(faltando, [],
    `recurso(s) fora da whitelist \`files\` do package.json: ${faltando.join(", ")} — `
    + "o instalador vai morrer com `recurso do MGR ausente` em quem instalar do npm");
});

test("o gate de validação viaja no pacote — foi ele que faltou na 0.7.0-beta.8", () => {
  assert.ok(arquivosDoTarball().includes("agents/mgr-review.md"),
    "sem este arquivo, `mgr install` falha antes de escrever qualquer coisa");
});
