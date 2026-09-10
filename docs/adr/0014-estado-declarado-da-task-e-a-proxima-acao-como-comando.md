# ADR-0014: Estado declarado da task e a próxima ação como comando

Date: 2026-09-10
Deciders: Mauri Reis

## Status

Accepted

## Context

A fatia 1 do runtime (ADR-0012) tornou o **plano** verificável, com marcador de formato e chaves
em inglês; a fatia 2 (ADR-0013) fez o mesmo com a spec. O que existe hoje **descreve** o plano —
ninguém consegue perguntar a ele **o que fazer agora**.

O documento de origem do programa de hardening argumenta que devolver **ação** em vez de **estado**
transfere carga de inferência para determinismo, e que é isso que o OpenSpec não faz: ele devolve
status e deixa o agente inferir, e inferência é onde o agente erra.

Antes de projetar o comando, a pergunta "de onde ele tira o que já foi feito" foi **medida** em
disco em 2026-09-10, e a medição contradisse a suposição de que esta seria a metade barata do
trabalho. Não existe nenhuma fonte mecânica de conclusão de task:

| | resultado |
|---|---|
| Campo de estado no formato de plano | **não existe** — o parser conhece seis chaves, nenhuma é estado |
| Planos que marcam conclusão por checkbox | **0 de 11** |
| Planos que declaram o formato parseável | **2 de 11** |
| Onde o progresso vive | `05-execution.md`, em **prosa** |

O log de execução tem uma convenção viva **parcial** — 10 dos 11 usam cabeçalho com id de task —,
mas ela não fecha com o plano em nenhuma feature: os cabeçalhos vão de **1 a 24** contra planos de
**9 a 31** tasks, porque a execução agrupa blocos e omite tasks triviais. Derivar conclusão dali
seria inventar estado.

Uma segunda medição decidiu a questão do versionamento do formato: o parser faz
`if (!KNOWN_FIELDS.has(chave)) continue;` — **chave desconhecida já é ignorada em silêncio** — e
nenhum dos 11 planos usa `status`.

**Reference:** Spec técnica em specs/mgr-spec-next/03-spec.md.

## Decision

1. **O plano ganha um campo opcional `status`, como extensão aditiva do `mgr-plan-format: 1`,
   sem versão 2 do marcador.** A medição mostra que acrescentar a chave não muda o parse nem os
   achados de nenhum plano existente.

2. **O vocabulário é fechado em dois valores, `todo` e `done`, em inglês**, porque o valor aqui é
   identidade e não prosa — a mesma regra que o ADR-0012 aplicou às chaves e o ADR-0003 aos IDs.
   Ausência do campo equivale a `todo`.

3. **Valor fora do vocabulário nunca conta como `done`**, falhando para o lado seguro: no máximo a
   ferramenta reoferece uma task já feita, jamais pula uma que falta.

4. **`mgr spec next [<slug>] [--json]`**, subcomando novo ao lado do `validate`, define "próxima"
   mecanicamente: a primeira task na ordem `P0 → P1 → P2` e, dentro da prioridade, na ordem do
   arquivo, cujo `status` não é `done` e cujos ids em `depends_on` existem no plano e estão todos
   `done`. A prioridade vem do **ID**, não do campo `priority`, como a `PLAN-5` já faz, para não
   haver duas fontes.

5. **Dependência apontando para id inexistente não é tratada como satisfeita:** torna a task não
   pronta, e a resposta manda rodar o `mgr spec validate`, que já reprova isso com `PLAN-1`.

6. **Toda resposta declara em quantas tasks o estado está declarado.** Num plano sem nenhum
   `status` — que hoje são todos os 11 — a resposta diz que não sabe o que já foi feito e que
   devolve a primeira task pronta para começar.

7. **Nova regra `PLAN-6`, aviso**, para `status` com valor fora do vocabulário.

8. **Sem `--all`:** a pergunta "o que faço agora" é sobre **uma** feature.

## Alternatives Considered

- **Versão 2 do marcador de plano:** rejeitada pela medição — a mudança é estritamente aditiva,
  versão existe para distinguir formatos incompatíveis, e bumpar obrigaria os dois planos que já
  declaram a versão 1 a escolher entre migrar ou ficar para trás, em troca de nada.
- **Derivar conclusão dos cabeçalhos `### <id>` do `05-execution.md`:** rejeitada pela medição do
  desencontro — 1 a 24 cabeçalhos contra planos de 9 a 31 tasks. Inferir dali seria inventar
  estado, o que a L1.9 proíbe.
- **Incluir `blocked` no vocabulário:** rejeitada porque bloqueio já é mecânico e já está declarado
  em `depends_on`; um segundo lugar dizendo a mesma coisa é a duplicação que a QUAL-6 proíbe, e as
  duas fontes divergiriam.
- **Incluir `doing`:** rejeitada por YAGNI — para a pergunta "o que faço agora", uma task em
  andamento **é** a próxima, e um estado a mais convidaria a uma máquina de estados que ninguém
  pediu.
- **Checkbox `- [x]` no cabeçalho da task, em vez de campo:** rejeitada porque a identidade
  parseável do formato são as **chaves** dos campos (ADR-0012), e o checkbox voltaria a misturar
  identidade com apresentação do markdown.
- **Valores no idioma do usuário:** rejeitada pelo ADR-0003 e pelo ADR-0012 — `status: concluído`
  não pode funcionar pela mesma razão que `depends_on` não virou `depende_de`.

## Consequences

### Positive

- Fica possível perguntar ao plano o que fazer agora, com o artefato exato que a L4.3 exige e a
  skill auxiliar, em vez de reler o plano e inferir.
- O campo é opcional e ausente em 100% dos planos existentes: nada é reprovado e ninguém precisa
  migrar.
- A conclusão de task deixa de viver só em prosa, e passa a ter um lugar com identidade estável.

### Negative

- Enquanto o template e a `spec-execute` não adotarem o campo, ele nasce morto e toda resposta
  imprimirá "estado declarado em 0 de N".
- A ferramenta passa a conviver com plano com e sem estado, e a resposta precisa dizer qual dos
  dois está lendo.
- A `PLAN-6` é aviso e não reprova ninguém, mas em `--strict` ela bloqueia — o que é intencional.

### Risks and Mitigations

- **Risco:** afirmar progresso sem fonte. — **Mitigação:** toda resposta declara a base do que
  afirma, e valor inválido nunca conta como concluído. Sem isso, devolver `P0.1` para sempre seria
  lido como "esta é a próxima", quando o correto é "esta é a primeira que pode começar, e eu não
  sei o que você já fez".
- **Risco:** desfazer o que os ADR-0010, 0011, 0012 e 0013 entregaram. — **Mitigação:** linha de
  base de não-regressão capturada antes da primeira linha de código, com artefatos, checksums,
  sondas de comportamento, a suíte nos dois locales e o achado **item a item** dos 11 planos e 11
  specs — porque esta feature toca o parser que todos eles atravessam.
- **Risco:** o campo nascer morto. — **Mitigação:** adoção no template `04-plan.md` e na
  `spec-execute`, sem a qual a feature entrega comando sem dado.
- **Revisit trigger:** reavaliar o vocabulário se aparecer necessidade **medida** de um terceiro
  valor. A rejeição de `blocked` e `doing` é por ausência de evidência hoje, não por princípio.
