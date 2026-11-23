import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getMessages } from "../../src/core/messages.js";

const LANGS = ["en", "pt-BR"];
const SCALAR_ARGS = ["a", "b", "c", "d", "e"];
const LIST_ARGS = [["a", "b"], ["c"], ["d"], ["e"], ["f"]];
const ARG_SETS = [SCALAR_ARGS, LIST_ARGS];

function callOrMarker(fn, args) {
  try {
    return fn(...args);
  } catch (error) {
    return `<threw ${error.name}>`;
  }
}

function snapshotOf(table) {
  const out = {};
  for (const [key, value] of Object.entries(table)) {
    if (typeof value === "function") {
      out[key] = ARG_SETS.map((args) => callOrMarker(value, args));
    } else {
      out[key] = value;
    }
  }
  return out;
}

function renderedStrings(table) {
  const strings = [];
  for (const value of Object.values(table)) {
    if (typeof value === "string") {
      strings.push(value);
    } else if (typeof value === "function") {
      for (const args of ARG_SETS) {
        const result = callOrMarker(value, args);
        if (typeof result === "string" && !result.startsWith("<threw")) {
          strings.push(result);
        }
      }
    }
  }
  return strings;
}

test("should render the same messages when no invocation options are passed as with the mgr defaults", () => {
  for (const lang of LANGS) {
    const implicit = snapshotOf(getMessages(lang));
    const explicit = snapshotOf(getMessages(lang, { invocation: "mgr", lifecycle: "mgr" }));
    assert.deepEqual(implicit, explicit, `lang ${lang}`);
  }
});

test("should keep the literal mgr prefix in the effort note when invocation is the default", () => {
  const en = getMessages("en").agentsEffortNote;
  const pt = getMessages("pt-BR").agentsEffortNote;
  assert.match(en, /`mgr agents apply`/);
  assert.doesNotMatch(en, /`mgr update`/);
  assert.match(pt, /`mgr agents apply`/);
  assert.doesNotMatch(pt, /`mgr update`/);
});

test("should name the runtime invocation and the lifecycle command when they are passed", () => {
  for (const lang of LANGS) {
    const strings = renderedStrings(getMessages(lang, { invocation: "node X", lifecycle: "npx mgr-method@1.2.3" }));
    assert.equal(
      strings.some((text) => /`mgr [a-z]/.test(text)),
      false,
      `lang ${lang}: no message may keep a literal \`mgr <command>\``,
    );
    assert.ok(
      strings.some((text) => text.includes("node X spec validate")),
      `lang ${lang}: a message must name the runtime invocation`,
    );
    assert.ok(
      strings.some((text) => text.includes("npx mgr-method@1.2.3 update")),
      `lang ${lang}: a message must name the lifecycle command`,
    );
  }
});

test("should keep the effort note pointing at agents apply when the runtime invocation is passed", () => {
  const en = getMessages("en", { invocation: "node X" }).agentsEffortNote;
  const pt = getMessages("pt-BR", { invocation: "node X" }).agentsEffortNote;
  assert.match(en, /`node X agents apply`/);
  assert.match(pt, /`node X agents apply`/);
});

const BASELINE = JSON.parse(
  readFileSync(new URL("../fixtures/messages-baseline.json", import.meta.url), "utf8"),
);
const BASELINE_ARGS = [["a", "b", "c", "d"], [["x"], ["y"], 2, 3]];
const DELIBERADAS = ["agentsEffortNote", "agentsSetEffortEffect", "help", "planConfigHint", "agentsInheritWarning"];
const EFFORT_KEYS = ["agentsEffortNote", "agentsSetEffortEffect"];

function snapshotWithBaselineArgs(table) {
  const out = {};
  for (const [key, value] of Object.entries(table)) {
    if (typeof value === "function") {
      out[key] = BASELINE_ARGS.map((args) => {
        try {
          return String(value(...args));
        } catch (error) {
          return `THROWS:${error.name}`;
        }
      });
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

test("should keep every message key that the base snapshot has", () => {
  for (const lang of LANGS) {
    const current = snapshotWithBaselineArgs(getMessages(lang));
    const missing = Object.keys(BASELINE[lang]).filter((key) => !Object.hasOwn(current, key));
    assert.deepEqual(missing, [], `lang ${lang}: keys removed from the base`);
  }
});

test("should render every base message identically except the deliberate changes", () => {
  for (const lang of LANGS) {
    const current = snapshotWithBaselineArgs(getMessages(lang));
    for (const key of Object.keys(BASELINE[lang])) {
      if (DELIBERADAS.includes(key)) {
        continue;
      }
      assert.deepEqual(current[key], BASELINE[lang][key], `lang ${lang}: ${key} changed`);
    }
  }
});

test("should differ from the base effort messages only by the mgr update to agents apply rename", () => {
  for (const lang of LANGS) {
    const current = snapshotWithBaselineArgs(getMessages(lang));
    for (const key of EFFORT_KEYS) {
      const expected = BASELINE[lang][key].replaceAll("mgr update", "mgr agents apply");
      assert.deepEqual(current[key], expected, `lang ${lang}: ${key}`);
    }
  }
});

test("should keep every base help line present when the help message gains new lines", () => {
  for (const lang of LANGS) {
    const currentLines = new Set(getMessages(lang).help.split("\n"));
    const missing = BASELINE[lang].help.split("\n").filter((line) => !currentLines.has(line));
    assert.deepEqual(missing, [], `lang ${lang}: help lines removed from the base`);
  }
});

test("should say por padrão instead of the English default in the pt-BR inherit warning", () => {
  const aviso = getMessages("pt-BR").agentsInheritWarning("review");
  assert.match(aviso, /Nenhum modelo é publicado por padrão/);
  assert.doesNotMatch(aviso, /default/);
});

const campo = (value, state) => ({ value, state });

const LINHAS_INTEIRAS = {
  en: {
    agents: {
      configured: "  claude-code  model=opus (configured)  effort=opus (configured)",
      default: "  claude-code  model=opus (default)  effort=opus (default)",
      value: "  claude-code  model=opus  effort=opus",
      unsupported: "  claude-code  model=not supported by this engine  effort=not supported by this engine",
      inherited: "  claude-code  model=inherited from the session  effort=inherited from the session",
    },
    gateValue: "  copilot: model=opus effort=max",
    gateUnsupported: "  copilot: model=not supported by this engine effort=not supported by this engine",
    gateInherited: "  copilot: model=inherits the session model effort=session effort",
    statusGateInherited: "    copilot: model=inherits the session model effort=session effort",
    runtimeFonte: { answered: "answered; recorded in .mgr-core/config.json", recorded: "recorded in .mgr-core/config.json", default: "default, not recorded" },
    runtimeNaoVersionado: (fonte) => `MGR runtime in git → not versioned (${fonte}): .mgr-core/runtime/.gitignore ignores the folder`,
    runtimeVersionado: (fonte) => `MGR runtime in git → versioned (${fonte}): no ignore file in .mgr-core/runtime/`,
    gateOff: "  gate:    off (every intent disabled in `agents`)",
    leisLigado: "  laws:    session preamble: on (the central laws enter before the first message)",
    leisDesligado: "  laws:    session preamble: off (lawsPreamble.enabled = false)",
    semPermissoes: "permissions: none declared",
    comPermissoes: "permissions: network, fs",
  },
  "pt-BR": {
    agents: {
      configured: "  claude-code  modelo=opus (configurado)  esforço=opus (configurado)",
      default: "  claude-code  modelo=opus (padrão)  esforço=opus (padrão)",
      value: "  claude-code  modelo=opus  esforço=opus",
      unsupported: "  claude-code  modelo=não suportado por este motor  esforço=não suportado por este motor",
      inherited: "  claude-code  modelo=herdado da sessão  esforço=herdado da sessão",
    },
    gateValue: "  copilot: modelo=opus esforço=max",
    gateUnsupported: "  copilot: modelo=não suportado por este motor esforço=não suportado por este motor",
    gateInherited: "  copilot: modelo=herda o modelo da sessão esforço=esforço da sessão",
    statusGateInherited: "    copilot: modelo=herda o modelo da sessão esforço=esforço da sessão",
    runtimeFonte: { answered: "respondido; gravado em .mgr-core/config.json", recorded: "gravado em .mgr-core/config.json", default: "padrão, não gravado" },
    runtimeNaoVersionado: (fonte) => `Runtime do MGR no git → não versionado (${fonte}): .mgr-core/runtime/.gitignore ignora a pasta`,
    runtimeVersionado: (fonte) => `Runtime do MGR no git → versionado (${fonte}): sem arquivo de ignorar em .mgr-core/runtime/`,
    gateOff: "  gate:    desligado (todas as intenções desligadas em `agents`)",
    leisLigado: "  leis:    preâmbulo de sessão: ligado (as leis centrais entram antes da primeira mensagem)",
    leisDesligado: "  leis:    preâmbulo de sessão: desligado (lawsPreamble.enabled = false)",
    semPermissoes: "permissões:  nenhuma declarada",
    comPermissoes: "permissões:  network, fs",
  },
};

for (const idioma of LANGS) {
  const tabela = getMessages(idioma);
  const esperado = LINHAS_INTEIRAS[idioma];

  test(`should render every agents field state as one whole line in ${idioma}`, () => {
    for (const [estado, linha] of Object.entries(esperado.agents)) {
      const valor = campo("opus", estado);
      assert.equal(tabela.agentsEngineLine("claude-code", valor, valor), linha);
    }
  });

  test(`should render every gate field state as one whole line in ${idioma}`, () => {
    assert.equal(tabela.planGateEngineLine("copilot", campo("opus", "value"), campo("max", "value")), esperado.gateValue);
    assert.equal(tabela.planGateEngineLine("copilot", campo(undefined, "unsupported"), campo(undefined, "unsupported")), esperado.gateUnsupported);
    assert.equal(tabela.planGateEngineLine("copilot", campo(undefined, "inherited"), campo(undefined, "inherited")), esperado.gateInherited);
    assert.equal(tabela.statusGateEngineLine("copilot", campo(undefined, "inherited"), campo(undefined, "inherited")), esperado.statusGateInherited);
  });

  test(`should render every runtime plan value and source as one whole line in ${idioma}`, () => {
    for (const [fonte, texto] of Object.entries(esperado.runtimeFonte)) {
      assert.equal(tabela.planRuntimeLine("unversioned", fonte), esperado.runtimeNaoVersionado(texto));
      assert.equal(tabela.planRuntimeLine("versioned", fonte), esperado.runtimeVersionado(texto));
    }
  });

  test(`should render the status and plugin lines as whole lines in ${idioma}`, () => {
    assert.equal(tabela.statusGateOffLine, esperado.gateOff);
    assert.equal(tabela.statusLawsLine(true), esperado.leisLigado);
    assert.equal(tabela.statusLawsLine(false), esperado.leisDesligado);
    assert.equal(tabela.pluginProposalPermissionsLine([]), esperado.semPermissoes);
    assert.equal(tabela.pluginProposalPermissionsLine(["network", "fs"]), esperado.comPermissoes);
  });
}
