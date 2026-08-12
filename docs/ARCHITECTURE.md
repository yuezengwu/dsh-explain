# dsh-explain 技术架构 v4(待 Review)

> 状态:**v4 提交待 review**(2026-08-12)· 产品需求见 [./PRD.md](./PRD.md)
> 修订记录:[v3 → v4 修订说明](#v3--v4-修订说明)

## 核心原则

**主对话与 explain 是互相独立的 agent 循环。**

- 主对话循环完全不变、不知道 explain 存在;explain 不进入主模型上下文,且不阻塞主 turn
- explain 循环自主观察主对话、自主判断时机、自主生成讲解
- 讲解以**持久化自定义 Session 事件**(log-only)记录,客户端通过 **ConversationNode** 渲染为行内卡片
- 反馈操作承载于**回合尾部**(`conversation.chat.turnTail` 槽),不改主仓库

## 呈现位置(P0 定稿,不改主仓库)

| 元素 | 槽位 | 展示位置 | 依据 |
|---|---|---|---|
| 讲解卡片(是什么/为什么/坑) | `conversation.chat.node`(keyed) | 消息流内,按 ChatNodeKind 分派 | ConversationNode cookbook 正路;v3 已定 |
| 当前知识点 + 反馈按钮(✓ 懂了 / ✗ 没懂) | `conversation.chat.turnTail`(chain) | 回合节点尾部(IconActions 前) | chain 槽可共存;注册方式参考 DSH-better-sidebar(select + priority + inject) |

**分工**:行内卡片承载讲解内容;回合尾部承载"本轮知识点小结 + 两反馈按钮"的操作入口。

右侧悬浮窗形态**从 P0 移除**:当前主仓库无空闲右侧浮层扩展位(`details` 整列被占用,仅开放工具输出子槽);若后续要真悬浮窗,需先给主仓库加浮层槽(主仓库 PR),或另行评估 DOM 接管姿势的代价——均不在 P0 范围。

## P0 已闭合的阻塞项

1. **分发形态**:installable profile bundle(`dsh.bundle.patch` + `cordis.patch.yml` + `dsh.client`;`.dsh-plugin` 已被主仓库删除,不采用)
2. **讲解呈现**:持久化 `explain/*` 自定义 Session 事件(log-only)+ ConversationNodeDefinition 渲染行内卡片;不注入普通消息(模型表面仅 `user/message`/`assistant/message`/`tool/result`,自定义事件不进模型历史)
3. **展示位置**:行内卡片(`conversation.chat.node`)+ 回合尾部(`conversation.chat.turnTail`),均为现有扩展位,不改主仓库(开放决策 A 已闭合)

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
│   ├── explain-node.tsx  — ConversationNodeDefinition:explain 事件 → 行内卡片渲染(chat.node)
│   ├── explain-tail.tsx  — 回合尾部组件:本轮知识点小结 + 两按钮(turnTail)
│   └── invariant.ts      — client 组合声明
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

事件族:

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
- **影响声明**:主模型上下文不变且不阻塞 turn;但共享模型配额、成本和限流仍可能间接影响主任务

## 状态与数据流

- **会话状态**(开关、讲解结果、反馈)走 Session 事件 + 投影,由投影负责持久化、恢复与 fork 语义;不建独立 JSON 事实源
- **全局设置**(生成模型、默认值)走 settings/config
- **反馈**走 typed Remote/RPC,payload 携带 `sessionId + explanationId + revision + action`;不添加未定义认证与 CSRF 行为的可变 REST 端点
- 客户端只读投影渲染

```
主对话回合 → observer 收集转录 → explainer(独立模型)评估
  ├─ 无价值 → 静默(guard 计数)
  └─ 有价值 → guard 通过 → session.append('explain/start'|'explain/content')
           → projection 推送 → client:
              · explain-node.tsx 渲染行内讲解卡片(chat.node)
              · explain-tail.tsx 渲染回合尾部小结+两按钮(turnTail)
✓懂了 → typed Remote → 'explain/dismiss' → guard 抑制同 TopicId
✗没懂 → typed Remote → 'explain/rephrase'(关联原 explanationId)→ 重讲
```

## 阶段路线

| 阶段 | 内容 | 可发布? |
|---|---|---|
| **M1 内部技术原型** | observer + explainer(真实模型调用)+ explain 事件族 + 行内卡片 + 回合尾部 UI + 反馈端点(落日志) | 否——验证管线与两个槽位可行性,不含开关/反馈闭环/持久化 |
| **M2 P0 可发布** | `/explain` 开关(默认关,关闭时零辅助请求/零事件)+ 反馈闭环(✓抑制同 TopicId / ✗新 revision)+ 会话持久化(事件+投影) | 是——通过 PRD 验收标准 |
| M3 打磨 | guard 调优、单测补全、keyless snapshot、真实流程 GIF | — |

GUI 单测、keyless Web replay/snapshot 与真实流程 GIF 从首个 UI PR 开始。

## v3 → v4 修订说明

| 变更 | 内容 |
|---|---|
| 呈现位置定稿 | 行内讲解(`conversation.chat.node`)+ 回合尾部操作(`conversation.chat.turnTail`);开放决策 A 闭合:不改主仓库,右侧悬浮窗移出 P0 |
| 阻塞项 3 闭合 | 无空闲右侧浮层扩展位 → P0 用现有槽位;真悬浮窗需主仓库加浮层槽,延后 |
| 组件结构 | client 增加 explain-tail.tsx(turnTail 注册,参考 DSH-better-sidebar 的 select/priority/inject 用法) |

## 架构决策记录

| 日期 | 决策 |
|---|---|
| 2026-08-12 | 循环形态:观察管线起步,后续升级有状态独立 agent(两阶段路线,保留) |
| 2026-08-12 | 分发形态:installable profile bundle(v3,取代已删除的 repository-plugin) |
| 2026-08-12 | 讲解呈现:持久化 explain/* 事件 + ConversationNode 行内卡片(v3) |
| 2026-08-12 | 状态管理:事件+投影唯一事实源;反馈走 typed Remote(v3) |
| 2026-08-12 | 里程碑:M1 内部原型 / M2 完整 P0 可发布(v3) |
| 2026-08-12 | **呈现位置:行内卡片 + 回合尾部操作,不改主仓库;悬浮窗移出 P0(v4)** |
