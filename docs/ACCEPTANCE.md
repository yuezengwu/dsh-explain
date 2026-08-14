# dsh-explain 验收矩阵

本矩阵把 [PRD P0 验收标准](./PRD.md#验收标准) 映射到可重复执行的自动化证据。M2 真实模型与浏览器流程记录在 [PR #2](https://github.com/yuezengwu/dsh-explain/pull/2)，后续用户界面迭代的证据随对应 PR 保存；无密钥门禁不读取用户 `$DSH_HOME`，所有 Session、SQLite 和 profile 数据都位于测试临时目录。

| # | 标准 | 自动化证据 |
|---:|---|---|
| 1 | 关闭零成本 | `scheduler.spec.ts` disabled 测试；assembled Web snapshot 验证 off 时历史只读和反馈按钮禁用 |
| 2 | 来源隔离 | `scheduler.spec.ts` 双来源单飞与同来源停放；`m2-core.spec.ts` latest-wins/source gate |
| 3 | 全局单飞 | `scheduler.spec.ts` 记录 adapter 最大并发为 1，并覆盖自主、重讲和压缩交错 |
| 4 | 反馈隔离 | `store.spec.ts` 只掌握被寻址 Explanation；`client.spec.tsx` 按实体提交反馈 |
| 5 | 跨会话掌握 | `m2-store.spec.ts` 已掌握 TopicKey 在另一来源提交时被抑制 |
| 6 | 重讲一致 | `scheduler.spec.ts` 恢复持久 rephrase 待办并追加同一 Explanation 的 revision 2 |
| 7 | 来源摘要可恢复 | `m2-store.spec.ts` 从 revision 1 私有摘要重建 rephrase target；Remote 分页剥离摘要和工具结果 |
| 8 | 自主预算 | `m2-store.spec.ts` 滚动 24 小时、跨重启占额；`scheduler.spec.ts` 失败重试计数且 rephrase/compaction 豁免 |
| 9 | Topic 标题新鲜度 | `m2-store.spec.ts` 新 revision 更新 Topic 标题与 revision，旧 entry 标题保持不变 |
| 10 | 不活跃压缩 | `scheduler.spec.ts` dirty closed 数据只压缩一次，成功后集合变 clean，且不占自主额度 |
| 11 | 压力压缩 | `scheduler.spec.ts` 先压缩再发送目标请求，并覆盖压缩失败时不占额、不发送目标请求 |
| 12 | 上下文有效 | `m2-core.spec.ts` 严格渲染/解析辅助上下文并证明来源观察不改变 `deriveMessages()` |
| 13 | 原始历史保留 | `m2-store.spec.ts` checkpoint 后原 Explanation 仍由分页返回 |
| 14 | 持久一致 | `store.spec.ts` 权限与活跃状态重启；`m2-store.spec.ts` 重启恢复预算、掌握、历史、coverage 与 ExplainContext |
| 15 | 迟到隔离 | `scheduler.spec.ts` 在途自主请求被 off 取消后不能提交；store lease 测试拒绝旧 generation |
| 16 | 并发反馈 | `store.spec.ts` 两标签竞争同一 revision 只有一个成功；不同来源反馈状态互不覆盖 |
| 17 | 故障透明 | `store.spec.ts` 损坏数据库和未知 schema 拒绝重置；route、模型和压缩失败由 plugin/scheduler 测试覆盖；`client.spec.tsx` 验证 DSH `RemoteResult` 传输失败进入可见错误状态 |
| 18 | 界面一致 | `client.spec.tsx` 当前来源优先和全局缓存；assembled Web snapshot 渲染另一来源活跃卡与全局 Context |
| 19 | 视图约束 | assembled Web snapshot 验证空白 Hero 无学习 Tab，已建立 Session 的学习视图保留 composer |
| 20 | 测试伴随 | `pnpm test`、`pnpm run test:web`、本地目录安装 smoke 与 PR #2 真实模型 GIF |

发布候选运行以下门禁：

```sh
pnpm run typecheck
pnpm test
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run test:web
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run test:m6
pnpm run build
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run dsh:link:check
git diff --check
```

## M4 内测可控性

| # | 标准 | 自动化证据 |
|---:|---|---|
| 1 | 无文件配置启动 | `plugin.spec.ts` 从空 settings namespace 读取 revision 0，并通过一次 Remote 写入启用有效模型；assembled Web 从空 user section 保存设置 revision 1 |
| 2 | 无效路由不启用 | 既有 `setEnabled` route 测试与 `plugin.spec.ts` 的模型容量校验路径；失败结果不改变 settings revision |
| 3 | 设置并发收敛 | `plugin.spec.ts` 验证 stale expected revision 返回 `SETTINGS_STALE`，胜者保持；`client.spec.tsx` 验证冲突后刷新到权威 revision |
| 4 | 关闭保持历史 | P0 disabled 单元测试；assembled Web 在 off 状态展示两条活跃讲解且反馈禁用 |
| 5 | 额度透明 | 设置页 ARIA snapshot 显示已用/上限、恢复时间与压力；Scheduler 预算门禁继续覆盖重讲豁免 |
| 6 | 来源可达 | assembled Web 从学习卡调用公开 Session 服务，实际选中另一个持久来源 Session，再看到同一全局学习线程 |
| 7 | 来源删除降级 | assembled Web 同时预置一个不存在于 inventory 的来源，讲解保留并显示“来源会话不可用”，浏览器无未处理错误 |
| 8 | 宿主生命周期 | 两个 UI 入口均通过 `slots.inject()` 注册；`client.spec.tsx` 验证设置页/学习页共享引用计数式 store 和单一 watch 生命周期 |
| 9 | 主工作隔离 | M4 不新增 Session 事件、projection 或 prompt 注入；P0 `deriveMessages()` 不变测试继续通过 |
| 10 | 测试伴随 | `pnpm run typecheck`、48 个单元/集成测试、3 个 keyless assembled Web 场景、本地目录 link/pack 门禁与 PR 内真实模型 GIF |

## M5 主动学习命令

| # | 标准 | 自动化证据 |
|---:|---|---|
| 1 | 命令发现与兼容 | `plugin.spec.ts` 通过真实 command registry 断言 descriptor、input hint 和管理/请求共存；assembled Web snapshot 覆盖 composer slash discovery |
| 2 | 显式讲解 | `plugin.spec.ts` 从空白来源执行真实 `/explain <request>` 并得到带 `origin: manual` 的全局 active entry；`m2-core.spec.ts` 覆盖最近合格来源和 turn 0 捕获 |
| 3 | 严格输出与持久化 | `m2-core.spec.ts` 拒绝 skip、额外字段和非法 TopicKey；`m2-store.spec.ts` 证明 origin、私有来源摘要和重讲 revision 跨事务保留 |
| 4 | 单飞、门与取消 | `scheduler.spec.ts` 覆盖真实 LLM service 请求、来源 busy 快速失败、在途取消和单飞；store 事务复核来源、Topic 与 lease |
| 5 | 自主预算豁免 | `scheduler.spec.ts` 与 `m2-store.spec.ts` 断言主动生成和后续重讲不增加 `auto_request_usage` |
| 6 | 主 Agent 隔离 | command runtime 只写标准 command 生命周期；`m2-core.spec.ts` 的 source 捕获不改变 `deriveMessages()`，assembled 产品流程验证 composer 命令不形成主模型回答 |
| 7 | 产品证据 | `pnpm run typecheck`、`pnpm test`、`pnpm run test:web`、本地目录安装 smoke 和 PR 内真实模型 GIF |

## M6 P1 Explain 自有快捷入口

| # | 标准 | 自动化与产品证据 |
|---:|---|---|
| 1 | 单仓库所有权 | `test:m6` 的全新 profile 只安装 Explain，并断言 selection-chat、suggested-replies 与 Advisor 均不在配置中；源码不导入它们的包或私有状态 |
| 2 | 选区草稿 | `shortcuts.spec.tsx` 覆盖换行保留、10,000 字符上限和只写草稿；`test:m6` 在真实 DSH Web 中从可见文本生成精确 `--selection` 草稿 |
| 3 | 精确回答草稿 | assistant action 使用稳定 message id 从当前 snapshot 定位 turn；单元测试与 `test:m6` 断言生成精确 `--answer <turn>` 草稿 |
| 4 | 点击时准入 | `commitExplainDraft` 在每次点击重新读取 input facade，拒绝非 `plain`、非空草稿、Session 不可用和写入未生效；两个入口都不调用 `submit()` |
| 5 | 生命周期 | 两个 additive slot 均通过 `slots.inject()` 注册；`test:m6` 在 Web 卸载后删除整个 Explain 层，再安装时每项只恢复一次 |
| 6 | 来源兼容 | Host 对 selection 逆序定位；answer 精确读取 completed/max-tokens turn；旧 `--suggested` 输入与旧 `origin: suggested` 记录保持可读，新 UI 只生成 `answer` |
| 7 | Advisor 隔离 | Explain 不订阅 Advisor runtime；只有用户显式选择其可见 context 后才生成 `origin: selection`，未选择内容不进入 observation 或 ExplainContext |
| 8 | 成本与主 Agent 隔离 | 快捷入口本身零模型调用；用户提交后复用 manual Scheduler 且豁免自主额度，command 生命周期不进入主模型消息 |
| 9 | 真实产品流程 | 从精确候选提交启动全新 DSH Web，以真实主模型生成来源回答，再验证 answer/selection 草稿、真实 Explain 讲解与反馈闭环；GIF 随合入 PR 保存 |
