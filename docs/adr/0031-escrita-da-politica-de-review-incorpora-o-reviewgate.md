# ADR-0031: A escrita da politica de review incorpora o reviewGate e o remove

Date: 2026-11-03
Deciders: Mauri Reis

## Status

Accepted

> Aceito pelo autor em 2026-11-11, com a fatia review-gate-preservado-na-escrita (PR #51). Refina a
> decisao 2 do ADR-0017, sem edita-lo.

## Context

O ADR-0017 (decisao 2) fez do `reviewGate` um apelido de `agents.review`: "Config antiga segue
funcionando byte a byte", e com as duas chaves presentes `agents` vence e o conflito e avisado, nunca
resolvido em silencio. A leitura cumpre isso: o apelido so vale quando `agents.review` nao existe
(src/registry.js:404-406, em cc22855).

A escrita nao cumpria. As tres portas que gravam a politica de review (`mgr install` com
`--effort-review` ou `--model-review`, a pergunta interativa do install e `mgr agents set review`)
partiam so de `agents.review` (src/registry.js:234 e :375, em cc22855). Medido em 2026-10-23, em
projeto, cwd e HOME temporarios, a partir de `{"reviewGate":{"enabled":false}}`: as tres portas medidas
saem 0, gravam `agents.review` so com o campo pedido, e `mgr agents --json` passa a dar
`intents.review.enabled: true`. O comando que fez a mudanca nao avisa; so o `mgr agents` em texto avisa
o conflito depois. O mesmo vale, por leitura do codigo, para `model` e `effort` escritos no
`reviewGate`, e para o plano do install, que contradizia o arquivo.

No CHECKPOINT 1 da fatia review-gate-preservado-na-escrita, o autor decidiu migrar na escrita (N-10),
anunciar o que foi preservado (Q1), carregar o `reviewGate` inteiro (Q2) e recusar antes de escrever
quando o `reviewGate` e invalido (Q3).

**Reference:** Technical spec at specs/review-gate-preservado-na-escrita/03-spec.md.

## Decision

1. Uma escrita pedida da politica de review, num config que tem `reviewGate` e nao tem
   `agents.review`, parte do `reviewGate` inteiro, inclusive chaves fora de `enabled`, `model` e
   `effort`, aplica o campo pedido com o merge de dois niveis de sempre, grava em `agents.review` e
   remove a chave `reviewGate`.
2. A saida do comando que fez a escrita anuncia a migracao: diz que o `reviewGate` foi incorporado a
   `agents.review` e removido, nomeia os campos e valores mantidos dele e os que o pedido substituiu,
   com o valor de antes e o de depois. O plano do install diz o mesmo antes da confirmacao.
3. O plano do install, antes da confirmacao, mostra a politica ja com a decisao 1 aplicada, e sai da
   mesma funcao de base que a escrita usa.
4. Um `reviewGate` invalido recusa essa escrita antes de qualquer gravacao, com o caminho
   `reviewGate` na mensagem. A leitura passa a usar o mesmo caminho quando o valor vem do apelido.
   `agents` que nao seja objeto, e `agents.<intencao>` escrito que nao seja objeto, tambem recusam a
   escrita, em vez de serem sobrescritos (`null` em `agents.<intencao>` conta como ausente, como na
   leitura; `agents: null` e recusado). Da base propria so se confere a forma do que a mescla le
   (o `reviewGate`, quando e a base, e validado inteiro, como diz a primeira frase desta decisao):
   o `model` tem de ser mapa quando um modelo e pedido. Os pedidos
   de todas as intencoes de uma escrita sao aplicados juntos, e o config resultante inteiro passa
   pela mesma validacao da leitura antes de gravar: o campo invalido que o pedido substitui e
   consertado, e config que a leitura recusaria nao e gravado.
5. Sem escrita pedida da politica de review nada muda: a leitura, o `update`, o install sem resposta
   nem flag para review e a escrita de outra intencao nao tocam o `reviewGate`. "Byte a byte" do
   ADR-0017 continua valendo para quem nao faz essa escrita. Na leitura mudam so o texto da recusa
   (decisao 4) e o aviso de conflito com `agents.review: null` (decisao 6).
6. Com `reviewGate` e `agents.review` escritos a mao, o comportamento e o do ADR-0017: a escrita vai
   para `agents.review`, o `reviewGate` fica e o `mgr agents` avisa. `agents.review: null` conta como
   ausente na leitura e na escrita: o apelido vale, a escrita o incorpora, e o aviso de conflito nao
   sai (antes saia dizendo que `agents.review` vencia, o que era falso).

## Alternatives Considered

- **Gravar `agents.review` completo e manter o `reviewGate` no arquivo:** rejeitada pelo autor
  ("Migrar na escrita", N-10). Alem disso, criaria pela mao do metodo o conflito que o ADR-0017 manda
  avisar: com as duas chaves presentes, a leitura marca `aliasOverridden` (src/registry.js:417).
- **Migrar na leitura ou no `update`:** rejeitada pelo autor (fora de escopo do PRD). Contraria a
  CONSTITUTION secao 2.7: quem nao roda comando algum nao pode ser afetado.
- **Misturar o `reviewGate` por baixo de `agents.review` na leitura:** rejeitada; muda o resultado
  do conflito escrito a mao, em que o ADR-0017 diz que `agents` vence, e mantem duas fontes para a
  mesma politica.

## Consequences

### Positive
- Mudar so o esforco ou so o modelo do review deixa de religar o gate em silencio.
- A politica de review passa a ter uma fonte so depois da primeira escrita, e o plano mostra o que
  sera gravado.
- O `reviewGate` invalido deixa de ser mascarado pela escrita.

### Negative
- A forma persistida do `config.json` muda na primeira escrita pedida da politica de review: a chave
  `reviewGate` some.
- `install` com flag de review e `agents set review` passam a sair 1 sobre `reviewGate` invalido sem
  `agents.review`, onde hoje saem 0.
- `agents set` passa a sair 1 sobre config que a leitura recusa por outra parte que nao a intencao
  escrita, onde hoje grava e sai 0. O campo invalido que o pedido substitui continua sendo consertado;
  no `install` nada muda, porque o plano ja recusava esse config.

### Risks and Mitigations
- **Risk:** pipeline de projeto usuario ver o `config.json` versionado reescrito sem a chave antiga.
  — **Mitigation:** o anuncio na saida do comando e a entrada `Alterado` do CHANGELOG. — **proved
  by:** os CA-10 e CA-11 da spec provam o anuncio, e as mutacoes (d1) e (d2) os derrubam (rodada 6
  no `05-execution.md` da spec). Quantos pipelines sao afetados nao foi medido [NOT VERIFIED].
- **Risk:** versao antiga do metodo, que so le `reviewGate`, passar a ler o padrao no mesmo
  repositorio. Pelo CHANGELOG, o `reviewGate` entrou na 0.7.0-beta.2 e o `agents` na 0.7.0-beta.10;
  das versoes entre elas, so a 0.7.0-beta.8 e a 0.7.0-beta.9 estao publicadas no npm (`npm view
  mgr-method versions`, 2026-11-03). — **Mitigation:** nenhuma nesta decisao; o anuncio diz que a
  chave foi removida. — **proved by:** [NOT VERIFIED]; nenhuma das duas versoes foi rodada sobre o
  config migrado.
- **Risk:** plano e arquivo gravado divergirem. — **Mitigation:** uma regra so para aplicar os pedidos
  no plano e na escrita (`applyRequests`, sobre `policyBaseOf` e `overlayRequest`), e a escrita grava
  todos os pedidos de uma vez, validando a base e o resultado final, nunca um estado intermediario
  (decisao 3). — **proved by:** a regra unica pelas mutacoes (b) e (c1), que derrubam plano e escrita
  juntos; a concordancia entre os dois pela (bb), so na escrita, e pela (q), so no plano, contra o CA-9,
  o teste das duas intencoes no install e o teste que compara a migracao do plano com a do `execute`
  (rodada 6 no `05-execution.md` da spec).
- **Risk:** a mesma recusa sair com rotulos diferentes conforme a porta. — **Mitigation:** a leitura
  usa o rotulo `reviewGate` quando o valor vem do apelido (decisao 4). — **proved by:** o CA-19 da
  spec, que a mutacao (h) derruba (rodada 6 no `05-execution.md` da spec).
