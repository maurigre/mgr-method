# ADR-0033: O texto que o produto mostra vem da camada de idioma, e o nucleo devolve dado

Date: 2026-11-16
Deciders: Mauri Reis

## Status

Proposed

## Context

O ADR-0003 (decisao 2) fez do `userLanguage` a configuracao do idioma que o usuario experimenta.
Medido em 2026-11-16, com `--user-language en`, o `doctor`, o `audit`, o runtime do projeto e o
aviso do `dist` saem com pt-BR; com `pt-BR`, o erro de qualquer comando sai com prefixo pt-BR e
mensagem em ingles. Uma varredura completa do projeto, que extraiu pelo parser todo literal de
`src/` e `bin/` fora de `src/messages.js` (332 literais, classificados por destinatario), achou o
mesmo defeito no `validate`, no `spec validate`, no hand-off gravado no projeto do usuario e no
launcher.

As causas: texto literal fora de `src/messages.js` na borda e na cola; frases montadas no nucleo
(os 20 tipos de achado do `doctor`, os problemas do manifesto, os achados de artefato, os problemas
de `SKILL.md`, o hand-off); e 86 construcoes `new Error(` com texto fixo, 15 delas em pt-BR.
Nenhuma regra do metodo cobria o texto que o produto mostra (a `QUAL-7` cobre o que o agente
produz), e nenhuma verificacao do projeto reprovava a recaida.

O autor recusou a saida misturada como degradacao e pediu a correcao na raiz, com garantia de que o
erro nao volte neste projeto nem em outro que use o metodo.

A fonte canonica e a documentacao oficial da Microsoft (Microsoft Learn, *Globalization*): *"The
most essential property of a localizable app is that its executable code has been cleanly
separated from its localizable resources"* e *"Don't hard-code string literals in your imperative
code"* (*Make your app localizable*); *"When a string is used both internally in code and is also
displayed to the user, the usage should be split into separate strings"* (*Externalize localizable
resources*, ms.date 2024-03-26); *"localize the entire sentence, rather than a single word"*.

**Reference:** Technical spec at specs/doctor-manifesto-malformado/03-spec.md.

## Decision

1. Todo texto que o produto mostra a uma pessoa, na saida da CLI, do runtime ou em arquivo gerado
   no projeto dela, vem de `src/messages.js`, por chave, com a frase inteira por chave, no idioma
   resolvido pela cadeia `--user-language` -> `userLanguage` do manifesto -> locale.
2. O nucleo com saida de maquina devolve dado. O achado leva um descritor `{ key, params }`
   associado por `WeakMap`, sem campo novo, e o texto do `--json` e o ingles canonico renderizado
   pela tabela `en`, igual em qualquer idioma. O problema do manifesto leva codigos. O nucleo cuja
   saida e so texto para pessoa (o hand-off) recebe a tabela pronta.
3. Todo erro com texto e `UsageError` ou `InvariantError`, os dois com chave nos dois idiomas, e
   todo `catch` que mostra erro passa por `renderError`. O texto da plataforma (por exemplo a
   mensagem do `JSON.parse` do Node) nao entra na frase mostrada.
4. O launcher ES5 (`bin/mgr.cjs`) segue a mesma cadeia de idioma, lendo o manifesto com `fs`, com
   as frases espelhadas em `src/messages.js` e guardadas por teste de paridade.
5. Duas verificacoes no `npm test`, registradas como gate da constituicao: uma estatica (lint que
   proibe literal em ponto de saida, `new Error`, classe que estende `Error` e prosa em campos de
   texto conhecidos em `src/` e `bin/`) e uma dinamica (CLI, runtime, `spec validate`, hand-off e
   launcher nos dois idiomas, com o oraculo tirado da propria camada de idioma).
6. O metodo ganha a regra `QUAL-8`, que exige essa verificacao em todo projeto que o usa, e o
   `spec-create` pergunta a politica de idioma da interface na etapa de PRD.
7. Ficam fora da conversao, cada um com base: o texto para o agente (ingles canonico, ADR-0003), o
   dado e o padrao de maquina (marcadores, padroes de deteccao, invocacoes) e o nome proprio
   `MGR - Metodo Governado por Rastreabilidade`.
8. Nenhum texto de `src/plugin.js` chega a uma pessoa sem passar pela camada de idioma. O arquivo
   e copiado literalmente pelo mgr-registry (`scripts/plugin-schema.mjs`, conferido byte a byte no
   CI dele), entao so importa `node:crypto` e nao pode ler `src/messages.js`; isso e restricao de
   arquitetura, nao licenca para texto fora da camada. Por isso: os problemas do manifesto saem por
   `manifestProblems` como descritores, renderizados pela tabela do idioma, que tem as chaves
   `pluginManifest*` nos dois idiomas (o en de `src/messages.js` e igual byte a byte ao texto que
   `validateManifest` entrega ao registry, que e o contrato com ele, guardado por teste em
   `test/plugin.test.js`); e o `Error` canonico ingles do `parseSkillName` **nunca e mostrado**,
   porque todo chamador do MGR valida o nome antes com `isSkillName` e lanca `UsageError` (o
   `resolve` e, desde 2026-11-17, o `hasCollision` sobre as chaves do lockfile, que antes deixava o
   nome invalido sair como "defeito do MGR"; travado em `test/plugin-installer.test.js`), ou captura
   o `Error` e o troca por descritor da camada (a leitura do indice).
   O lint `QUAL-8` tira desse arquivo so o seletor de `new Error`.

## Alternatives Considered

- **Campo novo no achado:** viola o contrato do achado no `--json`, que o PRD da fatia protege.
- **Propriedade nao enumeravel no achado:** some do JSON, mas continua sendo campo no objeto.
- **A cola extrair os parametros do texto:** texto nao e contrato.
- **Passar a tabela de mensagens ao nucleo com saida de maquina:** o `--json` passaria a depender
  do idioma.
- **Lista paralela de descritores alinhada por indice:** acoplamento por posicao, que o proprio
  `doctor` ja pagou com defeito.
- **`throw new Error` com lista de excecoes por linha:** fragil a cada edicao e nao obriga a
  escolha no sitio.
- **Manter a invariante interna num idioma so:** recusado pelo autor.
- **Interpolar o texto da plataforma como dado:** recusado pelo autor.
- **Launcher so com locale:** recusado pelo autor; a escolha feita na configuracao vale ali tambem.
- **Verificacao so estatica:** nao ve prosa devolvida como dado.
- **Verificacao so dinamica:** nao ve literal em comando que os cenarios nao rodam.

## Consequences

### Positive
- Quem configurou um idioma recebe toda a saida nele, sem mistura.
- O `--json` vira dado estavel, igual em qualquer idioma.
- A recaida reprova no `npm test`, e o review de qualquer projeto que use o metodo passa a ter regra
  citavel para reprovar.

### Negative
- Os valores de texto do `doctor --json`, do `spec validate --json` e o `warning` do
  `spec status --json` passam de pt-BR a ingles canonico uma vez, com `schemaVersion` 1 e entrada
  no CHANGELOG.
- Testes que afirmavam texto em idioma errado, `message` de erro em pt-BR ou texto pronto do nucleo
  mudam, nas quatro categorias declaradas na spec.
- O ciclo de import `catalog -> errors -> messages -> catalog`, que nasceu com esta decisao, foi
  quebrado em 2026-11-17 pelo modulo folha `src/skill-class.js`, depois que a `MNT-2` passou a ser
  citavel no guia regenerado; `test/sem-ciclo-de-import.test.js` reprova ciclo novo.
- A cadeia de idioma existe em duas implementacoes (ESM e ES5).
- Num erro nao previsto, a pessoa deixa de ver o texto do Node; codigo, operacao e caminho
  continuam visiveis nos erros de sistema.
- Projetos existentes so recebem a `QUAL-8` no guia quando o `spec-init` o regenera.

### Risks and Mitigations
- **Risk:** um ciclo de import voltar entre a camada de idioma e o catalogo. — **Mitigation:** o
  modulo folha `src/skill-class.js` e o teste `test/sem-ciclo-de-import.test.js`, que percorre o
  grafo de imports de `src/` e `bin/`. — **proved by:** reintroduzir `import * as catalogo from
  "./catalog.js"` em `src/messages.js` deixa o teste vermelho (2026-11-17).
- **Risk:** a implementacao ES5 da cadeia divergir da ESM. — **Mitigation:** teste de paridade das
  frases e da cadeia (CA-38 da spec). — **proved by:** `should print the Node too old text in <idioma> for case <rotulo>`
  (`test/output-language.test.js`); a mutacao 9 do DT-16 (frase en do launcher trocada) ficou
  vermelha em 5 testes (P2.11).
- **Risk:** literal de interface voltar fora da camada. — **Mitigation:** a metade estatica e a
  dinamica da verificacao, cada uma com autoteste por reintroducao (CA-27 e CA-28 da spec). —
  **proved by:** as 9 mutacoes do DT-16, cada uma vermelha em ao menos uma guarda
  (P2.11); a lacuna da concatenacao, achada pelo review do CA-30, foi fechada e provada por mutacao
  em 2026-11-17; e a forma por caminhos enumerados foi trocada, no mesmo dia, por "qualquer
  profundidade abaixo do ponto de saida, menos o dado pela posicao", que fechou ternario, array,
  `"...".trim()` e chamada dentro de `+`, achou um literal antigo (`skill(s)` no `install`) e tem
  autoteste e mutacao para a profundidade e para o filtro de dado.
- **Risk:** texto de interface por um caminho que a metade estatica nao ve. Enumerados em
  2026-11-17 (reviews 2 e 3): (1) literal guardado numa variavel ou devolvido por funcao e mostrado
  depois; (2) prosa num campo de nome que nao e `message`, `remediation` ou `example`; (3) literal
  como valor de propriedade, ou array que e valor de propriedade, dentro do ponto de saida, tratado
  como dado pela posicao (`label`, `hint`, `initialValues`); (4) prosa como parametro de
  `text`/`say`/`descriptor`, ou dentro de chamada ou array sob `message:`/`push` que nao seja `+`,
  ternario ou `||`/`&&`; (5) palavra de uma letra, que o padrao de duas letras nao ve; (6) ponto de
  saida com nome fora da lista (a lista cobre `console`, `io.out`/`io.err`, `process.*.write`, `p.*`,
  `out`/`info`/`warn`/`bail`/`escreverSync`, `ask.*`/`CLACK.*`, `spinner.*` e `proc.*`); (7) texto padrao de
  biblioteca de terceiros, fora de `src/` e `bin/`. O (7) aconteceu: a `@clack` mostrava "Yes / No",
  "Canceled", "Something went wrong" e "Please select at least one option" em saida pt-BR, e
  nenhuma das metades via; e tambem o rodape de teclas do `select` e do `multiselect` ("to navigate",
  "Space: select", "Enter: confirm"), achado pelo review 4. Os dois foram fechados na raiz pelo
  adaptador `promptsNoIdioma` (`src/prompts.js`), por onde passa todo prompt da CLI: o rodape da
  biblioteca e desligado e a dica de teclas da tabela vai na pergunta. Conferido num terminal real
  ("Sim / Nao" e "navega / Espaco marca" com o adaptador; "Yes / No" e "to navigate" sem ele). — **Mitigation:** a metade dinamica roda os comandos nos dois
  idiomas e pega a prosa que chega a saida; a paridade de tabela pega chave com texto do outro
  idioma; biblioteca nova de interface passa pelo mesmo tipo de adaptador. — **proved by:** parcial.
  A dinamica so ve os comandos que roda e nao alcanca os prompts interativos; texto pelos caminhos
  (1) a (6), em comando que nenhum cenario roda, e texto padrao de biblioteca nova seguem
  [NOT VERIFIED].
