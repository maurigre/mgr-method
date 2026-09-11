# Fixture — marcas de pendência

A `PROV-3` detecta POSIÇÃO: marca cujo `]` é o último caractere da linha. Ela não distingue uma
pendência real de uma citação que por acaso termina a linha, e é por isso que ela é aviso.

## No meio da linha — citação, nenhum achado

A marca [TO DEFINE] aparece citada no meio desta frase e não é pendência.
Escrever `[A DEFINIR]` entre crases é citar o formato, não deixar pendência.
O texto explica que [A CONFIRMAR] existe, e segue falando depois dela.

## No fim da linha — as três formas produzem PROV-3

O limite de tamanho ainda não foi escolhido [TO DEFINE]
O prazo de migração do acervo [A DEFINIR]
O número que o benchmark vai medir [A CONFIRMAR]

## O falso positivo conhecido e medido

A linha abaixo é CITAÇÃO — ela conta história sobre uma marca que já foi resolvida — mas termina
em posição de marca, então a `PROV-3` aponta para ela. É o falso positivo que a mensagem da regra
declara, e ele está aqui de propósito para o teste provar que existe.

A marca desta linha já foi resolvida; ela era [A DEFINIR]
