# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) · [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]
### Planejado
- Suporte a Cursor como motor de instalação.
- Modo scaffold (geração de estrutura de código no greenfield).

## [0.7.0-beta.1] - 2026-08-26
> Fase 2 da evolução: o MGR passa a **propor** as skills que o projeto justifica, em vez de
> esperar que você saiba os nomes. Pré-release no dist-tag `next`.

### Adicionado
- **Detecção de ecossistema e sugestão de skills** (ADR-0009). O MGR lê uma lista fechada de
  caminhos conhecidos — `pom.xml`, `build.gradle`, `package.json`, `docker-compose.*` e
  `src/main/resources/application.*` — e propõe as skills publicadas que atendem ao que
  encontrou, **mostrando o arquivo que justificou cada sugestão**.
- **`mgr detect`**: mostra o que foi detectado e o que os registries oferecem. Não escreve
  nada. Com `--hook <motor>`, emite o relatório que o hook de sessão consome.
- **Sugestão ao fim do `mgr install`**, em terminal interativo. Aceitar entra no mesmo fluxo
  do `mgr add`: a confirmação que mostra origem, permissões e checksum continua sendo a
  última palavra. Sem terminal interativo, informa e não instala.
- **Hook de início de sessão por motor**, gravado a partir dos motores escolhidos na
  instalação: a próxima sessão do agente já sabe o que está disponível sem você rodar nada.
  Verificado por experimento nos dois CLIs. Fica em arquivo local e gitignored
  (`.claude/settings.local.json`, `.github/copilot/settings.local.json`), nunca global e
  nunca commitado; `--no-hooks` desliga e `mgr uninstall` remove.
- **Campo `ecosystems` no manifest** e no índice do registry: a skill declara a que
  ecossistema serve. Vocabulário aberto — declarar um que o detector ainda não conhece é
  válido e simplesmente não sugere. Sem o campo, a skill só é instalável por nome.
- **Modo de detecção** em `.mgr-core/config.json`: `suggest` (default) e `manual`.

### Segurança
- **O conteúdo dos seus arquivos é evidência, nunca fonte de execução.** Serviços saem de
  marcadores ancorados (`image: postgres`, `jdbc:postgresql:`); não há parser de YAML, e
  nada lido do projeto vira nome de skill, URL ou comando. O casamento acontece só entre
  tokens do CLI e o campo publicado no índice.
- **A detecção não é feita por um agente.** Um agente precisaria ler seus arquivos para
  dentro do contexto, que é exatamente o vetor de prompt injection que a decisão D03 nomeia.
  O gatilho é da plataforma; a leitura é de um detector determinístico.
- **O canal hook → contexto do agente carrega apenas fato apurado** (ecossistema, nome do
  arquivo-evidência, nome e versão da skill). Nenhum byte de conteúdo do projeto atravessa.
- **O modo `auto` não existe ainda** e é recusado com erro explícito. Instalar sem
  confirmação humana depende de `mgr audit`; até lá, `trusted` é apenas uma flag digitada, e
  isso não basta. A garantia de "toda instalação é confirmada por uma pessoa" segue inteira.
- O MGR só toca a **própria entrada** nos arquivos de configuração de agente, identificada
  por marcador; nunca reescreve o arquivo, e reinstalar não duplica.

### Observações
- O hook do Copilot só carrega **depois que você confia na pasta**; a primeira sessão
  pergunta, e nada acontece até aceitar. O `mgr install` avisa.
- Detecção cobre a raiz do repositório (mais o caminho convencional do Spring), não módulos
  em subpastas de monorepo, e identifica o ecossistema, não o framework dentro dele.
- `@mgr/junit-clean` foi republicada como `1.1.0` declarando `java`; `@mgr/diagnosing-bugs`
  segue em `1.0.0`, sem ecossistema — diagnosticar bug não pertence a um.
## [0.6.0-beta.2] - 2026-08-25
> Corrige um defeito destrutivo da `0.6.0-beta.1` e transforma a colisão entre skill do
> método e plugin em decisão do usuário (ADR-0008). Pré-release no dist-tag `next`.

### Corrigido
- **Instalar um plugin já não apaga a skill do método de mesmo nome.** Na `0.6.0-beta.1`,
  `mgr add @mgr/diagnosing-bugs` (ou `@mgr/junit-clean`) escrevia por cima da skill do
  método, que sumia sem aviso e sem registro, e o `mgr remove` seguinte apagava a pasta.
  Atingia toda instalação, porque `diagnosing-bugs` é skill de núcleo.
- **`mgr remove` só apaga pasta comprovadamente sua** — exige o `mgr-manifest.json`
  correspondente. Pasta de outra skill é preservada e o motivo é avisado.
- **`mgr status` não afirma mais que nada está instalado** quando há plugin travado no
  lockfile sem instalação do método no projeto (saída autocontraditória, com exit 1 indevido).

### Adicionado
- **Colisão com skill do método virou escolha registrada** (ADR-0008): `mgr add` pergunta
  entre instalar ao lado (default, em `<skill>--<registry>`) e substituir a skill do método,
  e grava a resposta no lockfile (campo `replaces`). A decisão viaja no Git e é aplicada sem
  nova pergunta em `mgr install` — inclusive em clone limpo.
- `mgr install`/`mgr update` **pulam** a skill substituída ao instalar o método: a pasta é
  escrita uma vez, com o que foi escolhido, em vez de escrita e sobrescrita. Com o registry
  fora do ar, a falha é explícita e a pasta fica vazia, em vez de conter silenciosamente uma
  versão que ninguém escolheu.
- `.mgr-core/manifest.json` ganha `replaced` e mantém `skills` completo, então deixa de
  afirmar que instalou uma skill que um plugin ocupou — e a skill volta ao remover o plugin.
- **`mgr status` relata divergências entre o lockfile e o disco** (travado mas ausente ou
  diferente), com a sugestão de restaurar. Reporta; nunca corrige em silêncio.

### Segurança
- Pasta ocupada por algo que não é nem o plugin nem uma skill do método continua sendo
  recusada: o instalador nunca escreve sobre conteúdo que não consegue explicar.
## [0.6.0-beta.1] - 2026-08-25
> Pré-release da **Fase 1 da evolução do MGR** (fundação de skills plugáveis), publicada no
> dist-tag `next`. `npm i mgr-method` continua trazendo a 0.5.0 estável.

### Adicionado
- **Skills plugáveis instaláveis por `mgr add`** (ADR-0004 a ADR-0007). Um plugin é uma pasta
  de skill 100% padrão [Agent Skills](https://agentskills.io/specification) com um
  `mgr-manifest.json` na raiz: o frontmatter segue sendo o contrato com as plataformas, o
  manifest é o contrato com o MGR (procedência, categoria, permissões, model/effort).
- **Comandos novos:** `mgr add <@registry/skill>`, `mgr remove <@registry/skill>` e
  `mgr registry add|remove|list`. `mgr list`, `mgr status`, `mgr install` e `mgr update`
  ganham seções e etapas de plugin **apenas quando existem** lockfile ou registry configurado —
  quem não usa plugins tem a saída de antes, travada por teste de regressão contra a baseline
  real da `main`.
- **Registry oficial** [`mgr-registry`](https://github.com/maurigre/mgr-registry): repo Git com
  `index.json` gerado dos manifests (nunca editado à mão) e CI que reprova manifest inválido,
  índice fora de sincronia ou URL publicada que não bate com o checksum anunciado. Estreia com
  `@mgr/junit-clean` e `@mgr/diagnosing-bugs` — as duas seguem no núcleo do pacote.
- **Lockfile `mgr-skills.lock`** na raiz do projeto, versionado: `git clone` + `mgr install`
  reproduz o conjunto exato de skills do time, com integridade verificada. O bloco `applied`
  registra o que cada motor efetivamente traduziu ou degradou.
- **Tradução por motor com degradação explícita:** no Claude Code, `model` e `effort` do
  manifest entram no frontmatter da skill instalada; no Copilot, que não tem onde recebê-los,
  a instalação **não falha** — emite aviso e registra a degradação no lockfile.
- Documentação do formato em [`docs/plugins.md`](docs/plugins.md), com a matriz de suporte por
  plataforma datada e os limites conhecidos desta versão.

### Segurança
- **Toda instalação de plugin exige confirmação humana**, mostrando origem, versão, permissões
  declaradas e checksum antes de escrever qualquer byte. **Não existe flag de bypass**; sem
  terminal interativo o comando falha com mensagem explícita.
- **Integridade obrigatória:** sha256 por arquivo mais checksum agregado do conjunto, validados
  em memória — divergência aborta sem escrever nada. O `restore` resolve no registry travado no
  lockfile, não no configurado na máquina, e recusa versão ou checksum diferentes do travado.
- Caminho de arquivo vindo do registry e pasta de instalação vinda do lockfile são validados
  contra travessia de diretório.
- Vulnerabilidades `high` de dependências transitivas de desenvolvimento corrigidas
  (`brace-expansion`, `fast-uri`, `js-yaml`).

### Corrigido
- `mgr status` não afirma mais que nada está instalado quando há plugin travado no lockfile
  sem instalação do método no projeto (saída autocontraditória, com exit code 1 indevido).

## [0.5.0] - 2026-07-17
### Alterado
- **Inglês é o idioma canônico do conteúdo distribuído** (ADR-0003): as 12 skills, os
  templates, as fontes compartilhadas, o `sdd-check.sh` e o README foram traduzidos pt→en sob
  protocolo de integridade (verificador estrutural + inventário load-bearing conferido por
  arquivo — nada perdido na tradução). Reverte a convenção "skills em pt-BR".
- Fontes co-localizadas renomeadas: `_shared/arch/cross-cutting-rules.md` e
  `_shared/quality/quality-rules.md`; template de revisões do `evidence-capture` vira
  `reviews.md` (a skill honra o nome exigido pelo enunciado do desafio, ex.: `revisoes.md`).
  Os nomes pt legados são removidos automaticamente no `install`/`update`.
- `description` do pacote em inglês (vitrine npm), mantendo a marca.
### Adicionado
- **Idioma de saída configurável (`userLanguage`)**: o `mgr install` pergunta em que idioma as
  skills conversam e geram artefatos (default sugerido do locale; flag `--user-language`);
  gravado no manifesto e resolvido em toda `SKILL.md` via token `{{MGR_USER_LANGUAGE}}` na
  linha `Output language:`. Regra normativa QUAL-7 na fonte única de qualidade. Instalação
  existente que rodar `update` herda `pt-BR` silenciosamente — experiência preservada.
- **CLI bilíngue** (`src/messages.js`): todas as mensagens da borda em en (default) e pt-BR,
  selecionadas por flag > manifesto > locale — TUI, plano, status, help, banner (tagline e
  créditos; a marca não se traduz) e erros da borda. `README.pt-BR.md` com links cruzados.
- Ferramenta de dev `scripts/check-translation.mjs` (fora do tarball): compara traduções com o
  original no git — headings, IDs de regra, blocos de código, listas, tabelas e frontmatter.

## [0.4.0] - 2026-07-15
### Adicionado
- **Skill `diagnosing-bugs`** no núcleo (sempre instalada) — disciplina de diagnóstico de bug
  difícil: exige um loop de reprodução **vermelho** antes de qualquer hipótese (*sinal antes de
  teoria*), 3–5 hipóteses falsificáveis e teste de regressão antes do fix. Acha a causa e para
  (entrega o conserto ao `spec-create`). Adaptada de `diagnosing-bugs` de Matt Pocock (MIT).
- **`code-analyzer` agora revisa dois eixos** — além de *Standards* (o código segue
  `docs/sdd/09-review-rules.md`?), o novo eixo *Spec* verifica se o código **cumpriu a spec de
  origem**. Reprova requisito ausente/parcial citando a linha da spec; scope creep vira reporte
  não-bloqueante; sem spec, abstém-se. Modelo de dois eixos adaptado de `code-review` de Matt
  Pocock (MIT); o *smell baseline* dele foi rejeitado por violar a política de "nunca inventar
  regra".
- **Gates de qualidade que quebram o build** (ADR-0002). Antes, o projeto não tinha linter algum,
  a cobertura era medida mas não bloqueava nada, a convenção de commit era só disciplina humana e
  CVEs não eram verificadas.
  - **ESLint** (flat config): `npm run lint`, com gate no CI. Além do estilo, enforça dois
    invariantes de arquitetura — `src/` nunca importa `bin/` (INV-2) e `bin/mgr.cjs` preso ao
    **ES5** (é ele que dá a mensagem legível em Node < 22).
  - **Gate de cobertura**: `--test-coverage-lines=95` (flag nativa do Node, sem dependência).
    Linhas ≥ 95%; branches fora do gate.
  - **Commitlint** (Conventional Commits **sem scope**, corpo ≤ 100 col, sem atribuição de autoria
    a IA), via hook `commit-msg` em `.githooks/` + `core.hooksPath` — **sem husky** — e no CI.
  - **Auditoria de dependências**: `npm audit --audit-level=high` no CI.
- Nenhuma dependência de **runtime** adicionada; o pacote publicado não muda.

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
