---
name: spec-init
description: Inicializa a estrutura SDD (Specification-Driven Development) de um projeto. Em projeto EXISTENTE, faz análise profunda em fases com chunking e gera /docs/sdd/ (00-overview a 08-glossary), CONSTITUTION.md e o guia de regras de review. Em projeto VAZIO (greenfield), conduz entrevista guiada de stack/arquitetura/domínio e gera os mesmos artefatos a partir das escolhas. Use sempre que o usuário pedir para analisar, documentar ou mapear um projeto, gerar SDD, extrair contratos, fazer onboarding de repositório, iniciar projeto do zero com SDD, ou gerar instruções para Copilot/Cursor. Pré-requisito da skill spec-create.
---

# spec-init — Inicialização SDD

Você inicializa a metodologia SDD num projeto: analisa (brownfield) ou entrevista
(greenfield), e gera `/docs/sdd/` + `CONSTITUTION.md` + `docs/sdd/09-review-rules.md`.
Skill AGNÓSTICA à linguagem e à stack: detecte dinamicamente, nunca assuma.

## Integração mgr-code (obrigatória no início)

Sonde o `mgr-mcp` com uma chamada leve. **ON** → recupere análises, constituições e
decisões anteriores deste projeto/domínio e use como contexto; ao concluir, grave o
resumo da SDD e a constituição na memória. **OFF** → emita visivelmente:

> ⚠️ **mgr-code indisponível** — operando sem memória de longo prazo. Prosseguindo
> apenas com o estado do repositório.

Nunca silencie a ausência; nunca trave por causa dela.

## Passo 0 — Detectar o modo

Inspecione a raiz: existe manifesto de build (pom.xml, build.gradle, package.json,
go.mod, *.csproj, requirements.txt...) ou código-fonte?
- **Sim → modo BROWNFIELD** (análise).
- **Não → modo GREENFIELD** (entrevista). Confirme com o usuário: "Projeto vazio
  detectado — vamos inicializar do zero?"

## Interação inicial (obrigatória, ambos os modos)

1. **Formato de saída:** Claude (SKILL/context) · GitHub Copilot
   (.github/copilot-instructions.md + instructions/ + AGENTS.md) · Cursor
   (.cursorrules + .cursor/rules/*.mdc) · Todos · Apenas SDD markdown.
2. **Escopo:** projeto completo ou módulo específico (pedir path).
3. **Profundidade:** rápida (overview) ou completa (todas as fases).

## MODO BROWNFIELD — Análise em fases com chunking

Projetos reais excedem qualquer janela. NUNCA carregue o projeto inteiro; processe em
camadas progressivas com cache em `.spec-init/cache/` (gitignored) e retomada:

- **Etapa 0 — Indexação leve:** árvore, nomes, tamanhos, primeiras 50 linhas de cada
  arquivo. → `cache/01-index.json`. Nenhum arquivo lido por completo.
- **Etapa 1 — Classificação:** cada arquivo em `manifest, config, controller, entity,
  service, repository, migration, test, infra, doc, other`. → `cache/02-classification.json`.
- **Etapa 2 — Extração por categoria (map):** por fase, ler SÓ a categoria relevante e
  gerar EXTRATOS ESTRUTURADOS em JSON (nunca prosa). → `cache/extracts/<fase>/`.
- **Etapa 3 — Consolidação por módulo (reduce 1):** agrupar extratos mantendo schema.
- **Etapa 4 — Síntese global (reduce 2):** só aqui entra prosa, gerando `/docs/sdd/`.

Limites: ≤ ~30 arquivos completos simultâneos; arquivo > 2000 linhas → janelas de 500
com overlap 50; > 1000 arquivos numa categoria → amostragem estratégica MARCADA no
relatório. Sessão interrompida → próxima invocação retoma do cache (`--fresh` força).

### Fases de análise
1. **Reconhecimento** — linguagens, manifestos, build, monorepo, runtimes.
2. **Stack/Arquitetura** — frameworks, padrão arquitetural, camadas, dependências.
3. **Contratos** — endpoints, OpenAPI/GraphQL/proto, request/response, auth.
4. **Domínio/Dados** — entidades, invariantes, migrations, schema.
5. **Qualidade/Operação** — testes, CI/CD, infra, observabilidade.
6. **Síntese** — gerar `/docs/sdd/00-overview.md` a `08-glossary.md` + `CONSTITUTION.md`
   (princípios arquiteturais, padrões de qualidade e regras não-negociáveis EXTRAÍDOS
   do projeto) + `09-review-rules.md` (ver "Guia de regras", abaixo).

## MODO GREENFIELD — Entrevista guiada

Não há código a analisar: a SDD nasce das SUAS escolhas. Aplique **defaults agressivos**
(pré-preencha com os padrões do usuário quando conhecidos) e **ramificação** (só pergunte
o que se aplica). Cada decisão estrutural gera um ADR via `adr-create` (modo invocado).

Blocos de entrevista (cada um alimenta um artefato):
1. **Stack base** — linguagem+versão, framework (Spring Boot/Quarkus/NestJS/...), build,
   módulo único ou multi-módulo.
2. **Arquitetura** — hexagonal (default) / clean / onion / layered; pacotes por camada ou
   por feature. → **ADR** + delegação à skill `arch-<escolha>` (abaixo).
3. **Domínio & Persistência** — bounded context (nome + 1 linha), modelo rico (default),
   ORM, banco + migrations. → **ADRs**. DTO separado do domínio: obrigatório.
4. **Bordas & Contratos** — REST/gRPC/GraphQL, mensageria (Kafka/RabbitMQ/nenhuma),
   contract-first ou code-first. → **ADRs**.
5. **Testes & Qualidade** — framework de teste, boundary + MC/DC (defaults), política de
   mock (só banco e HTTP externo), estática (Checkstyle/Sonar), ArchUnit sim/não.
6. **Logs & Observabilidade** — convenção de níveis; tracing/métricas (opcional).
7. **Não-negociáveis** — o que é reprovação vs sugestão; sufixos de nomenclatura; idioma.

Saída: os mesmos `/docs/sdd/` + `CONSTITUTION.md` + `09-review-rules.md`, marcando
claramente que nasceram de entrevista (`[ORIGEM: entrevista greenfield]`), e o esqueleto
de diretórios da arquitetura escolhida (sem gerar código de negócio).

## Guia de regras de review (delegação às skills arch-*)

A arquitetura escolhida/detectada define as regras que o `code-analyzer` vai aplicar.
NUNCA embuta regras de arquitetura aqui — delegue:

1. Determine a arquitetura (brownfield: detectada na Fase 2 e confirmada com o usuário;
   greenfield: Bloco 2 da entrevista).
2. Invoque a skill provedora correspondente: `arch-hexagonal`, `arch-clean`, `arch-onion`
   ou `arch-layered`, passando a linguagem do projeto.
3. Ela retorna o guia de regras; grave-o em `docs/sdd/09-review-rules.md`.
4. Registre a escolha num ADR (via `adr-create`, modo invocado).

Se a skill da arquitetura for um stub `[A DEFINIR]`, avise o usuário e grave um guia
mínimo com as regras que ELE ditar (nunca invente regras — Regra de Comportamento 1).

## Regras de comportamento

1. **Não inventar:** detalhe não confirmado por código/config/entrevista → `[A CONFIRMAR]`.
2. **Aprender antes de documentar:** framework desconhecido → buscar doc oficial e citar
   fonte; sem acesso à rede, marcar `[A CONFIRMAR]`.
3. **Privacidade:** nunca incluir secrets reais; usar placeholders (`<DB_URL>`).
4. **Incremental:** docs existentes → comparar e atualizar só o que mudou, com diff e
   aviso antes de sobrescrever edições manuais.
5. **Idempotente:** duas execuções seguidas → mesmo resultado.
6. **Idioma:** o predominante no projeto (default: português se ambíguo).
7. **Fonte única de verdade:** `/docs/sdd/`. Saídas por formato (Copilot/Cursor) são
   DERIVADAS, nunca cópias divergentes.
8. **Chunking obrigatório** no brownfield: indexar → classificar → extrair → consolidar
   → sintetizar.

## Saídas por formato (modelo de execução vs modelo de saída)

Esta skill RODA em ferramenta com filesystem (Claude Code, Cursor Agent). Copilot e
Cursor-rules são CONSUMIDORES passivos: gere para eles arquivos de contexto estático
derivados de `/docs/sdd/`:
- **Copilot:** `.github/copilot-instructions.md` (≤ ~400 linhas: Project Context, Tech
  Stack, Architecture Patterns, Coding Conventions, Domain Glossary, References) +
  `.github/instructions/*.instructions.md` (path-specific com `applyTo`) + `AGENTS.md`
  (Setup, Build & Test, Code Style, Architecture, Domain, Watch out).
- **Cursor:** `.cursorrules` + `.cursor/rules/*.mdc` (architecture, domain, contracts,
  conventions). NUNCA copiar /docs/sdd/ inteiro — sempre referenciar.

## Auto-avaliação (obrigatória ao final)

Gerar `/docs/sdd/_self-assessment.md` com: confiança por seção (Alta/Média/Baixa +
justificativa), pontos cegos, amostragem aplicada, Fatos vs Inferências (forte/fraca),
e 5-15 perguntas para o time elevar a confiança. No greenfield, listar as decisões que
ficaram `[A DEFINIR]`.

## Encerramento

Apresente a `CONSTITUTION.md` gerada e peça **revisão humana explícita** — ela é a base
de tudo que o `spec-create` fará depois. Recomende gitignore de `.spec-init/cache/`.
