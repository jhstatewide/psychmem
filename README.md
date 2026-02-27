# PsychMem

> **⚠️ This repository is now maintained as a fork by jhstatewide.**
>
> This fork drops support for Claude Code and continues PsychMem development for OpenCode.
>
> Our working theory is that the previously cited limitations do not apply in the same way to OpenCode: its plugin system is richer, and because OpenCode is open source, we can modify integration points where needed instead of treating plugin hooks as fixed constraints.
>
> **For users:** this project now targets OpenCode-only workflows.
>
> **For contributors:** development continues here under the jhstatewide fork.
>
> This repository is a fork of the original PsychMem project: https://github.com/muratg98/psychmem

---

## What We Learned

PsychMem was an attempt to give AI coding agents persistent memory modelled on cognitive science — dual-store STM/LTM, Ebbinghaus decay curves, BM25 retrieval, psychology-grounded importance scoring.

The memory model itself is sound. The architecture is wrong.

The upstream implementation found real constraints at the plugin/hook layer and reached the conclusion that infrastructure-level control was required.

This fork takes a different position for OpenCode specifically: because OpenCode is open source and has a richer extension surface, we can iterate beyond hook-only limitations and evolve the integration where necessary.

---

## Fork Direction

PsychMem development in this repository now focuses on OpenCode-only support under the jhstatewide fork.

What this means in practice:

1. Drop Claude Code compatibility and related assumptions
2. Lean on OpenCode's richer plugin architecture
3. Patch or extend OpenCode integration points directly when needed

---

## Original Concept

The original PsychMem concept — psychology-grounded selective memory with decay, consolidation, and scoped injection — remains the design goal. The research references below informed the model:

1. **Atkinson & Shiffrin** (1968) — Dual-store model (STM/LTM)
2. **Ebbinghaus** (1885) — Forgetting curves
3. **Miller** (1956) — Working memory limits (7 ± 2)
4. **Cowan** (2001) — Updated working memory capacity model
5. **Nader et al.** (2000) — Memory reconsolidation
6. **McGaugh** (2000) — Memory consolidation
7. **Craik & Lockhart** (1972) — Levels of processing
8. **Anderson & Schooler** (1991) — Environmental reflections in memory

---

## License

MIT
