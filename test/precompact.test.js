import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ASSEMBLED, AUTO, MANUAL, NOTHING_IN_PROGRESS, REPEAT_WINDOW_MS, assemble, decide, decideFor, notice,
  persist, readStamp, writeStamp,
} from "../src/precompact.js";
import { get as engineDescriptor, ids as engineIds } from "../src/engines/index.js";

// A tabela da DT-2 da spec, afirmada célula a célula. Bloquear é a única coisa que esta fatia faz
// que pode custar trabalho do usuário, então é a que mais precisa de teste.
test("claude-code bloqueia no manual, e NÃO bloqueia no auto", () => {
  assert.deepEqual(decide({ engine: "claude-code", trigger: MANUAL, saved: true }),
    { block: true, repeated: false });
  assert.deepEqual(decide({ engine: "claude-code", trigger: AUTO, saved: true }),
    { block: false, repeated: false },
    "a doc diz que bloquear uma compactação de recuperação derruba a requisição em curso");
});

// `saved` é condição da REGRA, e não da borda. O default é o lado seguro de errar: quem não afirma
// ter gravado nada não ganha bloqueio.
test("sem hand-off em disco, bloquear não protege nada — nem no manual", () => {
  assert.deepEqual(decide({ engine: "claude-code", trigger: MANUAL }),
    { block: false, repeated: false },
    "obstruir o usuário prometendo um arquivo que não existe é pior que deixar compactar");
});

// Bloquear SEMPRE tiraria o `/compact` do usuário para sempre: pedir de novo bloquearia de novo.
test("quem insiste dentro da janela passa; fora dela, é recusa nova", () => {
  const agora = 1_000_000;
  const dentro = decide({
    engine: "claude-code", trigger: MANUAL, saved: true, blockedAt: agora - 1000, now: agora,
  });
  assert.equal(dentro.block, false, "já foi avisado e o estado já está em disco: insistir é decisão informada");
  assert.equal(dentro.repeated, true);

  const fora = decide({
    engine: "claude-code", trigger: MANUAL, saved: true, blockedAt: agora - REPEAT_WINDOW_MS - 1, now: agora,
  });
  assert.equal(fora.block, true, "compactação horas depois é situação nova, não insistência");
  assert.equal(fora.repeated, false);
});

test("recusa com carimbo no FUTURO não libera nada", () => {
  const agora = 1_000_000;
  const { block } = decide({
    engine: "claude-code", trigger: MANUAL, saved: true, blockedAt: agora + 60_000, now: agora,
  });
  assert.equal(block, true, "relógio adiantado não pode virar bypass do gate");
});

// A frase que `repeated` escolhe diz "você pediu de novo, e o hand-off está atual". No `auto`
// ninguém pediu, e sem gravar não há hand-off atual: afirmar qualquer das duas seria a saída mentindo.
test("insistência é só do manual que gravou, e carimbo recente não a inventa", () => {
  const agora = 1_000_000;
  const recente = { blockedAt: agora - 1000, now: agora };
  assert.equal(decide({ engine: "claude-code", trigger: AUTO, saved: true, ...recente }).repeated, false,
    "compactação automática dentro da janela não é alguém pedindo de novo");
  assert.equal(decide({ engine: "claude-code", trigger: MANUAL, saved: false, ...recente }).repeated, false,
    "sem nada gravado, dizer que o hand-off em disco está atual é afirmar arquivo que não existe");
});

test("o carimbo diz QUEM recusou, e o de outro motor não conta", () => {
  const core = diretorioTemporario();
  const agora = 1_000_000;
  assert.equal(writeStamp(core, { engine: "claude-code", now: agora }), true);
  assert.equal(readStamp(core, "claude-code"), agora);
  assert.equal(readStamp(core, "copilot"), null,
    "o arquivo é do projeto, e um projeto tem dois motores: a recusa de um não é insistência do outro");
});

test("copilot tem o evento e nunca bloqueia, nos dois gatilhos", () => {
  for (const trigger of [MANUAL, AUTO]) {
    assert.deepEqual(decide({ engine: "copilot", trigger, saved: true }),
      { block: false, repeated: false },
      "a doc classifica o evento como notification only");
  }
});

test("gatilho desconhecido não bloqueia em motor nenhum", () => {
  for (const id of engineIds()) {
    for (const trigger of ["", undefined, "Manual", "MANUAL", "compact", null]) {
      assert.equal(decide({ engine: id, trigger }).block, false,
        `${id}/${String(trigger)}: bloquear por engano custa a requisição em curso do usuário`);
    }
  }
});

test("a FORMA do bloqueio é dado do descritor, e não campo derivado da decisão", () => {
  assert.equal(engineDescriptor("claude-code").compaction.block, "exit-code",
    "o claude-code bloqueia por código de saída; o codex, quando entrar, bloqueia por campo de saída");
  assert.equal(engineDescriptor("copilot").compaction.block, null,
    "ter o evento e não poder impedir é estado próprio, e não ausência de evento");
});

test("motor desconhecido é recusado, e não tratado como motor sem evento", () => {
  assert.throws(() => decide({ engine: "cursor", trigger: MANUAL }), /unknown engine: cursor/);
});

// O terceiro estado — motor SEM evento de compactação — não tem motor instalado hoje que o
// exercite: antigravity e deep code, que o `docs/engine-hooks.md` registra nesse estado, ainda não
// são motores suportados. O que dá para afirmar agora é a invariante que impede o estado impossível,
// e que é o que torna o ramo alcançável quando eles entrarem.
test("nenhum motor declara bloqueio sem ter o evento", () => {
  for (const id of engineIds()) {
    const { event, block, notice: envelope } = engineDescriptor(id).compaction;
    assert.ok(event !== null || block === null,
      `${id}: bloquear evento inexistente faria o método gravar hook no vazio`);
    assert.ok(event !== null || envelope === null,
      `${id}: canal de aviso sem evento seria canal que nunca é usado`);
    assert.ok(block === null || envelope !== null,
      `${id}: declarar bloqueio sem canal deixaria o motivo fora do envelope que a plataforma lê`);
  }
});

// --- A montagem do hand-off (P1.4) ---

const diretorioTemporario = () => mkdtempSync(path.join(tmpdir(), "mgr-pc-"));

const task = (id, status) => [
  `### ${id} — task de teste`,
  `- **priority:** ${id.split(".")[0]}`,
  "- **depends_on:** []",
  "- **files:** [src/a.js]",
  "- **artifact:** 1 coisa declarada",
  "- **done_when:** pronto",
  "- **helper_skill:** none",
  `- **status:** ${status}`,
].join("\n");

function repoCom(features) {
  const repo = diretorioTemporario();
  for (const [slug, tasks] of Object.entries(features)) {
    const dir = path.join(repo, "specs", slug);
    mkdirSync(dir, { recursive: true });
    const plano = ["<!-- mgr-plan-format: 1 -->", `# Plano — ${slug}`, "", "## P1 — Core", "",
      ...tasks.map(([id, status]) => task(id, status))].join("\n\n");
    writeFileSync(path.join(dir, "04-plan.md"), `${plano}\n`, "utf8");
    writeFileSync(path.join(dir, "05-execution.md"), `# Execução — ${slug}\n`, "utf8");
  }
  return repo;
}

const doHook = { engine: "claude-code", trigger: AUTO };

test("com uma feature em andamento, o hand-off nomeia a próxima task", () => {
  const repo = repoCom({ alfa: [["P1.1", "done"], ["P1.2", "todo"]] });
  const montado = assemble(repo, doHook);
  assert.equal(montado.outcome, ASSEMBLED);
  assert.equal(montado.slug, "alfa");
  assert.equal(montado.destination, path.join("specs", "alfa", ".handoff.md"));
  assert.match(montado.text, /\*\*Próxima task:\*\* `P1\.2`/);
  assert.deepEqual(montado.others, []);
});

test("sem feature em andamento, NADA é montado", () => {
  assert.deepEqual(assemble(repoCom({ alfa: [["P1.1", "done"]] }), doHook),
    { outcome: NOTHING_IN_PROGRESS }, "plano todo concluído não é trabalho interrompido");
  assert.deepEqual(assemble(diretorioTemporario(), doHook),
    { outcome: NOTHING_IN_PROGRESS }, "repositório sem specs/");
});

test("plano que nunca declarou estado NÃO conta como interrompido", () => {
  const repo = diretorioTemporario();
  const dir = path.join(repo, "specs", "antigo");
  mkdirSync(dir, { recursive: true });
  const semEstado = task("P1.1", "todo").split("\n").filter((l) => !l.startsWith("- **status:**")).join("\n");
  writeFileSync(path.join(dir, "04-plan.md"),
    `<!-- mgr-plan-format: 1 -->\n# Plano\n\n## P1 — Core\n\n${semEstado}\n`, "utf8");
  assert.equal(assemble(repo, doHook).outcome, NOTHING_IN_PROGRESS,
    "senão todo plano antigo pareceria interrompido para sempre, e o hook gravaria sobre trabalho fechado");
});

test("com várias em andamento, nomeia as outras e DIZ como desempatou", () => {
  const repo = repoCom({
    alfa: [["P1.1", "todo"]],
    beta: [["P1.1", "todo"]],
  });
  // O desempate é por `05-execution.md` mais recente; o do beta é tocado depois.
  utimesSync(path.join(repo, "specs", "beta", "05-execution.md"), new Date(), new Date(Date.now() + 60_000));
  const montado = assemble(repo, doHook);
  assert.equal(montado.slug, "beta");
  assert.deepEqual(montado.others, ["alfa"]);
  assert.match(montado.text, /Havia mais de uma feature em andamento:.*`alfa`/);
  assert.match(montado.text, /é desempate,\s*não certeza/,
    "dizer que escolheu sem dizer que é desempate faria a retomada confiar demais");
});

test("a seção do que o hand-off NÃO sabe está sempre presente", () => {
  const repo = repoCom({ alfa: [["P1.1", "todo"]] });
  for (const trigger of [MANUAL, AUTO]) {
    for (const changedFiles of [[], ["src/a.js"]]) {
      const { text } = assemble(repo, { engine: "claude-code", trigger, changedFiles });
      assert.match(text, /### O que este hand-off NÃO sabe/);
      assert.match(text, /não vê a conversa/);
      assert.match(text, /abrir uma sessão nova/, "a sugestão de sessão nova é pedido explícito do autor");
    }
  }
});

test("no manual o texto NÃO diz que ninguém pediu, porque alguém pediu", () => {
  const repo = repoCom({ alfa: [["P1.1", "todo"]] });
  const doManual = assemble(repo, { engine: "copilot", trigger: MANUAL }).text;
  assert.match(doManual, /`copilot`/);
  assert.match(doManual, /\*\*Você pediu a compactação\*\*/);
  assert.ok(!doManual.includes("Não foi pedido por ninguém"),
    "tratar a intenção do usuário como acidente contraria a UC-2 do PRD");

  const doAuto = assemble(repo, { engine: "copilot", trigger: AUTO }).text;
  assert.match(doAuto, /gatilho `auto`/);
  assert.match(doAuto, /Não foi pedido por ninguém/);
});

test("gatilho ausente é dito DESCONHECIDO, e não inventado", () => {
  const repo = repoCom({ alfa: [["P1.1", "todo"]] });
  const { text } = assemble(repo, { engine: "claude-code", trigger: null });
  assert.match(text, /gatilho desconhecido \(o motor não o informou\)/);
  assert.ok(!text.includes("`null`"), "valor de JavaScript em texto para humano é vazamento");
});

test("o hand-off traz tasks fechadas e artefatos em disco", () => {
  const repo = repoCom({ alfa: [["P1.1", "done"], ["P1.2", "done"], ["P1.3", "todo"]] });
  const { text } = assemble(repo, doHook);
  assert.match(text, /2 com `status: done` declarado/, "sem isto a retomada não sabe de onde partir");
  assert.match(text, /\*\*Artefatos em disco:\*\*.*plan/);
});

test("com pendente bloqueada por dependência, o hand-off DIZ que não há próxima", () => {
  const repo = diretorioTemporario();
  const dir = path.join(repo, "specs", "travada");
  mkdirSync(dir, { recursive: true });
  const esperando = (id, alvo) =>
    task(id, "todo").replace("- **depends_on:** []", `- **depends_on:** [${alvo}]`);
  const plano = ["<!-- mgr-plan-format: 1 -->", "# Plano — travada", "", "## P1 — Core", "",
    esperando("P1.1", "P1.2"), esperando("P1.2", "P1.1")].join("\n\n");
  writeFileSync(path.join(dir, "04-plan.md"), `${plano}\n`, "utf8");
  writeFileSync(path.join(dir, "05-execution.md"), "# Execução\n", "utf8");

  const { outcome, text } = assemble(repo, doHook);
  assert.equal(outcome, ASSEMBLED, "trabalho travado é trabalho interrompido, e o hand-off vale");
  assert.match(text, /nenhuma está pronta; as pendentes esperam dependência/,
    "afirmar uma próxima task que o DAG não libera mandaria a retomada para a task errada");
});

// Com UMA pendente, contar quem declarou estado e descontar a oferecida dá o mesmo número de quem
// fechou — e foi por isso que o defeito passou. Com DUAS, os números divergem.
test("o número de fechadas vem de `status: done`, e não de quem declarou estado", () => {
  const repo = repoCom({ alfa: [["P1.1", "done"], ["P1.2", "todo"], ["P1.3", "todo"]] });
  const { text } = assemble(repo, doHook);
  assert.match(text, /3 no total, 1 com `status: done` declarado/,
    "o arquivo existe para a retomada confiar nele: afirmar progresso que o plano não declara o inutiliza");
});

// O terceiro estado, afirmado com descritor de mesa: é o que antigravity e deep code terão, e é o
// `done_when` que a P1.3 e a P1.6 declaram.
test("motor SEM evento de compactação nunca bloqueia, nem no manual", () => {
  const semEvento = { event: null, block: "exit-code" };
  assert.deepEqual(decideFor(semEvento, { trigger: MANUAL, saved: true }),
    { block: false, repeated: false },
    "bloquear evento que não existe faria o método gravar hook no vazio");
});

// `notice` é a função que decide SE o método fala. A guarda dela é o que impede um envelope vazio de
// ir para o stdout, e é o núcleo da DT-7 reescrita.
test("o envelope de aviso sai só quando há motor com canal E coisa a dizer", () => {
  const doBloqueio = JSON.parse(notice("claude-code", { deny: "motivo" }));
  assert.deepEqual(doBloqueio,
    { hookSpecificOutput: { hookEventName: "PreCompact", decision: "deny", reason: "motivo" } },
    "é o idioma que a doc documenta para bloquear este evento");
  assert.equal(doBloqueio.systemMessage, undefined, "sem mensagem, não se inventa campo vazio");

  assert.deepEqual(JSON.parse(notice("claude-code", { message: "aviso" })), { systemMessage: "aviso" });
  assert.equal(notice("claude-code", {}), null, "envelope vazio no stdout não avisa nada a ninguém");
  assert.equal(notice("copilot", { message: "aviso" }), null,
    "a doc classifica o evento do copilot como notification only: não há por onde falar");
  assert.equal(notice("copilot", { deny: "motivo" }), null);
});

test("`persist` cria quando não há, e ACRESCENTA quando já há", () => {
  const repo = repoCom({ alfa: [["P1.1", "todo"]] });
  const montado = assemble(repo, doHook);
  const primeiro = persist(repo, montado);
  assert.equal(primeiro.appended, false);

  const segundo = persist(repo, montado);
  assert.equal(segundo.appended, true, "o do agente é mais rico; sobrescrever perderia informação");
  const texto = readFileSync(primeiro.file, "utf8");
  assert.equal(texto.split("Hand-off automático").length - 1, 2);
  assert.match(texto, /\n---\n/);
});

test("arquivo modificado entra quando a borda o informa, e some quando não há", () => {
  const repo = repoCom({ alfa: [["P1.1", "todo"]] });
  assert.match(assemble(repo, { ...doHook, changedFiles: ["src/a.js"] }).text, /- `src\/a\.js`/);
  assert.ok(!assemble(repo, doHook).text.includes("Modificados e não commitados"),
    "seção vazia é ruído, e ruído ensina a ignorar o arquivo");
});
