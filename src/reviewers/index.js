// Registro de revisores externos (ADR-0036, K13; spec revisor-externo, DT-3). Mesmo padrão de
// `src/engines/index.js`: fichas são dados importados daqui, e a busca por id recusa com `UsageError`
// quando o revisor não existe.
import codex from "./codex.js";
import { UsageError } from "../core/errors.js";

const REVIEWERS = { codex };

export const ids = () => Object.keys(REVIEWERS).sort();

export function get(id) {
  if (!Object.hasOwn(REVIEWERS, id)) {
    throw new UsageError("reviewerUnknown", [id, ids()]);
  }
  return REVIEWERS[id];
}
