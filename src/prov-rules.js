// Regras sobre a proveniência parseada (ADR-0016). Recebem o parse e o contexto, devolvem findings.
//
// O que estas regras NÃO fazem, por decisão de produto registrada no ADR-0016: cobrar a PRESENÇA de
// etiqueta. "Asserção normativa sem etiqueta é erro" foi rejeitada — a adesão medida é zero e o
// custo cairia sobre cada linha normativa escrita para sempre. Aqui se confere só o que está
// escrito. Quem não etiquetar não é reprovado por nada.
//
// Nenhuma regra roda fora de POSIÇÃO DE MARCA. Etiqueta citada em prosa é citação, não asserção, e
// essa é a única definição sob a qual nenhum artefato existente é reprovado (invariante 3 da spec).
import { create } from "./findings.js";
import {
  checkPointer, POINTER_ESCAPES_ROOT, POINTER_NO_FILE, POINTER_NO_LINE,
} from "./provenance.js";

// PROV-1 — parece etiqueta e não é nenhuma das oito da L1.10.
//
// Só alcança quem já escreveu um token do vocabulário: `[qualquer coisa]` não é candidato, e por
// isso link de markdown e caixa de tarefa nunca chegam aqui.
function etiquetaMalformada(label, file) {
  return create({
    code: "PROV-1", severity: "error", file, line: label.line,
    message: `etiqueta malformada: \`${label.raw}\` usa o token \`${label.token}\` e não tem a forma que a L1.10 declara`,
    remediation: "Escreva a etiqueta numa das oito formas da L1.10. `prd` pede a seção, `adr` pede o número, e `code` pede caminho e linha — linha começa em 1.",
    example: "A decisão veio daqui [prd:UC-1]\nO separador de bloco cercado vive aqui [code:src/markdown.js:1]",
  });
}

// PROV-2 — o ponteiro não resolve em disco. Arquivo que sumiu e linha além do fim são o MESMO
// defeito para quem lê: a âncora aponta para o nada, e a remediação é reancorar.
function ponteiroQuebrado(label, resultado, file) {
  const alvo = `\`${resultado.path}\``;
  return create({
    code: "PROV-2", severity: "error", file, line: label.line,
    message: resultado.outcome === POINTER_NO_LINE
      ? `ponteiro quebrado: ${alvo} tem ${resultado.lines} linha(s), e a etiqueta aponta para a ${resultado.line}`
      : `ponteiro quebrado: ${alvo} não existe em disco, a partir da raiz do repositório`,
    remediation: "Reancore a etiqueta no lugar onde o fato vive hoje. O caminho é relativo à raiz do repositório, e arquivo gitignored conta como existente.",
    example: "O separador de bloco cercado vive aqui [code:src/markdown.js:1]",
  });
}

// PROV-4 — o caminho escapa da raiz. Separada da PROV-2 de propósito: "o arquivo sumiu" e "o
// caminho aponta para fora do projeto" pedem remediações diferentes, e um achado que junta as duas
// manda o autor procurar a coisa errada.
function ponteiroForaDaRaiz(label, resultado, file) {
  return create({
    code: "PROV-4", severity: "error", file, line: label.line,
    message: `ponteiro para fora do projeto: \`${resultado.path}\` escapa da raiz do repositório`,
    remediation: "Ancore num caminho de dentro do projeto, relativo à raiz. Um fato que vive fora do repositório não é conferível por quem clonar.",
    example: "O separador de bloco cercado vive aqui [code:src/markdown.js:1]",
  });
}

// PROV-3 — marca de pendência em posição de marca, numa feature já fechada.
//
// É AVISO, e a mensagem diz por quê. Ela detecta POSIÇÃO — o `]` como último caractere da linha — e
// não distingue uma pendência real de uma citação que por acaso termina a linha. Medido: das 24
// ocorrências em disco, nenhuma regra mecânica separa as duas. Prometer o contrário violaria a L1.9,
// e é por isso que a promessa está escrita na própria mensagem em vez de ficar só no ADR.
function pendenciaEmFeatureFechada(mark, file) {
  return create({
    code: "PROV-3", severity: "warning", file, line: mark.line,
    message: `marca de pendência \`${mark.form}\` ao fim da linha, numa feature com \`06-completion.md\`. Este aviso detecta a POSIÇÃO da marca; ele não distingue uma pendência real de uma citação que por acaso termina a linha`,
    remediation: "Se é pendência, resolva-a ou diga por que ela sobrevive ao fechamento. Se é citação, mova a marca para o meio da frase — fora de posição de marca ela não é apontada.",
    example: "O prazo de migração do acervo ficou fora desta fatia, e a marca [A DEFINIR] citada aqui não é apontada.",
  });
}

// `closed` é a existência de `06-completion.md` na feature, resolvida por quem chama. A regra não
// vai ao disco atrás dela: quem descobre artefato é o `artifacts`/`spec-status`, e duplicar essa
// descoberta foi reprovação do gate isolado numa fatia anterior.
export function check(parsed, file, { repo, closed = false } = {}) {
  const findings = [];

  for (const label of parsed.labels) {
    if (!label.atMarkPosition) continue;
    if (!label.wellFormed) { findings.push(etiquetaMalformada(label, file)); continue; }
    if (!label.pointer) continue;

    const resultado = checkPointer(repo, label);
    if (resultado.outcome === POINTER_ESCAPES_ROOT) findings.push(ponteiroForaDaRaiz(label, resultado, file));
    else if (resultado.outcome === POINTER_NO_FILE || resultado.outcome === POINTER_NO_LINE) {
      findings.push(ponteiroQuebrado(label, resultado, file));
    }
  }

  if (closed) {
    for (const mark of parsed.marks) {
      if (mark.atMarkPosition) findings.push(pendenciaEmFeatureFechada(mark, file));
    }
  }

  // Em ordem de leitura. As etiquetas e as marcas são duas listas independentes, e emiti-las em
  // sequência faria o número de linha saltar para trás no meio da saída de um mesmo arquivo.
  return findings.sort((a, b) => a.line - b.line);
}
