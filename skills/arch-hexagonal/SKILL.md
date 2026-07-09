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

## Convenção e enforcement — Java (VALIDADO)

Convenção de nomes/pacotes e ruleset ArchUnit validados para Hexagonal em Java (é uma **Boa
Prática opt-in**: o `spec-init` oferece e confirma com o time). Outras linguagens **adaptam** —
traduza os `INV` para a ferramenta de arch-lint do perfil (ver "Governança do enforcement" nas
Boas Práticas transversais): `[ADAPTADO — validar com o time]`.

### Organização de pacotes (escolha do projeto — ADR)

O Cockburn **não dita layout de pacotes**; escolha uma e seja consistente (registre no ADR):
- **Por feature** (recomendado ao crescer): `core.<feature>.{domain,usecase,port.in,port.out,exception}`.
- **Por camada** (ok em app pequeno): `core.{domain,usecase,port.in,port.out,exception}`.

Motivar a escolha por "gritar o domínio" é **Screaming Architecture — de Robert C. Martin**
(prática transversal opt-in), **não** regra do Cockburn. As regras ArchUnit usam `..core..X..`,
funcionando nas duas organizações.

### Nomes e pacotes

| Papel | Sufixo/nome | Pacote (`X` = feature, quando por feature) |
|---|---|---|
| Entidade/VO de domínio | `Project` | `..core..domain..` |
| **Command/Query** (input data) | `CreateProjectCommand` · `GetProjectQuery` | `..core..port.in..` (com o input port) |
| Input port | `CreateProjectUseCasePort` | `..core..port.in..` |
| Use case (impl, package-private) | `CreateProjectUseCase` | `..core..usecase..` |
| Output port | `ProjectRepositoryPort` · `ShippingGatewayPort` | `..core..port.out..` |
| Exceções | `...Exception` | junto do agregado (`..core..exception..`) |
| VOs/kernel comuns | `Money` · `CNPJ` · `BranchId` | `..core.shared..` |
| Inbound web | `...Controller` | `..adapter.in.web.controller.v1..` |
| Inbound worker | `...Receiver` | `..adapter.in.rabbit..` |
| Outbound persistência | `...RepositoryAdapter` | `..adapter.out.persistence..` (pacote = nome do banco) |
| Outbound client | `...ApiAdapter` | `..adapter.out.client.<api>..` (pacote = nome da API) |
| Spring Data (interno) | `...JpaRepository` | `..adapter.out.persistence.repository..` |
| ORM entity · mapper · projection · DTO | `ProjectEntity` · `...Mapper` · `...Projection` · `...Request/Response` | subpacotes do próprio adapter |

Todo **`Port`** é interface (entrada e saída). `entity`/`mapper`/`projection`/`dto` idealmente
package-private (não vazam para o core nem para outro adapter). Distinga: **outbound port** do
core (`...Port`) ≠ **Spring Data** (`...JpaRepository`, interno) ≠ **adapter** (`...Adapter`).
Os **DTOs (`...Request`/`...Response`) e mappers da web moram sob a versão do controller**
(`controller.v1.dto`, `controller.v1.mapper`), não soltos em `adapter.in.web` — isola o contrato
por versão da API (opt-in; para APIs sem versionamento, dispensável).

### Command/Query e composition root

- **Command/Query** (o *input data* que cruza a fronteira de entrada) moram no **core**, junto do
  input port (`..core..port.in..`) — o contrato é do domínio, não do adapter. Os mappers de borda
  convertem DTO → Command; o use case nunca vê DTO.
- **`config` é o composition root**: o **único** lugar autorizado a depender das impls
  package-private de use case (wiring `@Bean`). Fica fora do layering Core/Adapter (vê os dois).

### Relação entre domínios (DDD — Evans / Vernon)

Um `core.<feature>` **nunca importa** outro `core.<feature>` diretamente:
- **Conceito comum** → `core.shared` (**Shared Kernel**, Evans).
- **Referência a outro agregado** → por **ID** (VO), não por objeto (Vernon): `Project` guarda
  `BranchId`, não `Branch`.
- **Comportamento/dado de outra feature** → **outbound port na própria feature** + adapter/**ACL**
  que delega à outra (wired no `config`) — nunca dependência de domínio.
- Acoplamento constante entre duas features → talvez seja **um bounded context só**; reveja a
  fronteira.

### Regras ArchUnit (o "com o quê" do enforcement)

```java
// Todo Port é interface (entrada e saída)
classes().that().haveSimpleNameEndingWith("Port").should().beInterfaces();

// Input port: sufixo UseCasePort, mora em core..port.in
classes().that().haveSimpleNameEndingWith("UseCasePort")
    .should().beInterfaces().andShould().resideInAPackage("..core..port.in..");

// #2 Command/Query moram no core (input boundary), não no adapter
classes().that().haveSimpleNameEndingWith("Command").or().haveSimpleNameEndingWith("Query")
    .should().resideInAPackage("..core..port.in..");

// Impl de use case: sufixo UseCase (não interface) em core..usecase
classes().that().resideInAPackage("..core..usecase..").and().areNotInterfaces()
    .should().haveSimpleNameEndingWith("UseCase");

// Outbound adapter: sufixo Adapter em adapter.out, implementa um Port do core
classes().that().resideInAPackage("..adapter.out..").and().areNotInterfaces()
    .and().haveSimpleNameEndingWith("Adapter")
    .should().dependOnClassesThat().resideInAPackage("..core..port.out..");

// Núcleo agnóstico (SLF4J liberado: é facade de log)
noClasses().that().resideInAPackage("..core..").should().dependOnClassesThat()
    .resideInAnyPackage("org.springframework..", "jakarta.persistence..", "org.hibernate..", "..adapter..");

// Anel interno: domínio não conhece use cases nem ports
noClasses().that().resideInAPackage("..core..domain..")
    .should().dependOnClassesThat().resideInAnyPackage("..core..usecase..", "..core..port..");

// Controller/Receiver dependem do PORT de entrada, não da impl
noClasses().that().resideInAPackage("..adapter.in..")
    .should().dependOnClassesThat().resideInAPackage("..core..usecase..");

// #3 Composition root: só o config acessa as impls de use case
classes().that().resideInAPackage("..core..usecase..").and().areNotInterfaces()
    .should().onlyHaveDependentClassesThat().resideInAnyPackage("..config..", "..core..usecase..");

// Use case não depende de outro use case
noClasses().that().resideInAPackage("..core..usecase..")
    .should().dependOnClassesThat().resideInAPackage("..core..usecase..");

// Entidades JPA só no adapter
classes().that().areAnnotatedWith(jakarta.persistence.Entity.class)
    .should().resideInAPackage("..adapter.out..");

// DTO/mapper da web moram sob a versão do controller (isolamento de versão; opt-in)
classes().that().resideInAPackage("..adapter.in.web..").and().haveSimpleNameEndingWith("Request")
    .should().resideInAPackage("..adapter.in.web.controller..");
classes().that().resideInAPackage("..adapter.in.web..").and().haveSimpleNameEndingWith("Response")
    .should().resideInAPackage("..adapter.in.web.controller..");
classes().that().resideInAPackage("..adapter.in.web..").and().haveSimpleNameEndingWith("Mapper")
    .should().resideInAPackage("..adapter.in.web.controller..");

// Features independentes (SÓ na organização por feature; só compartilham via core.shared)
slices().matching("..core.(*)..").should().notDependOnEachOther()
    .ignoreDependency(alwaysTrue(), resideInAPackage("..core.shared.."));
slices().matching("..core.(*)..").should().beFreeOfCycles();

// Camadas (Core ← Adapter; config é a cola, fora do layering)
layeredArchitecture().consideringOnlyDependenciesInLayers()
    .layer("Core").definedBy("..core..")
    .layer("Adapter").definedBy("..adapter..")
    .whereLayer("Adapter").mayNotBeAccessedByAnyLayer()
    .whereLayer("Core").mayOnlyBeAccessedByLayers("Adapter");
```

## Referências Oficiais

- Cockburn, Alistair. *Hexagonal Architecture (Ports & Adapters)*, 2005 —
  https://alistair.cockburn.us/hexagonal-architecture/
- Cockburn, Alistair. *Patterns for Effective Use Cases*. Addison-Wesley.
- Evans, Eric. *Domain-Driven Design*; Vernon, Vaughn. *Implementing DDD*; Martin, Robert C.
  *Clean Architecture*.
