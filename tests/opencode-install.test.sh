#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PORT="$ROOT/ports/opencode"
FLOW="$PORT/bin/flow-opencode"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
unset XDG_CONFIG_HOME

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

[ -x "$FLOW" ] || fail "$FLOW is missing or not executable"
[ -d "$PORT/skills" ] || fail "$PORT/skills is missing (task 02 is the prerequisite)"

# Run the installer under a clean HOME and a PATH with no opencode on it.
flow() { HOME=$H PATH="/usr/bin:/bin" "$FLOW" "$@"; }
count_lines() { printf '%s\n' "$1" | grep -c -- "$2" || true; }

CFG_REL=.config/opencode
first_two=$(ls "$PORT/skills" | sed -n '1,2p')
SKILL1=$(printf '%s\n' "$first_two" | sed -n 1p)
SKILL2=$(printf '%s\n' "$first_two" | sed -n 2p)

# 1. Fresh install links exactly the five destinations.
H="$TMP/h1"; mkdir -p "$H"
out=$(flow install 2>&1) || fail 'fresh install failed'
CFG="$H/$CFG_REL"
for name in AGENTS.md skills agents profiles opencode.json; do
  [ -L "$CFG/$name" ] || fail "$name is not a symlink"
  [ "$(readlink -f "$CFG/$name")" = "$(readlink -f "$PORT/$name")" ] || fail "$name does not point at the port"
done
[ "$(count_lines "$out" '^linked ')" = 5 ] || fail "expected five linked lines, got: $out"
case $out in *"opencode reload"*) ;; *) fail 'missing the opencode reload hint' ;; esac
[ "$(ls -A "$CFG" | wc -l | tr -d ' ')" = 5 ] || fail 'installer wrote something besides the five links'

# 2. Second install changes nothing: same entries, same link targets.
link_targets() { for n in $(ls -A "$1"); do printf '%s -> %s\n' "$n" "$(readlink "$1/$n" || echo '(not a link)')"; done; }
link_targets "$CFG" > "$TMP/before.links"
flow install >/dev/null 2>&1 || fail 'second install failed'
link_targets "$CFG" > "$TMP/after.links"
cmp -s "$TMP/before.links" "$TMP/after.links" || fail 'second install changed the config root'

# 3. verify passes.
flow verify >/dev/null 2>&1 || fail 'verify failed after install'

# 4. An identical real copy of opencode.json is relinked.
rm "$CFG/opencode.json"
cp "$PORT/opencode.json" "$CFG/opencode.json"
out=$(flow install 2>&1) || fail 'install failed on an identical copy'
case $out in *"replaced identical copy"*) ;; *) fail "missing 'replaced identical copy': $out" ;; esac
[ -L "$CFG/opencode.json" ] || fail 'identical copy was not relinked'

# 5. A divergent real copy is refused; everything else is still linked.
H="$TMP/h5"; mkdir -p "$H/$CFG_REL"
CFG="$H/$CFG_REL"
printf '{}\n' > "$CFG/opencode.json"
cp "$CFG/opencode.json" "$TMP/divergent.before"
if out=$(flow install 2>&1); then fail 'install accepted a divergent opencode.json'; fi
case $out in *"WARN:"*"differs from"*) ;; *) fail "missing the divergence WARN: $out" ;; esac
case $out in *"nothing was overwritten"*) ;; *) fail "missing 'nothing was overwritten': $out" ;; esac
cmp -s "$TMP/divergent.before" "$CFG/opencode.json" || fail 'divergent opencode.json was modified'
[ ! -L "$CFG/opencode.json" ] || fail 'divergent opencode.json became a symlink'
for name in AGENTS.md skills agents profiles; do
  [ -L "$CFG/$name" ] || fail "$name was not linked next to a divergent opencode.json"
done

# 6. A real directory is refused before anything is linked.
H="$TMP/h6"; mkdir -p "$H/$CFG_REL/skills"
CFG="$H/$CFG_REL"
if out=$(flow install 2>&1); then fail 'install replaced a real skills directory'; fi
case $out in *skills*"move/merge it manually"*) ;; *) fail "missing the real-directory refusal: $out" ;; esac
[ ! -e "$CFG/AGENTS.md" ] || fail 'a link was made although skills was refused'
[ -d "$CFG/skills" ] && [ ! -L "$CFG/skills" ] || fail 'the real skills directory was touched'

# 7. A foreign symlink is refused; a symlink into the repository is relinked.
H="$TMP/h7"; mkdir -p "$H/$CFG_REL" "$H/elsewhere"
CFG="$H/$CFG_REL"
ln -s "$H/elsewhere" "$CFG/agents"
if out=$(flow install 2>&1); then fail 'install replaced a foreign symlink'; fi
[ "$(readlink "$CFG/agents")" = "$H/elsewhere" ] || fail 'installer changed a foreign symlink'
case $out in *outside*) ;; *) fail "missing the foreign-symlink refusal: $out" ;; esac
rm "$CFG/agents"
ln -s "$ROOT/agent/agents" "$CFG/agents"
flow install >/dev/null 2>&1 || fail 'install failed on a symlink into the repository'
[ "$(readlink -f "$CFG/agents")" = "$(readlink -f "$PORT/agents")" ] || fail 'a symlink into the repository was not relinked'

# 7b. A foreign opencode.json symlink is refused before anything is linked.
H="$TMP/h7b"; mkdir -p "$H/$CFG_REL" "$H/elsewhere"
CFG="$H/$CFG_REL"
: > "$H/elsewhere/opencode.json"
ln -s "$H/elsewhere/opencode.json" "$CFG/opencode.json"
if out=$(flow install 2>&1); then fail 'install replaced a foreign opencode.json symlink'; fi
[ "$(readlink "$CFG/opencode.json")" = "$H/elsewhere/opencode.json" ] || fail 'installer changed a foreign opencode.json symlink'
case $out in *outside*) ;; *) fail "missing the foreign opencode.json refusal: $out" ;; esac
[ "$(ls -A "$CFG" | wc -l | tr -d ' ')" = 1 ] || fail 'a link was made although opencode.json was refused'

# 8. Duplicate skills under ~/.claude and ~/.agents are reported, never deleted.
H="$TMP/h8"; mkdir -p "$H"
flow install >/dev/null 2>&1 || fail 'install failed for the duplicate case'
CFG="$H/$CFG_REL"
mkdir -p "$H/.claude/skills/$SKILL1" "$H/.agents/skills/$SKILL2"
: > "$H/.claude/skills/$SKILL1/SKILL.md"
: > "$H/.agents/skills/$SKILL2/SKILL.md"
for cmd in verify install; do
  if out=$(flow "$cmd" 2>&1); then fail "$cmd exited 0 with duplicate skills"; fi
  [ "$(count_lines "$out" 'WARN: duplicate skill')" = 2 ] || fail "$cmd: expected two duplicate WARN lines: $out"
  case $out in *"$H/.claude/skills/$SKILL1/SKILL.md"*) ;; *) fail "$cmd: missing the .claude path: $out" ;; esac
  case $out in *"$H/.agents/skills/$SKILL2/SKILL.md"*) ;; *) fail "$cmd: missing the .agents path: $out" ;; esac
done
for name in AGENTS.md skills agents profiles opencode.json; do
  [ -L "$CFG/$name" ] || fail "$name lost its link next to duplicates"
done
[ -e "$H/.claude/skills/$SKILL1/SKILL.md" ] && [ -e "$H/.agents/skills/$SKILL2/SKILL.md" ] || fail 'a duplicate was deleted'
rm -r "$H/.claude" "$H/.agents"
flow verify >/dev/null 2>&1 || fail 'verify failed after the duplicates were removed'

# 9. XDG_CONFIG_HOME moves the config root.
H="$TMP/h9"; mkdir -p "$H"
HOME=$H XDG_CONFIG_HOME="$H/xdg" PATH="/usr/bin:/bin" "$FLOW" install >/dev/null 2>&1 || fail 'XDG install failed'
for name in AGENTS.md skills agents profiles opencode.json; do
  [ -L "$H/xdg/opencode/$name" ] || fail "XDG: $name not linked"
done
[ ! -e "$H/.config" ] || fail 'XDG install wrote under ~/.config'

# 10. run: profile, argument order, error cases.
H="$TMP/h10"; mkdir -p "$H" "$TMP/runbin"
flow install >/dev/null 2>&1 || fail 'install failed for the run case'
cat > "$TMP/runbin/opencode" <<'SH'
#!/bin/sh
printf '%s\n' "OPENCODE_CONFIG=$OPENCODE_CONFIG" "$@"
SH
chmod +x "$TMP/runbin/opencode"
out=$(HOME=$H PATH="$TMP/runbin:/usr/bin:/bin" "$FLOW" run claude-agent run hello 2>&1) || fail 'run failed'
want=$(printf '%s\n' "OPENCODE_CONFIG=$H/$CFG_REL/profiles/claude-agent.json" run hello --standalone)
[ "$out" = "$want" ] || fail "run output differs: $out"
if out=$(HOME=$H PATH="$TMP/runbin:/usr/bin:/bin" "$FLOW" run nope 2>&1); then fail 'run accepted an unknown profile'; fi
case $out in *"unknown profile 'nope'"*claude-agent*opencode*) ;; *) fail "unknown-profile message wrong: $out" ;; esac
# profiles/ links into the port, so profiles/../opencode.json is the real base config:
# only the name check keeps `../opencode` from reaching exec. `.hidden` has no real
# target to hit, so it only checks the message and that opencode never starts.
for bad in ../opencode .hidden; do
  if out=$(HOME=$H PATH="$TMP/runbin:/usr/bin:/bin" "$FLOW" run "$bad" run hello 2>&1); then fail "run accepted the profile name $bad"; fi
  case $out in *"unknown profile '$bad'"*) ;; *) fail "run $bad: unknown-profile message wrong: $out" ;; esac
  case $out in *OPENCODE_CONFIG=*) fail "run $bad started opencode: $out" ;; esac
done
if out=$(flow run claude-agent 2>&1); then fail 'run worked without opencode on PATH'; fi
case $out in *opencode*) ;; *) fail "missing-opencode message does not mention opencode: $out" ;; esac

# 11. doctor against a stub opencode answering from fixtures.
H="$TMP/h11"; mkdir -p "$H" "$TMP/docbin"
flow install >/dev/null 2>&1 || fail 'install failed for the doctor case'
cat > "$TMP/docbin/opencode" <<'SH'
#!/bin/sh
b=base
[ -z "${OPENCODE_CONFIG:-}" ] || b=$(basename "$OPENCODE_CONFIG" .json)
[ -z "${OPENCODE_CONFIG:-}" ] || printf '%s\n' "$OPENCODE_CONFIG" >> "$FIXTURE_DIR/configs.log"
case $1 in
  debug) cat "$FIXTURE_DIR/agents-$b.json" ;;
  api)
    case $2 in
      --standalone) cat "$FIXTURE_DIR/model-$b.json" ;;
      --server) cat "$FIXTURE_DIR/skills.json" ;;
    esac ;;
  serve)
    [ -e "$FIXTURE_DIR/noserve" ] || echo 'server listening on http://127.0.0.1:1'
    exec sleep 60 ;;
esac
SH
chmod +x "$TMP/docbin/opencode"

make_fixtures() { # dir skills-prefix
  python3 - "$PORT" "$1" "$2" <<'PY'
import json, os, sys
port, out, prefix = sys.argv[1:4]
agents = sorted(f[:-3] for f in os.listdir(f'{port}/agents') if f.endswith('.md'))
skills = sorted(os.listdir(f'{port}/skills'))
asks = [{'action': 'shell', 'resource': r, 'effect': 'ask'} for r in ('git push*', 'gh pr create*')]
def agent_list(models):
    rows = [{'id': 'build', 'mode': 'primary', 'permissions': asks}]
    for a in agents:
        row = {'id': a, 'mode': 'subagent', 'permissions': asks}
        if models:
            p, _, m = models[a].partition('/')
            row['model'] = {'providerID': p, 'id': m}
        rows.append(row)
    return rows
def dump(name, value):
    with open(f'{out}/{name}', 'w') as f:
        json.dump(value, f)
dump('agents-base.json', agent_list(None))
for stem in sorted(f[:-5] for f in os.listdir(f'{port}/profiles')):
    prof = json.load(open(f'{port}/profiles/{stem}.json'))
    dump(f'agents-{stem}.json', agent_list({a: v['model'] for a, v in prof['agent'].items()}))
    p, _, m = prof['model'].partition('/')
    dump(f'model-{stem}.json', {'data': {'providerID': p, 'modelID': m}})
dump('skills.json', {'data': [{'id': 'opencode', 'path': '/builtin'}] + [{'id': s, 'path': f'{prefix}/{s}/SKILL.md'} for s in skills]})
PY
}

FX="$TMP/fx"; mkdir -p "$FX"
make_fixtures "$FX" "$H/$CFG_REL/skills"
doctor() { HOME=$H PATH="$TMP/docbin:/usr/bin:/bin" FIXTURE_DIR=$FX FLOW_OPENCODE_SERVE_WAIT=2 "$FLOW" doctor 2>&1; }

# A: everything good.
out=$(doctor) || fail "doctor failed on good fixtures: $out"
for s in $(ls "$PORT/skills"); do
  case $out in *"ok: skill $s at "*) ;; *) fail "doctor A: no ok line for skill $s: $out" ;; esac
done
case $out in *"ok: profile claude-agent: flow-planner ->"*) ;; *) fail "doctor A: no flow-planner mapping line: $out" ;; esac
case $out in *"ok: profile claude-agent: main model"*|*"SKIP: profile claude-agent: main model"*) ;; *) fail "doctor A: no main model line: $out" ;; esac
case $out in *"FAIL"*) fail "doctor A: unexpected FAIL: $out" ;; esac
# The profiles checked are the installed ones, not the repository copies.
[ -s "$FX/configs.log" ] || fail 'doctor A: the stub saw no OPENCODE_CONFIG'
while read -r cfgpath; do
  case $cfgpath in "$H/$CFG_REL/profiles/"*) ;; *) fail "doctor A: profile checked from $cfgpath, not the config root" ;; esac
done < "$FX/configs.log"

# B: a missing agent.
python3 - "$FX/agents-base.json" <<'PY'
import json, sys
p = sys.argv[1]
rows = [r for r in json.load(open(p)) if r['id'] != 'flow-planner']
json.dump(rows, open(p, 'w'))
PY
if out=$(doctor); then fail 'doctor B exited 0 with a missing agent'; fi
case $out in *"FAIL: agent flow-planner"*) ;; *) fail "doctor B: missing the agent FAIL: $out" ;; esac

# C: a skill loaded from outside the config root.
make_fixtures "$FX" "$H/$CFG_REL/skills"
python3 - "$FX/skills.json" "$H/.claude/skills" "$SKILL1" <<'PY'
import json, sys
p, prefix, name = sys.argv[1:4]
d = json.load(open(p))
for s in d['data']:
    if s['id'] == name:
        s['path'] = f'{prefix}/{name}/SKILL.md'
json.dump(d, open(p, 'w'))
PY
if out=$(doctor); then fail 'doctor C exited 0 with a foreign skill path'; fi
case $out in *"FAIL: skill $SKILL1 loaded from"*) ;; *) fail "doctor C: missing the loaded-from FAIL: $out" ;; esac

# D: the server never announces itself.
make_fixtures "$FX" "$H/$CFG_REL/skills"
: > "$FX/noserve"
if out=$(doctor); then fail 'doctor D exited 0 without a server'; fi
case $out in *"FAIL:"*server*) ;; *) fail "doctor D: missing the server FAIL: $out" ;; esac
rm "$FX/noserve"

# E: a checker that crashes (skill list with an unexpected shape) is a FAIL.
make_fixtures "$FX" "$H/$CFG_REL/skills"
printf '%s\n' '{"data": {"flow-tdd": {"id": "flow-tdd"}}}' > "$FX/skills.json"
if out=$(doctor); then fail "doctor E exited 0 although a checker crashed: $out"; fi
case $out in *"FAIL: checker check_skills exited "*) ;; *) fail "doctor E: no 'checker check_skills exited' line: $out" ;; esac

# F: a checker that exits 0 but prints nothing is a FAIL.
make_fixtures "$FX" "$H/$CFG_REL/skills"
mkdir -p "$TMP/emptypy"
printf '#!/bin/sh\ncat >/dev/null\n' > "$TMP/emptypy/python3"
chmod +x "$TMP/emptypy/python3"
if out=$(HOME=$H PATH="$TMP/emptypy:$TMP/docbin:/usr/bin:/bin" FIXTURE_DIR=$FX FLOW_OPENCODE_SERVE_WAIT=2 "$FLOW" doctor 2>&1); then fail "doctor F exited 0 although a checker printed nothing: $out"; fi
case $out in *"FAIL: checker check_agents printed nothing"*) ;; *) fail "doctor F: no 'printed nothing' line: $out" ;; esac

# 12. Shell syntax.
sh -n "$FLOW" || fail 'sh -n flow-opencode'
sh -n "$0" || fail 'sh -n opencode-install.test.sh'

# 13. doctor without python3.
mkdir -p "$TMP/nopy"
cp "$TMP/docbin/opencode" "$TMP/nopy/opencode"
for tool in env sh readlink mkdir ln rm printf od tr sleep grep cmp dirname cat kill git mktemp basename ls; do
  src=$(command -v "$tool") || fail "test needs $tool"
  ln -sf "$src" "$TMP/nopy/$tool"
done
if out=$(HOME=$H PATH="$TMP/nopy" FIXTURE_DIR=$FX "$FLOW" doctor 2>&1); then fail 'doctor ran without python3'; fi
case $out in *"needs python3"*) ;; *) fail "missing the python3 message: $out" ;; esac

echo 'ok: opencode installer safety/idempotence'
