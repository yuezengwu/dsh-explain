# dsh-explain — DSH 学习模式插件（WIP）

> 🚧 **状态：PRD P0 定稿候选 + 技术架构 v5（含依赖 fork 副本），待 review，暂无功能代码。**
> 产品需求见 [docs/PRD.md](docs/PRD.md)；技术方案见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

**一句话定位**：把多个 DSH 工作会话中值得学习的内容汇入用户唯一的全局学习线程，一次只讲一个知识点，并在 better-sidebar 中通过「✓ 懂了 / ✗ 没懂」形成连续反馈。

## 核心形态

- 一个 `$DSH_HOME` 只有一条本地学习线程；工作会话、恢复和 fork 不复制学习状态。
- 多个顶层工作会话可以提交候选知识点，但全局调度器只运行一个模型请求，并且只允许一个知识点等待用户反馈。
- 主模型不知道 explain 存在；explain 不写主 Session 日志、不注入主模型上下文、不阻塞主 turn。
- 学习历史持久化到 `$DSH_HOME/dsh-explain/v1/thread.sqlite`；开关与模型设置走 `$DSH_HOME/settings.yaml`。
- P0 的唯一交互界面是 better-sidebar 的「学习模式」Tab；不使用 `conversation.chat.turnTail`，行内讲解移出 P0。
- better-sidebar 以 **fork 副本**（v0.7.0，pinned SHA）随仓库携带（`vendor/dsh-better-sidebar/`，见 [MANIFEST.md](vendor/dsh-better-sidebar/MANIFEST.md)），不依赖上游仓库存活，也不要求用户单独安装原版。

## 动机

- DSH 能完成复杂工作，但用户通常只看到结果，不一定理解过程中用到的概念、取舍和常见误区。
- 学习模式把工作会话变成学习素材来源，不要求用户先知道应该问什么。
- 用户的工作会话可以并发，注意力与学习进度仍是线性的，因此学习内容必须汇入同一线程并串行推进。

## 当前进展

- [x] 需求查重：产品目标无直接重复，相关插件可提供局部实现参考。
- [x] PRD P0 定稿候选：全局开关、单一学习线程、单个活跃知识点、全局反馈语义和可自动验证的验收标准。
- [x] 技术架构 v5：本地 SQLite、全局单飞调度、typed Remote、better-sidebar 主界面和明确的生命周期规则。
- [x] 依赖 fork 副本：`vendor/dsh-better-sidebar/`（v0.7.0，SHA `96b83ae3…`）+ MANIFEST + API 验证矩阵；monorepo workspace 就位（`package.json`/`pnpm-workspace.yaml`）。
- [ ] 架构 review 通过。
- [ ] M1 技术原型 → M2 P0 实现 → M3 发布门禁。
- [ ] 在 hub `catalog.source.json` 登记分类。

## 查重结论（2026-08-12）

**产品目标无直接重复；以下项目只作为局部先例，不作为本项目的数据模型。**

| 仓库 | 可复用部分 | 明确不复用的部分 |
|---|---|---|
| [dsh-auto-blame](https://github.com/dsh-external/dsh-auto-blame) | 回合结束后的后台模型调用、客户端反馈形态 | 外部自定义 Session 事件与 projection 不能作为本项目持久化方案 |
| [dsh-advisor](https://github.com/dsh-external/dsh-advisor) | 转录增量、模型调用隔离、发射保护和配置 gateway | advisor 向主 agent 注入建议；explain 永不注入主模型 |
| [DSH-better-sidebar](https://github.com/dsh-external/DSH-better-sidebar) | `ctx.betterSidebar.registerTab()` 提供的工作台页面 | sidebar 的 localStorage 只保存布局，不能保存学习事实 |
| [official-plugins-port](https://github.com/dsh-external/official-plugins-port) 的 `claude/learning-output-style` 与 `claude/explanatory-output-style` | 学习与解释类提示词参考 | 纯 system prompt 无法提供独立调度、持久历史和反馈闭环 |
| [dsh-edu](https://github.com/dsh-external/dsh-edu) | 后续知识沉淀格式 | P0 不做课程、测验、卡片或复习系统 |

## 内测纪律

> **DSH 当前处于内测状态：本组织禁止创建公开仓库**（目录规则见 [hub/LOOP.md](https://github.com/dsh-external/hub/blob/main/LOOP.md)「收录新插件」）。
> 机制上由 [repo-visibility-guard](https://github.com/dsh-external/repo-visibility-guard) 强制执行（公开仓库自动转私有、公开 fork 删除）。
> 本项目保持 **private**，请勿在公开场合外传代码与截图。
