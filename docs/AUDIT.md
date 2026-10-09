# 整体方案审查与优化建议（2026-10-09）

审查基线：Explain `4bd96f52f8a28fcd27d8ba3316fd5e6452d1f556`（[PR #51](https://github.com/yuezengwu/dsh-explain/pull/51)）。本报告结合当前产品文档、运行时代码、回归测试和已完成的 CI；静态风险与待验证建议不代表已复现的线上故障。

## M29 实施进展（2026-10-09）

本报告的原始审查基线保持不变。M29 已实现候选结束与淘汰后的身份释放、retry/defer 容量控制，以及共享兼容清单和 CI 一致性门禁；修改前后合成测量见 [来源队列规模验证](./QUEUE_SCALE.md)，当前验收见 [验收矩阵](./ACCEPTANCE.md)。完整历史导出、固定教学样例、成本可见性和模块拆分仍是后续建议，不能将队列测量扩展为这些能力已优化。

## 结论与目标

项目目标是把已完成工作中的知识差距转化为「捕获 → 讲解 → 复习 → 校正」的本地学习闭环。判断成功应看用户能否在之后回忆、应用和辨析概念，而不仅是生成了多少卡片。

当前方案与目标一致：主 Agent 负责工作，Explain 使用独立辅助模型；同一个 `$DSH_HOME` 共享一条学习线程，每个来源可独立等待反馈。SQLite、全局单飞、来源与 Topic 门、版本化导出、用户可校正画像构成了完整基础。后续应优先验证长期规模、学习效果与模型成本，再按测量结果优化；现有证据不足以宣称提升了真实用户的学习效果。

## 方案与代码证据

| 责任 | 当前实现与证据 | 应保留的不变量 |
|---|---|---|
| 来源读取 | `observer.ts` 使用固定历史切面与异步分页；`index.ts` 在读取后检查运行代次。`observer-history.spec.ts` 覆盖取消、无进展页面和旧宿主 packed chunks。 | 仅捕获合格或显式选定的来源，不把迟到读取结果重新写回已清除的数据。 |
| 候选与调度 | [CandidateQueue](https://github.com/yuezengwu/dsh-explain/blob/4bd96f52f8a28fcd27d8ba3316fd5e6452d1f556/src/queue.ts#L12) 按来源 latest-wins；[scheduler](https://github.com/yuezengwu/dsh-explain/blob/4bd96f52f8a28fcd27d8ba3316fd5e6452d1f556/src/scheduler.ts#L397) 用一个 drain 串行 await 各类模型任务。 | 每来源最多一个活跃讲解、辅助模型全局单飞；关闭与清除拦截旧代次提交。 |
| 调用与成本 | `explainer.ts` 独立组装请求、检查停止原因、拒绝工具调用并严格解析 JSON；[调用占额](https://github.com/yuezengwu/dsh-explain/blob/4bd96f52f8a28fcd27d8ba3316fd5e6452d1f556/src/store.ts#L474) 在自主请求发出前持久化。 | 不隐式借用主模型；自主请求的失败与重试计数，重启不能重置额度。 |
| 持久化与并发 | `store.ts` 使用 SQLite 事务、revision CAS、运行租约与 fencing；`gateway.ts` 提供 typed Remote。 | 保留 schema 4 / backup v3；反馈、清除和迟到模型结果不能互相覆盖。 |
| 上下文压缩 | `compactor.ts` 对完整请求估算容量、逐步缩小批次，成功后才提交 checkpoint。`learning-regressions.spec.ts` 覆盖压缩失败停泊、长历史和多来源。 | 压缩不删除原始学习历史，不覆盖实时 Topic/反馈，不进入主 Agent。 |
| 学习与画像 | `store.ts` 的复习排期、题型进阶、答案评估及画像审计，与 `LearningView.tsx` 的用户操作连接。 | 显式偏好优先于修正，修正优先于模型推断；模糊/遗忘允许继续学习。 |
| 隐私 | [来源摘要](https://github.com/yuezengwu/dsh-explain/blob/4bd96f52f8a28fcd27d8ba3316fd5e6452d1f556/src/store.ts#L2417) 限制用户文本和工具名；`privacy.ts` 过滤常见凭证与本地路径；公开导出排除内部来源摘要。 | 不保存完整工作转录、工具参数、工具结果或 reasoning。自由文本过滤不是完整脱敏保证。 |

## 验证状态与边界

| 项目 | 已有证据 | 不能由此推导的结论 |
|---|---|---|
| 发布包与固定源码 | [基线主分支 CI](https://github.com/yuezengwu/dsh-explain/actions/runs/37168022366) 18/18：一个发布包 job 和十七个固定源码宿主；每宿主 90 项单元/集成测试，并执行 Web/M6 组装。 | 不代表所有未来 DSH 版本、桌面端或真实 provider 已通过。 |
| 新 alpha 本地验收 | [M28 验收记录](./ACCEPTANCE.md)：frozen install、构建、pack、8 个 Web、3 个 M6；同一发布依赖插件 tarball 安装。 | 无密钥 fixture 不证明实际教学质量或账号模型可调用。 |
| 真实模型 | [2026-09-15 验收](./REAL_MODEL_ACCEPTANCE.md)：DSH 0.1.6-alpha.1、公开样例、指定官方模型，覆盖学习闭环。 | 旧宿主的一次真实验收不能自动转移到 0.2.0/0.2.1 或其他模型。 |
| 版本渠道 | 2026-10-09 核对：CLI `latest/next=0.2.0-rc.2`，`alpha=0.2.1-alpha.1`；官方精确 SHA 与 [兼容约定](./COMPATIBILITY.md) 一致。 | Explain `main` 支持新宿主，不等于最新标签 `v0.3.1` 已包含适配；该标签的支持范围截至 DSH 0.1.6-alpha.2。 |
| 社区与收录 | DSH Directory、dshmarket、Plugin Hub 已渲染 alpha README；[metadata #2336](https://github.com/dsh-pluginmarket/metadata/pull/2336) 和 [52DSH #2](https://github.com/tuofangzhe/dsh-plugins/pull/2) 仍开放。 | 页面 README 刷新不代表版本化 metadata 已合并，也不代表独立安全审查或作者认领完成。 |

本轮交付是审查报告和迭代计划修正。上述运行时证据属于对应基线和验收日期；本轮提交的最新 CI 结果以其 PR 与合并后 main run 为准，不把历史检查转移为新提交的检查结果。

## 改进优先级与验收条件

### P0：修正维护记录的一致性（本轮完成）

`ACCEPTANCE.md` 与 `COMPATIBILITY.md` 已记录 M28，但 `NEXT.md` 仍从 M27 开始，且发布收尾段落指向旧 M22。补齐 M28、修正兼容记录入口，并让中英文 README 能发现本报告。保留旧里程碑的当时版本与验收范围。

### P1：先验证长期运行的规模

两处静态风险需要测量：

- `CandidateQueue.pending` 有容量限制，但 `latestSequence` 为见过的来源保留序号，普通 take/淘汰不会删除，直到 `clear()`。来源频繁更替时，容量限制不等于整个队列对象的内存上界。
- [exportData()](https://github.com/yuezengwu/dsh-explain/blob/4bd96f52f8a28fcd27d8ba3316fd5e6452d1f556/src/store.ts#L939) 用同步 SQLite `.all()` 读取完整历史，再映射和脱敏。单条文本有界，但历史总量持续增长，导出可能产生内存峰值和事件循环阻塞。

本次在 Node 24.20.0 中直接导入基线 `CandidateQueue`，用 10,000 个不同的合成来源、容量 8 调用 `push()`：`pending=8`，`latestSequence.size=10000`；`clear()` 后两者均为 0。这确认了序号保留行为，不是生产内存故障的复现，也没有测量堆字节数或导出性能。

先用完全合成数据测量 1,000/10,000 个不同来源和不同历史量级的堆占用、导出时长、事件循环延迟，并记录基线。若回收来源序号，必须覆盖在途候选、latest-wins、retry、defer 和取消，不能破坏迟到结果拦截；若调整导出，保持 backup v3 的完整公开投影与一致性。当前没有高负载线上复现或已测量的性能改进结果，不静默截断、删除用户历史。

### P1：减少兼容清单的重复维护

同一宿主集合分别出现在 CI matrix、源码链接门禁、peer 声明、组装测试版本分支和文档中。M28 记录遗漏说明人工同步容易漂移；维护风险与运行时不兼容应分别报告。

下一步可引入一个小型、仓库内的「版本 → 精确 SHA → 能力差异」清单，并增加静态一致性检查。优先校验现有清单，再考虑生成配置。验收时保留全部十七个已支持宿主、精确发布包补丁和旧版本快照；不得从 npm `latest` 自动扩大兼容承诺，也不得因 CI 变慢直接删减旧宿主。

### P1：用学习结果评估产品

现有 [reviewDashboard()](https://github.com/yuezengwu/dsh-explain/blob/4bd96f52f8a28fcd27d8ba3316fd5e6452d1f556/src/store.ts#L970) 提供到期、完成、薄弱与近期结果，能够呈现流程，但不构成学习效果研究。

先建立公开概念的固定质量样例：回忆、应用、辨析各自给出正确、部分正确和错误答案，检查模型评价、反馈语言与复习排期；同时核对多次压缩后摘要是否保持用户修正与证据来源。之后如开展用户试用，再明确同一概念的 7/30 天复习完成率与正确率分母、缺失数据和样本量。使用用户自愿提供的脱敏样例，保持本地记录；不以卡片数量或「懂了」点击数替代长期掌握率，不新增默认遥测。

### P2：把模型成本和失败原因变得更清楚

默认 50 次/滚动 24 小时限制针对自主判断；主动讲解、重讲、复习与压缩仍会产生辅助模型调用。token 估算用于容量控制，既不等于 provider 精确 usage，也不是金额预算。

优先用现有 status、generation/usage 和错误码评估能否呈现按用途的本地调用概况。失败请求缺少 usage 时明确标为未知；不推测账单，不记录原始请求或响应。验收包括额度耗尽、取消、超时、无 usage 与压缩失败，界面应说明原因和已有恢复入口，同时保留当前成本与隔离语义。

### P2：按职责逐步拆分大模块

基线中 `store.ts` 2,626 行、`scheduler.ts` 880 行、`LearningView.tsx` 699 行，分别同时承担多个业务职责。规模本身不证明缺陷，但会增加后续修改的理解与回归成本。

先拆纯函数和查询投影，保留 store 作为事务边界；再提取复习、画像与导出子模块，保持 typed Remote 外观。不要先增加服务层、外部存储或数据库迁移。验收保留 CAS、fencing、清除期间迟到结果、复习幂等、压缩与旧宿主的回归，禁止用仅镜像实现的测试替代行为测试。

## 推进顺序与发布边界

1. 完成本轮文档修正与审查报告，通过当前提交 CI，合并并同步主分支。
2. 优先完成合成规模基线和兼容清单一致性检查，再依据证据决定具体运行时优化。
3. 完成固定教学样例与压缩质量验证；真实模型验收单独记录准确宿主、provider、模型、代码 SHA 和可复现结果。
4. 新 Explain 标签属于独立发布动作。当前维护保持 `main` 与 `v0.3.1` 的区别；明确发布后才执行标签、发布 CI 和不可变安装验证。外部目录仍只跟进已有记录，有实质结果再更新。

建议不扩展当前产品范围到云同步、多用户托管、课程平台、外部 RAG 或其他 memory 插件的私有数据。详见 [PRD](./PRD.md) 的非目标与 [架构约定](./ARCHITECTURE.md)。
