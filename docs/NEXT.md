# dsh-explain M4 迭代计划：内测可控性

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
- 使用当前 DSH rc.2 和真实模型重新录制完整学习循环 GIF；记录插件提交、DSH 提交和素材哈希。

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
10. **测试伴随**：相关单元/集成测试、keyless assembled Web snapshot、真实 rc.2 模型流程和 GIF 在同一变更中通过并可追溯。

## M4 后的候选顺序

1. **本地数据治理**：版本化导出、确认式全量清空、在途请求 fencing、设置保留策略和恢复说明。
2. **ExplainContext 校正**：查看证据、删除错误偏好、重新生成上下文，并定义用户修正与模型推断的优先级。
3. **检索与复习**：只有在线程规模和内测反馈证明需要后，再评估搜索、语义去重、卡片或复习工作流。
