#!/usr/bin/env node
"use strict";
// Launcher compativel com Node antigo (ES5, sem sintaxe moderna): valida a versao do Node
// ANTES de carregar o bundle ESM moderno (dist/mgr.min.js). Assim, em Node < 22 o usuario
// recebe uma mensagem clara em vez de um crash minificado ilegivel.
var MIN_MAJOR = 22;
var major = parseInt((process.versions && process.versions.node ? process.versions.node : "0").split(".")[0], 10);

if (isNaN(major) || major < MIN_MAJOR) {
  console.error(
    "mgr-method requer Node >= " + MIN_MAJOR + " (encontrado " + process.version + ").\n" +
    "Atualize o Node (ex.: nvm install " + MIN_MAJOR + ") e rode de novo."
  );
  process.exit(1);
}

var path = require("path");
var entry = path.join(__dirname, "..", "dist", "mgr.min.js");
var res = require("child_process").spawnSync(process.execPath, [entry].concat(process.argv.slice(2)), { stdio: "inherit" });
process.exit(res.status === null ? 1 : res.status);
