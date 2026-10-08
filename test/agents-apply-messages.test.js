import { test } from "node:test";
import assert from "node:assert/strict";
import { getMessages } from "../src/messages.js";

const FILE = ".claude/agents/mgr-task.md";
const VERSION = "1.2.3";

for (const lang of ["en", "pt-BR"]) {
  const msgs = getMessages(lang);

  test(`[${lang}] should point to the npx update command when the agent file is missing`, () => {
    const text = msgs.agentsApplyMissing(FILE, VERSION);
    assert.ok(text.includes(`npx mgr-method@${VERSION} update`));
    assert.ok(text.includes(FILE));
  });

  test(`[${lang}] should name the file and the mgr-managed-agent marker when the agent is not owned`, () => {
    const text = msgs.agentsApplyNotOwned(FILE);
    assert.ok(text.includes(FILE));
    assert.ok(text.includes("mgr-managed-agent"));
  });

  test(`[${lang}] should name the file when announcing the frontmatter rewrite`, () => {
    assert.ok(msgs.agentsApplyWriting(FILE).includes(FILE));
  });

  test(`[${lang}] should name the file when confirming the frontmatter rewrite`, () => {
    assert.ok(msgs.agentsApplyWritten(FILE).includes(FILE));
  });

  test(`[${lang}] should use different texts for the writing and written messages`, () => {
    assert.notEqual(msgs.agentsApplyWriting(FILE), msgs.agentsApplyWritten(FILE));
  });
}
