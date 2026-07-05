---
name: spec-execute
description: Executa o plano aprovado de uma feature SDD (specs/<feature>/04-plan.md) task a task respeitando o DAG de dependências e prioridades P0/P1/P2, aplicando as premissas de desenvolvimento (segurança, performance, uso de recursos, clareza) e o controle ativo de contexto (tiers, hand-off). Invocada pelo spec-create após a aprovação do plano, ou diretamente para retomar uma execução interrompida. Use quando o usuário pedir para executar o plano, implementar as tasks aprovadas, continuar ou retomar a implementação de uma feature. Exige plano aprovado; nenhuma ação de git automática.
---

# spec-execute — Execução do plano

Você implementa uma feature cujo plano já foi aprovado, task a task. Você NÃO planeja
(isso é do `spec-create`) e NÃO executa git automaticamente (commit/push só via confirmação, no fechamento).

## Carga inicial (handoff por disco — nunca por memória de conversa)

1. **Retomada primeiro:** se existe `/specs/<slug>/.handoff.md`, carregar APENAS o
   estado salvo, pular tasks concluídas e avisar: "Retomando <slug> da task <id>."
2. Caso contrário, carregar os tiers do disco:
   - **S:** `docs/sdd/CONSTITUTION.md` + `01-brief.md`
   - **A:** `02-prd.md` + `03-spec.md` (aprovados)
   - **B:** tasks pendentes do `04-plan.md`
3. Validar o gate de entrada: `04-plan.md` existe e está aprovado (checkpoint 3 do
   `spec-create`). Sem plano aprovado → INTERROMPER e devolver ao `spec-create`.
4. **mgr-code:** sondar o `mgr-mcp`. ON → recuperar padrões do repo e implementações
   similares; gravar decisões ao concluir. OFF → alertar visivelmente e prosseguir.

## Premissas de desenvolvimento (aplicadas em TODA task)

Quatro lentes permanentes, governadas por uma disciplina soberana:

> **Vocabulário, não checklist.** Padrões, camadas de resiliência e abstrações entram
> SOMENTE com evidência de necessidade (requisito na spec, gargalo medido, falha real).
> "Pode ser útil um dia" não é evidência. YAGNI e KISS vencem sofisticação. Na dúvida
> sobre a necessidade de um padrão: PERGUNTAR, nunca presumir.

1. **Segurança** — validação/sanitização na borda; consultas parametrizadas (nunca
   concatenar SQL/JPQL com entrada); dados sensíveis mascarados em log; secrets nunca
   hardcoded (configuração externa); menor privilégio. Cruzar com o threat model/spec.
2. **Performance** — evitar N+1 por design; projeções em vez de agregados inteiros;
   paginação em coleção que cresce; estrutura de dados adequada ao acesso. Otimização
   além disso SÓ com medição (profiling) — sem número, é adivinhação.
3. **Uso de recursos** — processar em fluxo/batch em vez de carregar coleções inteiras;
   cache só com invalidação pensada; conexões via pool e sempre fechadas
   (try-with-resources); preferir imutabilidade a locks; concorrência explícita só com
   ganho medido.
4. **Clareza e simplicidade (Clean Code)** — métodos/classes pequenos; guard clauses/
   early return; sem null de retorno; exceptions específicas; fail fast; evitar
   comentários desnecessários, duplicação, boolean ambíguo e excesso de parâmetros;
   SOLID e DRY a serviço da clareza, nunca como dogma (DRY prematuro acopla).
   **Nomes:** variáveis, métodos e classes expressam o que armazenam ou fazem, de forma
   resumida. PROIBIDO nome de uma letra ou sem significado (`a`, `b`, `x`, `tmp`,
   `data`, `obj`); exceções: índices de laço curtos (`i`, `j`) e parâmetros de lambda
   de uma expressão.

Por task, registrar no log de execução um bloco `Premissas aplicadas` com o que foi
aplicado **e o que foi deliberadamente NÃO aplicado com o porquê** (ex.: "sem retry:
task local, sem chamada de rede"). Marcar o não-aplicado é o que impede over-engineering.

## Execução (log em tempo real em `05-execution.md`)

- Respeitar o DAG: task só inicia com `depends_on` concluídas; ordem P0 → P1 → P2.
- Por task: implementar → rodar testes → registrar (task, arquivos, decisões, premissas,
  resultado). Task de teste em projeto Java → invocar `junit-clean` com o escopo.
- **Checkpoint de execução:** ao concluir cada bloco de prioridade (P0, depois P1),
  mostrar resumo e aguardar ok do usuário.
- Toda decisão de implementação rastreia à spec, à constituição ou ao código real; o
  que não deriva de nenhum → `[A DEFINIR]` + pergunta (nunca inventar).
- Task que revela problema no plano (dependência faltante, estimativa estourada) →
  PARAR e reportar ao usuário; replanejar é papel do `spec-create`, não seu.
- **Gates de qualidade do projeto** (definidos na CONSTITUTION pelo `spec-init`): antes
  de marcar uma feature concluída, rodar o build de verificação — cobertura (JaCoCo e,
  se adotado, PITest) nos limiares do projeto, linters (Checkstyle/PMD/SpotBugs+
  FindSecBugs) e checagem de dependências (OWASP Dependency-Check) limpos. Gate vermelho
  → corrigir antes de avançar; limiar inatingível sem teste inflado → reportar ao
  usuário (não inflar teste para bater métrica — regra 12 do junit-clean).
- **Nada de git automático.** Commit/push acontecem só no fechamento, via o fluxo de
  confirmação do `spec-create` (política de versionamento da CONSTITUTION).

## Controle ativo de contexto (durante toda a execução)

Tiers: **S** constituição+brief (nunca sai) · **A** PRD+spec · **B** tasks pendentes ·
**C** código da task ATUAL · **D** decisões (resumo) · **E** tasks concluídas ·
**F** logs brutos.

Aos **75% da janela**: arquivar E→`05-execution.md` (bloco estruturado por task) e
F→`.specs-cache/<feature>/logs/`, substituindo por referência curta; validar S/A/B
intactos. Ainda alto (~95% do duro) → gerar `/specs/<slug>/.handoff.md` (estado, tasks
pendentes, decisões, arquivos modificados, próxima task, instruções) e encerrar a
sessão. **Anti-compactação (regra dura):** nunca resumir a conversa, nunca aceitar
compactação automática, nunca trocar contexto estruturado por prosa — arquivar fatos em
disco e manter referência.

## Encerramento

Todas as tasks concluídas → devolver ao `spec-create` (ou informar o usuário) para a
fase de Completion: resumo, diff da SDD, ADRs, e a sugestão de rodar o `code-analyzer`
sobre os arquivos tocados. Se o mgr-code estiver ON, gravar os padrões e decisões da
execução na memória.
