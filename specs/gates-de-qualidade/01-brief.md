# 01 — Brief (literal)

- **Feature:** `gates-de-qualidade`
- **Tipo:** feature nova
- **Data:** 2026-07-14
- **Solicitante:** Mauri Reis
- **Origem:** itens `[A IMPLEMENTAR]` registrados na `CONSTITUTION.md` pelo `spec-init`

## Pedido (registrado literalmente)

> Implementar os gates de qualidade adotados na CONSTITUTION (hoje marcados [A IMPLEMENTAR]):
> (1) ESLint — config flat para JS/ESM + script npm + step no CI;
> (2) Commitlint — Conventional Commits SEM scope, subject minúsculo/imperativo/sem ponto
> final, header ≤100 col, corpo com linha em branco e cada linha ≤100 col, com hook de
> commit-msg;
> (3) Gate de cobertura — limiar que QUEBRA o CI abaixo do mínimo (definir o valor; cobertura
> atual 96,95% de linhas);
> (4) Auditoria de dependências — npm audit (ou equivalente) no CI.
> Preservar comportamento do CLI. Ao concluir: remover os itens de [A IMPLEMENTAR] na
> CONSTITUTION.md, atualizar docs/sdd/06-quality.md e o CHANGELOG. Sem commit automático.

## Decisões da interação inicial

| Item | Decisão |
|---|---|
| Tipo | Feature nova (não altera o comportamento do CLI) |
| Slug | `gates-de-qualidade` |
| **Limiar de cobertura** (era `[A DEFINIR]`) | **Linhas ≥ 95%** (hoje 96,95%). Branches **não** entram no gate (hoje 76,4% — oscilam e gerariam falso positivo) |
| Constituição | Aplica **integralmente**, sem override |
