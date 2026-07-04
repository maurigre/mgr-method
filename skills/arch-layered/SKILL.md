---
name: arch-layered
description: Provedora do guia de regras de review para projetos com Layered (em camadas). Invocada pelo spec-init quando esta é a arquitetura do projeto - entrega o guia de regras que sera gravado em docs/sdd/09-review-rules.md e aplicado pelo code-analyzer. ATENCAO - este guia e um stub com a regra de dependencia estrutural definida, mas as regras detalhadas de design, teste e log estao [A DEFINIR] e devem ser preenchidas com o time antes do primeiro review.
---

# arch-layered — Guia de regras (Layered (em camadas)) — STUB

Você fornece o guia de regras para Layered (em camadas). **Este guia é um stub deliberado**: a regra
de dependência estrutural está definida, mas as regras detalhadas NÃO foram validadas
com um time real. NUNCA invente as regras faltantes — colete-as do usuário.

## Regra de dependência (definida)

controller → service → repository → model (cada camada só chama a de baixo)

## Regras detalhadas — [A DEFINIR]

Ao ser invocada, informe ao `spec-init` (ou ao usuário) que este guia está incompleto e
conduza a coleta: para cada seção abaixo, pergunte quais regras o time adota e grave
APENAS o que for confirmado. Use o guia da `arch-hexagonal` como referência de formato.

### Regras de Design — [A DEFINIR com o time]
### Padrões de teste — [A DEFINIR com o time]
### Padrões para logs — [A DEFINIR com o time]

O guia gravado em `docs/sdd/09-review-rules.md` deve conter somente regras confirmadas;
seções vazias permanecem marcadas `[A DEFINIR]` e o `code-analyzer` não reprova por
elas (política: sem regra textual explícita, o código está conforme).
