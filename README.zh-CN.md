[English](README.md) | **简体中文**

# dsh-explain — DSH 学习模式插件

> ✅ **状态：M6 实现与 DSH `0.1.0-rc.6` 四插件验收已完成。消费方改动已有精确提交；上游发布仍等待仓库写权限。**
> 产品需求见 [docs/PRD.md](docs/PRD.md)；技术方案见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

**一句话定位**：把多个 DSH 工作会话中值得学习的内容汇入用户唯一的全局学习线程，为每个来源会话保留至多一个活跃讲解，并用全局学习上下文持续适配用户的知识水平和讲解偏好。

## 核心形态

- 一个 `$DSH_HOME` 只有一条本地学习线程；工作会话、恢复和 fork 不复制学习状态。
- 每个顶层来源会话可以有一个等待反馈的讲解，也可以没有；同一来源未反馈时不再生成第二条，其他来源仍可继续。
- 用户可在任意已建立或空白工作 Session 的 composer 输入 `/explain <学习请求>`，主动要求 explain agent 生成一条讲解；管理命令 `/explain on|off|status` 保持不变。
- 主动讲解、自主讲解、重讲和压缩共享全局调度器，任何时刻最多一个辅助模型请求；主动请求优先于后台工作，但不打断已在途的主动请求或重讲。
- 自主判断默认最多发送 50 次/滚动 24 小时；占额跨重启保留，失败和重试计数，用户触发的主动讲解、重讲与压缩豁免。
- explain 维护私有的全局 `ExplainContext`，汇总对话偏好、知识概况和学习进展；它只进入辅助模型，不注入主 Agent。
- 有新的结构化观察或已关闭讲解且用户连续 30 分钟未操作 explain，或预计辅助请求占所选模型上下文 50% 以上时，自动压缩辅助模型历史；用户可见原始记录不删除。
- 主模型不知道 explain 存在；explain 不写主 Session 日志、不注入主模型上下文、不阻塞主 turn。
- 学习历史、来源活跃状态、压缩检查点和 `ExplainContext` 持久化到 `$DSH_HOME/dsh-explain/v1/thread.sqlite`；开关与模型设置走 `$DSH_HOME/settings.yaml`。
- 首个讲解 entry 保存最多 2,000 字符的受限来源摘要供后续重讲；来源 Session 删除不影响重讲，摘要不向学习视图返回。
- 学习线程使用 DSH 第一方 `conversation.view` 槽位中的「学习」Tab；普通配置与运行诊断使用第一方 `settings.section`，不引入外部 UI 宿主。
- 「学习」是 Session-scoped 视图入口，但业务数据来自同一个全局 client store 和 typed Remote；不同工作 Session 看到同一条学习线程。
- 设置页和学习视图复用同一个 browser store；用户可在设置中选择辅助模型、启用学习模式、调整滚动 24 小时自主额度，并查看路由、额度恢复、上下文压力和最近压缩。
- 讲解来源仍在当前 Session inventory 时可直接打开；来源被删除后历史保持可读并显示不可用。
- P0 不自动切换视图。空白 Session 的 Hero 阶段不显示视图 Tab；进入学习视图后，当前工作 Session 的 composer 仍然保留。
- P0 没有外部 UI 依赖，不携带或要求安装 better-sidebar。

## 动机

- DSH 能完成复杂工作，但用户通常只看到结果，不一定理解过程中用到的概念、取舍和常见误区。
- 学习模式把工作会话变成学习素材来源，不要求用户先知道应该问什么。
- 用户的学习事实和进度需要跨工作会话保持一致，因此所有内容进入一条全局线程；按来源保留的活跃讲解让用户回到相关工作时继续反馈。

## 当前进展

- [x] 需求查重：产品目标无直接重复，相关插件可提供局部实现参考。
- [x] PRD P0 定稿：单一学习线程、按来源活跃讲解、自主调用预算、双触发压缩、全局 ExplainContext 和可自动验证的验收标准。
- [x] 技术架构 v10：在 v9 Host 协议上补齐公开命令发现、点击时 composer 准入、消费方生命周期失效和四插件组合证据。
- [x] UI 路径核验：沿用第一方 `ui-trajectory` 的 `ctx.slots.inject('conversation.view', ...)` 注册方式，无外部 UI 依赖。
- [x] M1 基础设施：独立插件构建、本地 SQLite schema、实体级 CAS、分页/长轮询和自动生成的 typed Remote。
- [x] M2 主实现：来源观察、辅助模型单飞调度、持久预算、重讲、双触发压缩、ExplainContext 与 `conversation.view` 学习界面。
- [x] M2 真实 DSH Web/模型流程验收与 GIF。
- [x] M3 发布门禁：P0 验收矩阵、无密钥 assembled Web snapshot、安装与组合 smoke。
- [x] M4 内测可控性：无 YAML 设置页、并发设置收敛、来源跳转/缺失降级、共享诊断 store 和扩展 assembled Web snapshot。
- [x] M5 主动学习命令：composer 中的 `/explain <学习请求>`、显式请求调度、来源标识、持久重讲摘要和稳定失败结果。
- [x] M6.1 Explain Host 协议：`--selection` / `--suggested <turn>` 来源定位、origin 持久化、重讲传播和稳定失败。
- [x] M6 P1 实现：选中文字、预测回复学习建议和 Advisor 可见建议经可编辑 `/explain` 草稿进入同一学习闭环；无密钥组合与全新真实模型反馈流程均通过。

M1 建立持久层和 Host/Client RPC 基础；M2 完成学习闭环；M3 建立 P0 发布门禁；M4 让内测用户无需编辑 YAML 即可配置和诊断，并能从讲解返回仍存在的来源会话；M5 允许用户从工作 composer 主动发起一次学习；M6 把同一命令协议接入可选插件工作流。自动化证据见 [验收矩阵](docs/ACCEPTANCE.md)。

## 当前迭代

M6 通过 DSH command 目录和 composer 公共写入路径集成 `dsh-selection-chat`、`dsh-suggested-replies` 与 `dsh-advisor`，不读取其他插件私有数据，也不增加自动模型调用。实现已在 `dsh-selection-chat@90e9517`、`dsh-suggested-replies@0988019`、`dsh-advisor@2a3b011` 和 DSH `47f9438` 上通过；当前账号对两个 `dsh-external` 消费方仓库只有只读权限且组织禁用 fork，因此仍需维护者发布对应本地提交。完整范围与证据见 [迭代记录](docs/NEXT.md)。

## 安装

Explain 当前适配 DSH `0.1.0-rc.6`。DSH 仍处于开发者预览阶段，本插件不支持更早的私有预览包版本线。

```sh
npx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add github:yuezengwu/dsh-explain
npx @deepseek-ai/dsh@0.1.0-rc.6 web
```

Git 仓库插件会在安装时构建。如果 pnpm 要求批准构建，请按错误信息把 `dsh-explain` 加入该 profile 的 `pnpm-workspace.yaml`，然后重新运行安装命令。

## 本地开发

默认构建使用公开的 DSH `0.1.0-rc.6` API 包。assembled Web 验收仍需要已构建的 DSH 源码 checkout；安装依赖后显式建立本地链接：

```sh
pnpm install
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run dsh:link
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run dsh:link:check
pnpm run test
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run test:web
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run test:m6
pnpm run typecheck
pnpm run build
```

源码 checkout 必须匹配 `0.1.0-rc.6` 的公开 API；插件不保留更早私有预览版本线的兼容层。

`test:web` 使用全新临时 `$DSH_HOME`、持久 Session fixture 和预置 Explain SQLite 运行无密钥的真实 DSH Web 组合，并比对学习视图与设置页 ARIA golden；它还验证 native settings revision 写入、可用来源跳转和缺失来源降级。更新有意的界面输出时运行 `DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run test:web:refresh` 并审查 snapshot diff。

`test:m6` 把 Explain、selection-chat、suggested-replies 和精确 Advisor 兼容提交安装到全新 profile，验证每个插件只贡献一次、预测回复预算不变、选区只写草稿，以及卸载/重新安装完全收敛。默认要求两个消费方仓库位于同级目录；也可通过 `DSH_SELECTION_CHAT_DIR`、`DSH_SUGGESTED_REPLIES_DIR` 或 `DSH_ADVISOR_DIR` 覆盖。

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
| [dsh-advisor](https://github.com/omdsh-dev/dsh-advisor) | 转录增量、模型调用隔离、发射保护和配置 gateway | advisor 向主 agent 注入建议；explain 永不注入主模型 |
| [dsh-memory](https://github.com/dsh-external/dsh-memory) | 仓库命名覆盖长期记忆方向 | 当前只有占位 README，没有可复用服务或协议 |
| [dsh-memory-evolve](https://github.com/dsh-external/dsh-memory-evolve) | 跨会话分层记忆、低频快照与用户可见管理经验 | 未公开 Cordis memory service，且快照进入主 Agent；explain 不依赖或读取其私有文件 |
| DSH `compact-basic` / `token-meter` / LLM model info | 容量阈值策略、固定 token 估算和精确路由 `contextWindow` | 原生 compact 只修改单个 Session surface；explain 需要自有全局 SQLite compactor |
| DSH 第三方 memory MCP 示例 | 跨会话持久记忆的可选互操作参考 | 模型主动工具调用和外部 provider 不适合作为 P0 自动 ExplainContext |
| DSH `ui-trajectory` | `conversation.view` 视图注册、Session 头部 Tab 和 active-only 渲染先例 | trajectory 的 Session 事件视图模型；学习事实仍使用插件自有 SQLite 与 Remote |
| [DSH-better-sidebar](https://github.com/dsh-external/DSH-better-sidebar) | 侧边工作台交互参考 | P0 不需要边工作边查看，因此不引入其服务、源码副本或依赖树 |
| [official-plugins-port](https://github.com/dsh-external/official-plugins-port) 的 `claude/learning-output-style` 与 `claude/explanatory-output-style` | 学习与解释类提示词参考 | 纯 system prompt 无法提供独立调度、持久历史和反馈闭环 |
| [dsh-edu](https://github.com/dsh-external/dsh-edu) | 后续知识沉淀格式 | P0 不做课程、测验、卡片或复习系统 |

## 许可证

本项目使用 [MIT License](LICENSE)。
