# ADR-0015: Estado de artefato resolvido, e skills que perguntam em vez de assumir caminho

Date: 2026-09-11
Deciders: Mauri Reis

## Status

Accepted

## Context

A Fase 2 do programa entregou o `mgr spec validate` (plano pelo ADR-0012, spec pelo ADR-0013) e o
`mgr spec next` (ADR-0014). Falta o `mgr spec status`, e o documento de origem lhe dá uma motivação
mais forte do que mostrar estado a um humano:

> As skills do MGR carregam artefatos por **caminho assumido** (`/specs/<slug>/03-spec.md`).
> Suposição de estrutura é uma classe inteira de alucinação, e o OpenSpec a eliminou.

Medido em disco em 2026-09-10: as duas skills do fluxo citam caminho literal em **oito lugares** —
seis em `spec-create` e dois em `spec-execute`, incluindo `/specs/<slug>/.handoff.md` e
`/specs/<slug>/.context.json`.

Três medições governaram o desenho, todas feitas antes de qualquer código.

**Primeira — existência de artefato é quase constante.** As 12 features em `specs/` têm **todas**
os cinco arquivos de `01-brief` a `05-execution`. Só variam `06-completion.md` (9 de 12),
`.handoff.md` (4 de 12), `risk-closure.md` (4) e `regression-baseline.json` (3). Um comando que
reportasse apenas existência responderia "tem tudo" para 11 das 12.

**Segunda, e é a que governa — os quatro handoffs em disco estão obsoletos.** Todos os quatro
pertencem a features que têm `06-completion.md` escrito. São restos que ninguém apagou, e dizer
"handoff pendente" seria falso em **4 de 4** casos.

**Terceira — o payload proposto pede um campo sem fonte.** O documento de origem inclui `approved`
e `checkpoint` por artefato, e a aprovação de checkpoint não tem registro mecânico nenhum: ela vive
na conversa. É a mesma forma do buraco que o ADR-0014 encontrou para a conclusão de task, um passo
antes no fluxo. O autor foi consultado e decidiu **não** criar essa fonte de estado agora.

**Reference:** Spec técnica em specs/mgr-spec-status/03-spec.md.

## Decision

1. **O vocabulário de estado por artefato é `present`, `ready` e `blocked`, e não inclui `done`.**
   O documento de origem propõe `done | ready | blocked | missing`, mas `done` afirma conclusão de
   etapa a partir de existência de arquivo — exatamente o que o próprio documento adverte duas
   linhas adiante. Manter a palavra seria entregar o defeito junto com o alerta contra ele.
   `present` é o arquivo existe; `ready` é não existe e todo id do `requires` existe; `blocked` é
   não existe e algum id do `requires` não existe. `missing` sai por redundância.

2. **Seis artefatos canônicos** — `brief`, `prd`, `spec`, `plan`, `execution`, `completion` — com
   ids em inglês e `requires` **declarado como dado** em um lugar só, nunca inferido do nome do
   arquivo. É o que permite ao consumidor parar de conhecer a sequência.

3. **`risk-closure.md` e `regression-baseline.json` ficam fora do modelo canônico.** Existem em 4 e
   3 das 12 features, nasceram de exigência por feature e não de etapa do fluxo, e tratá-los como
   canônicos faria oito features parecerem incompletas.

4. **`approved` e `checkpoint` não entram no payload.** Preencher seria inventar; preencher com
   nulo convidaria o consumidor a ler ausência como negativa. Omitir e **dizer** que se omite é o
   único caminho honesto (L1.9).

5. **A presença de `.handoff.md` é fato do arquivo** — `{exists, path}` — e nunca trabalho
   pendente. A saída humana diz "em disco" e acrescenta que o arquivo não é removido
   automaticamente. Deliberadamente **não** se infere obsolescência cruzando com `completion`:
   seria julgamento disfarçado de dado.

6. **O aviso vai no payload**, com duas chaves de papéis diferentes: `basis: "file-existence"`,
   token estável em inglês para o consumidor programático ramificar sem casar texto traduzido, e
   `warning`, a frase no idioma do usuário para quem lê.

7. **`nextReady` é sobre artefato, não sobre task**, e por isso não duplica o `mgr spec next`:
   aquele responde qual *task* fazer dentro de um plano aprovado, este responde qual *artefato*
   falta escrever. É derivado da mesma tabela do `requires`, sem segunda fonte.

8. **`spec-create` e `spec-execute` passam a obter o caminho consultando `mgr spec status --json`**,
   e o caminho literal de hoje **não é removido**: vira fallback explícito e declarado para quando
   a CLI não estiver instalada.

9. **O comando aceita `--all`**, diferente do `mgr spec next`, porque "o que existe" sobre várias
   features é o caso de quem volta ao repositório depois de semanas.

10. **A descoberta continua única:** `src/artifacts.js` ganha `slugs(repo)`, e não se escreve um
    segundo `readdirSync`.

## Alternatives Considered

- **Adotar o vocabulário `done|ready|blocked|missing` do documento de origem:** rejeitada porque
  `done` afirma conclusão a partir de existência de arquivo, que a L2.4 e o próprio documento
  advertem contra.
- **Incluir `approved` e `checkpoint` no payload, ainda que nulos:** rejeitada porque não há fonte
  mecânica, e nulo seria lido como negativa.
- **Criar agora o registro mecânico de aprovação de checkpoint:** rejeitada pelo autor no
  CHECKPOINT 1, por ser outra feature com risco próprio.
- **Inferir que um handoff é obsoleto cruzando com a existência do `06-completion`:** rejeitada por
  ser julgamento disfarçado de dado — um handoff pode ser legítimo numa feature cujo `06` foi
  escrito cedo.
- **Incluir `risk-closure.md` e `regression-baseline.json` como artefatos canônicos:** rejeitada
  pela medição, 4 e 3 de 12.
- **Entregar só o comando, sem a adoção nas skills:** **recomendada pelo agente** e rejeitada pelo
  autor, que decidiu incluir a adoção nesta feature.
- **Não entregar o grafo de `requires`, só a lista na ordem canônica:** **recomendada pelo agente**
  e rejeitada pelo autor, que aceitou o custo de um contrato maior em troca de o consumidor não
  precisar conhecer a ordem.
- **Remover o caminho literal das skills:** rejeitada porque o método precisa continuar funcionando
  só com as skills instaladas, sem a CLI.

## Consequences

### Positive

- As skills param de assumir estrutura no caminho feliz, que é a classe de alucinação que o
  documento de origem nomeia.
- O consumidor deixa de precisar conhecer a ordem dos artefatos.
- O caminho passa a ser resolvido, nunca montado por convenção.

### Negative

- O contrato fica maior e é mantido para sempre.
- A feature passa a ter **dois eixos de risco no mesmo fechamento**: o comando novo e a mudança do
  caminho feliz de duas skills já entregues.
- A degradação sem CLI instalada vira requisito de primeira classe, não detalhe.
- O comando responderá "tem tudo" para quase todo o acervo. Isso é esperado: a informação útil dele
  não é a existência, é o caminho resolvido e o aviso de que existência não é progresso.

### Risks and Mitigations

- **Risco:** a saída ser lida como progresso. — **Mitigação:** aviso no payload com token estável
  mais frase, vocabulário sem `done`, e omissão declarada de `approved`.
- **Risco:** quebrar o método sem a CLI instalada. — **Mitigação:** fallback declarado nas duas
  skills e critério de aceitação próprio exigindo o método operável sem a CLI.
- **Risco:** desfazer o que os ADR-0010 a 0014 entregaram. — **Mitigação:** linha de base capturada
  antes da primeira linha de código, com o achado **item a item** de todos os artefatos, checksums
  das duas skills antes da mudança, e sondas de comportamento contra install real de dois motores.
- **Revisit trigger:** reavaliar se surgir registro mecânico de aprovação de checkpoint. Nesse dia
  `approved` deixa de ser invenção e passa a ser dado, e o payload pode crescer.
