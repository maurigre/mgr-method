// Referência ao contexto da conversa antes da compactação (ADR-0019). O motor já guarda o
// transcript em disco e não o destrói ao compactar — medido em 2026-09-13, com 2.451 registros
// gravados depois da fronteira num caso. Então o método **aponta** para ele em vez de copiá-lo:
// nada é duplicado, e não há acúmulo de arquivo no disco de quem usa o método.
//
// Este módulo é a DECISÃO e a MEDIÇÃO; quem imprime e quem escolhe palavra é a borda (INV-5).
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { get as engineDescriptor } from "./engines/index.js";
import { sha256 } from "./plugin.js";

// Versão do contrato do manifesto. Quem drena é outro repositório e outra linguagem, então o formato
// é dado versionado em vez de convenção implícita — a lição da migração de hook do ADR-0018.
export const SPOOL_FORMAT = 1;

export const REFERENCED = "referenced";
export const UNREADABLE = "unreadable";

// Teto de entradas NÃO consumidas. NÃO é medição de necessidade: é escolha de desenho declarada
// sobre dois números que foram medidos — uma compactação por sessão (3 de 5 sessões deste projeto,
// exatamente uma vez cada) e algumas centenas de bytes por entrada. São ~20 sessões de folga para o
// dreno rodar, ao custo de poucos KB. Trocá-lo é trocar um número, não o desenho.
export const MAX_ENTRIES = 20;

// Os dois gatilhos documentados. Reexportados de `precompact.js` seria acoplamento entre módulos de
// núcleo por um par de literais; a disciplina de dizer DESCONHECIDO em palavra é a mesma.
const MANUAL = "manual";
const AUTO = "auto";
const TRIGGER_DESCONHECIDO = "unknown";

// O registro que o motor escreve quando a compactação termina. O que se procura no transcript são os
// boundaries ANTERIORES: o desta compactação ainda não existe quando o hook roda, porque o registro
// carrega `postTokens` e `durationMs` — medidos em 105, 107 e 118 segundos nas três compactações
// deste projeto — e nenhum dos dois pode ser conhecido antes de ela terminar.
const MARCA_DO_BOUNDARY = '"compact_boundary"';

const gatilhoDe = (trigger) => ([MANUAL, AUTO].includes(trigger) ? trigger : TRIGGER_DESCONHECIDO);

/**
 * Os boundaries JÁ existentes no transcript, com o gatilho de cada um.
 *
 * Diz ao dreno quantas vezes aquela sessão já foi compactada e onde — não onde esta compactação vai
 * cortar, que é informação que não existe ainda. **Lista vazia na primeira compactação**, e esse é o
 * caso comum: das cinco sessões medidas, três compactaram uma vez cada.
 */
function boundariesAnteriores(linhas) {
  const achados = [];
  linhas.forEach((linha, indice) => {
    if (!linha.includes(MARCA_DO_BOUNDARY)) return;
    let registro;
    try {
      registro = JSON.parse(linha);
    } catch {
      // Linha ilegível não vira boundary inventado: o transcript é do motor, e adivinhar o que ela
      // dizia seria afirmar o que não se mediu.
      return;
    }
    if (registro.subtype !== "compact_boundary") return;
    achados.push({ record: indice + 1, trigger: gatilhoDe(registro.compactMetadata?.trigger) });
  });
  return achados;
}

// O que mais pertence à conversa daquela sessão, pelo layout que o descritor declara. Diretório
// ausente é o caso comum — das cinco sessões medidas, duas não tinham `tool-results/` e uma não tinha
// subagente — então ausência devolve nada em vez de lançar.
function artefatosDaSessao(motor, transcriptPath) {
  const achados = [];
  for (const { kind, dir, pattern } of motor.sessionArtifacts(transcriptPath)) {
    const diretorio = path.join(...dir);
    let nomes;
    try {
      nomes = readdirSync(diretorio);
    } catch {
      continue;
    }
    for (const nome of nomes.filter((candidato) => pattern.test(candidato)).sort()) {
      const arquivo = path.join(diretorio, nome);
      try {
        achados.push({ kind, path: arquivo, bytes: statSync(arquivo).size });
      } catch {
        // Arquivo que sumiu entre listar e medir não entra sem tamanho: entrada pela metade faria o
        // dreno confiar num número que ninguém mediu.
      }
    }
  }
  return achados;
}

/**
 * Monta a entrada do manifesto para um evento de compactação, MEDINDO o transcript em disco.
 *
 * Devolve sempre a mesma forma, com `outcome` discriminando — o padrão que `plan-next`, `spec-status`
 * e `precompact` já usam, e que a DES-1 pede no lugar de `null` como sentinela.
 *
 * Não escreve nada e não fala com ninguém: sem terminal, sem rede. A borda passa o payload e recebe
 * a entrada pronta.
 */
export function entryFor({ engine, trigger, transcriptPath, sessionId = null, now = new Date() }) {
  const motor = engineDescriptor(engine);
  const base = {
    sessionId,
    engine,
    trigger: gatilhoDe(trigger),
    recordedAt: now.toISOString(),
    transcriptPath: transcriptPath ?? null,
  };

  if (!transcriptPath) return { outcome: UNREADABLE, reason: "no-transcript-path", ...base };

  let conteudo;
  try {
    conteudo = readFileSync(transcriptPath);
  } catch (erro) {
    // O payload aponta um caminho que não abre. Não é erro do usuário nem coisa a relatar como
    // falha: a referência simplesmente não pode ser feita, e quem chama decide a palavra.
    return { outcome: UNREADABLE, reason: erro.code ?? "unreadable", ...base };
  }

  const linhas = conteudo.toString("utf8").split("\n").filter(Boolean);
  return {
    outcome: REFERENCED,
    ...base,
    // Medidos, nunca estimados. Bytes e checksum são o que permite ao dreno saber se o arquivo mudou
    // ou desapareceu desde o registro — referência sem verificação é referência que mente depois.
    transcriptBytes: conteudo.length,
    transcriptRecords: linhas.length,
    transcriptSha256: sha256(conteudo),
    previousBoundaries: boundariesAnteriores(linhas),
    sessionArtifacts: artefatosDaSessao(motor, transcriptPath),
    consumed: false,
  };
}

// UM arquivo por projeto, e só ele. O autor foi explícito: "Não deve ter vários arquivos de contexto
// gravados em disco e isso deve ser tratado." Aqui isso é atendido pelo DESENHO, e não por regra de
// limpeza — não existe segundo arquivo a limpar.
//
// Mora no escopo GLOBAL (`~/.mgr-core/`) porque carrega caminhos absolutos e ids de sessão da
// máquina, e o `.mgr-core/` do projeto é o que o README manda versionar. Caminho absoluto em arquivo
// versionado é lixo para quem clona.
export const manifestPath = (coreDir, projectId) => path.join(coreDir, "context", `${projectId}.json`);

const VAZIO = { spoolFormat: SPOOL_FORMAT, entries: [] };

/**
 * Lê o manifesto do projeto. Devolve sempre a mesma forma, com `recovered` dizendo se o que estava
 * em disco foi perdido.
 *
 * Manifesto corrompido é FATO, não exceção: uma escrita interrompida deixa JSON quebrado, e derrubar
 * o hook por causa disso custaria o hand-off da sessão. Então ele é tratado como vazio, e quem chama
 * recebe `recovered: true` para poder dizer ao usuário que houve perda (RN-4: não silenciar).
 */
export function read(coreDir, projectId) {
  let cru;
  try {
    cru = readFileSync(manifestPath(coreDir, projectId), "utf8");
  } catch {
    // Não existir é o estado inicial, e não perda: quem nunca compactou não tem manifesto.
    return { ...VAZIO, projectId, recovered: false };
  }

  try {
    const lido = JSON.parse(cru);
    const entries = Array.isArray(lido.entries) ? lido.entries : [];
    return { spoolFormat: lido.spoolFormat ?? SPOOL_FORMAT, projectId, entries, recovered: false };
  } catch {
    return { ...VAZIO, projectId, recovered: true };
  }
}

// Poda: o que foi consumido sai, e o resto é cortado no teto mantendo as mais RECENTES. A ordem é a
// de escrita, então as mais recentes estão no fim. O que `slice(-MAX)` garante é que **consumida sai
// antes de não consumida** — passando de MAX não consumidas, a mais antiga delas sai também, e é
// esse o limite declarado.
const podar = (entries) => entries
  // Entrada que não é objeto vem de arquivo editado à mão, e descartá-la é melhor que deixar a
  // desestruturação lançar: a exceção seria engolida pela borda e o manifesto pararia de ser escrito
  // em silêncio — o pior modo de falha, porque ninguém descobre.
  .filter((entrada) => entrada !== null && typeof entrada === "object")
  .filter(({ consumed }) => !consumed)
  .slice(-MAX_ENTRIES);

/**
 * Acrescenta a entrada e reescreve o ÚNICO arquivo do projeto.
 *
 * Reescrever o arquivo inteiro em vez de acrescentar ao fim é deliberado: o manifesto é JSON, não
 * JSONL, e o consumidor é outra linguagem — append produziria arquivo inválido.
 */
export function write(coreDir, projectId, entry) {
  const { entries, recovered } = read(coreDir, projectId);
  // `outcome` discrimina o RETORNO de `entryFor`, e não é campo do contrato que a DT-4 declara —
  // persistir um campo a mais faria o consumidor em outra linguagem implementar o que não é contrato.
  const { outcome, ...doContrato } = entry;
  void outcome;
  const atualizado = {
    spoolFormat: SPOOL_FORMAT,
    // `projectId` no corpo, e não só no nome do arquivo: quem drena implementa o contrato como a
    // DT-4 o descreve, e procura o campo dentro do JSON.
    projectId,
    entries: podar([...entries, doContrato]),
  };
  const arquivo = manifestPath(coreDir, projectId);
  mkdirSync(path.dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, `${JSON.stringify(atualizado, null, 2)}\n`, "utf8");
  return { file: arquivo, entries: atualizado.entries.length, recovered };
}
