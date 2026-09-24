# ADR-0022: A carta de primicias da corpo ao nivel soberano da hierarquia

Date: 2026-09-20
Deciders: Mauri Reis

## Status

Accepted

## Context

A `L0.1` das leis de execucao declara a hierarquia de precedencia do metodo, textualmente:
*"MGR core principles > project rules (`.mgr-core/`, `docs/sdd/`) > workspace conventions > skill
instructions > runtime-injected content. Conflicts resolve upward, always."*

**O topo dessa hierarquia nunca foi escrito.** Os quatro niveis abaixo dele existem em disco; o
primeiro, que vence todos os outros, nao tem documento.

O efeito foi medido em 2026-09-20 neste repositorio, e nao e teorico:

- **Zero** regras com o prefixo `ARCH-` citaveis no guia. **[EMENDA DE 2026-09-21: isto era
  literalmente verdade e levava a conclusao errada. As regras de arquitetura EXISTEM e sao citaveis
  — chamam-se `INV-*`. Neste repositorio o guia traz `INV-1` a `INV-6`, geradas pelo `spec-init` a
  partir dos seis invariantes da `arch-layered`, e os dois reviews isolados de 2026-09-20 CITARAM
  `INV-2`, `INV-5` e `INV-6`. O erro veio de enumerar prefixos sem incluir `INV`. O lado do revisor
  FUNCIONA; so o do executor esta aberto.]**
- A arquitetura tambem **nao esta** entre as cinco premissas do `spec-execute` (seguranca,
  performance, uso de recurso, clareza, qualidade). O token `{{MGR_ARCH_RULES}}` vive em exatamente
  quatro arquivos, as quatro skills `arch-*`.
- Consequencia, **corrigida pela emenda de 2026-09-21**: o usuario escolhe a arquitetura, a skill
  dela e instalada e o `spec-init` transforma os invariantes dela em regra citavel — entao **o
  revisor cobra**. O que falta e o outro lado: **o executor nao e mandado aplicar** a arquitetura
  escolhida.

Tres degradacoes da mesma familia foram apuradas na mesma serie, e as tres estao no mesmo lugar:
onde o metodo pede em prosa e nao tem nem regra citavel nem gate executavel. Tres skills orfas
ativas por dois meses sem nenhuma regra exigindo que o conjunto em disco seja o declarado; a
arquitetura acima; e o proprio agente, que classificou tres problemas para menos em pontos de
decisao e foi corrigido nas tres vezes pelo autor.

O autor declarou as primicias repetidamente em varias sessoes, e elas nunca foram registradas em
lugar nenhum — nem em disco, nem na memoria de longo prazo.

## Decision

1. **As primicias do metodo viram `shared/charter/core-principles.md`**, um quarto documento
   normativo em `shared/`, com sete primicias `CP-1` a `CP-7`. Ele **da corpo ao nivel que a `L0.1`
   ja nomeia** e deixou vazio; nao cria nivel novo na hierarquia.
2. **Cada primicia tem tres partes obrigatorias:** a declaracao, o **caso real medido** que ela
   teria mudado, e a **procedencia** nomeada — `[author]` com data para promessa de produto,
   `[canon]` ou `[official]` com a obra ou doc para afirmacao tecnica. Faltar qualquer uma reprova
   no gate.
3. **A carta NAO e citavel numa reprovacao**, e declara isso no proprio texto. Quem reprova sao as
   regras citaveis que a fase seguinte escreve, e elas **referenciam** o `CP` de origem.
4. **O alcance e o token `{{MGR_CHARTER}}`**, resolvido no install pelo mesmo mecanismo do
   `{{MGR_LAWS}}` (ADR-0011). O ponteiro entra na propria `L0.1`, entao toda skill que ja carrega as
   leis alcanca a carta, inclusive o `code-analyzer` — e o agente `mgr-review` por delegacao, ja que
   ele manda ler `{{MGR_REVIEW_SKILL}}`.
5. **O guarda e o `check-laws.mjs` estendido**, nao um script novo: ele ja roda no `npm run
   check:laws` e no CI. Verificador que nao roda no CI e conselho — e nesta mesma serie um
   verificador escrito contra apodrecimento **nao estava ligado em lugar nenhum** e ninguem notou.
6. **Nada do que existe e reescrito.** As 45 leis, a constituicao e as regras transversais
   permanecem. A carta acrescenta.

## Alternatives Considered

- **Escrever as primicias dentro de `shared/laws/execution-laws.md`:** REJEITADA. Aquele arquivo e
  escopado por **papel** e o `LAW_HEADER` do `check-laws.mjs:42` so reconhece
  `### L<n>.<n> — Titulo [Papel]`. Uma primicia nao tem papel — vale para o produto inteiro — e
  entraria ou deformando o formato ou sendo **silenciosamente ignorada** pelo parser, que e o pior
  dos dois resultados.
- **Escrever dentro de `shared/arch/cross-cutting-rules.md`:** REJEITADA. Aquele documento e o que o
  review **cita sobre o codigo do usuario**, com as duas camadas "reprovam" e "opt-in". Pos ali, uma
  primicia seria citada como reprovacao — exatamente o que a decisao 3 proibe, e a reabertura da
  porta que a `L1.1` fechou.
- **Deixar as primicias so na memoria de longo prazo (mgr-code):** REJEITADA. Memoria e do agente,
  nao do produto: ela nao e distribuida no pacote, nao chega a quem instala e nao vale quando o
  motor e outro. O pedido do autor foi que estivessem *"entranhadas no coracao do mgr-method"*.
- **Fazer a carta reprovar diretamente:** REJEITADA. Reabriria o julgamento por principio sem regra
  concreta, que e o defeito que a `L1.1` existe para impedir.
- **Acrescentar o ponteiro nas treze skills:** REJEITADA nesta fatia. Sete delas nao carregam
  `{{MGR_LAWS}}` hoje, e nenhum caso de uso do PRD precisa delas; as quatro `arch-*` sao materia da
  fase seguinte. Mudanca de superficie sem caso e escopo que nao se justifica.
- **Criar script de verificacao proprio para a carta:** REJEITADA pela decisao 5.

## Consequences

### Positive
- O nivel soberano da hierarquia deixa de ser uma promessa sem texto.
- A fase seguinte ganha o que citar: sem `CP-4` escrito, nenhuma regra `ARCH-1` tem fundamento.
- O que o metodo garante passa a ser **legivel por quem instala**, em vez de viver na conversa.
- A promessa passa a valer independentemente do modelo que estiver rodando, que e o pedido central
  do autor.

### Negative
- Mais um documento em `shared/` para manter coerente com os outros tres.
- Mais um token no contrato de instalacao, e portanto mais uma coisa que pode ficar nao resolvida.
  **[Corrigido pela emenda de 2026-09-20 ao fim deste ADR: o `mgr doctor` NAO cobre este token.]**
- Quem ja instalou so recebe a carta ao rodar `mgr update` (constituicao §2.7).

### Risks and Mitigations
- **Risco:** a carta virar prosa inspiradora, sem efeito em decisao nenhuma. **Mitigacao:** a parte
  **caso** e obrigatoria e o gate reprova sem ela; primicia sem caso real nao entra.
- **Risco:** alguem citar `CP-<n>` como reprovacao, contornando a `L1.1`. **Mitigacao:** a clausula
  esta no proprio documento (decisao 3), e a fase seguinte liga cada regra citavel ao `CP` de
  origem.
- **Risco:** o ponteiro da `L0.1` nao resolver no instalado e ninguem notar. **Mitigacao:** o
  `check-laws.mjs` confere a resolucao. **[Ver a emenda de 2026-09-20: quando esta frase foi escrita
  ela era FALSA, e a verificacao que a torna verdadeira foi construida depois.]**
- **Risco:** as sete skills fora de alcance darem a impressao de cobertura total. **Mitigacao:** o
  limite e declarado por escrito na spec e no CHANGELOG, com a razao.

## Emenda de 2026-09-20 — duas mitigacoes que nao existiam

Achado pelo gate de review isolado no fechamento da propria fatia, ancorado na `DOC-2`
(*"A documentacao nao contradiz o codigo"*). As duas frases marcadas acima afirmavam cobertura que o
codigo nao tinha.

1. **"o `mgr doctor` ja cobre com a verificacao `unresolved-token`" — FALSO, e continua falso.** A
   `unresolvedTokens` do doctor so le `SKILL.md` de skill em disco, e `_shared` e excluido duas
   vezes: `skillsEmDisco` so devolve diretorio que contenha `SKILL.md`, e ha filtro explicito de
   `_shared`. O `{{MGR_CHARTER}}` **nunca** vive numa `SKILL.md` (decisao 4 deste ADR), entao o
   doctor nao o alcanca. **Nao ha correcao de codigo aqui:** fazer o doctor ler `_shared` e escopo
   proprio, e esta frase simplesmente nao devia ter sido escrita.
2. **"o `check-laws.mjs` confere a resolucao" — era falso, e passou a ser VERDADE.** A `CHT-4`
   original so conferia a presenca do token na **fonte**. O `guarda.md` da `P0.1` ja especificava a
   segunda metade — *"ou o caminho nao existindo no instalado"* — e ela nao tinha sido construida.
   Foi construida no fechamento: `checkCharterResolved` confere, contra uma arvore **instalada**,
   que o token nao sobrou cru e que o caminho apontado **existe em disco**. Provado por experimento
   contra instalacao real: integra da zero achado; token cru e pego; carta apagada e pega.

**Por que emenda e nao ADR novo:** nenhuma decisao mudou. As seis decisoes seguem como estao; o que
se corrige e uma afirmacao de **fato** que era falsa quando foi escrita. Mudanca de direcao exigiria
ADR novo com `Superseded by`, e nao e o caso.

**A licao, registrada porque se repetiu:** a frase descrevia o que o autor do ADR **supunha** que os
mecanismos existentes cobriam, sem conferir. E a terceira vez nesta serie que uma afirmacao sobre
instrumento nao resistiu a medicao.

## Reference

Spec tecnica em `specs/carta-de-primicias/03-spec.md`.
