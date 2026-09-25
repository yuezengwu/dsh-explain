# DSH 兼容约定

核验日期：2026-09-25。

| 来源 | 版本 | 精确提交 | 本轮验证 |
|---|---|---|---|
| npm next 发布包 | `0.1.7-rc.2` | 发布包安装与锁文件 | 类型检查、90 项单元/集成测试、生产构建、实际 pack |
| DSH 0.1.2-rc.1 源码 | `0.1.2-rc.1` | `a66e4702047846cdaa10c66c9d3df3951f5ea70d` | 类型检查、90 项测试、7 个 Web 场景、3 个 M6 场景 |
| DSH alpha.1 源码 | `0.1.3-alpha.1` | `d347e703908d0406b7a7ef80e3a0e594d86b2215` | 类型检查、90 项测试、7 个 Web 场景、3 个 M6 场景 |
| DSH alpha.2 源码 | `0.1.3-alpha.2` | `82a5fd61a7cf5c293cec4bdff68f455398d685e9` | 类型检查、90 项测试、7 个 Web 场景、3 个 M6 场景 |
| DSH 0.1.5-alpha.1 源码 | `0.1.5-alpha.1` | `5dda764ed3aa172535a7967b06ff95d9cbfe536a` | 类型检查、90 项测试、7 个 Web 场景、3 个 M6 场景 |
| DSH 0.1.5-alpha.2 源码 | `0.1.5-alpha.2` | `b2e3b2a0125854567a4a5fcba75782e42fe84901` | 类型检查、90 项测试、7 个 Web 场景、3 个 M6 场景 |
| DSH 0.1.5-rc.1 源码 | `0.1.5-rc.1` | `183f08e9c6dde7e36cd2318eaee70b0da08fb35e` | 类型检查、90 项测试、7 个 Web 场景、3 个 M6 场景 |
| DSH 0.1.5-rc.2 源码 | `0.1.5-rc.2` | `fb2c4b9e698e30edb738bca4cf0618587db7d203` | 类型检查、90 项测试、7 个 Web 场景、3 个 M6 场景 |
| npm latest 对应源码 | `0.1.5-rc.3` | `a4c74a91e06b00fe0b0937bde982170c526cc842` | 类型检查、90 项测试、7 个 Web 场景、3 个 M6 场景 |
| DSH 0.1.6-alpha.1 源码 | `0.1.6-alpha.1` | `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d` | 类型检查、90 项测试、7 个 Web 场景、3 个 M6 场景 |
| DSH 0.1.6-alpha.2 源码 | `0.1.6-alpha.2` | `ddefc45fbc7f8e46dd73185e68295696d1297887` | 类型检查、90 项测试、7 个 Web 场景、3 个 M6 场景（含实时停用/启用） |
| DSH 0.1.7-alpha.1 源码 | `0.1.7-alpha.1` | `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61` | 类型检查、90 项测试、8 个 Web 场景、3 个 M6 场景 |
| DSH 0.1.7-alpha.2 源码 | `0.1.7-alpha.2` | `00102833dfaee1da9f48a3a8eae9d34005a75218` | 类型检查、90 项测试、8 个 Web 场景、3 个 M6 场景 |
| DSH 0.1.7-rc.1 源码 | `0.1.7-rc.1` | `46a7f68b0922371ce7144b668b90e377d8e799f4` | 类型检查、90 项测试、8 个 Web 场景、3 个 M6 场景 |
| 最新 DSH 源码发布 | `0.1.7-rc.2` | `477b4f420553e8a52c2fbccc464d7561b239c443` | 类型检查、90 项测试、8 个 Web 场景、3 个 M6 场景 |

[官方 0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2) 于 2026-09-24 14:10:21 UTC 发布，精确 tag 为上表 SHA。2026-09-25 核对：npm `next` 指向 `0.1.7-rc.2`，`latest` 为 `0.1.5-rc.3`，`alpha` 为 `0.1.7-alpha.2`。依赖和锁文件固定 rc.2 发布包，peer 声明显式接受十四个已验证的预发布版本，保留旧宿主。

rc.2 的宿主设置页新增 DeepSeek Account provider 选项。Explain 的设置快照为 rc.2 单独记录此项，其余宿主保留原期望；本轮只验证该选项在无密钥 UI 中出现，不验证账号模型实际调用。

### 0.1.7：设置迁移与 Session V4

新宿主移除 `settings.installSection`，Explain 在 Config 中声明可实时更新的字段，按当前 Loader entry id 保存到 profile patch，并通过 volatile-update 同步调度器。旧宿主继续使用原 settings namespace。存储路径始终不是可实时编辑字段。

首次进入新宿主时，Explain 从宿主的 `settings.yaml` 或保留的 `settings.yaml.imported` 中提取自己的旧 section，忽略其他插件和存储字段；已有 profile 显式设置优先。成功后在 profile 目录写入 `.dsh-explain-settings-migrated`，避免以后清空设置时再次导入旧值。源文件不被修改；失败保留源文件且不写完成标记，日志提示迁移未完成。不同 profile 各自迁移；共享学习 SQLite 的单实例租约不变。

Session V4 的工具结果采用平铺 tool-role 消息，旧版嵌套 tool-result 仍能读取。辅助请求声明 Explain 自己的消息来源，系统提示词由宿主构造函数生成；不进入主 Agent，也不读取仅存在于自定义事件中的附件。来源隔离测试在宿主真实 Session 上确认系统提示词、reasoning 和合成上下文不进入 capsule，主会话消息保持不变。快捷入口同时接受新版 Regular 图标和旧版图标。

TypeRT 0.1.7 把 RPC 校验器从 `schema` 改为惰性的 `create()`；构建时为生成的 Host / Remote 产物补充两种访问入口，共用同一校验器，新宿主仍保持惰性初始化。CI 先以 npm 锁定依赖构建一份 tarball，再让十四个固定宿主的 Web / M6 测试安装同一产物，防止每个宿主分别构建时掩盖旧版本加载失败。

0.1.7 的官方 DeepSeek 适配器仅支持 Messages API，旧适配器配置需遵循宿主发布说明迁移。此次无密钥验证不证明真实 provider 可用性；之前的 deepseek-flash 验收仅属于 0.1.6-alpha.1。

### 客户端 Session 与实时卸载

0.1.6-alpha.2 将客户端来源导航从 `sessions.open()` 移至 `uiWorkspace.openSession()`，Session slot 注入目标从 id 变为持有具体 generation 的 reference。Explain 在新版使用工作区导航，并从 slot reference 的 binding 获取输入框作用域；旧版继续使用 id 与原导航。已释放 reference 的延迟点击不会创建新的引用或写入别的输入框，已有草稿和忙碌状态继续受保护。

M6 在新版插件管理页实际停用、重新启用 Explain，检查样式、学习入口和快捷操作卸载及单份恢复，再读取恢复后的学习状态；同时保留所有宿主的 CLI 移除/重新安装检查。宿主 runtime disposer、SQLite 关闭和客户端 long-poll 清理沿用原有生命周期。学习 SQLite 仍为 schema 4，导出仍为 backup v3。

新版默认模型列表移除了 V4 Flash 与 V4 Flash Vision Exp。Explain 继续使用用户明确配置的辅助路由；9 月 15 日的真实 deepseek-flash 验收只归属于当时的 0.1.6-alpha.1，不作为新版模型可用性证明。本轮使用无密钥夹具。

### 异步 Session 历史读取

Explain 的来源观察和手动来源定位已迁移至公开的 `sessionController.page()`，生产代码不再调用 `snapshotEvents()`、`eventAt()` 或 `ownEvents()`。每次读取固定 `throughSeq`，以 `beforeSeq` 逆序分页（每页最多 16 条逻辑消息），只物化目标回合；不建立完整历史副本。该分页契约在表中十个宿主上均可用，旧宿主的打包 stream chunk 记录仅参与游标推进，不进入来源正文。

分页读取支持 AbortSignal；收到取消后的页面不会参与捕获。自动观察与手动命令在等待历史后检查 runtime generation，关闭学习、清空数据或更换模型期间的旧请求不能重新入队。系统提示词、reasoning 和合成用户上下文继续排除，主 Session 消息保持不变。宿主内部如何加载或缓存历史由 DSH 负责，这次迁移不表示上游已完成全部内存优化。上游决定见[弃用说明](https://github.com/deepseek-ai/deepseek-harness/blob/0a15e36e7f82b6ed45af6fa9759f29b40dcd965d/.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md)。

## 发布包依赖修复

`dsh-client-store` 在 `0.1.5-alpha.2`、`0.1.5-rc.1`、`0.1.5-rc.2`、`0.1.6-alpha.1`、`0.1.6-alpha.2`、`0.1.5-rc.3`、`0.1.7-alpha.1`、`0.1.7-alpha.2`、`0.1.7-rc.1` 和 `0.1.7-rc.2` 的产物中仍导入 Zustand/Immer，但 manifest 仅将两者列为 devDependencies。9 月 18 日安装未添加本轮补丁的 `0.1.6-alpha.2` 仍报 `ERR_MODULE_NOT_FOUND: zustand`。9 月 22 日独立导入 0.1.7-alpha.1 原始 tarball 同样报 `ERR_MODULE_NOT_FOUND: zustand`。9 月 23 日独立导入 rc.3 与 alpha.2 原始 tarball 同样报错；9 月 24 日独立导入 rc.1 原始 tarball 仍报同一缺失；9 月 25 日独立导入 rc.2 原始 tarball 也报同一错误。此前 `0.1.5-alpha.1` 对照导入成功，alpha.2 和两个 rc 的复现记录保留在 M16/M17。

`pnpm-workspace.yaml` 的 `packageExtensions` 只匹配上述十个受影响版本，补齐原依赖范围 `immer: ^10.1.1` 与 `zustand: ~4.4.7`，锁文件记录修复。0.1.7-rc.2 发布包经 frozen install、类型检查、90 项测试、构建与实际 pack 通过；上游进展与更广的静态客户端打包问题见 [Discussion #6082](https://github.com/deepseek-ai/deepseek-harness/discussions/6082)。静态库产物保留 bare imports，而上游依赖门禁要求浏览器输入仅列为开发依赖，完整修复需要维护者统一产物与依赖规则。本项目只修复实际消费的 store；该配置作用于本仓库 pnpm 安装，不代表其他消费方或上游发布包已修复。

## 安装

```sh
npx @deepseek-ai/dsh@0.1.7-rc.2 plugin --profile web add github:yuezengwu/dsh-explain#main
npx @deepseek-ai/dsh@0.1.7-rc.2 --profile web
```

上述命令安装尚未发布新标签的 `main`。需要不可变安装时，把 `#main` 换为对应已通过 CI 的合入提交 SHA。现有 [v0.3.1](https://github.com/yuezengwu/dsh-explain/releases/tag/v0.3.1) 仍搭配 DSH 0.1.6-alpha.2 或更早的表内宿主，不包含本轮 0.1.7 适配；v0.3.0 的支持范围截至 0.1.6-alpha.1。npm 默认渠道可显式使用 `0.1.5-rc.3`，`alpha` 可显式使用 `0.1.7-alpha.2`。宿主 Session 格式迁移与 Explain SQLite 独立；各版本独立验收不表示新版 Session 文件可以降级读取。

## 兼容实现

- V3 来源回归在真实 Session 中追加系统提示词，证明其不进入学习 capsule，来源结束坐标和主会话消息不变。合成旧 Web 日志保持先 `step/start`、再 `user/message` 的时间顺序，由官方 V0→V3 迁移器转换。
- Explain 只从 Session 对象读取身份、header 与 seq；历史数据通过异步 page API 获取，来源正文消费 settled 消息，不依赖 durable chunk 事件。
- 0.1.3-alpha.1/alpha.2 使用 Session format 2，0.1.5-alpha.1/alpha.2/rc.1/rc.2 与 0.1.6-alpha.1/alpha.2 使用 format 3。测试中的合成 settled assistant 事件补充 `stream: []`；旧版宿主兼容此额外字段。
- 真实 Web 夹具通过对应宿主自己的 `llm-replay` 解析和迁移旧日志。format 2/3 写入使用 `SessionHandle.append/flush/close`，`0.1.2-rc.1` 使用原持久化接口。这层分支仅在测试夹具中。
- 源码链接覆盖所有直接开发依赖和 peer 包，并共用宿主 React/Cordis 实例，避免源码包和 npm 包混装导致对象身份不一致。链接脚本拒绝未经验证的源码版本。
- Explain SQLite 保持 schema 4、backup v3，不改写旧记录。薄弱概念通过当前有效状态投影恢复 learning，同时保留原有复习排期。

## 本地复现

先按 DSH 官方开发说明安装并构建上表任一精确源码版本，再在 Explain checkout 运行：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm pack --out /tmp/dsh-explain-candidate.tgz
export DSH_EXPLAIN_INSTALL_SPEC=/tmp/dsh-explain-candidate.tgz
export DSH_SOURCE_DIR=/absolute/path/to/built/deepseek-harness
pnpm dsh:link
pnpm dsh:link:check
pnpm typecheck
pnpm test
pnpm build
pnpm exec vitest run --config vitest.web.config.ts
pnpm exec vitest run --config vitest.m6.config.ts
```

本地验证新版插件时，在该 DSH 源码目录调用其 CLI，并使用独立的测试 home：

```sh
export DSH_HOME=/absolute/path/to/isolated-test-home
node --import tsx/esm apps/cli/src/bin.ts plugin --profile web add /absolute/path/to/dsh-explain
node --import tsx/esm apps/cli/src/bin.ts --profile web --no-open
```

CI 检查锁定的 0.1.7-rc.2 发布包，并对十四个精确源码提交运行组装矩阵：每个宿主 90 项单元/集成、7 Web、3 M6，两个 0.1.7 alpha 与两个 rc 另有旧设置迁移及两次重启验收。发布包经过 frozen install、构建和实际 pack，十四宿主 Web / M6 安装该同一 tarball。本地验证新 rc.2 宿主，其余由当前 PR 的完整 CI 复核，提交结果见 [Actions](https://github.com/yuezengwu/dsh-explain/actions/workflows/ci.yml)。所有 Web/M6 使用临时 Session、SQLite、profile 和无密钥夹具。另于 2026-09-15 在 0.1.6-alpha.1 上完成的[真实模型验收](./REAL_MODEL_ACCEPTANCE.md)与当前宿主验证范围分开。现有 Demo 仍标注 `0.1.2-rc.1`。

## 修复后的学习行为

1. 同一 context/activity generation 的空闲压缩失败后停止布置零延时定时器；新活动或新可压缩内容再触发。
2. 活跃讲解独立读取，不会因历史超过 30 条而隐藏；历史游标保持原语义。
3. 全局模型请求只含有界 Topic 提示。重讲带目标最新正文和至多三个旧标题，所有历史 revision 仍保存在本地。
4. partial/forgotten 立即反映为 learning，统一用于 UI、统计、模型提示和自主选题。重新讲解取消旧题，避免在学习中重复测验。
5. 来源摘要、模型出入文本和公开导出过滤常见凭证与路径格式；历史数据不被破坏性改写。该过滤不保证识别任意私人文本，界面明确说明辅助 provider 会收到有界来源文本。
6. 题型按每个概念自己的复习历史推进，成功进入下一题型，失败重复当前题型。
