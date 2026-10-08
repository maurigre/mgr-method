// Cola dos comandos de hook (`mgr detect --hook`, `mgr precompact --hook`). Humble Object: o IO de
// terminal entra por `io`, o de PROCESSO (stdin, fd, git) por `proc`, e a raiz por `root`. A decisão
// vive em src/detector.js e src/precompact.js.
//
// Shape de `proc` (montado pela borda a partir de bin/hook-io.js):
//   { escreverSync(fd, texto) => boolean, lerPayload() => Promise<object>, modificados(repo) => string[],
//     stdoutFd, stderrFd, write(texto) }
// `write` é o `process.stdout.write` assíncrono do detect (mantido para a saída não mudar).
import path from "node:path";
import * as installer from "../installer.js";
import { fetchIndex, lawsFallbackRef, listRegistries, readLawsPreamble } from "../registry.js";
import { readLockfile } from "../lockfile.js";
import { collectSuggestions, detect, hookReport, lawsPreamble } from "../detector.js";
import { ids as engineIds } from "../engines/index.js";
import { ASSEMBLED, assemble, decide, notice, persist, readStamp, writeStamp } from "../precompact.js";
import * as contexto from "../context-manifest.js";
import { readManifest } from "../manifest.js";

// Glue: junta os dados que o nucleo precisa. A decisao de como combinar e do detector.
export const suggestionsFor = (repo, detected) => collectSuggestions(
  detected,
  listRegistries(installer.coreDir("project", repo)),
  readLockfile(repo),
  { fetchImpl: globalThis.fetch, fetchIndexImpl: fetchIndex },
);

// `mgr detect --hook <motor>` — emite o relatorio no formato do motor. Falha aqui nao pode poluir nem
// derrubar a sessao do agente: no pior caso, silencio. Sai 0 sempre.
export async function detectHook({ cwd, root, flags, positional, proc }) {
  const repo = positional[0] ? path.resolve(cwd, positional[0]) : root;
  const detected = detect(repo);
  try {
    // O preâmbulo das leis entra ANTES do relatório, no mesmo canal do motor (ADR-0011).
    // Desligado, a saída volta a ser exatamente a de antes — nem uma linha a mais.
    const core = installer.coreDir("project", repo);
    const ligado = readLawsPreamble(core).enabled;
    const referencia = installer.installedLawsRef(flags.hook, "project", repo) || lawsFallbackRef();
    proc.write(hookReport(
      (await suggestionsFor(repo, detected)).suggestions,
      flags.hook,
      { preamble: ligado ? lawsPreamble(referencia) : null },
    ));
  } catch {
    return 0;
  }
  return 0;
}

// Log de hook vai para o STDERR, nunca para o stdout: o stdout deste evento carrega o envelope JSON,
// e texto solto ali o tornaria impossível de parsear. A doc diz que "stderr from a hook that exits 0
// goes to the debug log only, never the transcript, and Claude never sees it" — é destino de
// diagnóstico, que é o que a LOG-1/LOG-2 pedem, sem virar ruído no contexto de ninguém.
// Log não tem o que fazer com o resultado: se o canal de diagnóstico caiu, não há onde relatar isso
// — e relatar pelo próprio canal seria recursivo.
const logHook = (proc, linha) => { proc.escreverSync(proc.stderrFd, `[mgr] ${linha}\n`); };

// O aviso ao usuário sai pelo envelope que o motor declara, ou não sai. Motor sem canal não recebe
// texto solto: imprimir no que a plataforma descarta faria a fatia parecer avisar.
// Devolve se NADA foi perdido. Motor sem canal devolve `true`: não havia o que entregar, e isso não
// é falha de entrega — é a degradação que o descritor declara.
const emitirAviso = (proc, engine, conteudo) => {
  const envelope = notice(engine, conteudo);
  return envelope === null || proc.escreverSync(proc.stdoutFd, `${envelope}\n`);
};

// Registra a referência ao contexto e devolve o TEXTO a acrescentar ao aviso — nunca lança, e
// qualquer falha vira string vazia: perder a referência não pode custar o hand-off nem a sessão
// (RN-5). O núcleo mede e escreve; aqui se resolve o destino e se escolhe a palavra (INV-5).
//
// O manifesto vai para o escopo GLOBAL de propósito: ele carrega caminhos absolutos e ids de sessão
// da máquina, e o `.mgr-core/` do projeto é o que o README manda versionar.
const caminhoDoTranscript = (payload) => {
  const bruto = payload.transcript_path ?? payload.transcriptPath ?? null;
  return typeof bruto === "string" && bruto ? bruto : null;
};

function referenciarContexto(repo, { engine, trigger, transcriptPath, sessionId }, { proc, M }) {
  try {
    const projectId = readManifest(installer.coreDir("project", repo))?.projectId;
    // Sem projeto instalado não há por onde endereçar o manifesto. Silêncio, como todo o resto deste
    // comando: quem só abriu o editor não pode receber ruído.
    if (!projectId) return "";

    const entrada = contexto.entryFor({ engine, trigger, transcriptPath, sessionId });
    if (entrada.outcome !== contexto.REFERENCED) return ` ${M.precompactContextMissed(entrada.reason)}`;

    const global = installer.coreDir("global", repo);
    logHook(proc, M.precompactLogContextBefore(contexto.manifestPath(global, projectId)));
    const { file, entries, recovered } = contexto.write(global, projectId, entrada);
    logHook(proc, M.precompactLogContextAfter(file, entries));

    const perda = recovered ? ` ${M.precompactContextRecovered}` : "";
    return ` ${M.precompactContextReferenced({
      file,
      records: entrada.transcriptRecords,
      bytes: entrada.transcriptBytes,
      artifacts: entrada.sessionArtifacts.length,
    })}${perda}`;
  } catch {
    // Referência é acréscimo: se ela falhar, o hand-off e o aviso da fatia anterior seguem intactos.
    return "";
  }
}

// `mgr precompact --hook <motor>` — o gatilho mecânico das leis L3.2 e L3.4 (ADR-0018). O motor
// anuncia que vai compactar, e o método põe o estado em disco ANTES.
//
// Disciplina do `mgr detect --hook`, pela mesma razão: falha aqui não pode poluir o contexto do
// agente nem derrubar a sessão de quem só abriu o editor. A ÚNICA saída diferente de zero é o
// bloqueio deliberado, e ele é intencional.
export async function precompactHook({ root, flags, M, proc }) {
  try {
    const repo = root;
    const core = installer.coreDir("project", repo);
    const payload = await proc.lerPayload();
    const engine = flags.hook;
    // Motor desconhecido sai em silêncio, e ANTES de gravar: sem esta guarda o hand-off seria
    // escrito dizendo ter vindo de um motor que não existe, e só depois a decisão falharia. É a
    // validação de entrada da borda (QUAL-2), com a saída silenciosa que a DT-8 exige em lugar do
    // fail fast ruidoso — o `mgr detect --hook` faz igual.
    if (!engineIds().includes(engine)) return 0;
    // O gatilho vem do payload, e SÓ dele. Sem ele, `decide` trata como desconhecido e não bloqueia.
    const trigger = payload.trigger ?? null;

    // Git é da BORDA — o núcleo recebe a lista pronta, e repositório sem git devolve vazio.
    logHook(proc, M.precompactLogGitBefore);
    const changedFiles = proc.modificados(repo);
    logHook(proc, M.precompactLogGitAfter(changedFiles.length));

    // Gravar vem antes de decidir (RN-1): se só der para fazer uma coisa, é pôr o estado em disco.
    const montado = assemble(repo, { engine, trigger, changedFiles });
    const gravou = montado.outcome === ASSEMBLED;
    if (gravou) {
      logHook(proc, M.precompactLogWriteBefore(montado.destination));
      const { appended } = persist(repo, montado);
      logHook(proc, M.precompactLogWriteAfter(montado.destination, appended));
    }

    // A referência ao contexto da conversa (ADR-0019). Vem junto do hand-off, e pela mesma razão:
    // é preservação de estado, e preservar vem antes de decidir.
    //
    // O caminho do transcript vem do payload em duas grafias, porque as duas plataformas o nomeiam
    // diferente — `transcript_path` no claude-code e `transcriptPath` no copilot.
    const referencia = referenciarContexto(repo, {
      engine,
      trigger,
      // Só string vale como caminho: número truthy chegaria a `readFileSync` como **file
      // descriptor**, lendo algo que ninguém pediu. A recusa é silenciosa, como todo o resto deste
      // comando (DT-8), em vez do fail fast ruidoso que a QUAL-2 prescreve em geral.
      transcriptPath: caminhoDoTranscript(payload),
      sessionId: payload.session_id ?? payload.sessionId ?? null,
    }, { proc, M });

    // A borda passa o FATO de ter gravado; quem conjuga isso com gatilho e carimbo é o núcleo.
    const veredito = decide({ engine, trigger, blockedAt: readStamp(core, engine), saved: gravou });
    if (veredito.block) {
      // A palavra é escolhida DEPOIS da decisão, e não antes: dizer "a compactação vai acontecer" no
      // caminho em que ela foi impedida seria a saída se contradizendo dentro do mesmo envelope.
      //
      // O motivo vai no envelope, e não no stderr: a doc diz que a mensagem de bloqueio é "the
      // reason from your JSON's blocking decision when it makes one, and your stderr text
      // otherwise" — declarando a decisão, o stderr fica livre para ser canal de log.
      const entregue = emitirAviso(proc, engine, {
        message: `${M.precompactWroteBlocked(montado.destination, montado.slug)}${referencia}`,
        deny: M.precompactBlocked(montado.destination),
      });
      // Bloquear sem conseguir entregar o motivo obstruiria o usuário sem explicação — e é pior que
      // isso: sem envelope válido, a própria doc diz que a mensagem de bloqueio passa a ser o
      // stderr, que aqui carrega as linhas de log. Então não bloqueia. E **não carimba**: a próxima
      // tentativa continua valendo como recusa nova, em vez de ser liberada por uma recusa que o
      // usuário nunca viu.
      if (!entregue) return 0;
      logHook(proc, M.precompactLogStampBefore);
      writeStamp(core, { engine });
      logHook(proc, M.precompactLogStampAfter);
      return 2;
    }
    const gravacao = gravou
      ? M.precompactWrote(montado.destination, montado.slug)
      : M.precompactNothingToSave;
    const seguinte = veredito.repeated ? M.precompactProceeding : M.precompactSuggestNewSession;
    emitirAviso(proc, engine, { message: `${gravacao} ${seguinte}${referencia}` });
    return 0;
  } catch {
    // Silêncio é melhor que ruído no contexto do agente. O aviso, quando houve, já saiu acima.
    return 0;
  }
}
