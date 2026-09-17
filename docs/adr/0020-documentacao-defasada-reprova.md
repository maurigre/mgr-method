# ADR-0020: Documentação defasada reprova

> Renomeado em 2026-09-17, antes de qualquer código: o título original terminava em "e o guia avisa
> antes de sobrescrever", sobre uma premissa falsa. Ver a emenda na *Decision*.

Date: 2026-09-17
Deciders: Mauri Reis

## Status

Accepted

> Promovido em 2026-09-17, depois de o gate de review isolado rodar **três vezes** sobre a fatia e as
> duas condições do `done_when` serem satisfeitas: as regras são citáveis como escritas, e nenhum
> artefato existente reprova sem defeito real — 13 dos 14 completions em disco passam, e o 14º reprova
> por não declarar o diff, que é o defeito que esta decisão existe para pegar.
>
> A promoção vem com **uma lacuna registrada como limite conhecido**, na *Negative*: a frase de
> abertura da DOC-2 promete mais do que a enumeração dela reprova. Está declarada, e não fechada.

## Context

A Fase 6 do `spec-create` manda atualizar a documentação do projeto a cada feature — o texto é
literal: *"INCREMENTAL update of `/docs/sdd/` (diff)"*. **E nada verifica.** Apurado por varredura em
2026-09-17: nem `mgr validate`, nem `mgr spec validate`, nem `check:laws` olham documentação; e o
gate de review (`code-analyzer`) **não pode** reprovar por ela, porque não existe regra textual sobre
documentação em `shared/arch/cross-cutting-rules.md` nem nos guias que dela derivam — e a §3.1 da
CONSTITUTION proíbe reprovação sem citação.

A consequência apareceu medida, na Fase 6 da fatia anterior: a documentação deste repositório estava
defasada **desde antes dela**. O documento de arquitetura citava **12 de 33** módulos do núcleo; o de
contrato não tinha **5 de 15** comandos da CLI; os dois READMEs citavam 10 comandos e 9 módulos, e
omitiam um diretório inteiro. Nada disso foi pego por mecanismo — foi pego por alguém olhar.

O autor fixou o alcance, e é ele que faz disto decisão de produto: *"Isso não pode repetir nem neste
projeto como nos projetos que iram utilizar o mgr-method"*. A fonte única de regras transversais é
consumida por **6 skills** e **3 módulos** do núcleo, e é dela que o `spec-init` monta o guia de cada
projeto instalado. Sem regra ali, **nenhum projeto que usa o método pode reprovar documentação
defasada**.

Duas medições calibraram o desenho, e as duas contrariaram a recomendação inicial de quem escreveu
esta spec:

- **A adesão à declaração de diff é de 13 em 14** — corrigido em 2026-09-17, na P0.1: a primeira
  medição dizia "14 de 14" e vinha de um grep por **menção** a documentação, não pela condição que a
  regra usa. O que falta é `specs/mgr-spec-requirements/06-completion.md`, e **a regra pegou um caso
  real de passo esquecido num artefato já fechado e mergeado** — antes de existir. Isso importa
  porque existe precedente em sentido oposto: o ADR-0016 **rejeitou** cobrar a presença de etiqueta de
  proveniência, com a razão registrada em `src/prov-rules.js`: *"a adesão medida é zero e o custo
  cairia sobre cada linha normativa escrita para sempre"*. **A diferença é de grau, e ela é grande:**
  lá a adesão era zero e a regra imporia prática nova a cada linha escrita para sempre; aqui a prática
  já existe, e o único que reprova reprova **por defeito real**.
- **Mas há sete nomes de seção diferentes** entre os 14. Uma regra que exigisse título exato
  reprovaria dez deles.

Junto com isso, uma divergência aberta: o guia deste projeto diz LOG-1 *"alterar estado em disco"* e
LOG-2 *"rede/subprocesso"*, enquanto a fonte diz *"database or messaging system"* e *"external HTTP
API"*. O cabeçalho do guia declara ter saído de um arquivo que o **ADR-0003 renomeou** e que não
existe mais. A redação local é **mais estrita**, e foi ela que exigiu o par de logs em volta da
escrita do hand-off e do subprocesso do git nas duas últimas fatias.

**Reference:** Technical spec at `specs/documentacao-nao-fica-defasada/03-spec.md`.

## Decision

**Documentação defasada passa a reprovar, por dois mecanismos que pegam falhas diferentes.**

**1. Duas regras textuais na fonte única**, em seção própria `Documentation standards`, ao lado de
Design, Test, Log e Mutation: a **DOC-1** exige que capacidade nova apareça na documentação **onde ela
pertence** — módulo ou camada na arquitetura; comando, endpoint, evento ou chave de configuração no
contrato; e **no README tudo o que o usuário vê**; a **DOC-2** reprova documento que nomeia módulo, comando, caminho ou campo que não existe
mais, e documento cuja fonte declarada não existe. As duas são agnósticas a stack: falam de conceitos
que qualquer projeto tem, sem nomear diretório.

A DOC-1 nasceu com a ressalva *"no README quando o README descreve aquela superfície"* e **o autor a
retirou**: ressalva verificável é também escapatória, e o pedido dele foi explícito sobre o README.
Quem tiver README deliberadamente mínimo edita o guia do próprio projeto, que é a alçada que o método
sempre deu.

> **Segunda emenda, de 2026-09-17, e ela veio de aplicar a regra à própria fatia que a escreveu.** A
> redação seguinte exigia toda capacidade nos **três** documentos, e isso cobra o impossível: um
> módulo interno não tem contrato externo, e um README que liste os 35 módulos do núcleo é um README
> que ninguém lê. Ao satisfazer a regra nesta fatia, ela foi cumprida **pelo espírito** e não pela
> letra — o que é sinal de redação errada, não de execução relaxada.
>
> A regra passou a dizer **"onde ela pertence"**, com os três destinos nomeados por tipo. A metade do
> README continua **sem ressalva para superfície de usuário**, que é o que o autor pediu e é onde a
> omissão de fato custa.

**2. Um gate mecânico no validador de artefato**, sobre o `06-completion.md`, com severidade de
**erro** — aplicável porque a adesão medida é total. Ele reconhece a seção de diff **por conteúdo** e
não por título, dados os sete nomes em uso, e verifica que ela **existe** e **nomeia ao menos um
arquivo que existe em disco**.

**O gate verifica declaração, não correção**, e isso é limite declarado: nenhum mecanismo agnóstico
sabe se o conteúdo da documentação está certo. É a razão de os dois mecanismos existirem juntos — o
gate pega o passo esquecido, a regra citável pega o conteúdo errado.

**A redação estrita das regras de log sobe para a fonte**, em vez de este projeto adotar a mais fraca:
LOG-1 passa a dizer *"changing persisted state — a database, a messaging system or a file on disk"* e
LOG-2 *"calling an external HTTP API or spawning a subprocess"*. Nenhum projeto perde cobertura; a
redação estrita já provou pegar defeito real.

**A ressincronização do guia deste projeto é cirúrgica e datada**, e não regeneração: o guia local tem
o que a fonte não tem — as camadas concretas, o perfil de linguagem, as ferramentas —, e regenerar
sobrescreveria as adaptações que o `spec-init` fez.

**Acrescentar regra à fonte conta como mudança que exige migração anunciada** (§2.7), porque muda **o
que reprova** para quem regenerar o guia do projeto: regra nova sem aviso faz o gate reprovar código
que passava ontem. **O anúncio vive no CHANGELOG.**

> **Emenda de 2026-09-17, antes de qualquer código.** A primeira redação desta decisão dizia também
> que *"o `update` passa a avisar e pedir confirmação antes de sobrescrever um guia modificado à
> mão"*, e chamava isso de "a única parte desta decisão que pode destruir trabalho de alguém".
>
> **A premissa era falsa, e foi verificada por varredura depois de o autor questionar a frase:**
> nenhuma linha de `src/*.js` ou `bin/mgr.js` menciona `09-review-rules`. O `mgr update` regenera as
> **skills** a partir do manifesto e **não toca o guia do projeto**. Quem o gera é a skill
> `spec-init`, e ela já declara, na própria instrução, comportamento *"Incremental"* e *"Idempotent"*.
>
> A task que implementaria a confirmação **foi removida do plano**, e nada por ela foi escrito. O
> risco residual — quem invoca o `spec-init` num projeto com guia editado à mão depende de a skill
> cumprir o incremental que declara — é **comportamento de agente, não de código**, e fica nomeado
> para outra fatia.

## Alternatives Considered

- **Só reforçar a prosa da Fase 6:** é exatamente o que existe hoje, e foi o que falhou. O brief da
  fatia anterior já tinha nomeado o padrão: *"Lei sem gatilho é conselho."*
- **Só a regra citável, sem gate mecânico:** pegaria documentação errada e deixaria passar o passo
  esquecido — que foi justamente o modo de falha desta rodada.
- **Só o gate mecânico, sem regra citável:** o gate verifica declaração; uma declaração honesta
  apontando documentação errada passaria, e o `code-analyzer` continuaria sem ter o que citar.
- **Exigir um título exato de seção no completion:** reprovaria dez dos quatorze artefatos existentes,
  por convenção de nome e não por defeito.
- **Verificar automaticamente se o conteúdo da documentação está correto:** nenhum mecanismo agnóstico
  faz isso sem julgamento arbitrário, e regra que depende de gosto é o que o método proíbe.
- **Este projeto adotar a redação da fonte para as regras de log:** faria o projeto **perder**
  cobertura provada — escrita local de arquivo e subprocesso local deixariam de cair sob a regra.
- **Regenerar o guia deste projeto pelo `spec-init`:** mais fiel à fonte, e sobrescreveria as
  adaptações por projeto que o próprio `spec-init` fez.
- **Sobrescrever guia modificado com backup ao lado, ou pedir confirmação no `update`:** as duas
  alternativas foram consideradas e **as duas perderam o objeto** — o `update` não sobrescreve o guia,
  conforme verificado por varredura. Ficam registradas porque a decisão chegou a ser tomada sobre a
  premissa falsa, e o registro do erro vale mais que a sua omissão.

## Consequences

### Positive

- Documentação defasada deixa de depender de alguém notar.
- O alcance é o produto: todo projeto que instalar ou atualizar recebe as regras, sem precisar saber
  que elas existem.
- O `code-analyzer` ganha **o que citar** — hoje ele vê documentação defasada e não pode reprovar.
- Cobrar a seção de diff formaliza prática com adesão de **13 em 14**, em vez de impor prática nova —
  e o único que reprova reprova por defeito real, não por convenção.
- As regras de log ficam mais amplas para todos, com a redação que já pegou defeito real aqui.
- O cabeçalho do guia deste projeto para de apontar um arquivo que não existe.

### Negative

- **Código que passava pode reprovar** depois de um `update`, pelas LOG ampliadas e pelas DOC novas.
  É o preço de regra que alcança mais, e é por isso que a migração é anunciada.
- **Nada muda no `update`,** e isso é consequência de uma correção: a decisão original o mudava, sobre
  premissa falsa.
- Projeto com README deliberadamente mínimo passa a reprovar por não nomear capacidade nova, e o
  caminho para ele é editar o guia do próprio projeto.
- O gate mecânico pode ser satisfeito por uma declaração honesta que aponte documentação errada — a
  regra citável é que cobre isso, e só por julgamento com citação.
- **A DOC-2 promete mais do que reprova, e isto é limite conhecido, não defeito a corrigir depois.**
  O texto é *"A documentação não contradiz o código: documento que nomeia módulo, comando, caminho ou
  campo que não existe mais reprova, e documento cuja fonte declarada não existe também."* A frase
  antes dos dois-pontos enuncia o principio; **só as duas cláusulas depois dele carregam o verbo**, e
  portanto só elas são citáveis contra um artefato. O caso concreto que cai no vão apareceu nesta
  própria fatia: *"33 módulos"* onde são **35** é contradição com o código que nenhuma das duas
  cláusulas alcança — o documento não nomeia nada inexistente, ele **conta errado**.

  O review isolado ofereceu duas saídas: tornar a enumeração explicitamente ilustrativa, ou
  acrescentar uma terceira cláusula para afirmação verificável que contradiga o código. **Nenhuma foi
  tomada**, deliberadamente: alargar o texto de uma regra depois de ele ter sido declarado citável
  muda o contrato do produto para todo projeto que já instalou o método, e essa é decisão de fatia
  própria — com medição de quantos artefatos em disco a cláusula nova alcançaria, que é o que faltou
  para decidir agora. Até então, contagem falsa é pega por leitura humana, não pela regra.

### Risks and Mitigations

- **Risco:** afirmar comportamento de código sem verificar, e decidir sobre a afirmação.
  **MATERIALIZOU-SE nesta própria decisão**, e foi pego pelo autor questionando uma frase — não por
  conferência antes. **Mitigação:** a varredura passou a ser feita antes de escrever decisão ou task
  que exista para proteger contra um comportamento; e o erro fica registrado aqui em vez de
  desaparecer na reescrita.
- **Risco:** a DOC-1 virar motivo para alguém desligar a regra em vez de documentar. **Mitigação:** a
  alçada de editar o guia do próprio projeto é explícita e registrada, em vez de a regra ser
  contornada em silêncio.
- **Risco:** a premissa da adesão total estar errada, e "erro sempre" reprovar artefato existente.
  **MATERIALIZOU-SE, e foi pego na P0.1, antes de existir código:** era 13 de 14. **Mitigação
  efetiva:** o critério passou a afirmar que **13 dos 14** passam sem alteração e que o 14º reprova
  **por defeito real**, nomeado na linha de base — e nenhum artefato foi editado para o gate passar.
- **Risco:** esta decisão nascer de leitura errada do próprio método, que é o modo de falha recorrente
  nesta linha de trabalho. **Mitigação:** ela nasce `Proposed`, e só vira `Accepted` depois de o gate
  de review confirmar que as regras novas são citáveis como escritas e que nenhum artefato existente
  passou a reprovar **sem defeito real**.

> **A ressalva "sem defeito real" foi acrescentada em 2026-09-17, apontada pelo gate de fechamento.**
> Sem ela a condição era **insatisfazível**: um artefato existente **passou** a reprovar — o
> `mgr-spec-requirements`, por defeito dele —, então o gate nunca poderia confirmar a redação literal.
> A invariante 3 da spec já carregava a redação certa; o ADR e o plano tinham a versão truncada.
