// Hook de início de sessão por motor (ADR-0009). O gatilho é da plataforma; a detecção
// continua no CLI. A matriz foi verificada por EXPERIMENTO em 2026-08-25 — hook criado, sessão real
// aberta em cada CLI, agente interrogado sobre o que recebeu.
//
// ONDE ELA MORA AGORA: no descritor de cada motor, em `src/engines/` (ADR-0018). Arquivo, nome do
// evento, forma da entrada e envelope são DADO. Este módulo ficou com o comportamento — prova de
// posse, idempotência e remoção que preserva entrada alheia — e não sabe mais o nome de motor
// nenhum. Um motor novo é um arquivo em `src/engines/`, sem tocar aqui.
//
// Sempre project-local e não commitado: hook global rodaria em toda sessão de todo projeto,
// inclusive nos que não usam o MGR. E arquivo commitado mudaria o comportamento do agente
// para quem clonasse — as duas plataformas protegem justamente esse caso.
//
// O arquivo é do USUÁRIO, não do MGR: aqui só se toca a própria entrada, identificada pelo
// marcador. Nunca há reescrita do todo. É a mesma prova de posse que o `remove` de plugin usa.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { get as engineDescriptor, ids as engineIds } from "./engines/index.js";

// Comentário de shell inerte que torna a entrada do MGR inequívoca no arquivo do usuário.
export const HOOK_MARKER = "mgr-session-hook";

export const hookCommand = (command, engine) => `${command} detect --hook ${engine} # ${HOOK_MARKER}`;

// O QUE cada motor quer vem do descritor (ADR-0018); o COMO continua aqui. Antes desta troca o
// módulo carregava dois mapas e um `if` por nome de motor, e acrescentar o segundo evento dobraria
// essa ramificação — é a dívida que o ADR-0010 nomeou e adiou.
//
// A recusa de motor desconhecido continua DESTE módulo, e de propósito: a mensagem diz em que
// operação o motor inválido apareceu, que é o que o usuário precisa para achar o erro. Isso não é
// ramificar por nome de motor — a lista vem de `engineIds()`, e não há literal de motor aqui.
const descritor = (engine) => {
  if (!engineIds().includes(engine)) {
    throw new Error(`invalid engine for session hook: ${engine} (expected ${engineIds().join(" | ")})`);
  }
  return engineDescriptor(engine);
};

const isOurs = (entry) => JSON.stringify(entry).includes(HOOK_MARKER);

const readSettings = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});

const writeSettings = (file, settings) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", "utf8");
  return file;
};

export const hookFilePath = (engine, repo) => path.join(repo, ...descritor(engine).hookFile);

/**
 * Eventos que o MGR grava, e o comando de cada um. `preCompact` só existe onde o motor declara o
 * evento: motor sem ele não recebe entrada nenhuma, porque gravar hook num evento inexistente é
 * escrever no vazio no arquivo de configuração do usuário.
 *
 * Recebe o DESCRITOR, e não o id, pela mesma razão que separou `decideFor` de `decide`: o estado
 * "motor sem evento de compactação" — que o antigravity e o deep code terão — tem de ser afirmável
 * com um descritor de mesa, em vez de esperar o primeiro motor desse tipo entrar. Resolver por id
 * tornaria esse ramo inalcançável, porque id só existe registrado.
 */
export const eventsFor = (motor, engine, command) => {
  const entradas = [{
    event: motor.hookEvents.sessionStart,
    matcher: motor.hookMatchers.sessionStart,
    timeout: motor.hookTimeouts.sessionStart,
    command: hookCommand(command, engine),
  }];
  if (motor.compaction.event) {
    entradas.push({
      event: motor.compaction.event,
      matcher: motor.hookMatchers.preCompact,
      timeout: motor.hookTimeouts.preCompact,
      command: precompactCommand(command, engine),
    });
  }
  return entradas;
};

const eventosDe = (engine, command) => eventsFor(descritor(engine), engine, command);

// Os eventos que o MGR grava neste motor, para a borda ANUNCIAR o que vai escrever. Sai daqui, e
// não da borda remontando a regra, porque quem sabe quais eventos o método usa é este módulo.
export const writtenEvents = (engine) => eventosDe(engine, "").map(({ event }) => event);

const precompactCommand = (command, engine) =>
  `${command} precompact --hook ${engine} # ${HOOK_MARKER}`;

// Instala os hooks do motor. Idempotente: a entrada do MGR é substituída, nunca duplicada.
export function writeHook(engine, repo, { command }) {
  const motor = descritor(engine);
  const file = hookFilePath(engine, repo);
  const settings = readSettings(file);

  const hooks = { ...settings.hooks };
  for (const { event, matcher, timeout, command: comando } of eventosDe(engine, command)) {
    const existentes = (hooks[event] || []).filter((entry) => !isOurs(entry));
    hooks[event] = [...existentes, motor.hookEntry(comando, matcher, timeout)];
  }

  const atualizado = { ...settings, hooks };
  // O envelope é exigência da plataforma (hoje só o Copilot tem um); cada chave dele só é
  // acrescentada se o arquivo ainda não a tiver, para não sobrescrever a escolha de quem já usava o
  // arquivo.
  for (const [chave, valor] of Object.entries(motor.hookEnvelope ?? {})) {
    if (atualizado[chave] === undefined) atualizado[chave] = valor;
  }
  return writeSettings(file, atualizado);
}

// Remove a entrada do MGR e devolve o arquivo ao que era. Contêiner que ficou vazio some;
// arquivo que sobrou sem nada além do envelope é apagado — foi o MGR que o criou.
export function removeHook(engine, repo) {
  const file = hookFilePath(engine, repo);
  if (!existsSync(file)) return null;

  const settings = readSettings(file);
  const hooks = { ...settings.hooks };
  // Remove a entrada do MGR de CADA evento que ele grava, e só dela. Contêiner que ficou vazio some.
  for (const { event } of eventosDe(engine, "")) {
    const restantes = (settings.hooks?.[event] || []).filter((entry) => !isOurs(entry));
    if (restantes.length) hooks[event] = restantes;
    else delete hooks[event];
  }

  const atualizado = { ...settings };
  if (Object.keys(hooks).length) atualizado.hooks = hooks;
  else delete atualizado.hooks;

  const doEnvelope = new Set(Object.keys(descritor(engine).hookEnvelope ?? {}));
  if (Object.keys(atualizado).every((chave) => doEnvelope.has(chave))) {
    rmSync(file, { force: true });
    return file;
  }
  return writeSettings(file, atualizado);
}
