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
  // Valor literal do campo `tools` do agente, por NECESSIDADE da intenção (ADR-0017). A notação é
  // a da plataforma — por isso mora aqui, e não no builder.
  //
  // `read` é o valor de sempre, intocado: um revisor que não pode editar não tem como "corrigir" o
  // que deveria reprovar (ADR-0010). `write` acrescenta escrita ao mesmo conjunto de leitura, em
  // vez de trocá-lo — quem implementa também precisa ler.
  agentTools: {
    read: "Read, Grep, Glob",
    write: "Read, Grep, Glob, Write, Edit",
  },
  // Aliases que a plataforma PUBLICA, conferidos em 2026-09-12 nas duas páginas oficiais, que dizem
  // o mesmo por caminhos diferentes:
  //   - https://code.claude.com/docs/en/cli-reference — a descrição do `--model` nomeia exatamente
  //     estes quatro ("such as `sonnet`, `opus`, `haiku`, or `fable`, or a model's full name") e
  //     aponta dali para a tabela completa. É a fonte que o DT-4 da spec fixou;
  //   - https://code.claude.com/docs/en/model-config, seção "Model aliases" — a tabela completa, de
  //     onde saem as razões de exclusão logo abaixo. Sem ela as exclusões seriam afirmação sem fonte.
  //
  // É sugestão, nunca grade: nada valida contra esta lista. A conta de quem instala pode ter modelo
  // que a doc não publica, e lista nossa envelhece e passa a recusar modelo válido (RN-2).
  //
  // A tabela tem MAIS linhas que estas quatro. O que ficou de fora, e por quê, pela própria doc:
  //   - `default`: a doc diz textualmente "Not itself a model alias", e colidiria com o `inherit`,
  //     que já é o valor reservado do método para ausência;
  //   - `best`: resolve para fable ou opus conforme a conta, o que tornaria a política declarada
  //     imprevisível entre máquinas — o oposto do que declarar modelo por intenção serve para fazer;
  //   - `sonnet[1m]` e `opus[1m]`: variantes de janela dos mesmos dois modelos, não modelos distintos;
  //   - `opusplan`: "Special mode" que troca de modelo no meio do caminho, de frente contra a
  //     premissa do ADR-0017 de que o agente segura UM modelo pela execução inteira.
  documentedModels: ["sonnet", "opus", "haiku", "fable"],
  capabilities: {
    agentModel: true,
    agentEffort: true,
    contextFork: true,
  },
};
