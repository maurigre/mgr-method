import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmInTerminal, promptsNoIdioma } from "../../src/install/prompts.js";
import { getMessages } from "../../src/core/messages.js";

const CANCELADO = Symbol("cancelado");

const clackRespondendo = (resposta) => {
  const perguntas = [];
  return {
    perguntas,
    clack: {
      confirm: async (opcoes) => {
        perguntas.push(opcoes);
        return resposta;
      },
      isCancel: (valor) => valor === CANCELADO,
    },
  };
};

test("should answer no-tty without asking when there is no terminal", async () => {
  const { clack, perguntas } = clackRespondendo(true);
  assert.deepEqual(await confirmInTerminal(clack, false)("Ligar?"), { state: "no-tty" });
  assert.deepEqual(perguntas, []);
});

test("should answer yes only when the person confirms in the terminal", async () => {
  const { clack, perguntas } = clackRespondendo(true);
  assert.deepEqual(await confirmInTerminal(clack, true)("Ligar?"), { state: "yes" });
  assert.deepEqual(perguntas, [{ message: "Ligar?", initialValue: false }]);
});

test("should answer no when the person declines in the terminal", async () => {
  const { clack } = clackRespondendo(false);
  assert.deepEqual(await confirmInTerminal(clack, true)("Ligar?"), { state: "no" });
});

test("should answer no when the person cancels the question", async () => {
  const { clack } = clackRespondendo(CANCELADO);
  assert.deepEqual(await confirmInTerminal(clack, true)("Ligar?"), { state: "no" });
});

for (const idioma of ["en", "pt-BR"]) {
  test(`should ask with the yes and no labels of ${idioma} when given the localized prompts`, async () => {
    const { clack, perguntas } = clackRespondendo(true);
    const mensagens = getMessages(idioma);
    const localizado = promptsNoIdioma({ ...clack, updateSettings: () => {} }, () => mensagens);
    assert.deepEqual(await confirmInTerminal(localizado, true)("Ligar?"), { state: "yes" });
    assert.deepEqual(perguntas, [{ active: mensagens.promptYes, inactive: mensagens.promptNo, message: "Ligar?", initialValue: false }]);
  });
}
