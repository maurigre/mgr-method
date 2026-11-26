// Pré-carregado pela suíte (`--import` nos scripts `test` e `coverage`): põe na FRENTE do PATH um `codex`
// que só falha alto. Qualquer teste que chame `codex` sem o falso do `codex-falso.js` cai aqui, e nunca no
// `codex` real (RN-21; achado R1-P7 do revisor externo: a guarda conferia o import do falso, não o uso).
// Garantia por construção: vale para todo subprocesso da suíte, sem depender de cada teste lembrar.
import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { tempDir } from "../../scripts/lib/tmp.mjs";

export const MARCA_DO_BLOQUEIO = "codex real bloqueado na suite de testes";

const pasta = tempDir("mgr-bloqueio-codex-");
const executavel = path.join(pasta, "codex");
writeFileSync(executavel, `#!/bin/sh\necho "${MARCA_DO_BLOQUEIO}" >&2\nexit 97\n`);
chmodSync(executavel, 0o755);
process.env.PATH = [pasta, process.env.PATH ?? ""].join(path.delimiter);
