# ADR-0036: O kickoff v2 substitui o plano de evolução de 2026-07-19

Date: 2026-11-24
Deciders: Mauri Reis

## Status

Proposed

## Context

O plano de evolução em vigor era o "MGR-METHOD — Evolution Kickoff", de 2026-07-19, com quatro
fases: fundação de plugins (F1), detecção e sugestão (F2), workspace multi-projeto (F3) e
spec-extract (F4). Ele determina: *"Nenhuma implementação deve contradizer as decisões aqui registradas
sem antes gerar um ADR de revisão."* Este ADR é esse registro.

Depois daquele plano, o cenário mudou (kickoff v2, §1, 2026-11-23):

- o plano partiu do OpenSpec 1.13.0, e o OpenSpec está na 2.1.1, depois de uma versão major;
- cinco planos corriam em paralelo, e nenhum dizia o que faltava para a versão estável;
- o `latest` no npm era a 0.5.0, e três meses de trabalho (218 commits, 52 PRs) só existiam no `next`.

O autor pediu uma reavaliação (*"o correto seria fazer uma reavaliação profunda e ajustar ou criar
um novo kickoff"*) e decidiu sair do beta (*"temos que gerar versoes com releases estaveis, pois
não podemos ficar mais na versao beta"*). O resultado é o kickoff v2, "Entregas estáveis",
aprovado em 2026-11-23 quanto à direção e às prioridades; cada fatia ainda passa por plano
aprovado.

O kickoff v2 está em `exemplos/mgr-kickoff-v2.md`, e `exemplos/` é gitignored: o arquivo só existe
na máquina do autor. Por isso este ADR traz nele mesmo o conteúdo que adota.

**Reference:** Technical spec at specs/revisao-do-kickoff-e-auto/03-spec.md.

## Decision

1. **O plano de evolução vigente é o kickoff v2.** Ele substitui cinco planos, arquivados em
   2026-11-24 como histórico:

   | plano arquivado | o que foi | onde o que restou foi parar |
   |---|---|---|
   | Evolution Kickoff (2026-07-19) | 4 fases | F1 feita; F2 fechada na 0.7.0 (K09, K10), com o `mgr add --from-git` na linha 1.x do trem; F3 e F4 na prioridade B do v2 |
   | análise e programa contra o OpenSpec 1.13.0 | comparação e programa | refeitos contra a 2.1.1 |
   | achados da análise de 2026-09 contra o OpenSpec 1.13 | achados | idem |
   | kickoff do Guardião e ampliação da G1 | G0 a G3 e famílias citáveis | G0 a G2 feitas; G3 no backlog do v2 |
   | kickoff de economia | E0 a E4 | E0 feita; E1, E3 e E4 no backlog do v2 |

2. **Princípios.**
   - Mantidos do kickoff anterior:
     - evidência acima de invenção;
     - YAGNI e KISS;
     - nenhum commit automático;
     - checkpoint humano antes de gerar código e antes de qualquer instalação;
     - feedback técnico honesto.
   - Acrescentados:
     - versão estável pequena, de 2 a 4 fatias; se não couber, divide;
     - nada quebra quem atualiza: toda versão passa pelo teste de atualização a partir da estável
       anterior publicada, e mudança de layout vem com migração no `mgr update`;
     - fluxo novo arriscado entra opt-in primeiro;
     - compatível com o ecossistema sem depender dele: formato Agent Skills, `.agents/skills/`,
       nenhum instalador de terceiro no caminho crítico, nenhuma telemetria;
     - revisor de outro fornecedor, plugável e conferido mecanicamente (K13).

3. **Decisões consolidadas.**

   | # | decisão |
   |---|---|
   | K01 | Skills em `.agents/skills/` (convenção do Agent Skills), com link em `.claude/skills/` para o Claude Code |
   | K02 | Agentes como cascas finas por motor, geradas de `agents/*.md`; o procedimento fica na skill. Não há convenção comum para agentes (verificado contra o OpenSpec 2.1.1, 2026-11-23) |
   | K03 | Todos os motores que o OpenSpec suporta, em dois níveis: skills para todos; completo (agente, modelo e hooks) motor a motor, com sessão real |
   | K04 | Registry próprio, compatível com o ecossistema, sem depender do instalador `skills`, que tem telemetria ligada por padrão e não descreve audit. O `--from-git` aceita o formato padrão. O gatilho de revisão vai no ADR da fatia que implementar o `--from-git`, ainda não escrito |
   | K05 | Workspace a partir do modelo `store`/`references`/`context` do OpenSpec, conferindo pontos e desempenho |
   | K06a | Archive na 0.7.0: `mgr spec archive <slug>` move para `specs/archive/<data>-<slug>/` e recusa se houver task fora de `done`, se o fechamento não declarar o SDD (DOC-3/DOC-4) ou se o `sdd-check` falhar: "arquivada" significa terminada, inclusive o SDD. `spec status`/`next` ignoram o archive (`--archived` lista). As 48 specs concluídas migram pelo comando; as que não passarem viram lista para o autor; as 5 sem plano são decididas pelo autor, uma a uma. Os 9 testes que leem `specs/<slug>/` são atualizados, com prova de que nenhum passou a pular |
   | K06b | Conteúdo do SDD na 0.8.0: delta de requisito (ADDED/MODIFIED/REMOVED/RENAMED) aplicado ao `docs/sdd/`, com guarda de perda de cenário; a declaração vira atualização conferida |
   | K07 | `specs/` continua fora do git por enquanto |
   | K08 | Node `>=22`, mantido |
   | K09 | O modo `auto` é retirado por ADR (ADR-0037) |
   | K10 | Skills de ecossistema (`@mgr/postgres` etc.) nascem da necessidade de um projeto real, não de uma lista fixa |
   | K11 | Trem de releases: `0.7.0` com o que está pronto; `1.0.0` depois do `.agents/skills/`, que congela o layout (item 4) |
   | K12 | Fluxo de branches (item 5) |
   | K13 | Revisor externo plugável, prioridade alta. Cada revisor é uma ficha com três coisas: como chamá-lo sem conversa e só leitura, como extrair a prova de execução e como conferir se está instalado. Plugar outro revisor é escrever uma ficha e pô-la na lista do config. Para entrar, o revisor precisa de: modo não interativo, modo só leitura, resposta conferível contra formato fixo, autenticação local e uma execução real registrada. Hoje só o Codex foi conferido (`codex-cli 0.162.1`; `codex exec --sandbox read-only --output-schema -o`). Fluxo: o revisor aponta, com citação obrigatória de regra ou linha da spec; o implementador corrige o que procede; na discordância, o `mgr-review` decide; depois de 2 rodadas, o que continuar em desacordo vai ao autor. O script grava a versão, o identificador da sessão e o hash do diff revisado, e uma checagem bloqueia o fechamento da fatia se o arquivo faltar, fugir do formato ou tiver hash diferente do diff atual. Rodando local, essa prova não é criptográfica; a garantia forte (CI) fica para a etapa 2. O código vai para a OpenAI e consome a cota da conta, por isso a primeira execução real precisa do OK do autor |
   | K14 | Duas contas: primeiro o ChatGPT só como revisor; a partir da 1.0, com o Codex suportado, ele também executa fatias |

4. **Trem de releases.**

   | versão | conteúdo | fatias | gate de saída |
   |---|---|---|---|
   | 0.7.0 | fatia 1: este ADR, o ADR que retira o `auto` (ADR-0037) e a correção da mensagem falsa da recusa do `auto`; fatia 2: archive das specs (K06a); fatia 3: revisor externo, etapa 1 (script com fichas, só o Codex, checagem do hash do diff); fatia 4: teste de atualização no CI (0.5.0 e última estável → `update` → `doctor` → `uninstall`), CHANGELOG consolidado, `0.7.0-rc.1` no `next` com sessão real, publicação manual e release → `main` | 4 | todas as checagens + teste de atualização + sessão real do autor |
   | 0.8.0 | conteúdo do SDD (K06b): delta aplicado no fechamento da fatia, com guarda de perda de cenário; conferência única do SDD inteiro contra o código | 2 a 3 | idem |
   | 0.9.0 | `analyze` (o plano cobre a spec?); `clarify` (perguntas com teto, gravadas no artefato); `converge` (o que falta vira task) | 2 a 3 | idem |
   | 1.0.0 | `.agents/skills/` + link para o Claude Code + integração genérica + motores no nível skills; migração no `update`; contrato de layout congelado (SemVer) | 3 a 5 | idem + atualização a partir da 0.9 e da 0.5 |
   | 1.1, 1.2... | um motor no nível completo por versão, cada um com sessão real; o Codex serve também de prova para a fase 2 do K14 | 1 cada | sessão real do motor |
   | 1.x | `--from-git` com download seguro | 1 a 2 | idem |

5. **Fluxo de branches (K12).** A `release/mgr-evolution` vai para a `main` por fast-forward na
   0.7.0 e fica parada como registro. Até lá, as fatias saem dela. Daí em diante, cada fatia sai da
   `main` e volta para ela, e o `next` recebe só a candidata (`-rc.N`).

6. **Mudar este plano exige ADR de revisão**, como o plano anterior exigia. Registrar o andamento
   não é mudar o plano: ao fechar uma versão, a data e o PR entram na tabela do trem do kickoff local,
e este ADR não é editado por isso.

7. **Em divergência entre este ADR e o kickoff local, vale este ADR**, que é versionado e revisado; o
   kickoff local é corrigido para concordar.

O plano local também traz a prioridade B (o que vem depois da 1.0), o backlog com gatilho e o que
fica fora de escopo. Eles não são resumidos aqui, porque mudam com mais frequência que as decisões
acima; mudar qualquer um deles para dentro do trem de releases é mudança de plano e passa pela
decisão 6.

## Alternatives Considered

- **Só apontar para o arquivo do kickoff v2:** `exemplos/` é gitignored, então quem clona o
  repositório não teria o plano. Rejeitada.
- **Ajustar o kickoff de 2026-07-19 em vez de escrever outro:** o autor ofereceu as duas saídas e
  aprovou o plano novo. O kickoff anterior era um de cinco planos paralelos, e ajustar só ele não
  consolidaria os outros quatro.
- **Um ADR só para o plano e para o `auto`:** rejeitada pelo autor no CHECKPOINT 1. O plano e a
  política de segurança têm natureza e duração diferentes, e quem procurar "por que não existe
  `auto`" precisa de um registro que se cite sozinho.

## Consequences

### Positive

- Qualquer sessão lê no repositório qual plano vale, o que entra na 0.7.0, o gate de saída de cada
  versão e de onde sai cada branch.
- A cadeia de ADRs de revisão passa a ser o histórico das mudanças de plano.

### Negative

- O plano existe em dois lugares: o kickoff v2 local, que se declara fonte única, e este resumo.
- O andamento (datas e PRs ao fechar cada versão) fica no arquivo local.

### Risks and Mitigations

- **Risk:** o resumo e o kickoff local divergirem. — **Mitigation:** toda mudança de plano exige
  um ADR de revisão (decisão 6). — **proved by:** [NOT VERIFIED]; não há checagem mecânica entre
  um arquivo gitignored e o ADR.
- **Risk:** o resumo omitir ou alterar uma decisão K. — **Mitigation:** conferência linha a linha
  contra o kickoff v2 §3 e §4 no review da fatia (`CA-12` da spec). — **proved by:** comparação
  por script de K01 a K14 (P1.1) e review isolado da fatia (P2.2), registrados em
  `specs/revisao-do-kickoff-e-auto/05-execution.md`: nenhuma decisão divergente.
