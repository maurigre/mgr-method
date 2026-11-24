# ADR-0037: O modo `auto` de detecção é retirado, e não mais adiado

Date: 2026-11-24
Deciders: Mauri Reis

## Status

Proposed

## Context

O ADR-0009, decisão 4, deixou o modo de detecção em `manual` e `suggest` (padrão) e decidiu: *"O
modo `auto` fica adiado até existir `mgr audit`, e é recusado com erro explícito enquanto isso —
tratá-lo em silêncio como `suggest` seria mentir sobre a política de segurança que o usuário
configurou."* Outros registros anunciavam o mesmo caminho:

- o ADR-0005 ("o modo `auto` de D03 chega na Fase 2 com o `mgr audit`");
- as entregas da Fase 2 do ADR-0007 ("modos `manual|suggest|auto`");
- a consequência negativa do ADR-0007 ("automação plena só com o modelo `auto` + audit da Fase 2").

Na decisão D03 do kickoff original, o `auto` "baixa sem perguntar, mas SOMENTE de registries
marcados como `trusted`, com skill assinada/checksum válido".

O `mgr audit` existe desde o PR #23 (ADR-0021), mas não atesta segurança:

- o módulo diz *"Devolve achados com linha e trecho, nunca veredito: ausência de achado não atesta
  segurança"* (`src/plugins/audit.js:3`);
- o comando imprime *"No finding is NOT a security attestation: the analysis has false positives and
  negatives."*;
- o ADR-0007 vetou *"prometer 'scanner que garante segurança'"*, exigiu *"confirmação humana
  obrigatória em todo `mgr add`, sem flag de bypass"*, e a Camada 4 dele põe o humano como proteção
  final para skills fora do registry oficial.

A condição de saída do ADR-0009 se cumpriu na letra, mas não sustenta o que pressupunha.

Dois defeitos acompanham isso:

- **A mensagem da recusa é falsa:** diz que o `mgr audit` "is not implemented".
- **A citação é velha:** o ADR-0009 apoia o "sem bypass" na "CONSTITUTION §6" (Context e decisão
  4). Na constituição atual, a §6 é "Publicação", e nenhuma seção trata de confirmação humana na
  instalação. A busca em `docs/`, `src/`, `skills/`, `shared/`, `agents/` e nos READMEs só achou
  essa citação nessas duas passagens do ADR-0009 (2026-11-24).

O kickoff v2 (ADR-0036), na decisão K09, retira o `auto` por ADR.

**Reference:** Technical spec at specs/revisao-do-kickoff-e-auto/03-spec.md.

## Decision

1. **O modo `auto` é retirado.** O vocabulário de `detectionMode` é `manual` e `suggest`, e o padrão
   é `suggest`.
2. **A recusa continua explícita**, antes de qualquer escrita, com a chave própria
   `detectionModeAutoUnavailable` e o mesmo código de saída (1). O `auto` nunca é tratado em
   silêncio como `suggest` nem como `manual`.
3. **Base vigente da confirmação humana:** a Camada 4 do ADR-0007 (checkpoint humano) e o princípio
   do kickoff original, *"Blocking human checkpoints antes de geração de código e antes de qualquer
   instalação automática"*.
4. **Emenda ao ADR-0009.**
   - Na decisão 4, "fica adiado até existir `mgr audit`" passa a "está retirado". O resto da
     decisão 4 continua valendo, e as demais decisões do ADR-0009 também.
   - A "CONSTITUTION §6" citada no Context e na decisão 4 é numeração que não vale mais. A base é a
     do item 3.
   - O ADR-0009 muda só a linha de Status, que aponta para este ADR (mesmo padrão do ADR-0004
     emendado pelo ADR-0010). Enquanto este ADR estiver `Proposed`, a linha diz "emenda proposta no
     ADR-0037"; no PR que o aceitar, passa a "emendadas pelo ADR-0037" com a data.
5. **As passagens do ADR-0005 e do ADR-0007 que anunciavam o `auto` com o audit ficam encerradas
   por esta decisão.** Os dois ADRs não são editados. O modelo de quatro camadas do ADR-0007
   continua inteiro.
6. **A mensagem da recusa dá o motivo real e o caminho:** instalar uma skill sempre exige
   confirmação humana; o `mgr audit` aponta achados, mas não atesta segurança, então não substitui
   essa confirmação; use `suggest` (o padrão) ou `manual`. Ela nunca diz que um comando existente
   "não está implementado" e nunca promete segurança.
7. **Gatilho de revisão.** A retirada só é reavaliada quando valerem **as duas** condições:
   - (a) existir verificação de **procedência** da skill (assinatura verificável) **e** uma
     auditoria que dê **veredito**, não só achados;
   - (b) existir um ecossistema real de skills de terceiros em uso.

   Sem (a), não há base para dispensar o humano. Sem (b), seria YAGNI. Com as duas, o que se abre é
   um ADR novo, não a implementação. O precedente é a assinatura GPG, adiada pelo kickoff original
   "até existir ecossistema real de terceiros", com gatilho de revisão no ADR de segurança.

## Alternatives Considered

- **Implementar o `auto` agora, sobre o `mgr audit`:** o audit devolve achados, não veredito, e o
  próprio comando diz que ausência de achado não é atestado. Instalar sem humano com base nele seria
  o "scanner que garante segurança" que o ADR-0007 vetou. Rejeitada.
- **Manter o `auto` "adiado", com nova condição de saída:** um adiamento atrelado a um artefato
  convida a implementar quando o artefato existir. Foi o que aconteceu com o `mgr audit`. A decisão
  K09 é retirar, com gatilho explícito. Rejeitada.
- **Tratar `auto` em silêncio como `suggest`:** o ADR-0009 já rejeitou, por mentir sobre a política
  que o usuário configurou.
- **Recusar `auto` com a mensagem genérica de valor inválido:** ela só diz que o valor é inválido,
  não por quê. A recusa precisa dar o motivo. Rejeitada.
- **Emendar dentro do próprio ADR-0009, como a emenda de 2026-09-26 do ADR-0007:** aquela emenda se
  justificou porque *"nenhuma decisão muda de direção"*. Aqui muda: de "adiado" para "retirado". Um
  ADR aceito não é editado; muda só o Status. Rejeitada.
- **Adotar agora a assinatura GPG como procedência:** o kickoff original a adiou até existir
  ecossistema real de terceiros, que é a condição (b) do gatilho. Rejeitada pelo mesmo motivo.

## Consequences

### Positive

- A recusa diz a verdade e indica como seguir.
- O estado do `auto` fica explícito e citável: retirado, com base vigente e gatilho.
- A citação da constituição com numeração velha deixa de sustentar a decisão.

### Negative

- Não há caminho planejado para instalar sem confirmação humana. A "automação plena" que o ADR-0007
  previa com `auto` + audit deixa de ter rota. Sem terminal, o `suggest` imprime o que achou e não
  instala, e o `mgr add` exige terminal.
- Muda o texto da recusa. Automação que casava "not available yet" deixa de casar; o código de
  saída é o mesmo.

### Risks and Mitigations

- **Risk:** o `auto` ser reimplementado porque o audit evoluiu. — **Mitigation:** o gatilho exige as
  duas condições juntas e um ADR novo (decisão 7). — **proved by:** [NOT VERIFIED]; é regra de
  processo, sem checagem mecânica.
- **Risk:** a mensagem voltar a uma afirmação falsa. — **Mitigation:** os testes de
  `test/plugins/registry.test.js`, `test/core/ui-text-layer.test.js` e
  `test/e2e/output-language.test.js` afirmam o motivo nos dois idiomas e a ausência de "not
  implemented". — **proved by:** mutação da fatia (`CA-11`, em `05-execution.md`): com o texto `en`
  antigo, `registry.test.js` e `ui-text-layer.test.js` ficam vermelhos; com o texto `pt-BR` antigo, o
  caso `pt-BR` de `output-language.test.js` fica vermelho.
