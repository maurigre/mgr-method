# ADR-0019: Referência ao transcript do motor em vez de cópia do contexto

Date: 2026-09-13
Deciders: Mauri Reis

## Status

Proposed

## Context

O ADR-0018 deu gatilho mecânico às leis `L3.2` e `L3.4`: quando o motor anuncia a compactação, o
método grava um hand-off antes e avisa o usuário. Mas aquele hand-off carrega o **esqueleto** do
trabalho — feature, próxima task, artefatos, arquivos modificados — e declara no próprio texto que
**não vê a conversa**. O *porquê* das decisões só existe quando um agente escreve o hand-off, e nada
no método obriga isso a acontecer enquanto ele ainda tem contexto.

O autor observou a consequência disso entre sessões: mesmo com hand-off em disco, a sessão seguinte
perde a essência do que estava sendo feito e o propósito da funcionalidade em construção.

A primeira intenção foi **copiar o transcript da conversa** antes da compactação. **A medição de
2026-09-13 derrubou essa premissa:**

- o transcript **persiste**: o mais antigo deste projeto é de 30/08 — 14 dias antes — e continua em
  disco com 7,1 MB;
- o transcript **sobrevive à compactação**: depois do registro `type: system, subtype:
  compact_boundary`, as três sessões que compactaram gravaram mais **2.451**, **368** e **228**
  registros no **mesmo** arquivo. Ele não é truncado;
- portanto o que a compactação destrói é o **contexto de trabalho do agente**, não o conteúdo em
  disco. O conteúdo que se queria preservar **já está preservado pelo motor**; o que falta é alguém
  ler depois, e saber onde a fronteira ficou.

Somaram-se duas restrições. A primeira, do autor, em 2026-09-13: *"Não deve ter vários arquivos de
contexto gravados em disco e isso deve ser tratado."* A segunda, apurada em disco: o `mgr-code` **não
tem porta que um hook possa chamar** — o MCP é `stdio` lançado pelo motor, os três entry points
(`mgr-mcp`, `mgr-consolidate`, `mgr-load-skills`) não incluem ingestão, e as três portas dele (15432,
17687, 6379) estavam fora no momento da medição.

Medido também, e relevante para o desenho: o transcript é JSONL de 2,5 a 10,3 MB por sessão, 41,8 MB
em 27 arquivos neste projeto; cerca de 21% dele é contabilidade do harness e não conversa; o campo
`toolUseResult`, que carrega saída de ferramenta, é 11,6% do arquivo e é identificável por campo; os
transcripts de subagente são 22 arquivos separados somando 12,7 MB; e a compactação aconteceu uma vez
em três de cinco sessões, justamente as acima de 6,5 MB.

**Reference:** Technical spec at `specs/dump-de-contexto-antes-da-compactacao/03-spec.md`.

## Decision

O gatilho de pré-compactação **registra uma referência, e nunca copia**.

Grava **um único manifesto por projeto**, em `~/.mgr-core/context/<projectId>.json`, com: o
`projectId` e a versão do contrato no corpo, e por entrada o id de sessão, motor, gatilho, instante,
o caminho do transcript, seus bytes e número de registros, o `sha256` dele no instante, os
**boundaries anteriores** daquela sessão e os caminhos do que mais pertence a ela. Retém as 20
entradas mais recentes não consumidas e poda as consumidas.

> **Emenda de 2026-09-17, vinda da medição que precedeu o código.** A primeira redação desta decisão
> dizia "a linha do `compact_boundary` **quando o registro já existir**". Isso era inviável, e a
> medição mostrou por quê: o registro carrega `postTokens` e `durationMs` — as três compactações
> medidas duraram **105, 107 e 118 segundos** —, e nenhum dos dois pode ser conhecido antes de ela
> terminar. Logo o motor o escreve **depois**, e o hook dispara **antes**: o boundary da compactação
> em curso nunca existe quando o hook roda.
>
> O campo passou a ser `previousBoundaries`, **lista** dos boundaries **anteriores** com o `trigger`
> de cada um. Ela diz ao dreno quantas vezes aquela sessão já foi compactada e onde — em vez de uma
> fronteira que ainda não aconteceu. **Lista vazia na primeira compactação**, e esse é o caso comum.
>
> **O que mais pertence à sessão também cresceu:** além dos transcripts de subagente, entra a saída
> de ferramenta derramada para disco (`tool-results/`), que o transcript referencia e cujo conteúdo
> vive fora dele. Sem ela o dreno encontraria referências que não resolve.

O gatilho **não abre conexão nem sonda o `mgr-code`**: escreve sempre, e quem consolida é outro
processo, depois. O aviso ao usuário **estende** o canal que o ADR-0018 já entrega
(`compaction.notice` no descritor), dizendo o que foi referenciado, quantos registros e bytes, que a
consolidação é posterior, e que o método **aponta** para o contexto em vez de guardá-lo.

O escopo é o **global**, e não o do projeto, porque o manifesto carrega caminhos absolutos e ids de
sessão da máquina, e o `README.pt-BR.md` instrui a versionar o `.mgr-core/` do projeto.

Os transcripts de **subagente entram na referência**, por decisão do autor: quatro agentes de review
rodaram na sessão que produziu esta decisão, e o raciocínio deles produziu metade das decisões da
fatia anterior.

**O dreno para o `mgr-code` não entra nesta decisão.** Ler e ingerir o transcript é outra fatia, em
outro repositório e outra linguagem.

**Duas coisas que a versão anterior desta decisão exigia, e que deixaram de ser necessárias** — e
isto é ganho, não detalhe:

1. **Nenhum override de constituição.** Gravar conversa em `.mgr-core/` violaria a §2.6 (*"é config,
   não conteúdo"*) e exigiria override declarado. Um manifesto de referências é **estado**, da mesma
   natureza do `precompact.json` que o ADR-0018 já grava ali. Nenhum byte de conversa entra no
   diretório, então a regra não é violada e não há dívida permanente no entendimento de quem ler a
   constituição depois.
2. **A fronteira do ADR-0009 não é atravessada.** A decisão 7 daquele ADR fixou que o canal do
   gatilho transporta *"apenas fato apurado pelo MGR (...) nunca trecho de arquivo do projeto"*, com
   teste em `test/detector.test.js:188`. Id de sessão, caminho, tamanho, checksum e número de linha
   **são** fato apurado. A fronteira continua existindo e **mudou de dono**: quem ler o transcript e
   ingerir conteúdo numa base que depois alimenta recuperação é que a atravessa — e essa obrigação é
   registrada aqui como **herdada pelo dreno**, em vez de ficar implícita para quem pegar depois.

## Alternatives Considered

- **Copiar o transcript byte a byte para um spool:** era a primeira versão desta decisão. Protegeria
  de um perigo que não existe — o arquivo não é destruído pela compactação — e duplicaria 2,5 a
  10,3 MB por evento, acumulando exatamente os vários arquivos que o autor vetou.
- **Resumir a conversa no gatilho:** a §3.7 da CONSTITUTION proíbe textualmente — *"Nunca resumir
  conversa nem trocar contexto estruturado por prosa"* — e exigiria chamada de LLM dentro de um
  processo com teto de 15 segundos que não pode falhar.
- **Filtrar o transcript** para tirar a contabilidade do harness ou o `toolUseResult`: filtrar é
  julgamento no instante da compactação, e filtro que erra descarta em silêncio o registro que
  explicava a decisão. Além disso, tornou-se desnecessário quando nada passou a ser transformado.
- **Spool no `.mgr-core/` do projeto:** defeito, e de dois jeitos. O `README.pt-BR.md` instrui
  textualmente a versionar essa pasta — *"guarda apenas config do projeto (versione-o)"* —, então
  seria conversa commitada e empurrada no repositório de quem usa o método.
- **Criar categoria nova de diretório (`~/.mgr-method/`):** rejeitada pelo autor em favor do escopo
  global que já existe.
- **Sondar o `mgr-code` antes de gravar, e falar com ele quando estiver on:** impossível hoje por duas
  razões independentes e verificadas — o protocolo é de sessão, e o serviço pode não existir, e não
  existia. Sondar gastaria orçamento do teto de 15s para descobrir algo que não muda a ação.
- **Perguntar ao usuário quando o `mgr-code` está fora:** um hook não tem canal interativo, e a §8 da
  CONSTITUTION manda avisar visivelmente e prosseguir, nunca travar.

## Consequences

### Positive

- Nada é duplicado: o manifesto é de kilobytes, e existe **um** por projeto, em qualquer número de
  compactações.
- O problema de retenção desaparece junto com a cópia — não há teto de megabytes a administrar nem
  diretório crescendo no disco de quem usa o método.
- **Nenhum override de constituição**, e a fronteira de segurança do ADR-0009 fica intacta.
- O risco de conteúdo de conversa virar instrução depois fica **onde ele realmente se materializa**,
  que é a ingestão e a recuperação, e está registrado como obrigação de quem construir o dreno.
- Cabe com folga no teto de 15 segundos do gatilho.
- O contrato é dado versionado (`spoolFormat`), então o consumidor em outra linguagem não precisa
  varrer diretório e adivinhar.

### Negative

- **O método passa a depender de o motor preservar o transcript.** Copiar não tinha essa dependência.
  Quem limpar o histórico do motor, trocar de máquina ou apagar `~/.claude/projects/` perde o que a
  referência apontava.
- Os casos de uso de recuperação **só se cumprem quando o dreno existir**, e esta decisão não o
  entrega. Fica declarado, não escondido.
- A descoberta dos transcripts de subagente acopla o método a **layout de plataforma**, porque o
  payload não os informa — daí ela ser dado do descritor, por motor.
- No Copilot nada do aviso chega, porque aquele evento não tem canal — degradação já declarada pelo
  ADR-0018.

### Risks and Mitigations

- **Risco:** a política de retenção do motor é desconhecida e a referência pode apontar para um
  arquivo que desapareceu. **Mitigação:** o manifesto grava `sha256` e bytes no instante, para o
  dreno **detectar** em vez de assumir; e o dreno, que tem tempo e não tem teto de 15s, pode decidir
  copiar quando rodar.
- **Risco:** o `compact_boundary` talvez só seja escrito no transcript **depois** de o hook retornar,
  e então o campo seria sempre ausente. **MATERIALIZOU-SE, e foi pego antes do código.** A medição
  era task bloqueante do plano exatamente para isso, e ela mudou a decisão: o campo virou
  `previousBoundaries`, e nenhuma linha foi escrita para um campo que nunca estaria preenchido. O
  campo é **lista vazia** quando não há boundary anterior — vazio é vazio, e não omissão nem zero
  adivinhado. **O grau de certeza, declarado:** a resposta veio de **inferência** sobre evidência em
  disco, não de medição direta em sessão real; a sonda continua de pé como confirmação empírica, e se
  ela contradisser a inferência esta decisão é emendada de novo.
- **Risco:** o manifesto ser corrompido por escrita interrompida. **Mitigação:** manifesto corrompido
  não derruba o comando — é substituído, e o aviso diz que houve perda.
- **Risco:** esta decisão nascer de leitura errada de comportamento de plataforma, que foi o modo de
  falha da fatia anterior. **Mitigação:** ela nasce `Proposed` e só vira `Accepted` depois de
  verificação em sessão real de que a referência é registrada no momento do evento e de que o aviso
  chega ao usuário.
