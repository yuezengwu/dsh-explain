# dsh-explain — DSH 学习模式插件（WIP 占位）

> 🚧 **状态：WIP（想法收集 / 设计阶段）** — 本仓库目前只有想法与查重结论，**暂无代码**。
> 欢迎在 [issues](https://github.com/dsh-external/issues) 或本仓库 issue 讨论想法。

**一句话定位**：给 DeepSeek Harness 加一个「学习模式」开关——打开后，agent 工作（执行工具、写代码、改文件、调研）的同时，**实时讲解过程中涉及的知识点**，把一次工作任务顺便变成一次学习过程，用于用户学习与成长。

---

## 动机

- DSH 是强大的 agent，但用户往往只看到"活干完了"，看不到"发生了什么、为什么这么做、用到了什么概念"。
- 学习模式把「干活」和「学习」耦合：不需要用户主动提问，工作过程中的知识点自动被讲解。
- 适合：新手熟悉工具链、非本领域开发者理解陌生技术、想长期成长但又没时间专门学习的用户。

## 功能构想（尚未实现，待讨论收敛）

| 方面 | 构想 |
|---|---|
| **开关** | 可配置开关（默认关），支持 `/explain on|off` 命令 + 设置面板；按会话记忆，不污染主会话逻辑 |
| **讲解时机** | ① 工具调用时（如 bash / git / web 搜索后讲解该命令/概念）；② 回合结束后（总结本轮涉及的知识点）；③ 决策点（agent 选择某方案时解释为什么） |
| **讲解内容** | 知识点：被调用的工具与命令、涉及的技术概念（框架/协议/算法）、设计决策的理由、代码模式；控制深度（初学/进阶/专家三档） |
| **形式与节奏** | 独立注入而非打断主流程；可折叠、可跳过、可静音（频率限制，避免每轮都讲） |
| **知识沉淀** | 讲解过的知识点可沉淀为可复习条目，**与 dsh-edu 的卡片/错题存储互通**（复用其 SM-2 复习队列） |

## 查重结论（2026-08-12，对照 dsh-external 全组织 253 仓库 + hub 索引）

**没有直接重复**，但有 3 个相关先例需要明确边界：

| 仓库 | 形态 | 与本项目的关系 |
|---|---|---|
| [official-plugins-port](https://github.com/dsh-external/official-plugins-port) 的 `claude/learning-output-style` 与 `claude/explanatory-output-style` | **systemPrompt 段**（纯提示词风格，order 160/161） | **最接近的先例**。交互式学习模式 + 解释性输出风格。差异：它们是纯提示词（无工具、无开关、无观察架构、无沉淀），本项目要做**结构化模式**（开关 + 事件监听 + 可沉淀） |
| [dsh-edu](https://github.com/dsh-external/dsh-edu)（教育版 7 bundle） | 课程/作业/测验/错题/卡片/番茄钟（内容管理） | **互补不冲突**：它管"学什么、怎么复习"，本项目管"工作中实时讲解"；知识沉淀走它的存储格式 |
| [dsh-advisor](https://github.com/dsh-external/dsh-advisor) | 副模型观察每轮 + 注入分级建议（审查） | **架构参考**：观察回合 + 注入 + 开关 + 防污染会话的实现骨架可直接借鉴，但用途是审查不是教学 |

**结论**：`dsh-explain` 的差异点在「**结构化学习模式**」——提示词之外的开关、时机控制、知识点讲解与沉淀，目前组织内无人做。

## 技术路线设想（待定，欢迎讨论）

1. **起点**：先做 systemPrompt 段风格的最小版（像 learning-output-style 一样只改提示词），验证"工作+讲解"的体验是否成立。
2. **进阶**：bundle 插件（`dsh.bundle.patch`，官方推荐格式），监听 agent 回合/工具调用事件，用副模型或主模型生成讲解，注入为可折叠消息。
3. **沉淀**：讲解产出写入 `$DSH_HOME/storages/edu/`（对齐 dsh-edu 数据模型），形成可复习的知识库。
4. 开发规范见 [make-dsh-plugin](https://github.com/dsh-external/plugin-registry) 与 [dsh-plugin-guide](https://github.com/dsh-external/dsh-plugin-guide)。

## TODO

- [ ] 讨论并收敛：讲解时机与频率策略（防打扰）
- [ ] 讨论并收敛：深度档位（初学/进阶/专家）
- [ ] 最小版：systemPrompt 风格 PoC
- [ ] 正式版：bundle + 事件监听 + 开关命令
- [ ] 知识沉淀对接 dsh-edu 存储
- [ ] 在 hub `catalog.source.json` 登记分类（届时）

## 内测纪律

> **DSH 当前处于内测状态：本组织禁止创建公开仓库**（目录规则见 [hub/LOOP.md](https://github.com/dsh-external/hub/blob/main/LOOP.md)「收录新插件」）。
> 机制上由 [repo-visibility-guard](https://github.com/dsh-external/repo-visibility-guard) 强制执行（公开仓库自动转私有、公开 fork 删除）。
> 本项目保持 **private**，请勿在公开场合外传代码与截图。
