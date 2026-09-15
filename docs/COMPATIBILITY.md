# DSH 兼容约定

核验日期：2026-09-15。

| 来源 | 版本 | 精确提交 | 本轮验证 |
|---|---|---|---|
| npm alpha 发布包 | `0.1.6-alpha.1` | 发布包安装与锁文件 | 类型检查、84 项单元/集成测试、生产构建、pack dry-run |
| DSH 0.1.2-rc.1 源码 | `0.1.2-rc.1` | `a66e4702047846cdaa10c66c9d3df3951f5ea70d` | 类型检查、84 项测试、7 个 Web 场景、3 个 M6 场景 |
| DSH alpha.1 源码 | `0.1.3-alpha.1` | `d347e703908d0406b7a7ef80e3a0e594d86b2215` | 类型检查、84 项测试、7 个 Web 场景、3 个 M6 场景 |
| DSH alpha.2 源码 | `0.1.3-alpha.2` | `82a5fd61a7cf5c293cec4bdff68f455398d685e9` | 类型检查、84 项测试、7 个 Web 场景、3 个 M6 场景 |
| DSH 0.1.5-alpha.1 源码 | `0.1.5-alpha.1` | `5dda764ed3aa172535a7967b06ff95d9cbfe536a` | 类型检查、84 项测试、7 个 Web 场景、3 个 M6 场景 |
| DSH 0.1.5-alpha.2 源码 | `0.1.5-alpha.2` | `b2e3b2a0125854567a4a5fcba75782e42fe84901` | 类型检查、84 项测试、7 个 Web 场景、3 个 M6 场景 |
| npm latest 对应源码 | `0.1.5-rc.1` | `183f08e9c6dde7e36cd2318eaee70b0da08fb35e` | 类型检查、84 项测试、7 个 Web 场景、3 个 M6 场景 |
| npm next 对应源码 | `0.1.5-rc.2` | `fb2c4b9e698e30edb738bca4cf0618587db7d203` | 类型检查、84 项测试、7 个 Web 场景、3 个 M6 场景 |
| 最新 DSH 源码发布 | `0.1.6-alpha.1` | `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d` | 类型检查、84 项测试、7 个 Web 场景、3 个 M6 场景 |

[官方 0.1.6-alpha.1 发布页](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.6-alpha.1)的发布时间为 2026-09-15 04:57:57 UTC。npm `alpha` 指向 `0.1.6-alpha.1`，`next` 保持 `0.1.5-rc.2`，`latest` 保持 `0.1.5-rc.1`。开发依赖和锁文件精确固定新 alpha，peerDependencies 显式接受八个已验证的预发布版本。

0.1.6-alpha.1 新增 Web 终端、归档会话设置与实验性浏览器/计算机工具，并调整输入区和侧边栏。Explain 的设置、学习视图、来源跳转、反馈、导出清空和可编辑快捷草稿均通过真实组装 Web 验收，无需修改产品运行时或快照期望。Explain 不注册改名的 `agent/session-start` 事件，也不依赖本轮改名的 PTC 服务。Session 仍为 format 3，新增 image offload 事件；八个宿主独立验收不保证带新事件的 Session 可以由旧宿主读取。

### 异步 Session 历史读取

Explain 的来源观察和手动来源定位已迁移至公开的 `sessionController.page()`，生产代码不再调用 `snapshotEvents()`、`eventAt()` 或 `ownEvents()`。每次读取固定 `throughSeq`，以 `beforeSeq` 逆序分页（每页最多 16 条逻辑消息），只物化目标回合；不建立完整历史副本。该分页契约在表中八个宿主上均可用，旧宿主的打包 stream chunk 记录仅参与游标推进，不进入来源正文。

分页读取支持 AbortSignal；收到取消后的页面不会参与捕获。自动观察与手动命令在等待历史后检查 runtime generation，关闭学习、清空数据或更换模型期间的旧请求不能重新入队。系统提示词、reasoning 和合成用户上下文继续排除，主 Session 消息保持不变。宿主内部如何加载或缓存历史由 DSH 负责，这次迁移不表示上游已完成全部内存优化。上游决定见[弃用说明](https://github.com/deepseek-ai/deepseek-harness/blob/0a15e36e7f82b6ed45af6fa9759f29b40dcd965d/.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md)。

## 发布包依赖修复

`dsh-client-store` 在 `0.1.5-alpha.2`、`0.1.5-rc.1`、`0.1.5-rc.2` 和 `0.1.6-alpha.1` 的产物中仍导入 Zustand/Immer，但 manifest 仅将两者列为 devDependencies。9 月 15 日独立 npm 安装 `0.1.6-alpha.1` 仍报 `ERR_MODULE_NOT_FOUND: zustand`。此前 `0.1.5-alpha.1` 对照导入成功，alpha.2 和两个 rc 的复现记录保留在 M16/M17。

`pnpm-workspace.yaml` 的 `packageExtensions` 只匹配上述四个已复现版本，补齐原依赖范围 `immer: ^10.1.1` 与 `zustand: ~4.4.7`，锁文件记录修复。0.1.6-alpha.1 发布包经 frozen install、类型检查、84 项测试、构建与 pack dry-run 通过；上游进展与更广的静态客户端打包问题见 [Discussion #6082](https://github.com/deepseek-ai/deepseek-harness/discussions/6082)。静态库产物保留 bare imports，而上游依赖门禁要求浏览器输入仅列为开发依赖，完整修复需要维护者统一产物与依赖规则。本项目只修复实际消费的 store；该配置作用于本仓库 pnpm 安装，不代表其他消费方或上游发布包已修复。

## 安装

```sh
npx @deepseek-ai/dsh@0.1.6-alpha.1 plugin --profile web add github:yuezengwu/dsh-explain
npx @deepseek-ai/dsh@0.1.6-alpha.1 --profile web
```

如使用 npm 默认渠道，将两条命令中的版本均替换为 `0.1.5-rc.1`；旧 `0.1.2-rc.1` 也继续受支持。Explain 当前 GitHub 安装使用 `main`；最新标签仍为 `v0.2.0`，尚未发布 `v0.3.0`。宿主的 Session 格式迁移与插件 SQLite 分开管理：升级前保留 DSH 数据备份；八个版本的独立验收不表示新版 Session 文件能降级给旧宿主读取。

## 兼容实现

- V3 来源回归在真实 Session 中追加系统提示词，证明其不进入学习 capsule，来源结束坐标和主会话消息不变。合成旧 Web 日志保持先 `step/start`、再 `user/message` 的时间顺序，由官方 V0→V3 迁移器转换。
- Explain 只从 Session 对象读取身份、header 与 seq；历史数据通过异步 page API 获取，来源正文消费 settled 消息，不依赖 durable chunk 事件。
- 0.1.3-alpha.1/alpha.2 使用 Session format 2，0.1.5-alpha.1/alpha.2/rc.1/rc.2 与 0.1.6-alpha.1 使用 format 3。测试中的合成 settled assistant 事件补充 `stream: []`；旧版宿主兼容此额外字段。
- 真实 Web 夹具通过对应宿主自己的 `llm-replay` 解析和迁移旧日志。format 2/3 写入使用 `SessionHandle.append/flush/close`，`0.1.2-rc.1` 使用原持久化接口。这层分支仅在测试夹具中。
- 源码链接覆盖所有直接开发依赖和 peer 包，并共用宿主 React/Cordis 实例，避免源码包和 npm 包混装导致对象身份不一致。链接脚本拒绝未经验证的源码版本。
- Explain SQLite 保持 schema 4、backup v3，不改写旧记录。薄弱概念通过当前有效状态投影恢复 learning，同时保留原有复习排期。

## 本地复现

先按 DSH 官方开发说明安装并构建上表任一精确源码版本，再在 Explain checkout 运行：

```sh
pnpm install --frozen-lockfile
export DSH_SOURCE_DIR=/absolute/path/to/built/deepseek-harness
pnpm dsh:link
pnpm dsh:link:check
pnpm typecheck
pnpm test
pnpm build
pnpm exec vitest run --config vitest.web.config.ts
pnpm exec vitest run --config vitest.m6.config.ts
pnpm pack --dry-run
```

本地验证新版插件时，在该 DSH 源码目录调用其 CLI，并使用独立的测试 home：

```sh
export DSH_HOME=/absolute/path/to/isolated-test-home
node --import tsx/esm apps/cli/src/bin.ts plugin --profile web add /absolute/path/to/dsh-explain
node --import tsx/esm apps/cli/src/bin.ts --profile web --no-open
```

CI 检查锁定的 0.1.6-alpha.1 发布包及上述依赖修复，并对八个固定源码提交运行完整组装矩阵。上表是本地运行证据；对应提交的 CI 结果见 [Actions](https://github.com/yuezengwu/dsh-explain/actions/workflows/ci.yml)。Web/M6 使用临时 Session、数据库和无密钥夹具；本轮不构成真实模型教学效果评估。现有 Demo 媒体仍明确标注 `0.1.2-rc.1`。

## 修复后的学习行为

1. 同一 context/activity generation 的空闲压缩失败后停止布置零延时定时器；新活动或新可压缩内容再触发。
2. 活跃讲解独立读取，不会因历史超过 30 条而隐藏；历史游标保持原语义。
3. 全局模型请求只含有界 Topic 提示。重讲带目标最新正文和至多三个旧标题，所有历史 revision 仍保存在本地。
4. partial/forgotten 立即反映为 learning，统一用于 UI、统计、模型提示和自主选题。重新讲解取消旧题，避免在学习中重复测验。
5. 来源摘要、模型出入文本和公开导出过滤常见凭证与路径格式；历史数据不被破坏性改写。该过滤不保证识别任意私人文本，界面明确说明辅助 provider 会收到有界来源文本。
6. 题型按每个概念自己的复习历史推进，成功进入下一题型，失败重复当前题型。
