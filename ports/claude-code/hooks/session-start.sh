#!/bin/sh
# Claude Code keeps only about 2 KB of hook output in context, so print the
# short core and point at the full instructions by absolute path.
root=${CLAUDE_PLUGIN_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
sed "s#FLOW_DOC#$root/hooks/flow-context.md#" "$root/hooks/flow-core.md"
