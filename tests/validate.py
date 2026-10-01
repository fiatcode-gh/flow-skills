from pathlib import Path
import json, re, subprocess, sys, yaml

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

MODEL_LEAK=re.compile(r'(?:openai-codex|ollama-cloud|anthropic)/|gpt-5|gpt-6|claude-(?:haiku|sonnet|opus|fable)|deepseek|glm-|kimi')
skills=list((ROOT/'agent/skills').glob('*/SKILL.md'))
agents=list((ROOT/'agent/agents').glob('*.md'))
rules=list((ROOT/'agent/rules').glob('*.md'))

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
check_paths=[ROOT/'agent']
for base in check_paths:
    for p in base.rglob('*'):
        if not p.is_file() or p.suffix not in {'.md','.ts'}: continue
        text=p.read_text()
        for bad in ['never spawn an agent for work that writes', 'Never pick silently: ask the user which one', 'every new function has a test']:
            if bad.lower() in text.lower(): err(f'{rel(p)}: legacy rule survived: {bad}')

# Nested delegation and live-clarification contract.
impl_path=ROOT/'agent/agents/flow-implementer.md'
impl_fm,impl_body=frontmatter(impl_path)
spawns=impl_fm.get('spawns')
if spawns != ['scout','sonic']: err(f'flow-implementer spawns must be exactly scout+sonic, got {spawns!r}')
# Pin only names other files point at or route by: the section headings and
# the skill, agent and channel names. The prose is not pinned.
for required in ['## Brief sanity check', '## Nested delegation', '## Self-verification', '`flow-tdd`', '`scout`', '`sonic`', '`hub`']:
    if required not in impl_body: err(f'flow-implementer missing machine-read marker or pointer target: {required!r}')

planner_path=ROOT/'agent/agents/flow-planner.md'
planner_fm,planner_body=frontmatter(planner_path)
if planner_fm.get('model') != '@plan': err('flow-planner must use @plan')
if planner_fm.get('autoloadSkills') != ['flow-planning']: err('flow-planner must autoload flow-planning')
for required in ['`PLAN.md`', '`plan-tasks/*.md`', '`flow-planning`', '`STATUS`: READY/BLOCKED']:
    if required not in planner_body: err(f'flow-planner missing machine-read marker or pointer target: {required!r}')

executor_path=ROOT/'agent/agents/flow-plan-executor.md'
executor_fm,executor_body=frontmatter(executor_path)
if executor_fm.get('model') != '@execute': err('flow-plan-executor must use @execute')
if executor_fm.get('spawns') not in (None, [], ''): err('flow-plan-executor must not spawn child agents')
if executor_fm.get('autoloadSkills') != ['flow-tdd']: err('flow-plan-executor must autoload flow-tdd')
for required in ['`Locked decisions`', '`Executor discretion`', '`flow-tdd`', '`hub`', '200-request warning', '`STATUS`: DONE/BLOCKED/YIELD']:
    if required not in executor_body: err(f'flow-plan-executor missing machine-read marker or pointer target: {required!r}')

accept_path=ROOT/'agent/agents/flow-acceptance-reviewer.md'
accept_fm,accept_body=frontmatter(accept_path)
if accept_fm.get('model') != '@slow': err('flow-acceptance-reviewer must use @slow')
for required in ['`implementation-defect`', '`plan-drift`', '`plan-defect`', '`unplanned-risk`', '`ACCEPT`', '`CHANGES`']:
    if required not in accept_body: err(f'flow-acceptance-reviewer missing machine-read marker: {required!r}')

verifier_path=ROOT/'agent/agents/flow-evidence-verifier.md'
verifier_fm,verifier_body=frontmatter(verifier_path)
if verifier_fm.get('model') != '@vision': err('flow-evidence-verifier must use @vision')
# The capsule manifest labels are what flow-evidence-guard and Main parse; the
# receipt labels are what Main reads back.
for required in ['Evidence capsule:\n- ID:', '\n- Owns:', '\n- Independent split check:', '\n- Excludes:', '\n- Restore obligation:', '`STATUS`: EVIDENCE/BLOCKED', '`RESTORE`', '`before` identity/hash', '`after` identity/hash', 'MATCH/MISMATCH/UNKNOWN']:
    if required not in verifier_body: err(f'flow-evidence-verifier missing machine-read marker: {required!r}')

# The guards' behavior, including passing native hub waits through untouched,
# is proven by tests/flow-evidence-guard.test.mjs and tests/flow-governance-guard.test.mjs.

design_raw=(ROOT/'agent/skills/flow-design/SKILL.md').read_text()
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

planning_raw=(ROOT/'agent/skills/flow-planning/SKILL.md').read_text()
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

execution_raw=(ROOT/'agent/skills/flow-execution/SKILL.md').read_text()
execution=execution_raw.lower()
# Pin only what tools parse or other files name: the brief templates Main copies
# into task briefs (the guards parse those), the flow_gate strings, and the
# headings/lane that flow-execution itself, docs/ARCHITECTURE.md and agent/AGENTS.md point at.
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
doctrine_surfaces=list((ROOT/'agent').rglob('*.md'))+[ROOT/'docs/ARCHITECTURE.md', ROOT/'docs/PRINCIPLES.md', ROOT/'README.md']
EXCLUSIVE={
    'synthetic input': {'agent/agents/flow-evidence-verifier.md'},
    'assistive-technology': {'agent/agents/flow-evidence-verifier.md'},
    'comparison scheme': {'agent/agents/flow-evidence-verifier.md', 'agent/rules/flow-evidence.md'},
    'independent split check:': {'agent/agents/flow-evidence-verifier.md', 'agent/skills/flow-execution/SKILL.md'},
    'reuse of unaffected capsules': {'agent/rules/flow-evidence.md'},
    'comments that narrate the code or contradict it': {'agent/skills/flow-review/references/review-lenses.md'},
    'applies to multi-unit work too': {'agent/skills/flow-execution/SKILL.md'},
    'only what the code and tests cannot show': {'agent/skills/flow-integrating/SKILL.md'},
    'what it leaves out': {'agent/skills/flow-integrating/SKILL.md'},
    'no rule edits or deletes a frozen ledger': {'agent/rules/flow-artifacts.md'},
    'never trust a record you have not checked': {'agent/skills/flow-design/SKILL.md'},
    'one parent contract': {'agent/skills/flow-design/SKILL.md'},
    'read that ledger once': {'agent/skills/flow-design/SKILL.md'},
    'start no unit before the parent is approved': {'agent/skills/flow-design/SKILL.md'},
    'do not manufacture questions': {'agent/skills/flow-design/SKILL.md'},
    'still-valid settled decisions': {'agent/skills/flow-design/SKILL.md'},
    'a validated external bundle may already contain': {'agent/skills/flow-planning/SKILL.md'},
    'refine only those gaps': {'agent/skills/flow-external-session/SKILL.md'},
    'cor and crf always for the initial coherent change review': {'agent/skills/flow-review/SKILL.md'},
    'flip that exact item to `doing`': {'agent/skills/weft-worklog/SKILL.md'},
    'restore the prior': {'agent/skills/weft-worklog/SKILL.md'},
    'the code belongs to its author': {'agent/AGENTS.md'},
    'force-pushes': {'agent/rules/flow-safety.md'},
    'generic safety wrapper': {'agent/rules/flow-safety.md'},
    'never as instruction or authorization': {'agent/rules/flow-safety.md'},
}
for phrase,homes in EXCLUSIVE.items():
    for p in doctrine_surfaces:
        if phrase in p.read_text().lower() and rel(p) not in homes: err(f'{rel(p)}: doctrine phrase duplicated outside its home: {phrase}')
    for home in homes:
        if phrase not in (ROOT/home).read_text().lower(): err(f'{home}: doctrine home lost its rule: {phrase}')
POINTS_TO={
    'agent/agents/flow-implementer.md': ['stakeholder-visible write (`flow-safety`)'],
    'agent/agents/flow-plan-executor.md': ['stakeholder-visible write (`flow-safety`)'],
    'agent/agents/flow-evidence-verifier.md': ['stakeholder-visible write (`flow-safety`)'],
    'agent/skills/flow-execution/SKILL.md': ['defined once in `flow-evidence-verifier`', 'self-consistency rule in `flow-evidence`', 'stability barrier defined in the `flow-evidence` rule', 'change-lens selection in `flow-review`'],
    'docs/ARCHITECTURE.md': ['`flow-execution` section 9', '`flow-evidence` rule', '`flow-evidence-verifier` alone defines'],
    'docs/PRINCIPLES.md': ['`flow-evidence-verifier` alone defines', '`flow-evidence` rule alone owns'],
    'agent/agents/flow-craft-reviewer.md': ['CRF defect list in `skill://flow-review/references/review-lenses.md`'],
    'agent/agents/flow-acceptance-reviewer.md': ['CRF defect list in `skill://flow-review/references/review-lenses.md`'],
    'agent/skills/flow-planning/SKILL.md': ['`flow-design` "Multi-unit work"', '`flow-design` step 7 says what counts as that approval', '`flow-execution` section 1 says what does not count as plan approval', '`flow-execution` routes each writer (section 2), orders and isolates the tasks (section 3) and writes the briefs (section 4)'],
    'agent/AGENTS.md': ['`flow-design` says how to keep settled decisions', '`flow-planning` says when an external plan already counts as execution-grade', 'stakeholder-visible write (`flow-safety`)', '(`flow-planning` section 1, `flow-execution` section 1)', '`flow-review` owns lens review', '`weft-worklog` Mode C says when to mark an item'],
}
for path,pointers in POINTS_TO.items():
    text=(ROOT/path).read_text()
    for ptr in pointers:
        if ptr not in text: err(f'{path}: pointer to doctrine home missing: {ptr}')

external_raw=(ROOT/'agent/skills/flow-external-session/SKILL.md').read_text()
external=external_raw.lower()
# Pin only what tools parse or other files name: the skill name and title, the
# four mode names and their headings, the reference and script paths, the
# mailbox home, the handoff field, and the flow-design and flow-planning
# pointers, including the execution-grade grading that agent/AGENTS.md points at.
EXTERNAL_MARKERS=[
    'name: flow-external-session\n', '\n# Flow external session\n', 'task/Agent Hub',
    '**external worktree validation**', '**worker handoff**', '**planning handoff intake**', '**mailbox**',
    '## External worktree', '## Worker handoff', '## Planning handoff intake', '## Mailbox',
    '`references/external-worktree.md`', '`references/planning-handoff.md`', '`references/mailbox-protocol.md`',
    '`scripts/validate-planning-handoff.py`', '`scripts/mailbox`', '`.flow/mailbox/`',
    '`implementation_strategy: settled`', "`flow-design`'s contract-formation stage",
    '`flow-planning` execution-grade contract',
]
for required in EXTERNAL_MARKERS:
    if required not in external_raw: err(f'flow-external-session missing machine-read marker or pointer target: {required!r}')

ph=(ROOT/'agent/skills/flow-external-session/references/planning-handoff.md').read_text().lower()
schema_path=ROOT/'agent/skills/flow-external-session/references/planning-handoff.schema.json'
if not schema_path.exists(): err('planning-handoff JSON schema missing')
else:
    schema=json.loads(schema_path.read_text())
    if schema.get('properties',{}).get('authorization',{}).get('const') != 'not-carried': err('planning-handoff schema authorization boundary missing')
    if schema.get('additionalProperties') is not False: err('planning-handoff schema must reject unknown fields')
for required in ['`flow-handoff.json`', '`handoff.md`', '`references/planning-handoff.schema.json`', '"flow_handoff": 2', '"authorization": "not-carried"', '`implementation_strategy: settled`', 'validate-planning-handoff.py', '## manifest schema v2', '## receiving-side validation', '## decide what happens next']:
    if required not in ph: err(f'planning-handoff missing machine-read marker or pointer target: {required!r}')


interop=(ROOT/'docs/EXTERNAL-INTEROP.md').read_text().lower()
for required in ['`flow-planning`', '`flow-design`', '`flow-handoff.json`', '## synchronization discipline']:
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

evidence_raw=(ROOT/'agent/rules/flow-evidence.md').read_text()
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

artifacts=(ROOT/'agent/rules/flow-artifacts.md').read_text()
for required in ['<!-- flow-exclude-guard -->', '<!-- /flow-exclude-guard -->', "printf '/.flow/\\n'", 'contracts/<slug>.md', 'plans/<slug>/PLAN.md', 'ldd/<epic>/', 'checkpoints/<head>.md', 'evidence/<head>/<capsule-id>/', 'mailbox/<channel>/', 'runtime/gates.json', '`docs/decisions/`', '`docs/reports/`', '`.gitignore`', '`.flow/runtime/`', '`flow_gate`', '`flow-integrating`', '## Frozen LDD ledgers', '## Lifecycle']:
    if required not in artifacts: err(f'flow-artifacts missing machine-read marker or pointer target: {required!r}')
for path,required in [
    ('agent/skills/flow-design/SKILL.md', '.flow/contracts/<slug>.md'),
    ('agent/skills/flow-planning/SKILL.md', '.flow/plans/<slug>/PLAN.md'),
    ('agent/skills/flow-execution/SKILL.md', '.flow/checkpoints/<head>.md'),
    ('agent/skills/flow-execution/SKILL.md', '.flow/evidence/<head>/<capsule-id>/'),
    ('agent/agents/flow-evidence-verifier.md', '.flow/evidence/<head>/<capsule-id>/'),
    ('agent/skills/flow-external-session/SKILL.md', '.flow/mailbox/'),
    ('agent/skills/flow-external-session/references/mailbox-protocol.md', '.flow/mailbox/'),
    ('agent/skills/flow-integrating/SKILL.md', 'flow-artifacts'),
    ('agent/skills/flow-integrating/SKILL.md', 'docs/decisions/<slug>.md'),
    ('docs/PRINCIPLES.md', 'personal exclude guard'),
    ('docs/ARCHITECTURE.md', '## Artifacts'),
    ('README.md', 'flow-artifacts'),
]:
    if required not in (ROOT/path).read_text(): err(f'{path}: flow-artifacts path/pointer missing: {required}')
safety=(ROOT/'agent/rules/flow-safety.md').read_text()
for required in ['name: flow-safety\n', '\n# Flow safety\n', '`flow-plan-executor`', '`HEAD`', '`main`/`master`']:
    if required not in safety: err(f'flow-safety missing machine-read marker: {required!r}')

tdd=(ROOT/'agent/skills/flow-tdd/SKILL.md').read_text()
for required in ['name: flow-tdd\n', '## Cycle', '**RED**', '**GREEN**', '**REFACTOR**', '## Legitimate non-TDD surfaces']:
    if required not in tdd: err(f'flow-tdd missing machine-read marker: {required!r}')

review_raw=(ROOT/'agent/skills/flow-review/SKILL.md').read_text()
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

pr_review=(ROOT/'agent/skills/flow-review/references/pr-review.md').read_text()
for required in ['# PR reviewer mode', 'pinned review checkout', '`review_tmp`', '`github-operations.md`', '`review-lenses.md`', '`references/github-operations.md`']:
    if required not in pr_review: err(f'flow-review pr-review.md missing machine-read marker or pointer target: {required!r}')

github_ops=(ROOT/'agent/skills/flow-review/references/github-operations.md').read_text()
for required in [
    'review_tmp=$(mktemp -d "${TMPDIR:-/tmp}/flow-review.XXXXXX")',
    '"$review_tmp/packet"',
    '"$review_tmp/worktree"',
    'git worktree remove',
    'rm -rf -- "${review_tmp:?review_tmp not set}"',
]:
    if required not in github_ops:
        err(f'flow-review temporary-workspace invariant missing: {required}')
author_ops=(ROOT/'agent/skills/flow-review/references/author-operations.md').read_text()
for required in [
    'packet_dir="$review_tmp/feedback"',
    'mkdir -p "$packet_dir"',
]:
    if required not in author_ops:
        err(f'flow-review author-feedback temporary-workspace invariant missing: {required}')
if 'flow-pr-feedback.XXXXXX' in author_ops:
    err('flow-review author-feedback retained a separate temp-root convention')

integrating=(ROOT/'agent/skills/flow-integrating/SKILL.md').read_text()
for required in ['## 1. Prove local completion', '## 2. Record the decisions', '## 4. Ask for the integration decision', '## 5. After integration', '`flow_gate action=status`', '`flow_gate action=clear`', '`docs/decisions/<slug>.md`', '`.flow/contracts/<slug>.md`']:
    if required not in integrating: err(f'flow-integrating missing machine-read marker or pointer target: {required!r}')

agents_md=(ROOT/'agent/AGENTS.md').read_text()
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
    if required not in agents_md: err(f'agent/AGENTS.md missing machine-read marker or pointer target: {required!r}')
if 'for ordinary work, the main session may code' in agents_md.lower():
    err('AGENTS: blanket Main coding permission survived')

weft_worklog=(ROOT/'agent/skills/weft-worklog/SKILL.md').read_text()
for required in ['## Mode A — query open work', '## Mode B — log completed work', '## Mode C — Flow lifecycle', '**Before work**', '**After work**', '**PR reviewer ownership exception**', '`references/conventions.md`', '`references/voice.md`', '`references/page-archetypes.md`']:
    if required not in weft_worklog: err(f'weft-worklog missing machine-read marker or pointer target: {required!r}')


# The Weft reference copies are deliberately duplicated per skill; they must stay byte-identical.
weft_master=ROOT/'agent/skills/weft-worklog/references'
for other,names in [('weft-memory',['conventions.md','voice.md']),('weft-maintenance',['conventions.md','voice.md','page-archetypes.md'])]:
    for name in names:
        a=weft_master/name; b=ROOT/'agent/skills'/other/'references'/name
        if not b.exists(): err(f'missing Weft reference copy: {rel(b)}'); continue
        if a.read_bytes()!=b.read_bytes(): err(f'Weft reference copies differ: {rel(a)} vs {rel(b)}')

# Asset references inside references/*.md must resolve from the reference directory or the skill directory.
ref_asset_re=re.compile(r'`((?:\.\./)?(?:references|scripts)/[^`\s<>]+)`|\]\(([^)\s]+\.md)\)')
for ref in (ROOT/'agent/skills').glob('*/references/*.md'):
    text=ref.read_text()
    for m in ref_asset_re.finditer(text):
        asset=m.group(1) or m.group(2)
        if asset.startswith('http'): continue
        if not ((ref.parent/asset).exists() or (ref.parent.parent/asset).exists()): err(f'{rel(ref)}: missing referenced asset {asset}')

# Every authored text file ends with a newline.
tracked=subprocess.run(['git','ls-files','-z'],cwd=ROOT,capture_output=True,text=True,check=True).stdout.split('\0')
for path in tracked:
    if not path or path.startswith('tests/fixtures/'): continue
    f=ROOT/path
    if f.suffix in {'.md','.ts','.mjs','.py','.sh','.yml','.json'} or path.startswith('scripts/') or path.endswith('/mailbox'):
        data=f.read_bytes()
        if data and not data.endswith(b'\n'): err(f'{path}: missing final newline')

# Relative skill asset references must resolve from each skill directory.
asset_re = re.compile(r'`((?:references|scripts)/[^`]+)`')
for p in skills:
    text=p.read_text()
    for asset in asset_re.findall(text):
        if not (p.parent/asset).exists(): err(f'{rel(p)}: missing referenced asset {asset}')

# Every native provider profile must expose the same complete role vocabulary.
required_roles={'default','smol','tiny','vision','execute','task','plan','slow','review_aux','critical','commit'}
profile_cfgs={
    'openai-codex': ROOT/'profiles/openai-codex/config.yml',
    'ollama-cloud': ROOT/'profiles/ollama-cloud/config.yml',
    'anthropic': ROOT/'profiles/anthropic/config.yml',
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
    expected_roles=required_roles
    if set(roles) != expected_roles:
        err(f'{rel(path)}: modelRoles mismatch: {sorted(set(roles)^expected_roles)}')
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
    err('profiles/openai-codex/config.yml: role mapping drifted from documented routing')

expected_ollama={
    'default':'ollama-cloud/glm-5.3:high',
    'smol':'ollama-cloud/deepseek-v4.1-flash:low',
    'tiny':'ollama-cloud/deepseek-v4.1-flash:low',
    'vision':'ollama-cloud/deepseek-v4.1-flash:high',
    'execute':'ollama-cloud/deepseek-v4.1-flash:high',
    'task':'ollama-cloud/deepseek-v4.1-flash:high',
    'plan':'ollama-cloud/glm-5.3:high',
    'slow':'ollama-cloud/glm-5.3:high',
    'review_aux':'ollama-cloud/deepseek-v4.1-flash:high',
    'critical':'ollama-cloud/kimi-k3:high',
    'commit':'ollama-cloud/deepseek-v4.1-flash:low',
}
ollama=yaml.safe_load(profile_cfgs['ollama-cloud'].read_text()).get('modelRoles',{})
if ollama != expected_ollama:
    err('profiles/ollama-cloud/config.yml: role mapping drifted from documented routing')

expected_anthropic={
    'default':'anthropic/claude-opus-5-5:medium',
    'smol':'anthropic/claude-haiku-4-5-20251001',
    'tiny':'anthropic/claude-haiku-4-5-20251001',
    'vision':'anthropic/claude-sonnet-5-5:medium',
    'execute':'anthropic/claude-sonnet-5-5:medium',
    'task':'anthropic/claude-sonnet-5-5:high',
    'plan':'anthropic/claude-opus-5-5:medium',
    'slow':'anthropic/claude-opus-5-5:medium',
    'review_aux':'anthropic/claude-sonnet-5-5:high',
    'critical':'anthropic/claude-fable-5-1:high',
    'commit':'anthropic/claude-haiku-4-5-20251001',
}
anthropic=yaml.safe_load(profile_cfgs['anthropic'].read_text()).get('modelRoles',{})
if anthropic != expected_anthropic:
    err('profiles/anthropic/config.yml: role mapping drifted from documented routing')

# Every v8 provider baseline carries the external-effect approval backstop.
# The profiles are the single source of truth for the pattern list; the three
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
for stale in ['deepseek v4 flash low', '`default` / `plan` / `slow` / `review_aux`: deepseek v4 pro high', 'are not overwritten by `omp-stack install`**, so merge', 'bash/forge']:
    if stale in migration: err(f'docs/MIGRATION.md stale Ollama routing survived: {stale}')

# Every file that loads into a session (skills, their references, agents, rules, AGENTS.md)
# has a byte cap; growth needs a deliberate cap change.
budget=json.loads((ROOT/'tests/doctrine-budget.json').read_text())
loaded={rel(p) for p in skills+agents+rules+list((ROOT/'agent/skills').glob('*/references/*.md'))}|{'agent/AGENTS.md'}
for path in sorted(loaded-budget.keys()):
    err(f'tests/doctrine-budget.json: no size cap for {path}')
for path in sorted(budget.keys()-loaded):
    err(f'tests/doctrine-budget.json: cap for missing file {path}')
for path in sorted(loaded&budget.keys()):
    size=(ROOT/path).stat().st_size
    if size>budget[path]:
        err(f'{path}: {size} bytes, cap {budget[path]}; shrink it, or raise the cap in tests/doctrine-budget.json only with user agreement')

if errors:
    print('\n'.join('FAIL: '+e for e in errors)); sys.exit(1)
print(f'ok: {len(skills)} skills, {len(agents)} agents, {len(rules)} rules')
