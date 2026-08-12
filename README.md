# dsh-explain — DSH 学习模式插件（WIP）

> 🚧 **状态：PRD P0 草案 + 技术架构 v4（呈现位置已闭合：行内讲解 + 回合尾部，不改主仓库），待 review，暂无代码。**
> 产品需求见 [docs/PRD.md](docs/PRD.md);技术方案见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

**一句话定位**：给 DeepSeek Harness 加一个「学习模式」开关——打开后，explain 独立循环自主判断时机，在主对话行内讲解涉及的知识点；回合尾部提供反馈按钮（✓ 懂了 / ✗ 没懂），主对话循环互不干扰。

---

## 动机

- DSH 是强大的 agent，但用户往往只看到"活干完了"，看不到"发生了什么、为什么这么做、用到了什么概念"。
- 学习模式把「干活」和「学习」耦合：不需要用户主动提问，工作过程中的知识点自动被讲解。
- 目标用户不按身份限定：只要任务涉及的知识超出用户熟悉范围，讲解就有价值。

## 当前进展

- [x] 需求查重（产品目标无直接重复，基础设施已有近似实现，见下）
- [x] PRD P0 草案（[docs/PRD.md](docs/PRD.md)：开关 / 行内讲解 / 回合尾部反馈按钮 / 可自动验证的验收标准）
- [x] 技术架构 v4（[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：独立 explain 循环 / profile bundle / explain 事件 + ConversationNode / 回合尾部 turnTail / typed Remote）— **待 review**
- [ ] 架构 review 通过
- [ ] M1 内部技术原型 → M2 P0 可发布
- [ ] 在 hub `catalog.source.json` 登记分类（届时）

## 查重结论（2026-08-12 review 后修订，对照 dsh-external 全组织 257 仓库 + hub 索引）

**产品目标无直接重复;基础设施已有近似实现**。相关先例：

| 仓库 | 形态 | 与本项目的关系 |
|---|---|---|
| [dsh-auto-blame](https://github.com/dsh-external/dsh-auto-blame) | 回合结束辅助 LLM 生成建议 → 非 surface Session 事件 → projection 推送 → client 渲染（composer.dock） | **技术上最接近的先例**：架构路径（辅助 LLM + 非 surface 事件 + projection + 客户端渲染）与本项目 v3 一致;产品用途不同（毒舌跟进 vs 学习讲解）,不构成直接重复 |
| [official-plugins-port](https://github.com/dsh-external/official-plugins-port) 的 `claude/learning-output-style` 与 `claude/explanatory-output-style` | **systemPrompt 段**（纯提示词风格,order 160/161） | 产品语义接近（学习/解释输出）但形态最浅:无开关、无独立循环、无反馈闭环 |
| [dsh-edu](https://github.com/dsh-external/dsh-edu)（教育版 7 bundle） | 课程/作业/测验/错题/卡片/番茄钟（内容管理） | 产品互补:它管"学什么、怎么复习",本项目管"工作中实时讲解";后期知识沉淀走它的格式 |
| [dsh-advisor](https://github.com/dsh-external/dsh-advisor) | 副模型观察每轮 + 注入分级建议（审查,给主模型看） | 组件级参考:transcript 收集、emission guard、gateway(typed Remote)可借鉴;注入语义不同(advisor 给主模型看,explain 不进主模型) |

**结论**：`dsh-explain` 的差异点在「产品目标:工作中学习 + 主模型不可见的独立讲解循环」;技术基础设施（辅助 LLM 管线、非 surface 事件、projection、客户端渲染）已有近似实现可参照,不复刻轮子。

## 内测纪律

> **DSH 当前处于内测状态：本组织禁止创建公开仓库**（目录规则见 [hub/LOOP.md](https://github.com/dsh-external/hub/blob/main/LOOP.md)「收录新插件」）。
> 机制上由 [repo-visibility-guard](https://github.com/dsh-external/repo-visibility-guard) 强制执行（公开仓库自动转私有、公开 fork 删除）。
> 本项目保持 **private**，请勿在公开场合外传代码与截图。
