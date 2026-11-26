// Borda de PROCESSO da revisão externa (spec da fatia revisor-externo, DT-4): roda o revisor e o `git`.
// Fica em `bin/` porque nenhum arquivo de `src/` usa `child_process` (docs/sdd/02-architecture.md); a
// cola em `src/commands/review.js` recebe esta borda por injeção, e o teste a troca pelo `codex` falso
// no PATH, sem fake de função.
//
// O que esta borda NÃO faz: decidir, imprimir ou interpretar. O log antes e depois de cada subprocesso
// (LOG-2) é da cola, que tem o `io`. Aqui só se roda, captura e devolve resultado discriminado (DES-1).
//
// SEC-4: argv sempre separado, `shell: false`. O git é só leitura (CONSTITUTION §5) e roda com
// GIT_OPTIONAL_LOCKS=0, como em `bin/git-index.js`.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

// stdout e stderr vão para ARQUIVO, e não para o buffer do `spawnSync`: o padrão do Node é 1 MiB, e o
// fluxo JSONL de uma revisão (ou o conteúdo dos arquivos pelo `cat-file`) pode passar disso. Passar do
// limite mata o filho. Sem teto de tempo na 0.7.0 (CHECKPOINT 2, P-2): o teto vem da medição real.
function executar(binary, argv, { cwd, env, input, pasta }) {
  const arquivoOut = path.join(pasta, "stdout");
  const arquivoErr = path.join(pasta, "stderr");
  const fdOut = openSync(arquivoOut, "w");
  let resultado;
  try {
    const fdErr = openSync(arquivoErr, "w");
    try {
      resultado = spawnSync(binary, argv, {
        cwd,
        env,
        shell: false,
        input,
        stdio: [input === undefined ? "ignore" : "pipe", fdOut, fdErr],
      });
    } finally {
      closeSync(fdErr);
    }
  } finally {
    closeSync(fdOut);
  }
  if (resultado.error?.code === "ENOENT") return { outcome: "not-found" };
  if (resultado.error) return { outcome: "failed-to-start", code: resultado.error.code ?? "UNKNOWN" };
  return {
    outcome: "exited",
    status: resultado.status ?? -1,
    stdout: readFileSync(arquivoOut),
    stderr: readFileSync(arquivoErr),
  };
}

// Cada execução tem a sua pasta temporária, removida no `finally` (QUAL-5).
function comPasta(tmpRoot, corpo) {
  const pasta = mkdtempSync(path.join(tmpRoot, "mgr-review-"));
  try {
    return corpo(pasta);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

const comoTexto = (resultado) => (resultado.outcome === "exited"
  ? { ...resultado, stdout: resultado.stdout.toString("utf8"), stderr: resultado.stderr.toString("utf8") }
  : resultado);

// Lê a saída do `git cat-file --batch`: `<oid> <type> <size>\n<conteúdo>\n`, ou `<pedido> missing\n`.
// Saída que não fecha exatamente com os pedidos é falha alta, nunca hash desalinhado (R1-P2).
function lerBatch(saida, caminhos) {
  const arquivos = [];
  let posicao = 0;
  for (const caminho of caminhos) {
    const fimDoCabecalho = saida.indexOf(0x0a, posicao);
    if (fimDoCabecalho < 0) return { ok: false };
    const cabecalho = saida.subarray(posicao, fimDoCabecalho).toString("utf8");
    posicao = fimDoCabecalho + 1;
    if (cabecalho.endsWith(" missing")) {
      arquivos.push({ path: caminho, state: "deleted" });
      continue;
    }
    const [, tipo, campoDoTamanho] = cabecalho.split(" ");
    const tamanho = Number(campoDoTamanho);
    if (!Number.isInteger(tamanho) || posicao + tamanho + 1 > saida.length) return { ok: false };
    // Só `blob` é arquivo: um caminho que virou diretório (`tree`) ou submódulo deixou de ser o arquivo
    // revisado e conta como removido (spec DT-5; R2-P2). Os bytes são consumidos para manter o alinhamento.
    arquivos.push(tipo === "blob"
      ? { path: caminho, state: "present", content: saida.subarray(posicao, posicao + tamanho) }
      : { path: caminho, state: "deleted" });
    posicao += tamanho + 1;
  }
  return posicao === saida.length ? { ok: true, files: arquivos } : { ok: false };
}

// `git status --porcelain=v1 -z`: cada entrada é `XY <caminho>\0`.
const caminhosDoStatus = (saida) => saida.split("\0").filter((entrada) => entrada !== "").map((entrada) => entrada.slice(3));

export function createReviewIo({ env = process.env, tmpRoot = os.tmpdir() } = {}) {
  const envDoGit = { ...env, GIT_OPTIONAL_LOCKS: "0" };
  const git = (cwd, argv, input) =>
    comPasta(tmpRoot, (pasta) => executar("git", argv, { cwd, env: envDoGit, input, pasta }));
  const gitOk = (resultado) => resultado.outcome === "exited" && resultado.status === 0;
  const resolver = (cwd, ref) => {
    if (typeof ref !== "string" || ref === "" || ref.startsWith("-")) return { found: false };
    const resultado = git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return gitOk(resultado) ? { found: true, commit: resultado.stdout.toString("utf8").trim() } : { found: false };
  };

  return {
    // Chamada curta (versão, login): a saída volta como texto.
    run(binary, argv, { cwd }) {
      return comoTexto(comPasta(tmpRoot, (pasta) => executar(binary, argv, { cwd, env, pasta })));
    },

    // A revisão: grava o schema na pasta da execução, monta o argv com os caminhos dela e devolve a
    // última mensagem, se o revisor a escreveu.
    review(binary, montarArgv, { cwd, schema }) {
      return comPasta(tmpRoot, (pasta) => {
        const schemaFile = path.join(pasta, "schema.json");
        const lastMessageFile = path.join(pasta, "last-message.json");
        writeFileSync(schemaFile, JSON.stringify(schema), "utf8");
        const resultado = comoTexto(executar(binary, montarArgv({ schemaFile, lastMessageFile }), { cwd, env, pasta }));
        if (resultado.outcome !== "exited") return resultado;
        const lastMessage = existsSync(lastMessageFile)
          ? { present: true, text: readFileSync(lastMessageFile, "utf8") }
          : { present: false };
        return { ...resultado, lastMessage };
      });
    },

    git: {
      isRepo(cwd) {
        const resultado = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
        return gitOk(resultado) && resultado.stdout.toString("utf8").trim() === "true";
      },
      // Ref que começa por `-` seria lida como opção do git: recusada antes de chegar ao argv.
      resolve: resolver,
      head: (cwd) => resolver(cwd, "HEAD"),
      // Três pontos: desde a merge-base. `--no-renames`: rename aparece como remoção mais inclusão.
      changedFiles(cwd, baseCommit) {
        const resultado = git(cwd, ["diff", "--name-only", "--no-renames", "-z", `${baseCommit}...HEAD`]);
        if (!gitOk(resultado)) return { ok: false };
        return { ok: true, files: resultado.stdout.toString("utf8").split("\0").filter((caminho) => caminho !== "") };
      },
      dirty(cwd) {
        const resultado = git(cwd, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
        if (!gitOk(resultado)) return { ok: false };
        return { ok: true, files: caminhosDoStatus(resultado.stdout.toString("utf8")) };
      },
      // Um processo só para todos os caminhos, lidos no commit dado (e não no HEAD de quando a leitura
      // acontece): o conteúdo revisado fica fixado antes da chamada ao revisor (R1-P1).
      contentsAt(cwd, commit, caminhos) {
        const pedido = caminhos.map((caminho) => `${commit}:${caminho}\n`).join("");
        const resultado = git(cwd, ["cat-file", "--batch"], pedido);
        if (!gitOk(resultado)) return { ok: false };
        return lerBatch(resultado.stdout, caminhos);
      },
    },
  };
}
