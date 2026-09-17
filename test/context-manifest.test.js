import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  MAX_ENTRIES, REFERENCED, SPOOL_FORMAT, UNREADABLE, entryFor, manifestPath, read, write,
} from "../src/context-manifest.js";

const diretorioTemporario = () => mkdtempSync(path.join(tmpdir(), "mgr-ctx-"));

// Registros com a forma REAL do transcript, apurada em disco em 2026-09-13. Não é forma inventada:
// os campos de `compactMetadata` são os oito que os três boundaries deste projeto carregam.
const fala = (quem, texto) => JSON.stringify({ type: quem, message: { content: texto } });

const boundary = (trigger) => JSON.stringify({
  type: "system",
  subtype: "compact_boundary",
  content: "Conversation compacted",
  compactMetadata: { trigger, preTokens: 968188, postTokens: 18592, durationMs: 118086 },
});

function sessaoEmDisco(linhas, { comSubagente = [], comSaidaDeFerramenta = [] } = {}) {
  const raiz = diretorioTemporario();
  const transcript = path.join(raiz, "abc-123.jsonl");
  writeFileSync(transcript, `${linhas.join("\n")}\n`, "utf8");

  if (comSubagente.length) {
    const dir = path.join(raiz, "abc-123", "subagents");
    mkdirSync(dir, { recursive: true });
    for (const nome of comSubagente) writeFileSync(path.join(dir, nome), "conteudo de subagente\n", "utf8");
  }
  if (comSaidaDeFerramenta.length) {
    const dir = path.join(raiz, "abc-123", "tool-results");
    mkdirSync(dir, { recursive: true });
    for (const nome of comSaidaDeFerramenta) writeFileSync(path.join(dir, nome), "saida grande\n", "utf8");
  }
  return transcript;
}

const doHook = { engine: "claude-code", trigger: "auto", sessionId: "abc-123" };

test("a entrada mede o transcript em disco, e não estima nada", () => {
  const linhas = [fala("user", "pergunta"), fala("assistant", "resposta")];
  const transcript = sessaoEmDisco(linhas);
  const bytesEsperados = Buffer.byteLength(`${linhas.join("\n")}\n`);

  const entrada = entryFor({ ...doHook, transcriptPath: transcript });
  assert.equal(entrada.outcome, REFERENCED);
  assert.equal(entrada.transcriptBytes, bytesEsperados);
  assert.equal(entrada.transcriptRecords, 2);
  assert.equal(entrada.transcriptSha256,
    createHash("sha256").update(`${linhas.join("\n")}\n`).digest("hex"),
    "checksum e bytes sao o que permite ao dreno saber se o arquivo mudou desde o registro");
  assert.equal(entrada.consumed, false);
});

// O contrário disto é o defeito que a fatia anterior teve: afirmar progresso que o artefato não
// declara. Aqui, afirmar uma fronteira que ainda não aconteceu.
test("na PRIMEIRA compactação da sessão, os boundaries anteriores são lista vazia", () => {
  const transcript = sessaoEmDisco([fala("user", "oi"), fala("assistant", "ola")]);
  assert.deepEqual(entryFor({ ...doHook, transcriptPath: transcript }).previousBoundaries, [],
    "o boundary desta compactacao nao existe quando o hook roda: e escrito depois que ela termina");
});

test("os boundaries JÁ existentes entram, com a linha e o gatilho de cada um", () => {
  const transcript = sessaoEmDisco([
    fala("user", "primeira"),
    boundary("auto"),
    fala("user", "segunda"),
    boundary("manual"),
    fala("user", "terceira"),
  ]);
  assert.deepEqual(entryFor({ ...doHook, transcriptPath: transcript }).previousBoundaries,
    [{ record: 2, trigger: "auto" }, { record: 4, trigger: "manual" }],
    "dizem ao dreno quantas vezes a sessao ja foi compactada e onde");
});

test("linha ilegível no transcript não vira boundary inventado", () => {
  const transcript = sessaoEmDisco([
    fala("user", "oi"),
    '{ isto nao e json e menciona "compact_boundary"',
    boundary("auto"),
  ]);
  const { previousBoundaries } = entryFor({ ...doHook, transcriptPath: transcript });
  assert.deepEqual(previousBoundaries, [{ record: 3, trigger: "auto" }],
    "o transcript e do motor: adivinhar o que a linha dizia seria afirmar o que nao se mediu");
});

test("registro que menciona a marca sem SER um boundary é ignorado", () => {
  const conversaSobreOTema = JSON.stringify({
    type: "assistant",
    message: { content: 'o registro chama-se "compact_boundary" e marca a fronteira' },
  });
  const transcript = sessaoEmDisco([fala("user", "oi"), conversaSobreOTema]);
  assert.deepEqual(entryFor({ ...doHook, transcriptPath: transcript }).previousBoundaries, [],
    "conversa SOBRE compactacao nao e compactacao: filtrar so por texto contaria esta sessao errado");
});

test("o gatilho fora dos documentados é dito desconhecido, e não inventado", () => {
  const transcript = sessaoEmDisco([fala("user", "oi")]);
  for (const trigger of [null, undefined, "", "Manual", "MANUAL", "compact", 42]) {
    assert.equal(entryFor({ ...doHook, trigger, transcriptPath: transcript }).trigger, "unknown",
      `${String(trigger)}: valor de plataforma nao reconhecido nao pode virar um dos dois validos`);
  }
  assert.equal(entryFor({ ...doHook, trigger: "manual", transcriptPath: transcript }).trigger, "manual");
});

test("o que mais pertence à sessão entra, com tipo, caminho e tamanho", () => {
  const transcript = sessaoEmDisco([fala("user", "oi")], {
    comSubagente: ["agent-a085616553fb902ed.jsonl", "agent-a085616553fb902ed.meta.json"],
    comSaidaDeFerramenta: ["toolu_01MARfHko7Lq2ySD7TitB8Fp.txt", "bsqw855y0.txt"],
  });
  const { sessionArtifacts } = entryFor({ ...doHook, transcriptPath: transcript });

  assert.deepEqual(sessionArtifacts.map(({ kind }) => kind),
    ["subagent", "tool-result", "tool-result"],
    "o .meta.json vive ao lado do transcript de subagente e NAO e transcript");
  assert.deepEqual(sessionArtifacts.map(({ path: arquivo }) => path.basename(arquivo)),
    ["agent-a085616553fb902ed.jsonl", "bsqw855y0.txt", "toolu_01MARfHko7Lq2ySD7TitB8Fp.txt"],
    "os dois nomes de saida derramada medidos em disco entram: o padrao e a extensao, nao o prefixo");
  for (const { bytes } of sessionArtifacts) {
    assert.ok(bytes > 0, "tamanho medido, nunca estimado");
  }
});

// Das cinco sessões medidas, duas não tinham `tool-results/` e uma não tinha subagente nenhum.
test("diretório de artefato ausente é o caso COMUM, e não erro", () => {
  const transcript = sessaoEmDisco([fala("user", "oi")]);
  const entrada = entryFor({ ...doHook, transcriptPath: transcript });
  assert.equal(entrada.outcome, REFERENCED);
  assert.deepEqual(entrada.sessionArtifacts, []);
});

// Link quebrado aparece no `readdir` e falha no `stat`: é o jeito de exercitar, sem stub, o caso
// real de arquivo que sai de baixo do pé entre listar e medir.
test("arquivo que aparece na listagem e não pode ser medido NÃO entra sem tamanho", () => {
  const transcript = sessaoEmDisco([fala("user", "oi")], { comSaidaDeFerramenta: ["real.txt"] });
  const dir = path.join(path.dirname(transcript), "abc-123", "tool-results");
  symlinkSync(path.join(dir, "alvo-que-nao-existe.txt"), path.join(dir, "quebrado.txt"));

  const { sessionArtifacts } = entryFor({ ...doHook, transcriptPath: transcript });
  assert.deepEqual(sessionArtifacts.map(({ path: arquivo }) => path.basename(arquivo)), ["real.txt"],
    "entrada pela metade faria o dreno confiar num numero que ninguem mediu");
});

test("motor sem convenção de layout não recebe artefato inventado", () => {
  const transcript = sessaoEmDisco([fala("user", "oi")], {
    comSubagente: ["agent-abc.jsonl"],
    comSaidaDeFerramenta: ["toolu_abc.txt"],
  });
  assert.deepEqual(entryFor({ ...doHook, engine: "copilot", transcriptPath: transcript }).sessionArtifacts, [],
    "o layout deste motor nao foi medido: preencher seria palpite sobre plataforma de terceiro");
});

test("transcript inexistente ou sem caminho devolve forma discriminada, e não lança", () => {
  const semCaminho = entryFor({ ...doHook, transcriptPath: null });
  assert.equal(semCaminho.outcome, UNREADABLE);
  assert.equal(semCaminho.reason, "no-transcript-path");
  assert.equal(semCaminho.transcriptPath, null);

  const inexistente = entryFor({ ...doHook, transcriptPath: path.join(diretorioTemporario(), "nao-existe.jsonl") });
  assert.equal(inexistente.outcome, UNREADABLE);
  assert.equal(inexistente.reason, "ENOENT",
    "o codigo do erro diz POR QUE nao deu, em vez de um booleano que esconde a razao");
  assert.equal(inexistente.trigger, "auto", "o que se sabe do payload continua registrado");
});

test("diretório no lugar do transcript não derruba a montagem", () => {
  const entrada = entryFor({ ...doHook, transcriptPath: diretorioTemporario() });
  assert.equal(entrada.outcome, UNREADABLE, "EISDIR e entrada legitima de payload estranho, nao crash");
});

test("o formato do contrato é declarado, para o consumidor em outra linguagem", () => {
  assert.equal(SPOOL_FORMAT, 1, "quem drena e outro repositorio: formato implicito divergiria calado");
});

// --- O manifesto: um arquivo por projeto, poda e teto (P1.3) ---

const entrada = (i, { consumed = false } = {}) => ({
  sessionId: `sessao-${i}`,
  engine: "claude-code",
  trigger: "auto",
  recordedAt: `2026-09-1${i % 10}T00:00:00.000Z`,
  transcriptPath: `/casa/t-${i}.jsonl`,
  consumed,
});

test("o manifesto que não existe é estado INICIAL, e não perda", () => {
  const { spoolFormat, entries, recovered } = read(diretorioTemporario(), "proj");
  assert.equal(spoolFormat, SPOOL_FORMAT);
  assert.deepEqual(entries, []);
  assert.equal(recovered, false, "quem nunca compactou nao perdeu nada: dizer o contrario assustaria");
});

// A restrição do autor, afirmada: "Não deve ter vários arquivos de contexto gravados em disco."
test("três eventos produzem UM arquivo, com três entradas", () => {
  const core = diretorioTemporario();
  for (const i of [1, 2, 3]) write(core, "proj", entrada(i));

  const dir = path.join(core, "context");
  assert.deepEqual(readdirSync(dir), ["proj.json"],
    "o desenho e que atende a restricao: nao existe segundo arquivo a limpar");
  assert.deepEqual(read(core, "proj").entries.map(({ sessionId }) => sessionId),
    ["sessao-1", "sessao-2", "sessao-3"]);
});

test("projetos diferentes têm arquivos diferentes, e não se misturam", () => {
  const core = diretorioTemporario();
  write(core, "alfa", entrada(1));
  write(core, "beta", entrada(2));
  assert.deepEqual(readdirSync(path.join(core, "context")).sort(), ["alfa.json", "beta.json"]);
  assert.deepEqual(read(core, "alfa").entries.map(({ sessionId }) => sessionId), ["sessao-1"]);
});

test("entrada consumida é podada, e não consumida nunca é descartada para caber", () => {
  const core = diretorioTemporario();
  write(core, "proj", entrada(1, { consumed: true }));
  write(core, "proj", entrada(2));
  const { entries } = read(core, "proj");
  assert.deepEqual(entries.map(({ sessionId }) => sessionId), ["sessao-2"],
    "o dreno marca consumed, e a escrita seguinte poda: e assim que o arquivo nao cresce sem teto");
});

// Fronteira exata (TST-3): com 25 entradas, um corte off-by-one no limite daria o mesmo resultado.
test("na fronteira do teto nada é descartado, e uma acima descarta exatamente uma", () => {
  const core = diretorioTemporario();
  for (let i = 1; i <= MAX_ENTRIES; i += 1) write(core, "proj", entrada(i));
  const noTeto = read(core, "proj").entries;
  assert.equal(noTeto.length, MAX_ENTRIES, "exatamente no teto ainda cabe tudo");
  assert.equal(noTeto[0].sessionId, "sessao-1", "a mais antiga continua ali");

  write(core, "proj", entrada(MAX_ENTRIES + 1));
  const acima = read(core, "proj").entries;
  assert.equal(acima.length, MAX_ENTRIES);
  assert.equal(acima[0].sessionId, "sessao-2", "saiu exatamente uma, e foi a mais antiga");
  assert.equal(acima.at(-1).sessionId, `sessao-${MAX_ENTRIES + 1}`, "a ultima escrita e a ultima");
});

test("manifesto corrompido NÃO derruba, é substituído, e a perda é declarada", () => {
  const core = diretorioTemporario();
  write(core, "proj", entrada(1));
  writeFileSync(manifestPath(core, "proj"), "{ isto nao e json", "utf8");

  const lido = read(core, "proj");
  assert.deepEqual(lido.entries, []);
  assert.equal(lido.recovered, true, "silenciar a perda contraria a RN-4");

  const escrito = write(core, "proj", entrada(2));
  assert.equal(escrito.recovered, true, "quem chama precisa poder dizer ao usuario que houve perda");
  assert.deepEqual(read(core, "proj").entries.map(({ sessionId }) => sessionId), ["sessao-2"]);
});

test("boundary sem `compactMetadata` tem gatilho DESCONHECIDO, e não inventado", () => {
  const semMetadado = JSON.stringify({ type: "system", subtype: "compact_boundary" });
  const transcript = sessaoEmDisco([fala("user", "oi"), semMetadado]);
  assert.deepEqual(entryFor({ ...doHook, transcriptPath: transcript }).previousBoundaries,
    [{ record: 2, trigger: "unknown" }],
    "boundary sem o metadado ainda E um boundary: o que falta e o gatilho, e ele se declara");
});

test("manifesto sem `spoolFormat` recebe o formato corrente na leitura", () => {
  const core = diretorioTemporario();
  mkdirSync(path.join(core, "context"), { recursive: true });
  writeFileSync(manifestPath(core, "proj"), JSON.stringify({ entries: [] }), "utf8");
  assert.equal(read(core, "proj").spoolFormat, SPOOL_FORMAT,
    "arquivo de versao anterior do contrato nao pode virar formato indefinido para quem drena");
});

test("entrada de forma inesperada no manifesto é descartada, e não derruba a escrita", () => {
  const core = diretorioTemporario();
  mkdirSync(path.join(core, "context"), { recursive: true });
  writeFileSync(manifestPath(core, "proj"),
    JSON.stringify({ spoolFormat: 1, entries: [null, "texto", entrada(9)] }), "utf8");

  write(core, "proj", entrada(10));
  assert.deepEqual(read(core, "proj").entries.map(({ sessionId }) => sessionId), ["sessao-9", "sessao-10"],
    "deixar a desestruturacao lancar faria o manifesto parar de ser escrito EM SILENCIO");
});

test("o manifesto carrega o projectId no corpo, e não só no nome do arquivo", () => {
  const core = diretorioTemporario();
  write(core, "proj-alfa", entrada(1));
  const cru = JSON.parse(readFileSync(manifestPath(core, "proj-alfa"), "utf8"));
  assert.equal(cru.projectId, "proj-alfa",
    "quem drena implementa o contrato como a DT-4 o descreve, e procura o campo dentro do JSON");
  assert.equal(read(core, "proj-alfa").projectId, "proj-alfa");
});

test("o que é persistido não carrega o discriminador de retorno da montagem", () => {
  const core = diretorioTemporario();
  const transcript = sessaoEmDisco([fala("user", "oi")]);
  write(core, "proj", entryFor({ ...doHook, transcriptPath: transcript }));
  const [gravada] = JSON.parse(readFileSync(manifestPath(core, "proj"), "utf8")).entries;
  assert.equal(gravada.outcome, undefined,
    "`outcome` discrimina o retorno da funcao, e nao e campo do contrato da DT-4");
  assert.equal(gravada.transcriptRecords, 1, "o que E contrato continua ali");
});

test("manifesto com `entries` que não é lista é tratado como vazio", () => {
  const core = diretorioTemporario();
  mkdirSync(path.join(core, "context"), { recursive: true });
  writeFileSync(manifestPath(core, "proj"), JSON.stringify({ spoolFormat: 1, entries: "nao-e-lista" }), "utf8");
  assert.deepEqual(read(core, "proj").entries, [],
    "forma inesperada no arquivo nao pode virar iteracao sobre string");
});

test("o diretório do spool é criado SOB DEMANDA, e não na leitura", () => {
  const core = diretorioTemporario();
  read(core, "proj");
  assert.equal(existsSync(path.join(core, "context")), false,
    "a invariante 5 diz que quem nao compacta nunca ve o diretorio aparecer");

  write(core, "proj", entrada(1));
  assert.equal(existsSync(path.join(core, "context")), true);
});
