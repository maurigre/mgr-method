# ADR-0007: Adoção de defesa em camadas e hierarquia de autoridade para skills de terceiros

Date: 2026-07-20
Deciders: Mauri Reis

## Status

Accepted

## Context

Uma skill é prompt executável: o vetor de ataque principal não é código malicioso clássico,
mas instrução maliciosa em linguagem natural — exfiltração de dados, override de regras do
projeto, auto-modificação de config, instalação encadeada de outras skills (kickoff, D10).
Nenhum scanner captura 100% de linguagem natural maliciosa, então nenhuma camada pode ser a
única. O download silencioso contradiz pilares do próprio método ("no auto-commits",
"blocking human checkpoints" — D03). Este ADR fixa o modelo completo; a implementação é
faseada (Fase 1 e Fase 2 da evolução).

**Reference:** Spec técnica em specs/fase1-fundacao-plugins/03-spec.md.

## Decision

Modelo em quatro camadas, com precedência de autoridade fixa:

1. **Camada 1 — `mgr audit` (Fase 2):** análise estática do conteúdo antes da instalação —
   padrões de exfiltração, comandos shell embutidos, auto-modificação de config/instalação
   de skills, tentativas de override ("ignore previous instructions" e variantes). A
   **inferência de permissões é a fonte de verdade**: o audit deriva as capacidades reais do
   conteúdo, independente do declarado. Declarou e bate → instala mostrando permissões;
   declarou X e detectou X+Y → bloqueio ou warning forte; não declarou → "permissões
   inferidas — não declaradas pelo autor" com confirmação obrigatória mesmo em modo `auto`
   de registry trusted. Revisão por IA do conteúdo é camada opcional, nunca a única.
2. **Camada 2 — menor privilégio verificado:** skill de terceiros não altera config do MGR
   nem instala outras skills. Na Fase 1 a garantia é estrutural (o instalador nunca lê
   instruções da skill para decidir ações); na Fase 2 o audit verifica o conteúdo.
3. **Camada 3 — hierarquia de autoridade:** princípios do MGR core > regras do projeto
   (`.mgr-core/`) > convenções do workspace > instruções da skill. Na montagem de contexto,
   as camadas superiores entram com instrução explícita de subordinação das skills;
   conflitos resolvem para cima. O audit (F2) rejeita skills que tentem inverter a
   hierarquia; a publicação no registry oficial valida isso como requisito.
4. **Camada 4 — checkpoint humano:** para skills fora do registry oficial, a proteção final
   é o humano. A documentação é honesta por obrigação: o audit reduz drasticamente o risco,
   não o elimina — prometer "scanner que garante segurança" é vetado.

Entregas da Fase 1 (imediatas): confirmação humana obrigatória em todo `mgr add`, sem flag
de bypass (não-TTY falha com mensagem clara); validação de checksum antes de qualquer
escrita (ADR-0005/0006); menor privilégio estrutural; `trusted` persiste no config sem
habilitar instalação silenciosa. Fase 2: `mgr audit` completo, modos
`manual|suggest|auto`, `mgr add --from-git` (adoção de skills externas com manifest
derivado e normalização para o formato MGR).

## Alternatives Considered

- **Assinatura GPG de skills na v1:** não existe ecossistema real de terceiros para
  sustentar a cadeia de confiança; o custo de gestão de chaves não se justifica agora.
  Adiada como revisit trigger: reavaliá-la quando houver registries de terceiros em uso
  real (resolução Q2).
- **Scanner como camada única (instalação automática pós-scan):** linguagem natural
  maliciosa não é detectável com garantia; venderia falsa segurança e violaria o princípio
  do checkpoint humano. Rejeitada.
- **Bloquear skills de terceiros por completo:** elimina o risco e o propósito da
  plataforma; o caso `@empresa/*` é requisito de produto. Rejeitada.

## Consequences

### Positive

- Coerência filosófica: o mesmo princípio de checkpoint humano do método governa a
  instalação de skills.
- O modelo completo decidido agora evita retrabalho: a Fase 1 implementa o subconjunto sem
  contradizer o que a Fase 2 adiciona.
- Reprodutibilidade (ADR-0006) fecha o vetor "devs do mesmo repo com conjuntos divergentes".

### Negative

- Fricção deliberada: toda instalação pede confirmação nesta fase, inclusive em CI
  (não-TTY falha) — automação plena só com o modelo `auto` + audit da Fase 2.
- O audit da Fase 2 terá falsos positivos/negativos inerentes à análise de linguagem
  natural.

### Risks and Mitigations

- **Risco:** usuário criar o hábito de confirmar sem ler — **Mitigação:** a confirmação
  mostra origem, versão, permissões e checksum em formato curto e escaneável; mismatch
  declarado/inferido (F2) muda o tom da mensagem para warning forte.
- **Risco:** prompt injection em documento ingerido disparar instalação (vetor do
  spec-extract, F4) — **Mitigação:** instalação exige confirmação humana interativa por
  design; não existe caminho programático sem TTY nesta fase.
- **Risco:** skill tentar inverter a hierarquia de autoridade em runtime — **Mitigação:**
  instrução de subordinação injetada na montagem de contexto (F1/F3) e rejeição na
  publicação/audit (F2).
