# Auto-avaliação da análise SDD

> `spec-init`, modo BROWNFIELD, 2026-07-14. Projeto pequeno (532 linhas em `src/`, 223 em
> `bin/`, 330 de teste, 11 skills, 54 commits) — **analisado por completo, sem amostragem**.

## Confiança por seção

| Seção | Confiança | Justificativa |
|---|---|---|
| 00-overview | **Alta** | Deriva de `package.json`, `README.md` e da árvore real. |
| 01-stack | **Alta** | Tudo verificável em `package.json` + workflows. Ausência de linter **confirmada** por busca. |
| 02-architecture | **Alta** (estrutura) · **Média** (rótulo) | As camadas e as dependências foram lidas no código. O rótulo "layered" é o **enquadramento mais próximo** entre as 4 provedoras — foi **confirmado com o autor**, não inferido. |
| 03-contracts | **Alta** | CLI, `files`/`bin`/`engines` e o contrato de `SKILL.md` saem direto de `bin/mgr.js`, `package.json` e `src/validator.js`. |
| 04-domain | **Alta** | Entidades e invariantes extraídos de `catalog.js`/`installer.js`; vários já cobertos por teste. |
| 05-data | **Alta** | Layout instalado e migração lidos em `installer.js`/`builder.js`/`manifest.js` e verificados por teste. |
| 06-quality | **Alta** (existente) · **Média** (adotado) | O existente foi medido. Os 4 gates adotados são **decisão de hoje**, ainda **não implementados**. |
| 07-operations | **Alta** | Workflows lidos; a causa do publish manual está documentada com os bugs do npm citados. |
| 08-glossary | **Alta** | Termos retirados do código e das skills. |
| 09-review-rules | **Média** | As regras universais e o layered são canônicas; o **perfil de linguagem é adaptado** (o perfil da fonte é TS/Node; aqui é JS puro). |

## Fatos vs Inferências

**Fatos (verificados no repo):** stack e versões · dependências · scripts · `files`/`bin` ·
workflows de CI e publish · ausência de linter/SAST/dep-check · contrato de `SKILL.md`
(código do validador) · layout instalado e migração (código + testes) · cobertura 96,95%
(medida) · convenção de commits (git log).

**Inferência forte:** o rótulo **layered** para a arquitetura (a estrutura é inequivocamente
borda→núcleo; o rótulo foi confirmado pelo autor).

**Inferência fraca / a confirmar:** o limiar do gate de cobertura; a adoção (ou não) de
mutation testing (StrykerJS); se `Screaming Architecture` deve ou não ser perseguido no `src/`.

## Pontos cegos

1. **Nenhum linter jamais rodou** neste código — pode haver problemas de estilo/erro comum que
   não apareceram (nem no review humano, nem no CI).
2. **O TUI interativo não é exercitado por teste** (exige TTY): 23 linhas do `bin/mgr.js`
   (spinner/notas/outro) permanecem sem cobertura.
3. **Escopo `global`** (instalação na home) é pouco testado — os testes focam em `project`.
4. **Windows não foi verificado.** O CI roda só em `ubuntu-latest`; há manipulação de caminhos
   (`path.relative`, `_shared`) que pode divergir. `[A CONFIRMAR]`
5. **`shared/scripts/sdd-check.sh`** não foi analisado em profundidade (773 B) nem tem teste.

## Perguntas para elevar a confiança

1. Qual **limiar** o gate de cobertura deve quebrar o build? (hoje 96,95%)
2. Adotar **StrykerJS** (mutation) no `src/`, ou dispensar?
3. O `src/` deve ser reorganizado para "gritar o domínio" (Screaming), ou o layout técnico
   atual (`installer`/`builder`/`validator`) está bom para uma CLI?
4. O escopo `global` é caso de uso real e suportado? Merece testes dedicados?
5. **Windows** é plataforma suportada? Se sim, o CI precisa de matriz de SO.
6. O `sdd-check.sh` ainda é usado? Deve ser testado ou removido?
7. `dependency-cruiser` (ou eslint-boundaries) deve **enforçar** `src/ ↛ bin/` no CI?
8. As 23 linhas de TUI sem cobertura devem ser aceitas como estão (recomendação atual)?
9. `evidence-capture` deve permanecer **desabilitado** neste projeto?
10. O `.spec-init/cache/` deve entrar no `.gitignore` (recomendado) ou ser versionado?
