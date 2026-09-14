# Matriz de hooks por motor — estudo de viabilidade

> Escrito em 2026-09-12, a pedido do autor, **antes** de escrever código de suporte a motor novo.
> Cada célula tem fonte oficial. O que não foi verificado está marcado `[A CONFIRMAR]` e **não** é
> afirmado.
>
> Motivo: o método vai transformar o conhecimento de hook em dado no descritor de motor
> (ADR-0018). Um ponto de extensão desenhado conhecendo **dois** motores tem grande chance de ser o
> ponto de extensão errado.

## 1. A matriz

| | claude-code | copilot | codex | antigravity | deep code | opencode |
|---|---|---|---|---|---|---|
| Motor instalável hoje pelo MGR | **sim** | **sim** | não | não | não | não |
| Modelo de integração | comando de shell | comando de shell | comando de shell | comando de shell | **nenhum**, só `notify` pós-turno | **plugin TypeScript** |
| Arquivo de configuração | `.claude/settings.local.json` | `.github/copilot/settings.local.json` | `hooks.json` ou `[hooks]` no `config.toml` | `hooks.json` em `.agents/` ou `~/.gemini/config/` | `~/.deepcode/settings.json` | plugin no processo |
| Evento de pré-compactação | `PreCompact` | `preCompact` | `PreCompact` | **não existe** | **não existe** | `experimental.session.compacting` |
| `matcher` com `manual`/`auto` | sim | sim | sim | n/a | n/a | `[A CONFIRMAR]` |
| Pode impedir a compactação | **sim**, exit 2 ou `decision: block` | **não**, "notification only" | **sim**, `continue: false` | n/a | n/a | `[A CONFIRMAR]` |
| Forma do bloqueio | código de saída | — | campo de saída | — | — | — |
| Aninhamento da configuração | `hooks[Evento] = [entradas]` | `hooks[evento] = [entradas]` | `hooks[Evento] = [entradas]` | **`{nome: {Evento: [entradas]}}`** | n/a | n/a |
| **Lê `SKILL.md`?** | sim | sim | `[A CONFIRMAR]` | `[A CONFIRMAR]` | **sim**, e é o único fora dos dois atuais que já lê | `[A CONFIRMAR]` |

**Deep Code** é o agente de terminal que a própria documentação de API da DeepSeek indica para os
modelos DeepSeek. Ele **já lê Agent Skills**, em `~/.agents/skills/<nome>/SKILL.md` no escopo de
usuário e `./.deepcode/skills/<nome>/SKILL.md` no de projeto, e tem `reasoningEffort` na
configuração. O que ele **não** tem é sistema de hooks: só um `notify`, descrito como *"Path to a
notification script executed after each model turn"*, e **nenhuma menção a compactação**.

Fontes, todas consultadas em 2026-09-12: `code.claude.com/docs/en/hooks` ·
`docs.github.com/en/copilot/reference/hooks-configuration` · `learn.chatgpt.com/docs/hooks`
(redirecionado de `developers.openai.com/codex/hooks`) · `antigravity.google/docs/ide/hooks/` ·
`api-docs.deepseek.com/quick_start/agent_integrations/deepcode/` · documentação de plugins do
OpenCode.

## 2. Os cinco achados que importam

**1. O desenho generaliza para três dos seis.** claude-code, copilot e codex têm evento de
pré-compactação com o mesmo par de gatilhos, `manual` e `auto`. A decisão da fatia atual — decidir
pelo `trigger` no núcleo, em vez de rotear por `matcher` no arquivo do usuário — vale igual nos três.

**2. `blocksCompaction` booleano é insuficiente, e isto muda a fatia atual.** Há **três** estados, não
dois:

- o motor **não tem** evento de pré-compactação (antigravity, deep code);
- tem, e **não deixa** impedir (copilot);
- tem, e **deixa** (claude-code, codex).

Um booleano confunde o primeiro com o segundo. Quem não tem evento nenhum não recebe entrada de hook;
quem tem e não bloqueia recebe, grava e declara. Tratar os dois igual faria o método gravar hook num
evento que não existe.

**3. A forma do bloqueio não é a mesma onde ele existe.** O claude-code bloqueia por **código de
saída** 2, com o motivo no stderr [**corrigido em 2026-09-13**: o motivo vai em
`hookSpecificOutput.reason`, e o valor da decisão é `deny`, não `block` — o stderr deste evento vai
para o debug log]; o codex bloqueia por **campo de saída**, `continue: false`, com
`stopReason`. O descritor precisa carregar *como* se bloqueia, não só *se* bloqueia.

**4. O antigravity aninha a configuração de outro jeito.** Nos três primeiros, o evento é chave
direta de `hooks`. No antigravity, a forma documentada é `{ "nome-do-hook": { "Evento": [...] } }`,
com um nível a mais. Um descritor que assuma `settings.hooks[evento]` não alcança esse motor.

**5. O opencode não é motor de hook, é motor de plugin.** A compactação lá é
`experimental.session.compacting`, exposta pela API de plugins em TypeScript, carregada **dentro do
processo** — não é um comando externo que o método grave num arquivo de configuração. Integrar com
ele não é acrescentar um descritor: é outro modelo de integração, e seria feature própria.

## 3. O que isto recomenda

**Para a fatia em andamento:** trocar `blocksCompaction` booleano por um campo que expresse os três
estados e a **forma** do bloqueio. Sem isso, o primeiro motor novo obriga a mexer no núcleo de novo,
que é exatamente o que a migração para o descritor quer evitar.

**Os quatro motores novos ENTRAM — decisão do autor em 2026-09-12.** Codex, Antigravity, Deep Code e
OpenCode passam a ser destino declarado do método, ao lado dos dois atuais. Não são hipótese de
roadmap: são trabalho previsto, e é por isso que o ponto de extensão desta fatia foi desenhado
conhecendo os seis, e não os dois.

**Ordem recomendada**, por risco crescente:

1. **codex** — evento na mesma forma, gatilhos iguais, bloqueio disponível. É o que valida o desenho
   com menos risco.
2. **deep code** — não entra pela compactação, e sim pelo eixo de skills, onde é o mais barato: já lê
   `SKILL.md` e já tem `reasoningEffort`.
3. **antigravity** — obriga o descritor a lidar com aninhamento diferente e com ausência de evento de
   compactação. É o teste duro do ponto de extensão.
4. **opencode** — modelo de integração diferente. Não é continuação desta linha.

**Nada disto declara suporte.** Instalar skills, gravar agente e traduzir manifesto são outros eixos,
e deles só o de skills foi verificado, e só para o deep code.

## 4. DeepSeek: dois eixos, e eles dão respostas opostas

O autor nomeou DeepSeek. A resposta depende do eixo, e vale separar porque ela é **boa num e ruim no
outro**.

**Eixo modelo — já funciona hoje, sem código novo.** DeepSeek é antes de tudo um **provedor de
modelo**. O método já aceita qualquer identificador de modelo verbatim, e proíbe recusar por lista
fechada. Onde o motor aceitar um modelo DeepSeek, `mgr agents set` já o declara.

**Eixo motor — existe candidato, mas não por este eixo.** Não há "o motor DeepSeek": há vários
agentes de terminal em volta dos modelos (Deep Code, Reasonix, DeepSeek-TUI, deepseekcode). O
defensável é o **Deep Code**, que é o que a documentação de API da própria DeepSeek indica.

Para skills, ele é **o candidato mais barato de todos**: já lê `SKILL.md` num layout conhecido e já
tem `reasoningEffort`, que é o eixo de esforço do método. Para **compactação**, ele não serve: não
tem sistema de hooks, só um `notify` pós-turno, e a doc não menciona compactação.

Ou seja, ele entra pelo eixo de **instalação de skills**, não por esta fatia.

## 5. Pendente — o que o autor precisa responder

- **Motores gratuitos**: além do opencode, quais interessam. O critério é o mesmo — instalar skills e
  gravar hook. Sem hook, não há gatilho, e a compactação não alcança aquele motor.
- **Se Deep Code interessar**, confirmar que o alvo é ele e não um dos outros agentes DeepSeek.
