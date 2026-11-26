# ADR-0039: Revisão externa por subprocesso de CLI de terceiro, com ficha como dado e prova por hash no HEAD

Date: 2026-11-26
Deciders: Mauri Reis

## Status

Proposed

## Context

O revisor interno (`mgr-review`) roda no mesmo motor e no mesmo fornecedor que implementou a fatia. O
K13 do ADR-0036 pede um revisor de outro fornecedor, plugável e conferido mecanicamente. O ADR-0038
traz isso para a 0.7.0 como funcionalidade opt-in. Falta decidir como o MGR chama esse revisor, como
prova que a revisão aconteceu e sobre o quê, e como o archive confere a prova.

Os fatos medidos sobre o primeiro revisor estão no brief e no log da fatia:
- o `codex exec` roda sem conversa, em modo só leitura, obriga a resposta a seguir um JSON Schema e
  emite um fluxo de eventos com o id da sessão (`thread.started`, `thread_id`);
- o modo de review do `codex` não tem saída em formato fixo.

**Reference:** Technical spec at specs/revisor-externo/03-spec.md.

## Decision

- **Ficha como dado.** Cada revisor é uma ficha em `src/reviewers/`. Ela diz como chamá-lo sem conversa
  e só leitura, como extrair a versão e a sessão e como conferir se está instalado e logado. A
  primeira ficha é a do `codex`.
- **Subprocesso na borda.** `bin/review-io.js` roda o revisor e o `git` com `spawnSync`, argv separado
  e `shell: false`. Nenhum arquivo de `src/` usa `child_process`.
- **Decisão no núcleo.** `src/sdd/review-run.js` decide e persiste (gate R1, INV-5). A cola só traduz
  códigos em mensagens, escreve o log e devolve o exit.
- **Ativação no time, consentimento na pessoa.** A ativação fica em `.mgr-core/config.json` e o
  consentimento em `.mgr-core/config.local.json`. Ligar, consentir e dispensar exigem confirmação em
  terminal, sem flag de bypass (ADR-0007, Camada 4).
- **A prova** é `specs/<fatia>/external-review.json`. Ela traz a lista de arquivos revisados e o sha256
  do conteúdo de cada um, **lido antes da chamada e fixado no commit do HEAD**. Depois da chamada, o
  HEAD e a árvore são conferidos; se mudaram, nada é gravado.
- **Citação obrigatória.** Um achado só bloqueia com citação literal de regra do guia ou de linha da
  spec, conferida no texto. O que não confere vira sugestão.
- **A 4ª condição no archive** vale só com a funcionalidade ligada: os arquivos da última revisão têm
  de estar iguais no HEAD de agora.
- **A dispensa** é só humana, com motivo e iniciais, e só depois de uma falha do revisor registrada.
- **A suíte nunca alcança o revisor real.** Ela é bloqueada por construção: um `codex` que só falha
  fica na frente do PATH, pré-carregado nos scripts `test` e `coverage`.

## Alternatives Considered

- **`codex review`:** rejeitado porque não tem saída em formato fixo (brief, fatos medidos), e sem
  formato fixo não há conferência mecânica.
- **Hash de um patch único:** rejeitado porque, depois do merge, o diff da fatia contra a base fica
  vazio e o hash não provaria nada (PRD, resposta 2).
- **Ativação pessoal:** rejeitada porque a exigência do archive é do time (PRD, resposta 13).
- **Flag para pular a confirmação:** rejeitada pelo ADR-0007, Camada 4.

## Consequences

### Positive
- Outro fornecedor revisa a fatia, e cada achado chega conferido contra uma fonte citável.
- Plugar outro revisor é escrever uma ficha.
- A prova continua válida depois do merge, porque confere conteúdo de arquivo, não um diff.

### Negative
- O código sai da máquina a cada revisão, e cada revisão consome a cota de quem a roda.
- A prova é local e não criptográfica (RN-28): não impede adulteração deliberada nem desligar a
  funcionalidade para escapar da 4ª condição.
- Os limites declarados em `docs/external-review.md`:
  - outra fatia que mude os mesmos arquivos antes do archive vence a prova;
  - duas revisões simultâneas da mesma fatia não são suportadas (decisão do autor, rodada 2);
  - a citação é conferida em qualquer ponto do guia, não só no item da regra (a estreitar na 0.8.0).

### Risks and Mitigations
- **Risk:** a ficha divergir do CLI numa versão nova do `codex`. — **Mitigation:** a prova grava a
  versão que o revisor informa, e o argv é conferido exatamente. — **proved by:**
  `test/reviewers/codex.test.js` e o teste "should send exactly the argv of the reviewer sheet to the fake codex" de
  `test/commands/review.test.js`.
- **Risk:** a prova afirmar conteúdo que o revisor não viu. — **Mitigation:** hashes lidos antes da
  chamada e fixados no commit; conferência de HEAD e árvore depois. — **proved by:**
  `test/commands/review.test.js` ("should record nothing when the working tree changes while the
  reviewer runs") e a mutação registrada no log da fatia.
- **Risk:** um teste enviar código para fora. — **Mitigation:** o bloqueio do `codex` real por
  construção. — **proved by:** `test/arquitetura/sem-codex-real.test.js`, com as mutações registradas
  no log da fatia.
- **Risk:** o archive aceitar uma revisão vencida. — **Mitigation:** a 4ª condição confere os arquivos
  no HEAD. — **proved by:** `test/commands/spec-archive-revisao.test.js` (prova vencida recusada) e a
  mutação "sem conferir HEAD" registrada no log.
