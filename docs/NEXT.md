# dsh-explain M4 迭代计划：内测可控性

> 状态：**计划完成，尚未进入实现**（2026-08-13）。P0 行为和证据分别见 [PRD](./PRD.md) 与 [验收矩阵](./ACCEPTANCE.md)。

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
