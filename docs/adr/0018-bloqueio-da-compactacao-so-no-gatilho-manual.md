# ADR-0018: Bloqueio da compactação de contexto só no gatilho manual

Date: 2026-09-12
Deciders: Mauri Reis

## Status

Proposed

Passa a `Accepted` no fechamento da fatia, quando a implementação confirmar que o bloqueio no
gatilho `manual` se comporta como a documentação promete. Registrar `Accepted` antes dessa
verificação seria afirmar sobre plataforma sem prova.

## Context

O método tem duas leis sobre compactação de contexto. A `L3.2` manda **nunca** aceitar a
compactação automática da ferramenta; a `L3.4` manda gravar hand-off perto do limite e encerrar a
sessão. As duas são vinculantes, vivem na fonte única `shared/laws/execution-laws.md` e entram no
contexto antes da primeira mensagem, pelo hook de sessão do ADR-0009.

**As duas foram violadas no dia em que eram mais necessárias.** Em 2026-09-12, durante a execução da
fatia `configurar-modelo-por-intencao`, a janela compactou. A lei estava no contexto, foi lida, e
não aconteceu. O hand-off só existiu depois, porque o autor pediu.

A causa não é a redação da lei: é que nada mecânico a faz valer. Quem decide compactar é o motor, e
o método só tinha texto pedindo que não. Enquanto o cumprimento depender de o agente lembrar no
momento certo, ele falha exatamente sob pressão de contexto, que é quando o agente está pior.

Os dois motores suportados expõem evento de pré-compactação, verificado na documentação oficial em
2026-09-12, e eles **não são simétricos**:

| | Claude Code (`PreCompact`) | Copilot (`preCompact`) |
|---|---|---|
| Gatilhos | `manual` e `auto`, com `matcher` | `manual` e `auto`, com `matcher` |
| Pode bloquear | **Sim** — exit 2, com `hookSpecificOutput.decision: "deny"` | **Não** — "notification only" |
| Motivo ao usuário | `hookSpecificOutput.reason`; o stderr só vale quando o JSON não decide | nenhum canal (reconferido em 2026-09-13) |

Fontes: `code.claude.com/docs/en/hooks` e `docs.github.com/en/copilot/reference/hooks-configuration`.

A restrição decisiva é uma frase da documentação do Claude Code:

> "If compaction was triggered proactively before the context limit, Claude Code skips it and the
> conversation continues uncompacted. If compaction was triggered to recover from a context-limit
> error already returned by the API, the underlying error surfaces and the current request fails."

Ou seja: **bloquear cegamente pode derrubar a requisição em curso.** Proteger o contexto não pode
custar o trabalho em andamento.

Esta é a primeira vez que o método **impede** uma ação da plataforma. O ADR-0009 decidiu um hook que
só informa; aqui o método passa a poder dizer não, o que é decisão de arquitetura e não aplicação de
decisão existente.

**Reference:** Technical spec at `specs/handoff-antes-da-compactacao/03-spec.md`.

## Decision

O método impede a compactação sob **três limites simultâneos**: só no gatilho `manual`, só no
claude-code, e por `exit 2` com o motivo declarado em `hookSpecificOutput.reason` (ver a emenda de
2026-09-13 abaixo — a primeira redação punha o motivo no stderr, que neste evento vai para o debug
log).

| Motor | `trigger: manual` | `trigger: auto` |
|---|---|---|
| claude-code | **Bloqueia** (exit 2, motivo em `hookSpecificOutput.reason`) | Grava e avisa, exit 0 |
| copilot | Grava e avisa, exit 0 | Grava e avisa, exit 0 |

No `manual` há humano esperando e nada está sendo recuperado: bloquear ali devolve a decisão a quem
pediu, com o hand-off já em disco. No `auto`, a frase citada acima torna o bloqueio um risco para a
requisição em curso, e o método não o corre.

**A decisão vive no núcleo**, lendo `trigger` do payload que chega por stdin — não no `matcher` do
arquivo de settings. **O hand-off é montado a partir de fato em disco** (plano, execução, estado do
git) e declara, em seção própria, que o decidido só na conversa não está ali. **Hand-off existente
nunca é sobrescrito**: o hook acrescenta uma seção datada.

O descritor de cada motor ganha `compaction`, com data e fonte no comentário. **Não é um booleano**:
o estudo de viabilidade de 2026-09-12 (`docs/engine-hooks.md`) checou seis motores e mostrou três
estados — motor **sem** evento de compactação (antigravity, deep code), motor com evento que **não deixa**
impedir (copilot), e motor que **deixa** (claude-code, codex). Um booleano confundiria os dois
primeiros, e o método gravaria hook num evento inexistente. A **forma** do bloqueio também entra,
porque ela difere onde ele existe: o claude-code bloqueia por código de saída, o codex por campo de
saída (`continue: false`). O comando `mgr precompact --hook <motor>` engole qualquer falha e sai
0, como o `mgr detect --hook` já faz; o bloqueio é a única saída diferente de zero, e é intencional.

**Emenda de 2026-09-13, vinda do gate de fechamento.** O aviso ao usuário sai pelo **canal que cada
motor declara**, e o canal é dado do descritor (`compaction.notice`). Não é detalhe de
implementação: a primeira versão desta fatia imprimia texto solto no stdout, e a doc do claude-code
diz que o stdout deste evento vai para o **debug log** — *"For most events, Claude Code writes stdout
to the debug log and doesn't show it in the transcript. The exceptions are `UserPromptSubmit`,
`UserPromptExpansion`, `SessionStart`, and `PostModelSwitch`"*. Nenhuma das mensagens chegava a
ninguém nos caminhos que não bloqueiam.

O canal documentado é o envelope: *"To surface a message to the user on any platform, return
`systemMessage` in JSON output."* No claude-code o motivo do bloqueio vai junto, em
`hookSpecificOutput.decision: "deny"` com `reason`, que é o idioma que a tabela de exit 2 deste
evento documenta. O **exit 2 continua sendo o transporte** do bloqueio. No copilot `notice` é `null`,
porque a doc dele classifica o evento como *"No — notification only"*, diz que a saída não é
processada e não oferece campo por onde falar com o usuário: ali o hand-off é gravado e **nada é
impresso**, porque imprimir num canal que a plataforma descarta faria o método parecer avisar.

Uma consequência de desenho vem com isso: com a decisão declarada no envelope, a mensagem de bloqueio
é *"the reason from your JSON's blocking decision"* e não o stderr — então o **stderr fica sendo o
canal de log** do comando, que é o que a LOG-1/LOG-2 do guia de review pede. Sem exceção no guia.

O arquivo de leis **não é alterado**: o texto da `L3.2` e da `L3.4` continua verdadeiro, e esta
decisão é o mecanismo que os faz valer.

**Junto com isto, a dívida do ADR-0010 sobre `src/hooks.js` é paga.** Aquele ADR criou o descritor de
motor e adiou de propósito a migração de `hooks.js` e `adapters.js`, para não reescrever código verde
no meio de outra fatia. Esta fatia acrescenta o **segundo** evento de hook, e mantê-lo no estilo atual
dobraria a ramificação por nome de motor. Então arquivo, eventos, forma da entrada e envelope de cada
motor passam a ser **dado no descritor**, e `src/hooks.js` fica dono só do comportamento: prova de
posse, idempotência e remoção que preserva entrada alheia. Um terceiro motor passa a ser um arquivo
em `src/engines/`. `adapters.js` e a saída do hook de sessão em `detector.js` **não** entram, e
continuam declarados como a outra metade da dívida.

## Alternatives Considered

- **Bloquear sempre no claude-code:** cumpriria a `L3.2` ao pé da letra, mas a documentação oficial
  diz que bloquear uma compactação disparada para recuperar de estouro de contexto faz o erro
  subjacente aparecer e a requisição em curso falhar. O método derrubaria o trabalho que pretende
  proteger.
- **Nunca bloquear, só gravar e avisar:** mais simples e sem risco, mas deixa a `L3.2` sem
  cumprimento em caso nenhum, inclusive no `manual`, onde bloquear é comprovadamente seguro.
- **Rotear por `matcher` no arquivo de settings:** a plataforma permite, e resolveria com
  configuração. Rejeitado porque o arquivo de hook é do **usuário**, não do MGR (premissa do
  ADR-0009): política escrita lá é editável sem que se perceba que se está mudando regra do método,
  o `update` teria de reconciliá-la, e decisão em arquivo de configuração não tem teste.
- **Um agente monitorando a janela e decidindo quando gravar:** rejeitado por três razões. O agente
  é o **objeto** do evento, não observador dele, e agiria com confiabilidade justamente quando está
  pior; ele não enxerga a própria janela, e a `L3.8` existe por isso, mandando arquivar por evento
  quando a ferramenta não expõe contagem real; e há evidência direta, porque a `L3.2` já entrava no
  contexto antes da primeira mensagem e a compactação aconteceu assim mesmo. Precedente: o ADR-0009
  rejeitou detecção por agente pelo mesmo eixo, com argumento empírico — sem o contexto do hook, o
  agente alucinou o ecossistema a partir do nome do diretório.

## Consequences

### Positive

- Duas leis vinculantes ganham gatilho mecânico, e deixam de depender de o agente lembrar.
- O estado vai para o disco **antes** da compactação, que é o único lugar que ela não alcança.
- A assimetria entre os motores fica declarada em `compaction` (`event` mais `block`), consultável em
  vez de ramificada por nome de motor.
- O usuário do `/compact` recebe o motivo e decide, em vez de descobrir depois que perdeu contexto.

### Negative

- O método passa a poder interromper um pedido explícito do usuário, o que é comportamento novo e
  precisa ser óbvio quando acontece.
- Mais um evento de hook em arquivo que é do usuário, com a reconciliação que isso implica.
- **Medido em 2026-09-17, e calibra o que esperar desta decisão:** varridos **todos os cinco transcripts de
  sessão** deste projeto, as **três** compactações registradas tiveram `trigger: auto` — nenhuma foi
  `manual`. O
  `compactMetadata` de cada boundary registra isso, junto de `preTokens` perto de **1 milhão** contra
  `postTokens` de **18 a 27 mil**, ou seja cerca de **97% do contexto descartado** por compactação.
  **Então o bloqueio desta decisão não teria agido em nenhuma delas.** A decisão continua certa pelas
  razões acima — bloquear no `auto` pode derrubar a requisição em curso, e a doc é explícita —, mas o
  que ela protege na prática é o caso menos frequente. Quem contar com ela para evitar perda de
  contexto vai depender do hand-off, não do bloqueio. Medição em
  `specs/dump-de-contexto-antes-da-compactacao/medicao-boundary.md`.
- No copilot o aviso **não tem canal nenhum**, e isso é da plataforma: o hand-off é gravado e o
  usuário não é avisado. A degradação é declarada no CHANGELOG e nos READMEs, que é onde ele pode ler.
- O método passa a depender de um campo de saída estruturado do claude-code (`systemMessage` e
  `hookSpecificOutput`), e não só de código de saída — mais superfície de contrato a manter.

### Risks and Mitigations

- **Risco:** bloquear no `manual` também falhar em algum caso não documentado. **Mitigação:** o ADR
  nasce `Proposed` e só vira `Accepted` depois da verificação em sessão real.
- **Risco:** afirmar comportamento de plataforma a partir do que parece razoável em vez do que a doc
  diz. **Materializou-se nesta fatia:** a primeira versão supôs que a saída do hook chegava ao
  usuário, e por isso o aviso não chegava a ninguém no gatilho `auto`. **Mitigação:** cada campo do
  descritor carrega data e citação textual da fonte, e a verificação em sessão real passou a incluir
  o `systemMessage`, não só o bloqueio.
- **Risco:** o hand-off montado a partir do disco parecer completo e não ser. **Mitigação:** seção
  própria declarando que o decidido só na conversa não está ali.
- **Risco:** sobrescrever um hand-off mais rico, escrito pelo agente. **Mitigação:** o hook nunca
  sobrescreve; acrescenta seção datada.
- **Risco:** uma exceção no hook poluir o contexto ou derrubar a sessão de quem só abriu o editor.
  **Mitigação:** o comando engole qualquer falha e sai 0, com o bloqueio deliberado como única
  exceção.
- **Risco:** o ponto de extensão nascer desenhado para dois motores e não servir ao terceiro.
  **Mitigação:** o estudo de `docs/engine-hooks.md` checou seis antes de o código existir, e já
  corrigiu a capacidade de booleano para três estados. Ele também registra que o antigravity aninha a
  configuração de outro jeito e que o opencode é plugin, não hook — limites conhecidos, não surpresas.
- **Risco:** a migração de `src/hooks.js` mudar em silêncio o que o hook de sessão grava, que é
  código verde e já instalado. **Mitigação:** linha de base do arquivo gravado antes da migração e
  conferência **byte a byte** depois, nos dois motores, como critério de aceitação.
