---
name: arch-hexagonal
description: Provedora do guia de regras de review para projetos com arquitetura Hexagonal (Ports & Adapters, Alistair Cockburn), AGNÓSTICA À LINGUAGEM. Invocada pelo spec-init com a linguagem do projeto; monta docs/sdd/09-review-rules.md combinando os princípios da hexagonal (regra de dependência, ports inbound/outbound, adapters) com as regras transversais compartilhadas (design, testes, logs, mutation e o perfil da linguagem). Regras numeradas com IDs estáveis e citáveis textualmente pelo code-analyzer. Use quando a arquitetura do projeto for hexagonal.
---

# arch-hexagonal — Guia de regras (Ports & Adapters)

Você fornece o guia de regras de review da arquitetura hexagonal. O guia é **agnóstico à
linguagem**: os princípios valem em qualquer stack; as regras de ferramenta vêm do perfil da
linguagem, na fonte transversal.

## Objetivo

Permitir que o domínio da aplicação permaneça completamente independente de qualquer
tecnologia externa (banco, UI, APIs, frameworks), comunicando-se com o mundo através de
**Portas (Ports)** e **Adaptadores (Adapters)**. Assim, banco, UI, protocolos e frameworks são
substituíveis sem impacto nas regras de negócio.

## Como montar o guia (instrução ao invocador — geralmente o `spec-init`)

Você recebe a **linguagem do projeto**. Gere `docs/sdd/09-review-rules.md` **concatenando**, na
ordem:

1. **Fundamentação Teórica** e **Princípios** (deste arquivo — verbatim).
2. **Regras Obrigatórias**, **Boas Práticas**, **Anti-patterns transversais** e **Checklist**
   da fonte única `{{MGR_ARCH_RULES}}`, gravando **apenas o perfil da linguagem**
   do projeto.
3. **Anti-patterns específicos de Hexagonal** (deste arquivo) e **Referências** (deste arquivo).

Regras de gravação: preserve os IDs (`INV-n`, `DES-n`, etc.) e nomes de seção — o
`code-analyzer` cita "seção — Regra N" textualmente. Não altere as regras transversais aqui;
elas são mantidas em um único lugar.

## Fundamentação Teórica

Baseada nos princípios originais de **Alistair Cockburn** (*Hexagonal Architecture / Ports &
Adapters*, 2005). O hexágono é apenas uma representação visual — **não** representa camadas, e
sim que a aplicação tem várias formas de comunicação com o mundo externo via ports e adapters.
Segundo Cockburn: *"Create your application to work without either a UI or a database so that
it can be tested automatically, and so that either can be replaced without impacting the
business logic."* O objetivo real não é usar interfaces por si, mas garantir a inversão de
dependência que mantém as regras de negócio isoladas de qualquer detalhe tecnológico.

## Princípios (invariantes de Ports & Adapters)

1. (INV-1) O núcleo (domínio + casos de uso) não depende de tecnologia externa: não conhece
   framework, banco de dados, ORM, HTTP, mensageria, cache nem SO.
2. (INV-2) Tipos de domínio dependem apenas de outros tipos de domínio.
3. (INV-3) Os ports são definidos pelo domínio. **Inbound ports** (primary/driving) = casos de
   uso oferecidos; **outbound ports** (secondary/driven) = dependências que o domínio precisa
   (repositório, gateway de pagamento, relógio, gerador de id).
4. (INV-4) Adapters nunca contêm regra de negócio — só traduzem entre tecnologia externa e
   domínio. **Driving adapters** (REST, CLI, messaging, scheduler) chamam inbound ports;
   **driven adapters** (persistência, cliente HTTP, cache) implementam outbound ports.
5. (INV-5) Toda dependência aponta para dentro. Nenhuma referência do núcleo para adapter/infra.
6. (INV-6) DTOs, entidades de ORM e mappers pertencem aos adapters. O domínio nunca conhece
   DTO, anotação de persistência nem tipo de framework.
7. (INV-7) Métodos de borda (endpoints/handlers/consumers) não recebem nem retornam tipos de
   domínio — apenas tipos de payload (request/response) criados para isso.

## Anti-patterns específicos de Hexagonal

Além dos anti-patterns transversais, reprovam nesta arquitetura:

- Port (interface) declarado no adapter em vez de no domínio (viola INV-3).
- Núcleo acessando tecnologia diretamente em vez de através de um outbound port.
- Entidade de ORM usada como modelo de domínio, sem mapeamento no adapter de persistência.
- Driving adapter que executa regra de negócio em vez de apenas chamar um inbound port.

## Referências Oficiais

- Cockburn, Alistair. *Hexagonal Architecture (Ports & Adapters)*, 2005 —
  https://alistair.cockburn.us/hexagonal-architecture/
- Cockburn, Alistair. *Patterns for Effective Use Cases*. Addison-Wesley.
- Evans, Eric. *Domain-Driven Design*; Vernon, Vaughn. *Implementing DDD*; Martin, Robert C.
  *Clean Architecture*.
