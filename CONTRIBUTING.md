# Contribuindo com o MGR

## Adicionar uma skill
1. `skills/<nome>/SKILL.md` com frontmatter `name` (= pasta, kebab-case, sem
   "claude"/"anthropic") e `description` ≤1024 chars, assertiva sobre QUANDO acionar.
2. Material profundo em subpastas (`templates/`, `rules/`); SKILL.md < 500 linhas.
3. `node bin/mgr.js validate` verde. A skill é descoberta automaticamente.

## Completar um guia de arquitetura (arch-*)
Preencha as seções `[A DEFINIR]` APENAS com regras validadas com um time real — nunca
inventadas. Use `arch-hexagonal` como referência de formato.

## Antes do PR
- `npm test` verde · CHANGELOG atualizado · decisão estrutural → ADR.
