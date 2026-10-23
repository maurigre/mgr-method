# ADR-0030: O install declara o esforco por intencao e recusa --effort e --model sem intencao

Date: 2026-10-23
Deciders: Mauri Reis

## Status

Proposed. Complementa o ADR-0017 (politica por intencao), sem revoga-lo.

## Context

O esforco do agente so vale pelo arquivo do agente e nao tem override na invocacao (ADR-0017, M-C e
decisao 5). O install, onde o time faz as escolhas iniciais, perguntava so o modelo
(src/prompts.js:177-203, em be99e68), e o esforco ficava no padrao do catalogo (src/catalog.js:193,226,239).
A flag `--effort` existe no parser global para o `mgr agents set` (src/cli-args.js:27, em be99e68). Passada ao
install, ela era ignorada sem aviso, com exit 0 e sem gravar nada (medido em temporario em 2026-10-23,
brief da fatia). O autor pediu que o esforco fosse escolhido como o modelo (2026-10-15) e decidiu, no
CHECKPOINT 1, recusar o `--effort` sem intencao nos dois cenarios (Q1), aceitar `inherit` so pela flag
(Q2) e recusar a flag de esforco quando nenhum motor escolhido o honra (Q3). No CHECKPOINT 2 incluiu o
`--model` solto, medido com o mesmo defeito: `install -y --model opus` sai 0 e nao grava nada (P-5).

**Reference:** Technical spec at specs/esforco-escolhido-no-install/03-spec.md.

## Decision

1. Com terminal, o install pergunta o esforco uma vez por intencao ligada, so quando algum motor
   escolhido tem `capabilities.agentEffort`, com "pular" pre-selecionado. Esforco ja gravado e intencao
   declarada por flag nao sao perguntados. `inherit` nao e opcao.
2. Sem terminal, `--effort-drafting`, `--effort-execution` e `--effort-review` aceitam
   `low | medium | high | xhigh | max | inherit`. A flag vence a pergunta.
3. `--effort` e `--model` sem intencao no install saem 1 antes do banner e de qualquer escrita, com a
   forma por intencao na mensagem (e os niveis aceitos, no caso do esforco).
4. Nivel fora da escala, ou flag de esforco sem nenhum motor escolhido que o honre, sai 1 antes de
   qualquer escrita.
5. So o respondido ou declarado e gravado, em `agents.<intencao>.effort` de `.mgr-core/config.json`,
   pelo `writeAgentPolicy`. A forma da config nao muda.

## Alternatives Considered

- **Mapear `--effort` solto para as tres intencoes:** rejeitada pelo autor (Q1). Alem disso, apagaria em
  uma flag os tres padroes diferentes do catalogo (src/catalog.js:193,226,239).
- **Aceitar `--effort` solto com aviso e exit 0:** rejeitada pelo autor (Q1). O precedente do metodo e
  "config que ninguem le e pior que erro na hora" (src/commands/agents.js:187-188).
- **Forma `motor=nivel` nas flags, como no modelo:** rejeitada; o esforco vale para a intencao inteira
  (src/commands/agents.js:162-163; src/registry.js:236), e a forma declararia o que a politica nao guarda.
- **Uma flag unica `--effort intencao=nivel`:** rejeitada; ela muda o significado de uma flag que o
  `agents set` ja usa com outra forma (src/commands/agents.js:201) e quebra a simetria com
  `--model-<intencao>` (src/cli-args.js:31-33).
- **Gravar a flag de esforco mesmo sem motor que o honre, como o `agents set`:** rejeitada pelo autor
  (Q3); o precedente das flags de modelo recusa o caso equivalente (src/cli-args.js:59).

## Consequences

### Positive
- O esforco escolhido no install chega ao arquivo do agente no proprio install, sem `agents apply`.
- A flag que era ignorada em silencio passa a dizer o que aconteceu.

### Negative
- `install --effort <x>` e `install --model <x>` deixam de sair 0.
- Uma pergunta a mais por intencao no install com claude-code.

### Risks and Mitigations
- **Risk:** pipeline que passa `--effort` ou `--model` ao install ficar vermelho. — **Mitigation:** a
  mensagem traz a forma certa; a entrada `Alterado` do CHANGELOG. — **proved by:** a mensagem e o exit 1, por
  `test/esforco-no-install.test.js` (recusa de `--effort` e de `--model` soltos), que fica vermelho com
  o ramo `bare-effort` ou `bare-model` removido (mutacoes (f) e (m) da spec); quantos pipelines sao
  afetados [NOT VERIFIED].
- **Risk:** com terminal, recusar so depois das perguntas. — **Mitigation:** `--effort` solto e nivel
  invalido sao recusados antes do banner. — **proved by:** [NOT VERIFIED]; os testes de CLI nao tem
  terminal, e o CA-17 da spec e verificacao manual.
- **Risk:** `--effort-*` passado a outro comando ser ignorado em silencio. — **Mitigation:** nenhuma
  nesta decisao (o `agents set` esta fora do escopo). — **proved by:** [NOT VERIFIED].
