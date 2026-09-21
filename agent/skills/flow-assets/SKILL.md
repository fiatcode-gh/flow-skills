---
name: flow-assets
description: Use when repository work needs a generated visual asset, a semantic edit to an existing asset, or deterministic technical conformance of accepted visual content; derive requirements from the real consumer and project visual language, stage candidates under .flow/assets, and accept assets in their intended usage context.
---

# Flow assets

Produce repository assets from **actual consumer context**, not from an early speculative asset list. This skill owns the asset contract, portable generation bundle, candidate staging, deterministic conformance boundary, and contextual verification handoff. It does not prescribe one image-generation backend.

## 1. Classify the operation

Choose exactly one primary operation:

- **GENERATE** — no suitable source asset exists; new visual content is required.
- **EDIT** — a suitable source asset exists, but its semantic or visual content must change.
- **CONFORM** — the visual content is already accepted; only deterministic technical transformation remains.

Do not use deterministic tooling to disguise a GENERATE/EDIT problem. Wrong subject, composition, perspective, style, silhouette, semantic detail, or visual hierarchy requires generation/editing again.

## 2. Generate late from repository reality

Before generating or semantically editing an asset, inspect the real consumer and derive the requirement from current repository state. Prefer implementation with a placeholder over speculative production art when the consumer is not concrete yet.

Determine what applies:

- consuming code/config/symbol and final output path;
- actual rendered/display size and required source dimensions/aspect ratio;
- format, transparency, anchor/alignment, safe area and padding;
- neighboring visuals and current rendered context;
- design system, art bible, brand guide, mock, asset manifest or equivalent governing source;
- a small set of the most relevant approved reference assets;
- must-include, must-preserve and must-avoid constraints;
- acceptance criteria that can be observed in the intended consumer.

If material requirements are still unknown, keep the placeholder and return the missing decisions instead of inventing a production asset.

## 3. Create the portable asset bundle

Run the `flow-artifacts` exclude guard before the first write under `.flow/`, then create:

```text
.flow/assets/<asset-id>/
  ASSET.md
  context/
  references/
  candidates/
```

Use `references/asset-contract.md` as the ASSET.md schema. Copy only the context and approved references needed to reproduce the request. Do not dump the whole asset library into the bundle.

The bundle must be sufficient for a generation/editing backend that cannot read the repository directly. Repository structure is useful only insofar as it changes the asset requirement.

Candidates remain staging artifacts under `.flow/assets/<asset-id>/candidates/` until promoted. Do not write a generated candidate directly over the production asset merely because generation succeeded.

## 4. Generate or edit through a replaceable backend

For GENERATE or EDIT, use an available and authorized image-generation/editing backend when one exists. Otherwise provide the portable bundle for external generation and resume from the returned candidate.

The backend receives:

- the derived asset contract;
- relevant context images;
- the selected approved references;
- the existing source asset for EDIT;
- explicit instructions distinguishing style references, scene context and editable source.

Start with one candidate. Review the concrete mismatch before requesting another attempt. Default budget:

1. initial generation/edit;
2. one targeted correction based on observed mismatch;
3. one final bounded correction when evidence justifies it.

After that, stop and report the unresolved mismatch instead of generating an unbounded variant pile.

## 5. Conform accepted visual content deterministically

Use ImageMagick through `scripts/conform-image` only when technical transformation is required after the visual content is acceptable.

Appropriate conformance includes:

- format conversion;
- resize to an exact technical envelope;
- crop/trim when explicitly allowed by the contract;
- exact canvas extension, padding and gravity/anchor placement;
- alpha-channel validation;
- dimension validation;
- metadata stripping.

The helper is optional: the skill remains usable without ImageMagick when no conformance is needed. If conformance is required and ImageMagick is unavailable, report that dependency instead of improvising a lossy workaround.

Do not heuristically remove backgrounds, recolor artwork, reconstruct missing detail, change composition, or perform other creative repair under the label of conformance. Route those back to EDIT.

## 6. Promote deliberately

Before moving a candidate to its production path:

1. inspect the candidate against ASSET.md;
2. run required deterministic conformance;
3. validate file format/dimensions/alpha and other machine-checkable constraints;
4. install it at the exact consumer path;
5. update an asset manifest or repository metadata only when the project owns such a surface.

Preserve existing repository naming/import conventions.

## 7. Accept in context

A standalone image is not sufficient acceptance evidence when the asset has a render/use context.

Verify the promoted asset in the actual consumer at realistic scale/state:

- game asset → rendered game scene;
- web/mobile/desktop illustration → rendered UI surface;
- icon → actual icon/launcher/component presentation;
- document/marketing visual → rendered document/page/layout;
- other asset → the closest real consumer available.

Compare against the governing visual rules, neighboring assets, mock/reference intent and the explicit acceptance criteria in ASSET.md.

For multi-step visual/device acceptance, hand the evidence gate to `flow-evidence-verifier` under the normal `flow-execution` evidence-capsule doctrine. That verifier gathers evidence only; Main owns the acceptance judgment.

If contextual verification exposes a creative mismatch, return to EDIT/GENERATE. If it exposes only a technical envelope mismatch, return to CONFORM.

## 8. Receipt

Return a compact receipt:

- asset ID and operation;
- consumer and final production path;
- asset-bundle path;
- references/context used;
- generation/edit attempt count and backend boundary;
- conformance command/result, if any;
- production file technical validation;
- contextual evidence and PASS/FAIL/UNKNOWN criteria;
- unresolved mismatch or exact next action.

The governing rule is simple: **generate late, conform deterministically, accept in context**.
