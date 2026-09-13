# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) · [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]
### Adicionado
- **`mgr agents set <intenção> [--model] [--effort] [--engine]`**: escreve a política de uma
  intenção sem você abrir o JSON. Escrever um motor **não apaga** o outro, escrever uma intenção não
  mexe nas vizinhas, e passar `--effort` não apaga o `model`. Valor inválido é recusado **antes** de
  gravar, então o config nunca fica quebrado pela mão do próprio método.
- **Skill `configure-agents`**, instalada em todo projeto: lê o estado, explica o que cada intenção
  faz e quantas vezes ela roda, e escreve pelo comando. Ela **não** entra no CORE, que segue com seis.
- **`documentedModels` no descritor de cada motor**: os identificadores que a documentação da
  plataforma publica, com data e fonte no comentário. É sugestão, e nunca grade de validação.
- **O contexto não é mais compactado em silêncio** (ADR-0018): quando o motor anuncia que vai
  compactar, o método **grava o hand-off antes**, diz o motivo e sugere sessão nova. No `/compact`
  pedido por você, no claude-code, ele ainda **impede** a compactação uma vez, para você decidir com
  o estado já a salvo.
- **`mgr precompact --hook <motor>`**: o comando que o hook chama. Monta o hand-off a partir de fato
  em disco, **nunca sobrescreve** um hand-off existente, e declara em seção própria o que ele não tem
  como saber.
- **O conhecimento de hook virou dado no descritor de motor**: arquivo, eventos, matcher e teto de
  tempo por evento, forma da entrada, envelope e o canal de aviso. Um motor novo passa a ser um
  arquivo em `src/engines/` mais uma linha no mapa de motores. Isso paga metade da dívida que o
  ADR-0010 tinha nomeado — a outra metade segue nomeada e aberta: `src/adapters.js`, o instalador e a
  saída do hook de sessão em `src/detector.js`.
- **O hook de pré-compactação declara um teto de tempo de 15s.** Ele lê o payload do stdin, e o
  default que a doc do Claude Code declara para hook de comando é de 600s — dez minutos pendurado
  se algo não fechar a entrada. O hook de início de sessão **não** foi tocado.

### O que degrada, declarado
- **No Copilot a compactação não pode ser impedida, e o aviso não tem como chegar a você.** A
  documentação oficial classifica o evento de pré-compactação dele como *"notification only"*, diz
  que a saída do hook não é processada e não oferece nenhum campo por onde falar com você — ao
  contrário do evento de início de sessão, que aceita contexto adicional. O hand-off **é gravado
  igual**; o que não existe ali é canal de aviso. O método prefere calar a imprimir num canal que a
  plataforma descarta, porque isso o faria parecer avisar.
- **No claude-code o aviso chega em todo caminho, e não só no bloqueio.** Ele vai pelo campo que a
  doc indica para falar com você (`systemMessage` no JSON de saída). O `stdout` do hook, que a versão
  anterior desta fatia usava, vai para o **debug log** neste evento — quem só olhasse a sessão não
  veria mensagem nenhuma.
- **Bloquear é só no `/compact` que você pediu.** No automático, não: a doc do Claude Code diz que
  bloquear uma compactação disparada para recuperar de estouro de contexto faz a **requisição em
  curso falhar**. Proteger o contexto não pode custar o trabalho em andamento.
- **O bloqueio vale uma vez.** Se você insistir logo em seguida, passa — senão o método tiraria o
  `/compact` de você para sempre.
- **O hand-off do hook não vê a conversa.** O que foi decidido falando e não chegou ao disco não
  entra nele, e o arquivo diz isso.
- **Nenhum motor lista os modelos que a sua conta tem.** Foi verificado na documentação oficial dos
  dois: não existe comando de listagem. Por isso a skill oferece os **aliases documentados** de cada
  motor e **aceita qualquer identificador** que você escrever. Lista nossa envelheceria e passaria a
  recusar modelo válido.
- **No Copilot não há o que oferecer.** Os modelos disponíveis ali são da conta, e a plataforma só
  os revela em runtime, como aviso, depois de você declarar um que ela não tem. A lista vazia é o
  fato, não esquecimento.
- **A skill nunca diz qual modelo usar em qual etapa.** Ela explica o que cada intenção faz e quanto
  ela roda; escolher exige saber a sua conta e o seu orçamento, que ela não vê.
- **O comando não roda o `mgr update`.** Como antes, `model` vale na próxima invocação e `effort` só
  depois do `update` — a assimetria é da plataforma, e agora o comando diz isso a cada escrita.
- **Os aliases documentados vivem em dois lugares**: no descritor do motor e no texto da skill. A
  CLI ainda não expõe o campo, então as duas cópias carregam data e fonte para divergirem de forma
  visível.

### Planejado
- **Quatro motores novos, decididos em 2026-09-12**, ao lado do claude-code e do copilot:
  **Codex CLI**, **Antigravity**, **Deep Code** (agente de terminal dos modelos DeepSeek) e
  **OpenCode**. A matriz de capacidade de cada um, com fonte oficial e data, está em
  `docs/engine-hooks.md` — inclusive o que **não** dá: o OpenCode integra por plugin e não por hook,
  e Antigravity e Deep Code não têm evento de pré-compactação. A matriz traz fonte oficial e data em
  cada célula que foi confirmada, e diz `[A CONFIRMAR]` nas que não foram — o OpenCode e o Codex
  ainda têm células abertas, e isso está escrito lá em vez de arredondado aqui.
- Suporte a Cursor como motor de instalação.
- Modo scaffold (geração de estrutura de código no greenfield).

## [0.7.0-beta.10] - 2026-09-11
> Cada etapa do fluxo passa a rodar no modelo que você declarar. Pré-release no dist-tag `next`.

### Adicionado
- **Política de modelo por intenção** (ADR-0017): `agents` no `.mgr-core/config.json`, com uma
  entrada para `drafting`, `execution` e `review`. **Uma fonte, dois momentos de leitura** — a
  instalação grava no frontmatter do agente, a invocação lê a mesma chave e passa o modelo.
- **`mgr agents [<intenção>] [--json]`**: responde qual modelo e qual esforço cada intenção usa, por
  motor, e **de onde veio cada valor** — configurado, default, ou não suportado pelo motor.
- **Dois agentes novos**: `mgr-draft` escreve o PRD e a spec; `mgr-task` implementa uma task. Os dois
  declaram, no próprio corpo, que nunca perguntam nada e que não veem a conversa.
- **Ferramentas por necessidade da intenção**: a intenção declara se precisa de leitura ou de
  escrita, e o motor traduz. Só o `mgr-task` recebe escrita; **o gate continua só leitura**, que é
  invariante do ADR-0010 e tem teste próprio.
- **`src/tokens.js`**: soma o token da conversa e o de cada agente que ela subiu, com
  `cache_read_input_tokens` reportado à parte. O teto é declarado por você; sem teto, mede e não
  reprova.
- **As duas skills do fluxo encomendam em vez de escrever**: `spec-create` delega a redação,
  `spec-execute` delega a implementação de cada task. **Nenhum checkpoint humano migrou**, e há teste
  que fica vermelho se algum sumir.
- **`mgr tokens [--json]`**: soma o token da conversa e o de cada agente que ela subiu, reporta o
  contexto de conversa e o `cache_read` **à parte**, e compara com o teto declarado em
  `agents.budget.totalTokens`. Sem teto, mede e não reprova.
- **`inherit` em `model` e em `effort`**: o valor com que você recusa a declaração de um campo. O
  núcleo normaliza para ausência, então ele significa a mesma coisa em qualquer motor.

### Corrigido
- **`mgr update` reescrevia o frontmatter do agente em silêncio.** Passa a dizer, campo a campo, o
  que mudou de `model` e de `effort` — e não inventa linha quando nada mudou.
- **A mensagem do install chamava todo agente de "gate de validação"**, inclusive os que não são.
  Passa a nomear o agente escrito.
- **O gate desligado desligava a instalação de agentes inteira.** Agora cada intenção decide sozinha,
  e recusar a revisão não leva junto a redação e a execução.
- **Agente alheio de mesmo nome bloqueava a instalação inteira**; agora bloqueia só o próprio
  arquivo.

### Alterado
- **Nenhum modelo é publicado por default, em motor nenhum.** Sem configuração, os três agentes
  herdam o modelo da sessão, e o `mgr agents` e o plano de instalação **avisam**, dizendo a razão e
  o que fazer. Isto **emenda o ADR-0010**: ele publicava `opus` no claude-code e deixava o copilot
  sem default porque a lista de modelos é **da conta**, não do produto. Com mais motores na fila, a
  exceção virou a regra.
- **O agente do gate deixou de receber `model: opus` para quem não configura nada.** É a única
  mudança desta versão que altera o comportamento de algo já entregue, e não só a saída.

### O que degrada, declarado
- **Sem configurar, ninguém recebe execução barata.** O default herda, e o benefício de rodar cada
  etapa no modelo certo exige declarar um modelo por intenção. O aviso existe para isso não ser
  descoberto tarde.
- **O agente de redação NÃO vê a conversa.** Uma decisão tomada falando, e nunca escrita em disco,
  não chega nele. Isso empurra o método para o que a L2.1 já mandava — hand-off por disco —, mas o
  custo aparece aqui pela primeira vez como perda concreta.
- **`model` e `effort` não se comportam igual.** O `model` pode ser trocado na invocação e vale já na
  próxima; o `effort` só existe no arquivo do agente, então **só passa a valer depois de
  `mgr update`**. A assimetria é da plataforma, e o `mgr agents` avisa dela em toda execução.
- **O roteamento foi provado em UM motor.** O Copilot não tem campo de esforço, e a conta de teste
  expõe um modelo só. Fica **`[A CONFIRMAR]`** se o override de modelo na invocação existe nele.
- **Agente recém-instalado demora a ficar disponível.** Há uma janela em que o arquivo está em disco
  e a invocação ainda falha. As duas skills tratam isso como caso previsto, escrevem o documento
  elas mesmas e dizem que fizeram assim — nunca tentam em laço.
- **A medição de token não prova economia sozinha.** Agente não compartilha contexto: a conversa pode
  encolher e o total subir. Por isso o critério é duplo, e `cache_read` fica fora do total.

## [0.7.0-beta.9] - 2026-09-11
> Conserta a 0.7.0-beta.8, que não instalava. Pré-release no dist-tag `next`.

### Corrigido
- **`mgr install` morria com `recurso do MGR ausente: agents` em quem instalava do npm.** O
  diretório `agents/` virou artefato instalável na `0.7.0-beta.2`, e a whitelist `files` do
  `package.json` nunca foi atualizada — o tarball saía sem ele e o instalador falhava **antes de
  escrever qualquer coisa**. A `0.7.0-beta.8` foi a primeira versão publicada com o gate, então foi
  nela que o defeito apareceu.

### O que degrada, declarado
- **Nenhum teste pegava isto, e agora um pega.** Todos os testes de instalação rodam a partir do
  working tree, onde `agents/` sempre existe. O teste novo empacota de verdade e confere que **todo
  recurso exigido por `src/bundle.js`** viaja no tarball — a lista é derivada da fonte, não escrita
  à mão, então acrescentar um recurso sem publicá-lo quebra o teste.
- **A `0.7.0-beta.8` continua publicada e continua quebrada.** Versão publicada não é sobrescrita;
  quem instalou precisa subir para a `0.7.0-beta.9`.

## [0.7.0-beta.8] - 2026-09-11
> A etiqueta de proveniência passa a ser conferida onde há fato. Pré-release no dist-tag `next`.

### Adicionado
- **`PROV-1` a `PROV-4` no `mgr spec validate`** (ADR-0016): etiqueta malformada, ponteiro
  `[code:<caminho>:<linha>]` que não resolve em disco, e caminho que escapa da raiz do repositório
  são **erro**; marca de pendência ao fim da linha numa feature com `06-completion.md` é **aviso**.
  Mesmo comando, mesma assinatura, mesmo envelope `--json`.
- **A proveniência vale para QUALQUER artefato canônico**, não só para o plano e a spec. A linha de
  OK do comando passou a contar os artefatos que de fato foram lidos — de 2 por feature para os
  canônicos presentes.
- **`src/provenance.js`, `src/prov-rules.js` e `src/prov-validator.js`**, o terceiro trio de
  parser, regras e orquestrador. A lista de artefatos vem do `spec-status` e o bloco cercado vem do
  `stripFencedBlocks`: nenhuma descoberta nova, nenhuma cópia.
- **O `code-analyzer` parou de assumir caminho**: passa a consultar `mgr spec status --json` com o
  caminho literal como **fallback declarado**, como as outras duas skills do fluxo já faziam. O
  teste de fallback cobre agora as **três**.

### Corrigido
- **`mgr spec next --all` era aceito e ignorado.** Respondia sobre uma feature com cara de resposta
  sobre todas. Passa a ser recusado, com mensagem própria e código diferente de zero.
- **`mgr spec next` sem slug, rodado da raiz, escolhia a primeira feature em silêncio** e respondia
  como se fosse a resposta. Passa a dizer quantas features existem e a pedir o nome, ou que se rode
  de dentro de `specs/<slug>/`.

### Alterado
- **A nota de status da L1.10** deixou de dizer "declarada, ainda não verificável" e passou a dizer
  o que **é** conferido — a etiqueta escrita — e o que **continua** por disciplina — a presença
  dela. O texto normativo da lei não mudou, e as 45 leis seguem intactas.

### O que degrada, declarado
- **A regra que cobraria a etiqueta NÃO foi feita, e isso é decisão, não pendência.** "Asserção
  normativa sem etiqueta é erro" foi rejeitada por decisão de produto sustentada em medição: a
  adesão é **zero** em todo o acervo, e o custo cairia sobre cada linha normativa escrita para
  sempre. A ferramenta confere fato; ela não cobra disciplina. Quem não etiquetar não é reprovado
  por nada.
- **Etiqueta só conta em posição de marca** — o `]` como último caractere da linha. Ponteiro
  escrito no meio de uma frase **não é conferido**. Medido: a definição tolerante, que aceitaria
  crase ou pontuação depois do `]`, produziria erro sobre artefatos de features já fechadas.
- **A `PROV-3` tem falso positivo conhecido e medido**: uma citação que por acaso termina a linha é
  apontada. Não há regra mecânica que a separe de uma pendência real. Por isso ela é aviso, e **a
  própria mensagem declara** o que detecta e o que não distingue.
- **O resultado da `PROV-2` depende da máquina.** Ela confere disco, e `specs/` é gitignored neste
  projeto — gitignored conta como existente, porque é exatamente onde as asserções vivem. Um
  artefato que passa aqui pode falhar num clone sem `specs/`. A saída não promete portabilidade.
- **Três formas de marca de pendência são reconhecidas** — `[TO DEFINE]`, `[A DEFINIR]` e
  `[A CONFIRMAR]`. Identidade parseável não deveria depender de idioma, e aqui depende. É **dívida
  declarada**, registrada no ADR-0016: canonizar obrigaria a migrar o acervo ou a reprovar o que
  existe.

## [0.7.0-beta.7] - 2026-09-11
> O plano e a spec passam a dizer ONDE estão. Pré-release no dist-tag `next`.

### Adicionado
- **`mgr spec status`** (ADR-0015): responde quais artefatos existem numa feature, **onde cada um
  está**, o que falta escrever e se há `.handoff.md` em disco. Aceita `--all` e `--json`.
- **As skills `spec-create` e `spec-execute` param de assumir caminho** no caminho feliz: passam a
  consultar o comando, com o caminho literal de hoje mantido como **fallback declarado** para quem
  não tem a CLI instalada.
- **`slugs(repo)` em `src/artifacts.js`**, fonte única da listagem de features. O `artifactFiles`
  passou a consumi-la, então há um `readdirSync` só **sobre `specs/`** no projeto.

### Corrigido
- **Os comandos `spec` deixaram de tratar o diretório atual como raiz do repositório.** Rodados de
  dentro de `specs/<slug>/`, `validate`, `next` e `status` procuravam artefato em
  `specs/<slug>/specs` e a derivação do slug pelo diretório nunca funcionou. O defeito vem da
  primeira fatia do runtime e atingia os três. A raiz passa a ser resolvida subindo até o diretório
  com `specs/`, parando na fronteira do projeto para não atravessar para um repositório de cima.

### O que degrada, declarado
- **Existência de arquivo não é progresso, e o comando diz isso.** O vocabulário é `present`,
  `ready` e `blocked` — **sem `done`**, que o documento de origem propunha e que afirmaria
  conclusão de etapa a partir da presença de um arquivo. O aviso vai no payload, com um token
  estável (`basis`) ao lado da frase.
- **`approved` e `checkpoint` não existem no payload.** A aprovação de checkpoint não tem registro
  mecânico; preencher seria inventar e preencher com nulo seria lido como negativa.
- **`.handoff.md` é reportado como fato do arquivo, nunca como trabalho pendente.** Medido: os
  quatro handoffs em disco pertencem a features concluídas, e chamá-los de pendentes seria falso
  em 4 de 4 casos. O comando também não infere obsolescência cruzando com o `06-completion`, o que
  seria julgamento disfarçado de dado.
- **O método continua operável sem a CLI instalada.** O fallback está escrito nas duas skills, e um
  teste próprio quebra se alguém o remover — inclusive conferindo a skill já instalada nos dois
  motores.
- **As regras `PROV-*` continuam fora**, com a medição de adesão zero registrada.

## [0.7.0-beta.6] - 2026-09-10
> O plano passa a responder o que fazer agora. Pré-release no dist-tag `next`.

### Adicionado
- **`mgr spec next`** (ADR-0014): o plano deixa de só descrever e passa a responder **o que fazer
  agora** — a task, o artefato exato que ela exige, a skill auxiliar e o que ela espera. Devolver
  ação em vez de estado tira do agente a inferência que é onde ele erra.
- **Campo `status` na task do plano**, opcional, com vocabulário fechado em `todo` e `done`. É a
  primeira fonte mecânica de conclusão de task: antes disso o progresso vivia em prosa no log de
  execução, e nenhum dos 11 planos em disco marcava conclusão de forma legível.
- **Regra `PLAN-6`**, aviso, para `status` com valor fora do vocabulário.

### O que degrada, declarado
- **Nenhum plano existente é reprovado nem precisa migrar.** O campo é opcional, o parser já
  ignorava chave desconhecida, e nenhum dos planos em disco usa `status` — por isso a extensão é
  aditiva e **não** exige uma versão 2 do marcador de formato.
- **A resposta declara sempre o que sabe.** Num plano sem `status`, ela diz que não sabe o que
  você já fez e que está devolvendo a primeira task que **pode** começar, não necessariamente a
  próxima. Sem isso, `P0.1` para sempre seria lido como aprovação.
- **`status` com valor inválido nunca conta como concluído.** Falha para o lado seguro: no máximo
  reoferece algo já feito, jamais pula algo que falta.
- **"Nada pronto para começar" é, por natureza, um plano defeituoso.** Num plano válido alguma
  task tem `depends_on` vazio e portanto está pronta; esse caminho existe para dependência
  apontando para id inexistente, e a resposta manda rodar o `mgr spec validate`.
- **As etiquetas de proveniência (`PROV-*`) continuam fora.** A adesão a elas foi medida em zero
  ocorrências em 63 arquivos de artefato, e a L1.10 segue declarando-se "not yet enforceable".

## [0.7.0-beta.5] - 2026-08-31
> O método passa a verificar também a **spec** de uma feature. Pré-release no dist-tag `next`.

### Adicionado
- **`mgr spec validate` passa a cobrir a spec, além do plano** (ADR-0013). Cinco regras `SPEC-*`:
  spec declarada sem nenhum critério de aceitação, identidade duplicada, critério vazio e buraco
  na numeração.
- **O critério de aceitação vira unidade verificável, identificado por `CA-<n>`** — a identidade é
  o que uma reprovação cita, e o texto fica no idioma de quem escreve. Sem detecção de seção: o
  título é prosa e varia com o idioma.

### Corrigido
- **Marcador de formato dentro de exemplo deixou de declarar o formato.** Uma spec que documenta
  o próprio formato passava a declará-lo por acidente, e as tasks do exemplo viravam tasks. O
  defeito existia nos dois parsers desde a fatia anterior; a correção é única e vale para ambos.
  O fechamento de bloco cercado segue o CommonMark — mesmo caractere e comprimento maior ou igual —
  então `~~~` não fecha um bloco aberto com crase, e uma cerca interna não fecha a externa.
- **`CA-1` e `CA-01` deixaram de escapar da checagem de duplicidade.** A identidade passa a ser
  comparada pelo número, não pela string: os dois são o mesmo critério para quem lê, e a citação
  numa reprovação ficava ambígua.
- **As fixtures de teste voltaram a ser versionadas.** O padrão `specs/` do `.gitignore` casava em
  qualquer profundidade e engolia `test/fixtures/specs/` — as fixtures que existem justamente para
  o teste não depender da máquina de quem escreve. Ancorado na raiz (`/specs/`, `/docs/sdd/`).
- **O texto de escopo nomeia os dois artefatos.** Ele dizia não julgar o plano, as tasks e o
  critério de done; passa a dizer também que não julga se um critério de aceitação é testável nem
  se os critérios cobrem a spec — que é justamente a leitura errada que um verde convidava.

### O que degrada, declarado
- **Nenhuma spec existente é reprovada.** Sem marcador, **nenhuma** regra roda — só o aviso, nem
  com `--strict`. Diferente do plano, onde as regras de consistência valem sobre o que existir:
  aqui todas dependem da presença do critério, e exigi-lo de quem nunca prometeu seria acusar
  ausência.
- **A verificação é estrutural.** Ela não julga se o critério é testável, se os critérios cobrem a
  spec, nem se o critério é bom — a segunda é o eixo Spec do `code-analyzer`, e fundir os dois
  eixos é proibido.
- **O formato `Requirement`/`Scenario`/`SHALL` foi rejeitado**, com a medição registrada no
  ADR-0013: 10 de 10 specs usam critérios de aceitação, 0 de 10 usam requisito com cenário.

## [0.7.0-beta.4] - 2026-08-31
> O método passa a verificar o **plano** de uma feature. Pré-release no dist-tag `next`.

### Adicionado
- **`mgr spec validate`** (ADR-0012): o método passa a verificar o **plano** de uma feature —
  dependência apontando para task inexistente, ciclo no DAG (inclusive indireto), granularidade
  acima de 3 arquivos, task sem `done_when` ou sem `artifact`, e dependência fora de ordem de
  prioridade. Namespace separado do `mgr validate`, que continua validando `SKILL.md`.
- **Formato de plano declarado por marcador** (`<!-- mgr-plan-format: 1 -->`), com as **chaves dos
  campos em inglês** e os **valores no idioma do usuário**. A identidade parseável nunca depende
  do idioma em que o artefato foi escrito.
- **O campo `artifact` no plano** torna verificável a lei **L4.3**: nome, forma, assinatura e
  QUANTIDADE exatos, que antes viviam só como prosa dentro da task.
- **Todo achado traz remediação e exemplo conforme** — e o construtor **recusa** achado sem eles,
  então "revise a seção" é impossível por construção.

### O que degrada, declarado
- **Nenhum plano existente é reprovado.** Sem o marcador, as regras de **presença** não rodam —
  nem com `--strict`. As de **consistência** rodam sobre os campos que existirem, então um plano
  antigo que já declarava `depends_on` ganha verificação de dependência sem migrar nada.
- **A verificação é estrutural, e a saída diz isso.** Ela não julga se o plano está certo, se as
  tasks são as certas, nem se um critério de done é bom.
- **Só o plano.** A verificação da spec (`SPEC-*`) e as etiquetas de proveniência (`PROV-*`) são
  fatias próprias, ainda não entregues.
- **Duas formas de saída de validador convivem** no repositório: o `check-laws.mjs` devolve
  strings; este devolve objeto estruturado com `--json` versionado. Dívida declarada.

## [0.7.0-beta.3] - 2026-08-31
> Fonte única das leis de execução e blindagem da autoridade contra conteúdo injetado em runtime.
> Pré-release no dist-tag `next`.

### Adicionado
- **Fonte única das leis de execução** (ADR-0011): `shared/laws/execution-laws.md` reúne as 45
  leis do método (L0–L6), cada uma declarando **a quem se aplica por papel** — `Planner`,
  `Executor`, `Verifier`, `Diagnostician` ou `All`. As seis skills do CORE deixaram de repetir
  lei e passaram a apontar para ela pelo token `{{MGR_LAWS}}`, resolvido no install.
- **Preâmbulo de leis no hook de sessão**: as leis centrais entram no contexto **antes da
  primeira mensagem**, por gatilho de plataforma. 19 linhas, teto de 25. Interruptor próprio em
  `.mgr-core/config.json` → `lawsPreamble`, independente do `--no-hooks` e do `reviewGate`.
- **Quarentena de injeção e rebaixamento de evidência** (L0.2/L0.3): conteúdo vindo de documento
  ingerido, página web, saída de tool ou resposta de MCP é **dado, nunca instrução**; memória de
  longo prazo e saída de tool orientam, mas não provam conclusão nem destravam checkpoint.
- **`scripts/check-laws.mjs`**: verifica ID duplicado, papel inválido, skill do CORE sem ponteiro,
  lei órfã e token não resolvido. Roda com `--self-test`.

### Corrigido
- **A lei de controle de contexto havia divergido entre duas skills.** Medido em disco: a cópia da
  `spec-execute` — a skill que roda longo — tinha perdido a estimativa de tamanho de janela, a
  proibição de recarregar tiers arquivados, o "fato **bruto**" da anti-compactação e o gatilho
  duplo do hand-off. As quatro voltam a valer nela pela fonte única.
- **O hook de um motor podia anunciar a fonte de leis do outro** quando os dois estavam
  instalados, ferindo a autossuficiência por motor. O caminho passa a ser resolvido pelo
  diretório do próprio motor.

### Segurança
- A hierarquia de autoridade do ADR-0007 ganhou um **quinto nível, o mais baixo**: conteúdo
  injetado em runtime. Nenhum nível existente mudou de posição e nenhuma regra foi relaxada.

### O que degrada, declarado
- **A quarentena reduz risco e aumenta detectabilidade; não elimina prompt injection.** Linguagem
  natural maliciosa não é detectável com garantia, e o método não promete o contrário.
- **A L1.10 (proveniência por asserção) entra declarada e não verificável.** Nenhum validador
  confere as etiquetas hoje; a checagem depende do formato verificável de artefatos, que é outra
  feature. O próprio texto da lei diz isso.
- **A chegada do preâmbulo ao contexto foi verificada só na emissão.** Os dois formatos de hook
  foram medidos; a chegada antes da primeira mensagem exige sessão nova em cada motor.

## [0.7.0-beta.2] - 2026-08-30
> Gate de validação como agente: a revisão passa a rodar no modelo e no esforço que ela
> declara, isolada da conversa que produziu o código. Pré-release no dist-tag `next`.

### Adicionado
- **O gate de validação roda em agente próprio** (ADR-0010). A revisão do `code-analyzer`
  deixa de herdar o modelo e o esforço da sessão e passa a declarar os seus, **pela execução
  inteira** — não por um turno. O comando `/code-analyzer` e quem o invoca continuam iguais;
  o que muda é o motor por baixo.
- **Agentes viram artefato instalável**, ao lado das skills: `.claude/agents/mgr-review.md` no
  Claude Code e `.github/agents/mgr-review.agent.md` no Copilot, registrados no
  `manifest.json` para o `update` e o `uninstall` saberem o que é deles.
- **`reviewGate` em `.mgr-core/config.json`**: `enabled`, `effort` e `model` — este último um
  **mapa por motor**. Ausente = ligado no default. Override parcial completa o default em vez
  de substituí-lo, e o ajuste sobrevive ao `mgr update`.
- **`mgr status` e o plano do `mgr install` mostram o gate por motor** — modelo, esforço, e o
  que aquele motor não suporta.
- **Descritor de motor (`src/engines/`)**: o que o método sabe sobre cada plataforma vira dado
  consultável em vez de ramificação por nome.

### Corrigido
- **`effort: xhigh` passa a ser aceito** em manifest de plugin. A escala de quatro valores era
  a decisão 6 do ADR-0004, cuja razão (*"`xhigh` não é endereçável via manifest na v1"*)
  expirou quando o método passou a escrever arquivo de agente. A mudança está declarada como
  emenda no ADR-0010; ela **alarga** a validação e não quebra nenhum manifest válido.

### Segurança
- **O agente da revisão não tem ferramenta de escrita.** Um revisor que não pode editar não
  tem como "corrigir" o que deveria reprovar — a garantia vem de um campo de frontmatter, não
  de disciplina de prompt.
- **Prova de posse antes de escrever.** `.claude/agents/` e `.github/agents/` são diretórios
  do usuário: arquivo de mesmo nome sem o marcador do MGR **não** é sobrescrito no install nem
  removido no uninstall — a instalação avisa e segue.

### O que degrada, declarado
- **No Copilot o gate roda no modelo declarado, mas no esforço da sessão**: não existe campo
  equivalente a `effort` em custom agent. A instalação diz isso uma vez, em vez de omitir.
- **O roteamento até o agente tem qualidade diferente por motor**: no Claude Code é estrutural
  (`context: fork`, quem roteia é a plataforma); no Copilot é instrução no corpo da skill.
- **`COPILOT_HOME` não é tratado**: quem redireciona `$HOME/.copilot` por essa variável precisa
  mover o arquivo do agente à mão.

## [0.7.0-beta.1] - 2026-08-26
> Fase 2 da evolução: o MGR passa a **propor** as skills que o projeto justifica, em vez de
> esperar que você saiba os nomes. Pré-release no dist-tag `next`.

### Adicionado
- **Detecção de ecossistema e sugestão de skills** (ADR-0009). O MGR lê uma lista fechada de
  caminhos conhecidos — `pom.xml`, `build.gradle`, `package.json`, `docker-compose.*` e
  `src/main/resources/application.*` — e propõe as skills publicadas que atendem ao que
  encontrou, **mostrando o arquivo que justificou cada sugestão**.
- **`mgr detect`**: mostra o que foi detectado e o que os registries oferecem. Não escreve
  nada. Com `--hook <motor>`, emite o relatório que o hook de sessão consome.
- **Sugestão ao fim do `mgr install`**, em terminal interativo. Aceitar entra no mesmo fluxo
  do `mgr add`: a confirmação que mostra origem, permissões e checksum continua sendo a
  última palavra. Sem terminal interativo, informa e não instala.
- **Hook de início de sessão por motor**, gravado a partir dos motores escolhidos na
  instalação: a próxima sessão do agente já sabe o que está disponível sem você rodar nada.
  Verificado por experimento nos dois CLIs. Fica em arquivo local e gitignored
  (`.claude/settings.local.json`, `.github/copilot/settings.local.json`), nunca global e
  nunca commitado; `--no-hooks` desliga e `mgr uninstall` remove.
- **Campo `ecosystems` no manifest** e no índice do registry: a skill declara a que
  ecossistema serve. Vocabulário aberto — declarar um que o detector ainda não conhece é
  válido e simplesmente não sugere. Sem o campo, a skill só é instalável por nome.
- **Modo de detecção** em `.mgr-core/config.json`: `suggest` (default) e `manual`.

### Segurança
- **O conteúdo dos seus arquivos é evidência, nunca fonte de execução.** Serviços saem de
  marcadores ancorados (`image: postgres`, `jdbc:postgresql:`); não há parser de YAML, e
  nada lido do projeto vira nome de skill, URL ou comando. O casamento acontece só entre
  tokens do CLI e o campo publicado no índice.
- **A detecção não é feita por um agente.** Um agente precisaria ler seus arquivos para
  dentro do contexto, que é exatamente o vetor de prompt injection que a decisão D03 nomeia.
  O gatilho é da plataforma; a leitura é de um detector determinístico.
- **O canal hook → contexto do agente carrega apenas fato apurado** (ecossistema, nome do
  arquivo-evidência, nome e versão da skill). Nenhum byte de conteúdo do projeto atravessa.
- **O modo `auto` não existe ainda** e é recusado com erro explícito. Instalar sem
  confirmação humana depende de `mgr audit`; até lá, `trusted` é apenas uma flag digitada, e
  isso não basta. A garantia de "toda instalação é confirmada por uma pessoa" segue inteira.
- O MGR só toca a **própria entrada** nos arquivos de configuração de agente, identificada
  por marcador; nunca reescreve o arquivo, e reinstalar não duplica.

### Observações
- O hook do Copilot só carrega **depois que você confia na pasta**; a primeira sessão
  pergunta, e nada acontece até aceitar. O `mgr install` avisa.
- Detecção cobre a raiz do repositório (mais o caminho convencional do Spring), não módulos
  em subpastas de monorepo, e identifica o ecossistema, não o framework dentro dele.
- `@mgr/junit-clean` foi republicada como `1.1.0` declarando `java`; `@mgr/diagnosing-bugs`
  segue em `1.0.0`, sem ecossistema — diagnosticar bug não pertence a um.
## [0.6.0-beta.2] - 2026-08-25
> Corrige um defeito destrutivo da `0.6.0-beta.1` e transforma a colisão entre skill do
> método e plugin em decisão do usuário (ADR-0008). Pré-release no dist-tag `next`.

### Corrigido
- **Instalar um plugin já não apaga a skill do método de mesmo nome.** Na `0.6.0-beta.1`,
  `mgr add @mgr/diagnosing-bugs` (ou `@mgr/junit-clean`) escrevia por cima da skill do
  método, que sumia sem aviso e sem registro, e o `mgr remove` seguinte apagava a pasta.
  Atingia toda instalação, porque `diagnosing-bugs` é skill de núcleo.
- **`mgr remove` só apaga pasta comprovadamente sua** — exige o `mgr-manifest.json`
  correspondente. Pasta de outra skill é preservada e o motivo é avisado.
- **`mgr status` não afirma mais que nada está instalado** quando há plugin travado no
  lockfile sem instalação do método no projeto (saída autocontraditória, com exit 1 indevido).

### Adicionado
- **Colisão com skill do método virou escolha registrada** (ADR-0008): `mgr add` pergunta
  entre instalar ao lado (default, em `<skill>--<registry>`) e substituir a skill do método,
  e grava a resposta no lockfile (campo `replaces`). A decisão viaja no Git e é aplicada sem
  nova pergunta em `mgr install` — inclusive em clone limpo.
- `mgr install`/`mgr update` **pulam** a skill substituída ao instalar o método: a pasta é
  escrita uma vez, com o que foi escolhido, em vez de escrita e sobrescrita. Com o registry
  fora do ar, a falha é explícita e a pasta fica vazia, em vez de conter silenciosamente uma
  versão que ninguém escolheu.
- `.mgr-core/manifest.json` ganha `replaced` e mantém `skills` completo, então deixa de
  afirmar que instalou uma skill que um plugin ocupou — e a skill volta ao remover o plugin.
- **`mgr status` relata divergências entre o lockfile e o disco** (travado mas ausente ou
  diferente), com a sugestão de restaurar. Reporta; nunca corrige em silêncio.

### Segurança
- Pasta ocupada por algo que não é nem o plugin nem uma skill do método continua sendo
  recusada: o instalador nunca escreve sobre conteúdo que não consegue explicar.
## [0.6.0-beta.1] - 2026-08-25
> Pré-release da **Fase 1 da evolução do MGR** (fundação de skills plugáveis), publicada no
> dist-tag `next`. `npm i mgr-method` continua trazendo a 0.5.0 estável.

### Adicionado
- **Skills plugáveis instaláveis por `mgr add`** (ADR-0004 a ADR-0007). Um plugin é uma pasta
  de skill 100% padrão [Agent Skills](https://agentskills.io/specification) com um
  `mgr-manifest.json` na raiz: o frontmatter segue sendo o contrato com as plataformas, o
  manifest é o contrato com o MGR (procedência, categoria, permissões, model/effort).
- **Comandos novos:** `mgr add <@registry/skill>`, `mgr remove <@registry/skill>` e
  `mgr registry add|remove|list`. `mgr list`, `mgr status`, `mgr install` e `mgr update`
  ganham seções e etapas de plugin **apenas quando existem** lockfile ou registry configurado —
  quem não usa plugins tem a saída de antes, travada por teste de regressão contra a baseline
  real da `main`.
- **Registry oficial** [`mgr-registry`](https://github.com/maurigre/mgr-registry): repo Git com
  `index.json` gerado dos manifests (nunca editado à mão) e CI que reprova manifest inválido,
  índice fora de sincronia ou URL publicada que não bate com o checksum anunciado. Estreia com
  `@mgr/junit-clean` e `@mgr/diagnosing-bugs` — as duas seguem no núcleo do pacote.
- **Lockfile `mgr-skills.lock`** na raiz do projeto, versionado: `git clone` + `mgr install`
  reproduz o conjunto exato de skills do time, com integridade verificada. O bloco `applied`
  registra o que cada motor efetivamente traduziu ou degradou.
- **Tradução por motor com degradação explícita:** no Claude Code, `model` e `effort` do
  manifest entram no frontmatter da skill instalada; no Copilot, que não tem onde recebê-los,
  a instalação **não falha** — emite aviso e registra a degradação no lockfile.
- Documentação do formato em [`docs/plugins.md`](docs/plugins.md), com a matriz de suporte por
  plataforma datada e os limites conhecidos desta versão.

### Segurança
- **Toda instalação de plugin exige confirmação humana**, mostrando origem, versão, permissões
  declaradas e checksum antes de escrever qualquer byte. **Não existe flag de bypass**; sem
  terminal interativo o comando falha com mensagem explícita.
- **Integridade obrigatória:** sha256 por arquivo mais checksum agregado do conjunto, validados
  em memória — divergência aborta sem escrever nada. O `restore` resolve no registry travado no
  lockfile, não no configurado na máquina, e recusa versão ou checksum diferentes do travado.
- Caminho de arquivo vindo do registry e pasta de instalação vinda do lockfile são validados
  contra travessia de diretório.
- Vulnerabilidades `high` de dependências transitivas de desenvolvimento corrigidas
  (`brace-expansion`, `fast-uri`, `js-yaml`).

### Corrigido
- `mgr status` não afirma mais que nada está instalado quando há plugin travado no lockfile
  sem instalação do método no projeto (saída autocontraditória, com exit code 1 indevido).

## [0.5.0] - 2026-07-17
### Alterado
- **Inglês é o idioma canônico do conteúdo distribuído** (ADR-0003): as 12 skills, os
  templates, as fontes compartilhadas, o `sdd-check.sh` e o README foram traduzidos pt→en sob
  protocolo de integridade (verificador estrutural + inventário load-bearing conferido por
  arquivo — nada perdido na tradução). Reverte a convenção "skills em pt-BR".
- Fontes co-localizadas renomeadas: `_shared/arch/cross-cutting-rules.md` e
  `_shared/quality/quality-rules.md`; template de revisões do `evidence-capture` vira
  `reviews.md` (a skill honra o nome exigido pelo enunciado do desafio, ex.: `revisoes.md`).
  Os nomes pt legados são removidos automaticamente no `install`/`update`.
- `description` do pacote em inglês (vitrine npm), mantendo a marca.
### Adicionado
- **Idioma de saída configurável (`userLanguage`)**: o `mgr install` pergunta em que idioma as
  skills conversam e geram artefatos (default sugerido do locale; flag `--user-language`);
  gravado no manifesto e resolvido em toda `SKILL.md` via token `{{MGR_USER_LANGUAGE}}` na
  linha `Output language:`. Regra normativa QUAL-7 na fonte única de qualidade. Instalação
  existente que rodar `update` herda `pt-BR` silenciosamente — experiência preservada.
- **CLI bilíngue** (`src/messages.js`): todas as mensagens da borda em en (default) e pt-BR,
  selecionadas por flag > manifesto > locale — TUI, plano, status, help, banner (tagline e
  créditos; a marca não se traduz) e erros da borda. `README.pt-BR.md` com links cruzados.
- Ferramenta de dev `scripts/check-translation.mjs` (fora do tarball): compara traduções com o
  original no git — headings, IDs de regra, blocos de código, listas, tabelas e frontmatter.

## [0.4.0] - 2026-07-15
### Adicionado
- **Skill `diagnosing-bugs`** no núcleo (sempre instalada) — disciplina de diagnóstico de bug
  difícil: exige um loop de reprodução **vermelho** antes de qualquer hipótese (*sinal antes de
  teoria*), 3–5 hipóteses falsificáveis e teste de regressão antes do fix. Acha a causa e para
  (entrega o conserto ao `spec-create`). Adaptada de `diagnosing-bugs` de Matt Pocock (MIT).
- **`code-analyzer` agora revisa dois eixos** — além de *Standards* (o código segue
  `docs/sdd/09-review-rules.md`?), o novo eixo *Spec* verifica se o código **cumpriu a spec de
  origem**. Reprova requisito ausente/parcial citando a linha da spec; scope creep vira reporte
  não-bloqueante; sem spec, abstém-se. Modelo de dois eixos adaptado de `code-review` de Matt
  Pocock (MIT); o *smell baseline* dele foi rejeitado por violar a política de "nunca inventar
  regra".
- **Gates de qualidade que quebram o build** (ADR-0002). Antes, o projeto não tinha linter algum,
  a cobertura era medida mas não bloqueava nada, a convenção de commit era só disciplina humana e
  CVEs não eram verificadas.
  - **ESLint** (flat config): `npm run lint`, com gate no CI. Além do estilo, enforça dois
    invariantes de arquitetura — `src/` nunca importa `bin/` (INV-2) e `bin/mgr.cjs` preso ao
    **ES5** (é ele que dá a mensagem legível em Node < 22).
  - **Gate de cobertura**: `--test-coverage-lines=95` (flag nativa do Node, sem dependência).
    Linhas ≥ 95%; branches fora do gate.
  - **Commitlint** (Conventional Commits **sem scope**, corpo ≤ 100 col, sem atribuição de autoria
    a IA), via hook `commit-msg` em `.githooks/` + `core.hooksPath` — **sem husky** — e no CI.
  - **Auditoria de dependências**: `npm audit --audit-level=high` no CI.
- Nenhuma dependência de **runtime** adicionada; o pacote publicado não muda.

## [0.3.8] - 2026-07-14
### Alterado
- Refactor (Humble Object): a coleta de prompts do `install` saiu do `bin/mgr.js` para
  `src/prompts.js`, recebendo o adaptador de prompts **injetado** (clack no CLI, stub nos
  testes). Comportamento inalterado.
### Adicionado
- Testes: smoke dos comandos do CLI (`status`/`update`/`uninstall`/`build`/`validate`/`list`/
  `version`/`help`, dry-run e caminhos de erro) e da coleta de prompts **sem TTY**.
  Cobertura de linhas: 81,44% → **96,95%** (todo o `src/` a 100%).

## [0.3.7] - 2026-07-08
### Corrigido
- A fonte `shared/quality/regras-qualidade.md` agora é instalada (`_shared/quality/`) e o
  `spec-init` referencia `_shared/arch`/`_shared/quality` (co-localizadas), em vez do caminho
  antigo `.mgr-core/shared/...` (inexistente no modelo autossuficiente) — corrige a montagem da
  seção de qualidade do guia introduzida no 0.3.6.

## [0.3.6] - 2026-07-08
### Adicionado
- `spec-execute`: **gate de fidelidade ao plano** (reafirma o artefato exato antes de cada task;
  proíbe alterar forma/quantidade/nome por conta própria) + **auto-review por task** +
  disciplina de trilho (buscar fonte sólida ou perguntar) e economia de tokens.
- Fonte única `shared/quality/regras-qualidade.md`: regras de qualidade por linguagem em duas
  camadas — idiomas/design (Java validado com *Effective Java*/Bloch; ex.: `Optional` nunca como
  parâmetro) e estilo/lint (Google Checkstyle); demais linguagens `[ADAPTADO]`. Aplicadas pelo
  `spec-execute` ao codificar e citadas pelo `code-analyzer`.
### Alterado
- `spec-init` passa a gravar a seção **Qualidade de código** no `09-review-rules.md`.

## [0.3.5] - 2026-07-08
### Adicionado
- Convenção Hexagonal (perfil Java, opt-in): DTOs (`...Request`/`...Response`) e mappers da web
  moram sob a versão do controller (`controller.v1.dto`/`mapper`), isolando o contrato por versão
  da API — com regras ArchUnit. Dispensável em APIs sem versionamento.

## [0.3.4] - 2026-07-08
### Adicionado
- Refino da convenção Hexagonal (perfil Java): `Command`/`Query` co-locados com o input port;
  `config` como composition root (regra ArchUnit dedicada); relação entre domínios (Shared
  Kernel, referência por ID, ACL por port — DDD, Evans/Vernon); estrutura de adapters
  web/rabbit/persistence/client com sufixos `Controller`/`Receiver`/`RepositoryAdapter`/`ApiAdapter`.
### Alterado
- Organização de pacotes documentada como escolha neutra (por feature × por camada, via ADR);
  Screaming Architecture creditada a Robert C. Martin (prática transversal), não ao Cockburn.
- Regras ArchUnit passam a usar `..core..X..` (servem organização por camada e por feature).

## [0.3.3] - 2026-07-08
### Adicionado
- Governança do enforcement de arquitetura (guard-rail; nunca enfraquecer regra; drift corrige
  o código; mudança de regra via `adr-create`) nas Boas Práticas transversais.
- Perfil Hexagonal + Java (validado): convenção de nomes/pacotes (`core.*`,
  `...UseCasePort`/`...UseCase`/`...Adapter`) e ruleset ArchUnit de referência.
- Nota de Enforcement em `arch-clean`/`arch-onion`/`arch-layered` (traduzir os `INV` para a
  ferramenta de arch-lint do perfil da linguagem).

## [0.3.2] - 2026-07-07
### Adicionado
- Guard de versão do Node no CLI: em Node < 22, mensagem clara em vez de crash minificado
  (launcher CJS `bin/mgr.cjs`).
### Corrigido
- README: a tabela de skills não descreve mais `arch-clean`/`arch-onion`/`arch-layered` como
  stubs (já são canônicas).

## [0.3.1] - 2026-07-07
### Corrigido
- `install` não quebra mais ("find is not a function") quando há instalação anterior detectada.

## [0.3.0] - 2026-07-07
### Alterado
- Instalação **seletiva**: pergunta linguagem e arquitetura e copia só as skills usadas.
- Modelo **autossuficiente por motor**: skills direto na pasta do motor, sem `.mgr-core/skills`
  nem lançadores.
- `.mgr-core/` passa a ser **config do projeto** (`manifest.json` + `.env` com `MGR_PROJECT_ID`
  para o mgr-code).
### Adicionado
- Migração automática de instalações no modelo antigo (runtime-launcher) no `install`/`update`.
- Flags `--language`, `--arch`, `--project-id`, `--all-skills`.

## [0.2.0] - 2026-07-07
### Adicionado
- Guias de arquitetura **canônicos e completos**: `arch-clean` (Martin), `arch-onion`
  (Palermo), `arch-layered` (Fowler) — deixam de ser stubs.
- Fonte transversal única (`shared/arch/regras-transversais.md`) com perfis de linguagem
  (Java/Go/Python/C#/TS + genérico).
- Cobertura de testes e badges no README (CI, coverage, npm, node, license).
### Alterado
- `arch-hexagonal` reestruturada em template agnóstico (invariantes + design + testes/logs +
  perfil da linguagem).
- `engines`: Node >= 22 (alinhado ao LTS testado no CI).

## [0.1.3] - 2026-07-06
### Corrigido
- Ajustes no fluxo de publicação no npm (sem mudança funcional).

## [0.1.2] - 2026-07-06
### Corrigido
- Ajustes no fluxo de publicação no npm (sem mudança funcional).

## [0.1.1] - 2026-07-05
### Adicionado
- Primeira publicação no npm.

## [0.1.0] - 2026-07-03
### Adicionado
- Skill `evidence-capture`: registra evidências AI-First por funcionalidade
  (specs/<feature>/ai/ + índice global ai/index.md); organiza e pergunta, nunca inventa
  o julgamento crítico. Inclui o prompt de criação da própria skill.
- Skill `spec-execute`: fase de execução separada do `spec-create` (SRP), com as
  premissas de desenvolvimento explícitas e retomada direta de execução interrompida.
- TUI do instalador (@clack/prompts): banner ASCII com créditos,
  multiselect de motores (instala em vários de uma vez), select de escopo, spinner.
- Fluxo SDD completo como Agent Skills: `spec-init` (análise brownfield com chunking +
  entrevista greenfield), `spec-create` (brief→PRD→spec→plano P0/P1/P2+DAG→execução→
  completion, 6 checkpoints, tiers de contexto S–F com hand-off e anti-compactação),
  `adr-create` (Nygard, auto-detecção, modo invocado), `code-analyzer` (Restrição
  Crítica sobre o guia do projeto), `junit-clean` (13 regras).
- Provedoras de arquitetura plugáveis: `arch-hexagonal` (guia Java completo) +
  `arch-clean`/`arch-onion`/`arch-layered` (stubs honestos).
- CLI `mgr` em Node (zero dependências): install · status · update · uninstall ·
  build · validate · list · version; duas fases + `--dry-run`; manifesto em
  `.mgr-core/manifest.json`; lançadores por motor (claude-code, copilot, both).
- Integração mgr-code em todas as skills (sondar, usar se disponível, alertar se não).
