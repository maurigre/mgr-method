import { test } from "node:test";
import assert from "node:assert/strict";
import { promptsNoIdioma } from "../src/prompts.js";
import { getMessages } from "../src/messages.js";

const CANCELADO = Symbol("cancelado");

function clackFalso({ respostas = [] } = {}) {
  const chamadas = { confirm: [], multiselect: [], select: [], avisos: [], ajustes: [], spinners: 0 };
  const fila = [...respostas];
  return {
    chamadas,
    confirm: async (opcoes) => { chamadas.confirm.push(opcoes); return true; },
    multiselect: async (opcoes) => { chamadas.multiselect.push(opcoes); return fila.shift(); },
    select: async (opcoes) => { chamadas.select.push(opcoes); return "x"; },
    text: async () => "x",
    isCancel: (valor) => valor === CANCELADO,
    log: { warn: (linha) => chamadas.avisos.push(linha) },
    updateSettings: (ajuste) => chamadas.ajustes.push(ajuste),
    spinner: () => { chamadas.spinners += 1; return {}; },
  };
}

for (const idioma of ["en", "pt-BR"]) {
  const tabela = getMessages(idioma);

  test(`should label confirm answers from the ${idioma} table instead of the library defaults`, async () => {
    const clack = clackFalso();
    await promptsNoIdioma(clack, () => tabela).confirm({ message: "m" });
    assert.equal(clack.chamadas.confirm[0].active, tabela.promptYes);
    assert.equal(clack.chamadas.confirm[0].inactive, tabela.promptNo);
  });

  test(`should replace the library key footer with the ${idioma} hint on select and multiselect`, async () => {
    const clack = clackFalso({ respostas: [["a"]] });
    const ask = promptsNoIdioma(clack, () => tabela);
    await ask.select({ message: "pergunta", options: [] });
    await ask.multiselect({ message: "pergunta", options: [], required: true });
    assert.equal(clack.chamadas.select[0].showInstructions, false);
    assert.equal(clack.chamadas.select[0].message, `pergunta\n${tabela.promptSelectHint}`);
    assert.equal(clack.chamadas.multiselect[0].showInstructions, false);
    assert.equal(clack.chamadas.multiselect[0].message, `pergunta\n${tabela.promptMultiselectHint}`);
  });

  test(`should set the spinner cancel and error texts from the ${idioma} table before creating it`, () => {
    const clack = clackFalso();
    promptsNoIdioma(clack, () => tabela).spinner();
    assert.deepEqual(clack.chamadas.ajustes, [{ messages: { cancel: tabela.promptCancelled, error: tabela.promptFailed } }]);
    assert.equal(clack.chamadas.spinners, 1);
  });

  test(`should ask again with the ${idioma} warning when a required multiselect comes back empty`, async () => {
    const clack = clackFalso({ respostas: [[], ["claude-code"]] });
    const escolha = await promptsNoIdioma(clack, () => tabela).multiselect({ message: "m", required: true, options: [] });
    assert.deepEqual(escolha, ["claude-code"]);
    assert.deepEqual(clack.chamadas.avisos, [tabela.promptSelectAtLeastOne]);
    assert.ok(clack.chamadas.multiselect.every((opcoes) => opcoes.required === false), "the library English validation never runs");
  });
}

test("should read the table at call time so a language refined after building the adapter is used", async () => {
  const clack = clackFalso();
  let tabela = getMessages("en");
  const ask = promptsNoIdioma(clack, () => tabela);
  tabela = getMessages("pt-BR");
  await ask.confirm({ message: "m" });
  assert.equal(clack.chamadas.confirm[0].active, "Sim");
});

test("should let the caller override the confirm labels", async () => {
  const clack = clackFalso();
  await promptsNoIdioma(clack, () => getMessages("en")).confirm({ message: "m", active: "Install", inactive: "Skip" });
  assert.equal(clack.chamadas.confirm[0].active, "Install");
});

test("should return a cancelled required multiselect without asking again", async () => {
  const clack = clackFalso({ respostas: [CANCELADO] });
  const escolha = await promptsNoIdioma(clack, () => getMessages("en")).multiselect({ message: "m", required: true, options: [] });
  assert.equal(escolha, CANCELADO);
  assert.equal(clack.chamadas.multiselect.length, 1);
  assert.deepEqual(clack.chamadas.avisos, []);
});

test("should ask an explicitly optional multiselect once and accept an empty answer", async () => {
  const clack = clackFalso({ respostas: [[]] });
  const escolha = await promptsNoIdioma(clack, () => getMessages("en")).multiselect({ message: "m", options: [], required: false });
  assert.deepEqual(escolha, []);
  assert.equal(clack.chamadas.multiselect.length, 1);
  assert.deepEqual(clack.chamadas.avisos, []);
});

test("should treat a multiselect without required as required, like the library does", async () => {
  const clack = clackFalso({ respostas: [[], ["copilot"]] });
  const escolha = await promptsNoIdioma(clack, () => getMessages("en")).multiselect({ message: "m", options: [] });
  assert.deepEqual(escolha, ["copilot"]);
  assert.equal(clack.chamadas.avisos.length, 1);
});
