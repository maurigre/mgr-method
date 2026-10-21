# ADR-0027: Excecao a LOG-1 para o temporario de teste, calado no caminho de sucesso

Date: 2026-10-21
Deciders: Mauri Reis

## Status

Accepted

> Aceito pelo autor em 2026-10-21, depois do merge da fatia tmp-organizado (PR #47). Abre uma excecao
> a regra `LOG-1` do guia de review (`docs/sdd/09-review-rules.md`), so para `scripts/lib/tmp.mjs`.

## Context

A fatia tmp-organizado poe todo temporario de teste e de script atras de `tempDir(prefixo)`, de
`scripts/lib/tmp.mjs`. O modulo cria uma pasta por processo sob `<tmp do sistema>/mgr-method/`, varre
as sobras de processos encerrados e apaga a pasta no `exit`.

A `LOG-1` pede "Log/`console` de informação antes e logo depois de **alterar estado em disco**." Dois
reviews isolados da fatia (opus/max) aplicaram a regra ao modulo. Ela foi aplicada por completo: um
par de linhas para a pasta do processo, outro para cada chamada de `tempDir`, outro para a limpeza no
`exit` e uma linha para o marcador. Medido em 2026-10-18, a saida de `npm run coverage` passou a ter
4080 linhas, e 2356 delas eram `tmp:`. Sem o par por chamada de `tempDir` (so a pasta do processo, o
marcador e a limpeza no `exit`, cerca de 4 linhas por processo), eram 220.

A regra existe para que uma mudanca em disco nao passe em silencio. Aqui quem garante isso e
`scripts/check-tmp.mjs`, encadeado no `npm test` e no `npm run coverage`: ele falha nomeando cada
sobra que a limpeza nao alcancou. Com mais de 2 mil linhas de sucesso, o aviso que importa (a
limpeza que falhou) some na saida.

**Reference:** Technical spec at specs/tmp-organizado/03-spec.md.

## Decision

1. `scripts/lib/tmp.mjs` fica **calado no caminho de sucesso**. Criar a pasta do processo, criar um
   temporario, gravar o `.mgr-keep` e limpar no `exit` nao escrevem nada.
2. Ficam no stderr so:
   - o aviso da limpeza ou da varredura que falha (`tmp: AVISO: <caminho> ficou em disco (...)`);
   - as duas linhas da varredura de sobras (antes e depois de remover a pasta de um processo
     encerrado), porque apagar o que outro processo deixou e acao sobre estado alheio;
   - a linha do `MGR_KEEP_TMP=1`, que diz onde a pasta ficou.
3. A excecao vale **so para esse modulo**. Os scripts que chamam `tempDir` (`check-laws`,
   `check-clean`, `capture-cli-baseline`) continuam sob a `LOG-1` para o que eles mesmos fazem.
4. O comentario de cabecalho do modulo cita este ADR, para que um review futuro encontre a excecao
   ao ler o codigo.

## Alternatives Considered

- **Aceitar o volume (LOG-1 completa):** rejeitada. Mais da metade da saida da suite (2356 de 4080
  linhas, medido) passaria a ser log de sucesso, escondendo o aviso de falha.
- **Meio-termo, sem o par por chamada (cerca de 220 linhas):** rejeitada. Continua sendo
  excecao a regra, e as linhas restantes nao dizem nada que o `check-tmp` nao diga melhor.

## Consequences

### Positive
- A saida da suite volta a mostrar so o que pede atencao: falha, sobra varrida, pasta preservada.

### Negative
- Uma criacao ou limpeza que da certo nao deixa rastro no log. Para investigar, existe o
  `MGR_KEEP_TMP=1`.
- O guia de review nao registra a excecao. Ela vive neste ADR e no cabecalho do modulo.

### Risks and Mitigations
- **Risk:** uma limpeza que falha em silencio, sem log. — **Mitigation:** o aviso de falha continua, e
  o `check-tmp` falha nomeando a sobra. — **proved by:** em `test/tmp.test.js`, os testes do aviso
  (limpeza do `exit`, varredura e base ilegivel), que ficam vermelhos com o aviso removido (mutantes
  N8, N9 e N15 do log da fatia); e a mutacao manual (b) da spec, em que o `npm test` sai 1 nomeando
  a sobra plantada.
- **Risk:** um review futuro reprovar o modulo pela `LOG-1` sem saber da excecao. — **Mitigation:**
  o cabecalho do modulo cita este ADR. — **proved by:** [NOT VERIFIED]. O review final da fatia foi
  avisado do ADR no proprio pedido, entao nao vale como prova.
