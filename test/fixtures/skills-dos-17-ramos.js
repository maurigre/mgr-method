import { checkSkill, validateSkill } from "../../src/validator.js";

const DESCRICAO_LONGA = "d".repeat(60);
const NOME_LONGO = "a".repeat(65);
const skillComCorpo = (corpo, nome = "foo") => `---\nname: ${nome}\ndescription: ${DESCRICAO_LONGA}\n${corpo}\n---\n`;

export const problemasDosDezesseteRamos = () => [
  ...checkSkill("foo", "sem frontmatter"),
  ...checkSkill("foo", "---\nname:\n  a: b\ndescription:\n  a: b\n---\n"),
  ...checkSkill("foo", `---\ndescription: ${DESCRICAO_LONGA}\n---\n`),
  ...checkSkill("foo", `---\nname: Foo Bar\ndescription: ${DESCRICAO_LONGA}\n---\n`),
  ...checkSkill(NOME_LONGO, skillComCorpo("", NOME_LONGO)),
  ...checkSkill("foo", "---\nname: foo\ndescription: curta\n---\n"),
  ...checkSkill("foo", `${skillComCorpo("")}${"\n".repeat(501)}`),
  ...checkSkill("foo", skillComCorpo("compatibility:\n  a: b")),
  ...checkSkill("foo", skillComCorpo(`compatibility: ${"c".repeat(501)}`)),
  ...checkSkill("foo", skillComCorpo("allowed-tools:\n  - Read")),
  ...checkSkill("foo", skillComCorpo("allowed-tools:\n  Read: sim")),
  ...checkSkill("foo", skillComCorpo("allowed-tools:")),
  ...checkSkill("foo", skillComCorpo("metadata:")),
  ...checkSkill("foo", skillComCorpo("metadata: texto")),
  ...checkSkill("foo", skillComCorpo("metadata:\n  - author: x")),
  ...validateSkill("nao-existe"),
];
