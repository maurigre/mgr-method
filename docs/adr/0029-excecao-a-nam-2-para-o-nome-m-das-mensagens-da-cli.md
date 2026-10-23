# ADR-0029: Excecao a NAM-2 para o nome M das mensagens da CLI

Date: 2026-10-22
Deciders: Mauri Reis

## Status

Accepted

> Aceito pelo autor em 2026-10-22, ao fechar a fatia runtime-fora-do-versionamento (achado F-2 do
> quarto review, PR #49). Abre uma excecao a regra `NAM-2` do guia de review
> (`docs/sdd/09-review-rules.md`), so para o nome `M` no codigo deste repositorio.

## Context

A `NAM-2` do guia diz: "Proibido nome de uma letra ou sem significado (`a`, `b`, `x`, `tmp`, `data`,
`obj`). Exceções: índices de laço curto (`i`, `j`) e parâmetro de lambda de uma expressão."

O codigo do metodo chama de `M` o objeto de mensagens devolvido por `getMessages` (`src/messages.js`).
Em `bin/mgr.js` ele e declarado com `let M = getMessages(...)`, em `bin/mgr-runtime.js` com
`const M = getMessages(...)`, e chega a cada cola de `src/commands/` como parametro, inclusive pelo
`commandIo` de `bin/mgr.js`. Contado em 2026-10-22 (`grep -oE '\bM\.[A-Za-z]'`), sao 425 usos de
`M.` em 11 arquivos: 233 em `bin/mgr.js`, 7 em `bin/mgr-runtime.js` e 185 nos 9 arquivos de
`src/commands/`.

O quarto review isolado da fatia runtime-fora-do-versionamento (opus/max) apontou que, pela letra da
`NAM-2`, `M` e nome de uma letra fora das excecoes, e devolveu a decisao ao autor (F-2). Nao
reprovou a fatia, porque o nome ja era convencao antes dela.

**Reference:** Technical spec at specs/runtime-fora-do-versionamento/03-spec.md.

## Decision

1. `M` e aceito como nome do objeto de mensagens da CLI, e so dele: o valor devolvido por
   `getMessages` e o parametro que o carrega nas colas de `src/commands/` e no `commandIo`.
2. Qualquer outro nome de uma letra continua sob a `NAM-2`. Os testes nao entram na excecao: o
   `test/runtime-versioning.test.js` ja usa `msg`, e isso nao muda.
3. A excecao vale para o codigo deste repositorio. A `NAM-2` distribuida ao usuario
   (`shared/arch/cross-cutting-rules.md`) nao muda.
4. O guia local (`docs/sdd/09-review-rules.md`) registra a excecao na propria linha da `NAM-2`,
   citando este ADR, como a `LOG-1` faz com o ADR-0027.

## Alternatives Considered

- **Renomear `M` em todas as colas, numa fatia propria:** rejeitada. Sao 425 usos em 11 arquivos
  (medido acima) para trocar um nome que o leitor do projeto ja reconhece por convencao, sem mudanca
  de comportamento e com risco de conflito com qualquer fatia aberta que toque a CLI.
- **Deixar como esta, sem registro:** rejeitada. Todo review futuro reabriria o mesmo achado, e a
  regra seria violada sem excecao declarada.

## Consequences

### Positive
- O review deixa de reabrir o achado a cada fatia que toca a CLI.
- A convencao fica escrita, com o motivo e o alcance.

### Negative
- O guia passa a ter mais uma excecao, e o leitor novo precisa saber que `M` sao as mensagens.

### Risks and Mitigations
- **Risk:** a excecao servir de precedente para outros nomes de uma letra. — **Mitigation:** a
  decisao 1 limita a excecao ao objeto de `getMessages`, e a decisao 2 mantem o resto sob a regra.
  — **proved by:** [NOT VERIFIED]. Nenhum check mecanico confere nome de uma letra; quem confere e o
  review.
- **Risk:** um review reprovar `M` sem conhecer a excecao. — **Mitigation:** a linha da `NAM-2` no
  guia cita este ADR, e o guia e lido pelo `mgr-review` em toda rodada. — **proved by:**
  [NOT VERIFIED]. Nenhuma rodada de review rodou depois do registro.
