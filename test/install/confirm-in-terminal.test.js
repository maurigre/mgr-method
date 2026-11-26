import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmInTerminal } from "../../src/install/prompts.js";

const CANCELADO = Symbol("cancelado");

const clackRespondendo = (resposta) => {
  const perguntas = [];
  return {
    perguntas,
    clack: {
      confirm: async ({ message }) => {
        perguntas.push(message);
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
  assert.deepEqual(perguntas, ["Ligar?"]);
});

test("should answer no when the person declines in the terminal", async () => {
  const { clack } = clackRespondendo(false);
  assert.deepEqual(await confirmInTerminal(clack, true)("Ligar?"), { state: "no" });
});

test("should answer no when the person cancels the question", async () => {
  const { clack } = clackRespondendo(CANCELADO);
  assert.deepEqual(await confirmInTerminal(clack, true)("Ligar?"), { state: "no" });
});
