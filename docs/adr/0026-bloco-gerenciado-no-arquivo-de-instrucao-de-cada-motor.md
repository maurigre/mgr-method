# ADR-0026: Bloco gerenciado no arquivo de instrucao de cada motor, apontando para a constituicao

Date: 2026-10-16
Deciders: Mauri Reis

## Status

Proposed. Estende o modelo do bloco gerenciado do ADR-0024 (decisao 3) a um segundo tipo de arquivo
do usuario.

## Context

Num projeto com SDD, a constituicao fica em `docs/sdd/CONSTITUTION.md` e e visivel para a busca, mas
o motor carrega na sessao so o proprio arquivo de instrucao: `./CLAUDE.md` no claude-code
(https://code.claude.com/docs/en/memory) e `.github/copilot-instructions.md` no copilot
(https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions),
consultados em 2026-10-16. Nenhum codigo do metodo escrevia esses arquivos, e o spec-init no formato
Claude nao gravava nada na raiz. Medido no projeto do autor (0.7.0-beta.11): constituicao presente,
raiz sem CLAUDE.md, e a IA fora das skills do MGR nao a encontrava.

**Reference:** specs/sdd-apontado-na-raiz/03-spec.md.

## Decision

1. **Bloco gerenciado por motor instalado**, no arquivo que o descritor do motor declara
   (`instructions.file`): CLAUDE.md para claude-code, .github/copilot-instructions.md para copilot. O
   formato de saida do spec-init nao decide o bloco.
2. **Conteudo:** no claude-code, import `@docs/sdd/CONSTITUTION.md`; no copilot, ponteiro em texto
   (a resolucao de `@` nao esta documentada). Mais uma linha sobre `docs/sdd/` e `specs/<slug>/`.
   Bordas em comentario HTML de bloco, que o claude-code remove antes do contexto.
3. **So com constituicao presente.** Oferecido pelo install e pelo update no escopo project, e pelo
   spec-init via `instructions write` do runtime, sempre com consentimento por arquivo; recusar nao e
   erro.
4. **A mecanica do bloco e uma so** (`src/managed-block.js`), compartilhada com o `.gitignore`, cujo
   contrato nao muda.
5. **Motor que sai do plano:** o bloco fica e e anunciado. **uninstall** remove o bloco de todo
   arquivo de motor conhecido onde a marca esta; no escopo global, so quando o projeto nao tem
   instalacao propria.
6. **Sem AGENTS.md** por ora.

## Alternatives Considered

- **Mover a constituicao para a raiz:** rejeitada; nenhum motor carrega um CONSTITUTION.md da raiz
  sozinho (docs citadas acima).
- **A skill escrever o bloco como texto livre:** rejeitada; a marca sairia diferente e o uninstall
  deixaria de acha-la.
- **Modulo espelhando gitignore.js:** rejeitada; duplicaria seis funcoes (QUAL-6 do guia de review).
- **Copiar a constituicao para o arquivo de instrucao:** rejeitada; fere a fonte unica (regra 7 do
  spec-init, CONSTITUTION 3.5).

## Consequences

### Positive
- Toda sessao do claude-code comeca com a constituicao no contexto; a do copilot, com o ponteiro.
- Projetos que ja rodaram o spec-init recebem o bloco pelo update.

### Negative
- O metodo passa a tocar arquivos de instrucao do usuario (com consentimento e marca).
- No claude-code, a constituicao inteira entra em toda sessao.
- O runtime ganha tres arquivos.

### Risks and Mitigations
- **Risk:** regressao no bloco do `.gitignore`. — **Mitigation:** mesma API, mecanica extraida. —
  **proved by:** [NOT VERIFIED] ate a execucao; test/gitignore.test.js sem edicao (CA-19).
- **Risk:** o import nao carregar. — **Mitigation:** sessao real. — **proved by:** [NOT VERIFIED] ate
  a CA-26.
- **Risk:** o copilot nao ler o arquivo no VS Code ou na CLI. — **Mitigation:** nenhuma nesta fatia.
  — **proved by:** [NOT VERIFIED].
- **Revisit trigger:** medicao do copilot fora do github.com; ou um motor novo no descritor.
