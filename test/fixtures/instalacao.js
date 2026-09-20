// Instalacao de verdade num diretorio temporario, com os defeitos PLANTADOS.
//
// Ate aqui as verificacoes do `doctor` liam a instalacao de dogfooding DESTE repositorio. Ela e
// gitignored: existe na maquina de quem desenvolve e NAO existe no CI, que quebrou com dez falhas.
// E, mesmo na maquina, o estado dela e acidente — um `mgr update` mudaria o numero de orfas e
// derrubaria os testes.
//
// A fixture instala de verdade e planta cada defeito, entao o que os testes afirmam e o que a
// fixture declara, em qualquer maquina.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const BIN = fileURLToPath(new URL("../../bin/mgr.js", import.meta.url));

export const ORFA = "arch-hexagonal";
export const VERSAO_VELHA = "0.0.1-fixture";
export const HOOK_QUEBRADO = "/nao/existe/mgr.js";

/** Instala num temporario e devolve o caminho. Sem defeito nenhum: e o caso NEGATIVO da `RN-3`. */
export function instalacaoLimpa({ arch = "layered", language = "java" } = {}) {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mgr-doctor-"));
  execFileSync("node", [BIN, "install", "--engine", "claude-code", "--language", language,
    "--arch", arch, "--project-id", "fixture", "-y", repo], { encoding: "utf8", cwd: repo });
  return repo;
}

/**
 * Instalacao com os tres defeitos que a fatia nasceu para achar, plantados um a um:
 * skill orfa em disco, manifesto atras do pacote, e hook apontando para binario inexistente.
 */
export function instalacaoComDefeitos() {
  const repo = instalacaoLimpa();
  const skills = path.join(repo, ".claude", "skills");

  // A orfa sai de uma skill JA INSTALADA, nao da fonte crua: e o caso real (resto de uma instalacao
  // anterior com outra arquitetura), e a copia instalada ja tem os tokens resolvidos, entao a orfa
  // nao arrasta um achado de token junto e polui o que o teste afirma.
  cpSync(path.join(skills, "arch-layered"), path.join(skills, ORFA), { recursive: true });

  const manifesto = path.join(repo, ".mgr-core", "manifest.json");
  const dados = JSON.parse(readFileSync(manifesto, "utf8"));
  writeFileSync(manifesto, JSON.stringify({ ...dados, version: VERSAO_VELHA }, null, 2));

  const settings = path.join(repo, ".claude", "settings.local.json");
  const atual = existsSync(settings) ? JSON.parse(readFileSync(settings, "utf8")) : {};
  writeFileSync(settings, JSON.stringify({
    ...atual,
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: `node "${HOOK_QUEBRADO}" detect --hook claude-code` }] }] },
  }, null, 2));

  return repo;
}

export const descartar = (repo) => rmSync(repo, { recursive: true, force: true });
