# Regras de qualidade de código (fonte única)

Fonte única das regras de qualidade de código, por linguagem. Consumida pelo `spec-init` (grava
o perfil da linguagem em `docs/sdd/09-review-rules.md`), aplicada pelo `spec-execute` **durante**
a codificação (não só no fim) e citada pelo `code-analyzer` no review. Opt-in por projeto.

> Vocabulário, não checklist: aplicar com evidência de necessidade; na dúvida, **perguntar**.
> Duas camadas: **idiomas/design** (regras do canon da linguagem — pegam o que o linter NÃO pega,
> ex.: `Optional` como parâmetro) e **estilo/lint** (formatação/naming — Checkstyle, ruff, eslint…).

## Regras universais (agnósticas) — reprovam

1. (QUAL-1) Não retornar null como sentinela em regra de negócio; use tipo explícito ou vazio
   (conforme a linguagem).
2. (QUAL-2) Validar a entrada na borda; **fail fast** com exceção/erro específico.
3. (QUAL-3) Imutabilidade por padrão; mutabilidade só quando há necessidade real.
4. (QUAL-4) Funções e classes pequenas, coesas, com nomes que expressam o que fazem/armazenam.
5. (QUAL-5) Recursos sempre liberados (try-with-resources / `defer` / context manager / `using`).
6. (QUAL-6) Sem código morto, sem duplicação, sem parâmetro booleano ambíguo, sem excesso de
   parâmetros.

## Perfil de linguagem (grave só o do projeto)

### Java — VALIDADO (*Effective Java*, Joshua Bloch + Google Checkstyle)

Idiomas/design (*Effective Java*):
1. (JQ-1) `Optional` **NUNCA** como parâmetro, campo ou elemento de coleção (Item 55). Use só
   como retorno, quando a ausência é um resultado esperado.
2. (JQ-2) Minimize a mutabilidade; prefira classes imutáveis / `record` (Item 17).
3. (JQ-3) Favoreça composição sobre herança (Item 18).
4. (JQ-4) Não retorne `null` de coleção/array — retorne vazio (Item 54).
5. (JQ-5) Valide parâmetros e falhe cedo com exceção específica (Item 49/72).
6. (JQ-6) `try-with-resources`, não `try-finally` (Item 9).
7. (JQ-7) Prefira enums a constantes `int` (Item 34); prefira interfaces a classes abstratas
   (Item 20).
8. (JQ-8) `equals`/`hashCode`/`toString` consistentes quando o tipo é usado como valor
   (Itens 10-12).

Estilo/lint (Google Checkstyle — `google_checks.xml`):
1. (JS-1) Sem wildcard import; imports ordenados (Google Java Style).
2. (JS-2) Linha ≤ 100 colunas; indentação do Google Java Style; chaves sempre presentes.
3. (JS-3) Um tipo público por arquivo; sem bloco vazio.
4. (JS-4) Naming Google Java Style; Javadoc em API pública quando aplicável.

### Go — [ADAPTADO — validar com o time]
Idiomas (*Effective Go*): erro idiomático `(T, error)`, sem `panic` para controle de fluxo,
interfaces pequenas, zero-value útil. Lint: `gofmt` + `golangci-lint` (`govet`, `errcheck`…).

### Python — [ADAPTADO — validar com o time]
Idiomas (*Effective Python*, Slatkin + PEP 8): type hints, comprehensions claras, context
managers, evitar mutáveis como default de argumento. Lint: `ruff`/`flake8` + `mypy`.

### C# / .NET — [ADAPTADO — validar com o time]
Idiomas (*Framework Design Guidelines*, Microsoft): async idiomático, nullable reference types,
`IDisposable`/`using`. Lint: analisadores Roslyk + `.editorconfig`.

### TypeScript / Node — [ADAPTADO — validar com o time]
Idiomas: `strict` no tsconfig, sem `any` implícito, união discriminada em vez de flags. Lint:
`eslint` + `prettier`.

### Genérico (fallback) — [ADAPTADO — validar com o time]
Idiomas do canon da linguagem + o formatter/linter idiomático da stack.

## Aplicação (gates)

- O `spec-execute` aplica estas regras **durante** a codificação e no **auto-review por task** —
  não é gate só do fim. Os **idiomas** pegam o que o **lint** não pega (design), e vice-versa.
- O `code-analyzer` reprova ancorado na regra textual (idem às regras de arquitetura).
- Estilo/lint roda como gate do projeto (Checkstyle/PMD/ruff/eslint) além do review humano/IA.
