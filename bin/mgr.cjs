#!/usr/bin/env node
"use strict";
// Launcher compativel com Node antigo (ES5, sem sintaxe moderna): valida a versao do Node
// ANTES de carregar o bundle ESM moderno (dist/mgr.min.js). Assim, em Node < 22 o usuario
// recebe uma mensagem clara em vez de um crash minificado ilegivel.
var MIN_MAJOR = 22;
var major = parseInt((process.versions && process.versions.node ? process.versions.node : "0").split(".")[0], 10);

var path = require("path");
var fs = require("fs");
var os = require("os");

// Idioma da mensagem: flag --user-language > userLanguage do manifesto (projeto, depois home)
// > locale. Mesma cadeia da CLI, em ES5 porque roda antes de saber se o Node e moderno.
function languageFromFlag(argv) {
  for (var i = 0; i < argv.length - 1; i++) {
    if (argv[i] === "--user-language" && typeof argv[i + 1] === "string" && argv[i + 1]) return argv[i + 1];
  }
  return "";
}

function languageFromManifest(file) {
  try {
    var manifesto = JSON.parse(fs.readFileSync(file, "utf8"));
    if (manifesto && typeof manifesto === "object" && typeof manifesto.userLanguage === "string" && manifesto.userLanguage) {
      return manifesto.userLanguage;
    }
  } catch (erro) {
    return "";
  }
  return "";
}

function languageFromProject(start, home) {
  var casa = path.resolve(home);
  var atual = path.resolve(start);
  for (;;) {
    if (atual !== casa) {
      var found = languageFromManifest(path.join(atual, ".mgr-core", "manifest.json"));
      if (found) return found;
    }
    var pai = path.dirname(atual);
    if (pai === atual) break;
    atual = pai;
  }
  return languageFromManifest(path.join(casa, ".mgr-core", "manifest.json"));
}

function languageFromLocale(env) {
  var raw = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  var base = raw.split(/[.@]/)[0].trim();
  if (!base || base === "C" || base === "POSIX") return "en";
  return base.replace(/_/g, "-");
}

function homeDir() {
  try { return os.homedir(); } catch (erro) { return ""; }
}

function resolveLanguage() {
  var home = homeDir();
  var chosen = languageFromFlag(process.argv);
  if (!chosen) {
    try { chosen = languageFromProject(process.cwd(), home || path.sep + "nonexistent-home"); } catch (erro) { chosen = ""; }
  }
  return chosen || languageFromLocale(process.env);
}

function nodeTooOldMessage(lang, min, found) {
  if (String(lang).toLowerCase().indexOf("pt") === 0) {
    return "mgr-method requer Node >= " + min + " (encontrado " + found + ").\n" +
      "Atualize o Node (ex.: nvm install " + min + ") e rode de novo.";
  }
  return "mgr-method requires Node >= " + min + " (found " + found + ").\n" +
    "Update Node (e.g. nvm install " + min + ") and run again.";
}

if (isNaN(major) || major < MIN_MAJOR) {
  console.error(nodeTooOldMessage(resolveLanguage(), MIN_MAJOR, process.version));
  process.exit(1);
}

var entry = path.join(__dirname, "..", "dist", "mgr.min.js");
var res = require("child_process").spawnSync(process.execPath, [entry].concat(process.argv.slice(2)), { stdio: "inherit" });
process.exit(res.status === null ? 1 : res.status);
