# ADR-0032: Nao diagnostiquei e um estado proprio do doctor, com terceiro outcome e exit 2

Date: 2026-11-13
Deciders: Mauri Reis

## Status

Accepted

> Aceito pelo autor em 2026-11-18, com a fatia doctor-manifesto-malformado (PR #52).

## Context

O `mgr doctor` e a ferramenta que a pessoa roda quando ja suspeita que a instalacao esta ruim.
Medido em 2026-10-02 e remedido em 2026-11-12 contra `cc22855`, pela CLI (`bin/mgr.js doctor`) e
pelo runtime copiado para o projeto (`.mgr-core/runtime/bin/mgr-runtime.js doctor`), com resultado
identico: no input que justifica a existencia dele, um `.mgr-core/manifest.json` fora de forma, ele
morre, mente ou atesta integridade.

Cinco campos matam o comando (`skills`, `skillsDirs`, `engines`, `agents`, `scope`), em tres classes
de falha:

1. Morte com stdout vazio e exit 1, o mesmo codigo de "achei defeito", com mensagem interna em
   stderr (por exemplo `(manifesto.engines ?? []).filter is not a function`).
2. Manifesto corrompido, vazio ou contendo `null` lido como "sem instalacao", com exit 0. E a
   pendencia `O-3` deixada no fechamento do PR #25.
3. Manifesto que e JSON valido mas nao e objeto (`"x"`, `7`, `[1,2]`) devolvendo `"blocks": false`
   com exit 0: o instrumento atesta que nada bloqueia sobre registro que nao interpretou (`L2.6`).

Os codigos de saida estao sobrecarregados: `1` significa "achei defeito" e "eu morri"; `0` significa
"esta ok", "nao ha instalacao" e "li um registro invalido". Nenhum consumidor automatico consegue
distinguir. E o `--json` contradiz a si mesmo: a falha devolve stdout vazio e a ausencia de
instalacao devolve prosa.

A guarda de forma que existe, no `readManifest` (`src/manifest.js`, PR #36), valida so `skills` e
lanca. Lancar e o desenho certo para quem escreve em disco, mas nao serve para o `doctor`, que nao
pode morrer. E ela nao pode simplesmente crescer: medido em 2026-11-12, o `mgr update` le por
`readManifest` e hoje conserta o manifesto em 3 de 7 casos fora de forma (`agents: {a:1}`, `scope`
ausente, manifesto `"x"`); uma guarda ampliada mataria esses tres reparos.

**Reference:** Technical spec at specs/doctor-manifesto-malformado/03-spec.md.

## Decision

1. **"Nao diagnostiquei" e um estado proprio**, observavel nos dois canais de saida e pelas duas
   invocacoes (CLI e runtime do projeto, que compartilham `src/commands/doctor.js`).
2. **No envelope do `--json`**, um terceiro `outcome`, `invalid-manifest`, ao lado de `audited` e
   `no-install`, com `checks: 0`, `findings: []`, `blocks: true` e um bloco `manifest` com o estado
   da leitura (`unreadable` ou `read`) e os problemas, cada um nomeando o campo, a classe e a forma
   esperada. Nenhum achado novo e nenhuma entrada nova em `CHECKS`: achado pressupoe verificacao que
   rodou. A distincao vive no envelope, nunca no achado, para nao quebrar o contrato que o `--json`
   serializa. `schemaVersion` continua `1`. Em cada problema, `expected` e `found` sao codigos de
   vocabulario fechado, com `position` e `allowed` como dado, iguais em qualquer idioma; a frase que
   a pessoa le vem da camada de idioma (ADR-0033).
3. **No shell, exit `2`** quer dizer "nao diagnostiquei". `0` e `1` mantem o significado exato.
   `blocks: true` deixa de implicar exit `1`. O exit `2` vem so do `outcome` declarado; nenhum
   `try/catch` novo converte excecao em `2`, para que defeito de implementacao continue saindo como
   defeito.
4. **A regra de forma e uma funcao pura compartilhada** em `src/manifest.js`, que devolve cada
   problema com a classe (`root`, `container`, `element`, `unsafe-name`). Cada consumidor age sobre
   a classe que o afeta: o `readManifest` continua lancando exatamente o que lanca hoje, e o
   `doctor` relata o conjunto medido como letal. A forma esperada de `scope` e derivada das chaves
   de `skillsDir` do descritor do motor, e `scope` so e avaliado quando ha motor reconhecido, como
   no consumo.
5. **A leitura do manifesto no `doctor` distingue tres estados** (`absent`, `unreadable`, `read`)
   em vez de representar "nao existe" e "nao consegui ler" pelo mesmo `null`. So `absent` vira
   `no-install`.
6. **O `--json` devolve JSON tambem sem instalacao**:
   `{"schemaVersion":1,"blocks":false,"outcome":"no-install","findings":[],"checks":0}`, exit 0. A
   saida humana e a mensagem desse caso nao mudam.
7. O `doctor` continua sem escrever e sem `--fix`. O estado novo declara ausencia de remediacao
   automatica (`fix: null`, `prova: "sem-remediacao"`), porque nenhum comando do MGR conserta todos
   os casos.

## Alternatives Considered

- **Ampliar o `readManifest` para lancar nos cinco campos:** rejeitada por medicao; mataria o
  `mgr update` nos 3 casos que ele conserta hoje.
- **Achado novo em vez de `outcome`:** o achado teria `checks: 0`, afirmando um resultado de
  verificacao que nao houve, e exigiria entrada nova em `CHECKS` para um fato que nao e verificacao.
- **Reusar o exit `1`, com a distincao so no `--json`:** deixa de fora quem decide pelo exit code.
- **Campo novo no achado para marcar a classe:** quebra o contrato serializado do achado.
- **`blocks: false` no estado novo:** e o mesmo atestado falso que a mudanca existe para eliminar.
- **Relatar todo problema de forma de modo uniforme:** rejeitada por medicao; nome inseguro e
  elemento fora de tipo em `skills` nao matam o `doctor`, que devolve achados (11 pela CLI e 13 pelo
  runtime em 2026-11-12), e uniformizar trocaria esses achados por um nao-diagnostico.
- **Manter prosa no `--json` sem instalacao:** o PRD aprovado da fatia (`RN-3`) ja nomeia isso como
  defeito do mesmo contrato, e o teste que afirma a frase roda sem `--json`.

## Consequences

### Positive
- Consumidor automatico distingue "achei defeito" (1), "nada bloqueia" (0) e "nao diagnostiquei"
  (2), e o `--json` passa a devolver JSON em todos os estados.
- A `O-3` do PR #25 e fechada: manifesto ilegivel deixa de ser lido como "sem instalacao".
- A regra de forma do manifesto passa a existir num lugar so, pronta para a fatia seguinte
  (`update-manifesto-malformado`) fazer o install e o update a consumirem.

### Negative
- Script que so distingue zero de nao-zero passa a reprovar nos casos de manifesto invalido. E o
  efeito desejado, porque hoje parte deles passa como sucesso, mas muda o resultado de quem dependia
  disso.
- Ha dois leitores de JSON em `src/doctor.js`: o generico (`leJson`, que continua devolvendo `null`
  para hooks, lockfile e config) e o discriminado, so para o manifesto.
- Fica fora desta decisao, e tem brief proprio: a forma assumida em `src/installer.js` (`engines` e
  `skillsDirs`, esta uma regressao de `8dbc3c6`) e a perda silenciosa de `architecture` e `language`
  quando o manifesto anterior nao e objeto.

### Risks and Mitigations
- **Risk:** a regra relatar um campo que nao mata e trocar achados uteis por exit 2. —
  **Mitigation:** o `doctor` relata so o conjunto medido como letal, e `skills: ["../x"]`,
  `skills: [1]`, `engines: [1]` e `agentsDirs` em qualquer forma seguem `audited` (CA-18 da spec).
  — **proved by:** `shouldKeepAuditedOutcomeForSkillsAndEnginesFormsThatAreNotLethal`
  (`test/mgr.test.js`) e `should keep outcome audited from the runtime when skills holds a path-like
  entry (CA-18)` (`test/runtime-e2e.test.js`); a mutacao que torna `element`/`unsafe-name` de
  `skills` letais fica vermelha (P0.4 da execucao).
- **Risk:** ampliar a guarda do `readManifest` no futuro e matar os reparos do `update`. —
  **Mitigation:** o `readManifest` continua lancando so em `skills`, travado por teste que afirma
  que ele nao lanca nos outros campos (CA-11 da spec). — **proved by:** `should not throw from readManifest for
  malformed fields other than skills` (`test/doctor.test.js`), e a coluna `update=` remedida depois
  da fatia, identica a linha de base de 2026-11-12 nos 7 casos (P2.9).
- **Risk:** a regra de `scope` divergir da condicao de consumo e relatar manifesto legado
  `{model, version}` como invalido. — **Mitigation:** `scope` so e avaliado com motor reconhecido,
  e a forma esperada sai do descritor (CA-7 da spec). — **proved by:** `should not report a scope problem when no
  recognized engine is declared` (`test/doctor.test.js`),
  `shouldKeepAuditedWithExitZeroForLegacyManifestWithoutEnginesAndScope` (`test/mgr.test.js`) e as
  mutacoes do CA-15 (P0.4 e P2.11), todas vermelhas.
- **Risk:** um consumidor inferir exit `1` a partir de `blocks: true`. — **Mitigation:** a secao
  do `mgr doctor` em `docs/sdd/03-contracts.md` declara os tres codigos e que `blocks: true`
  deixa de implicar exit `1`. — **proved by:** `shouldDistinguishTheFourStatesByExitCodeBeforeAndAfter`
  (`test/mgr.test.js`); a secao foi escrita (P2.6). Que um consumidor externo leia a documentacao
  segue [NOT VERIFIED].
