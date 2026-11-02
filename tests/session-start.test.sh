#!/usr/bin/env sh
# Runs the Claude Code SessionStart hook the way Claude Code does, with a
# CLAUDE_PLUGIN_ROOT that is a drive-letter path under Git Bash on Windows.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

root="$ROOT/claude-code"
if command -v cygpath >/dev/null 2>&1; then root=$(cygpath -m "$root"); fi

contains() { case "$1" in *"$2"*) ;; *) fail "$3: missing $2" ;; esac; }

out=$(WEFT_GRAPH= CLAUDE_PLUGIN_ROOT="$root" sh "$ROOT/claude-code/hooks/session-start.sh")
contains "$out" '# Flow (flow-skills)' 'unset graph'
contains "$out" "$root/hooks/flow-context.md" 'unset graph'
contains "$out" 'Weft: not configured' 'unset graph'

out=$(WEFT_GRAPH=/g WEFT_GRAPH_REPO= CLAUDE_PLUGIN_ROOT="$root" sh "$ROOT/claude-code/hooks/session-start.sh")
contains "$out" 'local graph at `/g`' 'local graph'

out=$(WEFT_GRAPH=/g WEFT_GRAPH_REPO=o/r CLAUDE_PLUGIN_ROOT="$root" sh "$ROOT/claude-code/hooks/session-start.sh")
contains "$out" 'cloud graph `o/r`' 'cloud graph'

echo 'ok: session-start hook'
