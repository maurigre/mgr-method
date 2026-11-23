# ADR-0035: A `src/` e a `test/` organizadas em pastas por papel, sem mudar comportamento

Date: 2026-11-20
Deciders: Mauri Reis

## Status

Proposed

## Context

A `src/` tinha 47 módulos soltos, além de `commands/` e `engines/`, e a `test/` tinha 92 arquivos de teste soltos, além de `fixtures/` e `helpers/`. O `docs/sdd/02-architecture.md` já agrupava os módulos por papel (instalação, validação, motores), mas o agrupamento só existia no documento: quem abria a pasta não via a arquitetura.

O autor pediu (2026-11-20) uma organização mais clara, tomando como referência a `src/` do OpenSpec (`Fission-AI/OpenSpec@main`), que separa `cli/`, `commands/`, `core/`, `ui/`, `prompts/` e `utils/`. Ele pôs uma condição: tudo tem de continuar funcionando como está. Depois pediu que a `test/` fosse reorganizada na mesma fatia.

## Decision

1. **Seis pastas novas na `src/`**, tiradas do grafo de imports medido (`specs/reorganiza-src/medicao/grafo.txt`), e não copiadas do OpenSpec:

   | pasta | papel |
   |---|---|
   | `core/` | base transversal sem regra de domínio: erros, mensagens, camada de texto, recursos do pacote, catálogo, leitura de argumentos, markdown, tokens, banner |
   | `install/` | instalar, atualizar, remover e escrever no disco do usuário, inclusive os plugins |
   | `plugins/` | registro de skills, detecção, auditoria e validação de `SKILL.md` |
   | `sdd/` | artefatos SDD e sua validação, e a raiz do projeto |
   | `session/` | contexto da sessão do agente (hand-off e manifesto de contexto) |
   | `doctor/` | diagnóstico da instalação |

   `commands/` e `engines/` não mudam.

2. **Nenhum ciclo entre pastas** (medido). As dependências descem numa direção: `commands` → `doctor`/`session` → `sdd` → `install` → `plugins` → `engines`/`core`/`plugin.js`. Dois módulos foram colocados onde estão para garantir isso:
   - `plugin-installer` foi para `install/`. Ele lê o manifesto, grava o lockfile e aplica as mudanças por `adapters`, ou seja, depende de três módulos de instalação.
   - `project-root` foi para `sdd/`. Ele importa `sdd/artifacts.js`; em `install/`, criaria a dependência `install` → `sdd`, e `sdd/` já importa `install/manifest.js`: ciclo entre as duas pastas.

3. **`src/plugin.js` não muda de lugar nem de bytes.** O arquivo é um contrato entre repositórios. O CI do `mgr-registry` o lê por caminho (`UPSTREAM_PATH = "src/plugin.js"`) e compara a cópia vendorizada com ele byte a byte (`scripts/check-schema-sync.mjs`, `vendored === upstream.text`).
   - Se o arquivo mudasse de lugar, a checagem não o acharia, se declararia inativa e passaria verde: a guarda se desligaria em silêncio.
   - Se os bytes mudassem, o CI do registry acusaria divergência.
   - Por isso o comentário da linha 8 continua citando `src/messages.js`, o caminho anterior de `src/core/messages.js`. É a única referência ao layout antigo mantida de propósito fora do histórico.

4. **A raiz do pacote continua sendo calculada pela posição do `bundle.js`, com a profundidade decidida pelo build.**
   - Fonte (`src/core/`) e runtime copiado (`.mgr-core/runtime/src/core/`): dois níveis acima.
   - Bundle (`dist/mgr.min.js`): um nível acima.
   - O módulo sabe que roda do bundle porque só o build define `__MGR_BUILD_VERSION__`.

   Antes, a profundidade fixa `"../"` servia aos dois casos só porque `src/` e `dist/` estavam no mesmo nível.

5. **A `test/` segue a `src/`.** O teste de um módulo fica na pasta com o nome da pasta do módulo (`test/sdd/`, `test/install/`, ...). Para os testes que não testam um módulo, há quatro pastas:

   | pasta | o que contém |
   |---|---|
   | `scripts/` | testes de `scripts/` |
   | `e2e/` | o CLI rodado como caixa-preta, incluindo os oráculos |
   | `conteudo/` | guardas sobre o que o pacote entrega: skills, `shared/`, agentes, regras citáveis |
   | `arquitetura/` | guardas sobre a forma do repositório: ciclo de import, fecho do runtime, tarball, commitlint |

   `test/plugin.test.js` fica na raiz de `test/`, como o `src/plugin.js` fica na raiz de `src/`.
   - Cada teste foi classificado pelos módulos que importa e pelo que seus casos fazem; quando o nome do teste é o de um módulo que ele importa, esse módulo decide a pasta.
   - O mapa inteiro está em `specs/reorganiza-src/medicao/mover-test.mjs.txt`.
   - A configuração não muda: o `npm test` já procura `test/**/*.test.js` e o lint já cobre `test/**/*.js`.

6. **Histórico preservado.**
   - Os arquivos foram movidos por `git mv`.
   - ADRs e versões já lançadas do CHANGELOG mantêm os caminhos da época.
   - Os documentos vivos passam aos caminhos novos.

## Alternatives Considered

- **Copiar a forma do OpenSpec:** as pastas do OpenSpec separam a aplicação por camada de interface (`cli/`, `ui/`, `prompts/`). A divisão por papel deste projeto já existia no `02-architecture.md`. Seguir o grafo medido dá pastas que não se dependem em ciclo; copiar a forma de outro projeto não garante isso.
- **Achar a raiz do pacote pelo primeiro `package.json` acima do módulo:** foi a primeira implementação desta fatia, e o review a reprovou com um caso concreto. Num runtime copiado que perdeu o próprio `package.json`, num projeto que tem `package.json`, a busca subia até o `package.json` do projeto do usuário. O `mgr-runtime version` passava então a imprimir a versão do projeto do usuário. A profundidade decidida pelo build não sai do pacote.
- **Mover o `plugin.js`, ou atualizar o comentário dele, e ajustar o `mgr-registry` junto:** exigiria duas mudanças coordenadas em repositórios diferentes. Rejeitado pelo autor nesta fatia.
- **Atualizar também os caminhos citados nos ADRs e no CHANGELOG lançado:** reescreveria o registro do que era verdade na época. Rejeitado pelo autor.
- **Organizar a `test/` numa fatia separada:** foi a recomendação inicial, para provar cada mudança sozinha. O autor preferiu a mesma fatia. A prova continua separável, porque a comparação de nomes de teste foi feita depois de cada movimentação.

## Consequences

### Positive

- As pastas mostram a arquitetura: quem procura a validação SDD abre `src/sdd/` e encontra os testes em `test/sdd/`.
- A direção das dependências entre pastas fica explícita e medível.

### Negative

- Mudou o caminho de import dos 46 módulos movidos para quem os importa; o de `commands/`, `engines/` e `src/plugin.js`, não.
- Os 91 testes movidos mudaram de caminho.
- Ramos abertos antes desta mudança vão conflitar nos imports.
- O runtime copiado para `.mgr-core/runtime/` passa a ter a mesma estrutura de pastas. Isso tem dois efeitos:
  - Uma instalação feita com o layout anterior e a mesma versão aparece no `doctor` com `divergent-body` nos arquivos do runtime até o `mgr update` (medido). Numa troca de versão normal, o `update` já recopia o runtime inteiro.
  - Quem versiona o runtime (`runtimeVersioning: versioned`) verá essas renomeações no git depois do `update`.

### Risks and Mitigations

- **Risk:** algum caminho montado por concatenação escapar da reescrita.
  - **Mitigation:** rodar a suíte inteira com `CI=true` e comparar os nomes de teste com a linha de base.
  - **proved by:** a primeira rodada achou 13 falhas, todas por caminho montado por concatenação, por fixture `.md` com ponteiro para arquivo real ou pela raiz do pacote. Depois das correções, o conjunto de nomes ficou igual ao da linha de base, mais os 4 testes novos do `check:clean`, todos verdes.
- **Risk:** o script reescrever uma asserção sintética.
  - **Mitigation:** revisar toda linha de teste alterada fora de import.
  - **proved by:** um caso foi achado (o grafo sintético de `test/arquitetura/sem-ciclo-de-import.test.js`) e restaurado ao original.
- **Risk:** a instalação mudar o que grava no projeto.
  - **Mitigation:** rodar o mesmo ciclo `install` → `uninstall` com o código de antes e com o de depois.
  - **proved by:** os arquivos instalados ficaram idênticos fora do runtime; diferem só o caminho temporário no hook e o `installedAt`. A sobra e a saída do `uninstall` também ficaram idênticas.
- **Risk:** a árvore limpa do `check:clean` não refletir arquivos renomeados.
  - **Mitigation:** o `check:clean` passou a tratar as linhas `R`/`C` do `git status`.
  - **proved by:** quatro testes novos (`git mv`, renomeado e modificado, renomeado e apagado da árvore, copiado no índice). A mutação de cada correção fica vermelha.
