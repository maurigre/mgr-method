# ADR-0010: Adoção do gate de validação como agente e de agentes como artefato instalável

Date: 2026-08-30
Deciders: Mauri Reis

## Status

Accepted

## Context

O objetivo final registrado no PRD da feature `modelo-por-etapa` é que cada etapa do fluxo rode
no modelo adequado à sua necessidade: raciocínio forte para especificar e para validar, modelo
barato para executar no trilho.

A medição de 2026-08-26 mostrou que a skill não é a peça capaz de sustentar isso. `model` e
`effort` declarados no frontmatter de uma skill valem **pelo turno da invocação e revertem no
seguinte** — verificado em sessão viva de dois turnos, com o turno da skill em `claude-sonnet-5`
e 2.262 thinking tokens, e o turno seguinte de volta em `claude-opus-5` com 42. Só o agente
segura modelo e esforço pela execução inteira, e o preço é que ele não interage com o usuário.

Disso decorre o princípio de arquitetura: a peça que precisa de modelo forte nunca é a skill
inteira — é a **unidade de trabalho** dentro dela. A skill orquestra e segura os checkpoints
humanos na conversa; o agente faz o trabalho fechado e declara modelo e esforço.

O `code-analyzer` é o caso em que nada se perde ao virar agente, e não por acaso: ele já é
delegação hoje. Recebe o escopo de arquivos como argumento explícito, lê
`docs/sdd/09-review-rules.md` do disco — a skill proíbe analisar "com regras que você conhece de
cor" — e produz um parecer único ao final, sem perguntar nada no meio. Tudo o que a delegação
por agente exige, ele já fazia por desenho.

Há ainda um ponto do ADR-0004 que esta decisão precisa reabrir antes de construir em cima:
`src/plugin.js:16` declara `EFFORT_LEVELS = ["low", "medium", "high", "max"]`, enquanto a
plataforma documenta cinco níveis. Isso **não é defeito** — é a decisão 6 do ADR-0004, tomada
com uma razão que hoje já não se aplica. A emenda está declarada na seção abaixo.

**Reference:** Spec técnica em specs/modelo-por-etapa/03-spec.md.

## Amendment to ADR-0004

A decisão 6 do ADR-0004 fixou a escala de effort em quatro valores, com esta razão: *"o `xhigh`
do Claude Code não é endereçável via manifest na v1"*. **Essa razão expirou.** O ADR-0004 tratava
de um método que instalava apenas skills; a partir desta decisão o método também **escreve
arquivo de agente**, e é ali que `xhigh` é endereçável — a plataforma documenta cinco níveis
tanto para skill quanto para subagente.

Por isso `EFFORT_LEVELS` passa a `low, medium, high, xhigh, max`, e a decisão 6 do ADR-0004 fica
emendada por esta. A mudança **alarga** a validação e não quebra nenhum manifest válido hoje:
um manifest que era aceito continua aceito, e um que declarava `xhigh` deixa de ser recusado
sem motivo vigente.

Registra-se também, para não ficar subentendido, uma distinção que o ADR-0004 não precisava
fazer e agora precisa: a decisão 2 daquele ADR proíbe **IDs datados de modelo** no
`mgr-manifest.json`, que é conteúdo **publicado** por um autor de skill para terceiros. O
`reviewGate.model` desta decisão é config **local** de quem usa o método, e ali o ID datado
muitas vezes é o único valor que a conta aceita (V-4). São contratos diferentes; a proibição do
ADR-0004 continua valendo onde foi escrita.

## Decision

1. **O `code-analyzer` passa a rodar em agente próprio**, com modelo e esforço declarados no
   arquivo do agente e sem ferramenta de escrita. O comando `/code-analyzer` e os três
   chamadores (usuário, `spec-create` Fase 6, `spec-execute` no self-review por task) permanecem
   intactos: muda o motor por baixo, não o contrato de quem chama. O roteamento até o agente é
   **estrutural** no `claude-code` (`context: fork` + `agent:` no frontmatter, a plataforma
   roteia) e por **instrução** no `copilot` (o corpo da skill manda delegar via `task`) — a
   assimetria é declarada, não escondida.

2. **Agentes viram um novo tipo de artefato instalável**, ao lado das skills, com diretório por
   motor e escopo, registro no `manifest.json` para `uninstall`/`update`, e **prova de posse por
   marcador** no conteúdo do arquivo — mesma regra que `src/hooks.js` já aplica, porque
   `.claude/agents/` e `.github/agents/` são diretórios do usuário.

3. **`reviewGate.model` é mapa por motor**, forma que o `mgr-manifest.json` já usa e que
   `src/adapters.js:33` já lê. Default `opus` apenas no `claude-code`, por ser alias documentado
   e estável. **Nenhum default no `copilot`**: a lista de modelos ali é da conta e não do
   produto, então o agente é escrito sem o campo e herda o modelo da sessão. Identificador
   informado pelo usuário é repassado **verbatim**, sem validação contra lista fechada.

4. **O conhecimento por motor passa a ser dado**, num descritor `src/engines/<id>.js` com
   diretórios, nome de arquivo, forma de roteamento e matriz de capacidades — em vez de
   ramificação por nome de motor. No escopo desta fatia o descritor é consumido apenas pelo que
   ela constrói.

## Alternatives Considered

- **Substituir a skill `code-analyzer` por um agente:** apagaria o comando `/code-analyzer`,
  contrato público desde a 0.1.0, ferindo a CONSTITUTION §2.7 sem necessidade. Com
  `context: fork` o nome e os chamadores sobrevivem.
- **Declarar `effort` na própria skill:** a documentação garante que `model` no fork define o
  modelo do subagente, mas não afirma o mesmo de `effort`. Declarar no arquivo do agente é onde
  os dois campos estão documentados e onde a medição os observou funcionando. Não se aposta no
  não verificado.
- **Publicar um identificador de modelo fixo para o `copilot`:** a conta de teste recusou seis
  identificadores e aceitou um só — a lista é da conta. Um valor publicado pelo método seria
  palpite sobre a conta de terceiro, e quebraria ou degradaria em silêncio.
- **Validar o identificador contra uma lista fechada do método:** lista nossa envelhece na
  velocidade do CLI e passa a recusar modelo válido. Quem valida é a plataforma, que já avisa e
  substitui.
- **Migrar `hooks.js` e `adapters.js` para o descritor agora:** é código verde com testes
  passando; reescrevê-lo dentro desta feature seria refatoração fora do trilho da spec. Fica
  como feature própria, com testes de não-regressão próprios.

## Consequences

### Positive

- O gate de validação passa a rodar no modelo e no esforço declarados **pela execução inteira**,
  não por um turno.
- O parecer deixa de nascer do histórico da conversa e passa a nascer só do guia em disco e dos
  arquivos nomeados — menos superfície de alucinação e menos contexto consumido.
- O self-review por task do `spec-execute` deixa de ser feito pela mesma janela que escreveu o
  código: quem escreve e quem verifica se separam.
- Um revisor sem ferramenta de escrita não tem como "corrigir" o que deveria reprovar. A
  garantia vem de um campo de frontmatter, não de disciplina de prompt.
- Acrescentar um eixo de capacidade a um motor passa a tocar um arquivo de descritor.

### Negative

- O gate perde o histórico da conversa. Para este gate é ganho, mas fixa o limite: só vira
  agente o trabalho que já não dependia da conversa.
- No `copilot` o roteamento depende de o modelo obedecer à instrução, não da plataforma —
  determinismo menor que no `claude-code`.
- No `copilot` o gate roda no modelo declarado mas no **esforço da sessão**: não existe campo
  equivalente a `effort` ali.
- Por uma fatia convivem dois estilos de conhecimento por motor — o descritor novo e os mapas em
  `installer.js`, `hooks.js` e `adapters.js`. Dívida declarada, com destino nomeado.

### Risks and Mitigations

- **Risco:** o MGR sobrescrever ou remover arquivo de agente que o usuário escreveu. —
  **Mitigação:** marcador de posse no conteúdo; arquivo sem marcador não é tocado, e a
  instalação avisa e segue. É o mesmo defeito destrutivo já corrigido na 0.6.0-beta.2 com skill
  de mesmo nome.
- **Risco:** a verificação do Copilot foi feita em conta que expõe um único modelo, então não se
  demonstrou dois modelos distintos lado a lado. — **Mitigação:** limite registrado na spec e
  neste ADR; **revisit trigger** — reverificar em conta multi-modelo antes de o passo 3 depender
  disso.
- **Risco:** a matriz de capacidades por motor envelhecer sem ninguém perceber, como já ocorreu
  com o comentário de `src/adapters.js:4-5`. — **Mitigação:** a capacidade vira dado no
  descritor, com teste que reprova motor sem descritor; e a regra de processo do kickoff
  (verificar a documentação atual antes de decidir por capacidade de plataforma) continua
  valendo.
