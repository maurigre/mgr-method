#!/usr/bin/env bash
# Verifica os pré-requisitos do fluxo SDD num projeto (dependência do spec-create).
# Uso: sdd-check.sh [raiz-do-projeto]     RC 0 = pronto; RC 1 = falta algo (motivo no stderr)
set -eu
ROOT="${1:-.}"
fail() { echo "SDD INCOMPLETO: $1" >&2; exit 1; }
[ -d "$ROOT/docs/sdd" ] || fail "docs/sdd/ não existe — rode a skill spec-init primeiro"
[ -f "$ROOT/docs/sdd/CONSTITUTION.md" ] || fail "docs/sdd/CONSTITUTION.md ausente — rode spec-init e revise a constituição"
ls "$ROOT"/docs/sdd/*.md >/dev/null 2>&1 || fail "docs/sdd/ vazio"
if [ ! -f "$ROOT/docs/sdd/09-review-rules.md" ]; then
  echo "aviso: docs/sdd/09-review-rules.md ausente — code-analyzer operará sem guia do projeto" >&2
fi
echo "SDD OK: projeto inicializado ($ROOT/docs/sdd)"
