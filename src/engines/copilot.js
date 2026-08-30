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
  // Aliases de ferramenta verificados na documentação oficial em 2026-08-30: o exemplo de
  // agente de leitura da própria doc usa ["grep", "glob", "view"], e nomes não reconhecidos
  // são ignorados em vez de quebrar.
  // https://docs.github.com/en/copilot/reference/custom-agents-configuration
  agentTools: '["view", "grep", "glob"]',
  capabilities: {
    agentModel: true,
    agentEffort: false,
    contextFork: false,
  },
};
