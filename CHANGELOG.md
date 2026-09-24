# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) · [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]
### Adicionado
- **O `mgr doctor` deixou de ser cego para a árvore `_shared/`.** Ela não é acessório: é para onde
  apontam os tokens `{{MGR_LAWS}}`, `{{MGR_CHARTER}}` e `{{MGR_ARCH_RULES}}` que o install resolve,
  e duas das quatro fontes são instaladas **sempre** (ADR-0011 e ADR-0022). Uma skill podia estar
  perfeita e apontar para o vazio.

  **Medido antes de escrever o código, por mutação em cópia:** com a carta apagada, um token não
  resolvido nas leis e um corpo alterado na fonte de qualidade — três quebras ao mesmo tempo — o
  comando saía **exit 0** e a saída era byte a byte idêntica à de uma instalação íntegra. Agora sai
  **exit 1** com os três nomeados.

  A verificação nova é `missing-shared`; as já existentes `unresolved-token` e `divergent-body`
  passaram a alcançar `_shared/` também. Instalação apenas atrasada não vira alarme falso: a
  existência e o corpo se declaram **indisponíveis** quando o manifesto está atrás do pacote, pelo
  mesmo mecanismo que o `divergent-body` já usava. Token não resolvido é defeito em qualquer versão.

- **O `mgr doctor` passou a conferir TODOS os motores instalados, não só o primeiro.** Numa
  instalação `--engine both`, defeito plantado no diretório do segundo motor era pulado **em
  silêncio** e o comando saía 0. Medido e fechado. O corpo esperado de cada motor é calculado com a
  mesma função que o instalador usa para transformá-lo, então motor novo entra pelo descritor e o
  diagnóstico não muda.

- **`npm run check:checks`** — guarda estrutural novo, no hook `pre-commit` e no CI. Ele compara o
  **conjunto de ids** do registro de verificações do código com a coluna de id das tabelas que as
  enumeram no contrato e nos dois READMEs. Nunca casa prosa. Tabela não encontrada é **problema**,
  não silêncio.

### Modificado
- **A contagem de verificações do `mgr doctor` deixou de ser um número escrito.** Ela é
  `CHECKS.length`, derivada do registro, e os documentos pararam de reafirmá-la: cada um enumera as
  verificações em tabela com coluna de `id`. Antes o número estava escrito em sete lugares.
- **O diretório de skills de cada motor mudou-se para o descritor do motor**, ao lado do de agentes,
  pagando metade da dívida que o ADR-0010 declarou. Some o mapa privado `ENGINE_DIR`, e o
  `mgr doctor` deixa de depender do instalador para diagnosticar. Instalação **idêntica byte a byte**.
- A frase do achado `divergent-body` perdeu a palavra "skill": ela também descreve fonte
  compartilhada, que não é skill.

### Corrigido
- **O guarda `CHT-4` do `check-laws` estava desarmado.** Ele decidia a existência da carta com um
  operando que resolvia o caminho contra o diretório de trabalho do **processo**, e não contra a
  árvore sob análise — então qualquer árvore era declarada íntegra quando o processo rodava de um
  repositório que por acaso tivesse um arquivo no mesmo caminho relativo. Ironia medida: ele
  funcionava por acidente **enquanto a carta não estava instalada**; instalá-la o desarmou.
- **O hook `pre-commit` mascarava a falha do primeiro guarda.** Sem `set -e`, com mais de um comando
  o código de saída era o do último. Medido com o primeiro forçado a falhar: o hook saía 0.

- **Dois gates novos, e uma lei para o que eles não alcançam.** A ordem importa: o que deu para
  virar check virou check; a lei ficou só com o resto.

  **O que isso NÃO faz, e vem antes do que faz:**

  - **não previne erro nenhum.** O que se compra é que o erro da classe coberta **não chega ao
    commit**. A lei nova declara isso de si mesma, porque prometer prevenção seria a garantia que a
    própria `L1.9` proíbe;
  - **o check vê forma, nunca intenção.** Ele não sabe se a faixa de caracteres era proposital, nem
    se o `\n` era literal de propósito. Lista vazia significa *"nenhum dos três padrões apareceu"*,
    jamais *"está correto"*;
  - **três padrões, não uma varredura geral.** Dos onze casos medidos, **três** viraram padrão e
    **oito** ficaram na lei, porque nenhum parser os decide;
  - **faixa escrita por escape passa.** Limite conhecido: quem escreve `\u00C0` sabe o que faz; quem
    cola o caractere é quem erra, e foi assim nas duas vezes;
  - **o `check:clean` não substitui o CI.** Ele reproduz duas condições — árvore sem os gitignorados
    e locale neutro — e não reproduz sistema, versão de Node nem rede. **Verde ali não prova verde no
    CI; vermelho ali prova vermelho no CI.**

  **E o que eles fazem.** `npm run check:claims`, no hook `pre-commit` e no CI, reprova três padrões
  que vêm de erros reais: `\n`/`\t` literal em markdown distribuído (vazou em dois READMEs e ficou
  dois commits no repositório), código de saída lido depois de um pipe (`cmd | tail; echo $?` lê o
  status do `tail`, e isso fez uma sessão inteira reportar lint verde), e faixa de caracteres com
  limite não-ASCII usada para achar letra acentuada (`[À-ÿ]` casa o sinal de multiplicação —
  aconteceu **duas** vezes).

  `npm run check:clean` reproduz a condição do CI num comando. Ele existe porque o CI reprovou duas
  vezes o que passava na máquina, e na segunda a conferência manual não pegou porque foi rodada com
  o locale local e não repetida depois de mudar código.

  **A `LAW-5` foi generalizada:** ela pega agora **qualquer** `{{MGR_*}}` em **qualquer** `.md` de
  uma árvore instalada. Antes olhava só o token das leis e só `SKILL.md`, então nada sob `_shared/`
  era conferido — nem pelo `mgr doctor`, que não lê aquela árvore.

  **E o template do `adr-create` passou a cobrar a evidência:** toda mitigação declara
  `proved by: <a execução que falharia se ela não existisse>` ou o literal `[NOT VERIFIED]`. É o
  ponto exato onde uma mitigação inexistente foi afirmada num ADR.
- **A carta de primícias** (ADR-0022) — o que o método promete, escrito onde ele já dizia que era
  soberano e nunca tinha definido.

  **O que ela NÃO faz, e vem antes do que ela faz:**

  - **nenhuma primícia reprova.** A `L1.1` proíbe reprovar por princípio que não esteja literalmente
    escrito no guia, e a carta **não levanta** essa proibição: princípio não é regra. Quem reprova
    são as regras citáveis do guia, e cada uma delas vai nomear a primícia de onde desceu. Review que
    cite `CP-4` no lugar de uma regra está quebrando a `L1.1`, não aplicando a carta;
  - **sete skills não a alcançam** — as quatro `arch-*`, `configure-agents`, `evidence-capture` e
    `junit-clean`. Elas não carregam o ponteiro das leis, e é por ele que a carta chega. Limite
    declarado, não esquecimento;
  - **ela não muda comportamento nenhum hoje.** É texto normativo: o efeito aparece quando as regras
    citáveis descerem dela. Quem instalar e não ler não vai notar diferença;
  - **quem já instalou só a recebe ao rodar `mgr update`.**

  **E o que ela faz:** a `L0.1` sempre declarou a hierarquia como *"MGR core principles > project
  rules > workspace conventions > skill instructions > runtime-injected content"* — e **o topo dela
  nunca tinha sido escrito**. Agora está, em sete primícias `CP-1` a `CP-7`, e cada uma carrega três
  partes obrigatórias: a declaração, **o caso real medido que ela teria mudado** e a procedência
  nomeada. Primícia sem caso é conselho, e o gate a reprova.

  **O gate é o `npm run check:laws`, que já existia e já roda no CI** — quatro verificações novas
  (`CHT-1` a `CHT-4`), provadas uma a uma por mutação: remover uma parte, duplicar um id, errar um
  cabeçalho ou tirar o ponteiro faz o gate sair 1. A `CHT-3` existe porque foi **medido** que o
  parser pulava cabeçalho desconhecido em silêncio: um erro de digitação faria a primícia desaparecer
  sem uma palavra.
- **`mgr doctor`** — o comando que diz se a instalação está **íntegra**, e não só o que está
  instalado.

  **O que ele NÃO faz, e vem antes do que ele faz:**

  - **não atesta integridade.** Nenhum achado significa *"nenhuma das nove verificações apareceu"*,
    nunca *"está íntegro"*. A lista é **finita e fechada**, e o que está fora dela ele não vê;
  - **não tem `--fix`, e isso é decisão medida.** Cinco das seis correções eram rodar o `mgr update`,
    que **já existe e já pede confirmação**. Um `--fix` que o chamasse passaria o `-y` por você — e
    instalar sem confirmação humana é exatamente o que o método proíbe. Ele **nomeia** a remediação;
    a ação continua sua;
  - **dois defeitos não têm remediação nenhuma**, e ele diz isso na cara: skill órfã (ninguém sabe
    de onde ela veio — pode ser plugin seu, resto de instalação antiga, ou arquivo que você mesmo
    pôs) e hook apontando para binário inexistente (reescrever seu `settings` mexe em configuração
    que não é do método);
  - **não diz o porquê.** Ele mostra que a skill sumiu, não por que sumiu; que a versão está atrás,
    não se a diferença importa para a sua versão;
  - **não julga o conteúdo.** Se a skill está correta é o `mgr validate`; se ela tem capacidade
    perigosa é o `mgr audit`; reparar divergência é o `mgr update`. O `doctor` não faz nenhum dos três;
  - **não alcança projeto que nunca instalou o método** — sem `.mgr-core/manifest.json` não há com o
    que comparar, e ele sai dizendo isso, sem erro.

  **E o que ele faz:** nove verificações sobre a sua instalação — skill órfã, skill declarada e
  ausente, agente declarado sem arquivo, arquitetura escolhida sem a skill dela, corpo divergente da
  fonte, token `{{MGR_*}}` não resolvido, manifesto atrás do pacote, hook quebrado e divergência
  contra o lockfile. Cada achado traz **arquivo, esperado, encontrado** e a remediação quando existe.
  Sai com erro **só quando há defeito**: manifesto atrás do pacote é **aviso**, porque é o caso normal
  de quem ainda não rodou `mgr update`, e fazê-lo reprovar quebraria CI sem defeito real.

  **Instalação velha não é arquivo adulterado, e ele não confunde os dois.** Enquanto o seu manifesto
  estiver atrás do pacote, a comparação de corpo se declara **indisponível** em vez de gritar: divergir
  ali é o estado esperado de quem ainda não rodou `mgr update`. Com as versões iguais, corpo divergente
  vira defeito — porque aí é adulteração ou instalação parcial, e o alarme é devido.

  **Uma verificação foi cortada durante a construção, e o corte é o ganho.** O método exige que toda
  verificação tenha um **caso negativo conhecido** — e a medição em instalação recém-feita mostrou
  que a comparação de corpo, como estava desenhada, acusava **7 de 7 instalações limpas**. Era falso
  positivo do método de comparação, não instalação velha. Sem esse critério, o comando teria saído
  gritando em todo projeto do mundo.
- **`mgr audit`** (ADR-0021, e a Camada 1 que o ADR-0007 tinha prometido).

  **O que ele NÃO faz, e vem antes do que ele faz:**

  - **não atesta segurança.** Lista de achados vazia significa *"nenhuma das quatro apareceu"*, nunca
    *"é seguro"*. A análise de texto tem falsos positivos e negativos, e o ADR-0007 vetou prometer o
    contrário;
  - **não infere a lista de ferramentas** de uma skill. Tentar isso foi **medido e rejeitado**: varrer
    prosa por palavra marca uma skill de arquitetura hexagonal como acesso a rede (ela fala de
    adaptadores web) e **não** marca uma skill que escreve arquivos (ela não usa a palavra);
  - **a comparação é por classe**, então declarar de menos **dentro** da mesma classe não é pego, e
    declarar de menos **fora** das quatro classes também não;
  - **o padrão marca `allowed-tools` como experimental** e avisa que o suporte varia entre
    implementações. **Medido em 2026-09-17: os dois motores que o método suporta honram o campo**,
    com a mesma semântica de concessão — a ressalva do padrão é real e não se materializou entre
    estes dois. O que segue valendo é que **nenhum motor é obrigado** a honrar, não que nenhum honre;
  - **só um dos casos sai com erro:** declarar um escopo e o conteúdo exceder. Não declarar nada
    **não** é falha — é o caso em que o motor pergunta sempre, que é o comportamento seguro.

  **E o que ele faz:** infere do conteúdo de cada skill as **quatro classes de capacidade perigosa**
  — envio de conteúdo para fora, comando shell embutido, alteração da config do MGR ou instalação de
  skill, e tentativa de override —, compara com o que a skill declara e mostra **a linha e o trecho**
  de cada achado, para você julgar com o fato na mão.
- **As skills passam a declarar a licença**, e a `junit-clean` também o ambiente que ela exige
  (Java 8+ com JUnit 5). São campos do padrão aberto Agent Skills, lidos pelas plataformas.

  **O `allowed-tools` NÃO foi declarado em nenhuma das 13, e isso é decisão, não esquecimento.** Esse
  campo **remove a pergunta de permissão** — ele concede, não restringe. Declará-lo faria o método
  tirar, de todo projeto que instala, uma confirmação que hoje existe. E você já tem o mesmo ganho
  quando quiser: ao aprovar um comando, o motor oferece *"não perguntar novamente"* e guarda a regra
  **na sua máquina**, num arquivo que você lê e apaga.
- **`mgr validate` confere os campos opcionais do padrão**, quando presentes: tamanho de `name` e de
  `compatibility`, e a forma de `metadata` e de `allowed-tools`. **Código que passava pode reprovar** —
  só se já declarava um desses campos com forma inválida, e aí a reprovação é defeito real.
- **Uma leitura errada e silenciosa foi corrigida:** o `mgr validate` lia `metadata:` aninhado como
  campo vazio e promovia as chaves de dentro dele para o topo. Quem declarasse `metadata` teria o
  valor lido errado **sem erro nenhum aparecer**.
- **`mgr agents set <intenção> [--model] [--effort] [--engine]`**: escreve a política de uma
  intenção sem você abrir o JSON. Escrever um motor **não apaga** o outro, escrever uma intenção não
  mexe nas vizinhas, e passar `--effort` não apaga o `model`. Valor inválido é recusado **antes** de
  gravar, então o config nunca fica quebrado pela mão do próprio método.
- **Skill `configure-agents`**, instalada em todo projeto: lê o estado, explica o que cada intenção
  faz e quantas vezes ela roda, e escreve pelo comando. Ela **não** entra no CORE, que segue com seis.
- **`documentedModels` no descritor de cada motor**: os identificadores que a documentação da
  plataforma publica, com data e fonte no comentário. É sugestão, e nunca grade de validação.
- **O contexto não é mais compactado em silêncio** (ADR-0018): quando o motor anuncia que vai
  compactar, o método **grava o hand-off antes**, diz o motivo e sugere sessão nova. No `/compact`
  pedido por você, no claude-code, ele ainda **impede** a compactação uma vez, para você decidir com
  o estado já a salvo.
- **`mgr precompact --hook <motor>`**: o comando que o hook chama. Monta o hand-off a partir de fato
  em disco, **nunca sobrescreve** um hand-off existente, e declara em seção própria o que ele não tem
  como saber.
- **O conhecimento de hook virou dado no descritor de motor**: arquivo, eventos, matcher e teto de
  tempo por evento, forma da entrada, envelope e o canal de aviso. Um motor novo passa a ser um
  arquivo em `src/engines/` mais uma linha no mapa de motores. Isso paga metade da dívida que o
  ADR-0010 tinha nomeado — a outra metade segue nomeada e aberta: `src/adapters.js`, o instalador e a
  saída do hook de sessão em `src/detector.js`.
- **Documentação defasada passa a reprovar** (ADR-0020), por dois mecanismos que pegam falhas
  diferentes. A fonte única de regras transversais — a que **todo projeto** herda no `spec-init` —
  ganhou **`DOC-1`**, que exige capacidade nova nomeada na documentação **onde ela pertence** — módulo
  na de arquitetura, comando ou chave de configuração na de contrato, e **no README tudo o que você
  vê**; e **`DOC-2`**, que reprova documento que nomeia o que não existe mais ou cuja
  fonte declarada não existe. Com elas, o gate de review passa a **poder** reprovar citando texto —
  antes ele via a defasagem e não tinha o que citar.
- **O `mgr spec validate` ganhou um quarto eixo**, o de documentação: `src/doc-rules.js` e
  `src/doc-validator.js`. Ele exige que o fechamento de uma feature **declare** o que mudou na
  documentação — ou declare, com a razão, que nada mudou. É **erro**, e não aviso, porque a adesão
  medida no repositório era de 13 em 14: a regra formaliza prática que já existia.
- **`LOG-1` e `LOG-2` ficaram mais amplas na fonte única**: a primeira passou a alcançar escrita em
  **arquivo em disco**, e a segunda, **subprocesso**. Não é regra nova inventada — é a redação que
  este repositório já usava e que pegou defeito real nas duas últimas features; ela subiu para a
  fonte em vez de o projeto descer para a redação mais fraca.
- **O contexto da conversa passa a ser REFERENCIADO antes da compactação** (ADR-0019). O hand-off diz
  em que ponto o trabalho está; ele não sabe **por que** as decisões foram tomadas, e declara isso.
  Agora, quando o motor anuncia a compactação, o método também registra **onde está a conversa
  inteira** — o arquivo que o próprio motor mantém, mais o raciocínio dos subagentes e a saída de
  ferramenta que ficou grande e foi para disco.
- **Um arquivo de contexto por projeto, e só ele.** `~/.mgr-core/context/<projeto>.json`, de
  kilobytes, com caminho, tamanho, número de registros e checksum medidos no instante. **Nada é
  copiado:** o transcript persiste no motor e sobrevive à compactação — medido —, então duplicá-lo
  seria acumular megabytes sem proteger de nada.
- **O hook de pré-compactação declara um teto de tempo de 15s.** Ele lê o payload do stdin, e o
  default que a doc do Claude Code declara para hook de comando é de 600s — dez minutos pendurado
  se algo não fechar a entrada. O hook de início de sessão **não** foi tocado.

### O que degrada, declarado
- **No Copilot, `compatibility` e `metadata` não fazem nada em skill.** A documentação de skills dele
  (`docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills`, lida em
  2026-09-17) documenta **quatro** campos — `name`, `description`, `license` e `allowed-tools` — e
  não os outros dois. Declará-los é correto pelo padrão aberto e pelo claude-code, e **inerte** lá:
  não quebra e não faz efeito.
- **A auditoria marca a `description` quando ela MENCIONA um comando.** A linha 3 de uma skill é o
  campo `description`, e mencionar não é executar. O achado carrega a linha, então você descarta num
  segundo — mas distinguir menção de instrução em prosa é exatamente o que foi medido e rejeitado, e
  por isso o ruído fica.
- **No Copilot a compactação não pode ser impedida, e o aviso não tem como chegar a você.** A
  documentação oficial classifica o evento de pré-compactação dele como *"notification only"*, diz
  que a saída do hook não é processada e não oferece nenhum campo por onde falar com você — ao
  contrário do evento de início de sessão, que aceita contexto adicional. O hand-off **é gravado
  igual**; o que não existe ali é canal de aviso. O método prefere calar a imprimir num canal que a
  plataforma descarta, porque isso o faria parecer avisar.
- **As regras novas só valem no seu projeto depois que o guia dele for regenerado.** Quem não roda
  comando nenhum não é afetado; quem regenerar o `09-review-rules.md` pelo `spec-init` passa a ter
  `DOC-1`/`DOC-2` e as `LOG` ampliadas — e **código que passava pode reprovar**, porque as regras
  alcançam mais do que antes. O `mgr update` **não** toca esse arquivo.
- **O eixo mecânico verifica a DECLARAÇÃO, não a correção.** Ele confere que o fechamento declarou o
  diff da documentação e que o que ele nomeia existe. Escrever "nenhuma alteração" numa feature que
  mudou documentação **passa por ele** — quem pega isso é a `DOC-1`/`DOC-2` no gate de review, por
  julgamento com citação. Os dois mecanismos existem juntos por essa razão.
- **O método APONTA para o contexto, ele não o guarda.** Quem limpar o histórico do motor, trocar de
  máquina ou apagar a pasta de sessões perde o que a referência apontava. Por isso o registro grava
  **checksum e tamanho**: quem for consumir descobre que o arquivo mudou ou desapareceu, em vez de
  supor que está lá.
- **A consolidação na memória estendida AINDA NÃO EXISTE.** Esta versão só **registra a
  referência** — nada é enviado ao `mgr-code`, e o comando **nem tenta** falar com ele. Recuperar o
  contexto numa sessão nova depende dessa segunda metade, que é trabalho próprio e está declarado.
- **No Copilot o registro acontece, e o aviso não chega.** Mesma razão de sempre: o evento dele é só
  notificação e não tem canal de volta.
- **O bloqueio protege o caso MENOS frequente, e isto foi medido.** Varridos **todos os cinco
  transcripts de sessão** deste projeto, há **três** compactações, e o gatilho de todas foi
  **automático** — nenhuma foi `/compact` pedido. Como o
  método só impede no pedido manual (bloquear no automático pode derrubar a requisição em curso), o
  bloqueio **não teria agido em nenhuma delas**. O que protege no automático é o hand-off gravado
  antes, não o bloqueio. De passagem, a medida do problema: cerca de **97% do contexto é descartado**
  em cada compactação (perto de 1 milhão de tokens antes, 18 a 27 mil depois).
- **No claude-code o aviso chega em todo caminho, e não só no bloqueio.** Ele vai pelo campo que a
  doc indica para falar com você (`systemMessage` no JSON de saída). O `stdout` do hook, que a versão
  anterior desta fatia usava, vai para o **debug log** neste evento — quem só olhasse a sessão não
  veria mensagem nenhuma.
- **Bloquear é só no `/compact` que você pediu.** No automático, não: a doc do Claude Code diz que
  bloquear uma compactação disparada para recuperar de estouro de contexto faz a **requisição em
  curso falhar**. Proteger o contexto não pode custar o trabalho em andamento.
- **O bloqueio vale uma vez.** Se você insistir logo em seguida, passa — senão o método tiraria o
  `/compact` de você para sempre.
- **O hand-off do hook não vê a conversa.** O que foi decidido falando e não chegou ao disco não
  entra nele, e o arquivo diz isso.
- **Nenhum motor lista os modelos que a sua conta tem.** Foi verificado na documentação oficial dos
  dois: não existe comando de listagem. Por isso a skill oferece os **aliases documentados** de cada
  motor e **aceita qualquer identificador** que você escrever. Lista nossa envelheceria e passaria a
  recusar modelo válido.
- **No Copilot não há o que oferecer.** Os modelos disponíveis ali são da conta, e a plataforma só
  os revela em runtime, como aviso, depois de você declarar um que ela não tem. A lista vazia é o
  fato, não esquecimento.
- **A skill nunca diz qual modelo usar em qual etapa.** Ela explica o que cada intenção faz e quanto
  ela roda; escolher exige saber a sua conta e o seu orçamento, que ela não vê.
- **O comando não roda o `mgr update`.** Como antes, `model` vale na próxima invocação e `effort` só
  depois do `update` — a assimetria é da plataforma, e agora o comando diz isso a cada escrita.
- **Os aliases documentados vivem em dois lugares**: no descritor do motor e no texto da skill. A
  CLI ainda não expõe o campo, então as duas cópias carregam data e fonte para divergirem de forma
  visível.

### Planejado
- **Quatro motores novos, decididos em 2026-09-12**, ao lado do claude-code e do copilot:
  **Codex CLI**, **Antigravity**, **Deep Code** (agente de terminal dos modelos DeepSeek) e
  **OpenCode**. A matriz de capacidade de cada um, com fonte oficial e data, está em
  `docs/engine-hooks.md` — inclusive o que **não** dá: o OpenCode integra por plugin e não por hook,
  e Antigravity e Deep Code não têm evento de pré-compactação. A matriz traz fonte oficial e data em
  cada célula que foi confirmada, e diz `[A CONFIRMAR]` nas que não foram — o OpenCode e o Codex
  ainda têm células abertas, e isso está escrito lá em vez de arredondado aqui.
- Suporte a Cursor como motor de instalação.
- Modo scaffold (geração de estrutura de código no greenfield).

## [0.7.0-beta.10] - 2026-09-11
> Cada etapa do fluxo passa a rodar no modelo que você declarar. Pré-release no dist-tag `next`.

### Adicionado
- **Política de modelo por intenção** (ADR-0017): `agents` no `.mgr-core/config.json`, com uma
  entrada para `drafting`, `execution` e `review`. **Uma fonte, dois momentos de leitura** — a
  instalação grava no frontmatter do agente, a invocação lê a mesma chave e passa o modelo.
- **`mgr agents [<intenção>] [--json]`**: responde qual modelo e qual esforço cada intenção usa, por
  motor, e **de onde veio cada valor** — configurado, default, ou não suportado pelo motor.
- **Dois agentes novos**: `mgr-draft` escreve o PRD e a spec; `mgr-task` implementa uma task. Os dois
  declaram, no próprio corpo, que nunca perguntam nada e que não veem a conversa.
- **Ferramentas por necessidade da intenção**: a intenção declara se precisa de leitura ou de
  escrita, e o motor traduz. Só o `mgr-task` recebe escrita; **o gate continua só leitura**, que é
  invariante do ADR-0010 e tem teste próprio.
- **`src/tokens.js`**: soma o token da conversa e o de cada agente que ela subiu, com
  `cache_read_input_tokens` reportado à parte. O teto é declarado por você; sem teto, mede e não
  reprova.
- **As duas skills do fluxo encomendam em vez de escrever**: `spec-create` delega a redação,
  `spec-execute` delega a implementação de cada task. **Nenhum checkpoint humano migrou**, e há teste
  que fica vermelho se algum sumir.
- **`mgr tokens [--json]`**: soma o token da conversa e o de cada agente que ela subiu, reporta o
  contexto de conversa e o `cache_read` **à parte**, e compara com o teto declarado em
  `agents.budget.totalTokens`. Sem teto, mede e não reprova.
- **`inherit` em `model` e em `effort`**: o valor com que você recusa a declaração de um campo. O
  núcleo normaliza para ausência, então ele significa a mesma coisa em qualquer motor.

### Corrigido
- **`mgr update` reescrevia o frontmatter do agente em silêncio.** Passa a dizer, campo a campo, o
  que mudou de `model` e de `effort` — e não inventa linha quando nada mudou.
- **A mensagem do install chamava todo agente de "gate de validação"**, inclusive os que não são.
  Passa a nomear o agente escrito.
- **O gate desligado desligava a instalação de agentes inteira.** Agora cada intenção decide sozinha,
  e recusar a revisão não leva junto a redação e a execução.
- **Agente alheio de mesmo nome bloqueava a instalação inteira**; agora bloqueia só o próprio
  arquivo.

### Alterado
- **Nenhum modelo é publicado por default, em motor nenhum.** Sem configuração, os três agentes
  herdam o modelo da sessão, e o `mgr agents` e o plano de instalação **avisam**, dizendo a razão e
  o que fazer. Isto **emenda o ADR-0010**: ele publicava `opus` no claude-code e deixava o copilot
  sem default porque a lista de modelos é **da conta**, não do produto. Com mais motores na fila, a
  exceção virou a regra.
- **O agente do gate deixou de receber `model: opus` para quem não configura nada.** É a única
  mudança desta versão que altera o comportamento de algo já entregue, e não só a saída.

### O que degrada, declarado
- **Sem configurar, ninguém recebe execução barata.** O default herda, e o benefício de rodar cada
  etapa no modelo certo exige declarar um modelo por intenção. O aviso existe para isso não ser
  descoberto tarde.
- **O agente de redação NÃO vê a conversa.** Uma decisão tomada falando, e nunca escrita em disco,
  não chega nele. Isso empurra o método para o que a L2.1 já mandava — hand-off por disco —, mas o
  custo aparece aqui pela primeira vez como perda concreta.
- **`model` e `effort` não se comportam igual.** O `model` pode ser trocado na invocação e vale já na
  próxima; o `effort` só existe no arquivo do agente, então **só passa a valer depois de
  `mgr update`**. A assimetria é da plataforma, e o `mgr agents` avisa dela em toda execução.
- **O roteamento foi provado em UM motor.** O Copilot não tem campo de esforço, e a conta de teste
  expõe um modelo só. Fica **`[A CONFIRMAR]`** se o override de modelo na invocação existe nele.
- **Agente recém-instalado demora a ficar disponível.** Há uma janela em que o arquivo está em disco
  e a invocação ainda falha. As duas skills tratam isso como caso previsto, escrevem o documento
  elas mesmas e dizem que fizeram assim — nunca tentam em laço.
- **A medição de token não prova economia sozinha.** Agente não compartilha contexto: a conversa pode
  encolher e o total subir. Por isso o critério é duplo, e `cache_read` fica fora do total.

## [0.7.0-beta.9] - 2026-09-11
> Conserta a 0.7.0-beta.8, que não instalava. Pré-release no dist-tag `next`.

### Corrigido
- **`mgr install` morria com `recurso do MGR ausente: agents` em quem instalava do npm.** O
  diretório `agents/` virou artefato instalável na `0.7.0-beta.2`, e a whitelist `files` do
  `package.json` nunca foi atualizada — o tarball saía sem ele e o instalador falhava **antes de
  escrever qualquer coisa**. A `0.7.0-beta.8` foi a primeira versão publicada com o gate, então foi
  nela que o defeito apareceu.

### O que degrada, declarado
- **Nenhum teste pegava isto, e agora um pega.** Todos os testes de instalação rodam a partir do
  working tree, onde `agents/` sempre existe. O teste novo empacota de verdade e confere que **todo
  recurso exigido por `src/bundle.js`** viaja no tarball — a lista é derivada da fonte, não escrita
  à mão, então acrescentar um recurso sem publicá-lo quebra o teste.
- **A `0.7.0-beta.8` continua publicada e continua quebrada.** Versão publicada não é sobrescrita;
  quem instalou precisa subir para a `0.7.0-beta.9`.

## [0.7.0-beta.8] - 2026-09-11
> A etiqueta de proveniência passa a ser conferida onde há fato. Pré-release no dist-tag `next`.

### Adicionado
- **`PROV-1` a `PROV-4` no `mgr spec validate`** (ADR-0016): etiqueta malformada, ponteiro
  `[code:<caminho>:<linha>]` que não resolve em disco, e caminho que escapa da raiz do repositório
  são **erro**; marca de pendência ao fim da linha numa feature com `06-completion.md` é **aviso**.
  Mesmo comando, mesma assinatura, mesmo envelope `--json`.
- **A proveniência vale para QUALQUER artefato canônico**, não só para o plano e a spec. A linha de
  OK do comando passou a contar os artefatos que de fato foram lidos — de 2 por feature para os
  canônicos presentes.
- **`src/provenance.js`, `src/prov-rules.js` e `src/prov-validator.js`**, o terceiro trio de
  parser, regras e orquestrador. A lista de artefatos vem do `spec-status` e o bloco cercado vem do
  `stripFencedBlocks`: nenhuma descoberta nova, nenhuma cópia.
- **O `code-analyzer` parou de assumir caminho**: passa a consultar `mgr spec status --json` com o
  caminho literal como **fallback declarado**, como as outras duas skills do fluxo já faziam. O
  teste de fallback cobre agora as **três**.

### Corrigido
- **`mgr spec next --all` era aceito e ignorado.** Respondia sobre uma feature com cara de resposta
  sobre todas. Passa a ser recusado, com mensagem própria e código diferente de zero.
- **`mgr spec next` sem slug, rodado da raiz, escolhia a primeira feature em silêncio** e respondia
  como se fosse a resposta. Passa a dizer quantas features existem e a pedir o nome, ou que se rode
  de dentro de `specs/<slug>/`.

### Alterado
- **A nota de status da L1.10** deixou de dizer "declarada, ainda não verificável" e passou a dizer
  o que **é** conferido — a etiqueta escrita — e o que **continua** por disciplina — a presença
  dela. O texto normativo da lei não mudou, e as 45 leis seguem intactas.

### O que degrada, declarado
- **A regra que cobraria a etiqueta NÃO foi feita, e isso é decisão, não pendência.** "Asserção
  normativa sem etiqueta é erro" foi rejeitada por decisão de produto sustentada em medição: a
  adesão é **zero** em todo o acervo, e o custo cairia sobre cada linha normativa escrita para
  sempre. A ferramenta confere fato; ela não cobra disciplina. Quem não etiquetar não é reprovado
  por nada.
- **Etiqueta só conta em posição de marca** — o `]` como último caractere da linha. Ponteiro
  escrito no meio de uma frase **não é conferido**. Medido: a definição tolerante, que aceitaria
  crase ou pontuação depois do `]`, produziria erro sobre artefatos de features já fechadas.
- **A `PROV-3` tem falso positivo conhecido e medido**: uma citação que por acaso termina a linha é
  apontada. Não há regra mecânica que a separe de uma pendência real. Por isso ela é aviso, e **a
  própria mensagem declara** o que detecta e o que não distingue.
- **O resultado da `PROV-2` depende da máquina.** Ela confere disco, e `specs/` é gitignored neste
  projeto — gitignored conta como existente, porque é exatamente onde as asserções vivem. Um
  artefato que passa aqui pode falhar num clone sem `specs/`. A saída não promete portabilidade.
- **Três formas de marca de pendência são reconhecidas** — `[TO DEFINE]`, `[A DEFINIR]` e
  `[A CONFIRMAR]`. Identidade parseável não deveria depender de idioma, e aqui depende. É **dívida
  declarada**, registrada no ADR-0016: canonizar obrigaria a migrar o acervo ou a reprovar o que
  existe.

## [0.7.0-beta.7] - 2026-09-11
> O plano e a spec passam a dizer ONDE estão. Pré-release no dist-tag `next`.

### Adicionado
- **`mgr spec status`** (ADR-0015): responde quais artefatos existem numa feature, **onde cada um
  está**, o que falta escrever e se há `.handoff.md` em disco. Aceita `--all` e `--json`.
- **As skills `spec-create` e `spec-execute` param de assumir caminho** no caminho feliz: passam a
  consultar o comando, com o caminho literal de hoje mantido como **fallback declarado** para quem
  não tem a CLI instalada.
- **`slugs(repo)` em `src/artifacts.js`**, fonte única da listagem de features. O `artifactFiles`
  passou a consumi-la, então há um `readdirSync` só **sobre `specs/`** no projeto.

### Corrigido
- **Os comandos `spec` deixaram de tratar o diretório atual como raiz do repositório.** Rodados de
  dentro de `specs/<slug>/`, `validate`, `next` e `status` procuravam artefato em
  `specs/<slug>/specs` e a derivação do slug pelo diretório nunca funcionou. O defeito vem da
  primeira fatia do runtime e atingia os três. A raiz passa a ser resolvida subindo até o diretório
  com `specs/`, parando na fronteira do projeto para não atravessar para um repositório de cima.

### O que degrada, declarado
- **Existência de arquivo não é progresso, e o comando diz isso.** O vocabulário é `present`,
  `ready` e `blocked` — **sem `done`**, que o documento de origem propunha e que afirmaria
  conclusão de etapa a partir da presença de um arquivo. O aviso vai no payload, com um token
  estável (`basis`) ao lado da frase.
- **`approved` e `checkpoint` não existem no payload.** A aprovação de checkpoint não tem registro
  mecânico; preencher seria inventar e preencher com nulo seria lido como negativa.
- **`.handoff.md` é reportado como fato do arquivo, nunca como trabalho pendente.** Medido: os
  quatro handoffs em disco pertencem a features concluídas, e chamá-los de pendentes seria falso
  em 4 de 4 casos. O comando também não infere obsolescência cruzando com o `06-completion`, o que
  seria julgamento disfarçado de dado.
- **O método continua operável sem a CLI instalada.** O fallback está escrito nas duas skills, e um
  teste próprio quebra se alguém o remover — inclusive conferindo a skill já instalada nos dois
  motores.
- **As regras `PROV-*` continuam fora**, com a medição de adesão zero registrada.

## [0.7.0-beta.6] - 2026-09-10
> O plano passa a responder o que fazer agora. Pré-release no dist-tag `next`.

### Adicionado
- **`mgr spec next`** (ADR-0014): o plano deixa de só descrever e passa a responder **o que fazer
  agora** — a task, o artefato exato que ela exige, a skill auxiliar e o que ela espera. Devolver
  ação em vez de estado tira do agente a inferência que é onde ele erra.
- **Campo `status` na task do plano**, opcional, com vocabulário fechado em `todo` e `done`. É a
  primeira fonte mecânica de conclusão de task: antes disso o progresso vivia em prosa no log de
  execução, e nenhum dos 11 planos em disco marcava conclusão de forma legível.
- **Regra `PLAN-6`**, aviso, para `status` com valor fora do vocabulário.

### O que degrada, declarado
- **Nenhum plano existente é reprovado nem precisa migrar.** O campo é opcional, o parser já
  ignorava chave desconhecida, e nenhum dos planos em disco usa `status` — por isso a extensão é
  aditiva e **não** exige uma versão 2 do marcador de formato.
- **A resposta declara sempre o que sabe.** Num plano sem `status`, ela diz que não sabe o que
  você já fez e que está devolvendo a primeira task que **pode** começar, não necessariamente a
  próxima. Sem isso, `P0.1` para sempre seria lido como aprovação.
- **`status` com valor inválido nunca conta como concluído.** Falha para o lado seguro: no máximo
  reoferece algo já feito, jamais pula algo que falta.
- **"Nada pronto para começar" é, por natureza, um plano defeituoso.** Num plano válido alguma
  task tem `depends_on` vazio e portanto está pronta; esse caminho existe para dependência
  apontando para id inexistente, e a resposta manda rodar o `mgr spec validate`.
- **As etiquetas de proveniência (`PROV-*`) continuam fora.** A adesão a elas foi medida em zero
  ocorrências em 63 arquivos de artefato, e a L1.10 segue declarando-se "not yet enforceable".

## [0.7.0-beta.5] - 2026-08-31
> O método passa a verificar também a **spec** de uma feature. Pré-release no dist-tag `next`.

### Adicionado
- **`mgr spec validate` passa a cobrir a spec, além do plano** (ADR-0013). Cinco regras `SPEC-*`:
  spec declarada sem nenhum critério de aceitação, identidade duplicada, critério vazio e buraco
  na numeração.
- **O critério de aceitação vira unidade verificável, identificado por `CA-<n>`** — a identidade é
  o que uma reprovação cita, e o texto fica no idioma de quem escreve. Sem detecção de seção: o
  título é prosa e varia com o idioma.

### Corrigido
- **Marcador de formato dentro de exemplo deixou de declarar o formato.** Uma spec que documenta
  o próprio formato passava a declará-lo por acidente, e as tasks do exemplo viravam tasks. O
  defeito existia nos dois parsers desde a fatia anterior; a correção é única e vale para ambos.
  O fechamento de bloco cercado segue o CommonMark — mesmo caractere e comprimento maior ou igual —
  então `~~~` não fecha um bloco aberto com crase, e uma cerca interna não fecha a externa.
- **`CA-1` e `CA-01` deixaram de escapar da checagem de duplicidade.** A identidade passa a ser
  comparada pelo número, não pela string: os dois são o mesmo critério para quem lê, e a citação
  numa reprovação ficava ambígua.
- **As fixtures de teste voltaram a ser versionadas.** O padrão `specs/` do `.gitignore` casava em
  qualquer profundidade e engolia `test/fixtures/specs/` — as fixtures que existem justamente para
  o teste não depender da máquina de quem escreve. Ancorado na raiz (`/specs/`, `/docs/sdd/`).
- **O texto de escopo nomeia os dois artefatos.** Ele dizia não julgar o plano, as tasks e o
  critério de done; passa a dizer também que não julga se um critério de aceitação é testável nem
  se os critérios cobrem a spec — que é justamente a leitura errada que um verde convidava.

### O que degrada, declarado
- **Nenhuma spec existente é reprovada.** Sem marcador, **nenhuma** regra roda — só o aviso, nem
  com `--strict`. Diferente do plano, onde as regras de consistência valem sobre o que existir:
  aqui todas dependem da presença do critério, e exigi-lo de quem nunca prometeu seria acusar
  ausência.
- **A verificação é estrutural.** Ela não julga se o critério é testável, se os critérios cobrem a
  spec, nem se o critério é bom — a segunda é o eixo Spec do `code-analyzer`, e fundir os dois
  eixos é proibido.
- **O formato `Requirement`/`Scenario`/`SHALL` foi rejeitado**, com a medição registrada no
  ADR-0013: 10 de 10 specs usam critérios de aceitação, 0 de 10 usam requisito com cenário.

## [0.7.0-beta.4] - 2026-08-31
> O método passa a verificar o **plano** de uma feature. Pré-release no dist-tag `next`.

### Adicionado
- **`mgr spec validate`** (ADR-0012): o método passa a verificar o **plano** de uma feature —
  dependência apontando para task inexistente, ciclo no DAG (inclusive indireto), granularidade
  acima de 3 arquivos, task sem `done_when` ou sem `artifact`, e dependência fora de ordem de
  prioridade. Namespace separado do `mgr validate`, que continua validando `SKILL.md`.
- **Formato de plano declarado por marcador** (`<!-- mgr-plan-format: 1 -->`), com as **chaves dos
  campos em inglês** e os **valores no idioma do usuário**. A identidade parseável nunca depende
  do idioma em que o artefato foi escrito.
- **O campo `artifact` no plano** torna verificável a lei **L4.3**: nome, forma, assinatura e
  QUANTIDADE exatos, que antes viviam só como prosa dentro da task.
- **Todo achado traz remediação e exemplo conforme** — e o construtor **recusa** achado sem eles,
  então "revise a seção" é impossível por construção.

### O que degrada, declarado
- **Nenhum plano existente é reprovado.** Sem o marcador, as regras de **presença** não rodam —
  nem com `--strict`. As de **consistência** rodam sobre os campos que existirem, então um plano
  antigo que já declarava `depends_on` ganha verificação de dependência sem migrar nada.
- **A verificação é estrutural, e a saída diz isso.** Ela não julga se o plano está certo, se as
  tasks são as certas, nem se um critério de done é bom.
- **Só o plano.** A verificação da spec (`SPEC-*`) e as etiquetas de proveniência (`PROV-*`) são
  fatias próprias, ainda não entregues.
- **Duas formas de saída de validador convivem** no repositório: o `check-laws.mjs` devolve
  strings; este devolve objeto estruturado com `--json` versionado. Dívida declarada.

## [0.7.0-beta.3] - 2026-08-31
> Fonte única das leis de execução e blindagem da autoridade contra conteúdo injetado em runtime.
> Pré-release no dist-tag `next`.

### Adicionado
- **Fonte única das leis de execução** (ADR-0011): `shared/laws/execution-laws.md` reúne as 45
  leis do método (L0–L6), cada uma declarando **a quem se aplica por papel** — `Planner`,
  `Executor`, `Verifier`, `Diagnostician` ou `All`. As seis skills do CORE deixaram de repetir
  lei e passaram a apontar para ela pelo token `{{MGR_LAWS}}`, resolvido no install.
- **Preâmbulo de leis no hook de sessão**: as leis centrais entram no contexto **antes da
  primeira mensagem**, por gatilho de plataforma. 19 linhas, teto de 25. Interruptor próprio em
  `.mgr-core/config.json` → `lawsPreamble`, independente do `--no-hooks` e do `reviewGate`.
- **Quarentena de injeção e rebaixamento de evidência** (L0.2/L0.3): conteúdo vindo de documento
  ingerido, página web, saída de tool ou resposta de MCP é **dado, nunca instrução**; memória de
  longo prazo e saída de tool orientam, mas não provam conclusão nem destravam checkpoint.
- **`scripts/check-laws.mjs`**: verifica ID duplicado, papel inválido, skill do CORE sem ponteiro,
  lei órfã e token não resolvido. Roda com `--self-test`.

### Corrigido
- **A lei de controle de contexto havia divergido entre duas skills.** Medido em disco: a cópia da
  `spec-execute` — a skill que roda longo — tinha perdido a estimativa de tamanho de janela, a
  proibição de recarregar tiers arquivados, o "fato **bruto**" da anti-compactação e o gatilho
  duplo do hand-off. As quatro voltam a valer nela pela fonte única.
- **O hook de um motor podia anunciar a fonte de leis do outro** quando os dois estavam
  instalados, ferindo a autossuficiência por motor. O caminho passa a ser resolvido pelo
  diretório do próprio motor.

### Segurança
- A hierarquia de autoridade do ADR-0007 ganhou um **quinto nível, o mais baixo**: conteúdo
  injetado em runtime. Nenhum nível existente mudou de posição e nenhuma regra foi relaxada.

### O que degrada, declarado
- **A quarentena reduz risco e aumenta detectabilidade; não elimina prompt injection.** Linguagem
  natural maliciosa não é detectável com garantia, e o método não promete o contrário.
- **A L1.10 (proveniência por asserção) entra declarada e não verificável.** Nenhum validador
  confere as etiquetas hoje; a checagem depende do formato verificável de artefatos, que é outra
  feature. O próprio texto da lei diz isso.
- **A chegada do preâmbulo ao contexto foi verificada só na emissão.** Os dois formatos de hook
  foram medidos; a chegada antes da primeira mensagem exige sessão nova em cada motor.

## [0.7.0-beta.2] - 2026-08-30
> Gate de validação como agente: a revisão passa a rodar no modelo e no esforço que ela
> declara, isolada da conversa que produziu o código. Pré-release no dist-tag `next`.

### Adicionado
- **O gate de validação roda em agente próprio** (ADR-0010). A revisão do `code-analyzer`
  deixa de herdar o modelo e o esforço da sessão e passa a declarar os seus, **pela execução
  inteira** — não por um turno. O comando `/code-analyzer` e quem o invoca continuam iguais;
  o que muda é o motor por baixo.
- **Agentes viram artefato instalável**, ao lado das skills: `.claude/agents/mgr-review.md` no
  Claude Code e `.github/agents/mgr-review.agent.md` no Copilot, registrados no
  `manifest.json` para o `update` e o `uninstall` saberem o que é deles.
- **`reviewGate` em `.mgr-core/config.json`**: `enabled`, `effort` e `model` — este último um
  **mapa por motor**. Ausente = ligado no default. Override parcial completa o default em vez
  de substituí-lo, e o ajuste sobrevive ao `mgr update`.
- **`mgr status` e o plano do `mgr install` mostram o gate por motor** — modelo, esforço, e o
  que aquele motor não suporta.
- **Descritor de motor (`src/engines/`)**: o que o método sabe sobre cada plataforma vira dado
  consultável em vez de ramificação por nome.

### Corrigido
- **`effort: xhigh` passa a ser aceito** em manifest de plugin. A escala de quatro valores era
  a decisão 6 do ADR-0004, cuja razão (*"`xhigh` não é endereçável via manifest na v1"*)
  expirou quando o método passou a escrever arquivo de agente. A mudança está declarada como
  emenda no ADR-0010; ela **alarga** a validação e não quebra nenhum manifest válido.

### Segurança
- **O agente da revisão não tem ferramenta de escrita.** Um revisor que não pode editar não
  tem como "corrigir" o que deveria reprovar — a garantia vem de um campo de frontmatter, não
  de disciplina de prompt.
- **Prova de posse antes de escrever.** `.claude/agents/` e `.github/agents/` são diretórios
  do usuário: arquivo de mesmo nome sem o marcador do MGR **não** é sobrescrito no install nem
  removido no uninstall — a instalação avisa e segue.

### O que degrada, declarado
- **No Copilot o gate roda no modelo declarado, mas no esforço da sessão**: não existe campo
  equivalente a `effort` em custom agent. A instalação diz isso uma vez, em vez de omitir.
- **O roteamento até o agente tem qualidade diferente por motor**: no Claude Code é estrutural
  (`context: fork`, quem roteia é a plataforma); no Copilot é instrução no corpo da skill.
- **`COPILOT_HOME` não é tratado**: quem redireciona `$HOME/.copilot` por essa variável precisa
  mover o arquivo do agente à mão.

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
