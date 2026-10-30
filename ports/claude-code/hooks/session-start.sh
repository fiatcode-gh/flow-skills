#!/bin/sh
# Claude Code keeps only about 2 KB of hook output in context, so print the
# short core and point at the full instructions by absolute path.
root=${CLAUDE_PLUGIN_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
sed "s#FLOW_DOC#$root/hooks/flow-context.md#" "$root/hooks/flow-core.md"
# State the Weft setup as fact, so the model does not guess it.
if [ -z "${WEFT_GRAPH:-}" ]; then
  echo '- Weft: not configured (`WEFT_GRAPH` is unset). Skip the Weft steps.'
elif [ -n "${WEFT_GRAPH_REPO:-}" ]; then
  echo "- Weft: configured, cloud graph \`$WEFT_GRAPH_REPO\` at \`$WEFT_GRAPH\`. \`weft_guard\` clones it on first use."
else
  echo "- Weft: configured, local graph at \`$WEFT_GRAPH\`."
fi
