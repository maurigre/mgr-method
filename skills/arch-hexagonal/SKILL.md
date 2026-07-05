---
name: arch-hexagonal
description: Provedora do guia de regras de review para projetos com arquitetura Hexagonal (Ports & Adapters). Invocada pelo spec-init quando a arquitetura do projeto é hexagonal - entrega o guia de regras (design OO, testes, logs) que será gravado em docs/sdd/09-review-rules.md e aplicado pelo code-analyzer. Contém o guia completo validado para Java; outras linguagens adaptam as regras de teste e log. Use quando precisar das regras de dependência e qualidade da arquitetura hexagonal.
---

# arch-hexagonal — Guia de regras (Ports & Adapters)

Você fornece o guia de regras de review para a arquitetura hexagonal. Quando invocada
(tipicamente pelo `spec-init` com a linguagem do projeto), entregue o guia abaixo para
gravação em `docs/sdd/09-review-rules.md`. O guia Java é o validado; para outras
linguagens, mantenha as regras de Design (são agnósticas) e adapte as seções de Testes e
Logs ao ecossistema — marcando adaptações como `[ADAPTADO — validar com o time]`.

## Regra de dependência (resumo estrutural)

Tudo aponta para dentro: `domain ← ports ← use cases ← adapters`. O domínio não conhece
framework, banco nem HTTP; adapters dependem de ports; o domínio define os ports.

---

## O GUIA (gravar como docs/sdd/09-review-rules.md)

> Proveniência: regras transcritas do guia original do autor (backend-java.md) com
> normalização apenas TIPOGRÁFICA (correção de typos como "endpoins"→"endpoints",
> acentuação e concordância), sem qualquer mudança semântica. Seções marcadas como "extensão do autor" foram
> adicionadas e aprovadas pelo autor posteriormente e têm a MESMA força de regra
> citável. Este arquivo embarcado é a
> fonte canônica para as citações textuais do `code-analyzer`.

### Regras de Design para código Orientado a Objetos

1. Não retornamos nulo dentro das regras da aplicação.
2. Separamos as bordas externas do sistema do seu núcleo. Métodos que representam
   endpoints não recebem parâmetros do tipo de domínio. Apenas de tipos criados
   especificamente para representar o payload.
3. Os retornos de métodos que representam endpoints são objetos de classes criadas
   especificamente para isso.
4. Usamos o construtor para criar o objeto no estado válido.
5. Só alteramos o estado de referências que criamos. Não mexemos nos objetos alheios.
   A não ser que esse objeto seja criado explicitamente para isso.
6. Favorecemos a coesão através do encapsulamento.
7. Controllers precisam ser 100% coesos. Todos métodos devem usar todos atributos.
8. Services/UseCases precisam ser 100% coesos. Todos métodos devem usar todos atributos.
9. Não devemos ter Service/UseCases que funcionam apenas como delegador para outra camada.
10. Priorize o uso do construtor no dto de entrada e saída também.
11. Setters só existem para possibilitar alterações de valores ou para definição de
    valores opcionais.
12. Classes de domínio devem depender apenas de outras classes de domínio.
13. Camadas intermediárias sem função explícita são ruins.

### Padrões de teste

1. Priorizamos utilizar as versões reais dos objetos.
2. Utilizamos mocks apenas para acesso a banco de dados ou APIs HTTP externas.
3. Utilizamos boundary testing para definir valores.
4. Utilizamos MC/DC como técnica de cobertura de código.
5. É proibido usar any() ou qualquer variação de matcher de parâmetro. Quando for
   utilizar mocks, realize o setup com parâmetros reais.

### Padrões para logs

1. Log em nível de info sempre antes e logo depois de alterar um estado no banco de
   dados, mensageria (rabbit ou kafka).
2. Log em nível de info sempre antes e logo depois de acessar uma API HTTP externa.
3. Log em nível de erro deve ser feito apenas em catches; algumas exceções podem ter
   logs de erro para métricas em cenários onde não mandamos a exception mas mandamos o
   log de erro.
4. Log em nível de debug deve ser feito apenas em condicionais que interrompem fluxos.

---

## Escopo do PITest (Mutation Testing)

O PITest deve concentrar-se nas camadas que contêm as regras de negócio — o núcleo do
hexágono. Em geral, isso significa incluir os pacotes `..domain..` e `..usecase..` **ou
equivalentes na nomenclatura do projeto** (`application`, `service`, `core`,
`interactor`); no brownfield, detectar os nomes reais dos pacotes antes de configurar o
`targetClasses`.

Componentes de infraestrutura — controllers, adapters, mappers, clientes HTTP,
persistência e configuração — normalmente ficam fora do escopo de mutação: tendem a ser
melhor validados por testes de integração, e mutá-los costuma aumentar o tempo de
execução sem ganho proporcional na qualidade dos testes.

Mesmo dentro do núcleo, excluir apenas o que for puramente estrutural ou trivial:
DTOs/records sem lógica, código gerado, Value Objects **triviais**. Value Objects
**ricos** (com invariantes, validação ou comportamento — ex.: `Money`, `CNPJ`)
permanecem no escopo: são regra de negócio, coerente com a constituição de objetos ricos.

A estratégia é maximizar o retorno do mutation testing concentrando-o onde existem
decisões de negócio: o score de mutação passa a refletir a capacidade dos testes de
detectar alterações reais na lógica, sem penalizar infraestrutura cuja validação
adequada é por meio de testes de integração.

### Nomenclatura e clareza (extensão do autor — 2026-07)

1. Nomes de variáveis, métodos e classes devem expressar o que armazenam ou fazem, de
   forma resumida.
2. É proibido nome de uma letra ou sem significado (`a`, `b`, `x`, `tmp`, `data`,
   `obj`). Exceções permitidas: índices de laços curtos (`i`, `j`) e parâmetros de
   lambda de uma única expressão.

---

## Complementos opcionais (oferecer ao spec-init, não impor)

- **ArchUnit:** se o projeto adotou (`archunit: true` no plano/ADR), sugerir as regras
  que codificam a dependência: domínio não importa Spring/JPA/adapters; ports não
  dependem de adapters; use case não conhece web/persistência; sem ciclos entre pacotes.
- **Nomenclatura:** use case termina em `UseCase`, port em `Port`/`Gateway`, adapter em
  `Adapter`/`Controller`/`Repository` — confirmar com o time antes de incluir no guia.
