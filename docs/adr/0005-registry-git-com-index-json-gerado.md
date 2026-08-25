# ADR-0005: Adoção de registry Git com index JSON gerado dos manifests

Date: 2026-07-20
Deciders: Mauri Reis

## Status

Accepted

## Context

Skills plugáveis (ADR-0004) precisam de um canal de distribuição com descoberta,
versionamento e integridade — sem criar infraestrutura nova (kickoff, seção 4: YAGNI). O
usuário precisa cadastrar registries além do oficial (caso `@empresa/*`), e o catálogo
precisa ser organizável por categoria (resolução Q3 do kickoff). A CLI do MGR não tem
dependências de runtime e essa premissa é mantida.

**Reference:** Spec técnica em specs/fase1-fundacao-plugins/03-spec.md.

## Decision

1. **Registry = repositório Git + `index.json`.** O oficial é
   `github.com/maurigre/mgr-registry`, com uma pasta por skill (`skills/<nome>/` contendo
   `SKILL.md` + `mgr-manifest.json` + recursos).
2. **Index gerado, nunca editado à mão (Q3):** `scripts/build-index.mjs` no repo do
   registry gera o `index.json` categorizado a partir dos manifests; o CI do registry
   valida cada manifest (schema, description/triggers de D06, `permissions` obrigatório no
   oficial) e regenera o index a cada publicação. A categoria vive no manifest da skill —
   fonte única, sem divergência entre skill e catálogo.
3. **Registries múltiplos:** `mgr registry add <name> <url> [--trusted]` persiste
   `registries[]` como `{name, url, trusted}` em `.mgr-core/config.json` (arquivo novo; o
   `manifest.json` continua sendo apenas estado de instalação). A URL cadastrada é a do
   index (ex.: `https://raw.githubusercontent.com/maurigre/mgr-registry/main/index.json`).
4. **Download por arquivo via `fetch` nativo:** o index lista, por skill, `files[]` com
   URL e sha256 individuais, mais um checksum agregado determinístico (sha256 sobre os
   paths em ordem lexicográfica e os bytes de cada arquivo). Zero dependência nova e nenhum
   requisito de `tar`/`unzip` no sistema do usuário.
5. **`trusted` é declarativo nesta fase:** persiste no config, mas não habilita instalação
   sem confirmação — o modo `auto` de D03 chega na Fase 2 com o `mgr audit` (ADR-0007).

## Alternatives Considered

- **Infraestrutura dedicada (API/serviço de registry):** custo permanente de operação sem
  evidência de necessidade; Git + JSON cobre descoberta, versionamento e auditoria pelo
  próprio histórico. Rejeitada (YAGNI, kickoff seção 4).
- **Distribuição por tarball:** exigiria `tar`/`unzip` no sistema ou dependência nova de
  runtime na CLI. Rejeitada na v1; registrada como evolução (revisit trigger: skills com
  dezenas de arquivos ou registry com latência relevante tornariam o download por arquivo
  custoso).

## Consequences

### Positive

- Nenhuma infraestrutura nova para operar; publicação é um merge no repo do registry.
- O index categorizado dá descoberta (`mgr list`) sem baixar skill alguma.
- Registries privados de times funcionam com o mesmo mecanismo (qualquer URL de index).

### Negative

- Download por arquivo faz N requisições por skill (aceitável no volume da v1).
- A disponibilidade do registry oficial depende do GitHub (raw.githubusercontent.com).

### Risks and Mitigations

- **Risco:** index editado à mão divergindo dos manifests — **Mitigação:** CI regenera e
  valida o index em toda publicação; o build reprova divergência.
- **Risco:** URL de registry de terceiros servindo conteúdo alterado — **Mitigação:**
  checksum por arquivo e agregado validados no cliente antes de escrever qualquer byte
  (ADR-0006), e confirmação humana em toda instalação (ADR-0007).
