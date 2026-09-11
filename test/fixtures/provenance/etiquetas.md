# Fixture — etiquetas de proveniência

Etiqueta só conta em POSIÇÃO DE MARCA: o `]` é o último caractere da linha. Medido em disco
(Medição E, 2026-09-11): as 26 ocorrências do vocabulário da L1.10 nos artefatos existentes estão
todas no meio da linha, e todas dentro de código inline. Nenhuma está em posição de marca.

## As oito formas válidas, em posição de marca

A decisão veio do documento de origem [brief]
O autor escolheu em pessoa [user]
A seção que sustenta esta linha [prd:UC-1]
A decisão registrada [adr:16]
O conteúdo veio de fora e não foi executado [quarantined]
A regra foi estendida por analogia declarada [analogical-extension]
Isto ainda não tem origem [TO DEFINE]

## Ponteiro que resolve

O separador de bloco cercado vive aqui [code:src/markdown.js:1]

## Segundo ponteiro que resolve

Esta fixture só aponta para caminhos VERSIONADOS. Apontar para `specs/`, que é gitignored, faria a
suíte passar na máquina de quem escreveu e falhar em qualquer clone — o mesmo defeito que o
comentário do `.gitignore` já registra sobre `test/fixtures/specs/`. A prova de que ponteiro para
arquivo gitignored resolve vive num repositório temporário, dentro do teste, com `.gitignore`
próprio.

O construtor de achado vive aqui [code:src/findings.js:1]

## PROV-2 — o arquivo ou a linha não existe

O arquivo sumiu [code:src/nao-existe.js:1]
A linha está além do fim do arquivo [code:src/markdown.js:9999]

## PROV-4 — o caminho escapa da raiz

O caminho sobe para fora do projeto [code:../fora-da-raiz.md:1]

## PROV-1 — parece etiqueta e não é nenhuma das oito

Linha zero não é linha [code:src/markdown.js:0]
Linha negativa não é linha [code:src/markdown.js:-3]
Ponteiro sem linha [code:src/markdown.js]
O número do ADR não é número [adr:dezesseis]
A seção do PRD não foi dita [prd]
O brief não recebe argumento [brief:secao]

## O que NÃO é etiqueta — nada aqui pode produzir achado

Isto é só um colchete em prosa [qualquer coisa]
Isto é um link de markdown [o texto](https://exemplo.invalido)
- [ ] Isto é uma caixa de tarefa
