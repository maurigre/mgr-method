# 02 — PRD: Gates de qualidade

> **Regra deste documento:** só o **o quê** e o **por quê**. Zero decisão técnica
> (essas vão na `03-spec.md`).

## Contexto e motivação

O `spec-init` (2026-07-14) auditou o repositório e encontrou um buraco: **o projeto nunca teve
linter algum** (nem estilo, nem erro comum), a **cobertura é medida mas não bloqueia nada**, a
convenção de commits **existe só na cabeça do autor** (nada a enforça) e **CVEs em dependências
não são verificadas**. Ou seja: um framework cuja tese é *"não deixe o agente improvisar"*
não aplica em si mesmo os gates que ele exige dos outros.

Pior: a qualidade hoje depende de **disciplina humana**. Se o autor (ou um agente) escorregar,
**nada quebra o build** — o defeito entra na `main` e é publicado.

## Objetivo

**Tornar a qualidade um gate automático, não uma promessa.** Ao fim desta feature, código ou
commit fora do padrão do projeto **falha o CI** — sem depender de ninguém lembrar.

## Casos de uso

| # | Ator | Fluxo | Resultado esperado |
|---|---|---|---|
| UC-1 | Autor / agente | Escreve código com erro de estilo ou problema comum de JS | O **lint reprova** — localmente e no CI |
| UC-2 | Autor / agente | Escreve commit fora da convenção (com scope, subject maiúsculo, corpo com linha >100 col, menção a IA) | O commit é **rejeitado no momento do commit**, com a violação explicada |
| UC-3 | Autor / agente | Remove/altera código e a cobertura cai abaixo do mínimo | O **CI quebra** e aponta a queda |
| UC-4 | Autor | Uma dependência ganha CVE conhecida | O CI **acusa** a vulnerabilidade |
| UC-5 | Autor / agente | Tenta fazer `src/` importar `bin/` (viola INV-2) | O lint **reprova** a violação da arquitetura |

## Regras de negócio

1. **RN-1 — Gate real:** cada verificação **quebra o build** quando violada. Aviso que não
   falha não é gate (o Coveralls hoje roda com `fail-on-error: false`).
2. **RN-2 — Anti-maquiagem (CONSTITUTION §4):** o gate de cobertura **não pode** ser satisfeito
   excluindo código da medição. O limiar é sobre o que **realmente** é medido hoje
   (`src/` + `bin/`).
3. **RN-3 — Limiar:** **linhas ≥ 95%**. Branches ficam **fora** do gate (hoje 76,4%; oscilam e
   gerariam falso positivo).
4. **RN-4 — Convenção de commit é a da CONSTITUTION §5, exatamente:** Conventional Commits
   **SEM scope**; subject minúsculo, imperativo, sem ponto final; header ≤ 100 colunas; corpo
   com linha em branco após o header e **cada linha ≤ 100 colunas**; **proibida menção a IA**.
   Nem mais restritivo, nem menos.
5. **RN-5 — Comportamento do CLI preservado:** nenhuma mudança observável em
   `install/status/update/uninstall/build/validate/list/version`.
6. **RN-6 — A CONSTITUTION deve refletir a realidade:** ao concluir, os quatro itens saem de
   `[A IMPLEMENTAR]`.

## Restrições

- As **ferramentas já foram decididas** na CONSTITUTION (ESLint · Commitlint · gate de
  cobertura · auditoria de dependências) — esta feature **implementa**, não rediscute a escolha.
- O projeto é **JS/ESM puro** (sem TypeScript) e roda em **Node ≥ 22**.
- **Nenhuma ação de git automática** (CONSTITUTION §5): commit/push só no checkpoint final.

## Fora de escopo (explícito)

- **Mutation testing (StrykerJS)** — segue `[A CONFIRMAR]` no `06-quality.md`.
- **Matriz de SO no CI** (Windows) — é uma pergunta aberta do `_self-assessment.md`.
- **Reorganizar `src/`** (Screaming Architecture) — pergunta aberta, não é deste escopo.
- **Corrigir o bug de caminho da CONSTITUTION** (`spec-init` diz raiz, `sdd-check` exige
  `docs/sdd/`) — é um `fix:` separado, fora desta spec.
- **Retroagir a convenção** aos 55 commits já existentes.

## Métricas de sucesso (observáveis)

1. Um commit fora da convenção da §5 é **rejeitado** antes de entrar no histórico.
2. Um `src/*.js` importando `bin/` **falha o lint**.
3. Uma queda de cobertura para < 95% de linhas **falha o CI** (verificável forçando a queda).
4. `npm audit` roda no CI e **falha** em vulnerabilidade acima do nível acordado.
5. `docs/sdd/CONSTITUTION.md` **sem nenhum `[A IMPLEMENTAR]`** nos gates.

## Stakeholders

- **Autor/mantenedor:** Mauri Reis (decide limiares e política).
- **Agentes de código** (Claude Code / Copilot): consumidores dos gates — é para eles que o
  guard-rail existe.
- **Usuários do pacote:** beneficiados indiretamente (menos defeito publicado).
