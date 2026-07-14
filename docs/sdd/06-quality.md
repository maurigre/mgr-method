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

## O que NÃO existia (gaps identificados) e foi ADOTADO

Decisão do autor em 2026-07-14. **Ainda não implementado** — vira feature via `spec-create`.

| Gate adotado | Alvo | Estado |
|---|---|---|
| **ESLint** | lint de JS/ESM, rodando no CI | `[A IMPLEMENTAR]` |
| **Gate de cobertura** | limiar que **quebra o CI** abaixo do mínimo | `[A IMPLEMENTAR]` — limiar `[A DEFINIR]`, sugestão: ≥95% linhas (hoje 96,95%) |
| **Commitlint** | enforçar Conventional Commits **sem scope** + corpo ≤100 col | `[A IMPLEMENTAR]` |
| **Auditoria de dependências** | `npm audit` (ou equivalente) no CI para CVEs | `[A IMPLEMENTAR]` |

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
