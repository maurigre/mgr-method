# ADR 0001 — Arquitetura em camadas (layered) para o mgr-method

- **Data:** 2026-07-14
- **Status:** Accepted
- **Deciders:** Mauri Reis
- **Origem:** invocado pelo `spec-init` (inicialização SDD, modo brownfield)

## Context

O `mgr-method` é uma CLI Node (ESM) que instala e governa Agent Skills. A inicialização SDD
exige declarar a arquitetura, porque é ela que gera o **guia de regras de review** usado pelo
`code-analyzer`.

A análise do código encontrou:

- **`bin/`** — launcher CJS (guard de versão do Node) + CLI ESM: parse de flags, dispatch de
  comandos, adaptador de prompts (`@clack`), formatação e exit codes.
- **`src/`** — módulos com a lógica: `bundle`, `catalog`, `builder`, `installer`, `manifest`,
  `prompts`, `validator`, `banner`.
- **Dependência estritamente top-down**: `bin/` usa `src/`; nenhum módulo de `src/` importa
  `bin/`.
- **Não existem ports/adapters formais.** Há **uma** inversão pontual: `src/prompts.js` recebe
  o adaptador de prompts **injetado** (Humble Object), o que o torna testável sem TTY.

O projeto **não é** hexagonal, clean nem onion: não há inversão de dependência para um centro,
nem contratos de porta definidos pelo domínio.

## Decision

Registrar a arquitetura como **Layered (em camadas)** — provedora `arch-layered` — com as
camadas concretas **Borda (`bin/`) → Núcleo (`src/`)**.

O guia de regras é montado a partir de: princípios do `arch-layered` (direção top-down,
separação de responsabilidades, lógica na camada de domínio) + regras universais da fonte
transversal + perfil de linguagem JS/Node (adaptado do perfil TS/Node) + regras de qualidade.

## Consequences

**Positivas**
- O guia de regras reflete o que o código **realmente** faz — o `code-analyzer` passa a reprovar
  desvios reais (lógica na borda, `src/` importando `bin/`, I/O de terminal no núcleo).
- Evita o dano de rotular como hexagonal: geraria regras (ports/adapters) que o projeto não
  cumpre, e o review reprovaria praticamente tudo.
- Mantém a honestidade de atribuição: layered é de **Fowler** (*PoEAA*); `Screaming
  Architecture` fica como prática **transversal opt-in**, creditada a **Martin**.

**Negativas / limites**
- O layered **não** garante isolamento do núcleo em relação à infraestrutura (não há inversão
  de dependência). A disciplina depende da regra top-down + revisão.
- Se o projeto evoluir para ter integrações externas relevantes, pode valer migrar para
  hexagonal — o que exigirá **novo ADR** (este seria `Superseded by`).

**Enforcement**
- Regra `INV-2` (`src/ ↛ bin/`) é candidata a **enforcement automatizado** via
  `dependency-cruiser` ou `eslint-plugin-boundaries` — registrado como Boa Prática opt-in no
  guia de regras de review, ainda `[A IMPLEMENTAR]`.
  *(Cumprido pelo **ADR-0002**: o enforce é feito por `no-restricted-imports`, do core do
  ESLint — as duas ferramentas acima foram rejeitadas por custo de dependência.)*

## References

- Fowler, Martin. *Patterns of Enterprise Application Architecture*, 2002 — cap. "Layering".
- Buschmann, F. et al. *Pattern-Oriented Software Architecture, Vol. 1* — padrão **Layers**.
- `docs/adr/0002-gates-de-qualidade-automatizados.md` — implementa o enforcement do `INV-2`.

> Os artefatos SDD que detalham esta decisão (arquitetura, guia de regras de review) são mantidos
> **fora do versionamento**, só no ambiente do autor. Este ADR é **autocontido**: a decisão e o
> racional estão acima e não dependem deles.
