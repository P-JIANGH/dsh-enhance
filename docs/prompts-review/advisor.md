# advisor 模式（伴随审核模型）

> 现状：已落地为 per-session 的 advisor 运行时（`src/features/advisor/`），以独立 `ctx.llm.stream()` 审查调用实现。
> 现行正文：`prompts/modes/advisor.md`（含"本次审查无工具、只凭增量"的契约与 `ADVISOR: NONE` 输出协定）。
> 来源：oh-my-pi（omp）的伴随审核模型；严重度语义沿用 `nit` / `concern` / `blocker`。
