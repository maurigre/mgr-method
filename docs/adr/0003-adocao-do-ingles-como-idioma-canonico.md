# ADR-0003: Adoção do inglês como idioma canônico do conteúdo do método

Date: 2026-07-16
Deciders: Mauri Reis

## Status

Accepted

## Context

Todo o conteúdo distribuído no pacote npm (25 arquivos .md em `skills/` e `shared/`,
~2.131 linhas, mais `README.md` e `shared/scripts/sdd-check.sh`) está em pt-BR. Isso limita
o alcance do pacote — o público do npm majoritariamente não lê português — e, para atender
outros públicos mantendo o pt-BR como fonte, exigiria versões bilíngues permanentes: cada
mudança feita duas vezes, com risco de drift silencioso entre as versões.

O consumidor primário do conteúdo das skills é o agente (LLM), não o humano; o que o
usuário experimenta é a conversa e os artefatos gerados. Esses dois eixos hoje estão
colados no mesmo idioma.

A feature diagnosing-bugs (2026-07-15) havia registrado a convenção "skills do MGR são
pt-BR" — esta decisão a reverte. Há precedente de tradução sem perda no próprio projeto: o
gate CA-2 da diagnosing-bugs traduziu conteúdo en→pt sob inventário load-bearing conferido
item a item.

**Reference:** Spec técnica em specs/idioma-canonico-ingles/03-spec.md.

## Decision

1. **Fonte canônica única em inglês** para todo conteúdo distribuído no pacote (`skills/`,
   `shared/`, `README.md`, `sdd-check.sh`) — nenhuma versão bilíngue.
2. **O idioma que o usuário experimenta vira configuração persistida**: campo
   `userLanguage` no manifesto (`.mgr-core/manifest.json`), coletado no `mgr install` com
   default detectado do ambiente (`LC_ALL` > `LC_MESSAGES` > `LANG`), flag
   `--user-language`, backfill silencioso `pt-BR` no `update` de instalações existentes.
3. **Entrega da diretiva de idioma**: texto normativo em fonte única
   (`shared/quality/quality-rules.md`, sempre instalada pois `spec-init` pertence ao CORE)
   mais uma linha-ponteiro por `SKILL.md` com o token `{{MGR_USER_LANGUAGE}}`, resolvido no
   install pelo mesmo mecanismo do `{{MGR_ARCH_RULES}}`; fallback quando não resolvido:
   "the language the user writes in".
4. **Identificadores estáveis imunes ao idioma**: nomes de arquivos gerados e IDs de regra
   (`INV-`/`DES-`/`TST-`/`LOG-`/`MUT-`/`NAM-`/`QUAL-`/`JQ-`/`JS-`) permanecem em inglês
   independentemente do idioma configurado.
5. **Tradução sob protocolo de integridade em 3 camadas**: script de verificação
   estrutural (`scripts/check-translation.mjs`), gabarito load-bearing por arquivo
   (extraído antes, conferido depois) e revisão humana por checkpoint.
6. **Renames**: `shared/arch/regras-transversais.md` → `cross-cutting-rules.md`;
   `shared/quality/regras-qualidade.md` → `quality-rules.md`; evidence-capture
   `templates/revisoes.md` → `templates/reviews.md` (default; a skill honra o nome exigido
   pelo enunciado do desafio quando houver), com limpeza dos nomes legados em `_shared/`
   no install/update.

## Alternatives Considered

- **Manter tudo em pt-BR (status quo):** limita adoção e avaliação internacional do pacote
  npm; é a motivação central da mudança.
- **Versões bilíngues (pt + en) de skills e shared:** 25+ arquivos duplicados, toda mudança
  feita duas vezes, drift silencioso inevitável sem pipeline de tradução; custo recorrente
  permanente para mantenedor solo.
- **Skill ler o manifesto em runtime para descobrir o idioma:** frágil no escopo global
  (`~/.mgr-core` fora do cwd do agente) e cria dependência de runtime que o modelo
  autossuficiente aboliu (CONSTITUTION §2.5); o token resolvido no install já é o padrão do
  projeto (`ARCH_RULES_TOKEN`).
- **Detectar o idioma da conversa em runtime, sem configuração:** não persistente nem
  determinístico entre sessões; mantido apenas como fallback do token não resolvido.

## Consequences

### Positive

- Fonte única de verdade: mudança de conteúdo do método = editar 1 arquivo.
- Pacote utilizável por público internacional (instalação e fluxo completos em inglês).
- Experiência pt-BR preservada via configuração — antes e depois da mudança.
- A regra de saída é agnóstica: vale para qualquer idioma que o usuário configurar.

### Negative

- Tradução pontual de ~2.259 linhas sob protocolo de integridade (custo único).
- O mantenedor passa a escrever conteúdo do método em inglês.
- Instalações existentes carregam o conteúdo interno das skills em inglês após o `update`
  (a experiência do usuário é preservada pelo backfill `pt-BR`).

### Risks and Mitigations

- **Risco:** perda de informação normativa na tradução — **Mitigação:** protocolo em 3
  camadas (script estrutural + gabarito load-bearing 100% conferido por arquivo + revisão
  humana); originais pt-BR permanecem no histórico do git.
- **Risco:** arquivo pt órfão em `_shared/` após update de instalação antiga —
  **Mitigação:** limpeza dos nomes legados no `installEngine` antes da cópia.
- **Risco:** token `{{MGR_USER_LANGUAGE}}` aparecer cru fora do fluxo de install (`mgr
  build`, uso direto do repo) — **Mitigação:** linha-ponteiro redigida para degradar de
  forma legível, com fallback textual explícito.
