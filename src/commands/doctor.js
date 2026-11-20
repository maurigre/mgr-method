// Cola do comando `mgr doctor`. Humble Object: só formatação e exit code; o IO entra por `io` e a
// raiz por `root`. O diagnóstico vive em src/doctor.js.
import * as bundle from "../bundle.js";
import * as diag from "../doctor.js";
import { renderText } from "../ui-text.js";

// O runtime copiado para o projeto (`bin/mgr-runtime.js`) chama `doctor(base)` sem dizer se o pacote
// esta junto, e a copia nao leva `skills/` nem `shared/`. Em vez de editar o runtime, o comando
// pergunta ao proprio `bundle`: se os dois recursos resolvem, ha fontes; se `pkgDir` lanca, nao ha.
// So o erro de recurso ausente e engolido, e e esse o fato que se quer saber.
function temFontes() {
  try {
    bundle.skillsDir();
    bundle.sharedDir();
    return true;
  } catch {
    return false;
  }
}

// O `fix` de CHECKS fica como contrato (`check:checks` o confere); so a formatacao troca o prefixo
// `mgr ` pelo comando de ciclo de vida de quem chama (DT-15): no runtime nao ha `mgr` no PATH.
const comCicloDeVida = (fix, lifecycle) =>
  fix.startsWith("mgr ") ? `${lifecycle} ${fix.slice("mgr ".length)}` : fix;

// O descritor de `doctorResolvaCom` carrega o comando canonico (`mgr update`); a cola so troca o
// prefixo pelo ciclo de vida de quem chama, como faz com o `fix` dos achados.
const renderizaRemedio = (M, descritor, lifecycle) =>
  descritor.key === "doctorResolvaCom"
    ? M.doctorResolvaCom(comCicloDeVida(descritor.params[0], lifecycle))
    : renderText(M, descritor);

const imprimeProblemasERemedio = (io, M, manifesto) => {
  for (const problema of manifesto.problems) io.out(renderText(M, diag.problemText(problema)));
  for (const descritor of diag.manifestRemedyText(manifesto)) io.out(renderizaRemedio(M, descritor, io.lifecycle));
};

// `mgr doctor` — diz se a instalacao esta INTEGRA, e nao so o que esta instalada (U2).
//
// **Nao escreve nada, em nenhum modo.** Nao ha `--fix`: a maioria das correcoes era rodar o
// `mgr update`, e chama-lo passaria `-y` pela pessoa. O comando nomeia a remediacao; a acao e dela.
export function doctor({ root, flags, io, M }) {
  const repo = root;
  const resultado = diag.diagnose(repo, temFontes() ? {} : { sources: null });

  const bloqueia = diag.blocks(resultado);
  const envelope = () => JSON.stringify({ schemaVersion: 1, blocks: bloqueia, ...resultado }, null, 2);

  if (resultado.outcome === diag.NO_INSTALL) {
    io.out(flags.json ? envelope() : M.doctorSemInstalacao);
    return 0;
  }

  if (resultado.outcome === diag.INVALID_MANIFEST) {
    if (flags.json) {
      io.out(envelope());
      return 2;
    }
    const { file, state } = resultado.manifest;
    const cabecalho = state === "unreadable" ? M.doctorManifestoIlegivel(file) : M.doctorManifestoInvalido(file);
    io.out(io.style.red(cabecalho));
    imprimeProblemasERemedio(io, M, resultado.manifest);
    return 2;
  }

  if (flags.json) {
    io.out(envelope());
    return bloqueia ? 1 : 0;
  }

  const cor = { [diag.DEFECT]: io.style.red, [diag.WARNING]: io.style.yellow, [diag.UNAVAILABLE]: io.style.dim };
  for (const achado of resultado.findings) {
    const { check, severity, file, fix } = achado;
    const descritores = diag.findingText(achado);
    io.out(cor[severity](`${severity === diag.DEFECT ? "x" : "!"} ${check} — ${file}`));
    io.out(M.doctorEsperado(renderText(M, descritores.expected)));
    io.out(M.doctorEncontrado(renderText(M, descritores.found)));
    io.out(fix ? M.doctorResolvaCom(comCicloDeVida(fix, io.lifecycle)) : io.style.dim(M.doctorSemCorrecao));
  }

  if (resultado.manifest) {
    io.out(io.style.red(M.doctorManifestoCamposForaDeForma(resultado.manifest.file)));
    imprimeProblemasERemedio(io, M, resultado.manifest);
  }

  io.out("");
  io.out(M.doctorResumo(resultado.checks, resultado.findings.length));
  io.out(M.doctorNaoAtesta);
  return bloqueia ? 1 : 0;
}
