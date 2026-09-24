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

/**
 * Instala num temporario e devolve o caminho. Sem defeito nenhum: e o caso NEGATIVO da `RN-3`.
 *
 * O `--user-language` e DECLARADO de proposito. Sem ele o manifesto herda o idioma do ambiente, e o
 * runner do CI nao tem locale pt_BR: a saida saia em ingles e o teste que afirma a frase em portugues
 * reprovava so ali. Fixture que depende do ambiente nao e fixture.
 */
export function instalacaoLimpa({ arch = "layered", language = "java", userLanguage = "pt-BR" } = {}) {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mgr-doctor-"));
  execFileSync("node", [BIN, "install", "--engine", "claude-code", "--language", language,
    "--arch", arch, "--user-language", userLanguage, "--project-id", "fixture", "-y", repo],
  { encoding: "utf8", cwd: repo });
  return repo;
}

/**
 * Instalacao limpa com dois motores (claude-code e copilot).
 *
 * Cria estrutura em `.claude/skills` e `.github/skills`.
 */
export function instalacaoLimpaDoisMotores({ arch = "layered", language = "java", userLanguage = "pt-BR" } = {}) {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mgr-doctor-"));
  execFileSync("node", [BIN, "install", "--engine", "both", "--language", language,
    "--arch", arch, "--user-language", userLanguage, "--project-id", "fixture", "-y", repo],
  { encoding: "utf8", cwd: repo });
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

/**
 * Instalacao com dois motores com defeito plantado no segundo diretorio.
 *
 * O defeito e um token nao resolvido em `.github/skills/spec-init/SKILL.md`, que testa se
 * o diagnose confere todos os diretorios de motor e nao apenas o primeiro.
 */
export function instalacaoComDefeitosDoisMotores() {
  const repo = instalacaoLimpaDoisMotores();

  // O defeito vai no SEGUNDO motor de proposito: e o caso que o diagnose nao enxergava enquanto
  // olhava so o primeiro diretorio. Plantado por APPEND e nao por substituicao de ancora — a versao
  // anterior procurava um titulo que nao existe no arquivo e, sem achar, nao plantava nada e nao
  // reclamava: o teste passava a afirmar sobre um defeito inexistente.
  const alvo = path.join(repo, ".github", "skills", "spec-init", "SKILL.md");
  if (!existsSync(alvo)) throw new Error(`fixture quebrada: ${alvo} nao existe apos instalar dois motores`);
  writeFileSync(alvo, `${readFileSync(alvo, "utf8")}\n{{MGR_UNRESOLVED}}\n`, "utf8");

  return repo;
}


export const descartar = (repo) => rmSync(repo, { recursive: true, force: true });

/**
 * Remove o arquivo de fonte compartilhada do diretorio do motor especificado.
 *
 * Lanca Error se o arquivo nao existir — o padrao corrigido evita plantar defeito dentro de
 * condicional silencioso que nao reclamava quando nada casava.
 */
export function apagarFonteCompartilhada(repo, dirDeSkillsRelativo, segmentos) {
  const alvo = path.join(repo, dirDeSkillsRelativo, ...segmentos);
  if (!existsSync(alvo)) throw new Error(`fixture quebrada: ${alvo} nao existe apos instalar`);
  rmSync(alvo, { recursive: false, force: true });
}

/**
 * Acrescenta ao fim do arquivo uma linha com token nao resolvido.
 *
 * Lanca Error se o arquivo nao existir.
 */
export function plantarTokenEmShared(repo, dirDeSkillsRelativo, segmentos) {
  const alvo = path.join(repo, dirDeSkillsRelativo, ...segmentos);
  if (!existsSync(alvo)) throw new Error(`fixture quebrada: ${alvo} nao existe apos instalar`);
  writeFileSync(alvo, `${readFileSync(alvo, "utf8")}\n{{MGR_FIXTURE}}\n`, "utf8");
}

/**
 * Altera uma linha do corpo do arquivo.
 *
 * Lanca Error se o arquivo nao existir.
 */
export function alterarCorpoEmShared(repo, dirDeSkillsRelativo, segmentos) {
  const alvo = path.join(repo, dirDeSkillsRelativo, ...segmentos);
  if (!existsSync(alvo)) throw new Error(`fixture quebrada: ${alvo} nao existe apos instalar`);
  const conteudo = readFileSync(alvo, "utf8");
  // Encontra o primeiro corpo (apos o frontmatter) e altera uma linha
  if (!conteudo.startsWith("---")) {
    writeFileSync(alvo, "LINHA ALTERADA", "utf8");
    return;
  }
  const fimFrontmatter = conteudo.indexOf("\n---", 3);
  if (fimFrontmatter === -1) {
    writeFileSync(alvo, "LINHA ALTERADA", "utf8");
    return;
  }
  const corpo = conteudo.slice(fimFrontmatter + 5);
  const linhas = corpo.split("\n");
  if (linhas.length > 0) {
    linhas[0] = "LINHA ALTERADA";
  }
  const novoCorpo = linhas.join("\n");
  writeFileSync(alvo, conteudo.slice(0, fimFrontmatter + 5) + novoCorpo, "utf8");
}
