from pathlib import Path
import json, os, re, shutil, subprocess, sys, tempfile, yaml

ROOT = Path(__file__).resolve().parents[1]
errors=[]

def err(msg): errors.append(msg)
def rel(p): return p.relative_to(ROOT).as_posix()

def frontmatter(p):
    text=p.read_text()
    if not text.startswith('---\n'):
        err(f'{rel(p)}: missing frontmatter'); return {}, text
    try:
        _, raw, body = text.split('---', 2)
        data=yaml.safe_load(raw) or {}
        if not isinstance(data, dict): raise TypeError('frontmatter is not mapping')
        return data, body
    except Exception as e:
        err(f'{rel(p)}: invalid frontmatter: {e}'); return {}, text

MODEL_LEAK=re.compile(r'(?:openai-codex|anthropic|commandcode)/|gpt-5|gpt-6|claude-(?:haiku|sonnet|opus|fable)|deepseek|glm-|kimi|mimo')
skills=list((ROOT/'omp/skills').glob('*/SKILL.md'))
agents=list((ROOT/'omp/agents').glob('*.md'))
rules=list((ROOT/'omp/rules').glob('*.md'))

if len(skills)!=13: err(f'expected 13 skills, got {len(skills)}')
if len(agents)!=10: err(f'expected 10 agents, got {len(agents)}')
if len(rules)!=3: err(f'expected 3 rules, got {len(rules)}')

names=set()
for p in skills:
    fm,body=frontmatter(p)
    name=fm.get('name'); desc=fm.get('description')
    if not name or not desc: err(f'{rel(p)}: skill needs name+description')
    if name in names: err(f'duplicate skill name {name}')
    names.add(name)
    if 'flow-using-skills' in body: err(f'{rel(p)}: legacy bootstrap reference')
    if re.search(r'pass (?:the )?model explicitly|explicit model per|model: openai-codex/', body, re.I): err(f'{rel(p)}: concrete/per-dispatch model routing leaked into skill')
    for asset in p.parent.rglob('*'):
        if asset.is_file() and asset.suffix in {'.md','.json','.py','.sh',''} and MODEL_LEAK.search(asset.read_text(errors='replace')): err(f'{rel(asset)}: concrete model/provider identifier leaked into skill content')

expected={
'flow-design','flow-planning','flow-execution','flow-tdd','flow-debugging','flow-review','flow-integrating','flow-external-session','ui-design','blog-post','weft-worklog','weft-memory','weft-maintenance'}
if names!=expected: err(f'skill set mismatch: {sorted(names^expected)}')

agent_names=set()
allowed_roles={'@task','@execute','@plan','@slow','@review_aux','@vision'}
for p in agents:
    fm,body=frontmatter(p); name=fm.get('name'); desc=fm.get('description')
    if not name or not desc: err(f'{rel(p)}: agent needs name+description')
    agent_names.add(name)
    model=fm.get('model')
    if model and model not in allowed_roles: err(f'{rel(p)}: unexpected agent role {model}')
    if MODEL_LEAK.search(p.read_text()): err(f'{rel(p)}: concrete model leaked into agent')
    if 'spawns' in fm and not isinstance(fm.get('spawns'), list): err(f'{rel(p)}: spawns must be a YAML list')

expected_agents={'flow-acceptance-reviewer','flow-audit-code-health','flow-audit-docs','flow-audit-tests','flow-craft-reviewer','flow-evidence-verifier','flow-implementer','flow-plan-executor','flow-planner','flow-ttc-reviewer'}
if agent_names!=expected_agents: err(f'agent set mismatch: {sorted(agent_names^expected_agents)}')
for p in rules:
    fm,body=frontmatter(p)
    if fm.get('alwaysApply') is not True: err(f'{rel(p)}: rule must alwaysApply')
    if not fm.get('name') or not fm.get('description'): err(f'{rel(p)}: rule needs name+description')

# Removed old workflow assumptions must not survive outside migration docs.
for p in (ROOT/'omp').rglob('*'):
    if not p.is_file() or p.suffix not in {'.md','.ts'}: continue
    text=p.read_text()
    for bad in ['never spawn an agent for work that writes', 'Never pick silently: ask the user which one', 'every new function has a test']:
        if bad.lower() in text.lower(): err(f'{rel(p)}: legacy rule survived: {bad}')

# Nested delegation and live-clarification contract.
impl_path=ROOT/'omp/agents/flow-implementer.md'
impl_fm,impl_body=frontmatter(impl_path)
spawns=impl_fm.get('spawns')
if spawns != ['scout','sonic']: err(f'flow-implementer spawns must be exactly scout+sonic, got {spawns!r}')
# Pin only names other files point at or route by: the section headings and
# the skill, agent and channel names. The prose is not pinned.
for required in ['## Brief sanity check', '## Nested delegation', '## Self-verification', '`flow-tdd`', '`scout`', '`sonic`', '`hub`']:
    if required not in impl_body: err(f'flow-implementer missing machine-read marker or pointer target: {required!r}')

planner_path=ROOT/'omp/agents/flow-planner.md'
planner_fm,planner_body=frontmatter(planner_path)
if planner_fm.get('model') != '@plan': err('flow-planner must use @plan')
if planner_fm.get('autoloadSkills') != ['flow-planning']: err('flow-planner must autoload flow-planning')
for required in ['`PLAN.md`', '`plan-tasks/*.md`', '`flow-planning`', '`STATUS`: READY/BLOCKED']:
    if required not in planner_body: err(f'flow-planner missing machine-read marker or pointer target: {required!r}')

executor_path=ROOT/'omp/agents/flow-plan-executor.md'
executor_fm,executor_body=frontmatter(executor_path)
if executor_fm.get('model') != '@execute': err('flow-plan-executor must use @execute')
if executor_fm.get('spawns') not in (None, [], ''): err('flow-plan-executor must not spawn child agents')
if executor_fm.get('autoloadSkills') != ['flow-tdd']: err('flow-plan-executor must autoload flow-tdd')
for required in ['`Locked decisions`', '`Executor discretion`', '`flow-tdd`', '`hub`', '200-request warning', '`STATUS`: DONE/BLOCKED/YIELD']:
    if required not in executor_body: err(f'flow-plan-executor missing machine-read marker or pointer target: {required!r}')

accept_path=ROOT/'omp/agents/flow-acceptance-reviewer.md'
accept_fm,accept_body=frontmatter(accept_path)
if accept_fm.get('model') != '@slow': err('flow-acceptance-reviewer must use @slow')
for required in ['`implementation-defect`', '`plan-drift`', '`plan-defect`', '`unplanned-risk`', '`ACCEPT`', '`CHANGES`']:
    if required not in accept_body: err(f'flow-acceptance-reviewer missing machine-read marker: {required!r}')

verifier_path=ROOT/'omp/agents/flow-evidence-verifier.md'
verifier_fm,verifier_body=frontmatter(verifier_path)
if verifier_fm.get('model') != '@vision': err('flow-evidence-verifier must use @vision')
# The capsule manifest labels are what flow-evidence-guard and Main parse; the
# receipt labels are what Main reads back.
for required in ['Evidence capsule:\n- ID:', '\n- Owns:', '\n- Independent split check:', '\n- Excludes:', '\n- Restore obligation:', '`STATUS`: EVIDENCE/BLOCKED', '`RESTORE`', '`before` identity/hash', '`after` identity/hash', 'MATCH/MISMATCH/UNKNOWN']:
    if required not in verifier_body: err(f'flow-evidence-verifier missing machine-read marker: {required!r}')

# The guards' behavior, including passing native hub waits through untouched,
# is proven by tests/flow-evidence-guard.test.mjs and tests/flow-governance-guard.test.mjs.

design_raw=(ROOT/'omp/skills/flow-design/SKILL.md').read_text()
# Pin only what tools parse or other files name: the headings, the step 7
# opener and the "Resume step" name that other files point at, and the
# tool, skill, agent and path names that route behavior.
DESIGN_MARKERS=[
    '## When this is warranted', '## Process', '## Imported design context',
    '## Durability', '## Multi-unit work', '## Rules',
    '\n7. Present the completed contract', 'Resume step',
    '`flow_gate`', '`kind=contract`', '`present`', '`approve`',
    '`flow-planner`', '`flow-planning`', '`flow-artifacts`',
    '`.flow/contracts/<slug>.md`', '`.flow/contracts/<parent-slug>.md`',
    '`.flow/ldd/<epic>/`', '`docs/decisions/`', '`docs/decisions/<epic>.md`',
]
for required in DESIGN_MARKERS:
    if required not in design_raw: err(f'flow-design missing machine-read marker or pointer target: {required!r}')

planning_raw=(ROOT/'omp/skills/flow-planning/SKILL.md').read_text()
planning=planning_raw.lower()
# Pin only what tools parse or other files name: the headings that other files
# point at, the Flow gate block the governance guard parses, the section 3 brief
# labels, the quality-gate receipt and lens labels, and the routing/tool names.
PLANNING_MARKERS=[
    '## 1. Establish the planning boundary', '## 2. Front-load consequential judgment',
    '## 3. Define executor discretion', '## 4. Plan quality gate — move review left',
    '## 5. Mark execution grade', '## 6. Execution handoff', '## External handoffs',
    'Flow gate:\n- Scope: <contract slug>\n- Contract: <path to the approved contract>\n',
    'Locked decisions:\n', 'Executor discretion:\n', 'Proof:\n', 'Escalate when:\n',
    '`Plan quality gate`', '**COR**', '**TTC**', '**CRF**', '**SEC**', 'execution-grade',
    '`flow-planner` (`@plan`)', '`flow_gate`', '`kind=plan`', '`flow-governance-guard`',
    '`.flow/plans/<slug>/PLAN.md`', '`plan-tasks/*.md`',
]
for required in PLANNING_MARKERS:
    if required not in planning_raw: err(f'flow-planning missing machine-read marker or pointer target: {required!r}')

execution_raw=(ROOT/'omp/skills/flow-execution/SKILL.md').read_text()
execution=execution_raw.lower()
# Pin only what tools parse or other files name: the brief templates Main copies
# into task briefs (the guards parse those), the flow_gate strings, and the
# headings/lane that flow-execution itself, docs/ARCHITECTURE.md and omp/AGENTS.md point at.
EXECUTION_MARKERS=[
    'Flow gate:\n- Scope: <contract slug>\n- Contract: <approved contract path>\n- Plan: <approved PLAN.md path>\n',
    'Plan: NONE', 'kind=implementation', 'flow_gate action=accept',
    'Verification ownership:\n- Focused proof: <commands/checks the writer must run>\n- Formatter: <scoped formatter command or concrete safety exception>\n- Focused static/build: <allowed/required checks>\n- Main-owned gates: <broader commands and why they stay with Main>\n',
    'Evidence capsule:\n- ID: <stable short id>\n- Owns: <one coherent scene family/device state/acceptance cluster>\n- Independent split check: none | <why the named evidence is inseparable>\n- Excludes: <other capsules left to fresh verifier sessions>\n- Restore obligation: NONE | <state that must be restored>\n',
    '## 8. Review proportionally', '## 9. Close execution', 'Main-direct lane',
]
for required in EXECUTION_MARKERS:
    if required not in execution_raw: err(f'flow-execution missing machine-read marker or pointer target: {required!r}')

# One normative home per doctrine rule. A phrase below may appear only in the
# files that own its rule; every other surface points at the home by name.
doctrine_surfaces=list((ROOT/'omp').rglob('*.md'))+[ROOT/'docs/ARCHITECTURE.md', ROOT/'docs/PRINCIPLES.md', ROOT/'README.md']
EXCLUSIVE={
    'synthetic input': {'omp/agents/flow-evidence-verifier.md'},
    'assistive-technology': {'omp/agents/flow-evidence-verifier.md'},
    'comparison scheme': {'omp/agents/flow-evidence-verifier.md', 'omp/rules/flow-evidence.md'},
    'independent split check:': {'omp/agents/flow-evidence-verifier.md', 'omp/skills/flow-execution/SKILL.md'},
    'reuse of unaffected capsules': {'omp/rules/flow-evidence.md'},
    'comments that narrate the code or contradict it': {'omp/skills/flow-review/references/review-lenses.md'},
    'applies to multi-unit work too': {'omp/skills/flow-execution/SKILL.md'},
    'only what the code and tests cannot show': {'omp/skills/flow-integrating/SKILL.md'},
    'what it leaves out': {'omp/skills/flow-integrating/SKILL.md'},
    'no rule edits or deletes a frozen ledger': {'omp/rules/flow-artifacts.md'},
    'never trust a record you have not checked': {'omp/skills/flow-design/SKILL.md'},
    'one parent contract': {'omp/skills/flow-design/SKILL.md'},
    'read that ledger once': {'omp/skills/flow-design/SKILL.md'},
    'start no unit before the parent is approved': {'omp/skills/flow-design/SKILL.md'},
    'do not manufacture questions': {'omp/skills/flow-design/SKILL.md'},
    'still-valid settled decisions': {'omp/skills/flow-design/SKILL.md'},
    'a validated external bundle may already contain': {'omp/skills/flow-planning/SKILL.md'},
    'refine only the missing how': {'omp/skills/flow-planning/SKILL.md'},
    'cor and crf always for the initial coherent change review': {'omp/skills/flow-review/SKILL.md'},
    'flip that exact item to `doing`': {'omp/skills/weft-worklog/SKILL.md'},
    'restore the prior': {'omp/skills/weft-worklog/SKILL.md'},
    'the code belongs to its author': {'omp/AGENTS.md'},
    'force-pushes': {'omp/rules/flow-safety.md'},
    'generic safety wrapper': {'omp/rules/flow-safety.md'},
    'never grants permission, approves a gate': {'omp/rules/flow-safety.md'},
    'scope proof by ownership': {'omp/rules/flow-evidence.md'},
    'concise defect statement': {'omp/skills/flow-review/references/review-lenses.md'},
}
for phrase,homes in EXCLUSIVE.items():
    for p in doctrine_surfaces:
        if phrase in p.read_text().lower() and rel(p) not in homes: err(f'{rel(p)}: doctrine phrase duplicated outside its home: {phrase}')
    for home in homes:
        if phrase not in (ROOT/home).read_text().lower(): err(f'{home}: doctrine home lost its rule: {phrase}')
POINTS_TO={
    'omp/agents/flow-implementer.md': ['stakeholder-visible write (`flow-safety`)'],
    'omp/skills/flow-tdd/SKILL.md': ['`flow-evidence` rule'],
    'omp/skills/flow-integrating/SKILL.md': ['(`flow-safety`)', '`flow-evidence` rule', '`Plan: NONE`'],
    'omp/skills/flow-review/references/pr-review.md': ['PR-review rule in `AGENTS.md`'],
    'omp/skills/weft-worklog/SKILL.md': ['PR-review rule in `AGENTS.md`'],
    'omp/skills/flow-review/references/audit-lenses.md': ['`skill://flow-review/references/review-lenses.md`'],
    'omp/agents/flow-plan-executor.md': ['stakeholder-visible write (`flow-safety`)'],
    'omp/agents/flow-evidence-verifier.md': ['stakeholder-visible write (`flow-safety`)'],
    'omp/skills/flow-execution/SKILL.md': ['Isolation follows the `flow-safety` rule', 'approves nothing (`flow-safety`)', 'defined once in `flow-evidence-verifier`', 'self-consistency rule in `flow-evidence`', 'stability barrier defined in the `flow-evidence` rule', 'change-lens selection in `flow-review`'],
    'docs/ARCHITECTURE.md': ['`flow-execution` section 9', '`flow-evidence` rule', '`flow-evidence-verifier` alone defines'],
    'docs/PRINCIPLES.md': ['`flow-evidence-verifier` alone defines', '`flow-evidence` rule alone owns'],
    'omp/agents/flow-craft-reviewer.md': ['CRF defect list in `skill://flow-review/references/review-lenses.md`'],
    'omp/agents/flow-acceptance-reviewer.md': ['CRF defect list in `skill://flow-review/references/review-lenses.md`'],
    'omp/skills/flow-planning/SKILL.md': ['`flow-design` "Multi-unit work"', '`flow-design` step 7 says what counts as that approval', '`flow-execution` section 1 says what does not count as plan approval', '`flow-execution` routes each writer (section 2), orders and isolates the tasks (section 3) and writes the briefs (section 4)'],
    'omp/AGENTS.md': ['`flow-design` says how to keep settled decisions', '`flow-planning` says when an external plan already counts as execution-grade', 'stakeholder-visible write (`flow-safety`)', '(`flow-planning` section 1, `flow-execution` section 1)', '`flow-review` owns lens review', '`weft-worklog` Mode C says when to mark an item'],
}
for path,pointers in POINTS_TO.items():
    text=(ROOT/path).read_text()
    for ptr in pointers:
        if ptr not in text: err(f'{path}: pointer to doctrine home missing: {ptr}')

external_raw=(ROOT/'omp/skills/flow-external-session/SKILL.md').read_text()
external=external_raw.lower()
# Pin only what tools parse or other files name: the skill name and title, the
# three mode names and their headings, the reference and script paths, the
# handoff field, and the flow-design and flow-planning pointers.
EXTERNAL_MARKERS=[
    'name: flow-external-session\n', '\n# Flow external session\n', 'task/Agent Hub',
    '**external worktree validation**', '**worker handoff**', '**planning handoff intake**',
    '## External worktree', '## Worker handoff', '## Planning handoff intake',
    '`references/external-worktree.md`', '`references/planning-handoff.md`',
    '`scripts/validate-planning-handoff.py`',
    '`implementation_strategy: settled`', "`flow-design`'s contract-formation stage",
    '`flow-planning` "External handoffs"',
]
for required in EXTERNAL_MARKERS:
    if required not in external_raw: err(f'flow-external-session missing machine-read marker or pointer target: {required!r}')

ph=(ROOT/'omp/skills/flow-external-session/references/planning-handoff.md').read_text().lower()
schema_path=ROOT/'omp/skills/flow-external-session/references/planning-handoff.schema.json'
if not schema_path.exists(): err('planning-handoff JSON schema missing')
else:
    schema=json.loads(schema_path.read_text())
    if schema.get('properties',{}).get('authorization',{}).get('const') != 'not-carried': err('planning-handoff schema authorization boundary missing')
    if schema.get('additionalProperties') is not False: err('planning-handoff schema must reject unknown fields')
    props=schema.get('properties',{})
    enum_fields=[field for field,spec in props.items() if spec.get('enum')]
    if not enum_fields: err('planning-handoff schema has no enum fields')
    for field in ('design_status', 'implementation_strategy'):
        if field not in enum_fields: err(f'planning-handoff schema lost the enum for {field}')
    emitter_path=ROOT/'open-webui/flow-handoff.md'
    emitter=emitter_path.read_text() if emitter_path.exists() else ''
    if not emitter: err('open-webui/flow-handoff.md: handoff emitter missing')
    # The reference and the Open WebUI emitter restate each enum as a `- \`field\`: \`a\`, \`b\`` line; each must list exactly the schema's values.
    for label,doc in (('planning-handoff.md', ph), ('open-webui/flow-handoff.md', emitter)):
        for field in enum_fields:
            spec=props[field]
            line=next((l for l in doc.splitlines() if l.startswith(f'- `{field}`:')), '')
            listed=re.findall(r'`([^`]+)`', line)[1:]
            if listed!=spec['enum']: err(f'{label} `{field}` values {listed} differ from the schema enum {spec["enum"]}')
    # The emitter's manifest template names every required field and sets every schema constant.
    for field in schema.get('required',[]):
        if f'"{field}":' not in emitter: err(f'open-webui/flow-handoff.md: manifest template missing required field {field}')
    for field,spec in props.items():
        if 'const' in spec and f'"{field}": {json.dumps(spec["const"])}' not in emitter: err(f'open-webui/flow-handoff.md: manifest template must set {field} to {json.dumps(spec["const"])}')
for required in ['`flow-handoff.json`', '`handoff.md`', '`references/planning-handoff.schema.json`', '"flow_handoff": 2', '"authorization": "not-carried"', '`implementation_strategy: settled`', 'validate-planning-handoff.py', '## manifest schema v2', '## receiving-side validation', '## decide what happens next']:
    if required not in ph: err(f'planning-handoff missing machine-read marker or pointer target: {required!r}')


interop=(ROOT/'docs/EXTERNAL-INTEROP.md').read_text().lower()
for required in ['`flow-planning`', '`flow-design`', '`flow-handoff.json`', '`open-webui/`', '## synchronization discipline']:
    if required not in interop: err(f'docs/EXTERNAL-INTEROP.md missing marker: {required!r}')

compat=(ROOT/'docs/OMP-COMPATIBILITY.md').read_text().lower()
for required in ['omp 18.2.10', 'policy: prompt', '`formatapprovaldetails`', '`flow_gate`', '`tool_call`', '## upgrade smoke test']:
    if required not in compat: err(f'docs/OMP-COMPATIBILITY.md missing marker: {required!r}')
for stale in ['long bounded waits', 'keeps interactive main out of bare/job waits']:
    if stale in compat: err(f'OMP compatibility stale wait doctrine survived: {stale}')

doctrine_drift=[
    ('flow-planning', planning, 'for substantial planning, main/controller should prefer dispatching'),
    ('flow-execution-wait', execution, 'never wait merely to observe'),
    ('flow-execution', execution, '- tiny cohesive edit where spawn overhead exceeds the work → main may implement directly under `flow-tdd`;'),
    ('flow-external-session', external, 'skip a redundant native plan when the implementation strategy is already current and sufficiently specified'),
    ('planning-handoff', ph, 'design and implementation strategy settled/current → skip a redundant plan call'),
]
for label,text,bad in doctrine_drift:
    if bad in text: err(f'{label}: stale doctrine survived: {bad}')

evidence_raw=(ROOT/'omp/rules/flow-evidence.md').read_text()
# Pin only what tools parse or other files name: the rule name and title, the
# claim, tool and receipt names the rule defines, and the concepts that
# flow-execution, docs/ARCHITECTURE.md and docs/PRINCIPLES.md point at.
EVIDENCE_MARKERS=[
    'name: flow-evidence\n', '\n# Flow evidence\n',
    '`tests pass`', '`build works`', '`bug fixed`',
    '`flow_gate`', '`MATCH`', '`UNKNOWN`', '`before`', '`after`',
    '`git diff --exit-code <file>`', '`HEAD`',
    'Writers verify their own work', 'Scope proof by ownership', 'claim relevance',
    'stability barrier', 'self-consistent',
]
for required in EVIDENCE_MARKERS:
    if required not in evidence_raw: err(f'flow-evidence missing machine-read marker or pointer target: {required!r}')

artifacts=(ROOT/'omp/rules/flow-artifacts.md').read_text()
for required in ['<!-- flow-exclude-guard -->', '<!-- /flow-exclude-guard -->', "printf '/.flow/\\n'", 'contracts/<slug>.md', 'plans/<slug>/PLAN.md', 'ldd/<epic>/', 'checkpoints/<head>.md', 'evidence/<head>/<capsule-id>/', 'runtime/gates.json', '`docs/decisions/`', '`docs/reports/`', '`.gitignore`', '`.flow/runtime/`', '`flow_gate`', '`flow-integrating`', '## Frozen LDD ledgers', '## Lifecycle']:
    if required not in artifacts: err(f'flow-artifacts missing machine-read marker or pointer target: {required!r}')
for path,required in [
    ('omp/skills/flow-design/SKILL.md', '.flow/contracts/<slug>.md'),
    ('omp/skills/flow-planning/SKILL.md', '.flow/plans/<slug>/PLAN.md'),
    ('omp/skills/flow-execution/SKILL.md', '.flow/checkpoints/<head>.md'),
    ('omp/skills/flow-execution/SKILL.md', '.flow/evidence/<head>/<capsule-id>/'),
    ('omp/agents/flow-evidence-verifier.md', '.flow/evidence/<head>/<capsule-id>/'),
    ('omp/skills/flow-integrating/SKILL.md', 'flow-artifacts'),
    ('omp/skills/flow-integrating/SKILL.md', 'docs/decisions/<slug>.md'),
    ('docs/PRINCIPLES.md', 'personal exclude guard'),
    ('docs/ARCHITECTURE.md', '## Artifacts'),
    ('README.md', 'flow-artifacts'),
]:
    if required not in (ROOT/path).read_text(): err(f'{path}: flow-artifacts path/pointer missing: {required}')
safety=(ROOT/'omp/rules/flow-safety.md').read_text()
for required in ['name: flow-safety\n', '\n# Flow safety\n', '`flow-plan-executor`', '`HEAD`', '`main`/`master`']:
    if required not in safety: err(f'flow-safety missing machine-read marker: {required!r}')

tdd=(ROOT/'omp/skills/flow-tdd/SKILL.md').read_text()
for required in ['name: flow-tdd\n', '## Cycle', '**RED**', '**GREEN**', '**REFACTOR**', '## Legitimate non-TDD surfaces']:
    if required not in tdd: err(f'flow-tdd missing machine-read marker: {required!r}')

review_raw=(ROOT/'omp/skills/flow-review/SKILL.md').read_text()
# Pin only what tools parse or other files name: the skill name and title, the
# mode names and reference paths, the headings and selection rules other files
# point at, the lens routes, the disposition labels and the two pointer sentences.
REVIEW_MARKERS=[
    'name: flow-review\n', '\n# Flow review\n',
    '**Local/change review**', '**PR reviewer**', '**Author feedback**', '**Codebase audit**', 'PR reviewer mode',
    '`references/pr-review.md`', '`references/author-feedback.md`', '`references/audit.md`',
    '`references/review-lenses.md`', '`references/audit-lenses.md`', '`review_tmp`', 'pinned review checkout',
    '## Shared evidence contract', '## Change-lens selection', '## Publication gate',
    'TTC only when', 'SEC only when',
    '`reviewer`', '`flow-ttc-reviewer`', '`flow-craft-reviewer`', '`security-reviewer`', '`security_scan`',
    '`COR run`', '`CRF run`', '`TTC run/skip + reason`', '`SEC run/skip + reason`',
    'mutation-safe verification rules in `references/pr-review.md`',
    'shared `review_tmp` convention in `references/github-operations.md`',
]
for required in REVIEW_MARKERS:
    if required not in review_raw: err(f'flow-review missing machine-read marker or pointer target: {required!r}')

pr_review=(ROOT/'omp/skills/flow-review/references/pr-review.md').read_text()
for required in ['# PR reviewer mode', 'pinned review checkout', '`review_tmp`', '`github-operations.md`', '`review-lenses.md`', '`references/github-operations.md`']:
    if required not in pr_review: err(f'flow-review pr-review.md missing machine-read marker or pointer target: {required!r}')

github_ops=(ROOT/'omp/skills/flow-review/references/github-operations.md').read_text()
for required in [
    'review_tmp=$(mktemp -d "${TMPDIR:-/tmp}/flow-review.XXXXXX")',
    '"$review_tmp/packet"',
    '"$review_tmp/worktree"',
    'git worktree remove',
    'rm -rf -- "${review_tmp:?review_tmp not set}"',
]:
    if required not in github_ops:
        err(f'flow-review temporary-workspace invariant missing: {required}')
author_ops=(ROOT/'omp/skills/flow-review/references/author-operations.md').read_text()
for required in [
    'packet_dir="$review_tmp/feedback"',
    'mkdir -p "$packet_dir"',
]:
    if required not in author_ops:
        err(f'flow-review author-feedback temporary-workspace invariant missing: {required}')
if 'flow-pr-feedback.XXXXXX' in author_ops:
    err('flow-review author-feedback retained a separate temp-root convention')

integrating=(ROOT/'omp/skills/flow-integrating/SKILL.md').read_text()
for required in ['## 1. Prove local completion', '## 2. Record the decisions', '## 4. Ask for the integration decision', '## 5. After integration', '`flow_gate action=status`', '`flow_gate action=clear`', '`docs/decisions/<slug>.md`', '`.flow/contracts/<slug>.md`']:
    if required not in integrating: err(f'flow-integrating missing machine-read marker or pointer target: {required!r}')

agents_md=(ROOT/'omp/AGENTS.md').read_text()
# Pin only what other files name and the exact skill, agent and tool names that
# route behavior: the heading README.md names, the shell-check commands, and the
# Flow routing names. The prose itself is not pinned.
AGENTS_MARKERS=[
    '## Codebase graph lookup', 'Context7', '`codebase-memory`', '`index_status`', '`index_repository`',
    'ps -p $$ -o comm=\nbasename "$SHELL"\n',
    '`flow-design`', '`flow-planning`', '`flow-planner`', '`flow_gate`',
    '`flow-plan-executor` (`@execute`)', '`flow-implementer` (`@task`)', '`sonic` (`@smol`)',
    '`flow-acceptance-reviewer`', 'Main-direct lane', '`flow-execution`',
    '**forward pointer**', 'OMP `eval`', '`weft-worklog`', '`docs/PRINCIPLES.md`',
]
for required in AGENTS_MARKERS:
    if required not in agents_md: err(f'omp/AGENTS.md missing machine-read marker or pointer target: {required!r}')
if 'for ordinary work, the main session may code' in agents_md.lower():
    err('AGENTS: blanket Main coding permission survived')

weft_worklog=(ROOT/'omp/skills/weft-worklog/SKILL.md').read_text()
for required in ['## Mode A — query open work', '## Mode B — log completed work', '## Mode C — Flow lifecycle', '**Before work**', '**After work**', '**PR reviewer ownership exception**', '`references/conventions.md`', '`references/voice.md`', '`references/page-archetypes.md`']:
    if required not in weft_worklog: err(f'weft-worklog missing machine-read marker or pointer target: {required!r}')


# The Weft reference copies are deliberately duplicated per skill; they must stay byte-identical.
weft_master=ROOT/'omp/skills/weft-worklog/references'
for other,names in [('weft-memory',['conventions.md','voice.md']),('weft-maintenance',['conventions.md','voice.md','page-archetypes.md'])]:
    for name in names:
        a=weft_master/name; b=ROOT/'omp/skills'/other/'references'/name
        if not b.exists(): err(f'missing Weft reference copy: {rel(b)}'); continue
        if a.read_bytes()!=b.read_bytes(): err(f'Weft reference copies differ: {rel(a)} vs {rel(b)}')

# Asset references in a SKILL.md resolve from the skill directory; in references/*.md from the reference
# directory or the skill directory.
asset_re=re.compile(r'`((?:\.\./)?(?:references|scripts)/[^`\s<>]+)`|\]\(([^)\s]+\.md)\)')
for doc in skills+list((ROOT/'omp/skills').glob('*/references/*.md')):
    bases=[doc.parent] if doc in skills else [doc.parent, doc.parent.parent]
    for m in asset_re.finditer(doc.read_text()):
        asset=m.group(1) or m.group(2)
        if asset.startswith('http'): continue
        if not any((base/asset).exists() for base in bases): err(f'{rel(doc)}: missing referenced asset {asset}')

# Every authored text file ends with a newline.
tracked=subprocess.run(['git','ls-files','-z'],cwd=ROOT,capture_output=True,text=True,check=True).stdout.split('\0')
for path in tracked:
    if not path or path.startswith('tests/fixtures/'): continue
    f=ROOT/path
    if f.suffix in {'.md','.ts','.mjs','.py','.sh','.yml','.json','.ps1'} or path.startswith('omp/bin/'):
        data=f.read_bytes()
        if data and not data.endswith(b'\n'): err(f'{path}: missing final newline')


# Every native provider profile must expose the same complete role vocabulary.
required_roles={'default','smol','tiny','vision','execute','task','plan','slow','review_aux','critical','commit'}
profile_cfgs={
    'openai-codex': ROOT/'omp/profiles/openai-codex/config.yml',
    'anthropic': ROOT/'omp/profiles/anthropic/config.yml',
    'commandcode': ROOT/'omp/profiles/commandcode/config.yml',
}
profile_roles={}
for profile,path in profile_cfgs.items():
    if not path.exists():
        err(f'missing profile config: {rel(path)}')
        continue
    cfg=yaml.safe_load(path.read_text()) or {}
    # With consent granted, OMP stores tool-issue reports and pushes them to its collector.
    if (cfg.get('dev') or {}).get('autoqaConsent') != 'denied': err(f'{rel(path)}: dev.autoqaConsent must be denied')
    roles=cfg.get('modelRoles') or {}
    if set(roles) != required_roles:
        err(f'{rel(path)}: modelRoles mismatch: {sorted(set(roles)^required_roles)}')
    profile_roles[profile]=set(roles)
    prefix=profile+'/'
    for role,model in roles.items():
        if not isinstance(model,str) or not model.startswith(prefix):
            err(f'{rel(path)}: modelRoles.{role} must use {prefix}*, got {model!r}')

expected_openai={
    'default':'openai-codex/gpt-6-luna:auto',
    'smol':'openai-codex/gpt-6-luna:low',
    'tiny':'openai-codex/gpt-6-luna:low',
    'vision':'openai-codex/gpt-6-luna:medium',
    'execute':'openai-codex/gpt-6-luna:xhigh',
    'task':'openai-codex/gpt-6.1-sol:medium',
    'plan':'openai-codex/gpt-6.1-sol:high',
    'slow':'openai-codex/gpt-6.1-sol:high',
    'review_aux':'openai-codex/gpt-6.1-sol:high',
    'critical':'openai-codex/gpt-6.1-sol:xhigh',
    'commit':'openai-codex/gpt-6-luna:low',
}
openai=yaml.safe_load(profile_cfgs['openai-codex'].read_text()).get('modelRoles',{})
if openai != expected_openai:
    err('omp/profiles/openai-codex/config.yml: role mapping drifted from documented routing')

expected_anthropic={
    'default':'anthropic/claude-opus-5-5:medium',
    'smol':'anthropic/claude-sonnet-5-5:low',
    'tiny':'anthropic/claude-haiku-5-5:medium',
    'vision':'anthropic/claude-sonnet-5-5:medium',
    'execute':'anthropic/claude-sonnet-5-5:medium',
    'task':'anthropic/claude-sonnet-5-5:high',
    'plan':'anthropic/claude-fable-5-1:high',
    'slow':'anthropic/claude-opus-5-5:medium',
    'review_aux':'anthropic/claude-sonnet-5-5:high',
    'critical':'anthropic/claude-fable-5-1:high',
    'commit':'anthropic/claude-sonnet-5-5:low',
}
anthropic=yaml.safe_load(profile_cfgs['anthropic'].read_text()).get('modelRoles',{})
if anthropic != expected_anthropic:
    err('omp/profiles/anthropic/config.yml: role mapping drifted from documented routing')

expected_commandcode={
    'default':'commandcode/deepseek/deepseek-v4.1-flash:high',
    'smol':'commandcode/deepseek/deepseek-v4.1-flash:low',
    'tiny':'commandcode/deepseek/deepseek-v4.1-flash:low',
    'vision':'commandcode/deepseek/deepseek-v4.1-flash:high',
    'execute':'commandcode/deepseek/deepseek-v4.1-flash:high',
    'task':'commandcode/deepseek/deepseek-v4.1-flash:high',
    'plan':'commandcode/deepseek/deepseek-v4.1-flash:high',
    'slow':'commandcode/zai-org/GLM-5.3:high',
    'review_aux':'commandcode/deepseek/deepseek-v4.1-flash:high',
    'critical':'commandcode/zai-org/GLM-5.3:high',
    'commit':'commandcode/deepseek/deepseek-v4.1-flash:low',
}
commandcode=yaml.safe_load(profile_cfgs['commandcode'].read_text()).get('modelRoles',{})
if commandcode != expected_commandcode:
    err('omp/profiles/commandcode/config.yml: role mapping drifted from documented routing')

# Every v8 provider baseline carries the external-effect approval backstop.
# The profiles are the single source of truth for the pattern list; the
# copies must be identical and tests/bash-patterns.test.mjs proves the list
# against a port of OMP's matcher.
pattern_lists={}
for profile,path in profile_cfgs.items():
    cfg=yaml.safe_load(path.read_text()) or {}
    approval=((cfg.get('tools') or {}).get('approval') or {})
    if 'eval' in approval: err(f'{rel(path)}: blanket tools.approval.eval must remain unset')
    patterns=(cfg.get('bash') or {}).get('patterns') or []
    pattern_lists[profile]=[(p.get('match'),p.get('approval')) for p in patterns if isinstance(p,dict)]
    pattern_map=dict(pattern_lists[profile])
    for command in [
        'git push*',
        'gh pr create*',
        'gh pr merge*',
        'gh pr review*',
        'gh pr comment*',
        'gh pr edit*',
        'gh pr close*',
        'gh issue comment*',
        'gh release create*',
        'gh api -X*', 'gh api * -X*',
        'gh api --method*', 'gh api * --method*',
        'gh api -f*', 'gh api * -f*',
        'gh api -F*', 'gh api * -F*',
        'gh api --field*', 'gh api * --field*',
        'gh api --raw-field*', 'gh api * --raw-field*',
        'gh api --input*', 'gh api * --input*',
    ]:
        if pattern_map.get(command) != 'prompt': err(f'{rel(path)}: publication prompt missing for {command}')
    if 'gh api*' in pattern_map: err(f'{rel(path)}: broad gh api* prompt must stay narrowed to method/body flags')
    for match,_ in pattern_lists[profile]:
        if match.startswith('tea '): err(f'{rel(path)}: Forgejo pattern survived: {match}')
if len({tuple(v) for v in pattern_lists.values()})!=1: err('profiles: bash.patterns lists differ between profiles')

# Every role-backed Flow agent must resolve in every managed provider profile.
for p in agents:
    fm,_=frontmatter(p)
    model=fm.get('model')
    if isinstance(model,str) and model.startswith('@'):
        role=model[1:]
        for profile,roles in profile_roles.items():
            if role not in roles:
                err(f'{rel(p)}: role {model} missing from {profile} profile')

# The principle-preservation ledger must account for every old skill from ai-stack.
old={
'blog-post','find-todo','flow-auditing-codebases','flow-brainstorming','flow-debugging',
'flow-executing-plans','flow-finishing','flow-handover','flow-ldd','flow-mailbox',
'flow-receiving-pr-reviews','flow-reviewing-prs','flow-tdd','flow-using-skills',
'flow-verification','flow-workspace','flow-writing-plans','forgejo','frontend-design',
'journal-update','memory-gc','memory-update','recall-memory','retrofit'}
ledger=(ROOT/'docs/PRINCIPLES.md').read_text()
for name in sorted(old):
    if f'`{name}`' not in ledger: err(f'docs/PRINCIPLES.md: old skill not accounted for: {name}')

principles=ledger.lower()
# The invariant ledger keeps its numbering: deleting an invariant is a deliberate renumbering.
invariants=ledger.split('## Non-negotiable invariants',1)[-1]
numbers=[int(n) for n in re.findall(r'^(\d+)\. ', invariants, re.M)]
if numbers!=list(range(1,43)): err(f'docs/PRINCIPLES.md: non-negotiable invariants must be numbered 1-42, got {numbers}')
for required in ['## Skill design principles', '## Skill sweep ledger', '## Non-negotiable invariants', '`docs/FIELD-TRIAL-AUDIT.md` section 6', '`tests/doctrine-budget.json`']:
    if required not in ledger: err(f'docs/PRINCIPLES.md missing marker: {required!r}')
if 'unresolved semantic/debugging/integration judgment → main/`@task`' in principles:
    err('docs/PRINCIPLES.md: ambiguous Main semantic-writer routing survived')

field_trials_path=ROOT/'docs/FIELD-TRIALS.md'
if not field_trials_path.exists():
    err('docs/FIELD-TRIALS.md: skill-scoped field-trial ledger missing')
else:
    field_trials=field_trials_path.read_text()
    flow_skill_names=sorted(name for name in expected if name.startswith('flow-'))
    for name in flow_skill_names:
        if f'| `{name}` |' not in field_trials:
            err(f'docs/FIELD-TRIALS.md: missing Flow skill row: {name}')
    marks=re.findall(r'^\| `flow-[^`]+` \| ([012]/2) \|', field_trials, re.M)
    if len(marks) != len(flow_skill_names):
        err('docs/FIELD-TRIALS.md: every Flow skill row must carry one 0/2, 1/2 or 2/2 mark')
    for required in ['## Rules', '## Current baseline', '## Trial-failing breaks', '## Recorded slips', '## Historical clean evidence', '`docs/FIELD-TRIAL-AUDIT.md`']:
        if required not in field_trials:
            err(f'docs/FIELD-TRIALS.md missing marker: {required!r}')

routing_doc=(ROOT/'docs/MODEL-ROUTING.md').read_text()
for stale in ['copies a baseline only', 'never overwrites profile-owned', 'and `tools.approval.eval: prompt`', 'Bash/forge']:
    if stale in routing_doc: err(f'docs/MODEL-ROUTING.md stale installer/approval doctrine survived: {stale}')
for profile,path in profile_cfgs.items():
    header=path.read_text().splitlines()[1]
    if 'copies this file' in header: err(f'{rel(path)}: stale copy-once header comment')
compat_text=(ROOT/'docs/OMP-COMPATIBILITY.md').read_text()
for required in ['78b7531', 'tests/bash-patterns.test.mjs', 'GH_TOKEN=x gh api']:
    if required not in compat_text: err(f'OMP compatibility matcher note missing: {required}')
migration=(ROOT/'docs/MIGRATION.md').read_text().lower()
for stale in ['are not overwritten by `flow-omp install`**, so merge', 'bash/forge']:
    if stale in migration: err(f'docs/MIGRATION.md stale installer doctrine survived: {stale}')

# Claude Code port: a plugin in claude-code/, listed by the root marketplace.
port=ROOT/'claude-code'
plugin=json.loads((port/'.claude-plugin/plugin.json').read_text())
market=json.loads((ROOT/'.claude-plugin/marketplace.json').read_text())
if [(p['name'],p['source']) for p in market['plugins']]!=[(plugin['name'],'./claude-code')]:
    err('.claude-plugin/marketplace.json: must list exactly the claude-code plugin under its plugin.json name')
port_skills=list((port/'skills').glob('*/SKILL.md'))
port_agents=list((port/'agents').glob('*.md'))
for p in port_skills+port_agents:
    fm,_=frontmatter(p)
    expected=p.parent.name if p.name=='SKILL.md' else p.stem
    if not fm or fm.get('name')!=expected or not fm.get('description'): err(f'{rel(p)}: frontmatter needs name {expected} and a description')
    if p in port_agents and fm and not re.fullmatch(r'opus|sonnet|haiku|inherit|claude-(?:fable|opus|sonnet|haiku)-\d+-\d+', str(fm.get('model'))): err(f'{rel(p)}: model must be a Claude Code alias or a claude-<family>-<n>-<n> id')
# Routing by OMP role: agents that share a role share a model and an effort in each port,
# and effort follows the matching OMP profile. The COR reviewer exists only in the ports.
ROLE_OF={}
for _p in (ROOT/'omp/agents').glob('*.md'):
    _fm,_=frontmatter(_p)
    if str(_fm.get('model','')).startswith('@'): ROLE_OF[_fm['name']]=_fm['model'][1:]
ROLE_OF['flow-cor-reviewer']='review_aux'
EFFORTS={'low','medium','high','xhigh','max'}
def omp_route(profile,role):
    value=yaml.safe_load(profile_cfgs[profile].read_text())['modelRoles'][role]
    model,sep,effort=value.rpartition(':')
    return (model,effort) if sep else (value,None)
def omp_model(profile,role): return omp_route(profile,role)[0]
def omp_effort(profile,role): return omp_route(profile,role)[1]
# OMP's Anthropic model ids under each Claude port's own names: (Claude Code, claude-agent).
ANTHROPIC_PORT_NAMES={
    'anthropic/claude-opus-5-5':('opus','opus'),
    'anthropic/claude-sonnet-5-5':('sonnet','sonnet'),
    'anthropic/claude-haiku-5-5':('haiku','haiku'),
    'anthropic/claude-fable-5-1':('claude-fable-5-1','fable'),
}
def port_model(profile,harness,role):
    """The OMP role's model as the harness (`claude-code`, `claude-agent` or `commandcode`) names it."""
    model=omp_model(profile,role)
    if profile!='anthropic': return model
    if model not in ANTHROPIC_PORT_NAMES: err(f'{rel(profile_cfgs[profile])}: no Claude port name for {model}'); return None
    code,agent=ANTHROPIC_PORT_NAMES[model]
    return code if harness=='claude-code' else f'claude-agent/{agent}'
def check_roles(label,rows):
    by_role={}
    for name,route in rows.items():
        if name not in ROLE_OF: err(f'{label}: agent {name} has no OMP role'); continue
        by_role.setdefault(ROLE_OF[name],{}).setdefault(route,[]).append(name)
    for role,routes in by_role.items():
        if len(routes)>1: err(f'{label}: agents of role {role} disagree on model/effort: {sorted(map(str,routes))}')
claude_routes={}
for p in port_agents:
    fm,_=frontmatter(p)
    claude_routes[p.stem]=(fm.get('model'),fm.get('effort'))
    if fm.get('effort') not in EFFORTS: err(f'{rel(p)}: effort must be one of {sorted(EFFORTS)}, got {fm.get("effort")!r}')
    elif p.stem in ROLE_OF and fm['effort']!=omp_effort('anthropic',ROLE_OF[p.stem]): err(f'{rel(p)}: effort {fm["effort"]} differs from the OMP anthropic profile ({omp_effort("anthropic",ROLE_OF[p.stem])}) for role {ROLE_OF[p.stem]}')
    if p.stem in ROLE_OF and fm.get('model')!=port_model('anthropic','claude-code',ROLE_OF[p.stem]): err(f'{rel(p)}: model {fm.get("model")} differs from the OMP anthropic profile ({port_model("anthropic","claude-code",ROLE_OF[p.stem])}) for role {ROLE_OF[p.stem]}')
check_roles('claude-code/agents',claude_routes)
port_docs=port_skills+port_agents+list((port/'skills').glob('*/references/*.md'))+list((port/'hooks').glob('*.md'))
for p in port_docs:
    text=p.read_text()
    for omp_only in ['flow_gate','skill://','`hub`','hub wait','@task','@execute','@slow','@smol','@plan','@vision','@review_aux','`sonic`','`scout`']:
        if omp_only in text: err(f'{rel(p)}: OMP-only mechanic in the Claude Code port: {omp_only}')
for path in ['skills/flow-tdd/SKILL.md','skills/ui-design/SKILL.md']:
    if (port/path).read_bytes()!=(ROOT/'omp'/path).read_bytes(): err(f'claude-code/{path}: verbatim mirror drifted from omp/{path}')
for path in ['skills/weft-worklog/references/voice.md','skills/weft-worklog/references/page-archetypes.md']:
    if (port/path).read_bytes()!=(ROOT/'omp'/path).read_bytes(): err(f'claude-code/{path}: verbatim mirror drifted from omp/{path}')
for other,names in [('weft-memory',['conventions.md','voice.md']),('weft-maintenance',['conventions.md','voice.md','page-archetypes.md'])]:
    for name in names:
        if (port/'skills/weft-worklog/references'/name).read_bytes()!=(port/'skills'/other/'references'/name).read_bytes(): err(f'claude-code/skills/{other}/references/{name}: Weft reference copies differ')
for path in ['references/planning-handoff.schema.json','scripts/validate-planning-handoff.py']:
    if (port/'skills/flow-external-session'/path).read_bytes()!=(ROOT/'omp/skills/flow-external-session'/path).read_bytes(): err(f'claude-code/skills/flow-external-session/{path}: verbatim mirror drifted')
# Claude Code keeps only about 2 KB of SessionStart hook output in context.
core=subprocess.run(['sh',str(port/'hooks/session-start.sh')],env={'CLAUDE_PLUGIN_ROOT':port.as_posix(),'PATH':os.environ['PATH'],**{k:os.environ[k] for k in ('SYSTEMROOT','TEMP','TMP') if k in os.environ}},capture_output=True,text=True,check=True).stdout
if len(core.encode())>1900: err(f'claude-code/hooks/session-start.sh: prints {len(core.encode())} bytes; keep it under 1900')
if (port/'hooks/flow-context.md').as_posix() not in core: err('claude-code/hooks/session-start.sh: core must point at the full flow-context.md path')

# OpenCode port: opencode/, installed under ~/.config/opencode by opencode/bin/flow-opencode.
oport=ROOT/'opencode'
OPORT_AGENTS={'flow-acceptance-reviewer','flow-audit-code-health','flow-audit-docs','flow-audit-tests','flow-cor-reviewer','flow-craft-reviewer','flow-implementer','flow-plan-executor','flow-planner','flow-ttc-reviewer'}
OPORT_READ_ONLY=OPORT_AGENTS-{'flow-implementer','flow-plan-executor','flow-planner'}
OPORT_AUDIT={'flow-audit-code-health','flow-audit-docs','flow-audit-tests'}
OPORT_MODEL_LEAK=re.compile(r'claude-agent/|opencode/[a-z0-9.-]*-free|big-pickle|nemotron|flint-40b')
OPORT_SKILLS={p.parent.name for p in skills}-{'blog-post'}  # `expected` and `names` are rebound by earlier blocks
oport_skills=list((oport/'skills').glob('*/SKILL.md'))
oport_agents=list((oport/'agents').glob('*.md'))
oport_docs=oport_skills+oport_agents+list((oport/'skills').glob('*/references/*.md'))+[oport/'AGENTS.md']
if {p.parent.name for p in oport_skills}!=OPORT_SKILLS: err(f'opencode/skills: skill set mismatch: {sorted({p.parent.name for p in oport_skills}^OPORT_SKILLS)}')
if {p.stem for p in oport_agents}!=OPORT_AGENTS: err(f'opencode/agents: agent set mismatch: {sorted({p.stem for p in oport_agents}^OPORT_AGENTS)}')
for p in oport_skills:
    fm,_=frontmatter(p)
    if not fm or fm.get('name')!=p.parent.name or not fm.get('description'): err(f'{rel(p)}: frontmatter needs name {p.parent.name} and a description')
for path in ['skills/flow-tdd/SKILL.md','skills/ui-design/SKILL.md','skills/weft-worklog/references/voice.md','skills/weft-worklog/references/page-archetypes.md','skills/flow-external-session/references/planning-handoff.schema.json','skills/flow-external-session/references/external-worktree.md','skills/flow-external-session/scripts/validate-planning-handoff.py','skills/flow-review/references/author-operations.md']:
    if not (oport/path).exists() or (oport/path).read_bytes()!=(ROOT/'omp'/path).read_bytes(): err(f'opencode/{path}: verbatim mirror missing or drifted from omp/{path}')
for skill,names_ in [('weft-memory',['conventions.md','voice.md']),('weft-maintenance',['conventions.md','voice.md','page-archetypes.md'])]:
    for name_ in names_:
        src=oport/'skills/weft-worklog/references'/name_
        dst=oport/'skills'/skill/'references'/name_
        if not dst.exists() or not src.exists() or dst.read_bytes()!=src.read_bytes(): err(f'opencode/skills/{skill}/references/{name_}: must be byte-equal to weft-worklog/references/{name_}')
oport_agents_md=oport/'AGENTS.md'
if not oport_agents_md.exists(): err('opencode/AGENTS.md: missing')
else:
    oport_ctx=oport_agents_md.read_text()
    for marker in ['# Flow (flow-skills, OpenCode port)','## Approval record','flow_approve() {','flow_check() {','.flow/runtime/approvals.log','`subagent`','`skill`','`general`','`explore`','`flow-plan-executor`','`flow-implementer`','`flow-acceptance-reviewer`','## Harness: [[OpenCode]]','<!-- flow-exclude-guard -->',"printf '/.flow/\\n'",'## Safety','## Evidence','## Flow artifacts','`execute`']:
        if marker not in oport_ctx: err(f'opencode/AGENTS.md missing marker: {marker!r}')
    def approval_functions(text):
        start=text.find('flow_approve() {'); end=text.find('\n}\n',text.find('flow_check() {'))
        return text[start:end+3] if start>=0 and end>=0 else None
    if approval_functions(oport_ctx)!=approval_functions((ROOT/'claude-code/hooks/flow-context.md').read_text()) or approval_functions(oport_ctx) is None:
        err('opencode/AGENTS.md: flow_approve/flow_check bodies must equal claude-code/hooks/flow-context.md')
for p in oport_agents:
    fm,_=frontmatter(p)
    if not fm or fm.get('name')!=p.stem or not fm.get('description'): err(f'{rel(p)}: frontmatter needs name {p.stem} and a description')
    if fm.get('mode')!='subagent': err(f'{rel(p)}: mode must be subagent')
    if not set(fm)<={'name','description','mode','permission'}: err(f'{rel(p)}: unexpected frontmatter keys {sorted(set(fm)-{"name","description","mode","permission"})}')
    permission=fm.get('permission')
    if p.stem=='flow-plan-executor' and permission!={'task':'deny'}: err(f'{rel(p)}: permission must be exactly task: deny')
    if p.stem in OPORT_AUDIT and permission!={'edit':'deny','task':{'*':'deny','explore':'allow'}}: err(f'{rel(p)}: audit agent permission must be exactly edit: deny and task: {{"*": deny, explore: allow}}')
    elif p.stem in OPORT_READ_ONLY and p.stem not in OPORT_AUDIT and permission!={'edit':'deny','task':'deny'}: err(f'{rel(p)}: read-only agent permission must be exactly edit: deny and task: deny')
    if p.stem in {'flow-planner','flow-implementer'} and 'permission' in fm: err(f'{rel(p)}: must not carry a permission block')
for p in oport_docs:
    if not p.exists(): continue
    text=p.read_text()
    for omp_only in ['flow_gate','skill://','`hub`','hub wait','@task','@execute','@slow','@smol','@plan','@vision','@review_aux','`sonic`','`scout`','ast_grep','gates.json','flow-evidence-verifier','.flow/evidence/','`todo`']:
        if omp_only in text: err(f'{rel(p)}: OMP-only mechanic in the OpenCode port: {omp_only}')
    if re.search(r'(?<![\w-])fiatcode:(?=\w)',text): err(f'{rel(p)}: Claude Code fiatcode: prefix in the OpenCode port')
    for claude_only in ['CLAUDE_PLUGIN_ROOT','SendMessage','general-purpose','isolation: "worktree"','TaskCreate','TodoWrite','mcp__github__','`Explore`','CLAUDE.md','model: opus','model: sonnet','model: haiku','model: inherit','weft_publish','WEFT_GRAPH_REPO']:
        if claude_only in text: err(f'{rel(p)}: Claude Code-only mechanic in the OpenCode port: {claude_only}')
    if MODEL_LEAK.search(text) or OPORT_MODEL_LEAK.search(text): err(f'{rel(p)}: concrete model/provider identifier leaked into the OpenCode port')
OPORT_FOREIGN_PATHS=['.claude','~/.omp','.omp/','claude-code/','open-webui/','.claude-plugin']
oport_cfgs=[oport/'opencode.json']+sorted((oport/'profiles').glob('*.json'))
for p in oport_docs+oport_cfgs:
    if not p.exists(): continue
    text=p.read_text()
    for foreign in OPORT_FOREIGN_PATHS:
        if foreign in text: err(f'{rel(p)}: other-harness path in the OpenCode port: {foreign}')
required_asks=[m for m,a in pattern_lists['anthropic'] if a=='prompt']
if not (oport/'opencode.json').exists(): err('opencode/opencode.json: missing')
else:
    try: base=json.loads((oport/'opencode.json').read_text())
    except ValueError as e: base=None; err(f'opencode/opencode.json: invalid JSON: {e}')
    if base is not None:
        if not isinstance(base,dict) or set(base)!={'$schema','permission'}: err('opencode/opencode.json: top-level keys must be exactly $schema and permission')
        else:
            perm=base['permission']
            if not isinstance(perm,dict) or set(perm)!={'bash'} or not isinstance(perm['bash'],dict): err('opencode/opencode.json: permission must be exactly a bash map')
            else:
                if set(perm['bash'])!=set(required_asks): err(f'opencode/opencode.json: permission.bash must list exactly the profile prompt patterns; difference {sorted(set(perm["bash"])^set(required_asks))}')
                for match,action in perm['bash'].items():
                    if action!='ask': err(f'opencode/opencode.json: permission.bash {match!r} must be ask, not {action!r}')
oport_profiles=sorted((oport/'profiles').glob('*.json'))
if {p.stem for p in oport_profiles}!={'claude-agent','commandcode','opencode'}: err(f'opencode/profiles: profile set mismatch: {sorted(p.stem for p in oport_profiles)}')
# A profile names the OMP profile whose routing it follows; `opencode` has none (free models, no effort).
OPORT_OMP_PROFILE={'claude-agent':'anthropic','commandcode':'commandcode'}
# No credential in a profile: OpenCode keeps keys in its own store (`/connect`).
OPORT_CREDENTIAL_KEY=re.compile(r'api[-_]?key|authorization|cookie|secret|token',re.I)
OPORT_HEADERS_KEY=re.compile(r'^headers?$',re.I)
def keys_matching(node,pattern,path=''):
    if isinstance(node,dict):
        for key,value in node.items():
            if pattern.search(str(key)): yield f'{path}/{key}'
            yield from keys_matching(value,pattern,f'{path}/{key}')
    elif isinstance(node,list):
        for i,value in enumerate(node): yield from keys_matching(value,pattern,f'{path}/{i}')
for p in oport_profiles:
    try: prof=json.loads(p.read_text())
    except ValueError as e: err(f'{rel(p)}: invalid JSON: {e}'); continue
    if not isinstance(prof,dict) or not {'$schema','model','agent'}<=set(prof)<={'$schema','model','agent','provider'}: err(f'{rel(p)}: top-level keys must be $schema, model and agent, plus an optional provider block for {p.stem} only'); continue
    if 'provider' in prof and (not isinstance(prof['provider'],dict) or set(prof['provider'])!={p.stem}): err(f'{rel(p)}: provider block may configure only {p.stem}')
    # A header can smuggle a credential under any name, so a provider block carries none.
    for key_path in keys_matching(prof.get('provider'),OPORT_HEADERS_KEY,'/provider'): err(f'{rel(p)}: {key_path}: a provider block carries no headers')
    for key_path in keys_matching(prof,OPORT_CREDENTIAL_KEY): err(f'{rel(p)}: credential key {key_path}; add keys with /connect, never in a profile')
    if not isinstance(prof['model'],str) or not prof['model'].startswith(f'{p.stem}/'): err(f'{rel(p)}: model must be a string starting with {p.stem}/')
    mapping=prof['agent']
    # `build` is the primary agent: it carries Main's model and effort, which the top-level `model` cannot.
    if not isinstance(mapping,dict) or set(mapping) not in (OPORT_AGENTS,OPORT_AGENTS|{'build'}): err(f'{rel(p)}: agent map must name the ten Flow agents, plus an optional build'); continue
    rows={}
    for name,entry in mapping.items():
        if not (isinstance(entry,dict) and set(entry)<={'model','variant'} and isinstance(entry.get('model'),str) and entry['model'].startswith(f'{p.stem}/') and isinstance(entry.get('variant','x'),str)):
            err(f'{rel(p)}: agent {name} must be {{"model": "{p.stem}/...", "variant": optional string}}'); break
        if name=='build' and entry['model']!=prof['model']: err(f'{rel(p)}: build must use the top-level model')
        rows[name]=(entry['model'],entry.get('variant'))
    else:
        omp_profile=OPORT_OMP_PROFILE.get(p.stem)
        unmapped=sorted(n for n in rows if n!='build' and n not in ROLE_OF)
        if unmapped: err(f'{rel(p)}: agents with no OMP role: {unmapped}'); continue
        check_roles(rel(p),{n:v for n,v in rows.items() if n!='build'})
        if not omp_profile:
            for name,(model,variant) in rows.items():
                if variant is not None: err(f'{rel(p)}: {name} has a variant; the free {p.stem} profile has no effort')
            continue
        if 'build' not in rows: err(f'{rel(p)}: build is required: it carries Main model and effort')
        for name,(model,variant) in rows.items():
            role='default' if name=='build' else ROLE_OF[name]
            if variant!=omp_effort(omp_profile,role): err(f'{rel(p)}: {name} variant {variant!r} differs from the OMP {omp_profile} profile effort {omp_effort(omp_profile,role)!r} for role {role}')
            if model!=port_model(omp_profile,p.stem,role): err(f'{rel(p)}: {name} model {model} differs from the OMP {omp_profile} profile model {port_model(omp_profile,p.stem,role)} for role {role}')
        if prof['model']!=port_model(omp_profile,p.stem,'default'): err(f'{rel(p)}: model differs from the OMP {omp_profile} default role')

# Rule 11: the OpenCode port is documented where readers look.
_readme=(ROOT/'README.md').read_text()
for marker in ['`opencode/`','flow-opencode']:
    if marker not in _readme: err(f'README.md: missing OpenCode port marker: {marker}')
_interop=(ROOT/'docs/EXTERNAL-INTEROP.md').read_text().lower()
for marker in ['## opencode port','`opencode/`','`subagent`','`skill`']:
    if marker not in _interop: err(f'docs/EXTERNAL-INTEROP.md: missing OpenCode port marker: {marker}')
if not (ROOT/'docs/decisions/opencode-port.md').exists(): err('docs/decisions/opencode-port.md: missing')

# Windows support is documented where readers look.
for marker in ['docs/WINDOWS.md','flow-opencode.ps1']:
    if marker not in _readme: err(f'README.md: missing Windows marker: {marker}')
_windows=ROOT/'docs/WINDOWS.md'
if not _windows.exists(): err('docs/WINDOWS.md: missing')
else:
    _wtext=_windows.read_text()
    for marker in ['Developer Mode','Git Bash','OPENCODE_CONFIG_CONTENT','not yet field-tested']:
        if marker not in _wtext: err(f'docs/WINDOWS.md: missing marker: {marker}')
if not (ROOT/'docs/decisions/windows-support.md').exists(): err('docs/decisions/windows-support.md: missing')

# Every file that loads into a session (skills, their references, agents, rules, AGENTS.md)
# has a byte cap; growth needs a deliberate cap change.
budget=json.loads((ROOT/'tests/doctrine-budget.json').read_text())
loaded={rel(p) for p in skills+agents+rules+list((ROOT/'omp/skills').glob('*/references/*.md'))+port_docs}|{'omp/AGENTS.md'}
loaded|={rel(p) for p in oport_docs}
for path in sorted(loaded-budget.keys()):
    err(f'tests/doctrine-budget.json: no size cap for {path}')
for path in sorted(budget.keys()-loaded):
    err(f'tests/doctrine-budget.json: cap for missing file {path}')
for path in sorted(loaded&budget.keys()):
    size=(ROOT/path).stat().st_size
    if size>budget[path]:
        err(f'{path}: {size} bytes, cap {budget[path]}; shrink it, or raise the cap in tests/doctrine-budget.json only with user agreement')

# One SemVer version for the repository. VERSION is the source; the plugin.json
# version and the Open WebUI first line are hand-kept copies checked against it,
# and both doctor commands read it.
version_path=ROOT/'VERSION'
version_raw=version_path.read_bytes() if version_path.exists() else b''
version=version_raw.decode(errors='replace').strip()
if not version_path.exists(): err('VERSION: missing')
elif not re.fullmatch(rb'(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\n',version_raw): err(f'VERSION: must be MAJOR.MINOR.PATCH and a newline, got {version_raw!r}')
elif plugin.get('version')!=version: err(f'claude-code/.claude-plugin/plugin.json: version {plugin.get("version")!r} differs from VERSION {version!r}')
if any('version' in p for p in market['plugins']) or 'version' in market: err('.claude-plugin/marketplace.json: must not set a version; plugin.json owns it')
if version_path.exists():
    webui_first=(ROOT/'open-webui/system-prompt.md').read_text().split('\n',1)[0]
    if webui_first!=f'Flow {version}': err(f'open-webui/system-prompt.md: first line must be "Flow {version}", got {webui_first!r}')
    # Each doctor runs with no omp/opencode on PATH and a scratch HOME: it prints its
    # version line, then exits (omp: no config.yml; opencode: no opencode). Output is
    # read as bytes so a stray carriage return is not translated away.
    # The sh doctors are Linux-only; the PowerShell doctors are checked below when pwsh exists.
    if os.name != 'nt':
        with tempfile.TemporaryDirectory() as scratch:
            bindir=Path(scratch)/'bin'; bindir.mkdir()
            for tool in ['dirname','readlink']: os.symlink(shutil.which(tool),bindir/tool)
            for doctor_cmd in [ROOT/'omp/bin/flow-omp',ROOT/'opencode/bin/flow-opencode']:
                first=subprocess.run(['/bin/sh',str(doctor_cmd),'doctor'],env={'HOME':scratch,'PATH':str(bindir)},capture_output=True).stdout.split(b'\n',1)[0].decode(errors='replace')
                if first!=f'flow-skills {version}': err(f'{rel(doctor_cmd)}: doctor must print "flow-skills {version}" first, got {first!r}')
    # The PowerShell doctors print the same first line; checked wherever pwsh exists.
    # They end lines with the platform newline (CRLF on Windows), so split on that.
    if shutil.which('pwsh'):
        with tempfile.TemporaryDirectory() as scratch:
            env={**os.environ,'HOME':scratch,'USERPROFILE':scratch}
            for doctor_cmd in [ROOT/'omp/bin/flow-omp.ps1',ROOT/'opencode/bin/flow-opencode.ps1']:
                first=subprocess.run(['pwsh','-NoProfile','-ExecutionPolicy','Bypass','-File',str(doctor_cmd),'doctor'],env=env,capture_output=True).stdout.split(os.linesep.encode(),1)[0].decode(errors='replace')
                if first!=f'flow-skills {version}': err(f'{rel(doctor_cmd)}: doctor must print "flow-skills {version}" first, got {first!r}')

if errors:
    print('\n'.join('FAIL: '+e for e in errors)); sys.exit(1)
print(f'ok: {len(skills)} skills, {len(agents)} agents, {len(rules)} rules')
