---
name: diagnosing-bugs
description: Disciplina de diagnóstico de bug difícil e regressão de performance — exige um loop de reprodução que fica VERMELHO no bug ANTES de qualquer hipótese (sinal antes de teoria). Acha a causa-raiz e para; o conserto não-trivial é entregue ao spec-create. Use quando o usuário pedir para diagnosticar ou debugar algo, ou reportar algo quebrado, lançando exceção, falhando ou lento.
---

# diagnosing-bugs — Diagnóstico disciplinado

Disciplina para bug difícil. **Pule uma fase apenas com justificativa explícita.**

A regra que governa tudo: **sinal antes de teoria.** Enquanto você não tiver um comando que
reproduz o bug e fica **vermelho** nele, nenhuma hipótese vale — ler código para adivinhar a
causa é exatamente o improviso que esta skill existe para impedir.

**Escopo (só diagnóstico):** esta skill acha a **causa-raiz** e **para**. O conserto não-trivial
é entregue ao `spec-create` (tipo bugfix) — ela **não** é um segundo motor de execução. Ver a
Fase 6.

**Antes de explorar:** carregue o modelo mental do domínio — `docs/sdd/04-domain.md` e
`08-glossary.md` (se existirem) e os ADRs em `docs/adr/` da área que você vai tocar. Se a memória
`mgr-code` estiver disponível, consulte `mgr_recall` (`have_i_seen_this`) — talvez este bug, ou um
parecido, já tenha sido diagnosticado.

---

## Fase 1 — Construir o loop de feedback

**Esta é a skill.** Todo o resto é mecânico. Se você tem um sinal **tight** (apertado) de
pass/fail que fica vermelho _neste_ bug, você vai achar a causa — bisection, teste de hipótese e
instrumentação apenas consomem esse sinal. Sem ele, olhar para o código não salva ninguém.

Gaste esforço desproporcional aqui. **Seja agressivo. Seja criativo. Não desista.**

### Formas de construir o loop — tente nesta ordem aproximada

1. **Teste que falha** no seam que alcança o bug — unitário, integração, e2e.
2. **Script curl / HTTP** contra um servidor rodando.
3. **Invocação de CLI** com uma entrada fixture, comparando a saída com um resultado conhecido-bom.
4. **Script headless** que dirige a interface e asserta no estado observável (saída, log, rede).
5. **Replay de trace capturado.** Salve um payload / log de evento real em disco; reproduza-o
   pelo caminho de código isolado.
6. **Harness descartável.** Suba um subconjunto mínimo do sistema (um serviço, deps falsas) que
   exercita o caminho do bug com uma única chamada.
7. **Loop property / fuzz.** Se o bug é "às vezes a saída sai errada", rode 1000 entradas
   aleatórias e procure o modo de falha.
8. **Harness de bisection.** Se o bug surgiu entre dois estados conhecidos (commit, versão,
   dataset), automatize "iniciar no estado X, checar, repetir" para rodar sob bisection.
9. **Loop diferencial.** Rode a mesma entrada na versão antiga vs. nova (ou dois configs) e
   compare as saídas.
10. **Roteiro HITL (último recurso).** Se um humano precisa mesmo agir na mão, **dirija-o** por um
    roteiro estruturado no terminal — um passo por vez, capturando a resposta de cada um — em vez
    de um bate-papo solto. A resposta capturada realimenta o loop. (A técnica; sem arquivo pronto.)

Construa o loop certo e o bug está 90% resolvido.

### Aperte o loop (mantenha-o *tight*)

Trate o loop como um produto. Uma vez que tenha _um_ loop, **aperte-o**:

- Mais rápido? (Cachear o setup, pular init irrelevante, estreitar o escopo do teste.)
- Sinal mais afiado? (Assertar no sintoma específico, não em "não quebrou".)
- Mais determinístico? (Fixar o tempo, semear o RNG, isolar o filesystem, congelar a rede.)

Um loop instável de 30s mal supera nenhum loop; um determinístico de 2s é *tight* — um superpoder.

### Bugs não-determinísticos

A meta não é um repro limpo, e sim uma **taxa de reprodução maior**. Rode o gatilho 100×,
paralelize, adicione stress, estreite janelas de timing, injete sleeps. Um bug que falha 50% das
vezes é debugável; 1% não é — eleve a taxa até ficar debugável.

### Quando você genuinamente não consegue construir o loop

**Pare e diga isso explicitamente.** Liste o que tentou. Peça ao usuário: (a) acesso ao ambiente
que reproduz, (b) um artefato capturado (log, dump, gravação com timestamps), ou (c) permissão
para instrumentação temporária. **Não** prossiga para hipótese sem um loop.

### Critério de conclusão — um loop *tight* que fica vermelho

A Fase 1 termina quando o loop é **tight** e **capaz de ficar vermelho**: você consegue nomear
**um comando** — um caminho de script, uma invocação de teste, um curl — que você **já rodou pelo
menos uma vez** (cole a invocação e a saída dela), e que é:

- [ ] **Capaz de ficar vermelho** — dirige o caminho real do bug e asserta o **sintoma exato do
  usuário**, então fica vermelho neste bug e verde quando corrigido. Não "roda sem erro" — tem de
  _pegar este bug específico_.
- [ ] **Determinístico** — mesmo veredito todo run (bug instável: taxa de repro alta e fixada).
- [ ] **Rápido** — segundos, não minutos.
- [ ] **Executável pelo agente** — você roda sozinho; humano no loop só pelo roteiro HITL.

Se você se pegar lendo código para montar uma teoria antes deste comando existir, **PARE — pular
direto para a hipótese é exatamente a falha que esta skill previne.** Sem comando vermelho, sem
Fase 2.

---

## Fase 2 — Reproduzir + minimizar

Rode o loop. Veja-o ficar vermelho — o bug aparece.

Confirme:

- [ ] O loop produz o modo de falha que o **usuário** descreveu — não uma falha vizinha que por
  acaso está perto. Bug errado = fix errado.
- [ ] A falha é reprodutível em múltiplos runs (ou, para bug não-determinístico, a uma taxa alta o
  bastante para debugar).
- [ ] Você capturou o sintoma exato (mensagem de erro, saída errada, timing lento) para as fases
  seguintes verificarem que o fix de fato o resolve.

### Minimizar

Uma vez vermelho, encolha o repro para o **menor cenário que ainda fica vermelho**. Corte
entradas, chamadores, config, dados e passos **um de cada vez**, re-rodando o loop após cada
corte — mantenha só o que é load-bearing para a falha.

Por que fazer isso: um repro mínimo encolhe o espaço de hipóteses na Fase 3 (menos peças
suspeitas) e vira o teste de regressão limpo na Fase 5.

Pronto quando **todo elemento restante é load-bearing** — remover qualquer um deixa o loop verde.

Não prossiga sem ter reproduzido **e** minimizado.

---

## Fase 3 — Hipotetizar

Gere **3–5 hipóteses ranqueadas** antes de testar qualquer uma. Gerar uma só ancora na primeira
ideia plausível.

Cada hipótese deve ser **falsificável**: enuncie a predição que ela faz.

> Formato: "Se `<X>` é a causa, então `<mudar Y>` faz o bug sumir / `<mudar Z>` o piora."

Se você não consegue enunciar a predição, a hipótese é um palpite vago — descarte ou afie.

**Mostre a lista ranqueada ao usuário antes de testar.** Ele costuma ter conhecimento de domínio
que re-ranqueia na hora ("acabamos de mexer no #3"), ou hipóteses já descartadas. Checkpoint
barato, economia grande. Não bloqueie: se o usuário está ausente, siga com o seu ranking.

---

## Fase 4 — Instrumentar

Cada probe mapeia a uma predição específica da Fase 3. **Mude uma variável por vez.**

Preferência de ferramenta:

1. **Debugger / inspeção em REPL** se o ambiente suporta. Um breakpoint vale dez logs.
2. **Logs alvo** nas fronteiras que distinguem as hipóteses.
3. Nunca "logar tudo e dar grep".

**Marque todo log de debug** com um prefixo único, ex. `[DEBUG-a4f2]`. A limpeza no fim vira um
único grep. Log sem tag sobrevive; log com tag morre.

**Ramo de performance.** Para regressão de perf, log costuma enganar. Em vez disso: estabeleça uma
medição de baseline (harness de timing, profiler, plano de query), depois bisecte. Meça primeiro,
corrija depois.

---

## Fase 5 — Corrigir + teste de regressão

Escreva o teste de regressão **antes do fix** — mas só se houver um **seam correto** para ele.

Um seam correto é aquele em que o teste exercita o **padrão real do bug** como ele ocorre no call
site. Se o único seam disponível é raso demais (teste de um chamador quando o bug precisa de
vários; teste unitário que não replica a cadeia que disparou o bug), um teste ali dá falsa
confiança.

**Se não existe seam correto, isso em si é o achado.** Anote. A arquitetura do código está
impedindo travar o bug. Sinalize para a Fase 6. — Isto **alinha com a anti-inflação** (`§4` da
CONSTITUTION): não se cria um teste raso só para "ter cobertura"; a ausência de seam é informação,
não motivo para um teste sem valor.

Se existe seam correto:

1. Transforme o repro minimizado num teste que falha nesse seam.
2. Veja-o falhar.
3. Aplique o fix.
4. Veja-o passar.
5. Re-rode o loop da Fase 1 no cenário **original** (não-minimizado).

---

## Fase 6 — Limpeza, post-mortem e aterrissagem do fix

### Checklist de limpeza (obrigatório antes de declarar pronto)

- [ ] O repro original não reproduz mais (re-rode o loop da Fase 1).
- [ ] O teste de regressão passa (ou a ausência de seam está documentada).
- [ ] Toda instrumentação `[DEBUG-...]` removida (dê `grep` no prefixo).
- [ ] Protótipos descartáveis apagados (ou movidos para um local claramente marcado).
- [ ] A hipótese que se confirmou está registrada no **texto do post-mortem** — para o próximo
  aprender.

### Post-mortem (a skill produz o texto; o commit é humano)

Esta skill **produz** o texto do post-mortem (o que era o bug, como o loop o pegou, qual hipótese
venceu). Ela **não** commita: registrar isso em mensagem de commit ou PR é passo **confirmado por
humano** (`§5` da CONSTITUTION — nenhuma ação de git automática).

### Aterrissagem do fix (a skill NÃO cria branch)

O diagnóstico é **branch-agnostic**. A skill **não cria branch** e **não decide sozinha** onde o
fix aterrissa — ela aplica esta regra e **recomenda**, o humano confirma:

- **A causa está no código novo da feature em que você já está trabalhando?** → o fix pertence a
  **essa branch** (é parte de terminar a feature).
- **O bug é pré-existente?** → **nunca** dobre o fix dentro da branch da feature atual: isso
  acopla um conserto a uma feature inacabada. Então:
  - **Não bloqueia a feature atual?** → **adie** (default seguro): registre o diagnóstico, conclua
    a feature, conserte depois em **branch própria** a partir da `main`.
  - **Bloqueia a feature atual?** → **branch própria a partir da `main`** (que sobe sozinha via
    merge) e a feature atual faz **rebase** na `main` para herdar o fix.
- **Invariante:** nenhum caminho commita direto na `main` — todo trabalho vive em branch e a
  `main` só recebe merge. **Adiar é o default.**

### Entrega do conserto (Opção A)

Conserto **não-trivial** é entregue ao `spec-create` (tipo bugfix), que o planeja e executa sob
governança. Esta skill fez o diagnóstico; ela para aqui.

### O que teria evitado este bug?

Pergunte isso **depois** do fix (você sabe mais agora do que no começo). Se a resposta envolve
mudança arquitetural (sem seam bom, chamadores emaranhados, acoplamento oculto), **sinalize o
achado arquitetural** com as especificidades — candidato a um `refactor` via `spec-create`. Faça a
recomendação com o fix já no lugar, não antes.

---

> **Origem e crédito.** Esta skill é uma **adaptação** de `diagnosing-bugs`, de Matt Pocock
> (github.com/mattpocock/skills), sob licença MIT, reescrita para o vocabulário e a CONSTITUTION do
> MGR (pt-BR, escopo só-diagnóstico, aterrissagem de fix sob a política de git do projeto,
> exemplos agnósticos à linguagem). A disciplina central — *sinal antes de teoria* — é dele.
