# ADR-0025: Runtime do MGR em copia unica em .mgr-core/runtime/

Date: 2026-10-15
Deciders: Mauri Reis

## Status

Proposed. Revisa a decisao 1 do ADR-0023 ("Uma copia por motor [...] Nada em `.mgr-core/` (2.6)")
e a alternativa rejeitada "Runtime em `.mgr-core/runtime/`: rejeitada pela CONSTITUTION 2.6".
Acompanha a emenda da CONSTITUTION 2.6 e a linha nova da 2.5.

## Context

O install copia o runtime (fecho de imports de bin/mgr-runtime.js mais um package.json gerado) para
`<skills do motor>/_shared/mgr/` de cada alvo, inclusive o `--skills-dir` (src/installer.js:204-214 em 1472d7c).
O proprio ADR-0023 registrou o custo: "Uma copia do runtime por motor, a manter coerente". O gate final
da fatia runtime-fora-do-versionamento confirmou por experimento (N-11) que o estado do runtime
dependia de quais pastas de motor existiam em cada maquina: reinstalar com menos motores deixa a copia
do motor que saiu no disco (specs/runtime-fora-do-versionamento/05-execution.md, "Gate final (P2.3) e
pivo"). A razao herdada do ADR-0011 ("fragil no escopo global e fere a autossuficiencia por motor")
foi escrita sobre a leitura das leis por caminho relativo; as leis continuam em cada motor.

**Reference:** specs/runtime-em-mgr-core/03-spec.md.

## Decision

1. **Copia unica por escopo** em `<.mgr-core>/runtime/`: na raiz do projeto no escopo project, na
   home no global. Skills e entradas de hook do metodo de todos os motores e do diretorio custom
   apontam para ela (relativo a raiz no project, absoluto no global). O restante de `_shared/` fica
   em cada motor. O conteudo do runtime nao muda.
2. **Constituicao:** a 2.6 passa a admitir o runtime do MGR em `.mgr-core/runtime/`, derivado da
   versao do manifesto; skills continuam fora. A 2.5 ganha a linha: o runtime nao e diretorio de
   motor, entao apagar a pasta de um motor nao o alcanca.
3. **Geracao `self-contained-core-runtime`.** Install e update migram todas as geracoes anteriores,
   anunciando antes: as que tinham runtime por motor sao relocadas, e as que nao tinham ganham a copia.
4. **Remocao do `_shared/mgr/` antigo** so nos diretorios que o manifesto anterior declarava e que o
   plano reinstala, anunciada antes de qualquer escrita. Diretorio declarado que sai do plano mantem a
   copia e e anunciado, porque as skills e o hook dele ainda a chamam.
5. **O doctor confere o local que a geracao do manifesto declara**: `.mgr-core/runtime/` na geracao
   nova, a copia por motor nas anteriores.
6. **O uninstall nao muda**: remove o `.mgr-core/` inteiro, e o runtime sai junto.

## Alternatives Considered

- **Manter uma copia por motor:** rejeitada; e a origem do N-11, medido, e do custo que o ADR-0023
  declarou.
- **Diretorio neutro `.mgr/` na raiz:** rejeitada; `.mgr-core/` ja existe nos dois escopos, e o
  marcador da raiz (src/project-root.js:18) e o `uninstall` ja o remove inteiro (src/installer.js:519).
  Um diretorio novo de topo seria mais um caminho a migrar e a remover.
- **Remover `_shared/mgr/` de todo diretorio declarado:** rejeitada; quebraria as skills e o hook de
  um alvo que sai do plano, porque o plano so monta os alvos pedidos (src/installer.js:131-133).
- **Deixar o `_shared/mgr/` antigo no disco:** rejeitada no CHECKPOINT 1 (P-1); copia que nada do
  plano chama e que o doctor da geracao nova nao confere.

## Consequences

### Positive
- Uma copia por escopo: o estado do runtime deixa de depender de quais pastas de motor existem.
- Apagar a pasta de um motor nao alcanca o runtime dos outros.

### Negative
- `manifest.model` muda de valor; todo projeto migra no proximo install ou update.
- Skills de um alvo que saiu do manifesto, depois de migrado, param apos o `uninstall` (antes rodavam
  da copia propria).
- Ferramenta do usuario que referencie `<motor>/skills/_shared/mgr/` deixa de casar.

### Risks and Mitigations
- **Risk:** a remocao alcancar pasta que nao e do metodo. — **Mitigation:** candidatos so da
  intersecao entre os diretorios do manifesto anterior e os do plano, caminho exato `_shared/mgr`. —
  **proved by:** test/migracao-runtime.test.js, a tabela MC/DC de `legacyRuntimeDirs` (CA-13) e as
  migracoes das quatro geracoes (CA-11); mutacoes que tiram cada condicao (declarado, no plano, existe)
  derrubam a tabela (specs/runtime-em-mgr-core/05-execution.md, P2.3).
- **Risk:** alvo fora do plano ficar sem runtime. — **Mitigation:** a copia antiga dele fica e e
  anunciada. — **proved by:** "should keep the copilot runtime copy and its hook byte for byte when
  reinstalling only claude-code" (CA-14); a mutacao que descarta o `keep` o derruba.
- **Risk:** hook apontando para o caminho removido. — **Mitigation:** regravado no mesmo comando e
  autocorrigido no seguinte. Com `--no-hooks`, so no escopo project, o install reescreve so a entrada
  que ja e do MGR e cujo comando muda, anunciada no plano (Q-3). — **proved by:** CA-15 e CA-25 em
  test/migracao-runtime.test.js; as mutacoes que tiram a reescrita, o anuncio, o filtro de mudanca e o
  limite de escopo derrubam cada uma o seu teste.
- **Risk:** o alcance de leitura no escopo global dos motores do radar. — **Mitigation:** o local
  novo fica na mesma zona do antigo (home). — **proved by:** [NOT VERIFIED], herdado do ADR-0023.
- **Revisit trigger:** a fatia runtime-fora-do-versionamento decidir o versionamento de
  `.mgr-core/runtime/`.
