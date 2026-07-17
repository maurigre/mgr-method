// Coleta interativa das respostas do `install`.
// O adaptador de prompts (`ask`) é INJETADO — o CLI passa o do @clack, os testes passam um
// stub. Assim a lógica das perguntas fica testável sem TTY, e o bin/ fica só com a cola.
import path from "node:path";
import * as catalog from "./catalog.js";
import { getMessages } from "./messages.js";

export const CANCELLED = Symbol("cancelled");

// Sugere o idioma do usuário a partir do locale do ambiente (LC_ALL > LC_MESSAGES > LANG).
// `xx_YY.enc` vira `xx-YY`; ausente, `C` ou `POSIX` viram "en". Recebe o env por parâmetro
// (o núcleo não lê ambiente global; a borda passa process.env).
export function detectUserLanguage(env = {}) {
  const raw = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  const base = raw.split(/[.@]/)[0].trim();
  if (!base || base === "C" || base === "POSIX") return "en";
  return base.replaceAll("_", "-");
}

// ask: { multiselect, select, confirm, text, isCancel }
// current: valores já vindos das flags (não perguntamos o que já foi informado)
// msg: tabela de mensagens (getMessages) — injetada pela borda, como o ask
export async function collectInstallAnswers(ask, current = {}, { repo = ".", allSkills = false, env = {}, msg = getMessages("en") } = {}) {
  const out = {
    engines: current.engines?.length ? current.engines : [],
    scope: current.scope || null,
    language: current.language || null,
    architecture: current.architecture || null,
    userLanguage: current.userLanguage || null,
    projectId: current.projectId || null,
    optional: [],
  };

  if (!out.engines.length) {
    const sel = await ask.multiselect({
      message: msg.qEngines,
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
      message: msg.qScope,
      options: [
        { value: "project", label: "project", hint: msg.scopeProjectHint },
        { value: "global", label: "global", hint: msg.scopeGlobalHint },
      ],
    });
    if (ask.isCancel(s)) return CANCELLED;
    out.scope = s;
  }

  if (!allSkills && !out.architecture) {
    const a = await ask.select({
      message: msg.qArchitecture,
      options: catalog.architectures().map((k) => ({ value: k, label: k })),
      initialValue: "hexagonal",
    });
    if (ask.isCancel(a)) return CANCELLED;
    out.architecture = a;
  }

  if (!allSkills && !out.language) {
    const l = await ask.select({
      message: msg.qLanguage,
      options: [
        ...catalog.languages().map((k) => ({ value: k, label: k })),
        { value: "outra", label: msg.langOtherLabel, hint: msg.langOtherHint },
      ],
      initialValue: catalog.languages()[0],
    });
    if (ask.isCancel(l)) return CANCELLED;
    out.language = l === "outra" ? null : l;
  }

  // Idioma da EXPERIÊNCIA (conversa e artefatos das skills) — não é a linguagem de
  // programação acima. Perguntado mesmo com --all-skills: é sobre o usuário, não sobre
  // o conjunto de skills.
  if (!out.userLanguage) {
    const detected = detectUserLanguage(env);
    const initial = detected.startsWith("en") ? "en" : detected.startsWith("pt") ? "pt-BR" : "outro";
    const ul = await ask.select({
      message: msg.qOutputLanguage,
      options: [
        { value: "en", label: "en", hint: msg.outEnHint },
        { value: "pt-BR", label: "pt-BR", hint: msg.outPtHint },
        { value: "outro", label: msg.outOtherLabel, hint: msg.outOtherHint },
      ],
      initialValue: initial,
    });
    if (ask.isCancel(ul)) return CANCELLED;
    if (ul === "outro") {
      const t = await ask.text({
        message: msg.qWhichLanguage,
        initialValue: detected,
        placeholder: detected,
      });
      if (ask.isCancel(t)) return CANCELLED;
      out.userLanguage = (t || detected).trim();
    } else {
      out.userLanguage = ul;
    }
  }

  if (!allSkills) {
    const ev = await ask.confirm({
      message: msg.qOptionalEvidence,
      initialValue: false,
    });
    if (ask.isCancel(ev)) return CANCELLED;
    if (ev) out.optional.push("evidence-capture");
  }

  if (!out.projectId) {
    const base = path.basename(path.resolve(repo));
    const pid = await ask.text({
      message: msg.qProjectId,
      initialValue: base,
      placeholder: base,
    });
    if (ask.isCancel(pid)) return CANCELLED;
    out.projectId = (pid || base).trim();
  }

  return out;
}
