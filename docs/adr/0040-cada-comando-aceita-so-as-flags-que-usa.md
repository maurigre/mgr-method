# ADR-0040: Cada comando aceita só as flags que usa; a flag conhecida não usada é recusada como a desconhecida

Date: 2026-11-27
Deciders: Mauri Reis

## Status

Proposed

## Context

A CLI do MGR tem um parser só (`src/core/cli-args.js`). Toda flag conhecida é aceita por qualquer
comando, e cada comando lê as que usa e ignora o resto em silêncio. A flag desconhecida já era recusada
com exit 1, mas a conhecida que o comando não usa passava calada.

Medido em 2026-11-27, em projetos temporários: com `--dry-run`, que só o `install` honra, o `update`,
o `spec initials set`, o `origin set`, o `runtime-versioning set` e o `agents set` saíram 0 e gravaram,
e o `uninstall -y` apagou a instalação inteira. Quem passa uma flag que significa "não escreva" recebia
uma escrita. O defeito apareceu quando o autor rodou `update --dry-run` no próprio repositório.

O ADR-0030 recusou `--model` e `--effort` soltos no `install` e deixou declarado, sem mitigação, o
risco de "`--effort-*` passado a outro comando ser ignorado em silêncio".

**Reference:** Technical spec at specs/flag-nao-usada-pelo-comando/03-spec.md.

## Decision

- **A lista de flags aceitas mora no núcleo, como dado** (`src/core/cli-args.js`), com um conjunto por
  comando e por subcomando, nas duas CLIs: a do pacote e a do runtime do projeto (CONSTITUTION §2.2).
- **As duas bordas recusam antes do despacho**, depois da recusa da flag desconhecida: exit 1, stderr,
  mensagem no idioma configurado que nomeia a flag e os comandos que a aceitam. Nada é escrito antes.
- **Exceções declaradas:**
  - `--user-language` é aceita por todos os comandos, porque muda o idioma de qualquer um;
  - com `--hook`, o `detect` e o `precompact` seguem o contrato do hook (exit de hoje);
  - no runtime, a recusa "é ciclo de vida e não roda no runtime do projeto" vence;
  - as flags que um comando já lia só para recusar com mensagem própria (`install --model`,
    `install --effort`, `spec next --all`, `spec archive --all`, `review external --all`,
    `review waive --all`) mantêm essa mensagem e nunca aparecem como "aceita por".
- `precompact` sem `--hook` recebe a recusa comum.
- **Guarda da tabela:** uma pré-carga só de teste envolve o `flags` num `Proxy` e mede as chaves que
  cada comando de fato lê; o teste reprova a tabela estreita (recusaria invocação válida), a larga (o
  defeito voltando) e a flag sem entrada.

## Alternatives Considered

- **Fazer `update` e `uninstall` honrarem `--dry-run`:** é funcionalidade nova, decidida pelo autor
  para outra fatia; não fecha a classe (os outros comandos continuariam calados).
- **Avisar e seguir com exit 0:** a escrita acontece do mesmo jeito; o `uninstall -y --dry-run`
  apagaria a instalação depois do aviso.
- **Um conjunto por comando-pai:** `--model` passaria calado no `agents`, que só lê; o defeito voltaria
  um nível abaixo.
- **Poupar a flag inofensiva (`-y` num comando que não pergunta):** é julgamento por flag que envelhece;
  se o comando passar a perguntar, o `-y` ganha efeito em silêncio. A regra única é verificável.
- **Tabela na borda (`bin/`):** viola a CONSTITUTION §2.2, e as duas bordas a duplicariam.
- **Guarda por varredura estática de `flags.X`:** não vê leitura por chave computada (`flags[nome]`)
  nem a que atravessa funções; daria verde com tabela errada.

## Consequences

### Positive
- Nenhuma flag passada a um comando é ignorada em silêncio; o `--dry-run` nunca mais grava.
- Fecha o risco que o ADR-0030 deixou sem mitigação (`--effort-*` ignorado em outro comando).
- A tabela é a fonte única do que cada comando aceita, e a mensagem diz onde a flag vale.

### Negative
- **Quebra de contrato:** um script que passa flag inútil e saía 0 passa a sair 1. Quantos pipelines
  são afetados: [NOT VERIFIED].
- Comando ou subcomando novo exige entrada na tabela.

### Risks and Mitigations
- **Risk:** a tabela divergir do código, recusando invocação válida ou voltando a aceitar em silêncio.
  — **Mitigation:** guarda por leitura medida em `test/arquitetura/flags-por-comando.test.js`. —
  **proved by:** CA-15 da spec (as quatro mutações da DT-7 reprovam).
- **Risk:** uma invocação do próprio método (skill, hook, script, CI) passar a ser recusada. —
  **Mitigation:** guarda das invocações em `test/arquitetura/invocacoes-do-metodo.test.js`. —
  **proved by:** CA-14 da spec.
- **Risk:** o hook de sessão ser derrubado por flag a mais. — **Mitigation:** exceção do modo hook. —
  **proved by:** CA-12 da spec.
- **Risk:** um subcomando novo nascer sem entrada na tabela e as flags dele voltarem a passar caladas.
  — **Mitigation:** nenhuma nesta decisão; limite declarado. — **proved by:** [NOT VERIFIED].
