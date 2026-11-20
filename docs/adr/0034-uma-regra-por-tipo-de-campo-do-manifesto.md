# ADR-0034: Uma regra por tipo de campo do manifesto, consumida por todo comando que o lê

Date: 2026-11-18
Deciders: Mauri Reis

## Status

Proposed

## Context

O manifesto `.mgr-core/manifest.json` mistura quatro tipos de conteúdo:

- campos que o comando recalcula (`scope`, `agents`, `agentsDirs`, `skillsDirs`);
- declarações da pessoa (`engines`, `architecture`, `language`, `userLanguage`, `optional`, `allSkills`);
- o registro do que o MGR escreveu (`skills`);
- marcas do próprio comando (`version`, `model`, `installedAt`).

Medido em 2026-11-18 contra `5f449b8` (`specs/update-manifesto-malformado/medicao/`), cada comando tratava o mesmo campo de um jeito:

- o `update` consertava `scope: "bogus"`, enquanto o `doctor` dizia que nenhum comando conserta (ADR-0032, decisão 7);
- o `update` morria com `TypeError` em `skillsDirs: "x"` (regressão de `8dbc3c6`) e em `engines: 7`;
- o `install -y` descartava `architecture`, `language` e `userLanguage` de um manifesto válido;
- a raiz `"x"`/`[]` virava uma "migração de layout anterior", com 2 skills órfãs e nenhum aviso; a raiz `null` morria com `TypeError` em `readManifest`;
- com `architecture: "mvc"`, o `doctor` indicava `mgr update`, que recusa; com `allSkills: "sim"`, o `doctor` não dizia nada, e o `update` instalava 13 skills;
- `engines: []` virava um `claude-code` que ninguém declarou;
- `model: "bogus"` anunciava uma migração inexistente;
- o `uninstall` apagou um diretório fora do projeto, a partir de `skillsDirs: ["../isca"]` num manifesto que é versionado.

O autor recusou decidir campo a campo: *"não pode ocorrer de uma ponta fazer de um jeito e outro ponto fazer de outro"* (CHECKPOINT 1, 2026-11-18). As oito perguntas que sobraram foram resolvidas pela mesma regra e por medição (`specs/update-manifesto-malformado/resolucoes-checkpoint-2.md`). **Reference:** Technical spec at `specs/update-manifesto-malformado/03-spec.md`.

## Decision

1. A categoria de cada campo é dado, numa tabela única em `src/manifest.js`, consultada por `install`, `update`, `uninstall` e `doctor`; nenhum consumidor reclassifica.
2. **Derivado fora de forma:** `install`/`update` recalculam e anunciam; o `doctor` indica `mgr update`. Derivado nunca compõe caminho de escrita ou remoção: é sempre recalculado do motor e do escopo.
3. **Declaração fora de forma:** a precedência é: o valor explícito nesta execução → a declaração anterior válida → a pergunta do caminho com terminal, com a declaração anterior como padrão → recusa. A recusa vem antes de qualquer escrita e nomeia campo, forma esperada e o que fazer. O `doctor` indica a correção à mão. No caminho sem pergunta, o `install` herda a declaração anterior válida, como o `update`. O `update` não ganha flag nem pergunta de declaração: herda ou recusa, e a recusa aponta `install --<flag>`. `language` confere só o tipo; `architecture` tem vocabulário fechado, e a pergunta de arquitetura com terminal oferece "nenhuma" (`null`), como a de linguagem já oferece "outra". `engines: []` sem `engine` legado é declaração ausente e recusa.
4. **Registro fora de forma e manifesto ilegível** (inclusive raiz que não é objeto): recusa, em todo consumidor. `readManifest` passa a recusar a raiz não-objeto com `fileNotObject`, como o lockfile, o config e o arquivo de hooks.
5. O `userLanguage` declarado define o idioma mesmo com outro campo fora de forma.
6. **Revisão parcial do ADR-0032**, que não é editado:
   - a decisão 7 ("O estado novo declara ausência de remediação automática … porque nenhum comando do MGR conserta todos os casos") passa a valer só para declaração, registro e manifesto ilegível. Para problema só de campo derivado, valem `fix: "mgr update"` e `prova: "prova-funciona"`, com `remedy` por problema no `--json`;
   - da decisão 4, "o `readManifest` continua lançando exatamente o que lança hoje" passa a incluir a raiz não-objeto;
   - o estado `invalid-manifest`, o exit 2 e a ausência de `--fix` continuam.
7. O `doctor` relata todo problema que a classificação acha, e nunca indica `mgr update` para algo que o `update` recusa. O problema que não impede o diagnóstico sai num bloco `manifest` junto do `audited`, com a mesma forma do bloco do `invalid-manifest`, e conta como defeito (exit 1). Os achados de hoje continuam; `architecture-skill` com arquitetura fora do catálogo passa a `fix: null`.
8. **Nenhum comando apaga ou escreve fora do diretório que o MGR calcula.** O diretório `custom` é declaração e vale onde a pessoa o declarou, sem restrição de raiz (decisão do autor de 2026-11-19, "aceitar em qualquer lugar, proteger pela posse"). Antes de qualquer escrita ou `rmSync`, `resolveCustomDir` resolve o caminho real (`realpathSync`), e a proteção é a posse: pasta de skill sem a marca do MGR nunca é sobrescrita nem apagada, e a remoção só acontece dentro das pastas recalculadas. Caminho do manifesto fora das pastas calculadas é ignorado e anunciado. E, em qualquer escopo, o `uninstall` só apaga pasta de skill que traz a marca de posse do MGR (`isOurSkill`), como já faz com os agentes (`isOurAgent`): a posse, e não um limite por escopo, é o que protege o que não é do MGR.
9. `model` com valor fora dos layouts conhecidos é regravado sem anúncio de migração; a migração vale só para os layouts legados conhecidos.

**Posse em toda escrita e remoção (decisão do autor de 2026-11-19, durante a execução):** pasta de skill sem a marca do MGR nunca é sobrescrita nem apagada, em nenhum comando e nem com `-y`. Só a resposta explícita no terminal autoriza a substituição. Sem terminal ou com `-y`, a pasta fica, a skill não entra, o caso é anunciado e o exit é 1. Isso revê o contrato X-19 da fatia anterior, em que o `-y` do `update` valia como consentimento para substituir. A causa medida: o `install` do zero não conferia posse e sobrescrevia a pasta da pessoa, e com o `--skills-dir` valendo em qualquer lugar esse era o caminho direto para destruir conteúdo dela.

### Exceção declarada à `SEC-2`

A `SEC-2` pede caminho de escrita e remoção conferido contra a raiz do projeto. Esta decisão abre duas exceções, com a proteção que as substitui:
- **O diretório `custom` vale onde foi declarado**, inclusive fora do projeto (decisão do autor de 2026-11-19). A proteção é a posse, e não o lugar: o caminho real por `realpathSync`; pasta de skill sem a marca do MGR nunca é sobrescrita (nem com `-y`; só com "sim" no terminal) nem apagada; remoção só nas pastas recalculadas.
- **As entradas de `_shared/` não têm marca de posse.** `arch`, `laws`, `charter`, `quality` e o legado `mgr` são reconhecidos pelo nome, que o próprio MGR deriva das constantes do catálogo; qualquer outra entrada ali é da pessoa, fica em disco e é anunciada no `uninstall`.

O revisor cita esta seção quando um desses dois caminhos aparecer num review.

## Alternatives Considered

- **Reparar em silêncio todo campo fora de forma, tratando-o como ausente:** inventa declaração. `engines` cairia num `claude-code` que ninguém declarou, e o `install -y` já mostrava essa perda (`medicao-5f449b8.tsv:19`). Viola a CONSTITUTION §3.2 e a RN-3 do PRD.
- **Recusar todo campo fora de forma:** mata os reparos medidos de `agents` e `scope` (`medicao-5f449b8.tsv:7-10`). É degradação proibida pela CONSTITUTION §3.6 sem decisão explícita do autor, que não houve.
- **Ampliar `readManifest` para lançar em todos os campos:** tem o mesmo efeito da alternativa anterior, e o ADR-0032 já rejeitou essa opção por medição.
- **Cada comando decide por conta própria (o estado anterior):** é a incoerência medida no Contexto.
- **Sentinela `--arch none`/`--language none` para tirar a declaração com `-y`:** acrescenta vocabulário a duas flags sem pedido. Editar o manifesto e rodar `update` chega ao mesmo estado com comandos que já anunciam e pedem consentimento para remover.
- **Remédio só no texto, sem `remedy` no `--json`:** o consumidor automático teria de reclassificar o campo por conta própria, o que a decisão 1 proíbe.
- **Achado novo `manifest-field` em `findings`, em vez do bloco `manifest` no `audited`:** o achado tem seis chaves fixas, com texto canônico (`src/doctor.js:64-85`), e não carrega `field` nem `remedy` como código. O consumidor teria de ler texto para saber o campo.
- **Vocabulário fechado para `language`:** o `install --language python`, aceito e gravado hoje (medido), passaria a ser recusado, e o `install` recusaria o que ele próprio gravou.
- **`uninstall` confiando no `skillsDirs` do manifesto, com validação de forma apenas:** `["../isca"]` tem forma válida (array de strings) e apagou fora do projeto (medido). A forma não diz se o caminho é do MGR.

## Consequences

### Positive
- nenhum caso medido termina como "defeito do MGR";
- o `doctor` indica o remédio que o `update` aplica e relata o que antes calava;
- o `install -y` e o `install` com terminal deixam de apagar a declaração;
- a raiz não-objeto deixa de produzir órfã e falso diagnóstico de migração;
- a recusa sai no idioma configurado;
- o `uninstall` deixa de apagar fora do projeto a partir de um manifesto adulterado;
- `model` desconhecido deixa de anunciar migração inexistente.

### Negative
- casos que saíam 0 passam a sair 1: declaração fora de forma no `install`; `language` com tipo errado, `optional`, `allSkills` e `userLanguage` fora de forma no `update`; `engines: []`; raiz `"x"`/`[]`; `engines` fora de forma ou `[]` sem `engine` no `uninstall`; pasta de skill sem a marca do MGR mantida (a skill não entra) no `install` e no `update`, inclusive com `-y`. CI que dependia disso quebra;
- o `doctor` passa a sair 1 em manifestos que hoje dão 0;
- o `install -y` sem flags deixa de recalcular das flags, e o `install` com terminal herda `allSkills: true`;
- tirar uma declaração com `-y` passa a exigir edição à mão;
- outros comandos que leem o manifesto passam a recusar a raiz não-objeto;
- o `--json` do `doctor` ganha `remedy` e uma chave opcional no `audited`, e `fix` deixa de ser sempre `null` no `invalid-manifest`;
- o `uninstall` de um manifesto com `engines` corrompido passa a exigir correção à mão antes. Declaração que o `uninstall` não consome (`architecture`, `language`, `userLanguage`, `optional`, `allSkills`) fora de forma não o recusa; ele só consome `engines` e os `skillsDirs` do `custom`.

### Risks and Mitigations
- **Risk:** o `doctor` prometer `mgr update` num caso que o `update` recusa. — **Mitigation:** a promessa e o comportamento saem da mesma função, e um teste de propriedade roda os dois sobre cada forma letal e não letal. — **proved by:** `CA-26` da spec (`test/manifesto-malformado-cli.test.js`) — verificado na P1.32: o teste de propriedade rodou sobre 34 casos (24 letais, 3 raízes não-objeto, 7 não letais) e achou um caso em que o `doctor` prometia `mgr update` para um `skills` inseguro, corrigido; a mutação do laço da correção ficou vermelha.
- **Risk:** restringir o conjunto letal ou anexar o bloco `manifest` mudar o diagnóstico de hoje. — **Mitigation:** o conjunto passa a nomear os cinco campos medidos, e o bloco é aditivo. — **proved by:** `test/mgr.test.js:3319-3336` e `:3456-3481` (linhas do `5f449b8`; os testes `shouldExitTwoWithoutLeakingExceptionsForEveryLethalManifestShape` e `shouldKeepAuditedOutcomeForSkillsAndEnginesFormsThatAreNotLethal`) sem edição, `CA-29` e a mutação do `CA-41` — parcialmente verificado: `CA-29` na P1.32 (o envelope `audited` do controle saiu idêntico byte a byte ao do `5f449b8`, sem o bloco `manifest`) e a mutação do conjunto letal na P2.8 (guarda 9, vermelha). Os dois testes desses trechos (`shouldExitTwoWithoutLeakingExceptionsForEveryLethalManifestShape` e `shouldKeepAuditedOutcomeForSkillsAndEnginesFormsThatAreNotLethal`) estão idênticos byte a byte ao `5f449b8`, conferidos no fechamento (P3.7).
- **Risk:** automação que usava `install -y` para trocar de conjunto passar a herdar. — **Mitigation:** CHANGELOG e READMEs. — **proved by:** [NOT VERIFIED]; não dá para verificar daqui se o consumidor externo vai ler.
- **Risk:** um manifesto global com raiz não-objeto derrubar o `update` de um projeto válido. — **Mitigation:** escopo pela existência do arquivo. — **proved by:** `CA-37` — verificado na P1.29: global com raiz `"x"` em `HOME` temporário e projeto válido convergindo.
- **Risk:** comandos fora de `install`/`update`/`doctor` mudarem de comportamento sem medição de antes. — **Mitigation:** linha de base medida na P0 (M-P0-1). — **proved by:** `CA-38` — verificado na P0.2 (linha de base: 27 combinações contra `5f449b8`) e na P1.31 (15 testes: `status`, `uninstall` e `instructions` passam a recusar com exit 1; os demais mantêm o exit).
- **Risk:** a recusa de `engines: []` regredir o alvo `custom`. — **Mitigation:** o critério só vale para array vazio; `custom` grava `["custom"]`; caso medido antes e depois. — **proved by:** `CA-17` e M-P0-2 — verificado na P0.3 (ciclo `custom` medido contra `5f449b8`) e na P1.29 (o ciclo `install`/`update`/`uninstall` do `custom`, igual ao medido).
- **Risk:** recalcular diretórios no `uninstall` e no `migrateOld` deixar para trás skills de um manifesto legado cujo `skillsDir` não coincide com o recalculado. — **Mitigation:** M-P0-5 enumera os manifestos legados dos testes e fixtures antes de fixar, e o caminho declarado que não coincide com o recalculado é anunciado (`uninstallPathIgnored`, no `uninstall`, e no `install` e no `update` para o caminho do `migrateOld`) e nunca removido em silêncio. — **proved by:** `CA-32` — verificado na P0.6 (nenhum manifesto legado válido dos testes diverge do recalculado) e na P1.6 (o `migrateOld` remove só nos diretórios recalculados e devolve `ignored`).
- **Risk:** link simbólico dentro da raiz apontar para fora e escapar da conferência por caminho. — **Mitigation:** M-P0-4 mede o comportamento de `rmSync` antes de escolher entre `path.resolve` e `realpathSync`. — **proved by:** verificado na P0.5: `path.resolve` não enxerga a fuga e o caminho que atravessa o link apaga fora do projeto; a escolha foi `realpathSync` em `resolveCustomDir`.
- **Risk:** tratar `model` desconhecido como layout atual pular trabalho de migração. — **Mitigation:** pelo código, `migration` só decide o anúncio (`bin/mgr.js:225-231`, `:911-914`, `:994`), e a cópia do runtime e a camada pessoal são gravadas em todo `execute` (`src/installer.js:230`, `:240`). — **proved by:** `CA-18` — verificado na P1.29 (7 testes: `bogus` sem anúncio; layouts conhecidos com realocação e config) e na P2.6 (`model: "bogus"` regravado como `self-contained-core-runtime`, nos dois comandos).
- **Risk:** conferir `--skills-dir` dentro da raiz quebrar um uso legítimo de pasta fora do projeto. — **Mitigation:** M-P0-3 procura o uso antes de fixar; havendo uso, a decisão volta ao autor. — **proved by:** verificado na P0.4: havia uso fora da raiz (`test/esforco-no-install.test.js`, READMEs), a decisão voltou ao autor, e em 2026-11-19 ele decidiu aceitar o `custom` em qualquer lugar e proteger pela posse (decisão 8).
