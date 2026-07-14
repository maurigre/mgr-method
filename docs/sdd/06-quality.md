# 06 — Qualidade

> **Detectado no repo** (brownfield) + **adotado** na inicialização SDD (2026-07-14).
> Regra de precedência: o que já existe é a fonte de verdade; só se ofereceu o que faltava.

## O que JÁ existe (evidência)

| Item | Estado | Fonte |
|---|---|---|
| Testes | **`node:test` nativo** — 25 testes em `test/mgr.test.js` | `package.json` (`test`) |
| Cobertura | `node --experimental-test-coverage` → `lcov.info` → **Coveralls** | script `coverage`, `ci.yml` |
| Cobertura atual | **96,95% de linhas**; `src/` inteiro a 100%; `bin/mgr.js` 89,7% | medição 2026-07-14 |
| Validação de skills | `mgr validate` (frontmatter, kebab-case, ≤500 linhas) — roda no CI | `src/validator.js`, `ci.yml` |
| CI | GitHub Actions (`ci.yml`) — Node `lts/*` | `.github/workflows/ci.yml` |
| Commits | Conventional Commits **sem scope** (convenção humana) | `git log` |

## Gates automatizados (implementados em 2026-07-14)

Feature `gates-de-qualidade` · **ADR-0002**. Antes disso o projeto **nunca teve linter**, a
cobertura não bloqueava nada e a convenção de commit era só disciplina humana.
**Todos quebram o build** (aviso que não falha não é gate).

| Gate | Implementação | Onde falha |
|---|---|---|
| **ESLint** | `eslint.config.js` (flat config) sobre `@eslint/js` recommended | `npm run lint` + CI |
| **Gate de cobertura** | `--test-coverage-lines=95` — flag **nativa** do Node, zero dependência | `npm run coverage` + CI |
| **Commitlint** | `config-conventional` + `scope-empty`, `body-leading-blank`, `no-ai-mention` | hook `commit-msg` + CI |
| **Auditoria** | `npm audit --audit-level=high` (deps e devDeps) | CI |

**Limiar:** linhas **≥ 95%** (hoje 96,95%). **Branches ficam fora** do gate — hoje 76,4%,
oscilam, e gerariam falso positivo que ensina o time a ignorar o vermelho.

**Hook de commit:** `.githooks/commit-msg` + `git config core.hooksPath` (via `prepare`) —
**sem husky**, zero dependência. O hook é conveniência (falha cedo, local); o **gate real é o
CI**, porque `--no-verify` contorna hook e CI não.

**O lint enforça dois invariantes de arquitetura** (deixaram de ser prosa):
`src/` ↛ `bin/` (INV-2, `no-restricted-imports`) e `bin/mgr.cjs` preso ao **ES5**
(`ecmaVersion: 5` — o launcher roda antes do guard de versão).

### Duas regras que foram deliberadamente NÃO endurecidas

Endurecer além da CONSTITUTION seria **inventar regra** (§3.1):
- **`subject-case` fica no default.** Forçar subject inteiro minúsculo reprovaria commits
  legítimos do próprio histórico (`docs: inicializa SDD do projeto`). O default já proíbe o
  subject *começar* maiúsculo, que é o que a §5 pede.
- **`no-ai-mention` mira atribuição de autoria**, não a palavra. O projeto instala skills para
  Claude Code e Copilot: `.claude/` e "copilot" aparecem legitimamente nos commits. O padrão
  pega `Co-Authored-By: <IA>`, "Generated with …" e afins.

## Anti-inflação (regra dura, herdada do método)

**NUNCA** criar teste para código sem lógica só para bater métrica. Se a classe/módulo não tem
decisão, a resposta certa é **excluir do escopo**, não testá-la. Cobertura é **métrica, não
meta**.

Corolário aplicado aqui: **não excluir `bin/` da medição para maquiar o número.** O caminho
correto — já executado — foi **extrair a lógica** (`src/prompts.js`, Humble Object) e **testar
os comandos** do CLI. A cobertura subiu de 81,44% → 96,95% **testando**, não escondendo.

## Mutation testing

`JaCoCo`/`PITest` **não se aplicam** (são Java). O equivalente Node é **StrykerJS**.
`[A CONFIRMAR]` — não adotado nesta rodada.

## Política de teste

- Prioridade a **objetos reais**; stubs só na borda (ex.: o adaptador de prompts).
- Smoke tests do CLI via subprocesso (`execFileSync`) cobrem os comandos ponta a ponta.
- Teste de **migração** do layout antigo é obrigatório (regressão cara).
