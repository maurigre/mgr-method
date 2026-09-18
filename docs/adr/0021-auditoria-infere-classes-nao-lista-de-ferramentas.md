# ADR-0021: A auditoria de skill infere classes de capacidade, não lista de ferramentas

Date: 2026-09-17
Deciders: Mauri Reis

## Status

Accepted

## Context

O formato de skill do MGR segue o padrão aberto **Agent Skills**
(`https://agentskills.io/specification`, lido em 2026-09-17). Ele define o frontmatter do
`SKILL.md` com `name` e `description` obrigatórios e quatro opcionais: `license`,
`compatibility` (1–500 caracteres), `metadata` (mapa string→string) e `allowed-tools` — este
último uma **string separada por espaço**, marcada `(Experimental)` e acompanhada do aviso
*"Support for this field may vary between agent implementations"*.

**Medido em disco em 2026-09-17:** as 13 skills do CORE declaram só os dois obrigatórios. Os
quatro opcionais estão em **0 de 13**.

Isso tem uma consequência que ninguém escolheu. O **ADR-0007:26-33** já decidiu que a
**inferência** de permissões é a fonte de verdade e a declaração é a afirmação que ela confere,
em três ramos: *declarou e bate* → instala mostrando permissões; *declarou X e detectou X+Y* →
bloqueio ou warning forte; *não declarou* → *"permissões inferidas — não declaradas pelo autor"*,
com confirmação obrigatória mesmo em modo `auto` de registry trusted. **As 13 skills do CORE do
próprio MGR caem todas no terceiro ramo, o pior** — a ferramenta que cobra menor privilégio de
terceiros não declara o seu.

E o comparador que aplicaria esses ramos, o `mgr audit`, **não existe**: não está no `help`, e a
única menção em `src/` é uma linha de `registry.js`. O ADR-0007 o situa na Fase 2 da defesa em
camadas; a Fase 2 chegou e ele não.

O item `M1` do programa de superioridade — *"frontmatter completo"* — está na **Fase 0**, que o
programa declara *"fundação (destrava tudo)"*, e é o **único item aberto** dela: `M2` (motores como
dados), `C1` (leis de execução e comando de token) e `U1` (erros estruturados) estão entregues.

### A medição que forçou esta decisão

Inferir o **conjunto de ferramentas** de cada skill a partir do conteúdo produz erro nos dois
sentidos. Foi medido, não suposto:

- **Falso positivo:** `arch-hexagonal` produz **13** sinais de rede — `10× "web"`, `2× "HTTP"`,
  `1× "Web"` — porque a skill fala de **adaptadores web e HTTP como vocabulário de Ports &
  Adapters**. Ela não acessa rede nenhuma. A palavra é o **domínio**, não o comportamento.
- **Falso negativo:** `adr-create`, cuja função é **escrever** arquivos de ADR, produz **zero**
  sinais de escrita.

É a mesma classe de erro que a varredura de ancoragem bruta do programa já cometeu: 391 contra 118
a favor do OpenSpec, que **inverteu** ao normalizar por mil linhas (2,03 contra 3,80).

**Reference:** Technical spec at specs/frontmatter-de-skill-declarado/03-spec.md.

## Decision

1. **A auditoria infere as QUATRO classes de capacidade perigosa que o ADR-0007:26-33 nomeia
   textualmente** — exfiltração, comando shell embutido, auto-modificação de config ou instalação
   de skills, e tentativa de override (*"ignore previous instructions"* e variantes) —, compara com
   o declarado **nesses termos** e aplica os três ramos daquele ADR. **Não** infere o conjunto de
   ferramentas.

2. **O `allowed-tools` da fonte é declarado em vocabulário canônico do MGR e traduzido por motor no
   install.** Razão medida: `agentTools` nos descritores já declara vocabulário **diferente** por
   motor — claude-code usa `Read, Grep, Glob` e `Read, Grep, Glob, Write, Edit`; copilot usa
   `["read", "search"]` e `["read", "search", "edit"]` —, e `skills/*/SKILL.md` é fonte única
   instalada nos dois. É o **mesmo desenho** da decisão 5 do ADR-0004 (*"claude-code injeta
   `model`/`effort` no frontmatter; copilot warning"*) e do que `agentFrontmatter(engineId, intent,
   policy)` em `src/builder.js:162` já executa. Mecanismo existente aplicado a um campo a mais, não
   mecanismo novo.

3. **O valor declarado de cada skill sai de sinal estrutural revisado** — bloco de comando cercado,
   invocação de `mgr <sub>`, caminho de arquivo citado, referência a template, e o perfil de
   `agentTools` quando um agente embrulha a skill —, **apresentado ao autor para revisão antes de
   ser escrito**. Nem contagem de palavra, nem suposição.

4. **Cada campo opcional entra onde ele pertence, não em todas as skills.** O padrão diz *"most
   skills do not need the `compatibility` field"* e que ele *"should only be included if your skill
   has specific environment requirements"*. Exigir os quatro campos nas treze seria **exigir o
   impossível** — o defeito que o ADR-0020 corrigiu na `DOC-1`, e que não se repete aqui.

5. **`license: Source-Available v1.0. LICENSE has complete terms` nas 13.** A forma é o exemplo
   literal do padrão (`license: Proprietary. LICENSE.txt has complete terms`) com o nome real da
   licença do projeto. O padrão **não exige SPDX**: define o campo como *"License name or reference
   to a bundled license file"*. **Fica registrado que a objeção contrária foi levantada ao autor
   antes da spec e era infundada.**

6. **A FONTE continua 100% conforme o padrão:** em `skills/*/SKILL.md` só entram campos que o
   padrão define. O ADR-0004 **rejeitou** campo próprio do MGR no frontmatter porque *"campos fora
   do padrão no frontmatter poluem o contrato que as plataformas leem"*, e esta decisão não reabre
   isso.

> **Emenda de 2026-09-17, no mesmo dia, vinda da P0.1 — e ela corrige um FATO que esta decisão
> tinha errado.**
>
> **(a) A redação original dizia "o `SKILL.md` continua 100% conforme", sem distinguir fonte de
> instalado.** Medido: o install **já injeta** `context: fork`, `agent: mgr-review` e
> `background: false` no arquivo instalado (`src/builder.js:258-259`, acionado por
> `routing: "fork"`). Os três **são documentados pelo Claude Code**
> (`https://code.claude.com/docs/en/skills`, lida em 2026-09-17) — são campos **da plataforma**, não
> do MGR, então o ADR-0004 não é violado. Mas o *"100% conforme"* vale para a **fonte**; o instalado
> carrega, além disso, o que a plataforma define.
>
> **(b) E a mesma doc inverte o SENTIDO do `allowed-tools`.** Ela diz: *"Tools Claude can use
> **without asking permission** during the turn that invokes this skill. The grant clears when you
> send your next message."* E lista, **separadamente**, `disallowed-tools` — *"Tools removed from
> Claude's available pool while this skill is active."*
>
> **`allowed-tools` CONCEDE; `disallowed-tools` RESTRINGE.** Declarar uma ferramenta em
> `allowed-tools` faz ela rodar **sem pedir permissão** — não limita a skill àquele conjunto. Então
> chamar isto de *"menor privilégio declarado"*, como o item `M1` do programa e a linha 9 do painel
> §8 fazem, **é o nome errado**: declarar **mais** entrega **mais auto-aprovação** e remove a
> confirmação que protege quem instala.
>
> **Decisão do autor sobre o achado, em 2026-09-17:** a fatia declara **só `allowed-tools`**, com o
> sentido corrigido — **o conjunto MÍNIMO que cada skill precisa rodar sem perguntar**, e não "o que
> ela usa". O `disallowed-tools` fica **fora**: ele é só do Claude Code, não existe no padrão aberto,
> e declará-lo na fonte quebraria a decisão 6. A linha 9 do painel passa a se chamar **capacidade
> declarada** em vez de menor privilégio — **corrigir o nome do critério, não entregar outra coisa**.
>
> **Ganho de brinde da mesma leitura:** o Claude Code **honra** o campo, o que já responde metade do
> `CA-10`; e ele aceita *"a space- or comma-separated string, or a YAML list"*, mais permissivo que o
> padrão aberto (só espaço) — escrever no formato do padrão funciona nos dois.

## Alternatives Considered

- **Inferir o conjunto completo de ferramentas de cada skill:** rejeitada pela medição do
  *Context* — falso positivo em `arch-hexagonal`, falso negativo em `adr-create`. Prometeria o que
  não se entrega.
- **Declarar `allowed-tools` literal na fonte, sem tradução:** rejeitada porque o vocabulário de
  ferramenta difere por motor e a fonte é única — o literal estaria errado em pelo menos um motor.
- **Um `SKILL.md` por motor na fonte:** rejeitada por violar a §3.5 da constituição (fonte única;
  regras transversais vivem em **um** lugar).
- **Declarar os quatro campos opcionais nas treze skills:** rejeitada porque contraria a orientação
  do próprio padrão sobre `compatibility` e repetiria o defeito da `DOC-1`.
- **Corrigir nesta fatia a inconsistência do `checkSkill`** — ele devolve array de strings, e não os
  findings estruturados de `src/findings.js` que os eixos de `mgr spec validate` usam: rejeitada
  porque mudar a saída de `mgr validate` é mudança de contrato documentado em
  `docs/sdd/03-contracts.md §3`, e a §2.7 da constituição exige migração automática e anunciada.
  Fica como **achado registrado** para fatia própria.
- **Usar o campo `metadata` do padrão para carregar os campos do MGR:** rejeitada pelo ADR-0004, que
  já decidiu isso — o `metadata` aceita só string→string, insuficiente para `permissions[]` e
  `model{}`.

## Consequences

### Positive

- ~~**Nenhuma skill do CORE continua no terceiro ramo do ADR-0007:** o produto passa a cumprir o que
  cobra de terceiros.~~ — **corrigido pela emenda abaixo.**
- **O `mgr audit` que o ADR-0007 situou na Fase 2 passa a existir**, com escopo fiel ao que aquele
  ADR decidiu — e não maior do que ele.
- Fecha o **último item aberto da Fase 0** do programa, e a **linha 9** do painel §8 (menor
  privilégio declarado), a única das onze que é segurança.
- O contraste com o OpenSpec deixa de ser **por ausência**: as 12 skills deles declaram os quatro
  campos (verificado em 2026-09-11, pacote `@fission-ai/openspec` 1.13.0); as 13 daqui passam a
  declarar os que cabem.

> **Segunda emenda, de 2026-09-18, vinda do gate de fechamento — e ela corrige uma consequência que
> o código entregue REFUTA.**
>
> A primeira consequência positiva dizia *"nenhuma skill do CORE continua no terceiro ramo"*.
> **Cinco continuam**, e a própria suíte o afirma:
> `assert.deepEqual(porRamo, { [NOTHING_TO_DECLARE]: 8, [UNDECLARED]: 5 })`. Aquela redação é
> anterior à decisão da P0.3, que tornou a condição insatisfazível pelo mesmo caminho que tornou o
> `CA-2` insatisfazível — o `CA-2` foi retirado com razão datada, e este bullet não foi tocado.
>
> **O que de fato se entregou:** as 13 têm o campo **resolvido**; **8** ficam fora dos três ramos, em
> *"nada a declarar"*, e **5** permanecem em *"não declarou"* — que é o comportamento **seguro** e
> passa a ser **visível**, em vez de invisível como era antes desta fatia.
>
> **Segunda correção, na mesma emenda:** a frase *"a linha 9 do painel §8 (menor privilégio
> declarado)"* usa o nome que a primeira emenda deste ADR determinou trocar. A linha passa a se
> chamar **capacidade declarada**.
>
> **Terceira:** a *Negative* dizia que *"`allowed-tools` é experimental e o suporte varia entre
> implementações... nenhum motor é obrigado a honrar o campo"*. A P0.2 mediu o contrário: os **dois**
> motores honram, com a **mesma** semântica de concessão, com URL e data. A ressalva `(Experimental)`
> do padrão aberto é real, mas **não se materializou em divergência entre estes dois**. O que
> continua valendo é que nenhum motor é *obrigado* — não que nenhum honre.
>
> **Quarta, quinta e sexta, do mesmo gate: três afirmações que ficaram sem marca nesta emenda e que o
> código entregue refuta.** Ficam corrigidas aqui, e não no texto original, porque ADR aceito não se
> reescreve em silêncio:
>
> 1. A decisão do autor citada acima diz que *"a fatia declara só `allowed-tools`, com o sentido
>    corrigido — o conjunto MÍNIMO que cada skill precisa rodar sem perguntar"*. **O que se declarou
>    foi `license` nas 13 e `compatibility` na `junit-clean`; o `allowed-tools` está em ZERO.** A
>    decisão foi *"declarar só `allowed-tools` **se** algum fosse declarado"*, e a P0.3 concluiu que
>    nenhum deveria ser — o `CA-1` registra isso como **ausência deliberada**.
> 2. O primeiro risco diz *"declarar a **mais** desfaz o menor privilégio que o campo existe para
>    entregar"*. Essa é a redação que a **primeira** emenda deste ADR derrubou: o campo **concede**,
>    não entrega menor privilégio. O risco real é que declarar a mais **concede auto-aprovação**.
> 3. O *Context* diz *"as 13 skills do CORE do próprio MGR caem todas no terceiro ramo, o pior"*.
>    **Medido: 5 caem no terceiro ramo e 8 ficam FORA dos três**, porque não têm nenhuma das quatro
>    classes. A frase valia antes de o comando existir para medir.

### Negative

- **A comparação declarado-vs-inferido acontece em termos de CLASSE.** Uma skill pode declarar
  `allowed-tools` a menos e a auditoria **não pegar**, se o que falta não cair numa das quatro
  classes. **Limite conhecido, não defeito a corrigir depois** — e declarado também no CHANGELOG.
- **`allowed-tools` é experimental** e o suporte varia entre implementações. A fatia entrega
  declaração **auditável**, nunca *enforcement*: nenhum motor é obrigado a honrar o campo.
- O ADR-0007 **vetou** *"prometer scanner que garante segurança"* e registra falsos positivos e
  negativos inerentes à análise de linguagem. Isto continua valendo: a auditoria reduz risco e
  mostra o que viu; a decisão é humana.
- O `SKILL.md` da fonte, lido fora do install, mostra vocabulário canônico e não o do motor — o
  mesmo trade-off que `{{MGR_ARCH_RULES}}` e `{{MGR_USER_LANGUAGE}}` já carregam.
- O frontmatter instalado muda, então quem já instalou só recebe no `mgr update`. Se checksum ou
  lockfile registrarem o `SKILL.md` instalado, a migração tem de ser **anunciada** (§2.7).

### Risks and Mitigations

- **Risco:** declarar `allowed-tools` a **menos** faz a auditoria acusar divergência que é defeito
  da declaração; a **mais** desfaz o menor privilégio que o campo existe para entregar.
  **Mitigação:** o valor sai de sinal estrutural e é **revisado pelo autor antes de ser escrito**
  (decisão 3), e o `CA-8` exige um teste com **divergência plantada**.
- **Risco:** afirmar o comportamento de um motor sem verificar. **Mitigação:** uma task `P0` lê a
  documentação **oficial** de cada motor e registra, **com URL e data**, o que cada um faz com o
  campo — registrar *"não honra"* satisfaz o critério (`CA-10`). O descritor de motor carrega isso
  como **dado**, nunca `if` por nome de motor.
- **Risco, JÁ MATERIALIZADO e registrado aqui em vez de descoberto depois:** declarar `metadata`
  hoje produz **leitura errada em silêncio**, porque `frontmatter()` em `src/validator.js` é parser
  de **linha** — com `metadata:` aninhado ele produz valor vazio e promove `author` a chave de topo.
  **Mitigação:** o parser passa a ler **um** nível de aninhamento, e só um; profundidade maior é
  entrada inválida, não caso a suportar (`CA-6`).
