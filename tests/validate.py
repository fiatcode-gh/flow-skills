from pathlib import Path
import re, sys, yaml

ROOT = Path(__file__).resolve().parents[1]
errors=[]

def err(msg): errors.append(msg)

def frontmatter(p):
    text=p.read_text()
    if not text.startswith('---\n'):
        err(f'{p.relative_to(ROOT)}: missing frontmatter'); return {}, text
    try:
        _, raw, body = text.split('---', 2)
        data=yaml.safe_load(raw) or {}
        if not isinstance(data, dict): raise TypeError('frontmatter is not mapping')
        return data, body
    except Exception as e:
        err(f'{p.relative_to(ROOT)}: invalid frontmatter: {e}'); return {}, text

skills=list((ROOT/'agent/skills').glob('*/SKILL.md'))
agents=list((ROOT/'agent/agents').glob('*.md'))
rules=list((ROOT/'agent/rules').glob('*.md'))

if len(skills)!=14: err(f'expected 14 skills, got {len(skills)}')
if len(agents)!=10: err(f'expected 10 agents, got {len(agents)}')
if len(rules)!=2: err(f'expected 2 rules, got {len(rules)}')

names=set()
for p in skills:
    fm,body=frontmatter(p)
    name=fm.get('name'); desc=fm.get('description')
    if not name or not desc: err(f'{p}: skill needs name+description')
    if name in names: err(f'duplicate skill name {name}')
    names.add(name)
    if 'flow-using-skills' in body: err(f'{p}: legacy bootstrap reference')
    if re.search(r'pass (?:the )?model explicitly|explicit model per|model: openai-codex/', body, re.I): err(f'{p}: concrete/per-dispatch model routing leaked into skill')

expected={
'flow-design','flow-planning','flow-execution','flow-tdd','flow-debugging','flow-review','flow-integrating','flow-ldd','flow-external-session','ui-design','blog-post','weft-worklog','weft-memory','weft-maintenance'}
if names!=expected: err(f'skill set mismatch: {sorted(names^expected)}')

agent_names=set()
allowed_roles={'@task','@execute','@plan','@slow','@review_aux','@vision'}
for p in agents:
    fm,body=frontmatter(p); name=fm.get('name'); desc=fm.get('description')
    if not name or not desc: err(f'{p}: agent needs name+description')
    agent_names.add(name)
    model=fm.get('model')
    if model and model not in allowed_roles: err(f'{p}: unexpected agent role {model}')
    if re.search(r'openai-codex/|gpt-5', p.read_text()): err(f'{p}: concrete model leaked into agent')

for p in rules:
    fm,body=frontmatter(p)
    if fm.get('alwaysApply') is not True: err(f'{p}: rule must alwaysApply')
    if not fm.get('name') or not fm.get('description'): err(f'{p}: rule needs name+description')

# Removed old workflow assumptions must not survive outside migration docs.
check_paths=[ROOT/'agent']
for base in check_paths:
    for p in base.rglob('*'):
        if not p.is_file() or p.suffix not in {'.md','.ts'}: continue
        text=p.read_text()
        for bad in ['never spawn an agent for work that writes', 'Never pick silently: ask the user which one', 'every new function has a test']:
            if bad.lower() in text.lower(): err(f'{p.relative_to(ROOT)}: legacy rule survived: {bad}')

# LDD boundary is intentional and explicit.
ldd=(ROOT/'agent/skills/flow-ldd/SKILL.md').read_text().lower()
if 'architect **never writes production code**' not in ldd: err('LDD strict non-coding architect rule missing')
if '.flow/ldd' not in ldd: err('LDD .flow namespace missing')

# Nested delegation and live-clarification contract.
impl_path=ROOT/'agent/agents/flow-implementer.md'
impl_fm,impl_body=frontmatter(impl_path)
spawns=impl_fm.get('spawns')
if spawns != ['scout','sonic']: err(f'flow-implementer spawns must be exactly scout+sonic, got {spawns!r}')
impl_lower=impl_body.lower()
for required in ['mechanical leaf work','hub','main','nested children share your current workspace',"child's report is a claim", 'canonical formatter on every file you changed', 'brief sanity check', 'orchestration defect']:
    if required not in impl_lower: err(f'flow-implementer missing nested delegation/clarification invariant: {required}')

planner_path=ROOT/'agent/agents/flow-planner.md'
planner_fm,planner_body=frontmatter(planner_path)
if planner_fm.get('model') != '@plan': err('flow-planner must use @plan')
if 'do not write production code' not in planner_body.lower(): err('flow-planner production-code boundary missing')

executor_path=ROOT/'agent/agents/flow-plan-executor.md'
executor_fm,executor_body=frontmatter(executor_path)
if executor_fm.get('model') != '@execute': err('flow-plan-executor must use @execute')
if executor_fm.get('spawns') not in (None, [], ''): err('flow-plan-executor must not spawn child agents')
for required in ['locked decisions','executor discretion','plan contradiction','do not spawn subagents','200-request warning','two materially similar failed edit/proof attempts']:
    if required not in executor_body.lower(): err(f'flow-plan-executor invariant missing: {required}')

accept_path=ROOT/'agent/agents/flow-acceptance-reviewer.md'
accept_fm,accept_body=frontmatter(accept_path)
if accept_fm.get('model') != '@slow': err('flow-acceptance-reviewer must use @slow')
for required in ['plan conformance','plan-defect','plan-compliance advocate','contract']:
    if required not in accept_body.lower(): err(f'flow-acceptance-reviewer invariant missing: {required}')

verifier_path=ROOT/'agent/agents/flow-evidence-verifier.md'
verifier_fm,verifier_body=frontmatter(verifier_path)
if verifier_fm.get('model') != '@vision': err('flow-evidence-verifier must use @vision')
for required in ['verification only', 'designated verification environment', 'do not edit production', 'main independently inspects', 'never declares the unit accepted', 'one evidence capsule per verifier session', 'independent scene families', 'first action is capsule preflight', 'different acceptance modalities or operators', 'shared screen/save/setup state', 'physical human interaction', 'synthetic input', 'evidence capsule:', 'independent split check:', 'restore obligation:', '`before` identity/hash', '`after` identity/hash', 'rendered `before` and `after` values', 'match/mismatch/unknown']:
    if required not in verifier_body.lower(): err(f'flow-evidence-verifier invariant missing: {required}')

guard_path=ROOT/'agent/extensions/flow-evidence-guard.ts'
if not guard_path.exists(): err('flow evidence-capsule runtime guard missing')
else:
    guard=guard_path.read_text().lower()
    for required in ['tool_call', 'event.toolname === "task"', 'flow-evidence-verifier', 'evidence capsule:', 'id:', 'independent split check:', 'restore obligation:', 'omp owns agent hub wait/steering semantics', 'does not', 'intercept hub waits']:
        if required not in guard: err(f'flow evidence-capsule runtime guard invariant missing: {required}')
    for forbidden in ['event.toolname === "hub"', 'input.op === "wait"', 'ctx.hasui', 'peerwait', 'jobids']:
        if forbidden in guard: err(f'flow runtime guard must not intercept native hub wait semantics: {forbidden}')

legacy_guard_path=ROOT/'agent/extensions/flow-orchestration-guard.ts'
if legacy_guard_path.exists(): err('legacy flow-orchestration-guard.ts must be removed; native Hub wait semantics belong to OMP')
legacy_guard_test=ROOT/'tests/flow-orchestration-guard.test.mjs'
if legacy_guard_test.exists(): err('legacy flow-orchestration-guard.test.mjs must be removed')

design=(ROOT/'agent/skills/flow-design/SKILL.md').read_text().lower()
for required in ['before substantial planning','governing contract','clarify the intention with the user','completed governing contract','explicit user approval','main owns the contract','internal brainstorm','external handoff']:
    if required not in design: err(f'flow-design contract-formation invariant missing: {required}')

planning=(ROOT/'agent/skills/flow-planning/SKILL.md').read_text().lower()
for required in ['execution-grade plan','locked decisions','executor discretion','plan quality gate','cor','ttc','crf','sec','decision completeness','fresh-executor capsule','one fresh `flow-plan-executor` session','independently provable behavioral slice','valid intermediate handoff exists','receipt-first','plan receipt validation does not itself authorize implementation','explicit user plan approval','for substantial planned work','approved governing contract','for substantial planning','ldd or non-ldd','must dispatch `flow-planner` (`@plan`)','answers to clarification questions do not themselves approve']:
    if required not in planning: err(f'flow-planning invariant missing: {required}')

execution=(ROOT/'agent/skills/flow-execution/SKILL.md').read_text().lower()
for required in [
    'route by work type', 'preserve the unit owner', 'clarify live',
    'never broadly tell a writer', 'route corrections cheaply',
    'delegation never transfers verification responsibility',
    'a complete review round is not automatic',
    'native `hub wait` is valid', 'interruptible by user steering', 'does not prevent the user from prompting',
    'repeated `hub jobs` snapshots', 'does not intercept agent hub waits', 'receipt-first',
    'before the **first device/emulator/manual/external acceptance action**',
    'one verifier session owns one coherent evidence capsule', 'cannot rotate itself',
    'touched-file formatting', 'explicit disposition for **cor / ttc / crf / sec**',
    'dispatch preflight', 'verification ownership:', 'do not spawn a writing worker until all four entries are concrete',
    'formatter-only failure', 'forward pointer',
    'accepted external planning handoff', 'execution-grade plan', 'flow-plan-executor',
    'flow-acceptance-reviewer', 'batch the verified set',
    'for substantial work, a generic start/resume command is not local implementation authorization',
    'must not begin device/emulator/manual/external evidence capture',
    'must not personally drive a multi-step device/manual acceptance sequence',
    'flow-evidence-guard', 'evidence capsule:', 'independent split check:',
    'evidence-capsule runtime preflight rejects verifier dispatches missing these markers',
    '`before` and `after` identity/hash', 'match/mismatch/unknown',
    'shared setup, save, screen, or device state does not by itself make evidence inseparable',
    'different acceptance modalities or operators', 'physical human-operated interaction', 'synthetic input',
    'receipt may report `match` only when', 'report `unknown`',
    'do not wait on its old task job id after revival', 'peer-filtered reply wait', 'non-ldd only',
    're-enter the stability barrier', 'rerun affected capsules', 'reuse unaffected capsules',
]:
    if required not in execution: err(f'flow-execution missing execution-policy invariant: {required}')

for required in [
    'current flow/omp stack owns **execution mechanics**', 'flow-execution',
    'bounded parallel read-only `scout`', 'normally non-isolated',
    'correct efficiently', 'worker self-verification is required', 'forward pointer',
    'external planning intake', 'does not carry local implementation authorization',
    'flow-planning', 'flow-plan-executor', 'execution-grade',
    'native interruptible `hub wait` is valid', 'does not block user steering/prompting',
    'flow does not intercept agent hub waits',
    'before the first device/emulator/manual/external acceptance action',
    'one coherent scene/state/acceptance cluster', 'active main cannot rotate itself',
    'unit-start/resume command does not create missing approval',
    'explicit plan approval', 'acceptance review is a dependency barrier',
    'multi-step device/manual acceptance', 'evidence-capsule runtime preflight',
    'evidence capsule:', 'independent split check', 'restore obligation',
    'match/mismatch/unknown', 'substantial ldd consequential how',
    'different acceptance modalities/operators are separable by default',
    'shared device/save/setup state is not sufficient evidence of inseparability',
    'automated capture/proxy evidence stays separate from physical human-operated/manual/assistive-technology interaction',
    '`match` is valid only when the rendered before/after values self-consistently agree',
    'dispatch a dedicated `flow-planner` (`@plan`)',
    'answers to blocking/open contract questions do not themselves approve',
    'reopens the stability barrier', 'rerun affected capsules', 'reuse unaffected capsules',
]:
    if required not in ldd: err(f'flow-ldd missing execution-policy invariant: {required}')

external=(ROOT/'agent/skills/flow-external-session/SKILL.md').read_text().lower()
for required in ['planning handoff intake', 'references/planning-handoff.md', 'evidence/proposal, not authority or authorization', 'do not create a mailbox for a one-way static planning import', 'contract-formation stage', 'locally governing what/why contract', 'implementation_strategy: settled', 'execution-grade contract', 'refine only those gaps']:
    if required not in external: err(f'flow-external-session planning-handoff invariant missing: {required}')

ph=(ROOT/'agent/skills/flow-external-session/references/planning-handoff.md').read_text().lower()
schema_path=ROOT/'agent/skills/flow-external-session/references/planning-handoff.schema.json'
if not schema_path.exists(): err('planning-handoff JSON schema missing')
else:
    import json
    schema=json.loads(schema_path.read_text())
    if schema.get('properties',{}).get('authorization',{}).get('const') != 'not-carried': err('planning-handoff schema authorization boundary missing')
    if schema.get('additionalProperties') is not False: err('planning-handoff schema must reject unknown fields')
for required in ['flow_handoff', 'authorization', 'not-carried', 'reject absolute paths', 'implementation_strategy: settled', 'execution-grade contract', 'refine only the missing consequential how/tests/interfaces', 'current local project instructions', 'flow-handoff.json', 'not a complete protocol handoff', 'kickoff prompt']:
    if required not in ph: err(f'planning-handoff schema invariant missing: {required}')

validator=ROOT/'agent/skills/flow-external-session/scripts/validate-planning-handoff.py'
if not validator.exists(): err('planning-handoff validator missing')
else:
    validator_text=validator.read_text().lower()
    for required in ['authorization must be exactly not-carried', "artifact path must be relative without '..'", 'artifacts must declare handoff.md']:
        if required not in validator_text: err(f'planning-handoff validator invariant missing: {required}')

interop=(ROOT/'docs/GPT-INTEROP.md').read_text().lower()
for required in ['flow-planning', 'never authorization', 'synchronization discipline', 'standalone markdown', 'kickoff prompts']:
    if required not in interop: err(f'gpt interop doctrine missing: {required}')

compat=(ROOT/'docs/OMP-COMPATIBILITY.md').read_text().lower()
for required in ['interruptible by user steering', 'without preventing the user from prompting', 'ordinary task results may also self-deliver', 'leaves native wait/steering semantics intact', 'targeted peer-reply waits']:
    if required not in compat: err(f'OMP compatibility doctrine missing: {required}')
for stale in ['long bounded waits', 'keeps interactive main out of bare/job waits']:
    if stale in compat: err(f'OMP compatibility stale wait doctrine survived: {stale}')

doctrine_drift=[
    ('flow-planning', planning, 'for substantial planning, main/controller should prefer dispatching'),
    ('flow-planning-non-ldd', planning, 'for substantial non-ldd planning, prefer the same dedicated planner'),
    ('flow-execution-wait', execution, 'never wait merely to observe'),
    ('flow-ldd-wait', ldd, 'never wait merely to observe'),
    ('flow-execution', execution, '- tiny cohesive edit where spawn overhead exceeds the work → main may implement directly under `flow-tdd`;'),
    ('flow-external-session', external, 'skip a redundant native plan when the implementation strategy is already current and sufficiently specified'),
    ('planning-handoff', ph, 'design and implementation strategy settled/current → skip a redundant plan call'),
]
for label,text,bad in doctrine_drift:
    if bad in text: err(f'{label}: stale doctrine survived: {bad}')

evidence=(ROOT/'agent/rules/flow-evidence.md').read_text().lower()
for required in [
    'writers verify their own work', 'delegation never transfers verification responsibility',
    'leaf worker proves its leaf', 'do not rerun the same expensive full suite',
    'pre-edit bytes', 'not restoration proof when the file was already modified',
    'invalid flow orchestration', 'docs-only', 'affected evidence stale',
    'structured evidence receipts must be internally self-consistent',
    '`match` is itself an evidence claim', 'contradictory or transcription-damaged receipt',
    'reopens the stability barrier', 'rerun only affected evidence', 'reuse of unaffected capsules',
]:
    if required not in evidence: err(f'flow-evidence invariant missing: {required}')

safety=(ROOT/'agent/rules/flow-safety.md').read_text().lower()
for required in ['sole/sequential semantic owner', 'fresh `flow-plan-executor` rotation', 'independent concurrent writers', 'completed isolated task workspaces', 'snapshot its exact current content']:
    if required not in safety: err(f'flow-safety workspace-lifecycle invariant missing: {required}')

tdd=(ROOT/'agent/skills/flow-tdd/SKILL.md').read_text().lower()
for required in ['ownership and workspace safety', 'higher-layer verification', 'unit owner']:
    if required not in tdd: err(f'flow-tdd layered-proof invariant missing: {required}')

review=(ROOT/'agent/skills/flow-review/SKILL.md').read_text().lower()
if 'do **not** automatically repeat every original lens' not in review:
    err('flow-review affected-lens rerun invariant missing')
if 'explicit disposition for all four change lenses' not in review:
    err('flow-review explicit lens-disposition invariant missing')
if 'next action' not in review:
    err('flow-review forward-pointer invariant missing')

integrating=(ROOT/'agent/skills/flow-integrating/SKILL.md').read_text().lower()
if 'do not rerun an expensive final command merely because control moved into this skill' not in integrating:
    err('flow-integrating fresh-evidence reuse invariant missing')
if 'do not end a locally-complete integration checkpoint with only a status summary' not in integrating:
    err('flow-integrating mandatory integration handoff missing')

agents_md=(ROOT/'agent/AGENTS.md').read_text().lower()
for required in ['maintain the **forward pointer**', 'next workflow action', 'genuine decision/approval gate', 'production-writing worker', 'sole/sequential semantic owner', 'fresh `flow-plan-executor`', 'before substantial work enters planning', 'governing what/why contract', 'for substantial work, require explicit user approval of the completed governing contract', 'answers to clarification questions do not themselves approve', 'outside `flow-ldd`, main may code only in the main-direct lane defined by `flow-execution`', 'never route push/pr/review/comment/release actions through omp `eval`']:
    if required not in agents_md: err(f'AGENTS communication invariant missing: {required}')
if 'for ordinary work, the main session may code' in agents_md:
    err('AGENTS: blanket Main coding permission survived')


# Relative skill asset references must resolve from each skill directory.
asset_re = re.compile(r'`((?:references|scripts)/[^`]+)`')
for p in skills:
    text=p.read_text()
    for rel in asset_re.findall(text):
        # Strip punctuation accidentally captured inside code spans only when it is obvious.
        target=p.parent/rel
        if not target.exists(): err(f'{p.relative_to(ROOT)}: missing referenced asset {rel}')

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
        err(f'missing profile config: {path.relative_to(ROOT)}')
        continue
    cfg=yaml.safe_load(path.read_text()) or {}
    roles=cfg.get('modelRoles') or {}
    expected_roles=required_roles
    if set(roles) != expected_roles:
        err(f'{path.relative_to(ROOT)}: modelRoles mismatch: {sorted(set(roles)^expected_roles)}')
    profile_roles[profile]=set(roles)
    prefix=profile+'/'
    for role,model in roles.items():
        if not isinstance(model,str) or not model.startswith(prefix):
            err(f'{path.relative_to(ROOT)}: modelRoles.{role} must use {prefix}*, got {model!r}')

expected_openai={
    'default':'openai-codex/gpt-5.6-terra',
    'smol':'openai-codex/gpt-5.6-luna',
    'tiny':'openai-codex/gpt-5.6-luna:low',
    'vision':'openai-codex/gpt-5.6-luna',
    'execute':'openai-codex/gpt-5.6-luna',
    'task':'openai-codex/gpt-5.6-terra',
    'plan':'openai-codex/gpt-5.6-sol:high',
    'slow':'openai-codex/gpt-5.6-sol:high',
    'review_aux':'openai-codex/gpt-5.6-terra:high',
    'critical':'openai-codex/gpt-5.6-sol:xhigh',
    'commit':'openai-codex/gpt-5.6-luna:low',
}
openai=yaml.safe_load(profile_cfgs['openai-codex'].read_text()).get('modelRoles',{})
if openai != expected_openai:
    err('profiles/openai-codex/config.yml: role mapping drifted from documented routing')

expected_ollama={
    'default':'ollama-cloud/deepseek-v4-pro:high',
    'smol':'ollama-cloud/deepseek-v4.1-flash:low',
    'tiny':'ollama-cloud/deepseek-v4.1-flash:low',
    'vision':'ollama-cloud/glm-5.3-flash:high',
    'execute':'ollama-cloud/glm-5.3-flash:high',
    'task':'ollama-cloud/glm-5.3-flash:high',
    'plan':'ollama-cloud/deepseek-v4-pro:high',
    'slow':'ollama-cloud/deepseek-v4-pro:high',
    'review_aux':'ollama-cloud/glm-5.3-flash:high',
    'critical':'ollama-cloud/kimi-k3:high',
    'commit':'ollama-cloud/deepseek-v4.1-flash:low',
}
ollama=yaml.safe_load(profile_cfgs['ollama-cloud'].read_text()).get('modelRoles',{})
if ollama != expected_ollama:
    err('profiles/ollama-cloud/config.yml: role mapping drifted from documented routing')

expected_anthropic={
    'default':'anthropic/claude-opus-5:high',
    'smol':'anthropic/claude-haiku-4-5-20251001',
    'tiny':'anthropic/claude-haiku-4-5-20251001',
    'vision':'anthropic/claude-sonnet-5:high',
    'execute':'anthropic/claude-sonnet-5:high',
    'task':'anthropic/claude-sonnet-5:high',
    'plan':'anthropic/claude-opus-5:high',
    'slow':'anthropic/claude-opus-5:high',
    'review_aux':'anthropic/claude-sonnet-5:high',
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
    if 'eval' in approval: err(f'{path.relative_to(ROOT)}: blanket tools.approval.eval must remain unset')
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
        if pattern_map.get(command) != 'prompt': err(f'{path.relative_to(ROOT)}: publication prompt missing for {command}')
    if 'gh api*' in pattern_map: err(f'{path.relative_to(ROOT)}: broad gh api* prompt must stay narrowed to method/body flags')
    for match,_ in pattern_lists[profile]:
        if match.startswith('tea '): err(f'{path.relative_to(ROOT)}: Forgejo pattern survived: {match}')
if len({tuple(v) for v in pattern_lists.values()})!=1: err('profiles: bash.patterns lists differ between profiles')

# Every role-backed Flow agent must resolve in every managed provider profile.
for p in agents:
    fm,_=frontmatter(p)
    model=fm.get('model')
    if isinstance(model,str) and model.startswith('@'):
        role=model[1:]
        for profile,roles in profile_roles.items():
            if role not in roles:
                err(f'{p.relative_to(ROOT)}: role {model} missing from {profile} profile')

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
for required in [
    'native `hub wait` is a legitimate dependency primitive',
    'does not override native agent hub wait semantics',
    'answers to clarification questions do not themselves approve',
    'approved governing what/why contract before planning',
    'substantial consequential how is then planner-owned',
    'substantial planned work has two explicit user approval gates',
    'main coordinating/escalating rather than becoming the production writer',
    'later production-, asset-, or build-affecting mutation reopens',
    'rerun only evidence whose owned dependency surface changed',
]:
    if required not in principles: err(f'docs/PRINCIPLES.md invariant missing: {required}')
if 'unresolved semantic/debugging/integration judgment → main/`@task`' in principles:
    err('docs/PRINCIPLES.md: ambiguous Main semantic-writer routing survived')

migration=(ROOT/'docs/MIGRATION.md').read_text().lower()
for stale in ['deepseek v4 flash low', '`default` / `plan` / `slow` / `review_aux`: deepseek v4 pro high']:
    if stale in migration: err(f'docs/MIGRATION.md stale Ollama routing survived: {stale}')
for required in ['deepseek v4.1 flash low', '`execute` / `task` / `vision` / `review_aux`: glm-5.3-flash high']:
    if required not in migration: err(f'docs/MIGRATION.md current Ollama routing missing: {required}')

verification_doctrine=(ROOT/'agent/skills/flow-ldd/references/verification-doctrine.md').read_text().lower()
for required in ['reuse recent proof by claim dependency', 'later change stales only proof whose dependency surface it can affect']:
    if required not in verification_doctrine: err(f'LDD verification doctrine freshness invariant missing: {required}')
if 'reuse a recent proof only if the exact tree/head' in verification_doctrine:
    err('LDD verification doctrine stale exact-tree-only freshness rule survived')

if errors:
    print('\n'.join('FAIL: '+e for e in errors)); sys.exit(1)
print(f'ok: {len(skills)} skills, {len(agents)} agents, {len(rules)} rules')
