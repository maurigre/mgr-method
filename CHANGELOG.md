# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) · [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]
### Planejado
- Suporte a Cursor como motor de instalação.
- Modo scaffold (geração de estrutura de código no greenfield).

## [0.3.8] - 2026-07-14
### Alterado
- Refactor (Humble Object): a coleta de prompts do `install` saiu do `bin/mgr.js` para
  `src/prompts.js`, recebendo o adaptador de prompts **injetado** (clack no CLI, stub nos
  testes). Comportamento inalterado.
### Adicionado
- Testes: smoke dos comandos do CLI (`status`/`update`/`uninstall`/`build`/`validate`/`list`/
  `version`/`help`, dry-run e caminhos de erro) e da coleta de prompts **sem TTY**.
  Cobertura de linhas: 81,44% → **96,95%** (todo o `src/` a 100%).

## [0.3.7] - 2026-07-08
### Corrigido
- A fonte `shared/quality/regras-qualidade.md` agora é instalada (`_shared/quality/`) e o
  `spec-init` referencia `_shared/arch`/`_shared/quality` (co-localizadas), em vez do caminho
  antigo `.mgr-core/shared/...` (inexistente no modelo autossuficiente) — corrige a montagem da
  seção de qualidade do guia introduzida no 0.3.6.

## [0.3.6] - 2026-07-08
### Adicionado
- `spec-execute`: **gate de fidelidade ao plano** (reafirma o artefato exato antes de cada task;
  proíbe alterar forma/quantidade/nome por conta própria) + **auto-review por task** +
  disciplina de trilho (buscar fonte sólida ou perguntar) e economia de tokens.
- Fonte única `shared/quality/regras-qualidade.md`: regras de qualidade por linguagem em duas
  camadas — idiomas/design (Java validado com *Effective Java*/Bloch; ex.: `Optional` nunca como
  parâmetro) e estilo/lint (Google Checkstyle); demais linguagens `[ADAPTADO]`. Aplicadas pelo
  `spec-execute` ao codificar e citadas pelo `code-analyzer`.
### Alterado
- `spec-init` passa a gravar a seção **Qualidade de código** no `09-review-rules.md`.

## [0.3.5] - 2026-07-08
### Adicionado
- Convenção Hexagonal (perfil Java, opt-in): DTOs (`...Request`/`...Response`) e mappers da web
  moram sob a versão do controller (`controller.v1.dto`/`mapper`), isolando o contrato por versão
  da API — com regras ArchUnit. Dispensável em APIs sem versionamento.

## [0.3.4] - 2026-07-08
### Adicionado
- Refino da convenção Hexagonal (perfil Java): `Command`/`Query` co-locados com o input port;
  `config` como composition root (regra ArchUnit dedicada); relação entre domínios (Shared
  Kernel, referência por ID, ACL por port — DDD, Evans/Vernon); estrutura de adapters
  web/rabbit/persistence/client com sufixos `Controller`/`Receiver`/`RepositoryAdapter`/`ApiAdapter`.
### Alterado
- Organização de pacotes documentada como escolha neutra (por feature × por camada, via ADR);
  Screaming Architecture creditada a Robert C. Martin (prática transversal), não ao Cockburn.
- Regras ArchUnit passam a usar `..core..X..` (servem organização por camada e por feature).

## [0.3.3] - 2026-07-08
### Adicionado
- Governança do enforcement de arquitetura (guard-rail; nunca enfraquecer regra; drift corrige
  o código; mudança de regra via `adr-create`) nas Boas Práticas transversais.
- Perfil Hexagonal + Java (validado): convenção de nomes/pacotes (`core.*`,
  `...UseCasePort`/`...UseCase`/`...Adapter`) e ruleset ArchUnit de referência.
- Nota de Enforcement em `arch-clean`/`arch-onion`/`arch-layered` (traduzir os `INV` para a
  ferramenta de arch-lint do perfil da linguagem).

## [0.3.2] - 2026-07-07
### Adicionado
- Guard de versão do Node no CLI: em Node < 22, mensagem clara em vez de crash minificado
  (launcher CJS `bin/mgr.cjs`).
### Corrigido
- README: a tabela de skills não descreve mais `arch-clean`/`arch-onion`/`arch-layered` como
  stubs (já são canônicas).

## [0.3.1] - 2026-07-07
### Corrigido
- `install` não quebra mais ("find is not a function") quando há instalação anterior detectada.

## [0.3.0] - 2026-07-07
### Alterado
- Instalação **seletiva**: pergunta linguagem e arquitetura e copia só as skills usadas.
- Modelo **autossuficiente por motor**: skills direto na pasta do motor, sem `.mgr-core/skills`
  nem lançadores.
- `.mgr-core/` passa a ser **config do projeto** (`manifest.json` + `.env` com `MGR_PROJECT_ID`
  para o mgr-code).
### Adicionado
- Migração automática de instalações no modelo antigo (runtime-launcher) no `install`/`update`.
- Flags `--language`, `--arch`, `--project-id`, `--all-skills`.

## [0.2.0] - 2026-07-07
### Adicionado
- Guias de arquitetura **canônicos e completos**: `arch-clean` (Martin), `arch-onion`
  (Palermo), `arch-layered` (Fowler) — deixam de ser stubs.
- Fonte transversal única (`shared/arch/regras-transversais.md`) com perfis de linguagem
  (Java/Go/Python/C#/TS + genérico).
- Cobertura de testes e badges no README (CI, coverage, npm, node, license).
### Alterado
- `arch-hexagonal` reestruturada em template agnóstico (invariantes + design + testes/logs +
  perfil da linguagem).
- `engines`: Node >= 22 (alinhado ao LTS testado no CI).

## [0.1.3] - 2026-07-06
### Corrigido
- Ajustes no fluxo de publicação no npm (sem mudança funcional).

## [0.1.2] - 2026-07-06
### Corrigido
- Ajustes no fluxo de publicação no npm (sem mudança funcional).

## [0.1.1] - 2026-07-05
### Adicionado
- Primeira publicação no npm.

## [0.1.0] - 2026-07-03
### Adicionado
- Skill `evidence-capture`: registra evidências AI-First por funcionalidade
  (specs/<feature>/ai/ + índice global ai/index.md); organiza e pergunta, nunca inventa
  o julgamento crítico. Inclui o prompt de criação da própria skill.
- Skill `spec-execute`: fase de execução separada do `spec-create` (SRP), com as
  premissas de desenvolvimento explícitas e retomada direta de execução interrompida.
- TUI do instalador (@clack/prompts): banner ASCII com créditos,
  multiselect de motores (instala em vários de uma vez), select de escopo, spinner.
- Fluxo SDD completo como Agent Skills: `spec-init` (análise brownfield com chunking +
  entrevista greenfield), `spec-create` (brief→PRD→spec→plano P0/P1/P2+DAG→execução→
  completion, 6 checkpoints, tiers de contexto S–F com hand-off e anti-compactação),
  `adr-create` (Nygard, auto-detecção, modo invocado), `code-analyzer` (Restrição
  Crítica sobre o guia do projeto), `junit-clean` (13 regras).
- Provedoras de arquitetura plugáveis: `arch-hexagonal` (guia Java completo) +
  `arch-clean`/`arch-onion`/`arch-layered` (stubs honestos).
- CLI `mgr` em Node (zero dependências): install · status · update · uninstall ·
  build · validate · list · version; duas fases + `--dry-run`; manifesto em
  `.mgr-core/manifest.json`; lançadores por motor (claude-code, copilot, both).
- Integração mgr-code em todas as skills (sondar, usar se disponível, alertar se não).
