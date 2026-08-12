# dsh-explain 技术架构 v3(待 Review)

> 状态:**v2 未通过 review,本文件为重写后的 v3,待 review**(2026-08-12)
> 产品需求见 [./PRD.md](./PRD.md)(P0 草案,随本架构闭合平台可行性)
> 修订记录:[v2 → v3 修订说明](#v2--v3-修订说明)

## 核心原则

**主对话与 explain 是互相独立的 agent 循环。**

- 主对话循环完全不变、不知道 explain 存在;explain 不进入主模型上下文,且不阻塞主 turn
- explain 循环自主观察主对话、自主判断时机、自主生成讲解
- 讲解以**持久化自定义 Session 事件**(log-only)记录,客户端通过 **ConversationNode** 渲染为行内卡片
- 悬浮窗形态受扩展位限制,见 [P0 阻塞项 3](#p0-阻塞项)与 [开放决策](#开放决策)

## P0 阻塞项(必须先闭合)

1. **分发形态:repository-plugin 已被主仓库删除**(2026-08-09,无兼容解析器)。唯一外部分发路径是 installable profile bundle:
   - `package.json` 声明 `dsh.bundle.patch` 和 `dsh.client`
   - `cordis.patch.yml` 挂载普通 Cordis 插件(编译后的 Node 入口、`/client` 入口及 invariant)
   - 安装:`dsh plugin --profile <name> add <package>`
2. **"注入消息但主 agent 不可见"不可实现**:模型表面只接受 `user/message`、`assistant/message`、`tool/result` 三种事件类型,普通消息不论 source kind 都会进入模型历史;自定义事件是 log-only。
   **正确路径**:定义持久化的 `explain/*` 自定义 Session 事件,再注册 `ConversationNodeDefinition` 渲染为行内卡片——不进主模型,且可回放、刷新、分页(标准做法见 [adding-a-conversation-node](../docs/cookbook/adding-a-conversation-node.md))。
   "不进 session log、刷新丢失可接受"与"未增强时降级为纯文本"均不成立。
3. **当前没有通用右侧悬浮窗扩展位**:Web UI 规定所有业务 UI 必须通过 `ctx.slots.register` 组合;现有 `details` 是 single slot 且已被会话 UI 占用,仅开放工具详情子槽。
   现有可用扩展位包括 `conversation.composer.dock`(dsh-auto-blame 已占用,渲染输入框上方气泡)。
   **P0 必须二选一**(见开放决策 A):① 先给主仓库增加正式面板/浮层 slot;② 收缩 P0 为行内卡片 + 现有扩展位。

## 组件结构(profile bundle)

```
dsh-explain(installable profile bundle)
├── package.json          — dsh.bundle.patch + dsh.client(web)声明
├── cordis.patch.yml      — 挂载编译后 Node 入口与 client 入口
├── src/(node half)
│   ├── index.ts          — 入口:explain 循环生命周期(开关)
│   ├── observer.ts       — 监听 session/event,收集主对话转录(回合边界)(参考 dsh-advisor/transcript)
│   ├── explainer.ts      — 独立模型调用:评估转录 → 判断是否讲解 → 生成讲解(事件契约)
│   ├── guard.ts          — 去重(TopicId)/频率/冷却(参考 dsh-advisor/emission-guard)
│   ├── feedback.ts       — ✓懂了→抑制同 TopicId;✗没懂→新 revision 重讲
│   ├── events.ts         — SessionEventMap 合并:explain/* 事件族(producer 所属,含 branded id)
│   ├── projection.ts     — explain 事件 → 会话投影(客户端读取)
│   ├── gateway.ts        — typed Remote/RPC:feedback/config(参考 dsh-advisor/gateway 的 typertGateway 模式)
│   └── config.ts         — 全局设置(schemastery Config,走 settings)
├── client/
│   └── explain-node.tsx  — ConversationNodeDefinition:explain 事件 → 行内卡片渲染
└── invariant.ts          — client 组合声明
```

## 事件契约(持久协议,非展示文本)

`explain/*` 事件族(log-only,不进模型表面),每次讲解至少包含:

| 字段 | 说明 |
|---|---|
| `explanationId` | branded `ExplanationId`——稳定业务 id |
| `topicId` | branded `TopicId`——去重/反馈的键(非模型生成的自由文本,由 host 归一化) |
| `turn` / `step` / `eventSeq` | 来源坐标 |
| `revision` | 重讲代数;✗ 反馈产生关联到原 id 的新 revision |
| `title` / `what` / `why` / `pitfall` | 有长度上限并经过校验的展示字段 |

标记块(`📚 知识点 | 主题:…`)仅作为渲染格式,不作为持久协议或主键。

事件族(参考 cookbook 的 replayable family):

| 事件 | 角色 |
|---|---|
| `explain/start` | 唯一开始:`explanationId`、坐标、`topicId`、标题 |
| `explain/content` | 更新:同一 `explanationId`、`title/what/why/pitfall` |
| `explain/rephrase` | 重讲:关联原 id 的新 `revision` |
| `explain/dismiss` | ✓ 懂了:同一会话内抑制该 `TopicId` |

## 辅助模型调用规范

- **请求前记录**:模型路由、system/messages、输入事件范围与限制(可重放)
- **边界**:最大输入/输出、超时、`AbortSignal`
- **并发**:同一会话连续回合的排队/合并/丢弃策略
- **迟到结果**:关闭模式、切换会话、插件卸载后的迟到结果处理(丢弃并记录)
- **事件**:输出、usage、失败、取消均有对应事件或日志
- **teardown**:等待后台任务静止再卸载
- **影响声明**:主模型上下文不变且不阻塞 turn;但共享模型配额、成本和限流仍可能间接影响主任务——不在文档中宣称"完全无影响"

## 状态与数据流

- **会话状态**(开关、讲解结果、反馈)走 Session 事件 + 投影,由投影负责持久化、恢复与 fork 语义;不建独立 JSON 事实源
- **全局设置**(生成模型、默认值)走 settings/config
- **反馈**走 typed Remote/RPC,payload 携带 `sessionId + explanationId + revision + action`;不添加未定义认证与 CSRF 行为的可变 REST 端点(Web Server 无 TLS/认证/origin 策略,可绑 0.0.0.0)
- 客户端只读投影渲染

```
主对话回合 → observer 收集转录 → explainer(独立模型)评估
  ├─ 无价值 → 静默(guard 计数)
  └─ 有价值 → guard 通过 → session.append('explain/start'|'explain/content')
           → projection 推送 → client ConversationNode 渲染行内卡片
✓懂了 → typed Remote → 'explain/dismiss' → guard 抑制同 TopicId
✗没懂 → typed Remote → 'explain/rephrase'(关联原 explanationId)→ 重讲
```

## 阶段路线(修订:首个可发布里程碑必须含完整 P0)

| 阶段 | 内容 | 可发布? |
|---|---|---|
| **M1 内部技术原型** | observer + explainer(真实模型调用)+ explain 事件族 + ConversationNode 行内卡片 + 反馈端点(落日志) | 否——仅为验证管线可行性,不含开关/反馈闭环/持久化,按钮不对外展示 |
| **M2 P0 可发布** | `/explain` 开关(默认关,关闭时零辅助请求/零事件)+ 反馈闭环(✓抑制同 TopicId / ✗新 revision)+ 会话持久化(事件+投影)+ 现有扩展位 UI(见开放决策 A) | 是——通过 PRD 验收标准 |
| M3 打磨 | guard 调优、单测补全、keyless snapshot、真实流程 GIF | — |

GUI 单测、keyless Web replay/snapshot 与真实流程 GIF 从**首个 UI PR(M2 或 M1 的 UI 部分)开始**,不推迟到 M3。

## 开放决策(需产品/主仓库配合)

- **A. 悬浮窗扩展位**:① 给主仓库增加正式面板/浮层 slot(主仓库变更,PR 到 deepseek-harness)还是 ② P0 收缩为行内卡片 + 现有扩展位(`conversation.composer.dock` 等),悬浮窗形态延后?
- **B. M1 定位**:已按 review 改为"内部技术原型,不可发布";若产品要求首个可见版本即完整 P0,则 M1/M2 合并。

## v2 → v3 修订说明

| review 发现 | v3 处置 |
|---|---|
| [P0] `.dsh-plugin` 已删除 | 改为 installable profile bundle(组件结构重写) |
| [P0] source kind 不控制可见性 | 改为持久化 `explain/*` 事件 + ConversationNode 渲染 |
| [P0] 无右侧悬浮窗扩展位 | 列为阻塞项 + 开放决策 A,不再宣称"零平台依赖悬浮窗已确定" |
| [P1] M1 不满足 P0 | M1 明确为内部技术原型;完整 P0 并入 M2 可发布里程碑 |
| [P1] 辅助模型调用缺规范 | 新增"辅助模型调用规范";影响声明收窄 |
| [P1] JSON + REST 双重事实源 | 会话状态走事件+投影;全局走 settings;反馈走 typed Remote |
| [P1] 主题文本作主键 | 事件契约引入 branded ExplanationId/TopicId/revision/坐标/限长字段 |
| [P1] 查重遗漏 dsh-auto-blame | README 补入;结论改为"产品目标无直接重复,基础设施已有近似实现" |
| [P2] 验收不可测试 | PRD 验收标准重写为可自动验证条件 |

## 架构决策记录

| 日期 | 决策 |
|---|---|
| 2026-08-12 | 循环形态:观察管线起步,后续升级有状态独立 agent(两阶段路线,保留) |
| 2026-08-12 | 分发形态:installable profile bundle(v3,取代已删除的 repository-plugin) |
| 2026-08-12 | 讲解呈现:持久化 explain/* 事件 + ConversationNode 行内卡片(v3) |
| 2026-08-12 | 状态管理:事件+投影唯一事实源;反馈走 typed Remote(v3) |
| 2026-08-12 | 里程碑:M1 内部原型 / M2 完整 P0 可发布(v3) |
