# Asset Contract

Copy this template to `.flow/assets/<asset-id>/ASSET.md` and remove sections that truly do not apply. Do not leave consequential fields as vague placeholders.

## Identity

- Asset ID:
- Operation: GENERATE | EDIT | CONFORM
- Purpose:
- Consumer:
- Final output path:
- Source revision / dirty-state assumption:

## Technical requirements

- Required format:
- Required source dimensions:
- Aspect ratio:
- Actual rendered/display size:
- Transparency / alpha:
- Anchor / alignment / gravity:
- Safe area / padding:
- File-size / compression constraint:
- Other machine-checkable requirements:

## Visual requirements

- Governing visual language:
- Must include:
- Must preserve:
- Must avoid:
- Readability / silhouette / hierarchy requirement:
- Perspective / projection requirement:
- Color / material / texture constraint:

## Context

- Usage surface / scene:
- Neighboring visuals:
- Context images in `context/`:
- Relevant approved references in `references/`:
- Governing visual docs / manifests:
- Relevant code/config paths or symbols:

## Source inputs

- Existing source asset(s), if EDIT/CONFORM:
- Generation/edit references:
- Structural reference / mask, if applicable:
- Notes distinguishing editable source vs style/context references:

## Generation / editing boundary

- Backend: replaceable / not prescribed by Flow
- Initial request:
- Targeted correction allowed:
- Final bounded correction allowed:
- Stop condition:

## Deterministic post-processing policy

Allowed transforms:
- format conversion:
- resize:
- trim/crop:
- canvas extension:
- padding:
- gravity/anchor placement:
- metadata stripping:
- alpha validation:
- other:

Forbidden transforms:
- creative/semantic repair by deterministic tooling:
- heuristic background removal:
- unapproved recoloring:
- other:

## Acceptance

Machine-checkable:
- format:
- dimensions:
- alpha:
- other:

Contextual:
- consumer/render state:
- realistic display scale:
- comparison references:
- PASS criteria:
- FAIL criteria:

## Result

- Candidate selected:
- Conformance performed:
- Promoted production file:
- Contextual evidence:
- Final status: PASS | FAIL | UNKNOWN
- Residual issue / next action:
