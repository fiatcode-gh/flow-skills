"""Behavioral test for scripts/flow-sessions list and render on fixture transcripts."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/flow-sessions"


def call(*args: str, home: Path, config_dir: str | None) -> subprocess.CompletedProcess[str]:
    env = {k: v for k, v in os.environ.items() if k != "PI_CONFIG_DIR"}
    env["HOME"] = str(home)
    if config_dir is not None:
        env["PI_CONFIG_DIR"] = config_dir
    return subprocess.run([sys.executable, str(SCRIPT), *args], env=env, text=True, capture_output=True, check=False)


def tool_call(name: str, arguments: dict) -> dict:
    return {"type": "toolCall", "name": name, "arguments": arguments}


def assistant(*parts: dict) -> dict:
    return {"type": "message", "timestamp": "2026-10-01T02:00:05.000Z", "message": {"role": "assistant", "content": list(parts)}}


def write_session(path: Path, title: str, lines: list[object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    header = {"type": "session", "id": "x", "timestamp": "2026-10-01T02:00:00.000Z", "cwd": "/work/demo", "title": title}
    encoded = [line if isinstance(line, bytes) else json.dumps(line).encode() for line in [header, *lines]]
    path.write_bytes(b"\n".join(encoded) + b"\n")


with tempfile.TemporaryDirectory() as td:
    home = Path(td)
    sessions = home / ".custom/profiles/anthropic/agent/sessions/-work-demo"
    broken = sessions / "2026-10-01T02-00-00-000Z_aaaaaaaa-0000.jsonl"
    write_session(broken, "broken one", [
        {"type": "model_change", "model": "anthropic/m1"},
        b"{not json",
        assistant(
            tool_call("read", {"path": "skill://flow-planning"}),
            tool_call("task", {"agent": " flow-planner ", "task": "Plan it."}),
            tool_call("task", {"task": "Default agent."}),
            tool_call("task", {"context": "c", "tasks": [{"agent": "scout", "task": "a"}, {"task": "b"}]}),
            tool_call("flow_gate", {"action": "approve", "kind": "plan"}),
        ),
        b"\xff\xfe{}",
        b'{"type": "message", "message": {"role": "user", "content": "trunc',
        {"type": "message", "message": "oops"},
        {"type": "model_change"},
        {"type": "message", "message": {"role": "assistant", "content": ["not a part", tool_call("task", {"task": "late"})]}},
        {"type": "message", "message": {"role": "assistant", "content": "a plain string"}},
        {"type": "model_change", "model": ""},
    ])
    write_session(sessions / "2026-10-01T03-00-00-000Z_bbbbbbbb-0000.jsonl", "clean one", [
        {"type": "message", "timestamp": "2026-10-01T03:00:01.000Z", "message": {"role": "user", "content": "hello"}},
    ])

    listed = call("list", home=home, config_dir=".custom")
    assert listed.returncode == 0, listed.stderr
    assert "broken one" in listed.stdout and "clean one" in listed.stdout, listed.stdout
    assert "2 session(s)" in listed.stderr, listed.stderr
    assert f"{broken}#2: skipped undecodable line" in listed.stderr, listed.stderr
    assert f"{broken}#4: skipped undecodable line" in listed.stderr, listed.stderr
    assert f"{broken}#5: skipped undecodable line" in listed.stderr, listed.stderr
    for index in (6, 7):
        assert f"{broken}#{index}: skipped malformed row" in listed.stderr, listed.stderr
    assert f"{broken}#9: skipped malformed row" in listed.stderr, listed.stderr
    assert f"{broken}#8: skipped malformed row" not in listed.stderr, listed.stderr
    assert "bbbbbbbb" not in listed.stderr, "a user message with string content is normal and gets no note"
    assert "agents  {'flow-planner': 1, 'task': 3, 'scout': 1}" in listed.stdout, listed.stdout
    assert "skills  {'flow-planning': 1}" in listed.stdout, listed.stdout
    assert "gates {'approve:plan': 1}" in listed.stdout, listed.stdout

    # Without PI_CONFIG_DIR the default root is $HOME/.omp/profiles, which holds nothing here.
    default = call("list", home=home, config_dir=None)
    assert default.returncode == 0 and "0 session(s)" in default.stderr, default.stderr

    # Render keeps the transcript's own line numbers across skipped lines.
    rendered = call("render", str(broken), home=home, config_dir=".custom")
    assert rendered.returncode == 0, rendered.stderr
    assert "[#1 ] MODEL anthropic/m1" in rendered.stdout, rendered.stdout
    assert "[#3 02:00:05] CALL task:" in rendered.stdout, rendered.stdout
    assert f"{broken}#2: skipped undecodable line" in rendered.stderr, rendered.stderr
    assert f"{broken}#6: skipped malformed row" in rendered.stderr, rendered.stderr
    assert f"{broken}#7: skipped malformed row" in rendered.stderr, rendered.stderr
    assert f"{broken}#10: skipped malformed row" in rendered.stderr, rendered.stderr
    assert "MODEL None" not in rendered.stdout and "[#10" not in rendered.stdout, rendered.stdout
    assert "[#8 ] CALL task:" in rendered.stdout, rendered.stdout

print("ok: flow-sessions list/render")
