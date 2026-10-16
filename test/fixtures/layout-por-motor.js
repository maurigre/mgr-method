// Converte uma instalacao ATUAL (runtime unico em `.mgr-core/runtime/`) no layout da geracao
// anterior (uma copia do runtime por motor). Assim o teste de migracao parte de um estado real de
// hoje e nao depende de uma instalacao antiga guardada no repositorio.
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const RUNTIME_REL = [".mgr-core", "runtime"];
const ENTRY_REL = ["bin", "mgr-runtime.js"];
const ENTRY_ATUAL = ".mgr-core/runtime/bin/mgr-runtime.js";
const HOOK_MARKER = "mgr-session-hook";
const ARQUIVOS_DE_HOOK = [
  { arquivo: [".claude", "settings.local.json"], dirSkills: ".claude/skills" },
  { arquivo: [".github", "copilot", "settings.local.json"], dirSkills: ".github/skills" },
];

export function layoutPorMotor(repo, { model }) {
  const runtime = path.join(repo, ...RUNTIME_REL);
  if (!existsSync(runtime)) throw new Error(`fixture quebrada: ${runtime} nao existe antes de converter`);

  const manifestoPath = path.join(repo, ".mgr-core", "manifest.json");
  const manifesto = JSON.parse(readFileSync(manifestoPath, "utf8"));
  const dirs = manifesto.skillsDirs ?? (manifesto.skillsDir ? [manifesto.skillsDir] : []);

  for (const d of dirs) {
    cpSync(runtime, path.join(repo, d, "_shared", "mgr"), { recursive: true });
    for (const nome of readdirSync(path.join(repo, d))) {
      const skill = path.join(repo, d, nome, "SKILL.md");
      if (!existsSync(skill)) continue;
      const conteudo = readFileSync(skill, "utf8");
      writeFileSync(skill, conteudo.replaceAll(ENTRY_ATUAL, `${d}/_shared/mgr/${ENTRY_REL.join("/")}`), "utf8");
    }
  }

  const absolutoAntigo = path.join(runtime, ...ENTRY_REL);
  for (const { arquivo, dirSkills } of ARQUIVOS_DE_HOOK) {
    const alvo = path.join(repo, ...arquivo);
    if (!existsSync(alvo)) continue;
    const absolutoNovo = path.join(repo, dirSkills, "_shared", "mgr", ...ENTRY_REL);
    // Troca so dentro das linhas com o marcador: o hook do MGR fica numa linha so no JSON gerado.
    const linhas = readFileSync(alvo, "utf8").split("\n")
      .map((linha) => (linha.includes(HOOK_MARKER) ? linha.replaceAll(absolutoAntigo, absolutoNovo) : linha));
    writeFileSync(alvo, linhas.join("\n"), "utf8");
  }

  rmSync(runtime, { recursive: true, force: true });

  writeFileSync(manifestoPath, JSON.stringify({ ...manifesto, model }, null, 2) + "\n", "utf8");
}
