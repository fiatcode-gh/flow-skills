---
name: ui-design
description: Use when designing or substantially redesigning a web/mobile/desktop interface or visual component; extend an existing product language first, or establish a deliberate accessible aesthetic for greenfield work.
---

# UI design

Design for the product before designing for spectacle.

## 1. Read the existing language

For an existing product, inspect the actual design system/components/tokens, typography, spacing, navigation, interaction patterns, platform idioms and accessibility conventions. Extend that language unless the user explicitly asked for a redesign.

For greenfield work, establish a deliberate direction rather than defaulting to generic AI-dashboard aesthetics.

## 2. Define the design intent

Clarify only what changes the result:

- purpose and primary user;
- target platform/framework/input model;
- information hierarchy and key task;
- accessibility/performance constraints;
- desired tone and the one memorable visual/interaction idea, if the product benefits from one.

## 3. Execute coherently

- Typography: use the product's established type system first. In greenfield, choose characterful but readable typography; avoid novelty that harms legibility/localization.
- Color: use tokens/semantic roles, sufficient contrast and intentional hierarchy. Do not distribute accents timidly or randomly.
- Layout: strong hierarchy and spacing rhythm before decoration; responsive behavior is part of the design.
- Motion: purposeful transitions/feedback using platform-native idioms; respect reduced-motion preferences and avoid motion that blocks work.
- Components: real states — loading, empty, error, disabled, focus, hover/pressed where applicable.
- Accessibility: keyboard/focus/semantics/touch targets/contrast are design requirements, not cleanup.

## 4. Avoid generic output

Do not auto-produce glassmorphism, purple gradients, interchangeable card grids, arbitrary giant hero text, excessive rounded rectangles or ornamental motion just because they look "designed". Distinction must come from the product's purpose and chosen direction.

When implementing, reuse existing components/tokens and verify at relevant viewport/input states.
