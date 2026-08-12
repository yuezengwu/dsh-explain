# dsh-explain — DSH 学习模式插件（WIP）

> 🚧 **状态：PRD P0 定稿候选 + 技术架构 v6；M1 基础设施开发中。**
> 产品需求见 [docs/PRD.md](docs/PRD.md)；技术方案见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

**一句话定位**：把多个 DSH 工作会话中值得学习的内容汇入用户唯一的全局学习线程，为每个来源会话保留至多一个活跃讲解，并用全局学习上下文持续适配用户的知识水平和讲解偏好。

## 核心形态

- 一个 `$DSH_HOME` 只有一条本地学习线程；工作会话、恢复和 fork 不复制学习状态。
- 每个顶层来源会话可以有一个等待反馈的讲解，也可以没有；同一来源未反馈时不再生成第二条，其他来源仍可继续。
- 自主讲解、重讲和压缩共享全局调度器，任何时刻最多一个辅助模型请求。
- 自主判断默认最多发送 50 次/滚动 24 小时；占额跨重启保留，失败和重试计数，用户触发的重讲与压缩豁免。
- explain 维护私有的全局 `ExplainContext`，汇总对话偏好、知识概况和学习进展；它只进入辅助模型，不注入主 Agent。
- 有新的结构化观察或已关闭讲解且用户连续 30 分钟未操作 explain，或预计辅助请求占所选模型上下文 50% 以上时，自动压缩辅助模型历史；用户可见原始记录不删除。
- 主模型不知道 explain 存在；explain 不写主 Session 日志、不注入主模型上下文、不阻塞主 turn。
- 学习历史、来源活跃状态、压缩检查点和 `ExplainContext` 持久化到 `$DSH_HOME/dsh-explain/v1/thread.sqlite`；开关与模型设置走 `$DSH_HOME/settings.yaml`。
- 首个讲解 entry 保存最多 2,000 字符的受限来源摘要供后续重讲；来源 Session 删除不影响重讲，摘要不向学习视图返回。
- P0 的唯一交互界面是 DSH 第一方 `conversation.view` 槽位中的「学习」Tab；不使用 `conversation.chat.turnTail`，行内讲解移出 P0。
- 「学习」是 Session-scoped 视图入口，但业务数据来自同一个全局 client store 和 typed Remote；不同工作 Session 看到同一条学习线程。
- P0 不自动切换视图。空白 Session 的 Hero 阶段不显示视图 Tab；进入学习视图后，当前工作 Session 的 composer 仍然保留。
- P0 没有外部 UI 依赖，不携带或要求安装 better-sidebar。

## 动机

- DSH 能完成复杂工作，但用户通常只看到结果，不一定理解过程中用到的概念、取舍和常见误区。
- 学习模式把工作会话变成学习素材来源，不要求用户先知道应该问什么。
- 用户的学习事实和进度需要跨工作会话保持一致，因此所有内容进入一条全局线程；按来源保留的活跃讲解让用户回到相关工作时继续反馈。

## 当前进展

- [x] 需求查重：产品目标无直接重复，相关插件可提供局部实现参考。
- [x] PRD P0 定稿候选：单一学习线程、按来源活跃讲解、自主调用预算、双触发压缩、全局 ExplainContext 和可自动验证的验收标准。
- [x] 技术架构 v6：本地 SQLite、实体级并发、持久来源摘要、全局单飞与调用预算、压缩检查点、typed Remote 和 `conversation.view` 学习界面。
- [x] UI 路径核验：沿用第一方 `ui-trajectory` 的 `ctx.slots.inject('conversation.view', ...)` 注册方式，无外部 UI 依赖。
- [x] M1 基础设施：独立插件构建、本地 SQLite schema、实体级 CAS、分页/长轮询和自动生成的 typed Remote。
- [ ] M2 P0 运行时与学习视图 → M3 发布门禁。
- [ ] 在 hub `catalog.source.json` 登记分类。

M1 只建立持久层和 Host/Client RPC 基础，不观察工作回合、不调用模型，也不注册用户可见的学习 Tab；这些行为在 M2 一起接入，以便界面验收使用真实模型流程。

## 本地开发

仓库不从 npm 解析或发布私有 DSH 包。先准备已构建的 DSH 源码目录，再安装公开的构建依赖并建立本地链接：

```sh
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm install
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run dsh:link:check
pnpm run test
pnpm run typecheck
pnpm run build
```

开发验收使用本地目录安装，不经过 npm：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-explain
dsh --profile web --dump-config
dsh --profile web
```

## 查重结论（2026-08-12）

**产品目标无直接重复；以下项目只作为局部先例，不作为本项目的数据模型。**

| 仓库 | 可复用部分 | 明确不复用的部分 |
|---|---|---|
| [dsh-auto-blame](https://github.com/dsh-external/dsh-auto-blame) | 回合结束后的后台模型调用、客户端反馈形态 | 外部自定义 Session 事件与 projection 不能作为本项目持久化方案 |
| [dsh-advisor](https://github.com/dsh-external/dsh-advisor) | 转录增量、模型调用隔离、发射保护和配置 gateway | advisor 向主 agent 注入建议；explain 永不注入主模型 |
| [dsh-memory](https://github.com/dsh-external/dsh-memory) | 仓库命名覆盖长期记忆方向 | 当前只有占位 README，没有可复用服务或协议 |
| [dsh-memory-evolve](https://github.com/dsh-external/dsh-memory-evolve) | 跨会话分层记忆、低频快照与用户可见管理经验 | 未公开 Cordis memory service，且快照进入主 Agent；explain 不依赖或读取其私有文件 |
| DSH `compact-basic` / `token-meter` / LLM model info | 容量阈值策略、固定 token 估算和精确路由 `contextWindow` | 原生 compact 只修改单个 Session surface；explain 需要自有全局 SQLite compactor |
| DSH 第三方 memory MCP 示例 | 跨会话持久记忆的可选互操作参考 | 模型主动工具调用和外部 provider 不适合作为 P0 自动 ExplainContext |
| DSH `ui-trajectory` | `conversation.view` 视图注册、Session 头部 Tab 和 active-only 渲染先例 | trajectory 的 Session 事件视图模型；学习事实仍使用插件自有 SQLite 与 Remote |
| [DSH-better-sidebar](https://github.com/dsh-external/DSH-better-sidebar) | 侧边工作台交互参考 | P0 不需要边工作边查看，因此不引入其服务、源码副本或依赖树 |
| [official-plugins-port](https://github.com/dsh-external/official-plugins-port) 的 `claude/learning-output-style` 与 `claude/explanatory-output-style` | 学习与解释类提示词参考 | 纯 system prompt 无法提供独立调度、持久历史和反馈闭环 |
| [dsh-edu](https://github.com/dsh-external/dsh-edu) | 后续知识沉淀格式 | P0 不做课程、测验、卡片或复习系统 |

## 内测纪律

> **DSH 当前处于内测状态：本组织禁止创建公开仓库**（目录规则见 [hub/LOOP.md](https://github.com/dsh-external/hub/blob/main/LOOP.md)「收录新插件」）。
> 机制上由 [repo-visibility-guard](https://github.com/dsh-external/repo-visibility-guard) 强制执行（公开仓库自动转私有、公开 fork 删除）。
> 本项目保持 **private**，请勿在公开场合外传代码与截图。
