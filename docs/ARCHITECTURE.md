# dsh-explain 技术架构 v2(待 Review)

> 状态:**已提交待 review**(2026-08-12)· 对应 PRD P0([docs/PRD.md](docs/PRD.md))
> 本文件是技术方案的当前基线;review 修改后更新版本号,不覆盖历史

## 核心原则

**主对话与 explain 是互相独立的 agent 循环。**

- 主对话循环完全不变、不知道 explain 存在、不受 explain 影响
- explain 循环自主观察主对话、自主判断时机、自主生成讲解
- 讲解以独立消息注入主对话流(主 agent 不可见),前端渲染为行内卡片
- 右侧悬浮窗展示当前知识点 + 反馈按钮(✓ 懂了 / ✗ 没懂)

## 组件结构

```
dsh-explain(.dsh-plugin repository-plugin)
├── node half(src/)
│   ├── index.mjs      — 入口:tapIndex 注入 UI + explain 循环生命周期(开关)
│   ├── observer.mjs   — 监听 session/event,收集主对话转录(回合边界)(参考 dsh-advisor/transcript)
│   ├── explainer.mjs  — 独立模型调用:评估转录 → 判断是否有值得讲的知识点 → 生成讲解(标记块契约)
│   ├── delivery.mjs   — 讲解注入通道(主 agent 不可见,见"验证点")
│   ├── guard.mjs      — 去重(主题)/频率/冷却(参考 dsh-advisor/emission-guard)
│   ├── feedback.mjs   — ✓懂了→去重表;✗没懂→触发重讲
│   ├── routes.mjs     — REST:/state(当前知识点)/feedback/config
│   ├── config.mjs     — 开关、生成模型、默认值(schemastery Config)
│   └── storage.mjs    — $DSH_HOME/storages/explain/ JSON
├── client/
│   ├── index.mjs      — 扫描消息流按 kind 渲染讲解卡片 + 右侧悬浮窗(两按钮/可折叠)
│   └── logic.mjs      — 纯函数(标记解析、渲染数据、悬浮窗状态)→ 可单测
└── dsh-plugin.mjs     — 生成清单(entry: ./index.mjs)
```

形态依据:官方 repository-plugin(`.dsh-plugin` 包),`httpServer.tapIndex` 注入 UI 脚本,纯 DOM 自渲染,零平台依赖(参考 dsh-external/whale-girl)。

## 讲解识别契约(标记块)

讲解消息携带独立 source kind(如 `explain`),内容为标记块:

```
📚 知识点 | 主题:jq
是什么:…
为什么:…
坑:…
```

- 前端按 kind + 标记块渲染为可折叠卡片
- 未增强时降级为纯文本(天然回退)
- 主题字段是去重/反馈闭环的键

## 关键数据流

```
主对话回合 → observer 收集转录 → explainer(独立模型)评估
  ├─ 无价值 → 静默(guard 计数)
  └─ 有价值 → guard 通过 → delivery 注入讲解消息(kind=explain)
           → 前端按 kind 渲染行内卡片 + 悬浮窗同步"当前知识点"
✓懂了 → /feedback → 去重表(主题→已掌握)→ guard 过滤
✗没懂 → /feedback → 触发 explainer 换说法重讲
```

## 阶段路线

| 阶段 | 内容 |
|---|---|
| **M1 体验优先** | observer + explainer(真实模型调用)+ 注入通道 + 前端卡片渲染 + 悬浮窗(两按钮/当前知识点)+ 反馈落日志 |
| M2 | 反馈闭环(懂了→去重生效;没懂→重讲)+ `/explain` 开关命令 |
| M3 | guard 打磨、持久化、client 纯函数单测、预览 GIF |
| M4(后续) | 升级为**有状态独立 agent**(sidechain 式,自有上下文与记忆) |

## M1 前必须验证的技术点

**"主 agent 不可见的讲解消息"如何实现**——"互相独立"承诺的技术落点:

- dsh-advisor 的注入(`agent.inject`,kind='advisor')是**给主模型看**的(非唤醒、下个 pre-step 消费)——不符合"主 agent 不可见"
- 需在 dsh 源码中查证:会话层是否存在"仅前端可见、不进模型请求"的消息类型
- 若无:退路为讲解走独立事件通道推给前端,前端在消息流**渲染层**呈现(不进 session log,刷新后不保留——体验打折但可接受)

## 架构决策记录

| 日期 | 决策 |
|---|---|
| 2026-08-12 | 插件形态:官方 repository-plugin(`.dsh-plugin`,纯 DOM 注入),非 bundle + React client |
| 2026-08-12 | 讲解识别:消息 source kind + 标记块契约,非 JSON 契约、非独立消息类型之外的扫描 |
| 2026-08-12 | 循环形态:**观察管线起步**(advisor 式,无状态),后续升级有状态独立 agent(两阶段路线) |
| 2026-08-12 | 呈现通道:讲解注入主对话流(主 agent 不可见),前端渲染行内卡片 |
| 2026-08-12 | M1 范围:体验优先,反馈按钮先落日志不接线 |
