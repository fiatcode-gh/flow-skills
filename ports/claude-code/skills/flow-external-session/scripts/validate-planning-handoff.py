#!/usr/bin/env python3
"""Read-only validator for Flow static planning handoff bundles."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# The schema is the single source of the field set, enums and constants.
SCHEMA = json.loads(
    (Path(__file__).resolve().parent.parent / "references" / "planning-handoff.schema.json").read_text(encoding="utf-8")
)
PROPERTIES = SCHEMA["properties"]
REQUIRED = set(SCHEMA["required"])
VERSION = PROPERTIES["flow_handoff"]["const"]
AUTHORIZATION = PROPERTIES["authorization"]["const"]
ALLOWED_DESIGN = set(PROPERTIES["design_status"]["enum"])
ALLOWED_STRATEGY = set(PROPERTIES["implementation_strategy"]["enum"])


def fail(message: str) -> "NoReturn":
    print(f"invalid handoff: {message}", file=sys.stderr)
    raise SystemExit(2)


def nonempty_string(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        fail(f"{field} must be a non-empty string")
    return value


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: validate-planning-handoff.py <bundle-dir-or-FLOW-HANDOFF.json>", file=sys.stderr)
        return 2

    supplied = Path(argv[1]).expanduser()
    manifest = supplied / "FLOW-HANDOFF.json" if supplied.is_dir() else supplied
    if manifest.name != "FLOW-HANDOFF.json":
        fail("manifest file must be named FLOW-HANDOFF.json")
    if not manifest.is_file():
        fail(f"manifest not found: {manifest}")

    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        fail(f"cannot parse manifest JSON: {exc}")
    if not isinstance(data, dict):
        fail("manifest root must be a JSON object")
    if data.get("flow_handoff") == 1:
        fail("schema v1 is retired: remove kind and epic, then set flow_handoff to 2")

    missing = sorted(REQUIRED - data.keys())
    extra = sorted(data.keys() - PROPERTIES.keys())
    if missing:
        fail(f"missing required fields: {', '.join(missing)}")
    if extra:
        fail(f"unknown fields for schema v2: {', '.join(extra)}")

    if data["flow_handoff"] != VERSION:
        fail(f"flow_handoff must be exactly {VERSION}")
    nonempty_string(data["source"], "source")
    nonempty_string(data["repository"], "repository")
    nonempty_string(data["observed_ref"], "observed_ref")
    if data["design_status"] not in ALLOWED_DESIGN:
        fail("invalid design_status")
    if data["implementation_strategy"] not in ALLOWED_STRATEGY:
        fail("invalid implementation_strategy")
    if data["authorization"] != AUTHORIZATION:
        fail(f"authorization must be exactly {AUTHORIZATION}")

    artifacts = data["artifacts"]
    if not isinstance(artifacts, list) or not artifacts:
        fail("artifacts must be a non-empty array")
    if len(artifacts) != len(set(map(str, artifacts))):
        fail("artifacts contains duplicate entries")

    root = manifest.parent.resolve()
    for raw in artifacts:
        rel_text = nonempty_string(raw, "artifact path")
        rel = Path(rel_text)
        if rel.is_absolute() or ".." in rel.parts:
            fail(f"artifact path must be relative without '..': {rel_text}")
        target = root / rel
        try:
            resolved = target.resolve(strict=True)
        except OSError:
            fail(f"declared artifact is missing: {rel_text}")
        try:
            common = os.path.commonpath([str(root), str(resolved)])
        except ValueError:
            fail(f"artifact escapes bundle root: {rel_text}")
        if common != str(root):
            fail(f"artifact escapes bundle root: {rel_text}")
        if not resolved.is_file():
            fail(f"artifact must be a file: {rel_text}")

    if "HANDOFF.md" not in artifacts:
        fail("artifacts must declare HANDOFF.md")

    print(
        "ok: planning handoff v2 "
        f"repository={data['repository']} observed_ref={data['observed_ref']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
