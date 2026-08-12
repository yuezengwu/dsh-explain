# dsh-explain — DSH 学习模式插件（WIP）

> 🚧 **状态：PRD P0 定稿 + 技术架构 v2 已提交，待 review，暂无代码。**
> 产品需求唯一事实源见 [docs/PRD.md](docs/PRD.md);技术方案见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

**一句话定位**：给 DeepSeek Harness 加一个「学习模式」开关——打开后，agent 工作时**自主判断时机**，在主对话行内讲解涉及的知识点；右侧悬浮窗提供反馈按钮（✓ 懂了 / ✗ 没懂），让用户边干活边学习，主对话流不被教学干扰。

---

## 动机

- DSH 是强大的 agent，但用户往往只看到"活干完了"，看不到"发生了什么、为什么这么做、用到了什么概念"。
- 学习模式把「干活」和「学习」耦合：不需要用户主动提问，工作过程中的知识点自动被讲解。
- 目标用户不按身份限定：只要任务涉及的知识超出用户熟悉范围，讲解就有价值。

## 当前进展

- [x] 需求查重（无直接重复，3 个相关先例见下）
- [x] PRD P0 定稿（[docs/PRD.md](docs/PRD.md)：开关 / 行内讲解 / 右侧悬浮窗两按钮 / 防吵三件）
- [x] 技术架构 v2 提交（[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：独立 explain 循环 / 观察管线起步 / 注入式行内讲解）— **待 review**
- [ ] 架构 review 通过
- [ ] M1 实现（observer + explainer + 注入通道 + 悬浮窗）
- [ ] 在 hub `catalog.source.json` 登记分类（届时）

## 查重结论（2026-08-12，对照 dsh-external 全组织 253 仓库 + hub 索引）

**没有直接重复**，但有 3 个相关先例需要明确边界：

| 仓库 | 形态 | 与本项目的关系 |
|---|---|---|
| [official-plugins-port](https://github.com/dsh-external/official-plugins-port) 的 `claude/learning-output-style` 与 `claude/explanatory-output-style` | **systemPrompt 段**（纯提示词风格，order 160/161） | **最接近的先例**。差异：纯提示词（无开关、无悬浮窗、无反馈闭环），本项目是结构化模式 |
| [dsh-edu](https://github.com/dsh-external/dsh-edu)（教育版 7 bundle） | 课程/作业/测验/错题/卡片/番茄钟（内容管理） | **互补不冲突**：它管"学什么、怎么复习"，本项目管"工作中实时讲解"；后期知识沉淀走它的格式 |
| [dsh-advisor](https://github.com/dsh-external/dsh-advisor) | 副模型观察每轮 + 注入分级建议（审查） | **架构参考**：观察回合 + 注入 + 开关的实现骨架可借鉴，但用途是审查不是教学 |

**结论**：`dsh-explain` 的差异点在「结构化学习模式」——开关 + 自主时机讲解 + 悬浮窗反馈闭环，目前组织内无人做。

## 内测纪律

> **DSH 当前处于内测状态：本组织禁止创建公开仓库**（目录规则见 [hub/LOOP.md](https://github.com/dsh-external/hub/blob/main/LOOP.md)「收录新插件」）。
> 机制上由 [repo-visibility-guard](https://github.com/dsh-external/repo-visibility-guard) 强制执行（公开仓库自动转私有、公开 fork 删除）。
> 本项目保持 **private**，请勿在公开场合外传代码与截图。
