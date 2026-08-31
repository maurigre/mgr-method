# ADR-0012: Formato parseável do plano e validação de artefato do projeto

Date: 2026-08-31
Deciders: Mauri Reis

## Status

Accepted

## Context

O método verifica hoje **três coisas** sobre os artefatos de um projeto, todas no
`sdd-check.sh`, que tem 13 linhas: que `docs/sdd/` existe, que a `CONSTITUTION.md` existe e que a
pasta não está vazia. O `mgr validate` verifica `SKILL.md` — frontmatter, kebab-case, teto de
linhas —, mas isso é autoria de skill, não artefato de projeto.

Entre os dois não há nada. **Um plano com dependência inexistente, ciclo no DAG ou task sem
critério de done tem exatamente a mesma forma de um plano correto**, e nenhum mecanismo do
projeto sabe a diferença. O ADR-0011 tornou as leis do método **presentes**; ele não as tornou
**verificáveis**.

Antes de propor formato parseável, a adesão ao formato atual foi medida contra as 9 specs em
disco. Nenhum cabeçalho do template `03-spec.md` aparece em nenhuma delas; no `04-plan.md`,
`Depends on:` e `Done when:` aparecem em **zero de nove** planos. A razão não é indisciplina: os
templates estão em inglês canônico (ADR-0003) e os artefatos são escritos no idioma do usuário.

Uma segunda medição mudou o desenho: **três dos nove planos são mistos** — usam `depends_on` em
inglês ao lado de campos em português, e nenhum deles tem `done_when`. Uma regra que inferisse
"formato novo" pela presença de chave em inglês reprovaria esses três **35 vezes**.

**Reference:** Spec técnica em specs/mgr-spec-runtime/03-spec.md.

## Decision

1. **A identidade parseável é o ID da task e a chave do campo em inglês; a prosa fica no idioma
   do usuário.** É a regra que o ADR-0003 já aplica a nomes de arquivo e IDs de regra, estendida
   ao campo. O ID da task (`P\d+\.\d+`) já é independente de idioma por construção.

2. **O formato é declarado por marcador (`<!-- mgr-plan-format: 1 -->`), nunca inferido.** Com
   marcador, todas as regras valem, inclusive as de **presença**. Sem marcador, o plano recebe um
   `PLAN-0` (warning) e as regras de presença não rodam — mas as de **consistência** (dependência
   inexistente, ciclo, granularidade) continuam valendo sobre os campos que existirem. Inferir
   formato é adivinhar; declarar é contrato.

3. **O campo `artifact` faz parte do formato**, porque é a **L4.3** virando verificável: a lei
   manda o Executor reafirmar nome, forma, assinatura e **quantidade** antes de cada task, e o
   campo é onde o plano declara isso.

4. **Namespace `mgr spec <sub>`, separado do `mgr validate`.** São contratos diferentes:
   autoria de skill e artefato do projeto do usuário.

5. **Todo achado é objeto estruturado, e o construtor recusa achado sem remediação e sem
   exemplo.** A estrutura torna a mensagem inútil impossível, em vez de contar com disciplina.

6. **A ferramenta declara o que não verifica.** A saída diz que a validação é estrutural: não
   afirma que o plano está certo, que as tasks são as certas nem que o critério de done é bom.

## Alternatives Considered

- **Cabeçalho em prosa como identidade:** rejeitada pela medição — reprovaria 100% dos artefatos
  existentes, e por diferença de idioma, não por defeito.
- **Inferir o formato pela presença de chaves em inglês:** rejeitada pela medição — três dos nove
  planos são mistos, e a inferência os reprovaria 35 vezes.
- **Tabela de sinônimos por idioma:** rejeitada — não escala e quebra no primeiro usuário que
  escreva num idioma não previsto.
- **Sobrecarregar `mgr validate`:** rejeitada — dois contratos diferentes respondendo ao mesmo
  comando.
- **Frontmatter YAML no plano:** rejeitada — o artefato é lido por humano, e o frontmatter empurra
  a estrutura para longe da task que ela descreve.
- **Verificar julgamento** ("a task é grande demais", "o critério de done é bom", "o plano cumpre
  a spec"): rejeitada — não é decidível por parsing, e a última seria a fusão dos dois eixos que a
  L6.1 proíbe.

## Consequences

### Positive

- Defeito estrutural de plano passa a falhar em voz alta: dependência inexistente, ciclo no DAG,
  granularidade estourada, task sem critério.
- Os planos existentes ganham verificação de consistência **sem migração**, porque as regras que
  não dependem de presença rodam sobre o que já existe.
- O trilho da L4.3 deixa de viver só em prosa e passa a ser um campo que o validador confere.
- A estrutura do achado impede, por construção, a mensagem que não ensina.

### Negative

- Os planos passam a ter chave em inglês e valor no idioma do usuário — um híbrido visual.
- Mais um artefato a manter: o marcador de formato precisa entrar no template e ser lembrado por
  quem escreve plano à mão.
- Convivem no repositório duas formas de saída de validador: o `check-laws.mjs` devolve strings, e
  este devolve objeto estruturado. Dívida declarada, não uniformizada nesta fatia.

### Risks and Mitigations

- **Risco:** a validação reprovar artefato existente e punir o autor por formato antigo. —
  **Mitigação:** marcador explícito; sem ele, nenhuma regra de presença roda. Conferido por teste
  sobre os nove planos em disco.
- **Risco:** um `mgr spec validate` verde ser lido como aprovação do plano. — **Mitigação:** a
  saída declara que a validação é estrutural (L2.4, L1.9).
- **Risco:** a execução desta decisão desfazer o que o ADR-0010 e o ADR-0011 entregaram. —
  **Mitigação:** linha de base de não-regressão capturada **antes da primeira linha de código**
  (`regression-baseline.json`), com testes, contagem de leis, ponteiros, cláusulas sagradas e
  checksums; qualquer item que mude para menos bloqueia o fechamento.
- **Revisit trigger:** reavaliar o marcador de formato se surgir uma segunda versão do formato de
  plano — o campo é `mgr-plan-format: 1` justamente para que a versão dois seja distinguível.
