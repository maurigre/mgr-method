import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { getMessages } from "../../src/core/messages.js";
import { tempDir } from "../../scripts/lib/tmp.mjs";

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/mgr.js");
const TEM_SCRIPT = spawnSync("script", ["--version"], { encoding: "utf8" }).status === 0;
// Sem a pergunta no idioma, o rotulo esperado nunca aparece: o prazo mata o terminal e o teste falha alto.
const PRAZO_MS = 20000;
const SEM_CORES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[a-zA-Z]`, "g");

function responderComEnter(projeto, idioma, rotuloDoNao) {
  return new Promise((resolve) => {
    const filho = spawn("script", ["-qec", `stty cols 200 rows 50; node ${BIN} review enable --user-language ${idioma}`, "/dev/null"], {
      cwd: projeto, env: { ...process.env, NO_COLOR: "1", TERM: "xterm", LC_ALL: "C" },
    });
    let saida = "";
    let respondeu = false;
    const prazo = setTimeout(() => filho.kill(), PRAZO_MS);
    filho.stdout.on("data", (pedaco) => {
      saida += pedaco;
      if (!respondeu && saida.includes(rotuloDoNao)) {
        respondeu = true;
        filho.stdin.write("\r");
      }
    });
    filho.on("close", (codigo) => {
      clearTimeout(prazo);
      resolve({ codigo, saida: saida.replace(SEM_CORES, "") });
    });
  });
}

for (const idioma of ["en", "pt-BR"]) {
  test(`should ask review enable with the ${idioma} labels in a real terminal and answer no on Enter`, { skip: TEM_SCRIPT ? false : "sem o utilitario script, nao ha pty para o caminho com terminal" }, async () => {
    const mensagens = getMessages(idioma);
    const projeto = tempDir("mgr-review-tty-");
    const { codigo, saida } = await responderComEnter(projeto, idioma, mensagens.promptNo);
    assert.equal(codigo, 1, saida);
    assert.ok(saida.includes(`${mensagens.promptYes} / `), saida);
    assert.ok(saida.includes(mensagens.reviewEnableConfirm), saida);
    assert.ok(saida.includes(mensagens.reviewDeclined), saida);
    assert.equal(existsSync(path.join(projeto, ".mgr-core")), false);
  });
}
