---
name: adr-create
description: Cria Architecture Decision Records (ADRs) no formato canônico de Michael Nygard. Auto-detecta o diretório de ADRs do projeto a cada execução (sem persistir configuração), gera numeração sequencial, e opera em modo AVULSO (perguntas ao usuário) ou INVOCADO (recebe contexto pré-preenchido de outra skill como spec-create ou spec-init e pergunta apenas os Deciders). Use quando o usuário pedir para criar ADR, documentar ou registrar uma decisão arquitetural, ou novo architecture decision record. Agnóstica à linguagem e stack.
---

# adr-create — Architecture Decision Records

## Detecção do diretório (executa TODA vez, antes de tudo)

**Etapa 1 — Procurar ADRs existentes** em: `/docs/adrs/`, `/docs/adr/`,
`/docs/decisions/`, `/docs/architecture/decisions/`, `/adrs/`, `/adr/`,
`/architecture/decisions/`. Critério de "parece ADR": nome começa com 3-4 dígitos +
hífen (`0001-`), OU primeira linha é heading `# ADR-NNN:`.

**Etapa 2 — Decidir:**
- Nenhum encontrado → usar `/docs/adrs/` (criar; avisar "Criando diretório padrão").
- Um único diretório → usá-lo (avisar path + contagem).
- Múltiplos → listar todos com contagem e PERGUNTAR qual usar NESTA execução. NÃO
  persistir a escolha (decisão de design: auto-detecta toda vez, sem cache/config).

**Etapa 3 — Próximo número:** maior `NNNN-*.md` + 1, formato 4 dígitos com zeros
(`0001`, `0042`). Nunca pular, nunca reutilizar (mesmo com ADR deletado).

## Modo AVULSO — perguntas (nesta ordem)

1. **Título:** frase curta com verbo de ação (Adoção de..., Migração de...,
   Padronização de...), sem prefixo "ADR:", ≤ 80 chars. Vira slug kebab-case sem
   acentos, ≤ 60 chars, truncando em palavra inteira.
2. **Status:** Proposed · **Accepted (default)** · Deprecated · Superseded by ADR-XXXX
   (perguntar qual).
3. **Deciders:** ≥ 1 nome; aceitar lista por vírgula/linha; "sozinho" → nome do usuário.
   Registrar EXATAMENTE como informado (não normalizar).
4. **Context:** problema técnico/negócio, restrições, por que agora. Mínimo 2-3 frases —
   se vago, pedir mais ANTES de gerar (não preencher com generalidades).
5. **Decision:** o que foi decidido, como será implementado em alto nível, tecnologias.
6. **Alternatives considered** (opcional, recomendado): cada uma com motivo de rejeição
   em 1-2 frases. Se "não considerei": avisar que ADR sem alternativas tem valor
   reduzido, mas permitir.
7. **Consequences:** o que fica mais fácil · mais difícil · riscos · mitigações.
8. **Confirmação:** mostrar preview completo → criar / ajustar campo / abortar.

## Modo INVOCADO (por spec-create, spec-init ou outra skill)

Recebe objeto com `title, status, context, decision, alternatives[], consequences{},
source_spec`. Comportamento: pular perguntas 1-7; executar a detecção de diretório
normalmente; mostrar preview pré-preenchido; **perguntar APENAS Deciders + confirmação**;
retornar à chamadora: path, número e status do ADR. Quando `source_spec` presente,
acrescentar ao fim do Context: `**Reference:** Spec técnica em <source_spec>.` (e a
chamadora registra o link inverso no `06-completion.md`).

## Template do arquivo gerado

```markdown
# ADR-<NNNN>: <Título>

Date: <YYYY-MM-DD>
Deciders: <Nome1>, <Nome2>

## Status

<Accepted | Proposed | Deprecated | Superseded by ADR-XXXX>

## Context

<problema, restrições, por que a decisão é necessária agora>

## Decision

<o que será feito, tecnologias/padrões, implementação em alto nível>

## Alternatives Considered

- **<Alternativa>:** <motivo da rejeição>

## Consequences

### Positive
- <o que fica mais fácil>

### Negative
- <o que fica mais difícil>

### Risks and Mitigations
- **Risco:** <descrição> — **Mitigação:** <ação>
```

Formatação: data ISO; sem comentários HTML; sem placeholders `<...>` no arquivo final;
linha em branco entre seções. Seção Alternatives só se houver alternativas.

## Regras de comportamento

1. **Auto-detecção sempre** — nunca assumir diretório, mesmo se rodou há 5 minutos.
2. **Numeração sequencial obrigatória.**
3. **Imutabilidade:** ADR `Accepted` NÃO é editado. Mudança de direção → novo ADR com
   `Superseded by`, e o antigo muda APENAS o status. (Typo trivial pode ser corrigido;
   mudança semântica exige novo ADR.)
4. **Confirmação antes de escrever**, em ambos os modos.
5. **Idioma:** o dos ADRs existentes; sem ADRs, perguntar (default português). Modo
   invocado herda da chamadora.
6. **Não inventar contexto** — Context vago → perguntar mais.

## Integração mgr-code

Se o `mgr-mcp` estiver disponível, consulte ADRs relacionados já registrados na memória
antes de criar ("existe decisão anterior sobre isto?") e grave o novo ADR ao concluir.
Indisponível → siga normalmente (a auto-detecção em disco é a fonte primária).
