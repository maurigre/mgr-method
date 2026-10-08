#!/usr/bin/env node
// Gera dist/mgr.min.js com a versao do package.json embutida (feature entrega-f1-runtime-no-projeto,
// DT-10, task P1.14). O define `__MGR_BUILD_VERSION__` faz `src/bundle.js` (buildVersion/readVersion)
// devolver a versao do build, e o `mgr` chamado de dist/ passa a poder recusar um bundle defasado (P1.15).
// Ferramenta de desenvolvimento do repo — fora do tarball npm (o `prepack` a chama via `npm run build`).

import { readFileSync } from "node:fs";
import { build } from "esbuild";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

try {
  // LOG-1: par de logs em volta da escrita de dist/mgr.min.js (estado em disco).
  console.log(`gerando dist/mgr.min.js (versao ${version})`);
  await build({
    entryPoints: ["bin/mgr.js"],
    bundle: true,
    minify: true,
    platform: "node",
    format: "esm",
    external: ["@clack/prompts", "picocolors"],
    outfile: "dist/mgr.min.js",
    define: { __MGR_BUILD_VERSION__: JSON.stringify(version) },
  });
  console.log("dist/mgr.min.js gerado");
} catch (erro) {
  console.error(`build falhou: ${erro?.message ?? erro}`);
  process.exit(1);
}
