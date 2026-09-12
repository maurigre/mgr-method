# ADR-0017: Política de modelo por intenção, com uma fonte e dois momentos de leitura

Date: 2026-09-11
Deciders: Mauri Reis

## Status

Accepted

## Context

O norte do método, declarado pelo autor em 2026-08-26, é que cada etapa do fluxo rode no modelo
adequado à necessidade daquela etapa: redação no melhor modelo com esforço alto, implementação no
modelo barato, verificação no melhor modelo com esforço máximo.

**Uma das três pernas está viva.** O agente do gate declara modelo e esforço desde o ADR-0010. As
outras duas não existem: nenhuma skill do método escolhe modelo, e o fluxo inteiro roda no modelo da
sessão do usuário.

**O atraso é de sequenciamento.** A ordem aprovada em agosto pôs o roteamento por modelo na última
fase do programa; seis features saíram desde então, todas na camada verificável. Esta decisão traz o
norte para a frente.

**Seis medições limitam o que pode ser prometido**, e nenhuma é escolha de desenho:

- **M-A** — `model` e `effort` numa skill valem **só pelo turno da invocação** e revertem no
  seguinte. Skill conversacional não pode ter modelo próprio, e o pedido ao pé da letra é
  irrealizável por esse caminho.
- **M-B** — só agente segura modelo por uma execução inteira, e **agente não conversa**:
  `AskUserQuestion` é removido do subagente mesmo quando listado.
- **M-C** — `effort` **não é observável** de fora, nem por transcript nem por payload de hook.
- **M-D** — o modelo passado **na invocação vence** o do agente. Medido em 2026-09-11: agente com
  `model: opus` invocado com `haiku` registrou `claude-haiku-4-5-20251001` nas quatro mensagens do
  transcript. Não se perguntou ao agente, porque auto-relato mente.
- **M-E** — ajustar o config e rodar `update` **já reescreve** o frontmatter do agente; ida e volta
  conferidas.
- **M-F** — o `update` faz isso **em silêncio**, sem dizer o que mudou.

**Reference:** Spec técnica em specs/orquestracao-por-etapa/03-spec.md.

## Decision

1. **Uma fonte só, dois momentos de leitura.** A política vive em `.mgr-core/config.json`, sob
   `agents`, com uma entrada por intenção. A **instalação** grava `model` e `effort` no frontmatter
   do agente — único jeito de o `effort` valer (M-C, M-E). A **invocação** lê a mesma chave e passa
   o `model`, vencendo o frontmatter (M-D). **A precedência é escrita:** o valor efetivo do `model`
   é o da invocação; o frontmatter vale quando ninguém passa nada; a saída diz qual dos dois valeu.

2. **`reviewGate` vira apelido de `agents.review`.** Config antiga segue funcionando byte a byte.
   Com as duas chaves presentes, `agents` vence e o conflito é **avisado**, nunca resolvido em
   silêncio.

3. **Nasce `mgr agents [<intenção>] [--json]`.** Skill é markdown e não lê JSON; para ler na
   invocação ela **pergunta**, como o ADR-0015 estabeleceu para o caminho de artefato. O comando
   responde `model`, `effort` e **de onde cada um veio** — configurado, default, ou não suportado
   pelo motor. Sem a CLI, o agente roda com o frontmatter, que é o comportamento de hoje.

4. **Redação e implementação por task viram agente; nenhum checkpoint migra.** Viram agente os
   trabalhos que cabem num turno e não perguntam nada: `mgr-draft` para PRD e spec, `mgr-task` para
   a implementação de uma task, `mgr-review` que já existe. Os checkpoints 1, 2 e 3 e os de bloco
   continuam na skill, porque agente não conversa (M-B). O fluxo passa de "a skill escreve e
   pergunta" para **"a skill encomenda, recebe e pergunta"**.

5. **A assimetria entre `model` e `effort` é declarada.** `model` é trocável na invocação; `effort`
   só pela definição do agente, logo só com `update`. Quem mudar apenas o `effort` é avisado de que
   o campo só passa a valer depois do `update`. Sem esse aviso o usuário conclui que a configuração
   não funciona — e estaria certo, porque metade dela não funcionou.

6. **A medição de token soma conversa mais agentes.** Fonte é o transcript JSONL, onde cada registro
   `assistant` traz `message.usage`. Cada agente tem transcript próprio, e medir só a conversa
   contaria a economia escondendo o custo — o risco que o autor nomeou. `cache_read_input_tokens` é
   reportado **à parte** e não entra no total. O critério é duplo: o contexto de conversa cai **e**
   o total fica abaixo de um teto **declarado pelo autor** em `agents.budget.totalTokens`. Sem teto
   configurado, a medição é reportada e não reprova.

7. **O `update` deixa de reescrever o agente em silêncio** (M-F), passando a dizer, por motor, o que
   mudou de `model` e de `effort`. Escrita em diretório do usuário sem log foi reprovação `LOG-1` do
   gate isolado numa fatia anterior; é a mesma classe de defeito.

8. **O Copilot degrada declarando.** A feature projeta bi-motor e **prova num**: o Copilot não tem
   campo de esforço e a conta de teste expõe um modelo só. **Fica `[A CONFIRMAR]`** se o override de
   modelo na invocação existe nele — a M-D foi medida no Claude Code, e supor violaria o princípio 2
   da CONSTITUTION.

> **Correção de 2026-09-11, antes da primeira linha de código:** as chaves de intenção nasceram
> como `redacao` e `execucao` ao lado de `review`, misturando idiomas numa **identidade parseável**.
> Corrigidas para `drafting`, `execution` e `review`, pelo ADR-0003 (inglês canônico) e pela mesma
> razão que o ADR-0016 registrou a dependência de idioma como dívida. A decisão não muda; só os
> nomes, e antes de virarem contrato de configuração.

> **Emenda de 2026-09-11 — o default deixa de publicar identificador de modelo.** A decisão 1 acima
> descreve a fonte e os dois momentos de leitura; o que mudou depois foi **qual é o default**.
>
> Nenhuma intenção nasce com identificador de modelo, em motor nenhum. Sem configuração, os três
> agentes herdam o modelo da sessão, e o `mgr agents` e o plano de instalação **avisam** disso,
> dizendo a razão e o que fazer.
>
> **Isto emenda o ADR-0010**, que publicava `opus` no claude-code por ser alias documentado e
> estável, e deixava o copilot sem default porque a lista de modelos é **da conta, não do produto**.
> Com ChatGPT, Antigravity e DeepWiki na fila, a exceção vira a regra: publicar identificador é
> palpite sobre conta de terceiro em qualquer motor, e a `RN-4` proíbe inventar identificador.
>
> **O custo, declarado:** sem configurar, ninguém recebe execução barata, e **o agente do gate deixa
> de rodar em `opus` para quem não configura nada** — mudança de comportamento em algo já entregue.
> O aviso existe para esse custo não ser silencioso.
>
> Acompanha o valor reservado `inherit`, que o autor escreve em `model` ou em `effort` para recusar
> a declaração de um campo que tenha default. O núcleo normaliza para ausência, e por isso `inherit`
> significa a mesma coisa em qualquer motor, inclusive nos que ainda não existem.

## Alternatives Considered

- **Ler a política só na instalação:** rejeitada porque mata o UC-2 do PRD — trocar de modelo
  passaria a exigir reinstalar, e a M-D prova que não precisa.
- **Ler a política só na invocação:** rejeitada porque o `effort` ficaria sem efeito nenhum. Ele não
  tem override (M-C, M-D) e só existe se estiver no frontmatter.
- **Uma fonte separada da do gate:** rejeitada porque criaria duas fontes para o mesmo campo, que é
  exatamente o defeito que a RN-1 proíbe e que esta decisão existe para não criar.
- **Migrar `spec-create` inteira para agente:** rejeitada porque perderia os três checkpoints
  bloqueantes. Agente não conversa (M-B), e checkpoint que some é o método deixando de ser o método.
- **Somar `cache_read_input_tokens` no total:** rejeitada porque leitura de cache não custa o mesmo
  que token novo; somá-la inflaria o número e a comparação perderia sentido.
- **Publicar um teto padrão de token:** rejeitada por ser número sem base. O teto depende do bolso e
  do fluxo de quem usa, e inventá-lo seria a invenção de métrica que a CONSTITUTION proíbe.
- **Esperar conta multi-modelo do Copilot antes de abrir a fatia:** rejeitada porque travaria o
  norte do método numa limitação de conta de terceiro, por tempo indeterminado.

## Consequences

### Positive

- O autor declara a política num arquivo e nenhum arquivo gerado precisa ser editado à mão.
- Trocar de modelo passa a valer na próxima invocação, sem reinstalar.
- O método passa a ter um número de token comparável, em vez de afirmar economia sem base.
- O `update` deixa de mudar o que o usuário configurou sem lhe dizer.
- Quem não configura `agents` mantém `enabled` e `effort` idênticos aos de hoje, e recebe três
  acréscimos declarados: dois agentes novos em disco, as intenções listadas no plano e no `status`,
  e o modelo herdado da sessão em vez de `opus`. **Corrigido em 2026-09-11:** esta linha prometia
  "idênticos aos de hoje", o que a emenda acima tornou falso.

### Negative

- **O agente de redação não vê a conversa.** Uma decisão que o autor tomou falando, e que ninguém
  escreveu em disco, não chega nele. Isso empurra o método para o que a L2.1 já manda — hand-off por
  disco, nunca por memória de conversa — mas o custo aparece aqui, pela primeira vez, como perda
  concreta.
- A política tem dois consumidores, e explicar qual venceu passa a ser obrigação da saída. Uma fonte
  com dois momentos de leitura é mais difícil de explicar do que uma fonte com um só.
- `model` e `effort` passam a se comportar de formas diferentes diante da mesma edição de config. A
  assimetria é da plataforma, mas quem sofre com ela é o usuário.
- O fluxo ganha agentes, e agente não compartilha contexto: o token total pode subir mesmo com a
  conversa encolhendo. É por isso que o critério é duplo.

### Risks and Mitigations

- **Risco:** um checkpoint bloqueante desaparecer na migração para agente. — **Mitigação:** critério
  de aceitação próprio conferindo, por teste sobre o texto das duas skills, que nenhum checkpoint
  some.
- **Risco:** a precedência entre invocação e frontmatter virar surpresa. — **Mitigação:** a saída do
  `mgr agents` diz o valor e a origem dele; o `update` diz o que mudou.
- **Risco:** a medição de token medir a coisa errada e vender economia falsa. — **Mitigação:** o
  total soma todos os transcripts envolvidos, o cache fica de fora, e o critério exige as duas
  metades — contexto menor e total abaixo do teto.
- **Risco:** desfazer o que os ADR-0010 a 0016 entregaram. — **Mitigação:** linha de base antes da
  primeira linha de código, **com a receita de cada checksum escrita junto** — lição da fatia
  anterior, onde o script não foi guardado e dois itens ficaram inconferíveis.
- **Revisit trigger:** reavaliar o item 8 quando houver conta Copilot multi-modelo; e reavaliar o
  item 6 se a plataforma passar a expor `effort` de forma observável.
