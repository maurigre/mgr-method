# 09 — Guia de regras de review (mgr-method)

> **Fonte canônica do `code-analyzer`.** Reprovação SÓ com citação textual de uma regra daqui.
> Sem regra textual explícita, o código está conforme.
>
> Montado pelo `spec-init` (2026-07-14) a partir de: provedora **`arch-layered`** +
> `_shared/arch/regras-transversais.md` (regras universais + perfil de linguagem) +
> `_shared/quality/regras-qualidade.md`. Arquitetura confirmada com o autor.
> Linguagem: **JavaScript (ESM) / Node** — perfil `TS/Node` **adaptado** (não há TypeScript).

---

## Fundamentação Teórica

Arquitetura **em camadas** (Martin Fowler, *Patterns of Enterprise Application Architecture*,
2002 — cap. "Layering"; padrão *Layers* em Buschmann et al., *POSA*). Uma camada superior usa
os serviços da inferior; as inferiores **desconhecem** as superiores.

**Divergência honesta em relação a hexagonal/clean/onion:** o layered **não** faz inversão de
dependência para um centro. A garantia aqui é a **direção top-down** e a **separação de
responsabilidades** — este guia **não** aplica regras de "domínio isolado da infraestrutura".

## Princípios (invariantes — `INV`)

Camadas concretas deste projeto (ver `02-architecture.md`):
**Borda** (`bin/`: launcher + CLI/TUI/dispatch) → **Núcleo** (`src/`: lógica).

1. (INV-1) Camadas: **Borda (`bin/`) → Núcleo (`src/`)**. Não há camada de dados separada — a
   persistência é filesystem, encapsulada em `src/manifest.js`.
2. (INV-2) **Dependência top-down**: `bin/` usa `src/`; **`src/` NUNCA importa `bin/`**.
3. (INV-3) Cada camada **esconde** a inferior da superior: a borda fala com o núcleo por
   funções exportadas, sem vazar detalhes internos.
4. (INV-4) **Layering estrito**: a borda não pula o núcleo (ex.: `bin/` não faz `fs`/`path`
   de recursos do pacote direto — usa `src/bundle.js`).
5. (INV-5) **Separação de responsabilidades**: borda = parse de flags, prompts, formatação,
   exit codes. Núcleo = decisão, orquestração, persistência, validação.
6. (INV-6) **A lógica pertence ao Núcleo** — não vaza para a borda. I/O de terminal no núcleo
   só via **adaptador injetado** (ver `src/prompts.js`).

---

## Regras Obrigatórias (reprovam)

### Design

1. (DES-1) Não retornar `null`/`undefined` como sentinela em regra de negócio; use tipo
   explícito ou vazio.
2. (DES-2) Construa objetos já em estado válido; valide invariantes na criação.
3. (DES-3) Só altere o estado de referências que você criou; não mute objetos alheios.
4. (DES-4) Favoreça a coesão através do encapsulamento.
5. (DES-5) Módulos da borda 100% coesos: todo export é usado.
6. (DES-6) Módulos do núcleo 100% coesos: todo export é usado.
7. (DES-7) Não crie módulo/função que só delega para outra camada.
8. (DES-8) Estruturas de entrada/saída nascem prontas; imutáveis por padrão.
9. (DES-9) Mutação existe só quando há necessidade real — não como padrão.
10. (DES-10) Camadas/indireções intermediárias sem função explícita são proibidas.
11. (NAM-1) Nomes de variáveis, funções e módulos expressam o que armazenam ou fazem.
12. (NAM-2) Proibido nome de uma letra ou sem significado (`a`, `b`, `x`, `tmp`, `data`,
    `obj`). Exceções: índices de laço curto (`i`, `j`) e parâmetro de lambda de uma expressão.

### Testes

1. (TST-1) Priorize as versões reais dos objetos.
2. (TST-2) Use stubs/fakes apenas nas **bordas** (I/O de terminal, subprocesso, rede).
3. (TST-3) Use boundary testing para escolher valores.
4. (TST-4) Use MC/DC como critério de cobertura de decisão.
5. (TST-5) Proibido matcher genérico; configure o stub com valores reais.

### Logs

1. (LOG-1) Log/`console` de informação antes e logo depois de **alterar estado em disco**.
2. (LOG-2) Log de informação antes e logo depois de acessar rede/subprocesso.
3. (LOG-3) Erro só em `catch`; exceção: log de erro para métrica sem relançar.
4. (LOG-4) Debug apenas em condicionais que interrompem fluxos.

### Mutation testing

1. (MUT-1) Concentre a mutação no núcleo (`src/`), onde há decisão.
2. (MUT-2) Exclua a borda (`bin/`) — valide-a por smoke test do CLI.
3. (MUT-3) Exclua o puramente estrutural (constantes, catálogos sem lógica).
   Ferramenta Node: **StrykerJS** — `[A CONFIRMAR — não adotado]`.

> **Racional (MUT):** concentrar a mutação onde há decisão de negócio maximiza o retorno; o
> score passa a refletir a capacidade dos testes de detectar alterações reais na lógica.

---

## Perfil da linguagem — JavaScript/Node (ESM) — `[ADAPTADO — perfil TS/Node sem TypeScript]`

1. (TS-1) Estrutura: borda em `bin/`, núcleo em `src/`.
2. (TS-2) O núcleo não depende de biblioteca de UI/TUI (`@clack`) nem de `process.argv` —
   recebe dados/adaptadores da borda.
3. (TS-3) Retorno explícito; evite `null`/`undefined` como sucesso. Erros → `throw` com
   mensagem específica.
4. (TS-4) Testes: **`node:test`** nativo; objetos reais (TST-1).
5. (TS-5) Stubs só na borda (adaptador de prompts, subprocesso) — sem matcher genérico (TST-5).
6. (TS-6) Mutation: StrykerJS, focado em `src/` — `[A CONFIRMAR]`.
7. (TS-7) Enforce de dependência: **ativo** — `no-restricted-imports` (core do ESLint) proíbe
   `src/ → bin/` (INV-2). `dependency-cruiser`/`eslint-plugin-boundaries` foram **rejeitados**:
   duas camadas e uma regra não justificam a dependência (ADR-0002).
8. (TS-8) Imutabilidade: `const`, objetos congelados quando fizer sentido; validação na criação.
9. (TS-9) Lint: **ESLint ativo** — `eslint.config.js` (flat config), `npm run lint`, gate no CI.
10. (TS-10) `bin/mgr.cjs` **tem de continuar ES5** — roda antes do guard de versão e é ele que
    entrega a mensagem legível em Node < 22. Enforçado por `ecmaVersion: 5` (sintaxe moderna =
    erro de parse).

---

## Qualidade de código

### Regras universais (`QUAL`) — reprovam

1. (QUAL-1) Não retornar `null` como sentinela em regra de negócio; use tipo explícito/vazio.
2. (QUAL-2) Validar a entrada na borda; **fail fast** com erro específico.
3. (QUAL-3) Imutabilidade por padrão; mutabilidade só quando há necessidade real.
4. (QUAL-4) Funções e módulos pequenos, coesos, com nomes que expressam o que fazem.
5. (QUAL-5) Recursos sempre liberados (handles de arquivo, subprocessos).
6. (QUAL-6) Sem código morto, sem duplicação, sem parâmetro booleano ambíguo, sem excesso de
   parâmetros.

### Perfil de qualidade — Node/ESM `[ADAPTADO]`

- **Idiomas:** `strict` não se aplica (JS puro); evitar coerção implícita; união discriminada
  em vez de flags booleanas; `throw new Error("mensagem específica")`, nunca string.
- **Estilo/lint:** **ESLint ativo** (`eslint.config.js`, `js.configs.recommended`) — `npm run lint`
  é gate no CI. Convenções vigentes observadas no código: 2 espaços, aspas duplas, ponto e
  vírgula, `const`/`let` (nunca `var` no ESM).

---

## Boas Práticas (não reprovam — opt-in)

1. **Enforcement automatizado da direção de dependência** — `dependency-cruiser`/eslint-boundaries
   codificando `src/ ↛ bin/`. Governança: o arch-lint é **guard-rail, não obstáculo a burlar** —
   nunca enfraquecer regra para o código passar; violação = drift → **conserte o código**;
   mudança de regra só quando a arquitetura muda de propósito, via **ADR**.
2. **Convenções de nomenclatura** — módulos do núcleo em `camelCase.js`; exports nomeados.
3. **Screaming Architecture** (Robert C. Martin — prática transversal, **não** regra do layered):
   a estrutura deve "gritar" o domínio. `[A CONFIRMAR]` — hoje `src/` grita a técnica
   (`installer`, `builder`, `validator`), o que é aceitável para uma CLI pequena.

---

## Anti-patterns específicos de Layered (reprovam)

- Lógica de negócio na **borda** (`bin/`) em vez do núcleo (`src/`).
- Camada **inferior** conhecendo/importando a **superior** (`src/` importando `bin/`) — INV-2.
- **Pular camadas**: a borda acessando recursos do pacote sem passar por `src/bundle.js` — INV-4.
- Módulo do núcleo fazendo I/O de terminal direto (prompt/print) — deve receber **adaptador
  injetado** (padrão do `src/prompts.js`) — INV-6.
- Módulo **pass-through anêmico**, que só repassa a chamada — DES-7/DES-10.

## Checklist (guard-rails da IA — antes e depois de gerar/alterar código)

- A **lógica** está no núcleo (`src/`), não na borda (`bin/`)?
- As **dependências vão só de cima para baixo**? Nenhum `src/` importando `bin/`?
- Nenhum módulo do núcleo faz I/O de terminal sem adaptador injetado?
- Recursos do pacote são acessados **só** via `src/bundle.js`?
- Testes com objetos reais (TST-1), stub só na borda (TST-2), sem matcher genérico (TST-5)?
- Nomes significativos (NAM-1, NAM-2)?
- **Não** se criou teste para código sem lógica só para bater métrica (anti-inflação)?

## Referências

- Fowler, Martin. *Patterns of Enterprise Application Architecture*. Addison-Wesley, 2002
  (cap. "Layering").
- Buschmann, F. et al. *Pattern-Oriented Software Architecture, Vol. 1* — padrão **Layers**.
- Martin, Robert C. — *Screaming Architecture* (citado como prática transversal opt-in).
