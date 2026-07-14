# 08 — Glossário

| Termo | Significado neste projeto |
|---|---|
| **MGR** | Método Governado por Rastreabilidade — o framework SDD deste repo. |
| **SDD** | Specification-Driven Development: plano antes do código; execução fiel ao plano; review ancorado em regra textual. |
| **Skill** | Unidade do método: pasta com `SKILL.md` (frontmatter + instruções para o agente). |
| **Agent Skill** | Padrão aberto de skill consumido por Claude Code / GitHub Copilot. |
| **Motor (engine)** | Ferramenta que consome as skills: `claude-code` (`.claude/skills`) ou `copilot` (`.github/skills`). |
| **Escopo (scope)** | `project` (no repositório) ou `global` (na home do usuário). |
| **Catálogo** | Classificação das skills: **core** · **arquitetura** · **linguagem** · **opcional**. Base da instalação seletiva. |
| **Core** | Skills sempre instaladas: `spec-init`, `spec-create`, `spec-execute`, `adr-create`, `code-analyzer`. |
| **Instalação seletiva** | Copiar só as skills que o projeto usa (a arquitetura escolhida, os helpers da linguagem). |
| **Self-contained** | Modelo atual: conteúdo completo das skills **direto** na pasta do motor; cada motor é independente. |
| **Runtime + lançador** | Modelo **antigo** (≤0.2.x): conteúdo em `.mgr-core/skills` + apontadores finos em cada motor. **Migrado automaticamente.** |
| **`.mgr-core/`** | Config do projeto: `manifest.json` + `.env`. **Não contém skills** no modelo atual. |
| **`MGR_PROJECT_ID`** | Identificador do projeto (em `.mgr-core/.env`) usado pela memória estendida **mgr-code**. |
| **mgr-code** | Memória agêntica de longo prazo (MCP). Opcional: quando OFF, o método avisa e prossegue. |
| **`_shared/`** | Fontes transversais co-localizadas com as skills instaladas: `arch/` e `quality/`. |
| **Fonte transversal** | `regras-transversais.md` (arquitetura) e `regras-qualidade.md` (qualidade): regras comuns + perfis por linguagem, em **fonte única**. |
| **Perfil de linguagem** | Bloco por linguagem (Java/Go/Python/C#/TS/genérico) com ferramenta de teste, lint, mutation e idiomas do canon. |
| **`INV-n`** | Invariante da arquitetura (regra inegociável, citável). |
| **`DES-` / `TST-` / `LOG-` / `MUT-` / `NAM-`** | IDs das regras transversais (design, teste, log, mutation, nomenclatura). |
| **`QUAL-` / `JQ-` / `JS-`** | IDs das regras de qualidade (universais; idiomas Java; estilo Java). |
| **Guia de regras** | `docs/sdd/09-review-rules.md` — o **único** padrão que o `code-analyzer` usa. Sem regra textual, não há reprovação. |
| **Gate de fidelidade** | Regra do `spec-execute`: produzir **o artefato exato do plano** — não dividir, renomear nem "melhorar" por conta própria. |
| **Humble Object** | Padrão aplicado em `src/prompts.js`: a lógica sai da borda e recebe o adaptador de I/O **injetado** (testável sem TTY). |
| **ADR** | Architecture Decision Record no formato Nygard (Status/Context/Decision/Consequences). |
| **Tiers S–F** | Classificação de contexto do `spec-execute` (S sagrado … F logs), com arquivamento a 75% e hand-off. |
| **Anti-compactação** | Regra dura: nunca resumir a conversa nem trocar contexto estruturado por prosa — arquivar em disco. |
