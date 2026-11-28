# Public README, MIT license, and doctor's main-model reasons

2026-11-28. One unit, two parts.

## Public README and license

- The repository was already public but read as the author's install notes, and had no license, so nobody could legally reuse it. The README is now written for a visitor: what Flow is and why, one session walked through, generic install, and which parts are personal (instructions, Weft, Open WebUI prompts, providers, ClickUp, the `fiatcode` name) and how to change them.
- License: MIT, `Copyright (c) 2026 fiatcode`. CC0 was weighed and rejected: it drops even the notice in copies, and MIT keeps a credit line at no real cost to a reuser. CC BY 4.0 was rejected because Creative Commons advises against it for software, and skills are prompts that act as code; splitting licenses by file type would make most files ambiguous.
- Stance: shared as-is; issues and ideas welcome; no promise of support or of merging pull requests.
- Trap: removing Weft or renaming the plugin reaches further than the obvious folders. The README recipes name the hidden places (`tests/run.sh`, the `tests/validate.py` skill set, the `mcp__fiatcode__flow_gate` tool id; a rename that misses the id leaves approvals unrecorded).
- Left out: topics, CONTRIBUTING, issue templates, and rewriting the 5 early commits authored with a work email (a Weft backlog item; it moves tag commits).

## Doctor's main-model reasons

- On OpenCode 2.4.1 the one-shot `model.default` answers null, so `doctor` asks a server started with the profile's config. Before this change every failure of that fallback printed the version SKIP.
- Now only null data from the profile's server SKIPs. No listening URL, a failing `model.default` on the server, or an answer that is neither model nor null each FAIL with the cause. FAIL, not SKIP, because doctor's job is to say whether the install works, and it already FAILs when its main server reports no URL; a slow machine raises `FLOW_OPENCODE_SERVE_WAIT`.
- Left out: the `plugin.list` wait. When plugins never list, the `model.default` answer still decides the line.
