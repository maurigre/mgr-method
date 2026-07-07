# Regras transversais das arquiteturas (fonte única)

Este arquivo é a **fonte única** das regras que valem para TODAS as arquiteturas suportadas
(hexagonal, clean, onion, layered). As skills `arch-*` o **incluem** ao montar
`docs/sdd/09-review-rules.md`, junto com a Fundamentação e os Princípios específicos de cada
arquitetura. Mantido em um só lugar para não divergir entre as skills.

Vocabulário neutro: "núcleo" = onde vivem as regras de negócio (domínio + casos de uso, ou
entities + use cases); "borda/adaptador" = tudo que traduz para tecnologia externa
(controllers, presenters, gateways, repositories, clients). Cada skill de arquitetura define,
em seus Princípios, os nomes concretos dos anéis/camadas.

> Proveniência: as regras de Design/Teste/Log derivam do guia original do autor
> (backend-java.md), com normalização apenas TIPOGRÁFICA (correção de typos como
> "endpoins"→"endpoints", acentuação e concordância), sem mudança semântica. Regras marcadas
> "extensão do autor" têm a MESMA força citável. Perfil Java = VALIDADO; demais perfis são
> adaptações a validar com o time. Fonte canônica para as citações textuais do `code-analyzer`.

## Regras Obrigatórias (reprovam no review)

### Design para código Orientado a Objetos

1. (DES-1) Não retornar nulo/nil como sentinela dentro das regras de negócio; use tipo
   explícito (Optional/Result/erro idiomático — conforme o perfil).
2. (DES-2) Construa objetos já em estado válido (construtor/factory que valida invariantes).
3. (DES-3) Só altere o estado de referências que você criou; não mute objetos alheios, salvo
   os criados explicitamente para isso.
4. (DES-4) Favoreça a coesão através do encapsulamento.
5. (DES-5) Controllers/handlers precisam ser 100% coesos: todos os métodos usam todos os
   atributos.
6. (DES-6) Services/UseCases precisam ser 100% coesos: todos os métodos usam todos os
   atributos.
7. (DES-7) Não crie Service/UseCase que funcione apenas como delegador para outra camada.
8. (DES-8) DTOs de entrada e saída também nascem prontos pelo construtor; imutáveis por padrão.
9. (DES-9) Setters existem só para permitir alterações reais ou definir valores opcionais —
   não como padrão.
10. (DES-10) Camadas/indireções intermediárias sem função explícita são proibidas.
11. (NAM-1) Nomes de variáveis, métodos e classes expressam, de forma resumida, o que
    armazenam ou fazem. (extensão do autor)
12. (NAM-2) Proibido nome de uma letra ou sem significado (`a`, `b`, `x`, `tmp`, `data`,
    `obj`). Exceções: índices de laço curto (`i`, `j`) e parâmetro de lambda de uma única
    expressão. (extensão do autor)

### Padrões de teste

1. (TST-1) Priorize as versões reais dos objetos.
2. (TST-2) Use mocks/fakes apenas para acesso a banco ou APIs HTTP externas (as bordas).
3. (TST-3) Use boundary testing para escolher valores.
4. (TST-4) Use MC/DC como critério de cobertura de decisão.
5. (TST-5) Proibido matcher de parâmetro genérico (`any()` ou variação); configure o mock com
   parâmetros reais. (ferramenta conforme o perfil)

### Padrões para logs

1. (LOG-1) Log em nível info sempre antes e logo depois de alterar um estado em banco ou
   mensageria (rabbit/kafka).
2. (LOG-2) Log em nível info sempre antes e logo depois de acessar uma API HTTP externa.
3. (LOG-3) Log em nível error apenas em catches; exceção: log de erro para métrica quando não
   se relança a exception.
4. (LOG-4) Log em nível debug apenas em condicionais que interrompem fluxos.

### Escopo de mutation testing

1. (MUT-1) Concentre a mutação no núcleo (regras de negócio), nos pacotes/módulos do projeto —
   nomes concretos conforme o perfil.
2. (MUT-2) Exclua infraestrutura (controllers, adapters, mappers, clientes, persistência,
   config): valide-a por testes de integração.
3. (MUT-3) Exclua o puramente estrutural/trivial (DTOs/records sem lógica, código gerado,
   Value Objects triviais). Value Objects **ricos** (com invariante, validação ou
   comportamento — ex.: `Money`, `CNPJ`) permanecem no escopo. (ferramenta conforme o perfil)

> Racional (MUT): concentrar a mutação onde existem decisões de negócio maximiza o retorno —
> o score de mutação passa a refletir a capacidade dos testes de detectar alterações reais na
> lógica, sem penalizar infraestrutura cuja validação adequada é por testes de integração.

### Perfil da linguagem (grave SÓ o do projeto)

#### Perfil Java / Spring — VALIDADO  (IDs: JAVA-n)
1. (JAVA-1) Estrutura: núcleo = {domain, usecase, ports.in, ports.out}; adapters = {in.rest,
   in.messaging, in.scheduler, out.persistence, out.client, out.cache}; `config` isola o wiring.
2. (JAVA-2) Núcleo = POJO puro: proibido `@Component/@Service/@Entity/@Table/@Column`, JPA,
   Hibernate, Spring, Feign, HTTP.
3. (JAVA-3) Testes: JUnit 5 + AssertJ (`assertThatThrownBy` para exceções); nomes
   `should...When...`; sem `@DisplayName`.
4. (JAVA-4) Mock: Mockito; TST-5 = proibido `any()`/`argThat` genérico — setup com valores reais.
5. (JAVA-5) Mutation: PITest; `targetClasses` em `..domain..` e `..usecase..` (ou
   `application`/`service`/`core`/`interactor` no brownfield — detectar nomes reais).
6. (JAVA-6) Enforce dependência (opt-in — ver Boas Práticas): ArchUnit.
7. (JAVA-7) Logs: SLF4J.
8. (JAVA-8) Nomenclatura (opt-in — ver Boas Práticas): use case em `UseCase`; port em
   `Port`/`Gateway`; adapter em `Adapter`/`Controller`/`Repository`.

#### Perfil Go — [ADAPTADO — validar com o time]  (IDs: GO-n)
1. (GO-1) Estrutura: núcleo em `domain/` e `usecase/` (ou `app/`); ports = interfaces
   declaradas no núcleo; adapters em `adapter/` (in: http, cli, consumer; out: repo, client, cache).
2. (GO-2) Núcleo sem import de framework web/ORM: nada de `net/http`, `database/sql` ou drivers.
3. (GO-3) Erros: DES-1 → retorne `(T, error)` idiomático; nunca `nil` silencioso como sucesso.
4. (GO-4) Testes: pacote `testing`, table-driven; `testify` opcional; objetos reais (TST-1/2).
5. (GO-5) Mock: interfaces + fakes à mão (ou `gomock`/`mockery`); sem matcher genérico.
6. (GO-6) Mutation: `gremlins` (go-gremlins/gremlins) ou `go-mutesting`, focado em domínio/usecase.
7. (GO-7) Enforce dependência (opt-in): `go-arch-lint` ou `depguard` (via golangci-lint).
8. (GO-8) Imutabilidade: construtores `New...` que validam; evite expor campos mutáveis.
9. (GO-9) Logs: `log/slog` (stdlib).

#### Perfil Python — [ADAPTADO — validar com o time]  (IDs: PY-n)
1. (PY-1) Estrutura: `domain/`, `usecase/` (ou `application/`), ports (`Protocol`/`ABC`),
   `adapters/` (in/out).
2. (PY-2) Núcleo sem import de Django/Flask/FastAPI/SQLAlchemy/requests.
3. (PY-3) Tipagem: type hints em tudo; `mypy` no CI. DES-1 → `Optional[...]` explícito.
4. (PY-4) Testes: `pytest`; objetos reais; parametrização para boundary (TST-3).
5. (PY-5) Mock: `unittest.mock` só nas bordas; sem `mock.ANY` — argumentos reais (TST-5).
6. (PY-6) Mutation: `mutmut` ou `cosmic-ray`, focado em domínio/usecase.
7. (PY-7) Enforce dependência (opt-in): `import-linter` (contratos de camada).
8. (PY-8) Imutabilidade: `@dataclass(frozen=True)` ou `pydantic` (validação no construtor → DES-2).
9. (PY-9) Logs: `logging` (stdlib) ou `structlog`.

#### Perfil C# / .NET — [ADAPTADO — validar com o time]  (IDs: NET-n)
1. (NET-1) Estrutura: `Domain`, `Application` (UseCases), `Ports` (interfaces), `Adapters`
   (In: Controllers/Consumers; Out: Persistence/Clients). Referências de projeto só para dentro.
2. (NET-2) Núcleo sem EF Core, ASP.NET, `HttpClient` nem `[Table]`/`[Column]`.
3. (NET-3) Testes: xUnit ou NUnit; FluentAssertions opcional; objetos reais (TST-1).
4. (NET-4) Mock: NSubstitute ou Moq só nas bordas; sem `It.IsAny<>` — argumentos reais (TST-5).
5. (NET-5) Mutation: `Stryker.NET`, focado em `Domain`/`Application`.
6. (NET-6) Enforce dependência (opt-in): `NetArchTest` ou `ArchUnitNET`.
7. (NET-7) Imutabilidade: `record` e propriedades `init`-only; validação no construtor (DES-2).
8. (NET-8) Logs: `Microsoft.Extensions.Logging` (`ILogger`) ou Serilog.

#### Perfil TypeScript / Node — [ADAPTADO — validar com o time]  (IDs: TS-n)
1. (TS-1) Estrutura: `domain/`, `usecase/` (ou `application/`), ports (interfaces/types),
   `adapters/` (in: http/controllers, consumers; out: repositories, clients).
2. (TS-2) Núcleo sem import de express/nest/typeorm/prisma/axios.
3. (TS-3) Tipos: `strict` no tsconfig; DES-1 → retorno explícito; use Result/união discriminada.
4. (TS-4) Testes: Vitest, `node:test` ou Jest; objetos reais (TST-1).
5. (TS-5) Mock: `vi.mock`/`jest.mock` só nas bordas; sem `expect.anything()` no setup (TST-5).
6. (TS-6) Mutation: StrykerJS, focado em domínio/usecase.
7. (TS-7) Enforce dependência (opt-in): `dependency-cruiser` ou `eslint-plugin-boundaries`.
8. (TS-8) Imutabilidade: `readonly`, `as const`, objetos congelados; validação no construtor/factory.
9. (TS-9) Logs: `pino`.

#### Perfil Genérico (fallback) — [ADAPTADO — validar com o time]  (IDs: GEN-n)
Para linguagens sem perfil dedicado (Rust, Kotlin, PHP, Ruby, …). Mantenha as regras acima e
preencha cada slot com o idioma da linguagem:
1. (GEN-1) Ports = a construção de abstração idiomática (interface/trait/protocolo).
2. (GEN-2) Núcleo sem import do framework web/ORM/cliente HTTP da stack.
3. (GEN-3) Teste com o framework padrão da linguagem; objetos reais; mocks só nas bordas.
4. (GEN-4) Mutation: adote a ferramenta idiomática (Rust `cargo-mutants`; Kotlin `pitest`;
   PHP `Infection`; Ruby `mutant`) — `[A CONFIRMAR com o time]`.
5. (GEN-5) Enforce a direção de dependência pelo mecanismo de módulo/lint disponível (opt-in).
6. (GEN-6) Imutabilidade e estado válido pela construção idiomática (record/data class/struct/
   value object).

## Boas Práticas (não reprovam — opt-in; o spec-init oferece e confirma com o time)

1. **Enforcement automatizado da direção de dependência** — as ferramentas de arch-lint de
   cada perfil (ArchUnit, go-arch-lint/depguard, import-linter, NetArchTest, dependency-cruiser).
   Quando adotado (ex.: `archunit: true` no plano/ADR), codifica: núcleo não importa
   framework/ORM/adapters; ports não dependem de adapters; use case não conhece
   web/persistência; sem ciclos entre pacotes.
2. **Convenções de sufixo de nomenclatura** — use case termina em `UseCase`; port em
   `Port`/`Gateway`; adapter em `Adapter`/`Controller`/`Repository` (e equivalentes
   idiomáticos). Confirmar com o time antes de incluir no guia.
3. **Screaming Architecture** — a estrutura de diretórios deve "gritar" o domínio (`orders`,
   `payments`, `shipping`) em vez da tecnologia (`controller`, `service`, `repository`).

## Anti-patterns transversais (reprovam)

- Núcleo importando framework/ORM/HTTP.
- Regra de negócio em controller, adapter ou presenter.
- Objeto de domínio (Entity) cruzando fronteira para fora; endpoint recebendo ou retornando
  tipo de domínio.
- UseCase que só repassa a chamada para o repositório (delegador).
- Dependência apontando para fora: um elemento do núcleo conhecendo/importando a borda.

## Checklist (guard-rails da IA — verifique antes e depois de gerar/alterar código)

- Arquivo do **núcleo**? Então não importa framework/DB/HTTP/mensageria.
- É **borda/adaptador**? Então não contém regra de negócio e implementa/chama uma porta.
- A **dependência aponta para dentro**? Nenhum import núcleo→borda.
- **Fronteiras** não expõem tipo de domínio; DTO/entidade-ORM/mapper vivem na borda.
- Objetos nascem **válidos** (DES-2), coesos (DES-4/5/6), sem delegador (DES-7) nem camada
  inútil (DES-10).
- Testes com objetos reais (TST-1), mock só na borda (TST-2), sem matcher genérico (TST-5).
- Nomes significativos (NAM-1, NAM-2).
