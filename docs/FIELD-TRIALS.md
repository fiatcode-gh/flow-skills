# Flow field trials

This ledger tracks the two-clean-pass field-trial mark for each **Flow skill**.

Marks belong to Flow skills, not to sessions. One substantial OMP session may exercise several skills; audit each materially exercised skill independently. `CLEAN` increments only the skill whose current behavior was exercised without a material invariant failure. A clear model/controller compliance failure makes that skill's trial not clean but does not by itself justify a doctrine patch.

A behavior/doctrine change resets only the affected skill mark. A shared/global rule change resets every skill whose behavior it materially changes. Historical clean evidence remains useful evidence but does not count toward a reset active mark.

The Weft lifecycle integration in the change that introduced this ledger is shared Flow behavior, so all active marks start at `0/2` on this new baseline. `flow-review` additionally changes its temporary-workspace mechanics here.

| Flow skill | Active mark | Current-baseline note |
|---|---:|---|
| `flow-assets` | 0/2 | Reset by shared Weft lifecycle integration. |
| `flow-debugging` | 0/2 | Reset by shared Weft lifecycle integration. |
| `flow-design` | 0/2 | Reset by shared Weft lifecycle integration. |
| `flow-execution` | 0/2 | Reset by shared Weft lifecycle integration. |
| `flow-external-session` | 0/2 | Reset by shared Weft lifecycle integration. |
| `flow-integrating` | 0/2 | Reset by shared Weft lifecycle integration. |
| `flow-ldd` | 0/2 | Reset by shared Weft lifecycle integration. |
| `flow-planning` | 0/2 | Reset by shared Weft lifecycle integration. |
| `flow-review` | 0/2 | Reset by shared Weft lifecycle + standardized review temp workspace. |
| `flow-tdd` | 0/2 | Reset by shared Weft lifecycle integration. |

## Historical clean evidence

- `flow-review` reached **1/2** on the previous baseline `91a0cc8d93741675467d7c2092765c60d6308f84` from the clean `review-pr-620` PR-review trial. That pass remains historical evidence but does not carry across this behavior change.
