# dsh-explain 迭代计划

## M6：P1 可选插件集成

> 状态：**Explain Host 协议已实现并通过自动化门禁，消费方插件待接入**（2026-08-13）。设计基线为 `dsh-explain@f66051d`、`dsh-selection-chat@878bd59`、`dsh-suggested-replies@66d5e36` 与 `dsh-advisor@068c511`。

### 目标

把主动 Explain 入口接到三个已经存在的用户工作流中：选中对话文字后请求解释、在预测回复旁选择学习刚完成的回答、选中 Advisor 的可见建议后理解其概念和依据。三个入口最终都生成可编辑的 `/explain` 草稿，由用户再次提交；它们不自动调用模型、不占自主额度，也不改变主 Agent 历史。

### 集成原则

- `dsh-explain` 继续独占全局学习线程、ExplainContext、Topic 门、来源槽、调用预算和辅助模型 Scheduler。其他插件不读取 SQLite、typed Remote 私有 DTO 或 ExplainContext。
- 插件是否安装通过当前 Session 的 DSH `command.list` 结果判断；只有目录中存在 `explain` 时才显示集成入口。不从 DOM、package list、插件 id 或远端仓库状态猜测。
- 入口只调用公开 composer 写入路径并设置草稿，不自动 `submit()`。composer 不是 `plain` 或已有非空草稿时拒绝覆盖并显示稳定提示。
- 所有模型调用仍从 `/explain` command handler 进入同一个 manual 队列。集成本身不创建第二个 Remote 写入口、Session 自定义事件或后台模型调用。
- 任一插件缺失、停用、热卸载或命令目录刷新时，其增强入口独立消失；`/explain <请求>`、自主讲解和学习 Tab 保持可用。

### 1. `dsh-selection-chat`：选中内容后解释

`dsh-selection-chat` 在现有选区工具条增加「解释」动作。工具条打开时按当前 `sessionId` 调用 `remote.commands.list()`；目录中没有 `explain`、查询失败或当前选区不合格时不显示动作。点击后把空 composer 设置为：

```text
/explain --selection <规范化后的选中文字>
```

选区仍受 `dsh-selection-chat` 的单消息容器、单次消费和 10,000 字符上限约束。动作不复用现有 `[quoted]` 格式，因为 slash command 必须占据完整草稿；非空草稿不得被静默覆盖。

`dsh-explain` 增加封闭的 `--selection` 手动来源。handler 以选中文字作为显式学习请求，并从当前 Session 事件中逆序查找包含该规范化文字的最新消息：assistant/tool 结果使用其 turn，user 或其他 context 消息使用其前一个合格 completed turn；重复文本取最新匹配。找不到可靠坐标时使用 `turn = 0`，UI 不伪造回合号。匹配只决定有界来源 capsule，选中文字本身始终进入 command 日志并作为请求事实。

revision 1 payload 的可选 `origin` 扩为 `manual | selection | suggested`；旧 payload 缺失 origin 仍表示自主来源，SQLite schema 不变。学习界面把 selection 显示为「选中解释」。

### 2. `dsh-suggested-replies`：学习建议气泡

`dsh-suggested-replies` 在 ready 候选行末尾增加一个确定性附件气泡「学习刚才的回答」。它不修改模型要求的 `suggestionCount`，不写入 suggested-replies sidecar，也不触发额外候选模型调用。当前 Session 的命令目录存在 `explain` 且 sidecar ready 状态仍对应当前已结束 turn 时才显示；点击把空 composer 设置为：

```text
/explain --suggested <来源回合> 请解释刚才回答中最关键、最值得学习的概念。
```

文案随客户端语言本地化，模型最终表达仍跟随请求语言。候选生成时的精确 turn 写入草稿，`--suggested <turn>` 不在提交时重新猜测“最新回合”，避免草稿停留期间新 turn 完成导致来源漂移。显式快捷入口可定位 `completed` 或 `max-tokens` 结束回合；自动 Observer 仍只接受 `completed`。指定 turn 不存在或不合格时返回 `EXPLAIN_SOURCE_UNAVAILABLE`，不退回其他回合。其余沿用 manual 优先级、来源/Topic 原子门、50% 压力门和自主预算豁免；payload 记录 `origin: suggested`，学习界面显示「学习建议」。

### 3. `dsh-advisor`：显式解释建议

P1 不让 explain 订阅 Advisor runtime，也不改变 Advisor 的 `inject/steer` 路由。Advisor 建议已经作为带 `source.kind = advisor` 的可见、可持久化 context 消息呈现；用户可用 `dsh-selection-chat` 选中建议正文，再走同一个 `--selection` 入口。

该用户手势是唯一桥接授权：普通 Observer 继续只接受真实用户消息和当前 turn 的 assistant/tool 内容，Advisor 消息不会自动成为自主候选、ExplainContext observation 或 Topic 状态。`--selection` 的显式文本可以进入 Explain Agent，但不会回写或影响 Advisor，也不会被注入主 Agent。P1 不修改 `dsh-advisor` 代码；它只进入四插件组合验收矩阵。

### 调度、预算与隐私

- selection/suggested 都是现有 manual 工作的来源变体，优先级、抢占、取消、租约和全局单飞语义不增加新分支；同一 Session 的 pending/active gate 在模型调用前和提交事务中各检查一次。
- 两个快捷入口均不占 `maxAutoRequestsPerDay`；用户真正提交命令后才可能产生 Explain 模型成本。
- 安装 Advisor 与 suggested-replies 本身仍可能使一个 completed turn 分别产生各自的后台调用；M6 不引入跨插件全局模型仲裁器。集成代码必须证明没有在这些既有调用之外再发请求，并在组合文档中明确成本叠加。
- 选中文字最多 10,000 字符，之后仍经过 explain `maxSourceChars`；持久化 `sourceSummary` 继续使用固定 2,000 字符隐私上限，不保存完整 assistant、工具参数、工具结果、reasoning 或绝对路径。
- 其他插件只看 command 名称与自身已有状态；ExplainContext、学习历史、反馈、Topic 和模型路由不跨插件暴露。

### 跨仓库实施顺序

| 阶段 | 仓库 | 修改 | 完成门 |
|---|---|---|---|
| M6.1 | `dsh-explain` | 先定义 `--selection` / `--suggested <turn>` 解析、来源定位、origin 投影和稳定失败 | **已完成**：command/主消息隔离、精确来源匹配、旧 payload 兼容和 Scheduler 测试通过 |
| M6.2 | `dsh-selection-chat` | 命令目录发现、Explain 动作、空草稿保护和本地化 | explain 缺失时无动作；存在时只填草稿；选区/忙态/热卸载通过 |
| M6.3 | `dsh-suggested-replies` | ready 行附件气泡、命令目录发现和草稿保护 | 不改变模型候选数/sidecar/调用数；点击只填携带精确 turn 的 `--suggested` 草稿 |
| M6.4 | `dsh-explain` | 合入两个已发布的集成行为、更新 PRD/Architecture/README 和组合 fixture | 单插件、任意两插件、四插件组合均可启动和卸载；无私有数据耦合 |
| M6.5 | 四插件组合 | 真实 Advisor 建议选择、学习建议、普通选择、反馈闭环与 GIF | 同一候选提交上完成真实 DSH Web、真实模型、数据库与主 Session 证据 |

这些仓库相互独立，不建立跨仓库 PR stack。先合入 explain 的命令协议，再分别合入两个 UI 消费方，最后回到 explain 完成组合验收；消费方在协议提交合入前用精确 SHA 进行测试，不能跟随移动的 `main`。

### 审查结论

- **不使用插件私有 API**：两个 UI 插件只依赖 DSH command/composer 公共能力；不需要 npm 运行依赖、复制源码或读取对方文件。
- **不自动发送**：选区和建议气泡只形成可检查、可编辑的草稿，避免误触直接产生模型成本。
- **不伪造来源**：选区无法映射到可靠事件时明确降级为无回合坐标，不能把当前最新 turn 冒充被选择的旧消息。
- **不让 Advisor 污染 ExplainContext**：只有用户显式选择的 Advisor 文字进入一次 manual 请求；自动观察路径保持隔离。
- **不复制权威状态机**：UI 不预判 Topic、来源槽或 Scheduler 竞争；Host 的双重 gate 决定最终结果。
- **不让草稿制造 TOCTOU**：suggested 草稿携带候选对应的精确 turn；提交后 Host 只读该 turn，无效时明确失败。
- **无 DSH 核心修改**：当前 `command.list`、composer input facade、`conversation.input.dock` 和 context 行可选文本已足够；P1 不增加核心 slot。

### 验收标准

1. explain 未安装时，selection-chat 和 suggested-replies 都不出现 Explain 入口，普通功能不变。
2. explain 已安装时，两个入口使用当前 Session 的 command 目录发现，不依赖加载顺序；命令目录失效后能收敛。
3. 选中文字只在单消息合法选区、plain 且空草稿时生成 `--selection` 草稿；不自动提交、不覆盖草稿。
4. 选中旧 assistant、tool 结果、用户文本和 Advisor 建议时，来源坐标分别正确；重复文本取最新匹配，无法匹配显示无回合坐标。
5. suggested 附件不占模型候选数量、不进入其 sidecar，且不增加 suggested-replies 或 Explain 的后台调用；草稿固定候选生成时的精确 turn，不受之后新回合影响。
6. 两种入口提交后分别持久化 `origin: selection/suggested`，UI 标签正确，rephrase 保留 origin。
7. disabled、来源占用、Topic 活跃、压力不可解、取消和 teardown 返回稳定 Explain 结果且不写部分数据。
8. 两种入口成功、失败和取消都不改变自主调用额度；成功仍更新 explain 用户操作时间。
9. Advisor 未被选择时绝不进入 Explain 请求、observation 或 ExplainContext；被选择后只进入该次 command 和私有来源摘要。
10. 主 Session `deriveMessages()` 在快捷入口提交前后保持不变；只有标准 `command/run` / `command/done` 增量。
11. 四插件同时启用时各自单插件测试、assembled Web snapshot、组合/HMR/卸载测试和总调用计数断言通过。
12. 用户可完成「选中 Advisor 建议 → 解释 → 学习 Tab 查看 → ✗ 重讲 → ✓ 掌握」真实模型闭环，并以私有 GIF 留证。

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
- 使用当前 DSH 0.1.0-rc.6 和真实模型重新录制完整学习循环 GIF；记录插件提交、DSH 提交和素材哈希。

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
10. **测试伴随**：相关单元/集成测试、keyless assembled Web snapshot、真实 DSH 0.1.0-rc.6 模型流程和 GIF 在同一变更中通过并可追溯。

## M4 后的候选顺序

1. **本地数据治理**：版本化导出、确认式全量清空、在途请求 fencing、设置保留策略和恢复说明。
2. **ExplainContext 校正**：查看证据、删除错误偏好、重新生成上下文，并定义用户修正与模型推断的优先级。
3. **检索与复习**：只有在线程规模和内测反馈证明需要后，再评估搜索、语义去重、卡片或复习工作流。
