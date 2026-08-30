# ADR-0004: Adoção do mgr-manifest.json como manifest de skill plugável

Date: 2026-07-20
Deciders: Mauri Reis

## Status

Accepted — decisão 6 (escala de effort com 4 valores) emendada pelo ADR-0010 em 2026-08-30.

## Context

A Fase 1 da evolução do MGR-METHOD (kickoff de 2026-07-19, decisões D02/D05/D06/D07)
transforma skills em plugins instaláveis com registry, lockfile e ciclo de vida próprio.
Isso exige metadados que uma skill hoje não carrega: nome com procedência
(`@registry/skill`), versão, categoria, permissões, compatibilidade com versões do MGR,
composição (`extends`) e preferências de modelo/effort por plataforma.

O formato de skill já é padronizado: o padrão aberto Agent Skills (agentskills.io), adotado
por Claude Code e GitHub Copilot, define o frontmatter do `SKILL.md` com `name` e
`description` obrigatórios e opcionais `license`, `compatibility` (string livre ≤ 500),
`metadata` (mapa string→string) e `allowed-tools`. O campo `metadata` não comporta
estruturas (listas de permissões, mapa de modelos por plataforma).

Matriz de capacidades verificada na documentação atual em 2026-07-20 (regra de processo de
D05), atualizando a matriz do kickoff em dois pontos:

- Claude Code suporta `model` e `effort` (`low|medium|high|xhigh|max`) diretamente no
  frontmatter do `SKILL.md` — o kickoff registrava esse suporte como pendente.
- Copilot NÃO tem effort por skill/agent: é feature request aberta
  (github/copilot-cli#2904, microsoft/vscode#313546); effort é apenas global
  (`--effort` / `effortLevel` em `~/.copilot/config.json`) — o kickoff registrava suporte
  no CLI v1.0.66+, não confirmado na documentação atual.

**Reference:** Spec técnica em specs/fase1-fundacao-plugins/03-spec.md.

## Decision

1. **Arquivo próprio `mgr-manifest.json` na raiz da pasta da skill plugável.** O plugin é
   uma pasta de skill 100% conforme o padrão agentskills.io (o padrão admite arquivos
   adicionais) mais o manifest. Frontmatter do `SKILL.md` = contrato com as plataformas;
   `mgr-manifest.json` = contrato com o MGR. Sem duplicação: o manifest não repete o que o
   frontmatter já declara.
2. **Campos do manifest** (conteúdo em inglês, ADR-0003): `name` (namespaced
   `@registry/skill`; a pasta permanece kebab-case sem scope), `version` (semver),
   `author`, `description` (40–1024 caracteres, triggers não-ambíguos — validados na
   publicação), `category` (lista fechada v1: architecture, language, database, infra,
   monitoring, testing, docs, workflow, other), `compatibility` (`{"mgr": ">=0.6.0"}`),
   `extends` (opcional), `permissions` (vocabulário fechado v1: read-files, write-files,
   run-shell, network; obrigatório no registry oficial), `capabilities`
   (`requires`/`optional`), `model` (mapa por plataforma com display names/aliases — nunca
   IDs datados de modelo), `effort` (escala normalizada de 4 valores
   `low|medium|high|max`), `testedModels`.
3. **Checksum fica fora do manifest** (auto-referência impossível): vive no index do
   registry e no lockfile (ADR-0005 e ADR-0006).
4. **Tradução por adapter (D05):** claude-code injeta `model`/`effort` no frontmatter do
   `SKILL.md` instalado; copilot não tem destino para esses campos e degrada com warning
   registrado — instalação nunca falha por capacidade ausente.
5. **`extends` na v1 instala as duas skills com precedência da que estende:** o instalador
   injeta na skill que estende um cabeçalho de composição apontando a base e a regra de
   precedência, e o vínculo fica registrado no lockfile. Triggers colidentes sem `extends`:
   o instalador pergunta qual skill é a primária.
6. **Escala de effort com os 4 valores do kickoff:** o `xhigh` do Claude Code não é
   endereçável via manifest na v1; valores fora da escala reprovam na validação.

## Alternatives Considered

- **Estender o frontmatter do SKILL.md com os campos do MGR:** o `metadata` do padrão só
  aceita string→string (insuficiente para `permissions[]` e `model{}`), e campos fora do
  padrão no frontmatter poluem o contrato que as plataformas leem. Rejeitada.
- **IDs fixos de modelo no campo `model`:** modelos são aposentados; um ID datado quebra o
  manifest com o tempo. Display names/aliases mapeiam para a versão vigente em cada
  plataforma. Rejeitada.
- **Escala de effort com 5 valores (incluindo `xhigh`):** adotaria a escala de uma
  plataforma específica como contrato neutro, contrariando a neutralidade de D05.
  Rejeitada na v1; reavaliável se outras plataformas convergirem para a escala estendida.

## Consequences

### Positive

- Skill plugável funciona em qualquer ferramenta compatível com Agent Skills sem alteração,
  porque o `SKILL.md` permanece padrão.
- Procedência visual (`@registry/skill`) no lockfile e na listagem, com modelo mental
  familiar (npm scopes) — custo de aprendizado próximo de zero.
- `model`/`effort` viram configuração declarativa portável; quando uma plataforma passar a
  suportar um campo, só o adapter muda — manifests intactos.

### Negative

- Dois arquivos de metadados por skill (frontmatter + manifest) — o autor precisa manter
  coerência entre eles.
- A matriz de capacidades de plataforma muda mensalmente e exige reverificação a cada ADR
  ou release que dependa dela (regra de processo de D05).

### Risks and Mitigations

- **Risco:** drift entre `description` do frontmatter e do manifest — **Mitigação:** a
  validação de publicação no registry oficial compara os dois e reprova divergência.
- **Risco:** display name de modelo ambíguo entre plataformas — **Mitigação:** o campo é um
  mapa por plataforma; o adapter de cada motor resolve apenas a própria chave e ignora as
  demais.
