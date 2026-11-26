// Ficha do revisor externo `codex` (ADR-0036, K13; spec revisor-externo, DT-3 e DT-17).
// Papel: descreve COMO chamar o `codex` sem conversa e só leitura (`exec`), como extrair a prova de
// execução (o id da sessão no JSONL) e como conferir se ele está instalado e logado. É dado e funções
// puras sobre texto: sem IO e sem imports. Quem executa o processo é a borda, e quem decide é o
// núcleo; esta ficha só responde "qual argv" e "o que a saída significa".
// DT-17: `model` e `effort` entram no argv só quando o projeto os escolheu; ausentes, vale o padrão
// do próprio `codex`.

const SESSION_EVENT = "thread.started";
// [A CONFIRMAR na primeira execução real] — nome do campo não medido; a medição é da P1.2.
const SESSION_FIELD = "thread_id";

const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;

const isSessionEvent = (event) =>
  event !== null &&
  typeof event === "object" &&
  event.type === SESSION_EVENT &&
  isNonEmptyString(event[SESSION_FIELD]);

export default Object.freeze({
  id: "codex",
  provider: "OpenAI",
  binary: "codex",
  versionArgv: Object.freeze(["--version"]),
  loginArgv: Object.freeze(["login", "status"]),
  sessionEvent: SESSION_EVENT,
  sessionField: SESSION_FIELD,

  versionFrom(stdout) {
    const linhas = stdout
      .split("\n")
      .map((linha) => linha.trim())
      .filter(isNonEmptyString);
    return linhas.length === 0 ? { found: false } : { found: true, version: linhas[0] };
  },

  // Medido em 2026-11-26: `codex login status` escreve "Logged in using ChatGPT" no STDERR e sai 0.
  // Por isso a frase é procurada nas duas saídas.
  isLoggedIn({ status, stdout, stderr }) {
    if (status !== 0) {
      return false;
    }
    return `${stdout}\n${stderr}`
      .split("\n")
      .some((linha) => linha.trim().startsWith("Logged in"));
  },

  execArgv({ repo, schemaFile, lastMessageFile, prompt, model, effort }) {
    const argv = [
      "exec",
      "--sandbox",
      "read-only",
      "--output-schema",
      schemaFile,
      "--output-last-message",
      lastMessageFile,
      "--json",
      "--cd",
      repo,
    ];
    if (typeof model === "string") {
      argv.push("-m", model);
    }
    if (typeof effort === "string") {
      argv.push("-c", `model_reasoning_effort=${effort}`);
    }
    argv.push(prompt);
    return argv;
  },

  sessionFrom(jsonlText) {
    for (const linha of jsonlText.split("\n")) {
      if (linha.trim() === "") {
        continue;
      }
      let evento;
      try {
        evento = JSON.parse(linha);
      } catch {
        continue;
      }
      if (isSessionEvent(evento)) {
        return { found: true, session: evento[SESSION_FIELD] };
      }
    }
    return { found: false };
  },
});
