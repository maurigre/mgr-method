import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync, writeFileSync, cpSync } from "node:fs";
import {
  CHECKS,
  PROVA_FUNCIONA,
  PROVA_NAO_FUNCIONA,
  PROVA_NAO_MEDIDA,
  SEM_REMEDIACAO,
  FIX_UPDATE,
  NO_FIX,
} from "../src/doctor.js";
import { problemasDeCobertura, selecionaAchado, rodaTodosCasos, rodaUmCaso, casosDeTeste, relatorioDeCobertura } from "./fixtures/remediacoes.js";
import { ORFA } from "./fixtures/instalacao.js";

test("shouldProduceNoProblemWhenCheckAndCasesAreCoherent", () => {
  const checks = [
    {
      id: "check-one",
      remediacoes: [
        {
          condicao: "condicao-a",
          fix: FIX_UPDATE,
          prova: PROVA_FUNCIONA,
        },
      ],
    },
  ];

  const casos = [{ id: "check-one", condicao: "condicao-a" }];

  const problemas = problemasDeCobertura(checks, casos);
  assert.equal(problemas.length, 0, "valid sample produces no problems");
});

test("shouldReportRem1WhenCheckHasNoRemediations", () => {
  const checks = [
    {
      id: "check-without",
    },
  ];

  const casos = [];

  const problemas = problemasDeCobertura(checks, casos);
  assert.equal(problemas.length, 1, "entry without remediacoes is reported");
  assert.match(
    problemas[0],
    /^REM-1 check-without: entrada sem remediacoes declaradas/,
    "REM-1 format is correct"
  );
});

test("shouldReportRem1WhenCheckHasEmptyRemediations", () => {
  const checks = [
    {
      id: "check-empty",
      remediacoes: [],
    },
  ];

  const casos = [];

  const problemas = problemasDeCobertura(checks, casos);
  assert.equal(problemas.length, 1, "entry with empty remediacoes is reported");
  assert.match(
    problemas[0],
    /^REM-1 check-empty: entrada sem remediacoes declaradas/,
    "REM-1 format for empty list is correct"
  );
});

test("shouldReportRem2WhenMeasuredConditionHasNoCase", () => {
  const checks = [
    {
      id: "check-measured",
      remediacoes: [
        {
          condicao: "condicao-medida",
          fix: FIX_UPDATE,
          prova: PROVA_FUNCIONA,
        },
      ],
    },
  ];

  const casos = [];

  const problemas = problemasDeCobertura(checks, casos);
  assert.equal(
    problemas.length,
    1,
    "measured condition without case is reported"
  );
  assert.match(
    problemas[0],
    /^REM-2 check-measured\/condicao-medida: condicao declarada medida e sem caso no guarda/,
    "REM-2 format is correct"
  );
});

test("shouldNotReportProblemWhenProvaNotMeasuredHasNoCase", () => {
  const checks = [
    {
      id: "check-unmeasured",
      remediacoes: [
        {
          condicao: "condicao-nao-medida",
          fix: NO_FIX,
          prova: PROVA_NAO_MEDIDA,
          razao: "motivo claro",
        },
      ],
    },
  ];

  const casos = [];

  const problemas = problemasDeCobertura(checks, casos);
  assert.equal(
    problemas.length,
    0,
    "unmeasured proof does not require case in table"
  );
});

test("shouldReportRem3WhenCasePointsToNonexistentCondition", () => {
  const checks = [
    {
      id: "check-has-condicao-a",
      remediacoes: [
        {
          condicao: "condicao-a",
          fix: FIX_UPDATE,
          prova: PROVA_FUNCIONA,
        },
      ],
    },
  ];

  const casos = [
    { id: "check-has-condicao-a", condicao: "condicao-a" },
    { id: "check-has-condicao-a", condicao: "condicao-b" },
  ];

  const problemas = problemasDeCobertura(checks, casos);
  assert.equal(problemas.length, 1,
    "a amostra da caso para a condicao declarada de proposito: sem isso sairiam DOIS problemas, o "
    + "REM-2 da condicao sem caso junto com o REM-3, e o caso nao isolaria o que diz medir");
  assert.match(problemas[0], /^REM-3 /,
    "e o REM-3 que tem de acusar: caso apontando para condicao que o registro nao declara");
  assert.match(
    problemas[0],
    /^REM-3 check-has-condicao-a\/condicao-b: caso aponta para condicao que o registro nao declara/,
    "REM-3 format is correct"
  );
});

test("shouldReportRem4WhenProvaNotMeasuredMissingReason", () => {
  const checks = [
    {
      id: "check-unmeasured-no-reason",
      remediacoes: [
        {
          condicao: "condicao-x",
          fix: NO_FIX,
          prova: PROVA_NAO_MEDIDA,
        },
      ],
    },
  ];

  const casos = [];

  const problemas = problemasDeCobertura(checks, casos);
  assert.equal(
    problemas.some((p) => p.startsWith("REM-4")),
    true,
    "unmeasured condition without reason is reported as REM-4"
  );
});

test("shouldReportRem4WhenProvaNaoFuncionaMissingReason", () => {
  const checks = [
    {
      id: "check-not-working",
      remediacoes: [
        {
          condicao: "condicao-y",
          fix: FIX_UPDATE,
          prova: PROVA_NAO_FUNCIONA,
          candidato: "mgr update",
        },
      ],
    },
  ];

  const casos = [];

  const problemas = problemasDeCobertura(checks, casos);
  assert.equal(
    problemas.some((p) => p.startsWith("REM-4")),
    true,
    "prova-nao-funciona without reason is reported as REM-4"
  );
});

test("shouldReportRem4WhenProvaNaoFuncionaMissingCandidate", () => {
  const checks = [
    {
      id: "check-not-working-no-candidate",
      remediacoes: [
        {
          condicao: "condicao-z",
          fix: FIX_UPDATE,
          prova: PROVA_NAO_FUNCIONA,
          razao: "motivo",
        },
      ],
    },
  ];

  const casos = [];

  const problemas = problemasDeCobertura(checks, casos);
  assert.equal(
    problemas.some((p) => p.startsWith("REM-4")),
    true,
    "prova-nao-funciona without candidato is reported as REM-4"
  );
});

test("shouldReportRem5WhenSemRemediacacaoHasNonNullFix", () => {
  const checks = [
    {
      id: "check-no-fix-but-has-fix",
      remediacoes: [
        {
          condicao: "condicao-1",
          fix: FIX_UPDATE,
          prova: SEM_REMEDIACAO,
          razao: "motivo",
        },
      ],
    },
  ];

  const casos = [];

  const problemas = problemasDeCobertura(checks, casos);
  assert.equal(
    problemas.some((p) => p.startsWith("REM-5")),
    true,
    "sem-remediacao with non-null fix is reported as REM-5"
  );
});

test("shouldReportRem5WhenProvaNaoFuncionaHasNonNullFix", () => {
  const checks = [
    {
      id: "check-not-working-with-fix",
      remediacoes: [
        {
          condicao: "condicao-2",
          fix: FIX_UPDATE,
          prova: PROVA_NAO_FUNCIONA,
          razao: "motivo",
          candidato: "mgr other",
        },
      ],
    },
  ];

  const casos = [];

  const problemas = problemasDeCobertura(checks, casos);
  assert.equal(
    problemas.some((p) => p.startsWith("REM-5")),
    true,
    "prova-nao-funciona with non-null fix is reported as REM-5"
  );
});

test("shouldReportRem5WhenProvaFuncionaHasNullFix", () => {
  const checks = [
    {
      id: "check-working-no-fix",
      remediacoes: [
        {
          condicao: "condicao-3",
          fix: NO_FIX,
          prova: PROVA_FUNCIONA,
        },
      ],
    },
  ];

  const casos = [];

  const problemas = problemasDeCobertura(checks, casos);
  assert.equal(
    problemas.some((p) => p.startsWith("REM-5")),
    true,
    "prova-funciona with null fix is reported as REM-5"
  );
});

test("shouldThrowWhenSelecionaAchadoFindsZeroMatches", () => {
  const findings = [
    { check: "check-a", severity: "defect" },
    { check: "check-b", severity: "warning" },
  ];

  const identifica = (achado) => achado.check === "check-nonexistent";

  assert.throws(
    () => selecionaAchado(findings, identifica),
    /nenhum achado casou/,
    "zero matches throws with clear message"
  );
});

test("shouldThrowWhenSelecionaAchadoFindsTwoOrMoreMatches", () => {
  const findings = [
    { check: "check-a", severity: "defect" },
    { check: "check-a", severity: "warning" },
    { check: "check-b", severity: "defect" },
  ];

  const identifica = (achado) => achado.check === "check-a";

  assert.throws(
    () => selecionaAchado(findings, identifica),
    /2 achados casaram/,
    "two matches throws with count and reason"
  );
});

test("shouldReturnAchadoWhenSelecionaAchadoFindsExactlyOne", () => {
  const findings = [
    { check: "check-a", severity: "defect" },
    { check: "check-b", severity: "warning" },
    { check: "check-c", severity: "defect" },
  ];

  const identifica = (achado) => achado.check === "check-b";

  const achado = selecionaAchado(findings, identifica);
  assert.deepEqual(
    achado,
    { check: "check-b", severity: "warning" },
    "single match is returned"
  );
});

describe("runner", () => {
  test("shouldRunAllCasesAndProduceZeroProblems", async () => {
    const problemas = await rodaTodosCasos(casosDeTeste);
    assert.deepStrictEqual(problemas, [], problemas.join("\n"));
  });

  test("shouldPassCoverageCheckOnTestTable", () => {
    const problemas = problemasDeCobertura(CHECKS, casosDeTeste);
    assert.deepStrictEqual(problemas, [], problemas.join("\n"));
  });

  test("shouldProveThatRunnerExecutesTheStringDeclaredInTheRegistry", async () => {
  const recebidos = [];
  const espiao = (stringDoComando) => {
    recebidos.push(stringDoComando);
    return { sucesso: true };
  };

  const registroSintetico = [{
    id: "divergent-body",
    remediacoes: [{
      condicao: "skill-orfa",
      fix: null,
      prova: PROVA_NAO_FUNCIONA,
      candidato: "mgr version",
      razao: "registro sintetico do guarda do guarda",
    }],
  }];

  const caso = {
    id: "divergent-body",
    condicao: "skill-orfa",
    planta: (repo) => {
      const skills = path.join(repo, ".claude", "skills");
      const declaradas = JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8")).skills;
      cpSync(path.join(skills, declaradas[0]), path.join(skills, ORFA), { recursive: true });
      const arquivo = path.join(skills, ORFA, "SKILL.md");
      writeFileSync(arquivo, `${readFileSync(arquivo, "utf8")}\nlinha plantada\n`, "utf8");
    },
    identifica: (achado) => achado.check === "divergent-body" && achado.file.includes(ORFA),
  };

  await rodaUmCaso(caso, registroSintetico, espiao);

  assert.deepEqual(recebidos, ["mgr version"],
    "o runner tem de executar a STRING DECLARADA no registro, e nao um comando fixo: se alguem "
    + "trocar a execucao por `mgr update` fixo, o espiao recebe outra coisa e esta assercao fica "
    + "vermelha. Medido em 2026-09-24: sem esta prova, um teste que para no passo 4 passa igual com "
    + "o runner executando comando fixo, e portanto nao guarda nada");
});

  test("shouldSeparateWhatWasCheckedFromWhatWasNot", () => {
    const { conferidas, naoConferidas } = relatorioDeCobertura(CHECKS);
    assert.equal(conferidas.length, 16,
      "sao 16 condicoes conferidas, e nao 17: dizer 17 seria contar como verificada uma que nao foi");
    assert.deepEqual(naoConferidas.map((x) => `${x.id}/${x.condicao}`), ["lockfile-drift/travado-ausente"],
      "a nao medida aparece NOMEADA, senao 16 verdes seriam lidos como toda remediacao provada");
    assert.ok(naoConferidas[0].razao && naoConferidas[0].razao.length > 0,
      "nao medido so e estado legitimo quando a razao esta escrita");
  });

  test("shouldFailWhenThePredicateAlreadyMatchesBeforePlanting", async () => {
    const registroSintetico = [{
      id: "lockfile-drift",
      remediacoes: [{ condicao: "sem-lockfile", fix: null, prova: SEM_REMEDIACAO, razao: "sintetico" }],
    }];

    const caso = {
      id: "lockfile-drift",
      condicao: "sem-lockfile",
      planta: () => {},
      identifica: (achado) => achado.check === "lockfile-drift",
    };

    const problemas = await rodaUmCaso(caso, registroSintetico);

    assert.ok(problemas.some((p) => p.includes("passo 2")),
      "o passo 2 existe para pegar predicado que ja casa antes do plantio, ou plantio que nao "
      + "plantou: sem um caso que o exercite, removê-lo nao deixaria nada vermelho e os 16 casos "
      + "continuariam passando sem essa garantia");
  });
});
