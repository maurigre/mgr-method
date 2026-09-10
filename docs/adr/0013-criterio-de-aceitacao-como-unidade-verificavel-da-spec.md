# ADR-0013: Critério de aceitação identificado como unidade verificável da spec

Date: 2026-08-31
Deciders: Mauri Reis

## Status

Accepted

## Context

A fatia 1 do runtime (ADR-0012) tornou o **plano** verificável. A **spec** continua sendo markdown
livre: uma spec sem critério de aceitação testável tem hoje exatamente a mesma forma de uma spec
boa, e nada no projeto sabe a diferença.

O documento de origem do programa de hardening propõe importar o formato `### Requirement:` com
`#### Scenario:` e `SHALL/WHEN/THEN`. Antes de adotar, a adesão foi **medida** contra as 10 specs
em disco:

| | resultado |
|---|---|
| Specs com seção de critérios de aceitação | **10 de 10** |
| Specs usando `Requirement:` / `Scenario:` / `SHALL` | **0 de 10** |

As specs deste repositório **já convergiram numa estrutura**, e ela não é a proposta. Importar o
formato significaria substituir uma convenção viva e universal por uma que ninguém usa, e obrigar
a reescrever dez specs para satisfazer o validador — o custo que o ADR-0012 já pagou para
descobrir, quando mediu que nenhum cabeçalho do template aparecia em nenhuma spec.

Uma segunda medição mostrou que a convenção viva tem **duas formas**: lista numerada em sete
specs, e checkbox com identidade (`- [ ] **CA-1:** …`) em **três** — `skill-diagnosing-bugs`,
`gates-de-qualidade` e `eixo-spec-code-analyzer`, somando **31 critérios identificados** —
inventada pelo autor sem que nenhuma regra pedisse. É o mesmo padrão que o ADR-0012 encontrou no
`depends_on`: a convenção certa já existia, esperando ser reconhecida em vez de substituída.

> **Correção de medição, 2026-08-31.** A versão original deste parágrafo dizia "numa spec". O
> número certo é três, re-medido com o parser entregue por esta decisão, sobre os mesmos arquivos —
> nenhum deles foi alterado desde julho. Só o fato medido muda: a decisão, as alternativas e as
> consequências abaixo permanecem como aprovadas, e três specs sustentam a rejeição do formato
> importado melhor do que uma.

**Reference:** Spec técnica em specs/mgr-spec-requirements/03-spec.md.

## Decision

1. **A unidade verificável da spec é o critério de aceitação, não um requisito importado.** Ela já
   existe em 10 de 10 specs.

2. **O critério é identificado pelo próprio ID (`CA-<n>`), sem detecção de seção.** O título da
   seção é prosa e varia com o idioma; o ID não. O validador não precisa saber onde na spec o
   critério está — só que existe, tem identidade e não está vazio.

3. **Marcador próprio e separado do plano** (`<!-- mgr-spec-format: 1 -->`): um projeto pode
   declarar o formato de um artefato sem declarar o do outro. Sem marcador, nenhuma regra roda —
   só o aviso.

4. **Cinco regras, todas mecânicas.** Ausência de marcador, nenhum critério no formato declarado,
   ID duplicado, corpo vazio, buraco na numeração.

5. **O validador não julga a qualidade do critério.** "É testável de verdade", "cobrem a spec" e
   "é bom" ficam de fora: são julgamento, e a segunda é o eixo Spec do `code-analyzer`.

6. **A política de bloqueio sobe para o módulo de achados**, porque passa a valer para dois
   artefatos e é propriedade do achado, não do plano.

## Alternatives Considered

- **Importar `Requirement`/`Scenario`/`SHALL` do documento de origem:** rejeitada pela medição —
  0 de 10 specs usam, 10 de 10 usam critérios de aceitação. Adotá-la exigiria reescrever tudo o
  que existe para satisfazer o validador.
- **Detectar a seção de critérios pelo título:** rejeitada — o título é prosa e varia com o
  idioma e com o estilo de numeração; é o erro que o ADR-0012 já mediu e evitou.
- **Verificar se o critério é testável:** rejeitada — é julgamento, não parsing. Prometer isso
  seria a garantia que o ADR-0011 (L1.9) proíbe.
- **Verificar se os critérios cobrem a spec:** rejeitada — é o eixo Spec do `code-analyzer`, e
  duplicá-lo aqui seria a fusão dos dois eixos que a L6.1 proíbe.
- **Um único marcador para plano e spec:** rejeitada — acopla a migração de dois artefatos que
  evoluem em ritmos diferentes.

## Consequences

### Positive

- Uma spec sem critério de aceitação deixa de fechar em silêncio.
- Os critérios ganham identidade citável, que é o que a L1.1 exige de toda reprovação — o
  `code-analyzer` passa a poder citar `CA-3` em vez de descrever de memória.
- Nenhuma das dez specs existentes precisa mudar: sem marcador, só o aviso.
- O comando não muda de nome nem de contrato; passa a cobrir dois artefatos.

### Negative

- Mais um marcador a lembrar para quem escreve spec à mão.
- Convivem duas formas de critério — numerada e com ID — enquanto o legado não migrar.
- A movimentação da política de bloqueio toca código entregue na fatia anterior, ainda que sem
  mudar comportamento.

### Risks and Mitigations

- **Risco:** reprovar spec existente. — **Mitigação:** sem marcador, nenhuma regra roda;
  conferido por teste sobre fixtures das duas formas reais, versionadas — porque `specs/` é
  gitignored e um teste que só lesse os artefatos vivos passaria na máquina do autor e falharia
  em qualquer clone.
- **Risco:** um verde ser lido como "os critérios estão bons". — **Mitigação:** a saída declara
  que a validação é estrutural, nos dois modos.
- **Risco:** a execução desfazer o que os ADR-0010, 0011 e 0012 entregaram. — **Mitigação:** linha
  de base capturada antes da primeira linha de código, **mais forte que a da fatia anterior**:
  além de artefatos e checksums, fixa **propriedades de comportamento** — inclusive a precedência
  de idioma, que foi a regressão que escapou da garantia anterior — e mede a suíte em **duas
  condições de locale**, porque foi o locale que quebrou o integrador da fatia 1.
- **Revisit trigger:** reavaliar se uma segunda versão do formato de spec surgir; o marcador já
  nasce versionado para que a versão dois seja distinguível.
