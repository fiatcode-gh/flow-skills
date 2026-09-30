#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

LINKED="AGENTS.md agents rules skills extensions lib"

# Keep the default profile untouched and preseed one named profile with a
# divergent config. The installer must refuse to replace a customized profile
# config while still linking everything else.
mkdir -p "$TMP/.omp/agent" "$TMP/.omp/profiles/ollama-cloud/agent"
printf '%s\n' 'default sentinel' > "$TMP/.omp/agent/AGENTS.md"
printf '%s\n' 'modelRoles:' '  default: sentinel/model' > "$TMP/.omp/profiles/ollama-cloud/agent/config.yml"
cp "$TMP/.omp/profiles/ollama-cloud/agent/config.yml" "$TMP/ollama.before"

if HOME="$TMP" PATH="/usr/bin:/bin" "$ROOT/scripts/omp-stack" install >/dev/null 2>&1; then
  echo 'FAIL: installer accepted a divergent profile config' >&2
  exit 1
fi

cmp -s "$TMP/ollama.before" "$TMP/.omp/profiles/ollama-cloud/agent/config.yml"
test ! -L "$TMP/.omp/profiles/ollama-cloud/agent/config.yml"
for profile in anthropic; do
  test -L "$TMP/.omp/profiles/$profile/agent/config.yml"
done
grep -q 'default sentinel' "$TMP/.omp/agent/AGENTS.md"

# An untouched copy that already matches its template becomes a symlink.
cp "$ROOT/profiles/ollama-cloud/config.yml" "$TMP/.omp/profiles/ollama-cloud/agent/config.yml"

HOME="$TMP" PATH="/usr/bin:/bin" "$ROOT/scripts/omp-stack" install >/dev/null
HOME="$TMP" PATH="/usr/bin:/bin" "$ROOT/scripts/omp-stack" install >/dev/null

for profile in ollama-cloud anthropic; do
  for name in $LINKED config.yml; do
    test -L "$TMP/.omp/profiles/$profile/agent/$name"
  done
  cmp -s "$ROOT/profiles/$profile/config.yml" "$TMP/.omp/profiles/$profile/agent/config.yml"
done

HOME="$TMP" PATH="/usr/bin:/bin" "$ROOT/scripts/omp-stack" verify >/dev/null

# Respect PI_CONFIG_DIR in fallback mode; named profiles intentionally do not use
# PI_CODING_AGENT_DIR.
TMP_CFG=$(mktemp -d)
HOME="$TMP_CFG" PI_CONFIG_DIR=.custom PI_CODING_AGENT_DIR="$TMP_CFG/ignored" PATH="/usr/bin:/bin" "$ROOT/scripts/omp-stack" install >/dev/null
test -L "$TMP_CFG/.custom/profiles/ollama-cloud/agent/skills"
test -L "$TMP_CFG/.custom/profiles/anthropic/agent/skills"
test ! -e "$TMP_CFG/ignored/skills"
rm -rf "$TMP_CFG"

# When OMP is available, resolve profile roots through native `omp --profile ... config path`.
TMP_NATIVE=$(mktemp -d)
mkdir -p "$TMP_NATIVE/bin"
cat > "$TMP_NATIVE/bin/omp" <<'SH'
#!/usr/bin/env sh
set -eu
[ "$1" = "--profile" ]
profile=$2
[ "$3" = "config" ]
[ "$4" = "path" ]
printf '%s/native/%s/agent\n' "$HOME" "$profile"
SH
chmod +x "$TMP_NATIVE/bin/omp"
HOME="$TMP_NATIVE" PATH="$TMP_NATIVE/bin:/usr/bin:/bin" "$ROOT/scripts/omp-stack" install >/dev/null
test -L "$TMP_NATIVE/native/ollama-cloud/agent/skills"
test -L "$TMP_NATIVE/native/anthropic/agent/skills"
rm -rf "$TMP_NATIVE"

# Refuse to clobber a real managed-surface directory inside a managed profile.
TMP2=$(mktemp -d)
mkdir -p "$TMP2/.omp/profiles/ollama-cloud/agent/skills"
if HOME="$TMP2" PATH="/usr/bin:/bin" "$ROOT/scripts/omp-stack" install >/dev/null 2>&1; then
  echo 'FAIL: installer overwrote/accepted real profile skills directory' >&2
  rm -rf "$TMP2"
  exit 1
fi
rm -rf "$TMP2"

echo 'ok: profile installer safety/idempotence'
