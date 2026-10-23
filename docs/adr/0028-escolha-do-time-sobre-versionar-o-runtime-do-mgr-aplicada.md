# ADR-0028: Escolha do time sobre versionar o runtime do MGR, aplicada por arquivo de ignorar aninhado

Date: 2026-10-21
Deciders: Mauri Reis

## Status

Proposed. Responde ao gatilho de revisao do ADR-0025 ("a fatia runtime-fora-do-versionamento decidir o
versionamento de `.mgr-core/runtime/`"). Revoga, no contrato da CLI, a frase "o `update` nao toca no
`config.json` do time" no caso descrito na decisao 4.

## Context

O runtime do MGR mora em `.mgr-core/runtime/` (ADR-0025) e nada o tira do versionamento: o bloco
gerenciado da raiz so lista a camada pessoal (src/gitignore.js:18-23). O runtime e derivado da versao do
manifesto (CONSTITUTION 2.6) e nao tem nada proprio do projeto, mas, versionado, entra na analise de
qualidade e seguranca do repositorio do usuario. O autor decidiu que a escolha e do usuario, no install,
reversivel a qualquer momento, com padrao "nao versionar" (brief, 2026-10-15 e 2026-10-21). O desenho
anterior, com linhas da pasta no bloco da raiz, foi barrado pelo gate (N-11): o estado dependia de quais
pastas de motor existiam em cada maquina.

**Reference:** Technical spec at specs/runtime-fora-do-versionamento/03-spec.md.

## Decision

1. A escolha e fato do time: chave `runtimeVersioning` (`versioned` | `unversioned`) em
   `.mgr-core/config.json`; ausente vale `unversioned`. So no escopo project.
2. "Nao versionar" e um `.gitignore` dentro de `.mgr-core/runtime/`, escrito por `installRuntime` como
   parte da copia derivada; "versionar" e a ausencia dele. O bloco da raiz nao muda.
3. O `install` pergunta (padrao `unversioned`) e grava so o que foi respondido; com `-y`, sem terminal ou
   com `--skills-dir`, vale o gravado ou o padrao, anunciado e nao gravado.
4. O `update` anuncia a novidade e pergunta so quando a chave esta ausente, e grava so a resposta dada
   num terminal.
5. `mgr runtime-versioning [--json]` le a escolha; `mgr runtime-versioning set <valor>` grava e aplica o
   arquivo na hora. So na CLI.
6. Runtime ja no indice com escolha `unversioned`: o metodo le com `git ls-files` (borda
   `bin/git-index.js`) e avisa com `git rm -r --cached .mgr-core/runtime`; nunca escreve no git.
7. O `doctor` ganha a verificacao `runtime-versioning`, sob o escudo de versao.
8. Valor gravado invalido: install e update recusam antes de escrever.

## Alternatives Considered

- **Linhas da pasta no bloco gerenciado da raiz:** rejeitada; e o desenho barrado pelo N-11 (estado
  dependente das pastas de motor em disco) e contraria a RN-5 do PRD.
- **Escolha gravada no manifesto:** rejeitada; `writeManifest` monta o objeto a partir de uma lista fixa
  de campos, e campo fora dela some na execucao seguinte (src/registry.js:245-248).
- **Sempre fora do versionamento, sem escolha:** rejeitada pelo autor (2026-10-15).
- **O metodo rodar `git rm --cached`:** rejeitada pela CONSTITUTION secao 5 (nenhuma acao de git
  automatica).
- **Ler `.git/index` direto:** rejeitada; reimplementaria o formato do git, o mesmo motivo do limite
  declarado em src/gitignore.js:12-14.
- **Gravar o padrao quando nao ha resposta:** rejeitada; o contrato do install grava so o que foi
  respondido (docs/sdd/03-contracts.md, secao 1), e gravar no `update -y` sujaria a arvore de trabalho do CI.

## Consequences

### Positive
- Com o padrao, o runtime nao entra no repositorio do projeto, e o SonarQube, no comportamento padrao,
  deixa de analisa-lo (SonarQube Server 2026.4, "Disabling the SCM's file ignore patterns", consultada em
  2026-10-21).
- A escolha viaja com o repositorio e se reve nos dois sentidos sem tocar no git.

### Negative
- Clone limpo chega sem runtime e precisa do `update` antes das skills (ja era a parada do F1).
- O `update` passa a escrever no `config.json` do time quando a pessoa responde.
- Valor gravado invalido passa a recusar install e update.

### Risks and Mitigations
- **Risk:** a deteccao alterar o indice ou o historico. — **Mitigation:** so `git ls-files` com
  `GIT_OPTIONAL_LOCKS=0`, numa borda isolada. — **proved by:** o CA-12 em
  `test/runtime-versioning.test.js` compara o sha256 de `.git/index` e o `rev-list --all` antes e depois;
  a mutacao (b), com `git rm -r --cached` no lugar do `ls-files`, deixa 5 testes vermelhos (2026-10-22).
- **Risk:** o `*` do arquivo aninhado nao cobrir a pasta inteira. — **Mitigation:** o conteudo literal da
  spec 4.4. — **proved by:** o CA-1 com `git status --untracked-files=all`; a mutacao (a), que
  deixa de gravar o arquivo, deixa 21 testes vermelhos (2026-10-22).
- **Risk:** CI que roda o `doctor` ficar vermelho logo apos o upgrade. — **Mitigation:** a verificacao so
  roda com o manifesto na versao do pacote. — **proved by:** o CA-19; a mutacao D1, sem o escudo de versao, fica vermelha
  (2026-10-22).
- **Risk:** `config.json` ignorado na raiz e a escolha nao viajar. — **Mitigation:** o aviso
  `gitignoreTeamIgnored` existente. — **proved by:** o CA-14 em
  `test/runtime-versioning.test.js` (o aviso sai uma vez com `.mgr-core/` na raiz). Nao houve mutacao
  dedicada a ele.
- **Risk:** outros scanners continuarem varrendo o runtime versionado por escolha. — **Mitigation:**
  nenhuma; sem fonte oficial, o texto so fala de "nao versionado". — **proved by:** [NOT VERIFIED].
