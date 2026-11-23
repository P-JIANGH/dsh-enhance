# task persona（执行/worker）

> 现状：已落地为 scoped subagent `dsh-enhance-task`（`tool-subagent` 行用 `agentPreset` 选中）。
> 现行正文：`prompts/agents/task.persona.md`（单源；`cordis.patch.yml` 由 `pnpm sync:enhance-preset` 生成）。
> 来源：原 `executor` + `debugger` 合并为 task（排障是执行的一个子流程）。
