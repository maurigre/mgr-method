// Descritor do motor copilot (ADR-0010, decisão 4).
// Capacidades verificadas por experimento em 2026-08-26 (spec §11):
//   - V-5: a sessão em andamento DELEGA a custom agent (as ferramentas `task`,
//     `list_agents`, `read_agent` e `write_agent` são expostas ao modelo). Por isso o
//     roteamento aqui é por INSTRUÇÃO no corpo da skill, não por frontmatter;
//   - V-2: o custom agent em .github/agents/*.agent.md LÊ e VALIDA `model` — modelo
//     indisponível gera aviso e substituição pela própria plataforma;
//   - V-3: NÃO existe campo equivalente a `effort` em custom agent. A referência de
//     configuração lista name, description, target, tools, model,
//     disable-model-invocation, user-invocable, mcp-servers e metadata.
// Atenção: isto vale para AGENTES. Para SKILLS o copilot continua sem destino para
// `model`/`effort` (matriz de 2026-07-20, ver src/adapters.js) — são capacidades distintas.
// Escopo global verificado na documentação oficial em 2026-08-30:
// "store personal custom agent definitions as `.agent.md` files in `~/.copilot/agents/`" e
// "project-level agents in `.github/agents/` take precedence over personal agents".
// https://docs.github.com/en/copilot/reference/custom-agents-configuration
// Limitação conhecida, NÃO tratada aqui: a variável COPILOT_HOME redireciona `$HOME/.copilot`,
// e o instalador usa `os.homedir()` como todo o resto do método. Quem usa COPILOT_HOME precisa
// mover o arquivo à mão — declarado, não silencioso.
export default {
  id: "copilot",
  agentsDir: { project: ".github/agents", global: ".copilot/agents" },
  agentFile: (name) => `${name}.agent.md`,
  // "instruction": o desvio até o agente é INSTRUÇÃO no corpo da skill (delegar via `task`).
  routing: "instruction",
  // Aliases de ferramenta, reconferidos na documentação oficial em 2026-09-11. A lista completa,
  // textual: `execute` (shell, Bash, powershell) · `read` (Read, NotebookRead) · `edit` (Edit,
  // MultiEdit, Write, NotebookEdit) · `search` (Grep, Glob) · `agent` (custom-agent, Task) ·
  // `web` (WebSearch, WebFetch) · `todo` (TodoWrite). Case-insensitive.
  // https://docs.github.com/en/copilot/reference/custom-agents-configuration
  //
  // CORREÇÃO de 2026-09-11: o valor anterior era `["view", "grep", "glob"]`, e **`view` não existe**
  // — nem como alias, nem como nome de ferramenta. Nome não reconhecido é ignorado em silêncio,
  // então o agente de revisão podia estar rodando no copilot **sem ferramenta de leitura**: tinha
  // busca e não tinha como abrir o arquivo que precisa citar verbatim. O gate do método, no motor
  // inteiro, sem o que a L1.1 exige dele.
  //
  // `edit` cobre Edit, MultiEdit, Write e NotebookEdit de uma vez — por isso a escrita é `read` e
  // `search` mais ele, e não uma lista de nomes soltos.
  agentTools: {
    read: '["read", "search"]',
    write: '["read", "search", "edit"]',
  },
  // Vazio de propósito, e isto NÃO é omissão: o Copilot não publica conjunto fixo de modelos — a
  // lista é da CONTA de quem instala. Verificado por experimento em 2026-08-26 (spec §11, V-2/V-4):
  // a lista só aparece em runtime, como aviso da própria plataforma, depois de declarar um modelo
  // que aquela conta não tem. A referência de configuração de custom agents documenta o campo
  // `model`, e não os seus valores:
  // https://docs.github.com/en/copilot/reference/custom-agents-configuration
  //
  // Preencher com nomes plausíveis seria palpite sobre a conta de terceiro. Sem sugestão, a skill
  // diz que ali não há o que sugerir — que é verdade, e vale mais que uma lista inventada.
  documentedModels: [],
  // Hook: mesmo papel do descritor do claude-code, com o esquema NATIVO do copilot — que não é
  // intercambiável (ADR-0018). Conferido na doc oficial em 2026-09-12:
  // https://docs.github.com/en/copilot/reference/hooks-configuration
  //
  // O envelope `version` é exigência da plataforma, e só é acrescentado quando ainda não existe, para
  // não sobrescrever a escolha de quem já usava o arquivo.
  hookFile: [".github", "copilot", "settings.local.json"],
  hookEvents: { sessionStart: "sessionStart" },
  // O `sessionStart` deste motor nunca usou matcher, e continua sem — mudar isso reescreveria o
  // arquivo de quem já tem o MGR instalado. O `preCompact` usa, como a doc documenta.
  hookMatchers: { sessionStart: null, preCompact: "manual|auto" },
  // O teto já era 15s nos dois eventos deste motor; passou a DADO por evento, no lugar de literal
  // dentro do `hookEntry`, para que a entrada gravada continue byte a byte a mesma.
  hookTimeouts: { sessionStart: 15, preCompact: 15 },
  hookEntry: (command, matcher, timeout) => ({
    type: "command",
    bash: command,
    ...(typeof timeout === "number" ? { timeout } : {}),
    ...(matcher === null ? {} : { matcher }),
  }),
  hookEnvelope: { version: 1 },
  // Tem o evento e **não** deixa impedir: a doc classifica o `preCompact` como "notification only",
  // e diz que a saída não é processada para decisão de controle. Então `block: null` — que é
  // diferente de não ter evento, e é por isso que este campo não é um booleano (ADR-0018).
  compaction: {
    event: "preCompact",
    block: null,
    // Sem canal de aviso, e isto é da PLATAFORMA. Reconferido na doc oficial em 2026-09-13
    // (https://docs.github.com/en/copilot/reference/hooks-configuration): o `preCompact` é
    // "No — notification only", a saída dele não é processada, e o hook não tem campo por onde
    // comunicar nada ao usuário — ao contrário do `sessionStart`, que aceita `additionalContext`.
    //
    // `null` em vez de uma função que imprime no vazio: imprimir faria o método parecer avisar. A
    // degradação é declarada ao usuário no CHANGELOG e nos READMEs, que é onde ele pode ler.
    notice: null,
  },
  // Sem convenção conhecida para o que mais pertence à sessão (ADR-0019). `[A CONFIRMAR]`: não foi
  // medido — o layout do claude-code foi apurado em disco em 2026-09-13 e 2026-09-17, o deste não.
  //
  // Lista **vazia** é "não se sabe onde", e o núcleo a trata como ausência, não como erro. Preencher
  // com caminhos plausíveis seria palpite sobre layout de terceiro, que é o que a RN-2 proíbe.
  sessionArtifacts: () => [],
  capabilities: {
    agentModel: true,
    agentEffort: false,
    contextFork: false,
  },
};
