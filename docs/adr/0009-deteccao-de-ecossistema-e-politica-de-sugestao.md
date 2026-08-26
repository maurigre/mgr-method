# ADR-0009: Detecção de ecossistema e política de sugestão de skills

Date: 2026-08-25
Deciders: Mauri Reis

## Status

Accepted

## Context

Com a fundação de plugins entregue (ADR-0004 a ADR-0008), o MGR sabe instalar, travar e
restaurar skills de terceiros — mas o usuário só instala uma skill se **já souber que ela
existe** e digitar o nome exato. O catálogo é invisível para quem não o leu, e a informação
que justificaria cada skill já está no repositório: quem tem `pom.xml` faz Java, quem tem
`docker-compose.yml` mexe com contêiner.

O risco de fechar essa lacuna é nomeado em D03 do kickoff: instalar skill é injetar instrução
no contexto de um agente que escreve código. Três vetores concretos: repositório comprometido
que injeta instruções maliciosas sem revisão; texto hostil em arquivo ingerido servindo de
gatilho para instalação; e divergência silenciosa entre devs do mesmo projeto quando não há
registro do conjunto instalado.

Há ainda uma tensão com a fase anterior: D03 prevê um modo `auto`, que instalaria sem
perguntar. A CONSTITUTION §6 e o ADR-0007 estabeleceram o oposto — toda instalação confirmada
por uma pessoa, sem flag de bypass.

Durante a elaboração desta decisão, o autor propôs que a detecção fosse feita por um agente de
IA executado uma vez por sessão em cada plataforma. A proposta motivou a verificação empírica
descrita abaixo e mudou a decisão em um ponto (o gatilho), mantendo-a em outro (quem detecta).

**Reference:** Spec técnica em specs/deteccao-e-sugestao/03-spec.md.

## Decision

1. **Scanner determinístico, com lista fechada de caminhos.** O detector consulta caminhos
   conhecidos (`pom.xml`, `build.gradle`, `build.gradle.kts`, `package.json`,
   `docker-compose.*`, `compose.*`, e `application.*` no caminho convencional de Maven/Gradle)
   e nada mais. Sem travessia de árvore: custo fixo, resultado determinístico, e o usuário
   sabe exatamente onde o MGR olhou.
2. **Conteúdo lido por marcador ancorado, nunca interpretado.** Serviços saem de expressões
   como `image: postgres` ou `jdbc:postgresql:`; não há parser de YAML nem de XML. Nada
   extraído do conteúdo vira nome de skill, URL ou comando — o casamento é sempre token do CLI
   contra campo do índice.
3. **A skill declara a que ecossistema serve, no campo `ecosystems` do manifest**, com
   vocabulário aberto validado apenas na forma. Campo opcional: skill sem ele nunca é sugerida.
   O índice do registry passa a publicar o campo.
4. **Modo de detecção por projeto** em `.mgr-core/config.json`: `manual` e `suggest`
   (default). **O modo `auto` fica adiado** até existir `mgr audit`, e é recusado com erro
   explícito enquanto isso — tratá-lo em silêncio como `suggest` seria mentir sobre a política
   de segurança que o usuário configurou. Com esse adiamento, o "sem bypass" da CONSTITUTION §6
   e do ADR-0007 permanece intacto.
5. **O gatilho é o hook nativo de início de sessão de cada motor; a detecção continua no CLI.**
   O hook chama o mesmo detector determinístico e entrega ao agente um resultado pronto.
6. **O hook é sempre project-local e não commitado** — `.claude/settings.local.json` e
   `.github/copilot/settings.local.json` —, gravado a partir dos motores já escolhidos na
   instalação, sem pergunta adicional, e apenas na entrada identificável como do MGR.
   `--no-hooks` desliga.
7. **O canal hook → contexto transporta apenas fato apurado pelo MGR** (token de ecossistema,
   nome do arquivo-evidência, nome e versão de skill do índice), nunca trecho de arquivo do
   projeto.
8. **A instalação vinda de sugestão reaproveita o fluxo existente** — mesma confirmação
   humana, mesmo checksum, mesmo lockfile, mesma resolução de colisão. Nenhum segundo caminho
   de instalação é criado.

### Matriz de plataforma — verificada por experimento em 2026-08-25

Não por leitura de documentação: hook criado, sessão real aberta em cada CLI, e o agente
interrogado sobre o que recebeu.

| Motor | Arquivo | Dispara | Chega ao contexto |
|---|---|---|---|
| Claude Code 2.1.246 | `.claude/settings.local.json` | sim | sim, via stdout |
| Copilot CLI 1.0.80 | `.github/copilot/settings.local.json` | sim | sim, via `additionalContext` |
| Copilot no VS Code | — | não suporta hooks | — |

Os formatos **não são intercambiáveis**: evento `SessionStart` com matcher e stdout puro no
Claude Code; `sessionStart`, envelope `version: 1`, campo `bash` e saída JSON no Copilot, que
ainda recebe um payload no stdin. Cada motor recebe o formato nativo dele.

**Pré-requisito descoberto no teste:** o hook do Copilot vindo do repositório só carrega
depois do *folder trust*; enquanto não há confiança, ele não carrega e **nada avisa** — nem
erro, nem log em modo debug —, e `--allow-all` não substitui. Por isso a instalação avisa que
a primeira sessão do Copilot pedirá essa confirmação.

## Alternatives Considered

- **Detecção executada por um agente de IA a cada sessão** (proposta do autor): rejeitada por
  cinco razões, sendo a primeira decisiva. Para detectar, o agente precisaria ler os arquivos
  do projeto para dentro do contexto — exatamente o vetor de prompt injection que D03 nomeia;
  um arquivo hostil passaria a ter um leitor capaz de obedecer. Somam-se: custo de contexto a
  cada sessão, quando D06 estabelece que o custo real do MGR é contexto; não-determinismo entre
  execuções; impossibilidade de teste automatizado; e D05 já listar o scanner entre as camadas
  portáveis, independentes do agente. O teste deu uma sexta razão empírica: sem o contexto do
  hook, o agente **alucinou** o ecossistema a partir do nome do diretório. O gatilho da
  proposta foi adotado; a execução por agente, não.
- **Casar ecossistema por `category` ou por texto da `description`:** `category` diz o tipo da
  skill, não qual tecnologia; casar por descrição seria adivinhação sobre texto escrito para o
  agente, o oposto do que D06 pede. Rejeitada.
- **Vocabulário fechado de ecossistemas, validado contra lista:** bloquearia skills de
  terceiros na velocidade do CLI — uma skill de Kafka não poderia se declarar antes de o
  detector aprender Kafka. Rejeitada em favor de vocabulário aberto, em que declarar cedo é
  inofensivo e apenas não casa até o detector acompanhar.
- **Implementar o modo `auto` agora:** abriria a primeira exceção ao "sem bypass" tendo como
  única base a flag `trusted`, que hoje é apenas algo que o usuário digitou. Adiada até haver
  auditoria que sustente a confiança.
- **Hook em escopo global** (`~/.claude/settings.json` ou `~/.copilot/hooks/`): rodaria o
  detector em toda sessão de todo projeto, inclusive nos que não usam o MGR — execução inútil e
  ruído injetado em contexto alheio. Rejeitada pelo autor.
- **Hook em arquivo commitado** (`.claude/settings.json`, `.github/hooks/*.json`): mudaria o
  comportamento do agente para todos que clonassem o repositório, sem que tivessem pedido. Vale
  notar que as duas plataformas protegem justamente esse caso — o Claude Code bloqueia hooks de
  plugin em escopo projeto e o Copilot exige folder trust —, o que reforça a escolha pelo
  arquivo local. Rejeitada.
- **Arquivo único servindo aos dois motores:** a documentação do Copilot afirma ler
  `.claude/settings.local.json` como configuração cross-tool, o que seria tentador. Rejeitada
  porque os esquemas diferem em evento, campo de comando e forma de saída, e não foi verificado
  que cada ferramenta tolera as chaves da outra no mesmo arquivo — com falha silenciosa como
  modo de erro. Registrada como possível simplificação futura, a confirmar por experimento.
- **Varredura recursiva da árvore do projeto:** custo imprevisível em monorepo, sem evidência
  de necessidade. Rejeitada; monorepo com módulos em subpastas fica como limitação conhecida.

## Consequences

### Positive

- O catálogo deixa de depender de o usuário adivinhar o que existe: a skill certa é proposta a
  partir de evidência do próprio repositório, com o motivo visível.
- A sugestão chega onde é acionável — o contexto do agente — sem que ninguém rode comando.
- A detecção é determinística, testável e idêntica entre plataformas, porque vive no CLI.
- A garantia de segurança da fase anterior permanece inteira: nada é instalado sem confirmação
  humana.

### Negative

- O usuário confirma duas vezes ao aceitar uma sugestão: uma para aceitar, outra na
  confirmação que mostra origem, permissões e checksum. A segunda é inegociável.
- Mais um campo no manifest e no índice, e a republicação das skills já publicadas com bump de
  versão, já que o checksum cobre todos os arquivos.
- O MGR passa a editar arquivos de configuração de agente que não são dele, ainda que apenas
  na própria entrada.
- Dois formatos de hook a manter, um por motor.

### Risks and Mitigations

- **Risco:** arquivo de projeto hostil tentando induzir instalação — **Mitigação:** conteúdo é
  evidência, nunca fonte de execução; o casamento usa tokens do CLI; o canal hook → contexto
  não transporta trecho de arquivo; e instalar continua exigindo confirmação humana.
- **Risco:** usuário conclui que o hook do Copilot está quebrado por causa do folder trust —
  **Mitigação:** o `mgr install` avisa que a primeira sessão pedirá a confirmação, e a
  documentação registra o pré-requisito.
- **Risco:** o MGR corromper `settings.local.json` de quem já tinha hooks próprios —
  **Mitigação:** prova de posse na entrada, nunca reescrita do arquivo; idempotência na
  reinstalação; e `uninstall` removendo exatamente a entrada do MGR.
- **Risco:** sugestão irrelevante virar ruído a cada sessão — **Mitigação:** skill sem
  `ecosystems` nunca é sugerida, skill já instalada não é repetida, e o modo `manual` desliga.
- **Risco:** a plataforma mudar o formato ou o gate dos hooks — **Mitigação:** a matriz é
  publicada com a data da verificação, e a regra de processo de D05 exige reverificar antes de
  qualquer decisão que dependa dela.
