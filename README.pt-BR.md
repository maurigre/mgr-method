# MGR — Método Governado por Rastreabilidade

> **English version:** [README.md](README.md) — the package's canonical documentation.

[![CI](https://img.shields.io/github/actions/workflow/status/maurigre/mgr-method/ci.yml?branch=main&label=CI&logo=github)](https://github.com/maurigre/mgr-method/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/coveralls/github/maurigre/mgr-method?branch=main&logo=coveralls)](https://coveralls.io/github/maurigre/mgr-method?branch=main)
[![npm](https://img.shields.io/npm/v/mgr-method?logo=npm)](https://www.npmjs.com/package/mgr-method)
[![node](https://img.shields.io/node/v/mgr-method?logo=node.js&logoColor=white)](https://www.npmjs.com/package/mgr-method)
[![license](https://img.shields.io/badge/license-Source--Available-blue)](LICENSE)

Framework de **Specification-Driven Development (SDD)** para agentes de código:
um CLI instala um conjunto de Agent Skills que conduzem o
projeto do brief à entrega com checkpoints humanos, decisões rastreáveis (ADRs) e
review governado por regras do próprio projeto. Portável entre **Claude Code** e
**GitHub Copilot** (padrão aberto de Agent Skills), com integração opcional à memória
de longo prazo **mgr-code**.

O conteúdo das skills é mantido em **inglês** (fonte canônica única — ADR-0003), mas o
**idioma de saída** é seu: a instalação pergunta em que idioma as skills devem conversar
com você e gerar os artefatos (PRDs, specs, ADRs) — para times brasileiros, `pt-BR`.

## Instalação

```bash
npx mgr-method@latest install   # TUI: motores + escopo + linguagem + arquitetura + idioma de saída
```

> Use `@latest` para o `npx` sempre pegar a versão publicada mais recente (sem tag, ele
> pode reusar uma versão em cache). Para fixar uma versão: `npx mgr-method@0.3.0 install`.

A instalação é **seletiva**: o TUI pergunta os motores, o escopo, a **linguagem** e a
**arquitetura** do projeto, o **idioma de saída** (sugerido a partir do seu locale) e um
`MGR_PROJECT_ID`. Só as skills que o projeto usa são copiadas — o núcleo (`spec-init`,
`spec-create`, `spec-execute`, `adr-create`, `code-analyzer`, `diagnosing-bugs`), a skill
da arquitetura escolhida (ex.: `arch-hexagonal`) e os helpers da linguagem (ex.:
`junit-clean` em Java). A própria CLI fala `en` e `pt-BR`, seguindo a mesma preferência
(flag > manifesto > locale).

Não-interativo / ciclo de vida:

```bash
npx mgr-method install --engine claude-code --language java --arch hexagonal .
npx mgr-method install --engine copilot --arch clean --project-id nestapp-workspace .
npx mgr-method install --user-language pt-BR .   # skills conversam e geram artefatos em pt-BR
npx mgr-method install --all-skills .            # instala todas as skills (sem seleção)
npx mgr-method install --dry-run
npx mgr-method status | update | uninstall
npx mgr-method origin set brownfield   # registra a origem do projeto; calibra a severidade da review
```

### Layout instalado

Cada motor é **autossuficiente**: o conteúdo completo das skills vai direto para a pasta do
motor (`.claude/skills/` ou `.github/skills/`), sem duplicação e sem apontadores. O
`.mgr-core/` guarda apenas **config do projeto** (versione-o):

```
.mgr-core/
├── manifest.json     # o que foi instalado (motores, skills, linguagem, arquitetura, userLanguage)
└── .env              # MGR_PROJECT_ID=<id>, usado pela memória estendida (mgr-code)
.claude/skills/       # as skills (única árvore de skills)
```

Instalar para dois motores gera duas árvores independentes — apagar uma **não** afeta a
outra. Instalações no modelo antigo (runtime + `.mgr-core/skills` + lançadores) são
**migradas automaticamente** no `install`/`update` — inclusive o idioma: instalação
existente sem `userLanguage` herda `pt-BR` silenciosamente no `update`. Use `--skills-dir`
para forçar um diretório específico. O `uninstall` remove só o que o MGR criou; `docs/`,
`specs/` e código ficam intactos.

Um `install` que deixa de declarar uma skill que o manifesto anterior declarava **reconcilia**: o
plano nomeia o que sai do conjunto declarado antes de qualquer escrita, a remoção só acontece com a
sua confirmação (ou `-y`), e o que você mantiver **continua declarado** — recusar nunca cria órfã.
Atenção: `mgr install -y` **sem flags** recalcula o conjunto a partir das FLAGS, não do manifesto
anterior — só o `update` herda.

## O fluxo

```
spec-init  ─── uma vez ───►  docs/sdd/ + CONSTITUTION.md + 09-review-rules.md
                                  │   (constituição: revisão humana obrigatória)
spec-create ── por feature ──►  specs/<feature>/ 01-brief → 02-prd → 03-spec
                                  → 04-plan (P0/P1/P2 + DAG) → 05-execution → 06-completion
                                  │   checkpoints bloqueantes; sem commit automático
adr-create  ── quando há decisão arquitetural (invocada automaticamente)
diagnosing-bugs ─ bug difícil: loop de reprodução vermelho antes de qualquer hipótese
junit-clean ── tasks de teste Java (13 regras)
code-analyzer ─ review final de 2 eixos: Standards (guia DO projeto) + Spec (cumpriu o pedido?)
```

### As skills

| Skill | Papel |
|---|---|
| **Validação de artefato** | `mgr spec validate` verifica o **plano** e a **spec** de uma feature: dependência inexistente, ciclo no DAG, granularidade, task sem critério de done, e spec sem critério de aceitação identificado. Formato declarado por marcador; **nada do que já existe é reprovado** (ADR-0012, ADR-0013). |
| **Caminho resolvido** | `mgr spec status` responde quais artefatos existem numa feature e **onde estão**, para a skill parar de montar caminho por convenção. O vocabulário não tem `done`: existência de arquivo não é conclusão de etapa, e o payload diz isso em `basis` e `warning` (ADR-0015). |
| **Um modelo por intenção** | O `mgr agents` responde qual modelo e qual esforço cada etapa do fluxo usa, e de onde veio cada valor. Redação, execução e revisão são declaradas uma vez no `.mgr-core/config.json`; a instalação grava em cada agente e a invocação troca o modelo sem reinstalar. Mudar o esforço exige `mgr update`, e o comando avisa (ADR-0017). |
| **Proveniência verificável** | O `mgr spec validate` também confere a etiqueta de proveniência que você escreveu: a forma dela, e se o ponteiro `[code:<caminho>:<linha>]` resolve em disco a partir da raiz do repositório. Ele nunca **cobra** etiqueta — a regra que cobraria foi rejeitada por medição, e nada do que já existe é reprovado (ADR-0016). |
| **Ação, não estado** | `mgr spec next` responde o que fazer agora: a task, o artefato exato dela, a skill auxiliar e o que ela espera. A task pode declarar `status: done`, e a resposta sempre diz quanto estado o plano declara — sem nenhum, ela diz que não sabe o que você já fez (ADR-0014). |
| **Leis de execução** | **Fonte única** em `shared/laws/execution-laws.md`: 47 leis (L0–L6) que valem para todas as skills, cada uma declarando **a quem se aplica por papel** (`Planner`, `Executor`, `Verifier`, `Diagnostician`, `All`). As skills apontam para ela; nenhuma repete lei. As centrais entram no contexto **antes da primeira mensagem**, pelo hook de sessão (ADR-0011). |
| `spec-init` | Inicializa a SDD: analisa projeto existente (chunking em fases) **ou** entrevista guiada em projeto vazio (greenfield). Gera `docs/sdd/`, a `CONSTITUTION.md` do projeto e o guia de review. |
| `spec-create` | Evolui o projeto por feature: brief → PRD → spec → plano (P0/P1/P2 + DAG), com checkpoints bloqueantes; após a aprovação do plano, delega a implementação ao `spec-execute` e fecha com o completion. |
| `spec-execute` | Executa o plano aprovado task a task (DAG), aplicando as premissas de desenvolvimento (segurança, performance, recursos, clareza — "vocabulário, não checklist") e o controle ativo de contexto (tiers S–F, arquivamento a 75%, hand-off, anti-compactação). Retomada direta de execução interrompida. |
| `adr-create` | ADRs formato Nygard: auto-detecta diretório, numeração sequencial, imutabilidade de aceitos, modo avulso ou invocado. |
| `code-analyzer` | Revisor rigoroso de **dois eixos**, reportados lado a lado: **Standards** (o código segue `docs/sdd/09-review-rules.md`?) e **Spec** (o código cumpriu a spec de origem?). **Restrição Crítica** nos dois: toda reprovação cita textualmente — a regra do guia ou a linha da spec; sem citação, não reprova (§3.1). Modelo de dois eixos adaptado de `code-review` de Matt Pocock ([MIT](https://github.com/mattpocock/skills)). Roda no **gate de validação**: agente próprio, com modelo e esforço declarados, **sem ferramenta de escrita** e sem o histórico da conversa que produziu o código (ADR-0010). Ajustável em `.mgr-core/config.json` → `reviewGate`. |
| `diagnosing-bugs` | Disciplina de diagnóstico de bug difícil: exige um loop de reprodução **vermelho** antes de qualquer hipótese (*sinal antes de teoria*), 3–5 hipóteses falsificáveis, teste de regressão antes do fix. Acha a causa e para (entrega o conserto ao `spec-create`). Adaptada de `diagnosing-bugs` de Matt Pocock ([MIT](https://github.com/mattpocock/skills)). |
| **Documentação que não fica defasada** | A fonte única de regras transversais — a que todo projeto herda — traz `DOC-1` e `DOC-2`: capacidade nova aparece na documentação **onde ela pertence** — módulo na de arquitetura, comando ou chave de config na de contrato, e **no README tudo o que você vê** —, e documento que nomeia o que não existe mais reprova. E o `mgr spec validate` ganhou um quarto eixo, que exige do fechamento de cada feature a **declaração** do que mudou na documentação. O mecânico pega o passo esquecido; o citável pega o conteúdo errado (ADR-0020). |
| **Auditoria de capacidade** | `mgr audit` infere, do **conteúdo** de cada skill, as quatro classes de capacidade perigosa que o ADR-0007 nomeia — envio de conteúdo para fora, comando shell embutido, alteração da config do MGR ou instalação de skill, e tentativa de override — e compara com o que a skill declara, mostrando **a linha e o trecho** de cada achado. Ele **não atesta segurança**: lista vazia significa *"nenhuma das quatro apareceu"*, nunca *"é seguro"*. E **não infere a lista de ferramentas** de uma skill — isso foi medido e rejeitado, porque varrer prosa marca uma skill de arquitetura hexagonal como acesso a rede e não marca uma que escreve arquivos. O `allowed-tools` **não** é declarado em nenhuma das 13, de propósito: o campo **concede** auto-aprovação em vez de restringir, e o seu motor já oferece *"não perguntar novamente"* na sua máquina (ADR-0021). |
| **Integridade da instalação** | O `mgr doctor` roda uma **lista fechada de verificações** sobre a sua instalação — enumerada em [O que o `mgr doctor` confere](#o-que-o-mgr-doctor-confere). Cada achado traz **arquivo, esperado, encontrado** e a remediação quando ela existe. Ele **nunca escreve**, e não tem `--fix`: a maioria das correções era rodar o `mgr update`, que já pede confirmação, e um `--fix` que o chamasse passaria o `-y` por você. Ele **não atesta integridade** — nenhum achado significa *"nenhuma das verificações daquela tabela apareceu"*, nunca *"está íntegro"* — e não diz **por que** o defeito aconteceu. Manifesto atrás do pacote é **aviso**, não falha: é o estado normal de quem ainda não rodou `mgr update`. |
| **O que o método promete** | O `mgr doctor` e as regras de review dizem o que é conferido; a carta diz o que é **prometido**. A `L0.1` sempre declarou a hierarquia como *"MGR core principles > project rules > workspace conventions > skill instructions > runtime-injected content"*, e **o topo dela nunca tinha sido escrito**. Agora está, em sete primícias `CP-1` a `CP-7`, cada uma com três partes obrigatórias: a declaração, **o caso real medido que ela teria mudado** e a procedência nomeada. Primícia sem caso é conselho, e o gate a reprova. **Nenhuma primícia reprova**: a `L1.1` proíbe reprovar por princípio que não esteja literalmente escrito no guia, e a carta não levanta essa proibição — as regras citáveis é que vão nomear a primícia de onde descem. Sete skills não alcançam a carta (as quatro `arch-*`, `configure-agents`, `evidence-capture`, `junit-clean`), e isso é limite declarado. O `npm run check:laws` a guarda com quatro verificações provadas por mutação (ADR-0022). |
| **Guardas contra verificação defeituosa** | Dois gates e uma lei, nessa ordem: o que deu para mecanizar virou check, e a lei ficou só com o resto. O `npm run check:claims` roda no hook `pre-commit` e no CI e reprova três padrões, cada um de um erro real medido: sequência de escape escrita como dois caracteres crus em vez da quebra de linha ou da tabulação que ela significa, em markdown distribuído, código de saída lido depois de um pipe (`cmd | tail; echo $?` lê o status do `tail`) e faixa de caracteres com limite não-ASCII usada para achar letra acentuada. O `npm run check:clean` reproduz a condição do CI num comando - árvore sem a instalação gitignored, `LC_ALL=C` e sem `LANG` - porque o CI reprovou duas vezes o que passava na máquina. **Ele não previne nada**: o que se compra é que o erro da classe coberta não chega ao commit, e a lei nova `L2.6` declara isso de si mesma, já que prometer prevenção seria a garantia que a `L1.9` proíbe. **O template do `adr-create` também mudou**: toda mitigação passa a carregar `proved by: <a execução que falharia sem ela>` ou o literal `[NOT VERIFIED]`, porque nomear um mecanismo existente como mitigação é uma afirmação, e afirmação se roda. O check vê **forma, nunca intenção**: lista vazia significa *"nenhum dos três padrões apareceu"*, jamais *"está correto"*. |
| **Contrato de skill conferido** | O `mgr validate` ganhou limites nos campos **obrigatórios** — `name` até 64 caracteres, e `name` ou `description` lidos como mapa reprovam, um buraco que deixava passar skill sem `description` utilizável — e nos **opcionais** do padrão aberto Agent Skills, quando presentes: `compatibility` até 500, `metadata` como mapa string→string de um nível, e `allowed-tools` como texto separado por espaço. **Código que passava pode reprovar**, e só se já declarava um desses campos com forma inválida. As 13 skills do CORE declaram `license`, e a `junit-clean` também o ambiente que exige (ADR-0021). |
| **Referência ao contexto antes da compactação** | Quando o motor anuncia a compactação, o método registra **onde está a conversa desta sessão** — o transcript que o próprio motor mantém, mais o raciocínio dos subagentes e a saída de ferramenta que foi para disco — num único manifesto por projeto, com tamanho e checksum medidos no instante. Nada é copiado: o transcript sobrevive à compactação, então duplicá-lo acumularia megabytes sem proteger de nada. O método **aponta** para o contexto, não o guarda, e a consolidação no `mgr-code` é peça própria que ainda não existe (ADR-0019). |
| **Hand-off antes da compactação** | Quando o motor anuncia que vai compactar o contexto, o método grava o hand-off **antes**, diz o motivo e sugere sessão nova. No `/compact` que você pediu, no claude-code, ele impede uma vez para você decidir com o estado já a salvo. No copilot o evento é só notificação: o hand-off continua sendo gravado, mas a plataforma não dá ao hook como impedir nem como falar com você (ADR-0018). |
| `configure-agents` | Conduz a escolha de modelo e esforço por intenção (`drafting`, `execution`, `review`) e escreve com `mgr agents set`. Diz o que cada intenção faz e mostra os identificadores que cada motor documenta, e **nunca sugere** modelo para uma intenção: os modelos disponíveis e a conta são seus. |
| `evidence-capture` | Registra evidências AI-First por funcionalidade (prompts, revisões, habilidades) em `specs/<feature>/ai/` + índice global; organiza e pergunta, nunca inventa. |
| `junit-clean` | Testes Java padronizados por 13 regras (naming should+camelCase, sem herança, ParameterizedTest, AAA, boundary + MC/DC, Sonar-safe). |
| `arch-hexagonal` | Guia de regras para Ports & Adapters (Cockburn), agnóstico à linguagem (perfis Java/Go/Python/C#/TS + genérico). |
| `arch-clean` · `arch-onion` · `arch-layered` | Guias canônicos de Clean (Martin), Onion (Palermo) e Layered (Fowler), no mesmo template agnóstico, com regras transversais compartilhadas. |

### O que o `mgr doctor` confere

A lista fechada, uma linha por verificação. A coluna `id` é o que o achado reporta, e o
`scripts/check-checks.mjs` compara esta coluna com o registro no código — então verificação sem
linha aqui, ou linha sem verificação, quebra o build.

| id | Compara |
|---|---|
| `orphan-skill` | `manifest.skills` contra o disco |
| `missing-skill` | `manifest.skills` contra o disco |
| `missing-agent` | `manifest.agents` contra o disco |
| `architecture-skill` | `manifest.architecture` contra `arch-<nome>` |
| `divergent-body` | o corpo instalado contra a fonte do pacote, nas `SKILL.md` **e** nos arquivos sob `_shared/` |
| `unresolved-token` | `{{MGR_*}}` sobrando no instalado, nas `SKILL.md` **e** em qualquer `.md` sob `_shared/` |
| `stale-install` | `manifest.version` contra o `package.json` |
| `broken-hook` | caminho absoluto em `settings.local.json` |
| `lockfile-drift` | `lockfile.diff()` |
| `missing-shared` | as fontes de `_shared/` que o conjunto instalado exige, contra o disco |


### Princípios que governam tudo

- **Constituição é lei** — gerada por projeto pelo `spec-init`, revisada por humano;
  toda spec/task a respeita ou declara override documentado.
- **Evidência, nunca invenção** — o que não deriva de código, spec ou entrevista vira
  `[TO CONFIRM]`/`[TO DEFINE]` + pergunta; reprovação sem regra textual não existe.
- **Checkpoints bloqueantes** — o humano aprova PRD, spec e plano; commit é humano.
- **Contexto sob controle** — tiers S/A/B/C/D/E/F, arquivamento a 75%, hand-off de
  sessão, proibição de compactação. Projetado para caber no menor orçamento de contexto
  entre os motores suportados (limites variam por ferramenta/versão — não presuma janela grande).
- **mgr-code se disponível** — cada skill sonda o `mgr-mcp` no início; usa a memória
  quando presente e **alerta visivelmente** quando ausente. Nunca é dependência crítica.

## Projeto do zero (greenfield)

`spec-init` detecta o projeto vazio e entra em modo entrevista: stack, arquitetura
(hexagonal default / clean / onion / layered), domínio, persistência, contratos, testes,
logs e não-negociáveis — com defaults agressivos e ramificação. Cada decisão estrutural
gera um ADR automaticamente. Sai a mesma SDD do brownfield; depois é `spec-create` por
feature, idêntico.

## Estrutura do repositório

```
bin/mgr.js          # CLI: install · status · update · uninstall · build · validate · list · version
                    #      add · remove · registry · detect · agents · tokens · spec · precompact
src/                # o núcleo, 35 módulos: instalação e build · descritor por motor · skill
                    # plugável · artefato de spec (parser/regras/validador) · sessão e contexto
                    # (hooks, pré-compactação, referência ao contexto) · mensagens
src/engines/        # o que cada motor suporta, como DADO — nunca `if` por nome de motor
skills/             # as 13 skills (fonte)
agents/             # os 3 moldes de agente (redação, implementação, gate de review)
shared/             # fontes transversais: regras de arquitetura e qualidade, leis, sdd-check.sh
docs/adr/           # as decisões, formato Nygard — versionadas e autocontidas
docs/plugins.md     # formato de skill plugável: manifest, registry, lockfile, matriz de suporte
docs/engine-hooks.md # matriz de capacidade de hook dos seis motores estudados, com fonte e data
test/               # node:test
```

Dependências mínimas (@clack/prompts e picocolors na TUI; esbuild só em dev — o pacote
publicado é um bundle minificado). Node ≥ 22. Release: `git tag vX.Y.Z && git push --tags`
dispara o workflow de publish (valida, testa e publica no npm com provenance). Desenvolvimento: `npm test`,
`node bin/mgr.js validate`.

## Licença

Source-available — código aberto para leitura e uso pessoal/interno; redistribuição,
revenda ou derivados distribuídos exigem autorização do autor. Veja [LICENSE](LICENSE).
