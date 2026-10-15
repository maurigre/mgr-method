import { inspectSdd } from "../sdd-check.js";

const CHAVE_DA_FALHA = {
  "no-dir": "sddCheckNoDir",
  "no-constitution": "sddCheckNoConstitution",
  empty: "sddCheckEmpty",
};

const linhaDoAviso = (M, { code, file }) => {
  if (code === "no-review-rules") return M.sddCheckNoReviewRules();
  if (code === "missing-canonical") return M.sddCheckMissingCanonical(file);
  return M.sddCheckOutOfList(file);
};

export function sddCheck({ root, io, M, flags, exists, listMd }) {
  const { ok, reason, dir, roles, warnings } = inspectSdd(root, { exists, listMd });

  if (flags?.json) {
    io.out(JSON.stringify({ schemaVersion: 1, ok, reason, dir, roles, warnings }, null, 2));
    return ok ? 0 : 1;
  }

  if (!ok) {
    io.err(M[CHAVE_DA_FALHA[reason]]());
    return 1;
  }

  warnings.forEach((aviso) => io.err(linhaDoAviso(M, aviso)));
  io.out(M.sddCheckOk(dir));
  return 0;
}
