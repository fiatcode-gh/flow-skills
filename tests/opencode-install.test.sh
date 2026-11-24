#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PORT="$ROOT/opencode"
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
note_for() { printf 'note: Flow works best with "session.permissions": "prompt" in %s/cli.json; "autoaccept" records flow_gate approvals without asking.' "$1"; }

# 1. Fresh install links exactly the five destinations and the plugin.
H="$TMP/h1"; mkdir -p "$H"
out=$(flow install 2>&1) || fail 'fresh install failed'
CFG="$H/$CFG_REL"
[ "$(count_lines "$out" '^linked ')" = 6 ] || fail "expected six linked lines, got: $out"
for name in AGENTS.md skills agents profiles opencode.json plugins/flow-guard; do
  [ -L "$CFG/$name" ] || fail "$name is not a symlink"
  [ "$(readlink -f "$CFG/$name")" = "$(readlink -f "$PORT/$name")" ] || fail "$name does not point at the port"
done
case $out in *"opencode reload"*) ;; *) fail 'missing the opencode reload hint' ;; esac
[ "$(printf '%s\n' "$out" | tail -n 1)" = "$(note_for "$CFG")" ] || fail "install does not end with the permissions note: $out"
[ "$(ls -A "$CFG" | wc -l | tr -d ' ')" = 6 ] || fail 'installer wrote something besides the five links and plugins/'
[ -d "$CFG/plugins" ] && [ ! -L "$CFG/plugins" ] || fail 'plugins is not a real directory'
[ "$(ls -A "$CFG/plugins")" = flow-guard ] || fail "plugins holds more than flow-guard: $(ls -A "$CFG/plugins")"

# 2. Second install changes nothing: same entries, same link targets.
link_targets() { for n in $(ls -A "$1"); do printf '%s -> %s\n' "$n" "$(readlink "$1/$n" || echo '(not a link)')"; done; }
{ link_targets "$CFG"; link_targets "$CFG/plugins"; } > "$TMP/before.links"
flow install >/dev/null 2>&1 || fail 'second install failed'
{ link_targets "$CFG"; link_targets "$CFG/plugins"; } > "$TMP/after.links"
cmp -s "$TMP/before.links" "$TMP/after.links" || fail 'second install changed the config root'

# 3. verify passes.
flow verify >/dev/null 2>&1 || fail 'verify failed after install'

# 4. An identical real copy of opencode.json is relinked.
rm "$CFG/opencode.json"
cp "$PORT/opencode.json" "$CFG/opencode.json"
out=$(flow install 2>&1) || fail 'install failed on an identical copy'
case $out in *"replaced identical copy"*) ;; *) fail "missing 'replaced identical copy': $out" ;; esac
[ -L "$CFG/opencode.json" ] || fail 'identical copy was not relinked'
[ -L "$CFG/plugins/flow-guard" ] || fail 'plugin link lost after relinking an identical copy'

# 5. A divergent real copy is refused; everything else is still linked.
H="$TMP/h5"; mkdir -p "$H/$CFG_REL"
CFG="$H/$CFG_REL"
printf '{}\n' > "$CFG/opencode.json"
cp "$CFG/opencode.json" "$TMP/divergent.before"
if out=$(flow install 2>&1); then fail 'install accepted a divergent opencode.json'; fi
case $out in *"WARN:"*"differs from"*) ;; *) fail "missing the divergence WARN: $out" ;; esac
case $out in *"nothing was overwritten"*) ;; *) fail "missing 'nothing was overwritten': $out" ;; esac
[ "$(printf '%s\n' "$out" | tail -n 1)" = "$(note_for "$CFG")" ] || fail "a refused opencode.json: install does not end with the permissions note: $out"
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
ln -s "$ROOT/omp/agents" "$CFG/agents"
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

# P1. A plugins directory the user already has keeps its other plugins.
H="$TMP/hp1"; mkdir -p "$H/$CFG_REL/plugins/other"
CFG="$H/$CFG_REL"
printf 'export {}\n' > "$CFG/plugins/other/index.ts"
cp "$CFG/plugins/other/index.ts" "$TMP/other.before"
out=$(flow install 2>&1) || fail "install failed next to another plugin: $out"
[ -d "$CFG/plugins/other" ] && [ ! -L "$CFG/plugins/other" ] || fail 'the other plugin directory was touched'
cmp -s "$TMP/other.before" "$CFG/plugins/other/index.ts" || fail 'the other plugin was modified'
[ "$(readlink -f "$CFG/plugins/flow-guard")" = "$(readlink -f "$PORT/plugins/flow-guard")" ] || fail 'flow-guard not linked beside the other plugin'

# P2. A real plugins/flow-guard directory is refused before anything is linked.
H="$TMP/hp2"; mkdir -p "$H/$CFG_REL/plugins/flow-guard"
CFG="$H/$CFG_REL"
if out=$(flow install 2>&1); then fail 'install replaced a real plugins/flow-guard directory'; fi
case $out in *plugins/flow-guard*"move/merge it manually"*) ;; *) fail "missing the real plugin directory refusal: $out" ;; esac
[ "$(ls -A "$CFG")" = plugins ] || fail "something was linked although the plugin was refused: $(ls -A "$CFG")"
[ -d "$CFG/plugins/flow-guard" ] && [ ! -L "$CFG/plugins/flow-guard" ] || fail 'the real plugin directory was touched'

# P3. A plugins/flow-guard symlink outside the checkout is refused and left as it was.
H="$TMP/hp3"; mkdir -p "$H/$CFG_REL/plugins" "$H/elsewhere"
CFG="$H/$CFG_REL"
ln -s "$H/elsewhere" "$CFG/plugins/flow-guard"
if out=$(flow install 2>&1); then fail 'install replaced a foreign plugin symlink'; fi
case $out in *outside*) ;; *) fail "missing the foreign plugin refusal: $out" ;; esac
[ "$(readlink "$CFG/plugins/flow-guard")" = "$H/elsewhere" ] || fail 'installer changed a foreign plugin symlink'
[ "$(ls -A "$CFG")" = plugins ] || fail "something was linked although the plugin was refused: $(ls -A "$CFG")"

# P4. plugins itself must be a real directory: a symlink or a regular file is refused.
for kind in link file; do
  H="$TMP/hp4-$kind"; mkdir -p "$H/$CFG_REL" "$H/elsewhere"
  CFG="$H/$CFG_REL"
  if [ "$kind" = link ]; then ln -s "$H/elsewhere" "$CFG/plugins"; else : > "$CFG/plugins"; fi
  if out=$(flow install 2>&1); then fail "install accepted plugins as a $kind"; fi
  case $out in *"$CFG/plugins is not a real directory"*) ;; *) fail "plugins as a $kind: missing the real-directory refusal: $out" ;; esac
  [ "$(ls -A "$CFG")" = plugins ] || fail "plugins as a $kind: something was linked: $(ls -A "$CFG")"
  [ -z "$(ls -A "$H/elsewhere")" ] || fail "plugins as a $kind: wrote through the plugins link"
done

# P5. verify names a missing plugin link.
H="$TMP/hp5"; mkdir -p "$H"
CFG="$H/$CFG_REL"
flow install >/dev/null 2>&1 || fail 'install failed for the plugin verify case'
rm "$CFG/plugins/flow-guard"
if out=$(flow verify 2>&1); then fail 'verify passed without the plugin link'; fi
case $out in *"FAIL: $CFG/plugins/flow-guard"*) ;; *) fail "verify did not name the plugin link: $out" ;; esac

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
for name in AGENTS.md skills agents profiles opencode.json plugins/flow-guard; do
  [ -L "$CFG/$name" ] || fail "$name lost its link next to duplicates"
done
[ -e "$H/.claude/skills/$SKILL1/SKILL.md" ] && [ -e "$H/.agents/skills/$SKILL2/SKILL.md" ] || fail 'a duplicate was deleted'
rm -r "$H/.claude" "$H/.agents"
flow verify >/dev/null 2>&1 || fail 'verify failed after the duplicates were removed'

# 9. XDG_CONFIG_HOME moves the config root.
H="$TMP/h9"; mkdir -p "$H"
out=$(HOME=$H XDG_CONFIG_HOME="$H/xdg" PATH="/usr/bin:/bin" "$FLOW" install 2>&1) || fail 'XDG install failed'
[ "$(printf '%s\n' "$out" | tail -n 1)" = "$(note_for "$H/xdg/opencode")" ] || fail "XDG: the permissions note does not name the XDG cli.json: $out"
for name in AGENTS.md skills agents profiles opencode.json plugins/flow-guard; do
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
  --version) cat "$FIXTURE_DIR/version" ;;
  debug) cat "$FIXTURE_DIR/agents-$b.json" ;;
  api)
    case $2 in
      --standalone) cat "$FIXTURE_DIR/model-$b.json" ;;
      --server)
        # The server's URL ends in its config's stem.
        s=${3##*/}
        case $4 in
          plugin.list) : > "$FIXTURE_DIR/listed-$s"; cat "$FIXTURE_DIR/plugins.json" ;;
          # Like OpenCode 2.4.1, a server knows the config's model only once its plugins are listed.
          model.default)
            if [ -e "$FIXTURE_DIR/listed-$s" ]; then cat "$FIXTURE_DIR/served-model-$s.json"; else echo '{"data": null}'; fi ;;
          *) cat "$FIXTURE_DIR/skills.json" ;;
        esac ;;
    esac ;;
  serve)
    rm -f "$FIXTURE_DIR/listed-$b"
    [ -e "$FIXTURE_DIR/noserve" ] || echo "server listening on http://127.0.0.1:1/$b"
    exec sleep 60 ;;
esac
SH
chmod +x "$TMP/docbin/opencode"

make_fixtures() { # dir skills-prefix
  python3 - "$PORT" "$1" "$2" <<'PY'
import json, os, sys
port, out, prefix = sys.argv[1:4]
# Mirrors OpenCode 2.2.5: `ask` is primary like `build`, and `plan.md` keeps the built-in plan off the list.
agents = sorted(f[:-3] for f in os.listdir(f'{port}/agents') if f.endswith('.md') and f not in ('ask.md', 'plan.md'))
skills = sorted(os.listdir(f'{port}/skills'))
asks = [{'action': 'shell', 'resource': r, 'effect': 'ask'} for r in ('git push*', 'gh pr create*')]
def agent_list(routes):
    rows = []
    for a in ['build', 'ask'] + agents:
        row = {'id': a, 'mode': 'primary' if a in ('build', 'ask') else 'subagent', 'permissions': asks}
        if routes and a in routes:
            model, variant = routes[a]
            p, _, m = model.partition('/')
            row['model'] = {'providerID': p, 'id': m}
            if variant:
                row['model']['variant'] = variant
        rows.append(row)
    return rows
def dump(name, value):
    with open(f'{out}/{name}', 'w') as f:
        json.dump(value, f)
dump('agents-base.json', agent_list(None))
for stem in sorted(f[:-5] for f in os.listdir(f'{port}/profiles')):
    prof = json.load(open(f'{port}/profiles/{stem}.json'))
    dump(f'agents-{stem}.json', agent_list({a: (v['model'], v.get('variant')) for a, v in prof['agent'].items()}))
    p, _, m = prof['model'].partition('/')
    dump(f'model-{stem}.json', {'data': {'providerID': p, 'modelID': m}})
    dump(f'served-model-{stem}.json', {'data': {'providerID': p, 'modelID': m}})
dump('skills.json', {'data': [{'id': 'opencode', 'path': '/builtin'}] + [{'id': s, 'path': f'{prefix}/{s}/SKILL.md'} for s in skills]})
plugin = os.path.dirname(prefix) + '/plugins/flow-guard'
dump('plugins.json', {'data': [
    {'id': 'opencode.tool.read', 'source': {'type': 'builtin'}, 'features': {'server': True}, 'state': {'status': 'active'}},
    {'id': 'flow-guard', 'source': {'type': 'local', 'path': plugin}, 'features': {'server': True}, 'state': {'status': 'active'}},
]})
with open(f'{out}/version', 'w') as f:
    f.write('opencode v2.2.5\n')
PY
}

FX="$TMP/fx"; mkdir -p "$FX"
make_fixtures "$FX" "$H/$CFG_REL/skills"
doctor() { HOME=$H PATH="$TMP/docbin:/usr/bin:/bin" FIXTURE_DIR=$FX FLOW_OPENCODE_SERVE_WAIT=2 FLOW_OPENCODE_PLUGIN_WAIT=1 "$FLOW" doctor 2>&1; }

# A: everything good.
out=$(doctor) || fail "doctor failed on good fixtures: $out"
[ "$(printf '%s\n' "$out" | sed -n 1p)" = "flow-skills $(cat "$ROOT/VERSION")" ] || fail "doctor A: first line is not the version: $out"
for s in $(ls "$PORT/skills"); do
  case $out in *"ok: skill $s at "*) ;; *) fail "doctor A: no ok line for skill $s: $out" ;; esac
done
case $out in *"ok: profile claude-agent: flow-planner ->"*) ;; *) fail "doctor A: no flow-planner mapping line: $out" ;; esac
case $out in *"ok: profile claude-agent: main model"*|*"SKIP: profile claude-agent: main model"*) ;; *) fail "doctor A: no main model line: $out" ;; esac
case $out in *"ok: plugin flow-guard is active at $H/$CFG_REL/plugins/flow-guard"*) ;; *) fail "doctor A: no ok line for the plugin: $out" ;; esac
case $out in *"FAIL"*) fail "doctor A: unexpected FAIL: $out" ;; esac
case $out in *"ok: agent ask is a primary agent"*) ;; *) fail "doctor A: no ok line for ask: $out" ;; esac
case $out in *"ok: built-in plan agent is off"*) ;; *) fail "doctor A: no ok line for the plan agent: $out" ;; esac
# The profiles checked are the installed ones, not the repository copies.
[ -s "$FX/configs.log" ] || fail 'doctor A: the stub saw no OPENCODE_CONFIG'
while read -r cfgpath; do
  case $cfgpath in "$H/$CFG_REL/profiles/"*) ;; *) fail "doctor A: profile checked from $cfgpath, not the config root" ;; esac
done < "$FX/configs.log"

# N: OpenCode 2.4.1 answers a one-shot model.default with null data; a profile server answers once its plugins load.
make_fixtures "$FX" "$H/$CFG_REL/skills"
printf '%s\n' 'opencode v2.4.1' > "$FX/version"
for stem in $(ls "$PORT/profiles" | sed 's/\.json$//'); do
  printf '%s\n' '{"location": {"directory": "/tmp"}, "data": null}' > "$FX/model-$stem.json"
done
out=$(doctor) || fail "doctor N failed on 2.4.1 fixtures: $out"
case $out in *"ok: profile claude-agent: main model claude-agent/opus"*) ;; *) fail "doctor N: no main model ok line on 2.4.1: $out" ;; esac
case $out in *"FAIL"*) fail "doctor N: unexpected FAIL: $out" ;; esac

# O: when no server answers with the model either, the check is skipped with the version, never failed.
printf '%s\n' '{"data": null}' > "$FX/served-model-claude-agent.json"
out=$(doctor) || fail "doctor O failed with an unreadable main model: $out"
case $out in *"SKIP: profile claude-agent: main model (not readable on OpenCode v2.4.1)"*) ;; *) fail "doctor O: no not-readable SKIP: $out" ;; esac
case $out in *"FAIL"*) fail "doctor O: unexpected FAIL: $out" ;; esac
make_fixtures "$FX" "$H/$CFG_REL/skills"

# B: a missing agent.
python3 - "$FX/agents-base.json" <<'PY'
import json, sys
p = sys.argv[1]
rows = [r for r in json.load(open(p)) if r['id'] != 'flow-planner']
json.dump(rows, open(p, 'w'))
PY
if out=$(doctor); then fail 'doctor B exited 0 with a missing agent'; fi
case $out in *"FAIL: agent flow-planner"*) ;; *) fail "doctor B: missing the agent FAIL: $out" ;; esac

# G: a resolved effort that differs from the profile, and a profile that names build.
make_fixtures "$FX" "$H/$CFG_REL/skills"
out=$(doctor) || fail "doctor G: failed on good fixtures: $out"
case $out in *"ok: profile claude-agent: build -> claude-agent/opus#medium"*) ;; *) fail "doctor G: no build mapping line with its effort: $out" ;; esac
case $out in *"ok: profile claude-agent: flow-planner -> claude-agent/opus#high"*) ;; *) fail "doctor G: no flow-planner line with its effort: $out" ;; esac
case $out in *"ok: profile claude-agent: ask -> claude-agent/opus#medium"*) ;; *) fail "doctor G: no ask mapping line with the build effort: $out" ;; esac
case $out in *"ok: profile commandcode: ask -> commandcode/deepseek/deepseek-v4.1-flash#high"*) ;; *) fail "doctor G: no commandcode ask line: $out" ;; esac
case $out in *"profile opencode: ask"*) fail "doctor G: the opencode profile maps no build, so ask is not checked: $out" ;; esac
python3 - "$FX/agents-claude-agent.json" <<'PY'
import json, sys
p = sys.argv[1]
rows = json.load(open(p))
for r in rows:
    if r['id'] == 'flow-planner':
        r['model']['variant'] = 'low'
json.dump(rows, open(p, 'w'))
PY
if out=$(doctor); then fail 'doctor G exited 0 with a wrong effort'; fi
case $out in *"FAIL: profile claude-agent: flow-planner resolved to claude-agent/opus#low, expected claude-agent/opus#high"*) ;; *) fail "doctor G: missing the effort FAIL: $out" ;; esac

# L: ask resolves to another effort than build.
make_fixtures "$FX" "$H/$CFG_REL/skills"
python3 - "$FX/agents-claude-agent.json" <<'PY'
import json, sys
p = sys.argv[1]
rows = json.load(open(p))
for r in rows:
    if r['id'] == 'ask':
        r['model']['variant'] = 'high'
json.dump(rows, open(p, 'w'))
PY
if out=$(doctor); then fail 'doctor L exited 0 with ask unlike build'; fi
case $out in *"FAIL: profile claude-agent: ask resolved to claude-agent/opus#high, expected claude-agent/opus#medium"*) ;; *) fail "doctor L: missing the ask FAIL: $out" ;; esac

# M: the built-in plan agent is still listed, in the base config and under a profile.
for b in base claude-agent; do
  make_fixtures "$FX" "$H/$CFG_REL/skills"
  python3 - "$FX/agents-$b.json" <<'PY'
import json, sys
p = sys.argv[1]
rows = json.load(open(p))
rows.append({'id': 'plan', 'mode': 'primary', 'permissions': []})
json.dump(rows, open(p, 'w'))
PY
  if out=$(doctor); then fail "doctor M ($b) exited 0 with a plan agent"; fi
  label=; [ "$b" = base ] || label="profile $b: "
  case $out in *"FAIL: ${label}built-in plan agent is still listed"*) ;; *) fail "doctor M ($b): missing the plan FAIL: $out" ;; esac
done

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
if out=$(HOME=$H PATH="$TMP/emptypy:$TMP/docbin:/usr/bin:/bin" FIXTURE_DIR=$FX FLOW_OPENCODE_SERVE_WAIT=2 FLOW_OPENCODE_PLUGIN_WAIT=1 "$FLOW" doctor 2>&1); then fail "doctor F exited 0 although a checker printed nothing: $out"; fi
case $out in *"FAIL: checker check_agents printed nothing"*) ;; *) fail "doctor F: no 'printed nothing' line: $out" ;; esac

# H-K: the plugin list. edit_plugins applies a Python statement to the fixture's `data`.
edit_plugins() {
  python3 - "$FX/plugins.json" "$1" <<'PY'
import json, sys
p, stmt = sys.argv[1:3]
d = json.load(open(p))
rows = d['data']
row = next(r for r in rows if r['id'] == 'flow-guard')
exec(stmt)
json.dump(d, open(p, 'w'))
PY
}
# H: flow-guard is not in the list.
make_fixtures "$FX" "$H/$CFG_REL/skills"
edit_plugins "rows.remove(row)"
if out=$(doctor); then fail "doctor H exited 0 without the plugin: $out"; fi
case $out in *"FAIL: plugin flow-guard is not loaded"*) ;; *) fail "doctor H: missing the not-loaded FAIL: $out" ;; esac
# I: the plugin failed to load.
make_fixtures "$FX" "$H/$CFG_REL/skills"
edit_plugins "row['state'] = {'status': 'failed', 'error': 'boom'}"
if out=$(doctor); then fail "doctor I exited 0 with a failed plugin: $out"; fi
case $out in *"FAIL: plugin flow-guard failed to load: boom"*) ;; *) fail "doctor I: missing the failed-load FAIL: $out" ;; esac
# J: the plugin loaded from somewhere else.
make_fixtures "$FX" "$H/$CFG_REL/skills"
edit_plugins "row['source']['path'] = '/elsewhere/flow-guard'"
if out=$(doctor); then fail "doctor J exited 0 with a foreign plugin path: $out"; fi
case $out in *"FAIL: plugin flow-guard loaded from /elsewhere/flow-guard"*) ;; *) fail "doctor J: missing the loaded-from FAIL: $out" ;; esac
# K: a plugin list with an unexpected shape crashes the checker, which is a FAIL.
make_fixtures "$FX" "$H/$CFG_REL/skills"
printf '%s\n' '{"data": {}}' > "$FX/plugins.json"
if out=$(doctor); then fail "doctor K exited 0 although check_plugin crashed: $out"; fi
case $out in *"FAIL: checker check_plugin exited "*) ;; *) fail "doctor K: no 'checker check_plugin exited' line: $out" ;; esac

# 11a. Links into the checkout's previous name (omp-stack) are relinked, dangling
# or not; a link anywhere else is still refused and left as it was.
NEW="$TMP/flow-skills"; OLD="$TMP/omp-stack"
mkdir -p "$NEW/opencode/bin" "$NEW/opencode/skills" "$NEW/opencode/agents" "$NEW/opencode/profiles" "$NEW/opencode/plugins/flow-guard"
cp "$FLOW" "$NEW/opencode/bin/flow-opencode"
: > "$NEW/opencode/AGENTS.md"; : > "$NEW/opencode/opencode.json"
HO="$TMP/home-old"; mkdir -p "$HO/$CFG_REL"
for name in AGENTS.md skills agents profiles opencode.json; do
  ln -s "$OLD/ports/opencode/$name" "$HO/$CFG_REL/$name"
done
out=$(HOME=$HO PATH="/usr/bin:/bin" "$NEW/opencode/bin/flow-opencode" install 2>&1) || fail "installer refused links into the previous checkout name: $out"
[ "$(count_lines "$out" '^linked ')" = 6 ] || fail "previous-name relink: expected six linked lines, got: $out"
for name in AGENTS.md skills agents profiles opencode.json plugins/flow-guard; do
  [ "$(readlink -f "$HO/$CFG_REL/$name")" = "$(readlink -f "$NEW/opencode/$name")" ] || fail "$name not relinked from the previous checkout name"
done
HOME=$HO PATH="/usr/bin:/bin" "$NEW/opencode/bin/flow-opencode" verify >/dev/null || fail 'verify after previous-name relink'
HE="$TMP/home-else"; mkdir -p "$HE/$CFG_REL"
ln -s "$TMP/elsewhere/agents" "$HE/$CFG_REL/agents"
if out=$(HOME=$HE PATH="/usr/bin:/bin" "$NEW/opencode/bin/flow-opencode" install 2>&1); then fail 'installer replaced a dangling link outside both checkout names'; fi
case $out in *outside*) ;; *) fail "refusal did not say outside: $out" ;; esac
[ "$(readlink "$HE/$CFG_REL/agents")" = "$TMP/elsewhere/agents" ] || fail 'installer changed a foreign dangling link'
for target in "$OLD/../elsewhere/agents" "$OLD/./elsewhere/agents" "$OLD/x/.." "$OLD/x/."; do
  HD="$TMP/home-dots"; rm -rf "$HD"; mkdir -p "$HD/$CFG_REL"
  ln -s "$target" "$HD/$CFG_REL/agents"
  if out=$(HOME=$HD PATH="/usr/bin:/bin" "$NEW/opencode/bin/flow-opencode" install 2>&1); then fail "installer replaced a link to $target under the previous name"; fi
  case $out in *outside*) ;; *) fail "refusal for $target did not say outside: $out" ;; esac
  [ "$(readlink "$HD/$CFG_REL/agents")" = "$target" ] || fail "installer changed the link to $target"
done

# 12a. Called through a symlink elsewhere (e.g. ~/.local/bin), the installer still finds the port.
BIN="$TMP/bin"; mkdir -p "$BIN"; ln -s "$FLOW" "$BIN/flow-opencode"
H="$TMP/h-symlink"; mkdir -p "$H"
HOME=$H PATH="/usr/bin:/bin" "$BIN/flow-opencode" install >/dev/null 2>&1 || fail 'install through a symlinked launcher failed'
[ "$(readlink -f "$H/$CFG_REL/AGENTS.md")" = "$(readlink -f "$PORT/AGENTS.md")" ] || fail 'symlinked launcher linked the wrong port'
[ "$(readlink -f "$H/$CFG_REL/plugins/flow-guard")" = "$(readlink -f "$PORT/plugins/flow-guard")" ] || fail 'symlinked launcher linked the wrong plugin'

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
