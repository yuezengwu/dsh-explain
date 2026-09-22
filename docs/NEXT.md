# dsh-explain 迭代计划

## M21：DSH 0.1.7-alpha.1 兼容（2026-09-22）

本轮在 main 提供 0.1.7-alpha.1 适配，保留九个旧宿主。设置改走原生 live Config / profile patch，并保留 Explain 旧设置；Session V4 的消息和工具结果读取保持来源隔离。十宿主门禁及迁移/重启验收见[兼容约定](./COMPATIBILITY.md)。当前发布标签仍为 v0.3.1，其范围截至 0.1.6-alpha.2；本轮没有新增发布标签。npm next 的 0.1.5-rc.3 缺少对应官方 tag，固定源码验证继续待定。

## M20：DSH 0.1.6-alpha.2 兼容（2026-09-18）

当前代码适配 0.1.6-alpha.2 的来源导航与 Session reference slot，保留八个既有宿主，并新增新版插件管理页的实时停用/启用验收。发布包与九宿主 CI 门禁见[兼容约定](./COMPATIBILITY.md)。这些修复随 [v0.3.1](https://github.com/yuezengwu/dsh-explain/releases/tag/v0.3.1) 提供，安装命令固定到该标签；v0.3.0 标签的支持范围截至 alpha.1。v0.3.1 的产品代码与兼容 PR #42 合入提交一致，版本号与安装文档单独收尾。社区同步发布版本及验证链接；目录实际刷新与外部 PR 审批分别跟踪。

## v0.3.0 发布收尾（2026-09-15）

实现和真实模型验收已完成，发布入口为 [v0.3.0](https://github.com/yuezengwu/dsh-explain/releases/tag/v0.3.0)。`deepseek-flash` 在 DSH 0.1.6-alpha.1 上通过讲解、重讲、偏好修正、正反答案复习、精确回答命令、导出及清空；精确运行时代码与证据见[真实模型验收](./REAL_MODEL_ACCEPTANCE.md)。本次发布提交补充文档和验收素材，并修正 Web/M6 测试只查找未选中会话的前提，增加重复打开当前会话的检查；运行时代码与 PR #40 合入提交一致。

社区后续集中在已有 [52DSH PR #2](https://github.com/tuofangzhe/dsh-plugins/pull/2) 和 [metadata PR #2336](https://github.com/dsh-pluginmarket/metadata/pull/2336)，合并及目录抓取由外部维护者处理；上游缺失依赖继续在 Discussion #6082 跟踪。真实用户反馈沿用 [Issue #31](https://github.com/yuezengwu/dsh-explain/issues/31)。以下里程碑保留当时状态；标签发布以 release 为准，后续兼容范围见上方 M21。

## M19：异步来源读取与社区资料修复

> 状态：**已合入 `main`（PR #40），八宿主门禁通过**（2026-09-15）。

来源读取迁移到八个宿主共有的异步分页接口，移除生产代码中的同步 Session 历史读取；保持来源选择、隐私隔离和 SQLite schema 4 / backup v3。自动观察和手动来源读取都在等待完成后检查 generation，避免清空数据后旧请求重新写入。新增分页回归、清空期间读请求竞态回归，并修复中英文 README 在目录网站上的相对文档与媒体链接。

目录记录通过固定提交的修复 PR 推进；同日完成真实辅助模型验收，见本页发布收尾记录。无密钥测试和真实模型样例各自保留证据范围。

## M18：DSH 0.1.6-alpha.1 兼容

> 状态：**实现与本地验收完成**（2026-09-15）。

开发依赖、锁文件、peer 声明和源码链接门禁新增 0.1.6-alpha.1，保留七个既有宿主；CI 固定八个源码提交。新发布包的 store 依赖缺失仍可独立复现，精确版本补丁扩展到本次 alpha。发布包通过 frozen install、类型检查、80 项测试、build / pack；八个宿主各通过类型检查、80 项测试、7 Web、3 M6 和构建。设置快照补充保存完成等待，修复 CI 在 revision 推送后偶尔捕获“保存中”状态的竞态；快照期望不变。产品运行时与 SQLite schema 4、backup v3 无需变更。

该轮暂留的同步 Session 历史读取已由 M19 迁移至公开异步分页入口。上游依赖问题继续在 [Discussion #6082](https://github.com/deepseek-ai/deepseek-harness/discussions/6082) 跟进；目录资料同步、真实辅助模型教学验收和 v0.3.0 标签发布分别记录，不以自动化兼容测试替代。版本与渠道见 [兼容约定](./COMPATIBILITY.md)。

## M17：DSH 0.1.5-rc.1 / rc.2 兼容

> 状态：**实现与本地验收完成**（2026-09-11）。

开发与安装基线升级到 `0.1.5-rc.2`，同时验证 npm 默认渠道的 `0.1.5-rc.1` 并保留五个旧宿主。CI 固定七个源码提交；各宿主通过类型检查、80 项测试、7 Web、3 M6 和构建。store 发布包缺失依赖的问题仍影响两个新 rc，精确版本依赖声明修复随之扩展，rc.2 发布包完整验收通过。上游社区回复与后续进展归于 [Discussion #6082](https://github.com/deepseek-ai/deepseek-harness/discussions/6082)，未将下游修复视为上游解决。产品运行时、SQLite schema 4 和 backup v3 保持兼容，版本与渠道见 [兼容约定](./COMPATIBILITY.md)。

## M16：DSH 0.1.5-alpha.2 兼容与发布包依赖修复

> 状态：**已合入 `main`（PR #36），尚未发布 v0.3.0**（2026-09-10）。

开发依赖和锁文件升级至 `0.1.5-alpha.2`，保留四个既有宿主，CI 使用五个精确源码提交。修复新发布的 client-store 遗漏 Zustand/Immer 运行依赖导致的干净安装测试失败，只对该版本扩展依赖声明；独立复现已反馈上游 [Discussion #6082](https://github.com/deepseek-ai/deepseek-harness/discussions/6082)。发布包检查及五个宿主的 80 项测试、7 Web、3 M6 均通过。外层 Web 面板变更不影响现有内部插槽，Explain 运行时、SQLite schema 4 和 backup v3 保持不变；细节见 [兼容约定](./COMPATIBILITY.md)。

## M15：DSH 0.1.5-alpha.1 / Session V3 兼容

> 状态：**已合入 `main`（PR #35），尚未发布 v0.3.0**（2026-09-09）。

开发依赖和锁文件升级至 `0.1.5-alpha.1`；保留 rc.1、0.1.3-alpha.1、0.1.3-alpha.2，CI 使用四个精确源码提交。补充 V3 系统提示词隔离回归，修复合成旧日志的 step/message 顺序，并适配新版输入框文案。四个宿主分别通过类型检查、80 项测试、7 Web 和 3 M6；发布包通过类型检查、80 项测试、构建与打包检查。产品运行时和 Explain 数据格式保持兼容，具体证据见 [COMPATIBILITY.md](./COMPATIBILITY.md)。

## M14：DSH 0.1.3-alpha.2 兼容

> 状态：**已合入 `main`（PR #34），尚未发布 v0.3.0**（2026-09-08）。

开发依赖和锁文件升级至已发布的 alpha.2；peer 与源码链接门禁保留 rc.1、alpha.1，并显式接受 alpha.2。类型检查、80 项单元/集成、7 个真实 Web 场景、3 个 M6 场景覆盖三个固定源码版本；CI 增加 alpha.2 组装宿主，发布包检查使用 alpha.2。无需修改产品运行时或 SQLite 格式。安装渠道与精确提交见 [COMPATIBILITY.md](./COMPATIBILITY.md)。

社区继续围绕已有反馈 Issue 和插件目录同步兼容事实、收集真实使用反馈；v0.3.0 标签发布与真实辅助模型教学验收仍待单独完成。

## M13：学习闭环修复与 DSH 0.1.3-alpha.1 兼容

> 状态：**已合入 `main`（PR #33），尚未发布 v0.3.0**（2026-09-05）。

本轮修复空闲压缩失败后的定时器空转、活跃卡片受 30 条分页限制、无关活跃正文和全部重讲历史导致的上下文积压、复习失败后仍视为 mastered、敏感文本过滤缺口，以及题型按批次位置而非概念历史分配的问题。保持 SQLite schema 4 和 backup v3，无需迁移既有数据。

同时验证 npm rc.1 与当时的官方最新源码 alpha.1：两个源码版本分别通过类型检查、80 项单元/集成测试、7 个真实 Web 场景及 3 个 M6 场景；CI 新增固定提交的双版本组装矩阵。安装渠道和可复现命令见 [COMPATIBILITY.md](./COMPATIBILITY.md)，新增回归证据见 [ACCEPTANCE.md](./ACCEPTANCE.md)。现有 rc.1 Demo 保持其原版本标注。

## M12：DSH 0.1.2-rc.1 兼容

> 状态：**实现与本地验收完成**（2026-09-04）。

依赖基线从 DSH `0.1.2-alpha.5` 升级到 `0.1.2-rc.1`。官方标签 `dsh-v0.1.2-rc.1`（`a66e4702047846cdaa10c66c9d3df3951f5ea70d`）相对 alpha.5 只统一更新 252 个工作区包版本，没有源码或公开 API 变化；因此保留 M11 已完成的运行时适配，只更新发布包、锁文件、源码版本门禁、兼容说明和 Demo。官方源码完整构建、发布包类型检查与 71/71 单元/集成测试、keyless Web 6/6、M6 组合 3/3、生产构建、pack dry-run 和 rc.1 Demo 均已通过。

## M11：DSH 0.1.2-alpha.5 兼容

> 状态：**已合入 `main`（PR #29）**（2026-09-02）。

依赖基线从 DSH `0.1.2-alpha.3` 升级到 `0.1.2-alpha.5`。来源观察改用 `Session.seq`、`eventAt()` 与 `snapshotEvents()`，适配 `Session.events` 移除和强类型序号；composer 左侧快捷入口改从标准 `useInput` hook 读取状态；组装夹具补齐新的未继承会话元数据。发布包、官方源码链接、keyless Web 6/6、M6 组合 3/3、71 项单元/集成测试和 alpha.5 Demo 均在同一候选分支验证。

## M10：Demo 与 GitHub 展示面

> 状态：**已合入 `main`（PR #28），GitHub 展示面已更新**（2026-09-02）。

围绕「Capture → Review → Adapt」重录 28 秒主 Demo：在真实组装的 DSH Web `0.1.2-alpha.3` 中展示从已完成回答生成可编辑草稿、查看全局学习线程和到期复习、修正学习画像、导出本地数据的完整闭环。录制使用临时 `$DSH_HOME`、确定性样例数据和无网络 replay 路由，不读取个人会话、凭证或宿主路径；脚本以 `--no-open` 启动，避免自动化抢占默认浏览器。

本轮同时重构中英文 README 首屏、Quick start、隐私模型与验证状态，产出 MP4、README GIF、四张真实界面证据图、品牌横幅和 1280×640 Social Preview。品牌背景由图像生成工具制作，但所有产品界面均来自真实录制；生成来源、录制约束与复现命令记录在 [DEMO.md](./DEMO.md)。PR #28 合入后已经同步 GitHub About、topics 和 Social Preview；`v0.3.0` 发布仍是独立确认边界。

## M9：可校正学习画像

> 状态：**已合入 `main`（PR #27）**（2026-09-02）。

学习概况公开显示讲解长度、结构、示例、术语和 Topic 熟悉度的当前判断、信心与来源。用户可以纠正推断、忘记旧判断或设置显式偏好；有效优先级固定为“显式偏好 > 用户修正 > 模型推断”。控制与审计仅保存在本地，进入 backup v3 和 `CLEAR`，写入本身不新增模型调用，也不进入主 Agent。

本轮不扩展到 LMS/课程导入、日历、云同步、视频、速查表或知识图谱。

## M8：v0.3 复习闭环

> 状态：**实现与自动化验收完成**（2026-08-31）。

「懂了」不再是学习终点：新掌握概念次日进入本地复习，历史 v2 已掌握概念迁移后立即到期。学习页的「今日复习」每轮持久化最多三道回忆、应用、辨析题；答案经同一辅助模型全局单飞评估为掌握、模糊或遗忘，再由固定的 1/3/7/14/30/60 天规则安排后续复习。题目、答案、反馈、排期和来源坐标随 SQLite schema v3 保存并进入 v2 备份。

本轮同时提供 `/review` 快速入口。明确不做 DSH 临时 schedule overlay、课程导入、云同步、排行、外部 RAG、Anki 或知识图谱；这些方向需要新的产品确认。

## M7：v0.2 本地数据治理

> 状态：**实现、单元/集成验收与文档完成**（2026-08-30）。

设置页新增版本化 JSON 导出与显式确认清除。导出仅包含公开学习卡片、Topic 状态和 ExplainContext 投影；清除先隔离所有在途生产者，再以 SQLite revision CAS 原子删除学习内容。模型设置、启用状态、运行租约和当前滚动 24 小时自主额度计数保留，避免破坏运行权威或通过清除绕过成本上限。

本轮明确不实现导入、云同步、遥测、课程或逐条删除。复习系统已由 M8 独立实现。

## M6：P1 Explain 自有快捷入口

> 状态：**方案、对抗性审查、实现、自动化验收与真实模型流程完成**（2026-08-14）。验收基线为 DSH `47f9438`；所有 M6 产品代码均位于 `dsh-explain`，真实模型证据随合入 PR 保存。

### 目标

为两个线性学习动作提供 Explain 自有入口：选中当前可见文字后请求解释，以及针对任意已完成 assistant 回答发起精确来源学习。Advisor 的可见建议沿用选区入口。两个入口都生成可编辑的 `/explain` 草稿，由用户再次提交；它们不自动调用模型、不占自主额度，也不改变主 Agent 历史。

### 集成原则

- `dsh-explain` 独占快捷 UI、全局学习线程、ExplainContext、Topic 门、来源槽、调用预算和辅助模型 Scheduler。其他插件无需修改，也不读取 SQLite、typed Remote 私有 DTO 或 ExplainContext。
- 两个入口使用 DSH 第一方 `conversation.input.left` 与 `conversation.chat.assistant-actions` additive slots，不覆盖宿主或其他插件的槽位项。
- 入口只调用公开的 per-session input facade 设置草稿，不自动 `submit()`。点击时重新读取当前 input；不是 `plain`、已有非空草稿或 Session 已失效时拒绝覆盖。
- 所有模型调用仍从 `/explain` command handler 进入同一个 manual 队列。快捷入口不创建第二个 Remote 写入口、Session 自定义事件或后台模型调用。
- `dsh-selection-chat`、`dsh-suggested-replies` 与 `dsh-advisor` 可以独立安装或缺失；Explain 不发现它们、不读取其状态，也不要求跨仓库发布。

### 1. Explain composer 动作：选中内容后解释

Explain 在 `conversation.input.left` 注册「解释选中文字」动作。组件监听浏览器选区，`pointerdown` 先捕获文本，随后把当前 Session 的空 composer 设置为：

```text
/explain --selection <规范化后的选中文字>
```

选区统一 CRLF、不可见行内空白和三个以上连续换行，保留有意义的换行并限制为 10,000 字符。动作不复用其他插件格式，因为 slash command 必须占据完整草稿；非空草稿不得被静默覆盖。

`dsh-explain` 增加封闭的 `--selection` 手动来源。handler 以选中文字作为显式学习请求，并从当前 Session 事件中逆序查找包含该规范化文字的最新消息：assistant/tool 结果使用其 turn，user 或其他 context 消息使用其前一个合格 completed turn；重复文本取最新匹配。找不到可靠坐标时使用 `turn = 0`，UI 不伪造回合号。匹配只决定有界来源 capsule，选中文字本身始终进入 command 日志并作为请求事实。

revision 1 payload 的可选 `origin` 支持 `manual | selection | answer`；旧 payload 缺失 origin 仍表示自主来源，旧 `suggested` 记录保持可读，SQLite schema 不变。学习界面把 selection 显示为「选中解释」。

### 2. Explain assistant 动作：学习这个回答

Explain 在 `conversation.chat.assistant-actions` 为每条 finalized assistant 消息注册「学习这个回答」。组件使用宿主传入的稳定 `messageId` 从当前 `ConversationSnapshot` 反查消息所属 turn；点击把空 composer 设置为：

```text
/explain --answer <来源回合> 请解释这个回答中最关键、最值得学习的概念。
```

文案随客户端语言本地化，模型最终表达跟随请求语言。精确 turn 在点击时写入草稿，`--answer <turn>` 不在提交时重新猜测“最新回合”，避免草稿停留期间新 turn 完成导致来源漂移。显式快捷入口可定位 `completed` 或 `max-tokens` 结束回合；自动 Observer 仍只接受 `completed`。指定 turn 不存在或不合格时返回 `EXPLAIN_SOURCE_UNAVAILABLE`，不退回其他回合。其余沿用 manual 优先级、来源/Topic 原子门、50% 压力门和自主预算豁免；payload 记录 `origin: answer`，学习界面显示「学习回答」。旧 `--suggested` 只作为输入兼容别名，提交后也写 `answer`。

### 3. Advisor：显式解释可见建议

P1 不让 Explain 订阅 Advisor runtime，也不改变 Advisor 的 `inject/steer` 路由。Advisor 建议已经作为带 `source.kind = advisor` 的可见、可持久化 context 消息呈现；用户直接选中建议正文，再使用 Explain 自己的 composer 选区动作。Advisor 可以不安装，Explain 代码与配置不发生变化。

该用户手势是唯一桥接授权：普通 Observer 继续只接受真实用户消息和当前 turn 的 assistant/tool 内容，Advisor 消息不会自动成为自主候选、ExplainContext observation 或 Topic 状态。`--selection` 的显式文本可以进入 Explain Agent，但不会回写或影响 Advisor，也不会被注入主 Agent。

### 调度、预算与隐私

- selection/answer 都是现有 manual 工作的来源变体，优先级、抢占、取消、租约和全局单飞语义不增加新分支；同一 Session 的 pending/active gate 在模型调用前和提交事务中各检查一次。
- 两个快捷入口均不占 `maxAutoRequestsPerDay`；用户真正提交命令后才可能产生 Explain 模型成本。
- 选中文字最多 10,000 字符，之后仍经过 explain `maxSourceChars`；持久化 `sourceSummary` 继续使用固定 2,000 字符隐私上限，不保存完整 assistant、工具参数、工具结果、reasoning 或绝对路径。
- ExplainContext、学习历史、反馈、Topic 和模型路由不跨插件暴露；快捷入口不观察外部插件是否存在。

### 实施顺序

| 阶段 | 仓库 | 修改 | 完成门 |
|---|---|---|---|
| M6.1 | `dsh-explain` Host | 定义 `--selection` / `--answer <turn>` 解析、来源定位、origin 投影和稳定失败 | **已完成**：command/主消息隔离、精确来源、旧 suggested 读取兼容和 Scheduler 测试通过 |
| M6.2 | `dsh-explain` Client | 注册 composer 选区动作、assistant 回答动作、空草稿保护和本地化 | **已完成**：官方 additive slots、点击时 input 准入、只写草稿和组件测试通过 |
| M6.3 | `dsh-explain` 产品门禁 | 全新 profile、双入口、完整卸载/恢复、README/PRD/Architecture | **已完成**：外部插件不存在时完整工作，无页面错误且重新安装只贡献一次 |
| M6.4 | 真实流程 | 选区、精确回答、学习卡和反馈闭环 GIF | **已完成**：从精确 Explain head 启动全新 DSH Web，以真实模型完成入口、学习卡与反馈闭环并随合入 PR 保存 |

M6 只有一个产品仓库和一个合入 PR；外部插件版本、权限和发布节奏不再是 Explain 的完成门。

### 审查结论

- **所有适配代码归 Explain**：其他插件不需要补丁、运行依赖、源码副本、命令发现或私有状态读取。
- **不自动发送**：选区和回答动作只形成可检查、可编辑的草稿，避免误触直接产生模型成本。
- **不伪造来源**：选区无法映射到可靠事件时明确降级为无回合坐标，不能把当前最新 turn 冒充被选择的旧消息。
- **不让 Advisor 污染 ExplainContext**：只有用户显式选择的 Advisor 文字进入一次 manual 请求；自动观察路径保持隔离。
- **不复制权威状态机**：UI 不预判 Topic、来源槽或 Scheduler 竞争；Host 的双重 gate 决定最终结果。
- **不让草稿制造 TOCTOU**：answer 草稿携带被点击消息对应的精确 turn；提交后 Host 只读该 turn，无效时明确失败。
- **无 DSH 核心修改**：现有 composer input facade、`conversation.input.left`、`conversation.chat.assistant-actions` 和可选文本已足够。

### 对抗性审查补充

- **渲染时 disabled 不是写入授权**：按钮点击时必须从 `conversation.input.for(scope).state.getSnapshot()` 重新检查 `phase === 'plain'` 与空草稿，再调用一次 `setDraft()`；不能只信任 React 上一帧或工具条打开时的状态。
- **选区规范化不能破坏代码**：只统一 CRLF、不可见空格与行内重复空白，保留换行和至多两个连续空行；Explain Host 再用同一规则归一化请求。旧原型把全部空白折成单行，不能采用。
- **选区手势可能被焦点清除**：composer 动作在 `pointerdown` 保存规范化文本，`click` 使用该快照；其他选区插件的外部点击处理不能抹掉当前请求。
- **精确 turn 来自宿主消息身份**：assistant action 只接收 finalized `messageId`，从当前 snapshot 定位 turn；草稿创建后即固定，新回合不会改写，Host 也不会在来源失效时回退到最新回合。
- **生命周期资源必须随 Explain 卸载**：slot 注册、selectionchange 监听与样式都由插件 effect 或组件 cleanup 释放；卸载后没有外部插件入口需要收敛。
- **组合成本保持显式**：两个快捷入口本身保持零调用，只有用户提交草稿后才产生 Explain 请求；其他插件自己的调用预算与 Explain 无关。

### 验收标准

1. Explain 未安装时两个快捷入口都不存在；其他插件行为不变。
2. Explain 单独安装时两个入口都出现，不要求 selection-chat、suggested-replies 或 Advisor。
3. 选中文字只在 plain 且空草稿时生成 `--selection` 草稿；换行保留、最多 10,000 字符、不自动提交、不覆盖草稿。
4. 选中旧 assistant、tool 结果、用户文本和 Advisor 建议时，来源坐标分别正确；重复文本取最新匹配，无法匹配显示无回合坐标。
5. 每个 finalized assistant action 通过 messageId 固定精确 turn，生成 `--answer` 草稿，不受之后新回合影响。
6. 两种入口提交后分别持久化 `origin: selection/answer`，UI 标签正确，rephrase 保留 origin；旧 suggested 数据继续可读。
7. disabled、来源占用、Topic 活跃、压力不可解、取消和 teardown 返回稳定 Explain 结果且不写部分数据。
8. 两种入口成功、失败和取消都不改变自主调用额度；成功仍更新 explain 用户操作时间。
9. Advisor 未被选择时绝不进入 Explain 请求、observation 或 ExplainContext；被选择后只进入该次 command 和私有来源摘要。
10. 主 Session `deriveMessages()` 在快捷入口提交前后保持不变；只有标准 `command/run` / `command/done` 增量。
11. 全新 profile 只安装 Explain 即通过双入口、assembled Web、卸载和重新安装测试；配置中没有三个外部插件。
12. 用户可完成「选中文字或点击回答 → 检查并提交草稿 → 学习 Tab 查看 → ✗ 重讲 → ✓ 掌握」真实模型闭环，并在合入 PR 中保存 GIF 与精确提交证据。

## M5：主动学习命令

> 状态：**设计、实现与自动化门禁完成；真实模型证据随合入 PR 保存**（2026-08-13）。

### 目标

用户无需等待自主选题，可直接在当前工作 Session 的 composer 输入 `/explain <学习请求>`，把一次显式学习目标交给 explain agent。命令生成一条进入全局学习线程、等待 ✓ / ✗ 的讲解，不进入主 Agent 请求，也不改变全局线程、按来源活跃门、Topic 全局门和辅助模型单飞不变量。

### 宿主路径核验

DSH command runtime 已把带 `input.hint` 的命令公开给 composer slash discovery，并在 handler 前后写入标准 `command/run` / `command/done`。命令结果不会进入主 Agent 历史。因此 M5 只扩展现有 `/explain` definition 和 host Scheduler，不新增输入框组件、Remote 方法、Session 自定义事件或 UI 宿主。

### 设计

- 精确输入 `on`、`off`、`status` 保持现有管理语义；其他规范化后的非空文本是一条主动学习请求，空参数返回包含两类用法的帮助。
- handler 从当前 Session 捕获最近一个合格 completed turn 的有界 assistant/工具上下文；没有合格回合时以 `turn = 0` 表示空白来源。命令文本按 `maxSourceChars` 限制，模型展示语言跟随请求。
- 主动工作进入同一个 Scheduler，优先于尚未开始的 rephrase、自主候选和 idle 压缩。新请求可取消后台自主生成或 idle 压缩，但不抢占已在途的主动请求或 rephrase。
- 每来源最多一个活跃或待处理主动讲解；模型必须返回完整 explanation，不能 skip。提交时原子复核来源槽和全局 Topic 活跃门；显式请求可以让已掌握但当前不活跃的 Topic 重新进入 learning。
- 主动请求读取最新 `ExplainContext`、未压缩尾部和实时 Topic/活跃覆盖层，执行同一 50% 压力门、全局单飞、超时、租约和 epoch fencing；它不写自主预算表。
- revision 1 payload 使用可选 `origin: 'manual'`，Remote 投影为“主动请求”。旧 payload 没有 origin 时保持自主语义；SQLite schema 不变。空白来源的 turn 0 不在 UI 显示。
- 成功 explanation 保存固定上限的私有来源摘要供后续 ✗ 重讲；完整命令本身由来源 Session 的标准 command 日志拥有，主模型 `deriveMessages()` 不包含它。

### 实现前审查结论

- **兼容性**：只把过去的无效 `/explain <其他文本>` 空间变为有效请求；三个管理子命令和 Remote 均不变。
- **优先级**：显式请求不能插入正在生成的另一条显式请求或重讲，否则 command 的等待与反馈目标会失去可预测顺序；只抢占可安全重排的后台自主/idle 工作。
- **原子性**：入队前 gate 只提供快速失败，最终提交仍在 SQLite 事务中复核来源、Topic 与 lease，避免模型在途期间的竞争结果落库。
- **预算**：主动请求由用户显式发起，不消耗防后台烧 token 的自主额度；它仍可能产生 provider 成本，并受开关、路由、压力、超时与单飞约束。
- **取消与生命周期**：command signal、off、设置语义变化、lease 丢失和 teardown 都能结算请求；队列项移除监听器，迟到模型结果不能提交。
- **压缩抢占**：主动请求取消 idle 压缩后清除该 generation 的 attempted 标记，使被抢占的 dirty 批次仍可在后续 idle 周期重试。
- **隐私与主 Agent 隔离**：模型只看到有界请求、最近来源 capsule 和 explain 私有上下文；SQLite 不新增完整转录，command 输入不会成为主模型 message。

### 验收标准

1. composer discovery 显示 `/explain` 及 `<request> | on | off | status` 提示；管理子命令行为不回归。
2. enabled 且路由可用时，`/explain <request>` 从有历史或空白 Session 成功创建 `origin: manual` 的活跃讲解；空白来源不显示 turn 0。
3. 讲解读取 ExplainContext、不能 skip，并在来源/Topic 竞争时不提交部分数据。
4. 同时存在主动、自主、重讲或压缩时 adapter 最大并发为 1；主动请求按设计优先，取消和 off 返回稳定结果。
5. 成功、失败和取消均不改变滚动 24 小时自主额度；成功会更新 explain 用户操作时间。
6. command 生命周期保留原始请求，主 Session `deriveMessages()` 不变；typed Remote 不泄露私有来源摘要。
7. 单元/Host 集成、类型、构建、keyless assembled Web 与真实模型 GIF 均基于同一候选提交通过。

## M4：内测可控性（已完成）

> 状态：**M4 实现与自动化门禁完成，进入真实模型候选验收**（2026-08-13）。P0 行为和证据分别见 [PRD](./PRD.md) 与 [验收矩阵](./ACCEPTANCE.md)。

## 目标

M4 让内测用户不编辑 YAML、不了解插件内部结构也能完成三件事：配置并启用学习模式，理解当前是否正常运行，从一条讲解回到对应的来源会话。M4 不改变“一条全局学习线程、每来源至多一个活跃讲解、辅助模型全局单飞、主 Agent 不感知 explain”四个 P0 不变量。

## 已确认的宿主能力

| 需求 | DSH 第一方能力 | 使用约束 |
|---|---|---|
| 独立设置页 | `settings.section` 槽位 | 插件注册自己的页面和文案，不修改设置壳层 |
| 打开来源会话 | `ctx.sessions.open(SessionId)` | 只调用公开 Session 服务，不读取 conversation 私有 store 或操作 DOM |
| 启用与状态 | 现有 `explain.setEnabled()`、`status()` 和 settings namespace | 业务失败保留稳定 code；设置变化继续走 scheduler epoch fencing |
| 模型路由 | `ctx.llm.listProviders()`、`listModels()` 与 `resolveModelInfo()` | provider 和 advisory model 列表来自宿主；未列出的模型 id 只有在宿主能解析出精确容量时才可启用 |

## 范围

### 1. 学习设置页

在 DSH 设置中注册「学习」页面，提供：

- 全局启用开关；开启前沿用现有模型路由与 `contextWindow` 校验，失败时保持关闭并显示稳定错误。
- 一个 provider/model 路由选择；provider 与建议模型来自 DSH 能力目录。适配器允许未列出模型时可以显式输入 id，但开启前仍必须由 `resolveModelInfo()` 解析出精确 `contextWindow`。
- 每 24 小时自主请求上限；显示已用额度和最早恢复时间。
- 只读运行诊断：`runtimeState`、路由是否可用、当前上下文压力、活跃讲解数、候选数、最近 explain 操作、最近压缩和最近稳定错误。

M4 只在 UI 中开放启用、模型路由和自主预算。超时、重试、来源字符上限、压缩阈值等高级调优仍保留在 composition/settings 配置中，避免把内部防护参数变成普通用户负担。

### 2. 来源会话导航

- explanation 卡片和对应历史记录在来源 Session 仍存在时提供「打开来源会话」。
- 点击后调用 `ctx.sessions.open(sourceSessionId)`；学习数据仍由全局 store 拥有，不复制、不迁移，也不改变目标 Session 的 view 选择。
- 当前已经是来源 Session 时不显示重复导航动作。
- 来源 Session 已删除或当前 inventory 不可见时，记录继续可读并明确显示“来源会话不可用”，不得抛出未处理错误或隐藏历史。
- feedback 与 topic-reopen 审计行沿用其来源坐标；没有来源坐标的记录不显示导航动作。

### 3. 可诊断的学习视图

- 区分关闭、路由未配置、运行失败、额度耗尽和正常等待五种状态，不把它们都呈现为空历史。
- 额度耗尽时显示最早恢复时间；上下文压力存在时显示百分比与最近压缩时间。
- 设置页和学习视图读取同一个 browser-wide store；Session 切换不得产生两份状态或额外 long-poll。
- Remote 传输失败继续保留已缓存历史，并提供显式重试。

### 4. 内测发布收尾

- 在私有 hub 的 `catalog.source.json` 登记插件分类和本地目录安装方式。
- 更新 keyless assembled Web snapshot，覆盖设置页、来源跳转和来源缺失降级。
- 当时使用 DSH 0.1.2-alpha.3 和真实模型重新录制完整学习循环 GIF；记录插件提交、DSH 提交和素材哈希。

## 非目标

- 不引入 better-sidebar，不恢复行内讲解，也不自动切换或抢占学习视图。
- 不观察子代理，不补扫历史 Session，不改变候选选择、TopicKey 精确去重或全局单飞策略。
- 不做课程、测验、卡片、复习计划、语义搜索、云同步或跨设备用户身份。
- 不在 M4 提供导入、导出、全量清空、逐条删除或 `ExplainContext` 人工编辑。这些能力涉及持久格式、破坏性事务和推断证据语义，作为独立迭代设计。

## 实施顺序

| 阶段 | 内容 | 完成条件 |
|---|---|---|
| M4.1 设置与协议 | 定义可编辑设置 DTO、settings revision/CAS、模型候选读取和设置页 | 无 YAML 的全新 `$DSH_HOME` 可选择路由、启用、关闭并诊断失败 |
| M4.2 来源导航 | 注入公开 Session 服务、建立 inventory 判定和卡片动作 | 存在来源可打开；已删除来源稳定降级；全局线程状态不变 |
| M4.3 产品验收 | 单元/集成、keyless Web snapshot、真实模型 GIF、hub 登记 | 下列验收标准全部通过，文档和演示对应同一候选提交 |

## 实现设计

### 设置协议与并发

Host Remote 增加三个方法：`configuration()` 返回当前 UI 可编辑字段及 DSH settings namespace 的原生 revision；`modelCatalog()` 返回当前 provider 和建议模型目录；`updateConfiguration()` 携带 `expectedRevision`，只合并 `enabled/provider/model/maxAutoRequestsPerDay` 四个 UI 字段。写入调用 DSH settings 的原生 expected-revision CAS，不复制第二套 revision，也不整体替换 user section，因此 composition base 和高级设置不会被设置页清除。

开启或在已开启状态下切换路由时，Host 在 CAS 写入前解析目标 provider/model，并要求精确 `contextWindow`。CAS 冲突返回 `SETTINGS_STALE`，路由问题沿用 `MODEL_ROUTE_REQUIRED` / `MODEL_CONTEXT_REQUIRED`，schema 或字段错误返回 `INVALID_SETTINGS`，其他失败返回 `RUNTIME_FAILED`；失败不写入部分配置。成功写入后 Runtime 立即从 settings scope 同步 Scheduler，再向客户端返回新的 configuration 和 status。

模型目录只提供选择建议，不参与路由授权。未列出的 model id 可由用户输入，但启用时必须通过相同的精确容量解析。provider 拓扑变化提高 view cursor；已打开设置页会重新读取目录。

### 单一 browser store

插件 apply 仍只创建一个 `GlobalLearningStore`。学习视图和设置页分别增加/释放 mount 引用；第一个 mount 启动 refresh/watch，最后一个 unmount 取消 long-poll。configuration 随每次全局 refresh 读取，模型目录只在设置页首次打开后加载，并在后续 cursor 变化时刷新，避免单纯阅读学习线程触发目录查询。

设置提交状态和业务错误是 store 的独立字段，不覆盖 Remote 传输错误；传输错误保留已缓存历史、configuration 和目录。过期写入先显示稳定冲突，再刷新到胜出的 revision，不把旧草稿静默覆盖回 Host。

### 来源可达性

`LearningView` 订阅 `ctx.sessions.list`，以 `byId[sourceSessionId]` 是否存在作为当前浏览器可见 inventory 的唯一判定。来源不是当前 Session 且仍存在时渲染跳转动作；点击前再次读取 inventory，再调用 `ctx.sessions.open(sourceSessionId)`。来源缺失时保留讲解、反馈和重讲记录，显示不可用说明；当前 Session 不显示重复动作。插件不自行查询 Session 文件、不操作 conversation store，也不改变目标 Session 的 view 选择。

### 诊断状态优先级

学习视图和设置页使用同一个纯派生顺序，避免同一状态显示两种解释：`disabled` → `runtime failed` → `route not configured` → `budget exhausted` → `ready/waiting`。额度耗尽显示 `autoRequestsResumeAt`；压力只在 `estimatedContextRatio` 存在时显示；最近 explain 操作和压缩时间缺失时明确显示“尚未发生”。Remote 失败作为更高层的连接错误单独呈现，同时继续显示缓存内容。

## 实现前审查结论

- **并发**：复用 settings provider 的串行写队列和原生 revision，避免插件 revision 与真实文档漂移；不同浏览器的 stale 写入不会覆盖胜者。
- **原子性**：UI 四字段作为一次 merge patch 提交；启用校验、schema 校验或 CAS 失败均不改变 user section。高级字段不在 patch 中，因而不会被 UI 删除。
- **生命周期**：两个 slot 注册都使用 `slots.inject()`；一个共享 store 由引用计数控制 watch，slot collapse/redeclaration 不产生第二条 long-poll。
- **来源竞态**：渲染时与点击时各检查一次 inventory；两次检查之间仍可能删除，`sessions.open()` 的同步失败由 UI 捕获并降级为可重试错误，不产生未处理异常。
- **主工作隔离**：新增读写只涉及 explain settings、plugin Remote 和 client navigation；不写 Session 日志，不改变 `deriveMessages()`，不向主 Agent 注入 ExplainContext。
- **模型目录**：建议列表可能为空或查询失败，不阻止手工输入 model id；真正的安全条件仍是 Host 对目标路由的精确容量解析。
- **数据格式**：M4 不修改 SQLite schema 或 entry payload，不需要迁移，也不扩大持久隐私数据。

## 验收标准

1. **无文件配置启动**：全新临时 `$DSH_HOME` 中，用户只通过设置页选择有效模型并开启 explain；下一次合格顶层回合可产生讲解。
2. **无效路由不启用**：缺少 provider/model 或精确 `contextWindow` 时开启失败，设置页与 `/explain status` 显示同一稳定原因。
3. **设置并发收敛**：两个浏览器视图基于同一 settings revision 更新时，过期写入被拒绝并刷新，不静默覆盖较新的配置。
4. **关闭保持历史**：关闭会取消在途辅助工作并停止新候选，已有学习线程和 `ExplainContext` 继续可读。
5. **额度透明**：额度耗尽后不发送自主请求；设置页和学习视图显示已用/上限及恢复时间，用户触发重讲仍不占额度。
6. **来源可达**：从当前会话以外的讲解打开仍存在的来源 Session；切换后再次进入「学习」看到同一 thread revision。
7. **来源删除降级**：删除来源 Session 后讲解、反馈和重讲历史继续可读，导航动作变为不可用说明且没有浏览器错误。
8. **宿主生命周期**：`settings.section` 与 Session 服务晚注册、collapse 和 redeclaration 时，贡献正确建立、移除和恢复，无重复注册或悬挂订阅。
9. **主工作隔离**：设置、诊断和导航不改变主 Session 日志、`deriveMessages()` 或主 Agent 请求。
10. **测试伴随**：相关单元/集成测试、keyless assembled Web snapshot、当时的 DSH 0.1.2-alpha.3 真实模型流程和 GIF 在同一变更中通过并可追溯。

## M4 后的候选顺序

1. **本地数据治理**：版本化导出、确认式全量清空、在途请求 fencing、设置保留策略和恢复说明。
2. **ExplainContext 校正**：查看证据、删除错误偏好、重新生成上下文，并定义用户修正与模型推断的优先级。
3. **检索与复习**：只有在线程规模和内测反馈证明需要后，再评估搜索、语义去重、卡片或复习工作流。
