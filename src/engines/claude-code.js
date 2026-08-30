// Descritor do motor claude-code (ADR-0010, decisão 4).
// Capacidades verificadas por experimento em 2026-08-26 (spec §11, V-1):
//   - subagente em .claude/agents/*.md honra `model` E `effort` pela execução INTEIRA
//     (sessão aberta em opus, fork rodou no modelo declarado no agente);
//   - `context: fork` + `agent:` no frontmatter da skill roteia para o agente — o
//     `meta.json` do fork traz {"agentType": "<nome>"}, ou seja quem roteia é a plataforma.
export default {
  id: "claude-code",
  agentsDir: { project: ".claude/agents", global: ".claude/agents" },
  agentFile: (name) => `${name}.md`,
  // "fork": o desvio até o agente é ESTRUTURAL (frontmatter da skill, a plataforma roteia).
  routing: "fork",
  // Valor literal do campo `tools` do agente. Só leitura e busca: um revisor que não pode
  // editar não tem como "corrigir" o que deveria reprovar (ADR-0010). A notação é a da
  // plataforma — por isso mora aqui, e não no builder.
  agentTools: "Read, Grep, Glob",
  capabilities: {
    agentModel: true,
    agentEffort: true,
    contextFork: true,
  },
};
