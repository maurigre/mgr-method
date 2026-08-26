// Hook de início de sessão por motor (ADR-0009). O gatilho é da plataforma; a detecção
// continua no CLI. Matriz verificada por EXPERIMENTO em 2026-08-25 — hook criado, sessão real
// aberta em cada CLI, agente interrogado sobre o que recebeu:
//
//   claude-code  .claude/settings.local.json          evento `SessionStart`, saída = stdout
//   copilot      .github/copilot/settings.local.json  evento `sessionStart`, saída = JSON
//
// Sempre project-local e não commitado: hook global rodaria em toda sessão de todo projeto,
// inclusive nos que não usam o MGR. E arquivo commitado mudaria o comportamento do agente
// para quem clonasse — as duas plataformas protegem justamente esse caso.
//
// O arquivo é do USUÁRIO, não do MGR: aqui só se toca a própria entrada, identificada pelo
// marcador. Nunca há reescrita do todo. É a mesma prova de posse que o `remove` de plugin usa.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// Comentário de shell inerte que torna a entrada do MGR inequívoca no arquivo do usuário.
export const HOOK_MARKER = "mgr-session-hook";

export const HOOK_FILES = {
  "claude-code": path.join(".claude", "settings.local.json"),
  copilot: path.join(".github", "copilot", "settings.local.json"),
};

const HOOK_EVENTS = { "claude-code": "SessionStart", copilot: "sessionStart" };

export const hookCommand = (command, engine) => `${command} detect --hook ${engine} # ${HOOK_MARKER}`;

function assertEngine(engine) {
  if (!HOOK_FILES[engine]) {
    throw new Error(`invalid engine for session hook: ${engine} (expected ${Object.keys(HOOK_FILES).join(" | ")})`);
  }
}

// Formato NATIVO de cada motor — os esquemas não são intercambiáveis: o Claude Code usa
// `matcher` + campo `command`; o Copilot usa `bash` e exige o envelope `version`.
function buildEntry(engine, command) {
  return engine === "claude-code"
    ? { matcher: "startup", hooks: [{ type: "command", command: hookCommand(command, engine) }] }
    : { type: "command", bash: hookCommand(command, engine), timeout: 15 };
}

const isOurs = (entry) => JSON.stringify(entry).includes(HOOK_MARKER);

const readSettings = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});

const writeSettings = (file, settings) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", "utf8");
  return file;
};

export const hookFilePath = (engine, repo) => {
  assertEngine(engine);
  return path.join(repo, HOOK_FILES[engine]);
};

// Instala o hook do motor. Idempotente: a entrada do MGR é substituída, nunca duplicada.
export function writeHook(engine, repo, { command }) {
  const file = hookFilePath(engine, repo);
  const event = HOOK_EVENTS[engine];
  const settings = readSettings(file);

  const hooks = { ...settings.hooks };
  const existentes = (hooks[event] || []).filter((entry) => !isOurs(entry));
  hooks[event] = [...existentes, buildEntry(engine, command)];

  const atualizado = { ...settings, hooks };
  // O envelope `version` é exigência do Copilot; só é acrescentado se o arquivo ainda não o
  // tiver, para não sobrescrever a escolha de quem já usava o arquivo.
  if (engine === "copilot" && atualizado.version === undefined) atualizado.version = 1;
  return writeSettings(file, atualizado);
}

// Remove a entrada do MGR e devolve o arquivo ao que era. Contêiner que ficou vazio some;
// arquivo que sobrou sem nada além do envelope é apagado — foi o MGR que o criou.
export function removeHook(engine, repo) {
  const file = hookFilePath(engine, repo);
  if (!existsSync(file)) return null;

  const settings = readSettings(file);
  const event = HOOK_EVENTS[engine];
  const restantes = (settings.hooks?.[event] || []).filter((entry) => !isOurs(entry));

  const hooks = { ...settings.hooks };
  if (restantes.length) hooks[event] = restantes;
  else delete hooks[event];

  const atualizado = { ...settings };
  if (Object.keys(hooks).length) atualizado.hooks = hooks;
  else delete atualizado.hooks;

  if (Object.keys(atualizado).every((chave) => chave === "version")) {
    rmSync(file, { force: true });
    return file;
  }
  return writeSettings(file, atualizado);
}
