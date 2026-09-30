from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "agent/skills/flow-external-session/scripts/validate-planning-handoff.py"


def run(bundle: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(VALIDATOR), str(bundle)],
        text=True,
        capture_output=True,
        check=False,
    )


def manifest(**updates: object) -> dict[str, object]:
    data: dict[str, object] = {
        "flow_handoff": 2,
        "source": "chatgpt",
        "repository": "fiatcode-gh/residuum-rpg-cli",
        "observed_ref": "0e00372c49eac3420f93186b39023439348d3678",
        "design_status": "settled",
        "implementation_strategy": "settled",
        "authorization": "not-carried",
        "artifacts": ["HANDOFF.md"],
    }
    data.update(updates)
    return data


def write_bundle(root: Path, data: dict[str, object]) -> None:
    (root / "HANDOFF.md").write_text("# Handoff\n", encoding="utf-8")
    (root / "FLOW-HANDOFF.json").write_text(json.dumps(data), encoding="utf-8")


with tempfile.TemporaryDirectory() as td:
    root = Path(td)
    write_bundle(root, manifest())
    result = run(root)
    assert result.returncode == 0, result.stderr
    assert "ok: planning handoff v2" in result.stdout

with tempfile.TemporaryDirectory() as td:
    root = Path(td)
    write_bundle(root, manifest(flow_handoff=1, kind="ldd", epic="demo-epic"))
    result = run(root)
    assert result.returncode == 2
    assert "schema v1 is retired: remove kind and epic" in result.stderr

with tempfile.TemporaryDirectory() as td:
    root = Path(td)
    write_bundle(root, manifest(authorization="local-writes-approved"))
    result = run(root)
    assert result.returncode == 2
    assert "authorization must be exactly not-carried" in result.stderr

with tempfile.TemporaryDirectory() as td:
    root = Path(td)
    outside = root.parent / "flow-handoff-outside-test.md"
    outside.write_text("outside\n", encoding="utf-8")
    try:
        write_bundle(root, manifest(artifacts=["HANDOFF.md", "../flow-handoff-outside-test.md"]))
        result = run(root)
        assert result.returncode == 2
        assert "relative without '..'" in result.stderr
    finally:
        outside.unlink(missing_ok=True)

print("ok: planning handoff validator")
