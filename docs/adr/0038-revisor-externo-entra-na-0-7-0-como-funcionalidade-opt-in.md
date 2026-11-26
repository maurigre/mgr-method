# ADR-0038: Revisor externo entra na 0.7.0 como funcionalidade opt-in (revisão do K13)

Date: 2026-11-26
Deciders: Mauri Reis

## Status

Proposed

## Context

O ADR-0036 dividiu o revisor externo (K13) em duas etapas. A etapa 1 era um script deste repositório,
com as fichas e só o Codex, e era a fatia 3 da 0.7.0. A etapa 2, o recurso do MGR para os usuários,
opt-in, ficava para depois da 1.0. A decisão 6 do mesmo ADR exige um ADR de revisão para mudar o plano.

No CHECKPOINT 1 do PRD da fatia, o autor mudou o escopo: "na realidade a minha intenção tambem era que
este possibilidade de revisao externa seria mais uma funcionalidade do MGR-METHOD o qual o usuario
queria ativar esta funcionalidade. Não somente neste repositório." E acrescentou que o `spec archive`
exige a revisão quando ela está ligada.

**Reference:** Technical spec at specs/revisor-externo/03-spec.md.

## Decision

- A fatia 3 da 0.7.0 entrega a etapa 2 do K13: o comando `mgr review`, distribuído no pacote e
  **desligado por padrão**. O time liga a exigência e cada pessoa consente o envio do próprio código.
- A **garantia forte no CI continua para depois da 1.0**. A prova da 0.7.0 é local e não
  criptográfica.
- O passo condicionado na `spec-execute` vai para a 0.8.0. Na 0.7.0 a revisão é chamada pelo comando.
- A fatia é entregue em dois PRs, 3a e 3b, os dois na 0.7.0. Isso é uma exceção declarada ao limite
  de 4 fatias, decidida pelo autor no CHECKPOINT 2 (P-10), porque é uma funcionalidade só, em duas
  partes que se provam cada uma.
- A primeira execução real é a de 2026-11-26, registrada em `specs/revisor-externo/05-execution.md`:
  - a primeira chamada falhou pela grafia do modelo e expôs que a falha não mostrava o motivo, o que
    foi corrigido;
  - a segunda passou com `codex-cli 0.172.0`, modelo `gpt-6.2-sol`, esforço `medium`, em 157 s, na
    sessão `01a217aa-bb75-7801-8ddf-7c030c9dfd5b`;
  - a rodada 2 levou 131 s.

## Alternatives Considered

- **Manter a etapa 1, só neste repositório:** rejeitada pelo autor no CHECKPOINT 1. A intenção era
  oferecer a revisão aos usuários do MGR, e não só ao mantenedor.
- **Entregar a etapa 2 com a garantia no CI já na 0.7.0:** fora do tamanho de uma versão estável
  pequena (ADR-0036, decisão 2), e o K13 já a colocava depois da 1.0.

## Consequences

### Positive
- Qualquer projeto pode exigir a revisão por outro fornecedor antes de arquivar uma fatia.
- O mantenedor usa a mesma funcionalidade que distribui (dogfooding), em vez de um script à parte.

### Negative
- A 0.7.0 ganha superfície pública nova (sete subcomandos e uma quarta condição no archive) e passa
  a ter 5 PRs.
- O código das fatias sai da máquina a cada revisão e consome a cota de quem a roda.

### Risks and Mitigations
- **Risk:** a funcionalidade ligar sem querer, ou mudar o fluxo de quem não a usa. — **Mitigation:**
  desligada por padrão; `install` e `update` nunca ligam; ligar e consentir exigem terminal. —
  **proved by:** `test/e2e/mgr.test.js` (install e update nunca ligam), `test/commands/spec-archive-revisao.test.js`
  (desligada, a saída do archive é a de sempre e o git não é chamado), `test/e2e/review-terminal.test.js`.
- **Risk:** a fatia passar do tamanho. — **Mitigation:** a divisão em 3a e 3b. — **proved by:** o
  plano aprovado (`specs/revisor-externo/04-plan.md`) e o PR #63 da 3a, mergeado antes da 3b.
