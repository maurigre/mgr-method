# ADR-0023: Runtime legivel por motor dentro do projeto, raiz por marcador, e o fim do plano B sem CLI

Date: 2026-10-07
Deciders: Mauri Reis

## Status

Proposed. Revisa a decisao 8 do ADR-0015 e a ultima frase da decisao 3 do ADR-0017.
O gatilho de revisao "a F2 decidir camadas de config versionadas" foi atendido pelo ADR-0024 (Proposed).

## Context

As skills chamam `mgr spec status`, `mgr spec validate`, `mgr spec next`, `mgr agents`,
`mgr agents set`, `mgr origin set` e `mgr update`, e nenhum codigo do instalador poe `mgr` no PATH.
O `npx` que o README manda usar executa e nao deixa comando. Sem `mgr`, as skills seguem um plano B
**decidido**: o ADR-0015 mitigou o risco "quebrar o metodo sem a CLI" com fallback declarado, e o
ADR-0017 escreveu "Sem a CLI, o agente roda com o frontmatter". Medido em 2026-10-07
(specs/instalado-entrega-o-decidido/01-brief.md, secao 3): o `mgr-draft` e o `mgr-task` nao sao
comissionados, `spec validate` e `spec next` nao rodam, e a politica de modelo por intencao nao e
lida. O usuario recebe o fluxo antigo.

O autor exige que nada seja instalado no sistema operacional ("as empresas podem questionar e ate
banir o mgr"). Os modulos de que as skills precisam ja rodam so com Node, mas a cola dos comandos
mora em `bin/mgr.js`, junto de `@clack/prompts` e `picocolors`. Existem tres regras de raiz:
`repoRoot` (sobe ate `specs/`, para em `.git`/`package.json`), `coreDir` e `diagnose` (nao sobem).
O hook grava `node "${process.argv[1]}"`, o caminho de onde a CLI estava no momento do install.
O `--version` do `dist/` le o `package.json` e exibiu uma versao que o bundle nao era.

**Reference:** Spec tecnica em specs/entrega-f1-runtime-no-projeto/03-spec.md.

## Decision

1. **Runtime legivel dentro de cada motor.** O install e o update copiam, byte a byte, o fecho
   transitivo de imports de `bin/mgr-runtime.js` (uma borda fina sem dependencia externa) para
   `<diretorio de skills do motor>/_shared/mgr/`, com um `package.json` gerado (`type: module`,
   `version`). Nada minificado, nenhum import que nao seja relativo ou `node:`. Uma copia por motor:
   apagar a pasta de um motor nao quebra o outro (CONSTITUTION 2.5). Nada em `.mgr-core/` (2.6).
2. **A cola sai da borda.** Os comandos que o runtime atende vivem em `src/commands/`, com IO
   injetado. `bin/mgr.js` e `bin/mgr-runtime.js` sao duas bordas sobre a mesma cola. `src/` continua
   sem importar `bin/`.
3. **Uma regra de raiz.** `projectRoot(cwd)` sobe ate o primeiro `.mgr-core/manifest.json` (nunca
   a home), sem parar em `.git` nem em `package.json`. Sem marcador, vale a regra de compatibilidade
   para projeto nao instalado. A D01 estende isto subindo, a partir da raiz do projeto, ate
   `.mgr-workspace/`.
4. **Caminho explicito, e o plano B acaba.** As skills chamam `node {{MGR_RUNTIME}} <comando>` a
   partir da raiz, com o token resolvido por motor no install. Runtime ausente faz a skill **parar**
   com o comando de restauracao `npx mgr-method@<versao do manifesto> update`. Isto **revisa** o
   ADR-0015 (decisao 8: "o caminho literal de hoje nao e removido: vira fallback explicito") e o
   ADR-0017 (decisao 3: "Sem a CLI, o agente roda com o frontmatter").
5. **O hook chama o runtime do projeto**, nunca `process.argv[1]`. Eventos, matcher, timeout e
   prova de posse ficam como no ADR-0009 e no ADR-0018.
6. **Versao verdadeira.** O runtime declara a propria versao. O `dist/` embute a versao no build e
   recusa quando difere do pacote. O `doctor` ganha `runtime-version`.
7. **Parte local da configuracao de agentes sem rede.** `agents apply` reescreve so o frontmatter
   dos agentes a partir do config. Re-sincronizar skills continua sendo ciclo de vida, via `npx`.
8. **Pre-requisito SDD em Node.** `sdd-check` passa a ser comando do runtime; o `sdd-check.sh` sai.
9. **Migracao anunciada**, discriminada por `manifest.model` (`self-contained` → copia do runtime e
   reescrita do comando nas entradas de hook do proprio metodo), no `install` e no `update`. Quem nao
   roda comando nenhum nao e afetado.

## Alternatives Considered

- **Por `mgr` no PATH (link global, instalacao global):** rejeitada pelo requisito do autor, porque
  instala no sistema operacional.
- **Runtime em `.mgr-core/runtime/`:** rejeitada pela CONSTITUTION 2.6 ("`.mgr-core/` e config, nao
  conteudo").
- **Diretorio neutro versionado (`.mgr/`), copia unica:** rejeitada no CHECKPOINT 2 da spec (2026-10-07).
  Contradiz "no duplication and no pointers" do layout publicado e a rejeicao do ADR-0011 a
  skill lendo fora da pasta do motor.
- **Bundle nao minificado em `dist/`:** rejeitada porque `dist/` e gitignored e foi a fonte da
  defasagem medida. A copia da fonte do pacote e o codigo daquela versao por construcao.
- **Manter o plano B silencioso:** rejeitada; e o mecanismo pelo qual o decidido nao chega ao
  usuario.
- **Python + uv, como o BMAD:** rejeitada; mais pre-requisito e possivel rede, e Node basta.

## Consequences

### Positive
- As skills passam a comissionar agentes, validar e ler a politica de modelo sem nada no SO.
- O codigo que roda no projeto e legivel, auditavel e versionavel pelo time.
- Uma regra de raiz para todo o metodo, ja compativel com o workspace da D01.
- O hook deixa de depender do cache do `npx` ou da copia de onde o install rodou.

### Negative
- Uma copia do runtime por motor, a manter coerente (mitigado pela `runtime-version`).
- Runtime ausente agora **para** o fluxo: projeto instalado sem runtime precisa de `update`.
- `src/` passa a viajar no pacote publicado; o tamanho do tarball cresce.
- O `doctor` dentro do runtime nao tem as fontes do pacote e declara indisponivel a comparacao
  de corpo.

### Risks and Mitigations
- **Risk:** a copia do runtime divergir do pacote ou entre motores. — **Mitigation:** copia byte a
  byte da fonte na mesma escrita, teste de fecho de imports e verificacao `runtime-version` no
  `doctor`. — **proved by:** [NOT VERIFIED] ate a execucao da feature; os CA-9 e CA-11 da spec sao
  as execucoes que falhariam sem a mitigacao.
- **Risk:** a versao do manifesto nao estar publicada e a restauracao por `npx` falhar. —
  **Mitigation:** a parada traz a segunda via (`npx mgr-method@latest install`). —
  **proved by:** [NOT VERIFIED].
- **Risk:** lint, testes ou CI do usuario varrerem o runtime versionado. — **Mitigation:**
  declarado no README. — **proved by:** [NOT VERIFIED].
- **Revisit trigger:** a F2 decidir camadas de config versionadas (`.mgr-core/` deixando de ser
  inteiro gitignored), ou a confirmacao do diretorio de trabalho dos hooks nos dois motores.
