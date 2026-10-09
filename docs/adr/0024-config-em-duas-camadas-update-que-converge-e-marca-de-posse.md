# ADR-0024: Config em duas camadas, update que converge e marca de posse da skill

Date: 2026-10-08
Deciders: Mauri Reis

## Status

Proposed. Revisa a invariante do PR #31 ("candidatos a remocao saem de conjuntos que o metodo
escreveu, nunca do disco") so para o passivo anterior a marca de posse; revisa a DT-13 da spec da F1
("nenhum evento de hook novo e gravado pelo update"); atende o gatilho de revisao do ADR-0023.

## Context

O install nao gravava o que foi decidido: nenhum caminho do install ou do update escrevia
`.mgr-core/config.json` (src/registry.js:25-30 era chamado so por registries, `agents set` e
`origin set`), e sem config nenhuma intencao tinha modelo. Medido em 2026-10-08 no sandbox migrado
pela F1: `.mgr-core/` so com `manifest.json`, e `agents drafting --json` devolvendo `model: null`.

O `projectId`, que o PRD da fatia classificou como pessoal, morava no manifesto, que o README manda
versionar (README.md:51). O update re-sincronizava so o que o manifesto declarava (`names:
man.skills`, src/installer.js:352), nao trazia a skill que a versao seleciona (`configure-agents`),
nao gravava o evento `PreCompact`, nao removia nada e saia sempre 0 (bin/mgr.js:713). Tres skills
orfas (`arch-hexagonal`, `evidence-capture`, `junit-clean`) ficaram ativas em disco por dois meses,
porque o motor carrega por pasta, e o `doctor` as acusava com `fix: null`, porque a origem de uma
orfa era desconhecida (src/doctor.js:55-65).

**Reference:** Spec tecnica em specs/entrega-f2-config-e-ciclo-de-vida/03-spec.md.

## Decision

1. **Duas camadas, chaves disjuntas.** Time (versionado): `.mgr-core/config.json` (politica de
   agentes, origem, registries, `detectionMode`, `lawsPreamble`) e `.mgr-core/manifest.json`
   (arquitetura, linguagem, idioma de saida, estado de instalacao). Pessoal (fora do versionamento):
   `.mgr-core/config.local.json` (`projectId`) e o `.env` derivado dele. Cada chave mora em uma
   camada so; chave do time escrita na pessoal e ignorada e avisada. Esta e a precedencia escrita.
2. **O install pergunta e grava.** Modelo por intencao e por motor, mostrando so os identificadores
   que o motor documenta, com "pular" pre-selecionado; origem greenfield/brownfield. Sem resposta,
   nada e gravado e a saida avisa que o agente herda o modelo da sessao, nomeando o comando.
   Nenhum default de modelo e publicado (ADR-0017). O `spec-init` le a origem gravada e so pergunta
   quando ela falta ou contradiz a deteccao.
3. **Bloco gerenciado no `.gitignore`**, com marca de posse nas linhas de borda, gravado so com
   consentimento e removido pelo `uninstall`.
4. **O update converge** ao conjunto que a versao seleciona para as escolhas gravadas (o manifesto
   passa a gravar `optional` e `allSkills`): entra o que falta, sai com consentimento item a item, o
   evento de hook do metodo que faltar e gravado so onde ja ha entrada do metodo, e cada diferenca e
   anunciada. Sai 1 quando o projeto fica divergente do conjunto da versao. O install mantem exit 0
   na recusa; o contrato do update e convergir, e o do install e instalar o que foi escolhido.
5. **Marca de posse na skill:** `# mgr-managed-skill: <nome>` como ultima linha do frontmatter. Skill
   com a marca e fora do manifesto e candidata por prova.
6. **Excecao registrada a invariante do PR #31, so para o passivo sem marca:** e candidata a pasta
   cujo nome o pacote distribui (catalogo mais lista de nomes retirados, conferidos contra `skills/`
   por teste), ausente do manifesto e do lockfile, sem `mgr-manifest.json`, e so nos diretorios que
   o manifesto declarava; oferecida item a item com "nao" como padrao. Sem terminal e sem `-y`, nada
   sai. Plugin nunca e candidato.
7. **O `doctor` continua sem escrever** e passa a nomear `mgr update` para orfa candidata. A
   remediacao entra no registro provado com o consentimento declarado (`-y`) que o runner usa no
   lugar da resposta humana; orfa de origem desconhecida segue sem remediacao.
8. **Migracao anunciada**, discriminada por `manifest.model = "self-contained-layered-config"`.
   Quem nao roda comando nenhum nao e afetado.
9. **Skill que entra encontra pasta de mesmo nome nao declarada** (segunda excecao a invariante do
   PR #31, achada no review do bloco P1 e aprovada pelo autor em 2026-10-08): com a marca do metodo no
   proprio nome, e do metodo e e substituida; sem marca, a substituicao e perguntada item a item, com
   "nao" como padrao, e sem consentimento a pasta fica intacta, a skill nao e instalada e o `update`
   sai 1; pasta de plugin (`dir` do lockfile ou `mgr-manifest.json`) nunca e substituida. A mesma
   protecao vale para a skill ja declarada que volta com `mgr-manifest.json` (X-27) e para a declarada
   que a versao deixou de selecionar com `mgr-manifest.json`, que deixa de ser declarada e fica intacta
   (review final, SP-1). Pendencia para a F3: pasta SEM manifest que o `mgr remove` preservou. O
   `install` nao muda, porque ali a escolha do conjunto e explicita.

## Alternatives Considered

- **Camada pessoal vence a do time, anunciada:** rejeitada no CHECKPOINT 1; um dev rebaixaria em
  silencio, na propria maquina, o modelo do gate de review.
- **Idioma de saida como chave pessoal:** rejeitada no CHECKPOINT 1; ele e gravado dentro de cada
  `SKILL.md` versionado, e o texto mudaria de idioma a cada install de um dev diferente.
- **`.env` como camada pessoal:** rejeitada; nao ha onde a regra "chave do time na pessoal e
  ignorada" acontecer.
- **Update so re-sincroniza o declarado:** rejeitada; a `configure-agents` e o `PreCompact` so
  chegariam por reinstalacao.
- **Remediacao `mgr update -y` no doctor:** rejeitada; um agente lendo a saida executaria o bypass
  de consentimento.
- **Marca como comentario no fim do corpo, como no agente:** rejeitada; o `divergent-body` compara o
  corpo e acusaria toda instalacao.
- **Manter `orphan-skill` sem remediacao:** rejeitada; as orfas seguem carregadas pelo motor.

## Consequences

### Positive
- A politica de modelo e a origem viajam com o repositorio; quem clona nao responde de novo.
- O update entrega o que a versao decide, inclusive skill e evento de hook novos.
- Skill renomeada ou retirada no futuro e reconhecida pela marca, sem lista manual.
- As tres orfas do caso medido saem com consentimento.

### Negative
- O `update` muda de semantica e passa a poder sair 1: CI que o roda sem `-y` em projeto divergente
  quebra.
- O `projectId` sai do manifesto: quem clona fica sem ele ate rodar `update`/`install`, e a
  referencia de contexto da pre-compactacao fica em silencio ate la.
- O `uninstall` apaga a config do time no checkout de quem desinstala.
- O metodo passa a tocar o `.gitignore` do usuario (com consentimento e marca).

### Risks and Mitigations
- **Risk:** o update remover pasta que o metodo nao instalou. — **Mitigation:** candidata so por
  marca ou por nome distribuido; lockfile e `mgr-manifest.json` excluem; so diretorios declarados;
  item a item com "nao" como padrao; a skill que entra tambem nao sobrescreve pasta alheia sem
  consentimento (decisao 9). — **proved by:** execucao de 2026-10-09 em
  `test/update-convergente.test.js` (CA-13, CA-14, CA-16 e os testes da decisao 9, inclusive a pasta de
  plugin abandonada), com mutacao em copia descartada: ignorar o lockfile, ignorar o `mgr-manifest.json`,
  ignorar o `skipEntering` ou devolver a orfa recusada ao manifesto derrubam o teste certo. O review
  isolado do bloco P1 reproduziu o furo que a decisao 9 fecha: sem ela, o `update` sem terminal apagava
  uma pasta escrita a mao com o nome de uma skill que entrava.
- **Risk:** um motor rejeitar o comentario YAML no frontmatter da skill. — **Mitigation:**
  comentario e YAML valido; sessao real no claude-code. — **proved by:** sessao real no claude-code
  em 2026-10-09 (CA-31): a `spec-create` com a marca foi listada, carregada e seguiu o fluxo ate a
  primeira pergunta ao usuario, num projeto fora de git; no copilot, [NOT VERIFIED].
- **Risk:** o usuario ignorar `.mgr-core/` inteiro e a config do time nao viajar. — **Mitigation:**
  aviso para linha literal do `.gitignore`. — **proved by:** `test/gitignore.test.js` (CA-8), executado
  em 2026-10-09; padroes glob ficam fora (limite declarado).
- **Risk:** a lista de nomes retirados estar incompleta. — **Mitigation:** o que escapa e anunciado
  como fora do alcance, nunca removido. — **proved by:** medicao de 2026-10-08,
  `git log --all --diff-filter=D` e `--diff-filter=R` sobre `skills/*/SKILL.md` devolvem vazio: nenhuma
  skill foi removida nem renomeada, e a lista nasce vazia. O anuncio de fora do alcance: CA-14 em
  `test/update-convergente.test.js`, executado em 2026-10-09.
- **Revisit trigger:** a F3 herdar as camadas para o workspace (D01); medicao do comentario YAML no
  copilot; ou um caso real de remocao indevida pela regra do nome distribuido.
