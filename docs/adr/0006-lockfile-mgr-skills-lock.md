# ADR-0006: Adoção do lockfile mgr-skills.lock para reprodutibilidade

Date: 2026-07-20
Deciders: Mauri Reis

## Status

Accepted

## Context

Sem um registro travado do conjunto de skills plugáveis, devs do mesmo repositório divergem
silenciosamente no que têm instalado (racional de segurança de D03) — o comportamento do
agente muda de máquina para máquina sem causa visível. O kickoff (D02, Q2) exige
reprodutibilidade com semântica análoga ao npm: restaurar o conjunto exato, com integridade
verificada e procedência por registry. A rastreabilidade de D07 exige ainda saber qual
modelo/effort foi efetivamente aplicado por plataforma.

**Reference:** Spec técnica em specs/fase1-fundacao-plugins/03-spec.md.

## Decision

1. **`mgr-skills.lock` na raiz do projeto, versionado no Git.** É contrato do time: entra
   no commit como o `package-lock.json`.
2. **Schema v1** (`lockfileVersion: 1`): mapa `registries` usados (`{name, url, trusted}`)
   e mapa `skills` por nome namespaced, cada entrada com `version`, `registry` (procedência,
   Q1), `checksum` (agregado, ADR-0005), `category`, `engines` e `applied`.
3. **Bloco `applied` por engine (D07):** registra o que o adapter efetivamente traduziu
   (ex.: `model`/`effort` injetados no claude-code) e as degradações com warning (ex.:
   effort sem destino no copilot). Rastreabilidade de execução multi-modelo sem depender do
   evidence-capture.
4. **Semântica de restore:** `mgr install` e `mgr update`, quando o lockfile existe,
   resolvem cada skill no registry travado, validam o checksum e reinstalam o conjunto
   exato. Extensão aditiva: sem lockfile, os comandos se comportam exatamente como hoje
   (CONSTITUTION 2.7).
5. **Mismatch de checksum aborta sem escrever:** nenhum arquivo vai ao disco se a validação
   falhar; o erro é explícito. Atualização de versão de plugin nunca é silenciosa — está
   fora da Fase 1.
6. **O lockfile é a única fonte de verdade do conjunto de plugins do projeto**; `mgr add` e
   `mgr remove` o atualizam na mesma operação.

## Alternatives Considered

- **Lockfile dentro de `.mgr-core/`:** o diretório é candidato natural a gitignore em
  muitos projetos (contém `.env`); o lockfile lá deixaria de circular entre os devs,
  destruindo a reprodutibilidade que o justifica. Rejeitada.
- **Registrar o conjunto no `manifest.json` existente:** mistura estado de instalação da
  máquina (local) com contrato do time (versionado) no mesmo arquivo, com ciclos de vida e
  destinos de commit diferentes. Rejeitada.

## Consequences

### Positive

- `git clone` + `mgr install` reproduz o ambiente de skills do time, com integridade
  verificada.
- Procedência por registry visível no diff de code review quando alguém adiciona uma skill.
- `applied` documenta degradações por plataforma sem processo manual.

### Negative

- Mais um arquivo versionado na raiz do projeto.
- Conflitos de merge no lockfile quando dois devs adicionam skills em paralelo (mesma
  natureza dos conflitos de `package-lock.json`; JSON com chaves ordenadas minimiza).

### Risks and Mitigations

- **Risco:** lockfile editado à mão apontando checksum ou URL adulterados — **Mitigação:**
  o checksum é validado contra o conteúdo baixado antes de escrever; divergência aborta, e
  a confirmação humana do `mgr add` (ADR-0007) mostra origem e permissões.
- **Risco:** registry travado sai do ar e o restore falha — **Mitigação:** erro explícito
  com o nome/URL do registry; skills já instaladas permanecem intactas.
