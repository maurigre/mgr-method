---
name: arch-onion
description: Provedora do guia de regras de review para projetos com Onion Architecture (Jeffrey Palermo), AGNÓSTICA À LINGUAGEM. Invocada pelo spec-init com a linguagem do projeto; monta docs/sdd/09-review-rules.md combinando os princípios da Onion (modelo de objeto no centro, interfaces no núcleo, acoplamento em direção ao centro) com as regras transversais compartilhadas (design, testes, logs, mutation e o perfil da linguagem). Regras numeradas com IDs estáveis e citáveis textualmente pelo code-analyzer. Use quando a arquitetura do projeto for Onion.
---

# arch-onion — Guia de regras (Onion Architecture)

Você fornece o guia de regras de review da Onion Architecture. O guia é **agnóstico à
linguagem**: os princípios valem em qualquer stack; as regras de ferramenta vêm do perfil da
linguagem, na fonte transversal.

## Objetivo

Organizar o sistema em camadas concêntricas com um **modelo de objeto de domínio independente
no centro**, empurrando infraestrutura, UI e persistência para a borda externa, de modo que o
acoplamento aponte sempre para o centro e o núcleo permaneça testável sem infraestrutura.

## Como montar o guia (instrução ao invocador — geralmente o `spec-init`)

Você recebe a **linguagem do projeto**. Gere `docs/sdd/09-review-rules.md` **concatenando**, na
ordem:

1. **Fundamentação Teórica** e **Princípios** (deste arquivo — verbatim).
2. **Regras Obrigatórias**, **Boas Práticas**, **Anti-patterns transversais** e **Checklist**
   da fonte única `{{MGR_ARCH_RULES}}`, gravando **apenas o perfil da linguagem**
   do projeto.
3. **Anti-patterns específicos de Onion** (deste arquivo) e **Referências** (deste arquivo).

Regras de gravação: preserve os IDs (`INV-n`, `DES-n`, etc.) e nomes de seção — o
`code-analyzer` cita "seção — Regra N" textualmente. Não altere as regras transversais aqui;
elas são mantidas em um único lugar.

## Fundamentação Teórica

Baseada na série original de **Jeffrey Palermo** (*The Onion Architecture*, 2008). A ideia
central é inverter o acoplamento do **layered/N-tier tradicional**: em vez de tudo depender do
banco na base, o **modelo de domínio** fica no centro e a infraestrutura (banco, UI,
persistência) é empurrada para a borda externa, como detalhe substituível. As interfaces são
declaradas nas camadas internas e implementadas pelas externas, garantindo que o núcleo não
dependa de nenhum mecanismo de infraestrutura.

## Princípios (invariantes da Onion Architecture)

Os quatro tenets de Palermo (INV-3 a INV-6) são o núcleo citável.

1. (INV-1) **Regra da dependência**: o acoplamento aponta sempre para o centro. Camadas
   externas dependem das internas; as internas não têm conhecimento das externas.
2. (INV-2) Camadas concêntricas, do centro para a borda: **Domain Model** (modelo de
   objeto/entidades) → **Domain Services** → **Application Services** → borda externa (UI,
   Infraestrutura, Persistência, Testes). O número de camadas pode variar; a borda externa é
   reservada à infraestrutura.
3. (INV-3) A aplicação é construída em torno de um **modelo de objeto independente** (Domain
   Model no centro), sem dependência de infraestrutura. (tenet 1)
4. (INV-4) **Interfaces são definidas nas camadas internas e implementadas pelas externas**
   (inversão de dependência): contratos (repositórios, gateways) pertencem ao núcleo; as
   implementações vivem na borda. (tenet 2)
5. (INV-5) Cada camada depende apenas das camadas **mais centrais** que ela; nunca de uma mais
   externa. (tenet 3)
6. (INV-6) O núcleo (Domain Model + Domain/Application Services) **compila e roda separado da
   infraestrutura** — testável isoladamente. (tenet 4)
7. (INV-7) Infraestrutura, UI, persistência e testes ficam na **borda externa** como detalhe
   substituível; o banco é detalhe de borda, não o centro.

## Anti-patterns específicos de Onion

Além dos anti-patterns transversais, reprovam nesta arquitetura:

- Domain Model dependendo de infraestrutura, ORM ou framework.
- Interface de repositório/gateway declarada na borda em vez de no núcleo (viola INV-4).
- Camada interna referenciando/importando uma camada mais externa (viola INV-5).
- Application Service acessando banco ou HTTP diretamente em vez de via interface do núcleo.
- Persistência tratada como camada central/base em vez de borda externa (recaída no
  layered/N-tier tradicional).

## Referências Oficiais

- Palermo, Jeffrey. *The Onion Architecture* (série, partes 1–4), 2008 —
  https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/
- Arquiteturas relacionadas: *Hexagonal Architecture* (Alistair Cockburn); *Clean
  Architecture* (Robert C. Martin).
