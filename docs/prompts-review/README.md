# oh-my-dsh M2 提示词审查稿（索引）

> 范围：M2 提示词审查（架构文档第 6 节）。
> 结构：自 2026-08 起，每个提示词一份独立审查稿（源材料 + 中文稿 + 映射表 + 校验 + 实驱状态），本文件为索引与公共内容（流程、评审结论、桌面对齐）。
> 说明：hyperplan/team 模式因 team-mode 延后实现（roadmap，见架构文档 M8）而暂不移植；search/analyze 模式中文稿见 search-analyze.md（源材料：桌面工作流分析提示词 1，用户已确认起草）。
> 评审：6 项待确认问题已答复（1/2/3/4/6 通过，5 为信息查询），结论见「评审结论」与「桌面对齐·用户确认」。

---

## 审查对象清单（各自独立文件）

| # | 提示词 | 文件 | 状态 |
|---|---|---|---|
| 1 | ultrawork 模式 | [ultrawork.md](ultrawork.md) | 稿就绪（45 行/13%，25 条约束） |
| 2 | work-rules | [work-rules.md](work-rules.md) | 稿就绪（原 5 条 + 用户准则 2 条） |
| 3 | orient 会话开场 | [orient.md](orient.md) | 稿就绪（3 句 → 2 段） |
| 4 | planner persona | [planner.md](planner.md) | 稿就绪 |
| 5 | reviewer persona | [reviewer.md](reviewer.md) | 稿就绪 |
| 6 | executor persona | [executor.md](executor.md) | 稿就绪（新增） |
| 7 | explorer persona | [explorer.md](explorer.md) | 稿就绪（新增） |
| 8 | debugger persona | [debugger.md](debugger.md) | 稿就绪（新增） |
| 9 | search / analyze 模式 | [search-analyze.md](search-analyze.md) | 稿就绪 |
| 10 | advisor 模式 | [advisor.md](advisor.md) | **草案（omp 伴随审核模型，待确认移植形态）** |

---

## 精简校验汇总

| 对象 | 原稿规模 | 本稿规模 | 达标（≤50%） |
|---|---|---|---|
| ultrawork | 339 行 | 45 行（13%） | ✅ |
| work-rules | 8 行 | 10 行（原 5 条 + 用户准则 2 条新增） | ✅ |
| orient | 3 句 | 2 段 | ✅ |
| planner/reviewer | 各 4 句英文 | 各 4-5 句中文 | ✅ |
| executor/explorer/debugger | 无 | 各 4 句 | 新增 |
| search/analyze | 桌面文件提示词 1 | 各 3 句要点 | ✅（按桌面稿） |
| advisor | omp 伴随审核模型（待定稿） | 草案 | 待定 |

## 实驱验证状态

- 待做（标注在代码落地后执行）：ultrawork 触发 → 第一响应宣布 + 约束生效；planner/reviewer persona 在 dsh 会话中加载；work-rules/orient 注入可见。
- dsh CLI 已安装（@deepseek-ai/dsh@0.1.1-rc.2，仓库已更新核实），隔离 $DSH_HOME 实驱脚本留待 M1 骨架重构后随代码一起做（6.2 流程第 5 步）。

---

## 评审结论（2026-07-09 确认）

1. ✅ 认可：委派条款保持能力中性，M1 落地时确认 dsh 委派机制（dsh-agent-presets / AgentRegistry）后映射具体工具名。
2. ✅ 认可：goal 注册条款暂缓，M4 goal 工具落地后补。
3. ✅ 认可：planner/reviewer/executor/explorer/debugger 五个 persona 维持现状。
4. ✅ 修正：team mode 不是排除，而是 roadmap 延后实现（架构文档 M8）；hyperplan/team 模式因此暂不移植（非排除）。
5. ✅ 修正：新增两条工作准则注入各提示词——「事实永远在文件」（上下文/会话记录不一定是事实，关键事实以文件为准）+「不臆想、不编造、多提问」；已注入 work-rules 第 6/7 条、ultrawork 一.1、planner/executor、search/analyze。

---

## 桌面工作流分析对齐（opencode-workflows-analysis.md，2026-07-09）

> 来源：`D:\Desktop\opencode-workflows-analysis.md`（用户 OpenCode 实际工作流分析，298 行）。
> 定位：不只参考 ultrawork——作为 oh-my-dsh 全体系的对齐依据（mode 提示、agent 编排、守卫、skills 池）。

### 文件概要
- 12 种开发模式：元工作流审计、CRUD 骨架、ERP 集成管道、预警推送模板、企业后端、移动端 H5、设计审查管道、浏览器测试、发布工作流、安全感知、多格式文档、知识库管理。
- 6 个工作流提示词：[search-mode]/[analyze-mode]、Workflow Mining、ERP 集成管道、CRUD 骨架、Sisyphus 编排、安全操作。
- 体系总览：元层（审计→技能化）→ 开发层/产线层（ship→review→deploy→doc）/安全层（careful/guard/freeze）。
- 核心特征：Delegate-heavy、Skill-first、Pipe-driven、Safety-conscious、Data-driven。

### 对齐到 oh-my-dsh（建议，待用户确认）

| 桌面文件内容 | oh-my-dsh 落点 | 状态 |
|---|---|---|
| `[search-mode]`：并行 explore/librarian agents + rg/sg 直接工具，挖掘到穷尽 | **mode 提示源材料**：落地为 skill-trigger 的 search 模式中文精简稿 | 已起草（search-analyze.md） |
| `[analyze-mode]`：先并行收集上下文（explore/librarian/LSP），融合发现再下手；复杂问题找专家 | 同上：analyze 模式中文精简稿；与 ultrawork 稿"一、动手前确认 + 三、技能与委派"同源 | 已起草（search-analyze.md） |
| 提示词 5（Sisyphus 编排）：意图判断→并行 explore→todo→delegate（run_in_background）→verify→保留 task_id 续接→完成清理 | 印证 ultrawork 稿"四、规划 + 五、任务执行纪律"；**TASK/EXPECTED OUTCOME/REQUIRED TOOLS/MUST DO/MUST NOT DO/CONTEXT 六要素**可作 agent 委派 prompt 模板，进 agents 落地 | 参考 |
| 提示词 6（安全操作）：远程脚本先下载审查、token 不明文、安全替代、风险枚举、guard 模式 | 印证 M3 守卫 hooks（path-traversal / 危险命令确认）；落地时并入 guard 设计 | 参考 |
| 12 种开发模式（CRUD 骨架/ERP 集成/企业后端/移动 H5/设计审查/浏览器 QA/发布/文档/知识库…） | **skills 池扩充候选**：优先覆盖用户高频模式（CRUD 骨架、ERP 集成、设计审查、浏览器 QA、发布流水线、知识库）；内置评估见下 | 待确认优先级 |
| 特征：Delegate-heavy / Skill-first / Pipe-driven | 印证设计原则 1/2（人是发起者、Skill→Tool→Hook 层级）；支持 5.4 技能优先 + 5.7 委派设计 | 已一致 |

### 用户确认
1. ✅ search/analyze 模式提示词已按桌面文件起草，见 search-analyze.md。
2. 12 种模式完整清单见下；skills 落地优先级待用户后续选择（建议先 CRUD 骨架、浏览器 QA、发布工作流）。
3. ✅ 委派 prompt 六要素模板将加入 agents 落地稿（M1 落地时实现）。

---

## 十二种开发模式完整清单（桌面文件第三节）

| # | 模式 | 流程要点 |
|---|---|---|
| 1 | 周期性工作流审计 → 技能化（Meta-Workflow） | 回顾记录 → 识别重复模式（occurrence≥2）→ 创建技能 → 报告 |
| 2 | 企业级 CRUD 功能开发 | 需求分析 → 数据模型 → API Routes(list/getById/create/update/delete) → 报表 → 测试 |
| 3 | ERP 集成管道（多项目共用） | 表探索 → 元数据导入 → 接口开发 → 数据同步 → 定时任务注册 |
| 4 | 预警推送模板开发（项目特有） | 复制模板 → 模板字符串 → 数据获取 → 字段对齐检查 |
| 5 | 企业级后端开发 | Controller → Service → 实现 → 持久层 → 自动通知 |
| 6 | 移动端 H5 开发 | 新建组件 → 路由 → i18n → UI 组件库 → 定位/地图 |
| 7 | 设计-审查-优化管道 | 设计系统 → 多方案对比 → 方案审查 → 实时站点 QA → 修复 → 再验证 |
| 8 | 浏览器自动化测试管道 | 登录态 → 交互测试 → QA 找 bug → 性能基线 → 部署后监控 |
| 9 | 发布工作流 | 建 PR → CI/测试 → 合并部署 → 文档更新 |
| 10 | 安全感知操作 | 检测危险模式 → 警告+安全替代 → 等待确认 → 执行 |
| 11 | 多格式文档生成 | 文档 / PDF / 表格 / 演示文稿 |
| 12 | 知识库/记忆管理 | 初始化 → 导入 → 检索 → 统计 |

> 个人信息处理：项目名、技术栈、模型名为个人工作信息，**不写入本清单**；如需在提示词中引用，用参数占位（如 `{{project}}`、`{{stack}}`、`{{model}}`），由配置或会话上下文注入（用户确认）。

---

## skill / MCP 内置评估（桌面文件，建议待用户确认）

> 桌面文件提及约 20 个 skill 与 5 个 MCP（来自用户 OpenCode 环境，非 oh-my-dsh 现有内容）。
> 评估标准：跨项目复用性、与 dsh 无关性、与 oh-my-dsh 5.4 skills 池的匹配度。

| 来源 | 名称 | 评估 | 建议 |
|---|---|---|---|
| skill | qa / qa-only / benchmark / canary | 通用浏览器 QA、性能基线、部署监控，跨项目 | **内置**：合并为 1-2 个（browser-qa + deploy-monitor） |
| skill | ship / land-and-deploy / document-release / setup-deploy | 通用发布流水线，跨项目 | **内置**：合并为 1-2 个（ship + deploy） |
| skill | careful / guard / freeze-unfreeze | 通用安全操作，与 M3 守卫设计呼应 | **内置为守卫**（M3 落地），非独立 skill |
| skill | design-review / design-consultation | 通用设计审查，跨项目 | **候选内置**（依赖浏览器工具，M7 评估） |
| skill | minimax-docx / -pdf / -xlsx / pptx-generator | 文档生成，绑定特定 API | **参数化**：模板保留，API 密钥走配置 |
| skill | prisma-crud-scaffold | 绑定特定数据栈 | **不内置**：参数化模板（{{stack}}） |
| skill | netsuite-* / warning-push-template | 项目/栈特定（ERP 集成、预警推送） | **不内置**：项目仓库自带 |
| skill | fullstack-dev / frontend-dev | 栈特定 | **不内置**：参数化模板 |
| MCP | CodeGraph | 通用代码图谱 | **候选内置**（dsh MCP 机制确认后） |
| MCP | MDN | 通用文档查询 | **候选内置**（同上） |
| MCP | MiniMax / TDesign / NetSuite-Meta | 模型提供方 / UI 组件库特定 / 项目特定 | **不内置**：用户环境配置 |

> 结论：内置优先 = 浏览器 QA、发布流水线、安全守卫 3 类通用能力；其余参数化或留给项目仓库。MCP 内置待确认 dsh 的 MCP 配置机制（Cordis 插件是否有 .mcp.json 等价物）后定。
> 去个人信息：本评估不含项目名、技术栈名、模型名；参数占位（{{project}}/{{stack}}/{{model}}）由配置注入。
