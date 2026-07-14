// Coleta interativa das respostas do `install`.
// O adaptador de prompts (`ask`) é INJETADO — o CLI passa o do @clack, os testes passam um
// stub. Assim a lógica das perguntas fica testável sem TTY, e o bin/ fica só com a cola.
import path from "node:path";
import * as catalog from "./catalog.js";

export const CANCELLED = Symbol("cancelled");

// ask: { multiselect, select, confirm, text, isCancel }
// current: valores já vindos das flags (não perguntamos o que já foi informado)
export async function collectInstallAnswers(ask, current = {}, { repo = ".", allSkills = false } = {}) {
  const out = {
    engines: current.engines?.length ? current.engines : [],
    scope: current.scope || null,
    language: current.language || null,
    architecture: current.architecture || null,
    projectId: current.projectId || null,
    optional: [],
  };

  if (!out.engines.length) {
    const sel = await ask.multiselect({
      message: "Quais motores devem receber as skills? (espaço marca, enter confirma)",
      options: [
        { value: "claude-code", label: "Claude Code", hint: ".claude/skills" },
        { value: "copilot", label: "GitHub Copilot", hint: ".github/skills" },
      ],
      initialValues: ["claude-code"],
      required: true,
    });
    if (ask.isCancel(sel)) return CANCELLED;
    out.engines = sel;
  }

  if (!out.scope) {
    const s = await ask.select({
      message: "Escopo da instalação?",
      options: [
        { value: "project", label: "project", hint: "neste repositório" },
        { value: "global", label: "global", hint: "para todos os projetos (home)" },
      ],
    });
    if (ask.isCancel(s)) return CANCELLED;
    out.scope = s;
  }

  if (!allSkills && !out.architecture) {
    const a = await ask.select({
      message: "Arquitetura do projeto? (define qual skill arch-* instalar)",
      options: catalog.architectures().map((k) => ({ value: k, label: k })),
      initialValue: "hexagonal",
    });
    if (ask.isCancel(a)) return CANCELLED;
    out.architecture = a;
  }

  if (!allSkills && !out.language) {
    const l = await ask.select({
      message: "Linguagem principal? (define helpers específicos)",
      options: [
        ...catalog.languages().map((k) => ({ value: k, label: k })),
        { value: "outra", label: "outra / não especificar", hint: "sem helpers de linguagem" },
      ],
      initialValue: catalog.languages()[0],
    });
    if (ask.isCancel(l)) return CANCELLED;
    out.language = l === "outra" ? null : l;
  }

  if (!allSkills) {
    const ev = await ask.confirm({
      message: "Incluir a skill opcional evidence-capture?",
      initialValue: false,
    });
    if (ask.isCancel(ev)) return CANCELLED;
    if (ev) out.optional.push("evidence-capture");
  }

  if (!out.projectId) {
    const base = path.basename(path.resolve(repo));
    const pid = await ask.text({
      message: "MGR_PROJECT_ID (identificador do projeto para a memória do mgr-code)?",
      initialValue: base,
      placeholder: base,
    });
    if (ask.isCancel(pid)) return CANCELLED;
    out.projectId = (pid || base).trim();
  }

  return out;
}
