#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

LINKED="AGENTS.md TITLE_SYSTEM.md agents rules skills extensions lib"

# Keep the default profile untouched and preseed one named profile with a
# divergent config. The installer must refuse to replace a customized profile
# config while still linking everything else.
mkdir -p "$TMP/.omp/agent" "$TMP/.omp/profiles/commandcode/agent"
printf '%s\n' 'default sentinel' > "$TMP/.omp/agent/AGENTS.md"
printf '%s\n' 'modelRoles:' '  default: sentinel/model' > "$TMP/.omp/profiles/commandcode/agent/config.yml"
cp "$TMP/.omp/profiles/commandcode/agent/config.yml" "$TMP/divergent.before"

if HOME="$TMP" PATH="/usr/bin:/bin" "$ROOT/omp/bin/flow-omp" install >/dev/null 2>&1; then
  echo 'FAIL: installer accepted a divergent profile config' >&2
  exit 1
fi

cmp -s "$TMP/divergent.before" "$TMP/.omp/profiles/commandcode/agent/config.yml"
test ! -L "$TMP/.omp/profiles/commandcode/agent/config.yml"
for profile in openai-codex anthropic; do
  test -L "$TMP/.omp/profiles/$profile/agent/config.yml"
done
grep -q 'default sentinel' "$TMP/.omp/agent/AGENTS.md"

# An untouched copy that already matches its template becomes a symlink.
cp "$ROOT/omp/profiles/commandcode/config.yml" "$TMP/.omp/profiles/commandcode/agent/config.yml"

HOME="$TMP" PATH="/usr/bin:/bin" "$ROOT/omp/bin/flow-omp" install >/dev/null
HOME="$TMP" PATH="/usr/bin:/bin" "$ROOT/omp/bin/flow-omp" install >/dev/null

for profile in openai-codex anthropic commandcode; do
  for name in $LINKED config.yml; do
    test -L "$TMP/.omp/profiles/$profile/agent/$name"
  done
  cmp -s "$ROOT/omp/profiles/$profile/config.yml" "$TMP/.omp/profiles/$profile/agent/config.yml"
done

HOME="$TMP" PATH="/usr/bin:/bin" "$ROOT/omp/bin/flow-omp" verify >/dev/null

# Respect PI_CONFIG_DIR in fallback mode; named profiles intentionally do not use
# PI_CODING_AGENT_DIR.
TMP_CFG=$(mktemp -d)
HOME="$TMP_CFG" PI_CONFIG_DIR=.custom PI_CODING_AGENT_DIR="$TMP_CFG/ignored" PATH="/usr/bin:/bin" "$ROOT/omp/bin/flow-omp" install >/dev/null
test -L "$TMP_CFG/.custom/profiles/openai-codex/agent/skills"
test -L "$TMP_CFG/.custom/profiles/anthropic/agent/skills"
test -L "$TMP_CFG/.custom/profiles/commandcode/agent/skills"
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
HOME="$TMP_NATIVE" PATH="$TMP_NATIVE/bin:/usr/bin:/bin" "$ROOT/omp/bin/flow-omp" install >/dev/null
test -L "$TMP_NATIVE/native/openai-codex/agent/skills"
test -L "$TMP_NATIVE/native/anthropic/agent/skills"
test -L "$TMP_NATIVE/native/commandcode/agent/skills"
rm -rf "$TMP_NATIVE"

# Refuse to clobber a real managed-surface directory inside a managed profile.
TMP2=$(mktemp -d)
mkdir -p "$TMP2/.omp/profiles/commandcode/agent/skills"
if HOME="$TMP2" PATH="/usr/bin:/bin" "$ROOT/omp/bin/flow-omp" install >/dev/null 2>&1; then
  echo 'FAIL: installer overwrote/accepted real profile skills directory' >&2
  rm -rf "$TMP2"
  exit 1
fi
rm -rf "$TMP2"

# A managed destination that is a symlink outside this repository is refused
# and left as it was; a symlink into the repository is relinked.
TMP_LINK="$TMP/link-home"
mkdir -p "$TMP_LINK/.omp/profiles/anthropic/agent" "$TMP_LINK/elsewhere"
foreign="$TMP_LINK/.omp/profiles/anthropic/agent/skills"
ln -s "$TMP_LINK/elsewhere" "$foreign"
if out=$(HOME="$TMP_LINK" PATH="/usr/bin:/bin" "$ROOT/omp/bin/flow-omp" install 2>&1); then
  echo 'FAIL: installer replaced a symlink that points outside the repository' >&2
  exit 1
fi
[ "$(readlink "$foreign")" = "$TMP_LINK/elsewhere" ] || { echo 'FAIL: installer changed a foreign symlink' >&2; exit 1; }
case $out in
  *"$foreign is a symlink to $TMP_LINK/elsewhere"*) ;;
  *) echo "FAIL: refusal did not name the link and its target: $out" >&2; exit 1 ;;
esac
rm "$foreign"
ln -s "$ROOT/omp/rules" "$foreign"
HOME="$TMP_LINK" PATH="/usr/bin:/bin" "$ROOT/omp/bin/flow-omp" install >/dev/null
[ "$(readlink -f "$foreign")" = "$(readlink -f "$ROOT/omp/skills")" ] || { echo 'FAIL: installer did not relink a symlink into the repository' >&2; exit 1; }
# A relative link that climbs out of the repository and a dangling link are refused the same way.
for target in "../../../../../elsewhere" "$TMP_LINK/missing-target"; do
  rm "$foreign"
  ln -s "$target" "$foreign"
  if HOME="$TMP_LINK" PATH="/usr/bin:/bin" "$ROOT/omp/bin/flow-omp" install >/dev/null 2>&1; then
    echo "FAIL: installer replaced a symlink to $target" >&2
    exit 1
  fi
  [ "$(readlink "$foreign")" = "$target" ] || { echo "FAIL: installer changed the symlink to $target" >&2; exit 1; }
done

# An unresolvable profile, at any position, must make every command fail before
# anything is linked: no link at all, and no `linked` line.
TMP_BAD=$(mktemp -d)
mkdir -p "$TMP_BAD/bin"
cat > "$TMP_BAD/bin/omp" <<'SH'
#!/usr/bin/env sh
if [ "$2" = "$BAD_PROFILE" ]; then
  case $BAD_MODE in
    fail) exit 1 ;;
    empty) exit 0 ;;
    root) printf '/\n'; exit 0 ;;
    slashes) printf '//\n'; exit 0 ;;
  esac
fi
printf '%s/native/%s/agent\n' "$HOME" "$2"
SH
chmod +x "$TMP_BAD/bin/omp"
for mode in fail empty root slashes; do
  for bad in openai-codex anthropic commandcode; do
    for cmd in install verify doctor; do
      home="$TMP_BAD/home-$mode-$bad-$cmd"
      mkdir -p "$home"
      if out=$(BAD_MODE=$mode BAD_PROFILE=$bad HOME="$home" PATH="$TMP_BAD/bin:/usr/bin:/bin" "$ROOT/omp/bin/flow-omp" "$cmd" 2>&1); then
        echo "FAIL: $cmd succeeded with unresolvable profile $bad ($mode)" >&2
        exit 1
      fi
      case $out in
        *linked*) echo "FAIL: $cmd printed a link line with unresolvable profile $bad ($mode)" >&2; exit 1 ;;
        *"'$bad'"*) ;;
        *) echo "FAIL: $cmd did not name unresolvable profile $bad ($mode): $out" >&2; exit 1 ;;
      esac
      if [ -n "$(find "$home" -type l)" ]; then
        echo "FAIL: $cmd linked something with unresolvable profile $bad ($mode)" >&2
        exit 1
      fi
    done
  done
done
rm -rf "$TMP_BAD"
# Links into the checkout's previous name (omp-stack) are relinked, dangling or
# not; any other dangling link is still refused.
TMP_OLD=$(mktemp -d)
NEW="$TMP_OLD/flow-skills"; OLD="$TMP_OLD/omp-stack"
mkdir -p "$NEW/omp/bin" "$NEW/omp/agents" "$NEW/omp/rules" "$NEW/omp/skills" "$NEW/omp/extensions" "$NEW/omp/lib"
cp "$ROOT/omp/bin/flow-omp" "$NEW/omp/bin/flow-omp"
for name in AGENTS.md TITLE_SYSTEM.md keybindings.yml; do : > "$NEW/omp/$name"; done
for profile in openai-codex anthropic commandcode; do
  mkdir -p "$NEW/omp/profiles/$profile" "$TMP_OLD/home/.omp/profiles/$profile/agent"
  : > "$NEW/omp/profiles/$profile/config.yml"
done
mkdir -p "$TMP_OLD/home/.omp/agent" "$OLD/agent/rules"
H="$TMP_OLD/home"
for name in AGENTS.md TITLE_SYSTEM.md agents rules skills extensions lib; do
  ln -s "$OLD/agent/$name" "$H/.omp/profiles/anthropic/agent/$name"   # dangling except rules
done
ln -s "$OLD/profiles/anthropic/config.yml" "$H/.omp/profiles/anthropic/agent/config.yml"
ln -s "$OLD/agent/keybindings.yml" "$H/.omp/agent/keybindings.yml"
HOME=$H PATH="/usr/bin:/bin" "$NEW/omp/bin/flow-omp" install >/dev/null || { echo 'FAIL: installer refused links into the previous checkout name' >&2; exit 1; }
for name in AGENTS.md TITLE_SYSTEM.md agents rules skills extensions lib; do
  [ "$(readlink -f "$H/.omp/profiles/anthropic/agent/$name")" = "$(readlink -f "$NEW/omp/$name")" ] || { echo "FAIL: $name not relinked from the previous checkout name" >&2; exit 1; }
done
[ "$(readlink -f "$H/.omp/profiles/anthropic/agent/config.yml")" = "$(readlink -f "$NEW/omp/profiles/anthropic/config.yml")" ] || { echo 'FAIL: config.yml not relinked from the previous checkout name' >&2; exit 1; }
[ "$(readlink -f "$H/.omp/agent/keybindings.yml")" = "$(readlink -f "$NEW/omp/keybindings.yml")" ] || { echo 'FAIL: keybindings.yml not relinked from the previous checkout name' >&2; exit 1; }
HOME=$H PATH="/usr/bin:/bin" "$NEW/omp/bin/flow-omp" verify >/dev/null
# A dangling link anywhere else is still refused and left as it was.
H2="$TMP_OLD/home2"; mkdir -p "$H2/.omp/profiles/anthropic/agent"
ln -s "$TMP_OLD/elsewhere/skills" "$H2/.omp/profiles/anthropic/agent/skills"
if out=$(HOME=$H2 PATH="/usr/bin:/bin" "$NEW/omp/bin/flow-omp" install 2>&1); then echo 'FAIL: installer replaced a dangling link outside both checkout names' >&2; exit 1; fi
case $out in *"outside $(readlink -f "$NEW")"*) ;; *) echo "FAIL: refusal did not name the root: $out" >&2; exit 1 ;; esac
[ "$(readlink "$H2/.omp/profiles/anthropic/agent/skills")" = "$TMP_OLD/elsewhere/skills" ] || { echo 'FAIL: installer changed a foreign dangling link' >&2; exit 1; }
rm -rf "$TMP_OLD"
echo 'ok: profile installer safety/idempotence'
