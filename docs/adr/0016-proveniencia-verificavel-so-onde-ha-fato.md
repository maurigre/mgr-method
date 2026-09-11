# ADR-0016: Proveniência verificável só onde há fato, e a lei que diz o que não verifica

Date: 2026-09-11
Deciders: Mauri Reis

## Status

Accepted

## Context

O ADR-0011 entregou a **L1.10 — Provenance per assertion**, que manda toda asserção normativa
carregar a origem: `[brief]`, `[prd:<seção>]`, `[code:<caminho>:<linha>]`, `[adr:<n>]`, `[user]`,
`[analogical-extension]`, `[quarantined]` ou `[TO DEFINE]`. E a própria lei admite, numa nota:

> **Status: declared, not yet enforceable.** No validator checks these tags today. The check
> arrives with the verifiable artifact format, which is a separate feature.

Esta é aquela feature — e ela entrega **menos** do que a nota faz esperar, por decisão de produto.

**A pergunta que decidiu o escopo.** Antes de projetar, o autor foi perguntado se está disposto a
etiquetar **toda** asserção normativa que escrever, para sempre. A resposta foi **não**. A regra
`PROV-1` que o documento de origem propõe — "asserção normativa sem etiqueta é erro" — imporia esse
custo a cada linha escrita dali em diante.

Quatro medições, todas em disco em 2026-09-11, governaram o desenho.

**A — a regra de ponteiro nasce sem legado.** Existem **zero** etiquetas `[code:…]` reais em uso. As
duas ocorrências que o `grep` acha são o **formato sendo descrito** dentro do texto que explica a
proposta. Uma regra sobre ponteiro não tem como reprovar ninguém hoje.

**B — a regra de pendência tem risco concreto.** As marcas de pendência aparecem em 9 arquivos de 7
features, e **todas as sete estão fechadas**. A maioria é citação, não pendência: uma diz "(era
`[A DEFINIR]`)", contando história; três estão no parágrafo que descreve a própria medição.

**B' — a remedição de 2026-09-11, depois de fixada a definição estrita, corrige a B.** Sob
"posição de marca é o `]` como último caractere da linha", a `PROV-3` aponta **zero** ocorrências no
acervo, não duas features fechadas. A severidade de aviso continua certa, mas pela medição D, e a
justificativa da B está vencida. O acervo também cresceu: 63 arquivos na escrita do brief, 79
artefatos canônicos na remedição.

**C — a marca existe em dois idiomas.** `[TO DEFINE]` em 2 arquivos, `[A DEFINIR]` em 4, e
`[A CONFIRMAR]` citado na CONSTITUTION.

**D — não há regra mecânica que separe pendência de citação.** A hipótese era que a marca real fica
no fim da linha e a citação no meio. Medida contra as 24 ocorrências: 17 no meio, 7 no fim — e
**um dos sete é citação que por acaso termina a frase**. Distinguir as duas é julgamento.

**Reference:** Spec técnica em specs/mgr-spec-provenance/03-spec.md.

## Decision

1. **A regra que cobra etiqueta não é implementada.** "Asserção normativa sem etiqueta é erro" fica
   fora, com a razão registrada: adesão zero em 63 arquivos e custo por linha para sempre. A
   ferramenta confere **fato**; não cobra disciplina.

2. **O prefixo `PROV-*` fica**, mesmo sem a regra que dá nome à ideia. Ele já está no documento de
   origem, no vocabulário do programa e nos briefs anteriores; renomear custaria coerência histórica
   em troca de precisão que o texto de cada regra já entrega.

3. **Quatro regras:**

   | ID | Severidade | Regra |
   |---|---|---|
   | `PROV-1` | error | etiqueta malformada |
   | `PROV-2` | error | `[code:…]` cujo arquivo ou linha não existe |
   | `PROV-3` | **warning** | marca de pendência em posição de marca, em feature com `06-completion.md` |
   | `PROV-4` | error | `[code:…]` cujo caminho escapa da raiz do repositório |

4. **Três podem ser erro porque nascem sem legado** (medição A). **A `PROV-3` é aviso** porque não
   há regra mecânica que separe pendência de citação (medição D), e nenhum artefato existente pode
   passar a ser reprovado. A medição B sustentava este item com "apontaria duas features fechadas";
   a remedição B' mostra que aponta zero, e essa parte da justificativa está vencida.

5. **`PROV-4` é separada da `PROV-2`**: "o arquivo sumiu" e "o caminho aponta para fora do projeto"
   pedem remediações diferentes, e um achado que junta as duas manda o autor procurar a coisa errada.

6. **O fato conferido é existência em disco, a partir da raiz do repositório** (`repoRoot`, do
   ADR-0015). **Gitignored conta como existente**: `specs/` é gitignored neste projeto e é conteúdo
   legítimo, e conferir contra o que o git rastreia reprovaria âncoras para exatamente onde as
   asserções vivem. Linha inexistente é linha maior que o fim do arquivo; linha zero ou negativa é
   etiqueta malformada.

7. **Marca só conta em posição de marca** — o `]` como último caractere da linha, e a mesma regra
   vale para a etiqueta (medição E) —, com bloco cercado ignorado pela mesma
   fonte única que o ADR-0013 criou. E **a mensagem da `PROV-3` declara o que ela detecta** e que
   não distingue pendência real de citação que termina a linha (medição D). Prometer o contrário
   seria a L1.9 violada.

8. **As três formas de marca são reconhecidas** — `[TO DEFINE]`, `[A DEFINIR]`, `[A CONFIRMAR]` —
   **e isso é dívida declarada**, não decisão confortável: identidade parseável não deveria depender
   de idioma, e aqui depende. Canonizar obrigaria a migrar ou a reprovar.

9. **A verificação roda sempre**, sem exigir marcador de formato: conferir ponteiro é consistência
   sobre um campo que existe, a família da `PLAN-1`.

10. **A nota de status da L1.10 é emendada**, e só ela: passa a dizer o que **é** verificado — a
    etiqueta, quando presente — e o que **continua** valendo por disciplina — a presença dela. O
    texto normativo da lei não muda, as 45 leis seguem intactas.

## Alternatives Considered

- **Implementar `PROV-1` como o documento propõe, cobrando etiqueta de toda asserção normativa:**
  rejeitada por decisão de produto do autor, sustentada por medição — adesão zero em 63 arquivos, e
  o custo cairia sobre cada linha escrita dali em diante.
- **Rejeitar a família inteira e emendar a L1.10 para nunca ser verificável:** rejeitada porque
  perderia a parte que É fato — o ponteiro que resolve `[code:…]` é a única peça que torna a
  Restrição Crítica do `code-analyzer` conferível por máquina.
- **Renomear a família para refletir o que sobrou:** rejeitada por custo de coerência histórica.
- **Juntar `PROV-4` na `PROV-2`:** rejeitada porque as duas causas pedem remediações diferentes.
- **Conferir o ponteiro contra o que o git rastreia:** rejeitada porque reprovaria qualquer âncora
  em `specs/`, gitignored por decisão do autor e exatamente onde as asserções vivem.
- **Canonizar `[TO DEFINE]` como única marca:** rejeitada porque obrigaria a migrar o acervo ou a
  reprovar o que existe; a divergência fica registrada como dívida.
- **Fazer a `PROV-3` ser erro:** rejeitada pela medição D — o falso positivo da citação que termina
  a linha não tem separação mecânica. A medição B, que apontava features fechadas, foi corrigida
  pela B' e não sustenta mais a rejeição sozinha.
- **Prometer que a `PROV-3` distingue pendência de citação:** rejeitada pela medição D — é
  julgamento, e a L1.9 e a L6.1 proíbem vendê-lo como regra mecânica.

## Consequences

### Positive

- A L1.10 deixa de ser inteiramente sem dentes: a etiqueta, quando presente, passa a ser conferida.
- O ponteiro `[code:…]` torna a ancoragem conferível por máquina, que é o que a Restrição Crítica do
  `code-analyzer` exige hoje por leitura humana.
- Ninguém é obrigado a etiquetar, e o custo por linha para quem não quiser é zero.
- O arquivo de leis passa a dizer com precisão o que cumpre e o que não cumpre.

### Negative

- A lei continua **parcialmente** por disciplina, e a nota passa a dizer isso para sempre em vez de
  apontar para uma feature futura.
- O resultado da `PROV-2` depende da máquina, porque confere disco e `specs/` é gitignored. A saída
  não promete portabilidade.
- A `PROV-3` tem falso positivo conhecido e medido: citação que termina a linha.
- Três formas de marca reconhecidas mantêm viva uma dependência de idioma que os ADR-0012, 0013 e
  0014 vinham eliminando.

### Risks and Mitigations

- **Risco:** a `PROV-3` ser lida como detecção confiável de pendência. — **Mitigação:** severidade
  de aviso, e a mensagem declara o que ela detecta e o que não distingue.
- **Risco:** enfraquecer o arquivo de leis ao emendá-lo. — **Mitigação:** só a nota de status muda;
  inventário item a item das 45 leis no gate, `check:laws` verde, e conferência palavra a palavra no
  fechamento, como o ADR-0011 estabeleceu.
- **Risco:** desfazer o que os ADR-0010 a 0015 entregaram. — **Mitigação:** linha de base antes da
  primeira linha de código, com o achado item a item de todos os artefatos, os checksums do arquivo
  de leis e do `code-analyzer`, e sondas contra install real de dois motores.
- **Revisit trigger:** reavaliar a canonização da marca de pendência se o acervo for migrado, ou se
  a dependência de idioma causar defeito medido.
