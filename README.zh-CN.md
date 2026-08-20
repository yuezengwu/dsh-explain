<div align="right">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</div>

<h1 align="center">dsh-explain</h1>

<p align="center"><strong>把日常 DSH 工作变成私有、连续的学习闭环。</strong></p>

<p align="center">
  <img alt="DSH 0.1.0-rc.8" src="https://img.shields.io/badge/DSH-0.1.0--rc.8-4c8bf5">
  <img alt="本地优先" src="https://img.shields.io/badge/数据-本地优先-2ea44f">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

`dsh-explain` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的学习模式插件。它从已完成的工作会话中提取值得学习的概念，生成结构化讲解，汇入一条全局学习线程，并依据用户已经掌握的内容持续调整后续讲解。

主 Agent 保持不变：Explain 使用独立的模型调用、调度器、学习上下文和本地 SQLite 数据库。

## 演示

![选取 DSH 回答、创建 Explain 请求、查看学习卡并标记掌握](https://github.com/yuezengwu/dsh-explain/blob/m6-owned-shortcuts-assets/m6-owned-shortcuts-real.gif?raw=true)

选中文字或点击「学习这个回答」，检查可编辑的 `/explain` 草稿，生成学习卡，再标记为已掌握。该演示使用真实 DSH Web 会话、真实 DeepSeek 主 Agent 回合和 Explain 模型回合；精确提交与录制条件保存在 [PR #16](https://github.com/yuezengwu/dsh-explain/pull/16#user-content-real-model-gui-evidence)。

## 快速开始

Explain 当前适配 DSH `0.1.0-rc.8`。

```sh
npx @deepseek-ai/dsh@0.1.0-rc.8 plugin --profile web add github:yuezengwu/dsh-explain
npx @deepseek-ai/dsh@0.1.0-rc.8 web
```

启动后进入「**设置 → 学习**」，选择辅助模型的 provider 和 model，启用学习模式并保存。Explain 只观察此后完成的顶层工作回合，不补扫已有历史。

Git 仓库插件会在安装时构建。如果 pnpm 要求批准构建，请按提示把 `dsh-explain` 加入该 profile 的 `pnpm-workspace.yaml`，然后重新执行安装命令。

## 学习入口

| 入口 | 行为 |
|---|---|
| `/explain <学习请求>` | 以当前会话的受限来源上下文主动请求一次讲解。 |
| **解释选中文字** | 从可见选区创建可编辑的 `/explain --selection …` 草稿，绝不自动提交。 |
| **学习这个回答** | 创建绑定到精确 assistant 完成回合的可编辑草稿。 |
| 自主判断 | 合格工作回合结束后，Explain 可在配置额度内生成一条值得学习的讲解。 |

使用 `/explain on`、`/explain off` 和 `/explain status`，无需离开输入框即可控制或检查运行状态。

每张学习卡回答三个问题：

- **是什么？** 用简洁语言解释核心概念。
- **为什么重要？** 说明它在来源工作中的实际价值。
- **常见坑是什么？** 指出需要避免的错误或误解。

选择「**懂了**」关闭讲解；选择「**没懂**」请求换一种讲法。即使来源会话之后被删除，重讲仍然可用。

## 多个工作会话，一条学习线程

每个 `$DSH_HOME` 只有一条 Explain 学习线程。不同工作会话可以贡献学习内容，但 resume 和 fork 不会复制学习状态。

- 每个来源会话至多有一条等待反馈的讲解。
- 所有工作会话通过第一方「学习」Tab 查看同一份全局历史。
- 一个全局调度器串行处理主动讲解、自主判断、重讲和压缩。
- 自主判断默认额度为滚动 24 小时 50 次，并跨重启保留。
- 私有 `ExplainContext` 记录讲解偏好、知识水平和学习进展。
- 存在待压缩的结构化观察或已关闭讲解时，连续 30 分钟没有 Explain 操作，或下一次请求预计超过所选模型上下文窗口的 50%，都会触发辅助历史压缩。

## 本地优先

| 数据 | 行为 |
|---|---|
| 学习线程 | 持久化到 `$DSH_HOME/dsh-explain/v1/thread.sqlite`。 |
| 开关与模型设置 | 通过 DSH settings 保存到 `$DSH_HOME/settings.yaml`。 |
| 来源材料 | 只保留有界 capsule；重讲最多持久化 2,000 字符的受限来源摘要。 |
| 全局学习上下文 | 只发送给 Explain 辅助模型，永不发送给主 Agent。 |
| 主会话 | 不接收 Explain 事件、提示词或学习上下文；主回合不会被阻塞。 |

Explain 只使用 DSH 第一方 `conversation.view`、composer、assistant action 和 settings 扩展点，不依赖 `better-sidebar`，也不要求修改其他插件。

## 兼容性与验证

- 当前兼容版本线：DSH `0.1.0-rc.8`。
- 单元测试：64 项。
- DSH Web 组装验收：4 个场景。
- Explain 自有快捷入口验收：3 个 M6 场景。
- 真实模型流程证据：[PR #16](https://github.com/yuezengwu/dsh-explain/pull/16)。
- 完整验收矩阵：[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。

DSH 仍处于开发者预览阶段。Explain 跟随当前公开 API 版本线，不保留更早私有预览包的兼容层。

## 本地开发

默认安装使用已发布的 rc.8 API 包。assembled Web 测试还需要已构建的 DSH rc.8 源码 checkout：

```sh
pnpm install
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run dsh:link
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run dsh:link:check
pnpm run typecheck
pnpm test
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run test:web
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run test:m6
pnpm run build
```

手工开发时直接安装当前 checkout：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-explain
dsh --profile web --dump-config
dsh --profile web
```

`test:web` 启动全新、无密钥的 DSH Web 组合，验证学习视图、设置、来源跳转和来源缺失降级。`test:m6` 只安装 Explain，验证两个可编辑草稿快捷入口，以及卸载、重装后的完整恢复行为。

## 文档

| 文档 | 内容 |
|---|---|
| [产品需求](docs/PRD.md) | 用户模型、范围、策略和验收标准。 |
| [技术架构](docs/ARCHITECTURE.md) | 持久化、调度、RPC、UI 集成和失败行为。 |
| [验收矩阵](docs/ACCEPTANCE.md) | 自动化与真实流程证据。 |
| [迭代计划](docs/NEXT.md) | 当前后续工作与顺序。 |

## 许可证

[MIT](LICENSE)
