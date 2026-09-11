# Fixture — etiqueta e marca dentro de bloco cercado

O que está dentro de um exemplo é documentação, não conteúdo. O `stripFencedBlocks` de
`src/markdown.js` é a fonte única disso, criada na fatia 2 — esta fixture a exercita, não a copia.

## Bloco cercado com crase — nada aqui pode produzir achado

```
A decisão veio do documento de origem [brief]
O arquivo sumiu [code:src/nao-existe.js:1]
O prazo ainda não foi escolhido [TO DEFINE]
Linha zero não é linha [code:src/markdown.js:0]
```

## Bloco cercado com til — nada aqui pode produzir achado

~~~
O caminho sobe para fora do projeto [code:../fora-da-raiz.md:1]
O número do ADR não é número [adr:dezesseis]
~~~

## Cerca de quatro crases envolvendo cerca de três

````
```
O arquivo sumiu [code:src/tambem-nao-existe.js:1]
```
O prazo ainda não foi escolhido [A DEFINIR]
````

## Fora da cerca — esta produz achado, e é o que prova que a fixture está viva

O arquivo sumiu [code:src/nao-existe.js:1]
