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

## Emenda de 2026-09-26 — o nível 2 inclui `docs/sdd/`, e a `L0.1` não era citação fiel

Achado pelo gate de review isolado do PR #32 ("Lacuna B"), ancorado na `DOC-2` e confirmado por
medição antes de ser aceito.

1. **O nível 2 desta hierarquia inclui `docs/sdd/`, e não só `.mgr-core/` — RATIFICADO.** A Camada 3
   nomeia `.mgr-core/`. Medido em 2026-09-26: `docs/sdd/CONSTITUTION.md` existe, e é ali que moram a
   **constituição do projeto** e o **guia de review** — os dois documentos que dizem o que o projeto
   exige. Nomear só `.mgr-core/` deixava a constituição do próprio projeto FORA do nível que existe
   para proteger o projeto de instrução de terceiro, que é o oposto da intenção desta Camada 3. O
   nível 2 lê-se, daqui em diante, como "as regras do projeto, onde elas estiverem escritas":
   `.mgr-core/`, que é config sob controle do usuário, e `docs/sdd/`, que o método gera dentro do
   projeto. A ordem dos quatro níveis e o conteúdo dos outros três não mudam.

2. **A `L0.1` afirmava reproduzir esta hierarquia "unchanged and in the same order" — era FALSO desde
   o dia em que foi escrito.** O parêntese e a frase de fidelidade entraram no MESMO commit,
   `4826d6d`, de 2026-08-31, a fatia da fonte única das leis: a divergência nasceu com o arquivo. A
   frase sai; em lugar dela, a `L0.1` declara o que o nível 2 contém e aponta para esta emenda.

**O que esta emenda NÃO faz:**

- **não cria degrau novo** e **não move nível nenhum.** A decisão 1 do ADR-0011 — *"Nenhum nível
  existente muda de posição e nenhuma regra do ADR-0007 é relaxada — só se acrescenta abaixo"* —
  continua verdadeira, e nada é relaxado: o nível 2 abriga MAIS documentos do projeto acima da
  instrução de skill, nunca menos.
- **não põe as leis de execução na escada.** Elas não são um nível: vinculam toda skill do MGR e, na
  primeira pergunta — o que reprova —, já são subordinadas ao guia do projeto pela `L1.1`.
- **não torna `CP-<n>` citável** (decisão 3 do ADR-0022) e não toca a `L1.1` nem a `L1.3`.
- **não escreve nada em `docs/sdd/`.** Nenhum guia de projeto é reescrito e não há migração: o nível 2
  ganha nome, não conteúdo novo.

**Guarda:** `LAW-6` em `scripts/check-laws.mjs` — confere, estruturalmente, que a escada da `L0.1` tem
cinco níveis na ordem declarada, que ela declara `"Conflicts resolve upward, always."`, que o nível 2
nomeia os dois caminhos, que **a afirmação falsa que o item 2 acima corrige não volta** (a
subconferência `LAW-6d`, que era a omissão apontada pelo gate isolado), e que a `L0.1` cita a data
desta emenda com uma seção correspondente neste arquivo. **proved by:** as 12 mutações da seção 6.3 da spec, rodadas em 2026-09-26 — **todas vermelhas, todas
revertidas verdes**. As sete que a `LAW-6` guarda foram medidas pelo comando que o CI roda
(`npm run check:laws`), com o achado citado; as quatro de texto, pela guarda estrutural de cláusulas; e a
12ª pela `LAW-2` mais a contagem de 47 leis. A mutação que apaga esta seção do ADR sai **exit 1** com
`LAW-6c` — é ela que prende esta emenda à `L0.1` pela data.

**Por que emenda e não ADR novo:** nenhuma decisão muda de direção. As quatro camadas seguem as mesmas,
na mesma ordem, com o mesmo propósito; corrige-se uma afirmação de **fato** que era falsa, e ratifica-se
o alcance de um nível que já estava em vigor e distribuído desde 2026-08-31. Além disso, um ADR novo
criaria um SEGUNDO documento com autoridade sobre a mesma escada — e ter duas foi exatamente o que
produziu este defeito.

**A lição:** reunir uma regra numa fonte única é o ato em que ela mais facilmente deixa de ser fiel à
origem — quem copia melhora o texto e continua chamando de cópia. Citação e decisão são coisas
diferentes, e o parêntese a mais era uma decisão.
