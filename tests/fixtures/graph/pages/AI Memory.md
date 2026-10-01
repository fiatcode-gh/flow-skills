AI memory hub — fixture graph for load-ai-memory tests. Not real memories.

## Global — workflow & preferences (apply everywhere, every tool)
- GLOBAL_MARK always-injected global memory (via [[Site]])

## Harness: [[Claude]]
- CLAUDEHARNESS_MARK memory true only in one harness

## Harness: [[pi]]
- PIHARNESS_MARK memory true only in another harness

## Harness: [[OMP]]
- OMPHARNESS_MARK memory true only in the OMP harness

## [[weft]]
- WEFT_MARK weft-scoped memory (via [[weft]])

## [[Fruit Tracker]]
- FRUIT_MARK fruit-tracker-scoped memory (via [[peekseq]])

## [[claude]]
- CLAUDEPROJ_MARK project section whose name collides with a harness key

## Other
- OTHER_MARK orphan memory with no project page

## [[Global Fruit]]
- GBLFRT_MARK project section whose name merely starts with the word Global

## Globalization
- GLOBALIZATION_MARK section whose single-word name starts with Global
