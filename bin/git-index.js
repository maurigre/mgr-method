// Leitura do indice do git, so de leitura: `git ls-files` com GIT_OPTIONAL_LOCKS=0. O metodo nunca
// escreve no git (CONSTITUTION 5): nada de add, rm, commit ou reset aqui. Fica na borda, sem
// dependencia externa: so `node:*`.
import { execFileSync } from "node:child_process";
import process from "node:process";

// Devolve os arquivos do indice sob `relDir`. Qualquer falha (fora de repositorio git, git ausente
// do PATH, erro de qualquer natureza) vira `unavailable`, sem repassar o texto cru do erro.
export function indexedFiles(repo, relDir) {
  try {
    const saida = execFileSync("git", ["ls-files", "--", relDir], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    const files = saida.split("\n").filter((linha) => linha !== "");
    return { state: "listed", files };
  } catch {
    return { state: "unavailable" };
  }
}
