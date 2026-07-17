#!/usr/bin/env bash
# Checks the SDD flow prerequisites in a project (spec-create dependency).
# Usage: sdd-check.sh [project-root]     RC 0 = ready; RC 1 = something missing (reason on stderr)
set -eu
ROOT="${1:-.}"
fail() { echo "SDD INCOMPLETE: $1" >&2; exit 1; }
[ -d "$ROOT/docs/sdd" ] || fail "docs/sdd/ does not exist — run the spec-init skill first"
[ -f "$ROOT/docs/sdd/CONSTITUTION.md" ] || fail "docs/sdd/CONSTITUTION.md missing — run spec-init and review the constitution"
ls "$ROOT"/docs/sdd/*.md >/dev/null 2>&1 || fail "docs/sdd/ is empty"
if [ ! -f "$ROOT/docs/sdd/09-review-rules.md" ]; then
  echo "warning: docs/sdd/09-review-rules.md missing — code-analyzer will operate without the project guide" >&2
fi
echo "SDD OK: project initialized ($ROOT/docs/sdd)"
