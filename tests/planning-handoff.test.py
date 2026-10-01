from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "agent/skills/flow-external-session"
VALIDATOR = SKILL / "scripts/validate-planning-handoff.py"


def run(*args: object, validator: Path = VALIDATOR) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(validator), *map(str, args)],
        text=True,
        capture_output=True,
        check=False,
    )


def manifest(**updates: object) -> dict[str, object]:
    data: dict[str, object] = {
        "flow_handoff": 2,
        "source": "open-webui",
        "repository": "fiatcode-gh/residuum-rpg-cli",
        "observed_ref": "0e00372c49eac3420f93186b39023439348d3678",
        "design_status": "settled",
        "implementation_strategy": "settled",
        "authorization": "not-carried",
        "artifacts": ["HANDOFF.md"],
    }
    data.update(updates)
    return data


def write_bundle(root: Path, data: object) -> None:
    (root / "HANDOFF.md").write_text("# Handoff\n", encoding="utf-8")
    (root / "FLOW-HANDOFF.json").write_text(json.dumps(data), encoding="utf-8")


def rejects(data: object, message: str, prepare=None) -> None:
    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / "bundle"
        root.mkdir()
        write_bundle(root, data)
        if prepare:
            prepare(root)
        result = run(root)
        assert result.returncode == 2, (message, result.returncode, result.stdout, result.stderr)
        assert message in result.stderr, (message, result.stderr)


# A valid bundle passes, by directory and by manifest path.
with tempfile.TemporaryDirectory() as td:
    root = Path(td)
    write_bundle(root, manifest())
    for target in (root, root / "FLOW-HANDOFF.json"):
        result = run(target)
        assert result.returncode == 0, result.stderr
        assert "ok: planning handoff v2" in result.stdout

# Invocation and manifest-file rejects.
result = run()
assert result.returncode == 2 and "usage:" in result.stderr, result.stderr
with tempfile.TemporaryDirectory() as td:
    other = Path(td) / "handoff.json"
    other.write_text("{}", encoding="utf-8")
    result = run(other)
    assert result.returncode == 2 and "must be named FLOW-HANDOFF.json" in result.stderr, result.stderr
    result = run(Path(td))
    assert result.returncode == 2 and "manifest not found" in result.stderr, result.stderr
rejects(None, "manifest root must be a JSON object")
rejects(manifest(), "cannot parse manifest JSON", lambda root: (root / "FLOW-HANDOFF.json").write_text("{", encoding="utf-8"))

# Field rejects, in validator order.
rejects(manifest(flow_handoff=1, kind="ldd", epic="demo-epic"), "schema v1 is retired: remove kind and epic")
without_source = manifest()
del without_source["source"]
rejects(without_source, "missing required fields: source")
rejects(manifest(kind="ldd"), "unknown fields for schema v2: kind")
rejects(manifest(flow_handoff=3), "flow_handoff must be exactly 2")
rejects(manifest(source=""), "source must be a non-empty string")
rejects(manifest(repository=7), "repository must be a non-empty string")
rejects(manifest(observed_ref="  "), "observed_ref must be a non-empty string")
rejects(manifest(design_status="done"), "invalid design_status")
rejects(manifest(implementation_strategy="done"), "invalid implementation_strategy")
rejects(manifest(authorization="local-writes-approved"), "authorization must be exactly not-carried")
rejects(manifest(artifacts=[]), "artifacts must be a non-empty array")
rejects(manifest(artifacts="HANDOFF.md"), "artifacts must be a non-empty array")
rejects(manifest(artifacts=["HANDOFF.md", "HANDOFF.md"]), "artifacts contains duplicate entries")
rejects(manifest(artifacts=["HANDOFF.md", 3]), "artifact path must be a non-empty string")
rejects(manifest(artifacts=["HANDOFF.md", "/etc/hostname"]), "artifact path must be relative without '..'")
rejects(manifest(artifacts=["HANDOFF.md", "../outside.md"]), "artifact path must be relative without '..'")
rejects(manifest(artifacts=["HANDOFF.md", "PLAN.md"]), "declared artifact is missing: PLAN.md")
rejects(
    manifest(artifacts=["HANDOFF.md", "escape.md"]),
    "artifact escapes bundle root: escape.md",
    lambda root: ((root.parent / "outside.md").write_text("outside\n", encoding="utf-8"), os.symlink(root.parent / "outside.md", root / "escape.md")),
)
rejects(manifest(artifacts=["HANDOFF.md", "units"]), "artifact must be a file: units", lambda root: (root / "units").mkdir())
rejects(manifest(artifacts=["PLAN.md"]), "artifacts must declare HANDOFF.md", lambda root: (root / "PLAN.md").write_text("# Plan\n", encoding="utf-8"))

# The validator takes its field set and enums from the shipped schema.
with tempfile.TemporaryDirectory() as td:
    copy = Path(td) / "skill"
    shutil.copytree(SKILL / "scripts", copy / "scripts")
    shutil.copytree(SKILL / "references", copy / "references")
    schema_path = copy / "references/planning-handoff.schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    schema["properties"]["design_status"]["enum"].append("experimental")
    schema_path.write_text(json.dumps(schema), encoding="utf-8")
    bundle = Path(td) / "bundle"
    bundle.mkdir()
    write_bundle(bundle, manifest(design_status="experimental"))
    result = run(bundle, validator=copy / "scripts/validate-planning-handoff.py")
    assert result.returncode == 0, result.stderr

print("ok: planning handoff validator")
