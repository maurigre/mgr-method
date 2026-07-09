---
name: arch-clean
description: Provedora do guia de regras de review para projetos com Clean Architecture (Robert C. Martin), AGNÓSTICA À LINGUAGEM. Invocada pelo spec-init com a linguagem do projeto; monta docs/sdd/09-review-rules.md combinando os princípios da Clean Architecture (Regra da Dependência, os anéis Entities/Use Cases/Interface Adapters/Frameworks) com as regras transversais compartilhadas (design, testes, logs, mutation e o perfil da linguagem). Regras numeradas com IDs estáveis e citáveis textualmente pelo code-analyzer. Use quando a arquitetura do projeto for Clean Architecture.
---

# arch-clean — Guia de regras (Clean Architecture)

Você fornece o guia de regras de review da Clean Architecture. O guia é **agnóstico à
linguagem**: os princípios (Regra da Dependência e os anéis) valem em qualquer stack; as
regras de ferramenta vêm do perfil da linguagem, na fonte transversal.

## Objetivo

Organizar o sistema para que as regras de negócio permaneçam independentes de frameworks, UI,
banco e serviços externos, com as dependências de código-fonte sempre apontando para dentro.
A arquitetura existe para preservar as **políticas** (decisões de negócio) dos **detalhes**
(mecanismos de implementação).

## Como montar o guia (instrução ao invocador — geralmente o `spec-init`)

Você recebe a **linguagem do projeto**. Gere `docs/sdd/09-review-rules.md` **concatenando**, na
ordem:

1. **Fundamentação Teórica** e **Princípios** (deste arquivo — verbatim).
2. **Regras Obrigatórias**, **Boas Práticas**, **Anti-patterns transversais** e **Checklist**
   da fonte única `{{MGR_ARCH_RULES}}`, gravando **apenas o perfil da linguagem**
   do projeto.
3. **Anti-patterns específicos de Clean** (deste arquivo) e **Referências** (deste arquivo).

Regras de gravação: preserve os IDs (`INV-n`, `DES-n`, etc.) e nomes de seção — o
`code-analyzer` cita "seção — Regra N" textualmente. Não altere as regras transversais aqui;
elas são mantidas em um único lugar.

## Fundamentação Teórica

Baseada exclusivamente nas obras de **Robert C. Martin** (*Clean Architecture*, 2017; artigo
*The Clean Architecture*, 2012), com raízes nas arquiteturas que a originaram: Hexagonal
(Cockburn), Onion (Palermo) e Screaming Architecture (Martin). Toda arquitetura busca:
independência de frameworks, da UI, do banco, de serviços externos, e facilidade de testes.
Ideia central — separar **Policies** (decisões de negócio: cálculo de imposto/desconto/frete,
validações) de **Details** (Spring, PostgreSQL, Kafka, REST, Redis…): os detalhes servem às
políticas, nunca o contrário. A Clean Architecture **não** determina número de camadas,
estrutura de diretórios, framework, ORM ou linguagem — isso pertence à implementação.

## Princípios (invariantes da Clean Architecture)

1. (INV-1) **Regra da Dependência**: dependências de código-fonte só apontam para dentro
   ("Source code dependencies can only point inward"). Camadas internas nunca conhecem as
   externas; nenhum nome declarado num anel externo é mencionado por um interno.
2. (INV-2) Os anéis, do mais interno ao mais externo: **Entities** (Enterprise Business Rules)
   → **Use Cases** (Application Business Rules) → **Interface Adapters** (Controllers,
   Presenters, Gateways, Mappers) → **Frameworks & Drivers** (banco, web, UI, mensageria). O
   número de anéis pode variar; o que não muda é a Regra da Dependência.
3. (INV-3) **Entities** encapsulam as regras de negócio corporativas, as mais estáveis; não
   conhecem banco, REST, Spring, Kafka, JPA nem JSON — apenas regra de negócio.
4. (INV-4) **Use Cases** contêm as regras específicas da aplicação: orquestram o fluxo,
   coordenam entities e usam abstrações; não conhecem infraestrutura.
5. (INV-5) **Interface Adapters** convertem formatos entre o mundo externo e o núcleo
   (Controllers, Presenters, Gateways, Mappers); não contêm regra de negócio.
6. (INV-6) **Frameworks & Drivers** ficam no anel externo como detalhe substituível
   ("frameworks são ferramentas, não devem definir sua arquitetura").
7. (INV-7) **Fronteiras (Boundaries) e Ports**: a comunicação entre anéis passa por contratos
   definidos no núcleo — **Input Boundary**, **Output Boundary** e **Gateway** (repositórios,
   clientes HTTP, mensageria). O fluxo de controle pode sair do centro, mas a dependência de
   código continua apontando para dentro (inversão de dependência).
8. (INV-8) **Dados que cruzam fronteiras** são estruturas simples e isoladas (DTOs, records,
   structs, objetos imutáveis, primitivos). Nunca transporte Entities, linhas de banco ou
   tipos que carreguem dependência arquitetural através de uma fronteira.

## Anti-patterns específicos de Clean

Além dos anti-patterns transversais, reprovam nesta arquitetura:

- Entities utilizando Spring ou JPA.
- Controllers contendo regras de negócio.
- Use Cases utilizando `JpaRepository` ou `EntityManager`.
- Domínio retornando `ResponseEntity` (ou tipo equivalente de framework web).
- Framework sendo importado pelo domínio.
- Estrutura de diretórios que revela tecnologia (`controller`/`service`/`repository`) em vez
  do negócio (ver Screaming Architecture nas Boas Práticas).

## Enforcement

Codifique os `INV` acima na ferramenta de arch-lint do perfil da linguagem (ArchUnit/Java,
NetArchTest/C#, import-linter/Python, go-arch-lint/Go, dependency-cruiser/TS), seguindo a
"Governança do enforcement" das Boas Práticas transversais (guard-rail; nunca enfraquecer;
mudança de regra só via `adr-create`). Ruleset concreto `[ADAPTADO — validar com o time]`;
referência validada de estilo: Hexagonal + Java + ArchUnit (na `arch-hexagonal`).

## Referências Oficiais

- Martin, Robert C. *Clean Architecture: A Craftsman's Guide to Software Structure and Design*.
  Prentice Hall, 2017.
- Martin, Robert C. *The Clean Architecture* (artigo), 2012.
- Arquiteturas relacionadas: *Hexagonal Architecture* (Alistair Cockburn); *Onion
  Architecture* (Jeffrey Palermo); *Screaming Architecture* (Robert C. Martin).
