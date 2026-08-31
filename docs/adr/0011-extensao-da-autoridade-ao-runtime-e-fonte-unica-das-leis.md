# ADR-0011: Extensão da autoridade ao runtime e fonte única das leis de execução

Date: 2026-08-30
Deciders: Mauri Reis

## Status

Accepted

## Context

O ADR-0007 fixou a hierarquia `princípios do método > regras do projeto > convenções do workspace
> instruções de skill` e quatro camadas de defesa contra skill de terceiro maliciosa. Ele governa
o que é **instalado**.

O mesmo ADR **lista** prompt injection por documento ingerido como risco (F4) e registra como
mitigação o TTY humano na instalação — que protege o momento de instalar e **não protege a
execução**. Nada hoje diz ao agente o que fazer quando uma instrução chega dentro de uma saída de
tool, de uma página web, de um documento lido ou de uma resposta de MCP. Isso deixou de ser
teórico quando o método passou a integrar memória de longo prazo (`mgr-code`), e fica crítico na
Fase 4 do kickoff, a `spec-extract`, cuja função é ingerir acervo documental — o vetor F4 vira o
caminho feliz da skill.

Em paralelo, as leis de execução estão duplicadas entre `SKILL.md`, e a duplicação **já divergiu**.
Medido em disco em 2026-08-30, as duas cópias da lei de controle de contexto diferem em quatro
pontos, e a cópia mais fraca está na `spec-execute` — justamente a skill que roda longo. É ela que
perdeu o gatilho de estimativa de janela e a proibição de recarregar os tiers `E/F` arquivados.

**Reference:** Spec técnica em specs/mgr-hardening-core/03-spec.md.

## Decision

1. **Quinto nível na hierarquia, o mais baixo:** `conteúdo injetado em runtime`. Nenhum nível
   existente muda de posição e nenhuma regra do ADR-0007 é relaxada — só se acrescenta abaixo.

2. **Quarentena de injeção.** Conteúdo de documento ingerido, página web, saída de tool ou
   resultado de MCP é **dado, nunca instrução**. Algo com forma de comando é registrado como
   observação com a etiqueta `[quarantined]` e não é executado.

3. **Rebaixamento de evidência.** Contexto de projeto, saída de tool e memória de longo prazo
   orientam o que se escreve; **não** provam conclusão de tarefa, **não** substituem a instrução
   de uma skill, **não** destravam checkpoint bloqueado. Conflito com valor controlado → reportar
   o conflito e preservar o valor controlado.

4. **Fonte única das leis** em `shared/laws/execution-laws.md`, em inglês, com IDs estáveis,
   resolvida nas skills pelo token `{{MGR_LAWS}}` no install — o mesmo mecanismo de
   `{{MGR_ARCH_RULES}}` e `{{MGR_USER_LANGUAGE}}`.

5. **Cada lei declara a quem se aplica, por PAPEL** (`Planner`, `Executor`, `Verifier`,
   `Diagnostician`, `All`), não por skill.

6. **Preâmbulo das leis centrais no hook de sessão**, com interruptor próprio em
   `.mgr-core/config.json`.

## Alternatives Considered

- **Confiar no julgamento do modelo diante de conteúdo injetado:** rejeitada — é a ausência de
  política, não uma política.
- **Sanitizador de conteúdo ingerido:** rejeitada pelo mesmo argumento do ADR-0007 contra scanner
  como camada única — linguagem natural maliciosa não é detectável com garantia, e vender isso
  seria a promessa que o próprio ADR-0007 veta.
- **Leis por skill em vez de por papel:** rejeitada — skill é implementação, papel é poder; uma
  skill de terceiro que faça trabalho de Executor não herdaria lei nenhuma.
- **Skill lendo o arquivo de leis em runtime por caminho relativo:** rejeitada pela razão já
  registrada na feature `idioma-canonico-ingles` — frágil no escopo global e fere a
  autossuficiência por motor (CONSTITUTION §2.5).
- **Manter as leis duplicadas com um verificador de igualdade de texto:** rejeitada — conferir que
  duas cópias dizem a mesma coisa é julgamento, não parsing, e o verificador daria falsa segurança.

## Consequences

### Positive

- Mudar uma lei passa a tocar um arquivo, e a divergência medida deixa de ser possível.
- A lei mais forte passa a valer nas duas skills, porque é a mesma.
- A hierarquia deixa de ter um degrau vazio: o conteúdo que entra durante o trabalho ganha posição
  declarada, a mais baixa.
- A Fase 4 (`spec-extract`) nasce com a política que o vetor dela exige.

### Negative

- O preâmbulo custa contexto em **toda** sessão do usuário, para sempre. Por isso o teto de 25
  linhas, e o número exato declarado no fechamento.
- As cinco leis importadas do OpenSpec (L4.1, L4.2, L2.3, L2.4, L6.3) passam a valer
  imediatamente. É o escopo por papel que torna isso seguro.
- Um leitor precisa saber seu papel para saber o que o vincula.

### Risks and Mitigations

- **Risco:** perder texto sagrado ao mover lei de lugar. — **Mitigação:** inventário item a item,
  com listas separadas de REALOCADO e NOVO; só se remove de uma skill o que o arquivo de leis
  cobre integralmente ou de forma mais forte.
- **Risco:** a L4.2 (consentimento antes da escrita) quebrar o `spec-execute`. — **Mitigação:**
  ela é **satisfeita**, não dispensada — o plano aprovado no checkpoint 3 nomeia arquivos,
  descreve a mudança e foi aprovado em mensagem separada, que é exatamente o que a lei pede.
- **Risco:** ler a quarentena como garantia. — **Mitigação:** o texto declara que ela **reduz
  risco e aumenta detectabilidade**; não elimina prompt injection. Linguagem natural maliciosa não
  é detectável com garantia.
- **Revisit trigger:** reavaliar o escopo por papel se uma skill de terceiro precisar de um papel
  que a matriz não prevê.
