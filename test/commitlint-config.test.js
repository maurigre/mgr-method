import { test } from "node:test";
import assert from "node:assert/strict";
import config from "../commitlint.config.js";

const regra = (nome) => config.plugins[0].rules[nome];
const aplicar = (nome, raw) => regra(nome)({ raw });

test("no-special-chars aceita a pontuacao que o header usa de verdade", () => {
  const [passou] = aplicar("no-special-chars", "feat: pontuacao legitima: docs/sdd, v0.7.0, P0.1, (nota), #23, _um");
  assert.equal(passou, true,
    "medido em 211 commits: `:` `-` `.` `/` `(` `)` `,` `#` `_` sao a pontuacao real; proibi-la reprovaria todo commit legitimo");
});

test("no-special-chars reprova letra acentuada, no header e no corpo", () => {
  assert.equal(aplicar("no-special-chars", "feat: le mapa de um nivel")[0], true);
  assert.equal(aplicar("no-special-chars", "feat: le mapa de um nivel")[0], true);
  assert.equal(aplicar("no-special-chars", "docs: registra a decisao")[0], true);
  assert.equal(aplicar("no-special-chars", "docs: registra a decisão")[0], false, "header");
  assert.equal(aplicar("no-special-chars", "feat: header limpo\n\nCorpo com decisão.\n")[0], false, "corpo");
});

test("no-special-chars reprova crase, que e ASCII mas e markdown", () => {
  const [passou, mensagem] = aplicar("no-special-chars", "feat: usa `crase` no header");
  assert.equal(passou, false,
    "o historico aprovado usa ZERO crases; 66 apareceram numa fatia antes desta regra existir");
  assert.match(mensagem, /crase/);
});

test("no-special-chars reprova emoji, travessao e aspas curvas", () => {
  for (const cru of ["fix: emoji \u{1F916}", "feat: travessao — aqui", "feat: aspas “abre”"]) {
    assert.equal(aplicar("no-special-chars", cru)[0], false, cru);
  }
});

test("a mensagem de erro NOMEIA o caractere achado", () => {
  const [, mensagem] = aplicar("no-special-chars", "feat: decisão com `crase`");
  assert.match(mensagem, /"ã"/, "sem o caractere na mensagem, quem escreveu tem de caca-lo no olho");
  assert.match(mensagem, /"`"/);
  assert.match(mensagem, /pontuacao do conventional commits segue permitida/,
    "dizer so o que e proibido faria a pessoa achar que pontuacao tambem e");
});

test("no-ai-mention segue reprovando atribuicao e passando o nome do motor", () => {
  assert.equal(aplicar("no-ai-mention", "feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>")[0], false);
  assert.equal(aplicar("no-ai-mention", "feat: x\n\nGenerated with Claude Code")[0], false);
  assert.equal(aplicar("no-ai-mention", "feat: o descritor do claude-code ganha um campo")[0], true,
    "nome de motor e caminho de diretorio sao legitimos, e o comentario da config declara isso");
});

test("as tres regras proprias estao ligadas como ERRO, nao aviso", () => {
  for (const nome of ["scope-empty", "body-leading-blank", "no-ai-mention", "no-special-chars"]) {
    assert.equal(config.rules[nome][0], 2, `${nome}: aviso nao e gate`);
  }
});
