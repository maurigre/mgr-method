---
name: arch-layered
description: Provedora do guia de regras de review para projetos com arquitetura em camadas (Layered / N-tier, Martin Fowler), AGNÓSTICA À LINGUAGEM. Invocada pelo spec-init com a linguagem do projeto; monta docs/sdd/09-review-rules.md combinando os princípios do layered (camadas Presentation/Domain/Data Source, dependência top-down) com as regras transversais UNIVERSAIS compartilhadas (design, testes, logs, mutation e o perfil da linguagem). Diferente das arquiteturas de inversão (hexagonal/clean/onion): o layered não empurra a infraestrutura para o centro. Regras numeradas com IDs citáveis pelo code-analyzer. Use quando a arquitetura do projeto for em camadas.
---

# arch-layered — Guia de regras (Layered / N-tier)

Você fornece o guia de regras de review da arquitetura em camadas. O guia é **agnóstico à
linguagem**: os princípios valem em qualquer stack; as regras de ferramenta vêm do perfil da
linguagem, na fonte transversal.

## Objetivo

Organizar o sistema em camadas horizontais com responsabilidades distintas (apresentação,
domínio, dados), onde cada camada usa os serviços da camada imediatamente inferior, mantendo a
lógica de negócio concentrada na camada de domínio.

## Como montar o guia (instrução ao invocador — geralmente o `spec-init`)

Você recebe a **linguagem do projeto**. Gere `docs/sdd/09-review-rules.md` **concatenando**, na
ordem:

1. **Fundamentação Teórica** e **Princípios** (deste arquivo — verbatim).
2. Da fonte única `{{MGR_ARCH_RULES}}`, inclua **apenas** as seções **UNIVERSAIS**:
   **Regras Obrigatórias** (design, testes, logs, mutation) + o **perfil da linguagem** do
   projeto + as **Boas Práticas** de nomenclatura e Screaming Architecture. **NÃO** inclua os
   "Anti-patterns transversais" nem o "Checklist" da fonte (assumem inversão de dependência) —
   use os **deste arquivo** (top-down).
3. **Anti-patterns específicos de Layered**, **Checklist** e **Referências** (deste arquivo).

Regras de gravação: preserve os IDs (`INV-n`, `DES-n`, etc.) e nomes de seção — o
`code-analyzer` cita "seção — Regra N" textualmente.

## Fundamentação Teórica

Baseada em **Martin Fowler** (*Patterns of Enterprise Application Architecture*, 2002 — capítulo
"Layering") e no padrão Layers (Buschmann et al., *POSA*). As três camadas principais são
**Presentation** (UI/API), **Domain** (lógica de negócio; opcionalmente uma **Service Layer**) e
**Data Source** (persistência/integração). Princípio de camadas: uma camada superior usa
serviços da inferior, e as inferiores **desconhecem** as superiores.

Divergência honesta em relação a hexagonal/clean/onion: o layered clássico **não** faz inversão
de dependência para um centro — a camada de domínio pode depender da camada de dados, e a
persistência é a base, não a borda. Por isso este guia **não** aplica as regras de "domínio
isolado da infraestrutura" daquelas arquiteturas; a garantia aqui é a **direção top-down** e a
**separação de responsabilidades**.

## Princípios (invariantes da arquitetura em camadas)

1. (INV-1) Camadas principais (Fowler): **Presentation → Domain → Data Source** (opcional
   **Service Layer** entre apresentação e domínio). No projeto, concretiza-se tipicamente como
   `controller → service → repository → model`.
2. (INV-2) **Dependência top-down**: cada camada usa a imediatamente inferior; camadas
   inferiores nunca conhecem nem chamam as superiores.
3. (INV-3) Cada camada **esconde** as camadas inferiores das superiores (encapsulamento de
   camada): a de cima fala com a de baixo por um contrato, sem vazar detalhes.
4. (INV-4) Escolha entre **layering estrito** (uma camada só chama a imediatamente inferior) e
   **relaxado** (pode pular camadas) e seja consistente em todo o projeto.
5. (INV-5) **Separação de responsabilidades**: apresentação (UI/API/serialização), domínio
   (regras de negócio), data source (persistência/integração externa).
6. (INV-6) A **lógica de negócio pertence à camada de Domínio/Service** — não vaza para a
   apresentação (controllers gordos) nem para a camada de dados (SQL/stored procedures).

## Anti-patterns específicos de Layered

Além dos anti-patterns de design (ver Regras Obrigatórias), reprovam nesta arquitetura:

- Regra de negócio na camada de **apresentação** (controller com lógica) ou na camada de
  **dados** (regra em SQL/stored procedure).
- Camada **inferior** conhecendo ou chamando uma **superior** (viola INV-2).
- Em layering estrito, **pular camadas** (ex.: apresentação acessando o repositório direto,
  sem passar pelo domínio/serviço) — viola INV-4.
- Camada **pass-through anêmica**, que só repassa a chamada sem responsabilidade própria
  (reforça DES-7 e DES-10).

## Checklist (guard-rails da IA — verifique antes e depois de gerar/alterar código)

- A **regra de negócio** está na camada de Domínio/Service (não na apresentação nem na de
  dados)?
- As **dependências vão só de cima para baixo**? Nenhuma camada inferior chama a superior?
- Se o projeto adota **layering estrito**, ninguém pula camadas?
- Cada camada tem responsabilidade própria (nada de pass-through anêmico)?
- Testes com objetos reais (TST-1), mock só na borda (TST-2), sem matcher genérico (TST-5);
  nomes significativos (NAM-1, NAM-2).

## Referências Oficiais

- Fowler, Martin. *Patterns of Enterprise Application Architecture*. Addison-Wesley, 2002
  (capítulo "Layering"; camadas Presentation / Domain / Data Source).
- Buschmann, F. et al. *Pattern-Oriented Software Architecture, Vol. 1* — padrão **Layers**.
