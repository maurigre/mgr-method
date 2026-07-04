---
name: spec-create
description: Implementa o fluxo SDD completo para EVOLUIR um projeto já inicializado pelo spec-init - recebe um brief de feature, bugfix ou refactor, gera PRD, spec técnica e plano de tasks com checkpoints humanos bloqueantes, e após aprovação delega a implementação à skill spec-execute, fechando ao final com o completion (sem commit automático). Use sempre que o usuário pedir para adicionar ou implementar uma feature, corrigir bug com SDD, refatorar mantendo comportamento, criar spec e implementar, ou retomar uma feature em andamento. Exige /docs/sdd/ e CONSTITUTION.md existentes.
---

# spec-create — Evolução do projeto via SDD

Você conduz uma mudança do brief à entrega em 6 fases com checkpoints bloqueantes,
gravando artefatos em `/specs/<feature-slug>/` na raiz do projeto.

## Integração mgr-code (obrigatória no início de cada fase)

Sonde o `mgr-mcp`. **ON** → recupere specs/features similares, decisões e padrões já
registrados ("já decidimos isso em X"); ao concluir fases, grave PRD/spec/decisões na
memória. **OFF** → alerte visivelmente (modo degradado, sem memória de longo prazo) e
prossiga só com os artefatos em disco. Nunca silencie; nunca trave por causa disso.

## Dependências (verificação obrigatória ao iniciar)

Verifique `/docs/sdd/CONSTITUTION.md` e ao menos um arquivo em `/docs/sdd/` (o script
`.mgr-core/shared/scripts/sdd-check.sh` faz isso). Se ausentes, INTERROMPA:
"Este projeto não foi inicializado para SDD. Execute primeiro a skill `spec-init`."
NUNCA infira constitution ou SDD em tempo de execução — a constituição é fruto de
análise profunda + revisão humana, não improviso.

## Interação inicial (obrigatória)

1. **Tipo de mudança:** feature nova · modificação de comportamento · bugfix ·
   refatoração (sem mudança de comportamento) · breaking change.
2. **Brief:** descrição em linguagem natural (registrada LITERAL em `01-brief.md`).
3. **Constituição:** mostrar os princípios da CONSTITUTION.md relevantes ao brief e
   perguntar: "Estes se aplicam? Algum override necessário?"

Slug da feature: kebab-case do brief, sem acentos, ≤ 50 chars — confirmar com o usuário.

## Estrutura de artefatos

```
/specs/<feature-slug>/
├── 01-brief.md       # o que foi pedido (literal)
├── 02-prd.md         # Product Requirements (gerado, revisado)
├── 03-spec.md        # spec técnica (gerado, revisado)
├── 04-plan.md        # plano de tasks (gerado, revisado, aprovado)
├── 05-execution.md   # log da execução (tempo real)
└── 06-completion.md  # resumo final + diff da SDD atualizada
```
(Templates em `templates/` desta skill.)

## Fluxo — 6 fases com checkpoints

### Fase 1 — Contextualização (sem interação)
**1a. Retomada:** se existe `/specs/<slug>/.handoff.md`, carregar APENAS o estado salvo
(tiers S/A/B + decisões), pular fases já aprovadas e tasks concluídas, e avisar:
"Retomando <slug> a partir da task <id>." Caso contrário, carga normal:
CONSTITUTION → 01-architecture → 02-domain → 03-contracts → 08-glossary → inventário de
skills disponíveis (built-in + customizadas em `.claude/skills/` e `~/.claude/skills/`;
para cada uma, ler o SKILL.md e anotar quando seria útil). Salvar em
`/specs/<slug>/.context.json` (gitignored).

### Fase 2 — PRD (`02-prd.md`)
Contexto e motivação · objetivo · casos de uso (atores + fluxo) · regras de negócio ·
restrições · fora de escopo (explícito) · métricas de sucesso · stakeholders.
Regra crítica: PRD só tem o "o quê/por quê" — ZERO decisão técnica.
**CHECKPOINT 1 (bloqueante):** aprovar / ajustar / abortar.

### Fase 3 — Spec técnica (`03-spec.md`)
Visão da solução · decisões e trade-offs · mudanças no domínio (schema) · banco (DDL) ·
contratos (request/response completos) · eventos · integrações · configuração · impacto
em testes · critérios de aceitação testáveis. Toda decisão técnica DEVE respeitar a
constituição OU declarar override justificado, citar o padrão do projeto que segue, e
indicar breaking change.

**Detecção de mudança arquitetural (obrigatória):** se a spec introduz novo estilo de
comunicação, nova tecnologia de persistência/mensageria, novo padrão de camadas, quebra
de contrato público, ou dependência externa nova → proponha ADR e invoque `adr-create`
em modo invocado, passando context/decision/alternatives/consequences pré-preenchidos da
spec. O ADR referencia a spec e o `06-completion.md` referencia o ADR de volta.
**CHECKPOINT 2 (bloqueante):** aprovar / ajustar / abortar.

### Fase 4 — Plano (`04-plan.md`)
Tasks organizadas por **prioridade P0 (bloqueante) / P1 (core) / P2 (complementar)** —
NUNCA por camadas arquiteturais fixas. A ordem dentro de cada prioridade vem do **DAG de
dependências**: toda task declara `depends_on` explícito.
**Granularidade:** task ≤ 30 min (alvo), ≤ 60 min (duro), ≤ 3 arquivos; maior que isso,
quebrar ANTES do checkpoint. Cada task lista: objetivo, arquivos, dependências, skill
auxiliar sugerida (`junit-clean` para tasks de teste Java, `code-analyzer` para review),
e critério de done.
**CHECKPOINT 3 (bloqueante):** aprovar plano / ajustar / abortar.

### Fase 5 — Execução (delegada à skill `spec-execute`)
Com o plano aprovado, invoque a skill `spec-execute` informando o slug. Ela carrega os
tiers do disco (constituição, brief, spec, tasks pendentes), executa o DAG P0→P1→P2 com
as premissas de desenvolvimento (segurança, performance, recursos, clareza — vocabulário,
não checklist), registra `05-execution.md`, aplica os checkpoints por bloco de prioridade
e o controle de contexto/hand-off. **Nunca commitar** — `git commit` é do humano.
Retomada de execução interrompida: acionar `spec-execute` direto, sem repassar pelo
planejamento.

### Fase 6 — Completion (`06-completion.md`)
Resumo do que mudou · testes (verdes?) · atualização INCREMENTAL da `/docs/sdd/` (diff)
· links para ADRs criados · pendências. **Review final:** sugira rodar o `code-analyzer`
sobre os arquivos tocados antes do commit humano.

## Controle ativo de contexto (Lei do fluxo — NUNCA compactar)
(Durante a Fase 5, o controle detalhado — arquivamento a 75%, hand-off, anti-
compactação — é conduzido pelo `spec-execute`; as regras abaixo valem também no
planejamento.)


Classifique tudo que entra no contexto em tiers:
- **S** (sagrado): CONSTITUTION + brief — nunca sai.
- **A**: PRD + spec aprovados. **B**: tasks pendentes do plano.
- **C**: arquivos de código da task ATUAL. **D**: decisões tomadas (resumo estruturado).
- **E**: tasks concluídas (detalhes). **F**: logs/output bruto.

Ao atingir **75% da janela**: arquivar E→`05-execution.md` (bloco estruturado por task:
o que foi feito, arquivos, decisões) e F→`.specs-cache/<feature>/logs/`, substituindo no
contexto por referência curta ("Tasks P0.1–P1.1 concluídas — detalhes em 05-execution").
Validar que S/A/B seguem intactos.

**Hand-off de sessão** (se ainda >75% ou ~95% do limite duro): gerar
`/specs/<slug>/.handoff.md` com estado (feito/faltando), tasks pendentes, decisões,
arquivos modificados não-commitados, próxima task e instruções de retomada; encerrar a
sessão. Na retomada, carregar só S/A/B(pendentes)/D — nunca E/F arquivados.

**Anti-compactação (regra dura):** NUNCA pedir "resuma a conversa", NUNCA aceitar
compactação automática da ferramenta, NUNCA trocar contexto estruturado por prosa.
SEMPRE arquivar fatos brutos em arquivos e manter referência cruzada.

Estimativa de tamanho: 1 caractere ≈ 0,25 token + 20% de buffer; se a ferramenta expõe
contagem real, use-a. Imprecisão é aceitável — o threshold de 75% tem margem.

## Regras de comportamento

1. **Constitution é lei.** Violação exige override explícito documentado.
2. **Checkpoints são bloqueantes.** Nunca pular; aguardar resposta é obrigatório.
3. **Segurança primeiro** em toda task: validação de input, authn/authz, erro sem vazar
   info, sanitização contra injection, secrets nunca hardcoded.
4. **Boas práticas como default:** SOLID, DRY sem exagero, null safety, imutabilidade
   onde fizer sentido, error handling consistente.
5. **Patterns por necessidade** — cada uso justificado pelo problema concreto.
6. **Skills customizadas têm prioridade** quando cobrem a task.
7. **Não commitar nunca.**
8. **Falha cedo:** ambiguidade no brief → perguntar antes do PRD; buraco no PRD →
   perguntar antes da spec. Perguntar custa menos que refazer.
9. **Não inventar:** não-derivável da spec/código → `[A DEFINIR]` + pergunta no checkpoint.
10. **Idioma** da CONSTITUTION/SDD existentes.
11. **Prioridades + DAG, nunca camadas fixas.**
12. **Granularidade obrigatória** (≤30/60 min, ≤3 arquivos).
13. **Controle ativo de contexto, nunca compactação** (seção acima).
