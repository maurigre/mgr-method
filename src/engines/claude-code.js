// Descritor do motor claude-code (ADR-0010, decisão 4).
// Capacidades verificadas por experimento em 2026-08-26 (spec §11, V-1):
//   - subagente em .claude/agents/*.md honra `model` E `effort` pela execução INTEIRA
//     (sessão aberta em opus, fork rodou no modelo declarado no agente);
//   - `context: fork` + `agent:` no frontmatter da skill roteia para o agente — o
//     `meta.json` do fork traz {"agentType": "<nome>"}, ou seja quem roteia é a plataforma.

// Nome do evento de compactação, em UM lugar. O envelope de saída precisa repeti-lo dentro do
// `hookSpecificOutput`, e duas fontes para o mesmo nome divergiriam em silêncio.
const PRE_COMPACT = "PreCompact";

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
  // O que a plataforma faz com `allowed-tools` no frontmatter de uma skill (ADR-0021, CA-10).
  // Verificado em https://code.claude.com/docs/en/skills, lido em 2026-09-17:
  //   "Tools Claude can use WITHOUT ASKING PERMISSION during the turn that invokes this skill. The
  //    grant clears when you send your next message. Accepts a space- or comma-separated string, or
  //    a YAML list."
  // E, em campo SEPARADO, `disallowed-tools`: "Tools removed from Claude's available pool while this
  // skill is active." Ou seja: `allowed-tools` **concede**; quem restringe é o outro campo, que
  // **não existe** no padrão aberto.
  skillAllowedTools: { honors: true, semantics: "grant", separators: "space, comma or YAML list", restrictiveField: "disallowed-tools" },
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
  // Hook: onde mora a configuração, como se chama cada evento e que forma tem a entrada — dado, e não
  // ramificação por nome de motor (ADR-0018, pagando a dívida que o ADR-0010 nomeou).
  // Esquema conferido na doc oficial em 2026-09-12: https://code.claude.com/docs/en/hooks
  hookFile: [".claude", "settings.local.json"],
  hookEvents: { sessionStart: "SessionStart" },
  // O matcher é POR EVENTO, e não por motor: `startup` é do `SessionStart`, e o `PreCompact` filtra
  // por gatilho de compactação. Trocar um pelo outro faz o hook não disparar, em silêncio — é o
  // mesmo modo de falha do alias `view` que o gate do copilot sofreu em 2026-09-11.
  hookMatchers: { sessionStart: "startup", preCompact: "manual|auto" },
  // Timeout POR EVENTO, pela mesma razão do matcher. A doc declara, textualmente, "Seconds before
  // canceling (...) Defaults: 600 for `command`" — dez minutos. O `precompact` lê o stdin e espera
  // EOF, então sem teto uma invocação à mão fica pendurada. 15s é escolha de desenho, igual à do
  // copilot, e NÃO é medição.
  //
  // `null` no `sessionStart` de propósito: declarar um teto ali mudaria a entrada já instalada na
  // máquina de quem tem o MGR, e a invariante 8 desta fatia proíbe tocar o hook de sessão.
  hookTimeouts: { sessionStart: null, preCompact: 15 },
  // `hookEvents` NÃO repete o evento de compactação: ele vem de `PRE_COMPACT`, que `compaction.event`
  // e o envelope leem. Duas fontes para o mesmo nome divergiriam, e o motor que preenchesse uma e
  // esquecesse a outra não receberia entrada nenhuma, em silêncio.
  hookEntry: (command, matcher, timeout) => ({
    matcher,
    hooks: [{ type: "command", command, ...(typeof timeout === "number" ? { timeout } : {}) }],
  }),
  hookEnvelope: null,
  // Compactação de contexto (ADR-0018). NÃO é booleano, e a razão está em `docs/engine-hooks.md`:
  // dos seis motores estudados, dois não têm evento nenhum, um tem e não bloqueia, e os que bloqueiam
  // não bloqueiam da mesma forma. Booleano confundiria "não tem evento" com "tem e não bloqueia", e o
  // método gravaria hook num evento inexistente.
  //
  // `exit-code`: a doc diz que exit 2 bloqueia. A tabela de exit 2 deste evento diz "Can block?
  // Yes. Blocks compaction. Use `hookSpecificOutput.decision: \"deny\"`".
  compaction: {
    event: PRE_COMPACT,
    block: "exit-code",
    // O CANAL do aviso, como dado. Conferido na doc oficial em 2026-09-13:
    // https://code.claude.com/docs/en/hooks
    //
    // O stdout deste evento NÃO chega a ninguém: "For most events, Claude Code writes stdout to the
    // debug log and doesn't show it in the transcript. The exceptions are `UserPromptSubmit`,
    // `UserPromptExpansion`, `SessionStart`, and `PostModelSwitch`" — e o PreCompact não está entre
    // elas. Texto solto aqui faria a fatia parecer avisar sem avisar.
    //
    // O canal que existe é o envelope: "To surface a message to the user on any platform, return
    // `systemMessage` in JSON output."
    //
    // O motivo do bloqueio vai no `reason`, e não no stderr, porque "the blocking message is the
    // reason from your JSON's blocking decision when it makes one, and your stderr text otherwise"
    // — com a decisão declarada aqui, o stderr fica livre para ser canal de log (LOG-1/LOG-2).
    notice: ({ message, deny }) => JSON.stringify({
      ...(deny ? { hookSpecificOutput: { hookEventName: PRE_COMPACT, decision: "deny", reason: deny } } : {}),
      ...(message ? { systemMessage: message } : {}),
    }),
  },
  // O que mais pertence à conversa de uma sessão, além do arquivo que o payload aponta (ADR-0019).
  // É convenção de LAYOUT da plataforma, e não campo do payload — por isso mora aqui, como dado por
  // motor, e não como regra do núcleo.
  //
  // Medido em 2026-09-13 e reconferido em 2026-09-17, nos transcripts deste projeto. O payload aponta
  // `<dir>/<sessionId>.jsonl`, e o que pertence à sessão fica no diretório IRMÃO
  // `<dir>/<sessionId>/`:
  //
  //   - `subagents/agent-<id>.jsonl` — o raciocínio de cada subagente. Conferido em cinco sessões:
  //     14, 10, 8, 0 e 4 arquivos. **Zero é caso comum**, e ausência do diretório não é erro. O
  //     `pattern` exclui os `agent-<id>.meta.json` que vivem ao lado: são metadado, não transcript;
  //   - `tool-results/*.txt` — saída GRANDE de ferramenta derramada para disco. O transcript a
  //     referencia e o conteúdo vive fora dele, então sem isto uma referência aponta para registros
  //     que dizem "veja `toolu_XXX`" sem dizer onde. Medidos 0,5 MB no projeto. **O nome NÃO é
  //     sempre `toolu_<id>`**: há `bsqw855y0.txt` em disco, então o padrão é a extensão, não o
  //     prefixo — assumir o prefixo perderia arquivo em silêncio.
  //
  // É LISTA, e não um campo por tipo, porque já se conhecem dois tipos: o ponto de extensão desenhado
  // para um só seria o errado, que foi a lição da migração de hook do ADR-0018.
  //
  // `dir` vem em segmentos para o descritor não precisar importar `node:path` — e a semelhança com o
  // `hookFile` para aí: o primeiro segmento é um caminho ABSOLUTO de máquina, derivado do payload,
  // então ele contém separadores, ao contrário dos segmentos do `hookFile`, que têm invariante de
  // não conter nenhum.
  sessionArtifacts: (transcriptPath) => {
    const daSessao = transcriptPath.replace(/\.jsonl$/, "");
    return [
      { kind: "subagent", dir: [daSessao, "subagents"], pattern: /^agent-.+\.jsonl$/ },
      { kind: "tool-result", dir: [daSessao, "tool-results"], pattern: /\.txt$/ },
    ];
  },
  capabilities: {
    agentModel: true,
    agentEffort: true,
    contextFork: true,
  },
};
