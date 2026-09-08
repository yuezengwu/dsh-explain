# DSH 兼容约定

核验日期：2026-09-08。

| 来源 | 版本 | 精确提交 | 本轮验证 |
|---|---|---|---|
| npm alpha 发布包 | `0.1.3-alpha.2` | 发布包安装与锁文件 | 类型检查、80 项单元/集成测试、生产构建、pack dry-run |
| DSH rc.1 源码 | `0.1.2-rc.1` | `a66e4702047846cdaa10c66c9d3df3951f5ea70d` | 类型检查、80 项测试、7 个 Web 场景、3 个 M6 场景 |
| DSH alpha.1 源码 | `0.1.3-alpha.1` | `d347e703908d0406b7a7ef80e3a0e594d86b2215` | 类型检查、80 项测试、7 个 Web 场景、3 个 M6 场景 |
| 最新 DSH 源码发布 | `0.1.3-alpha.2` | `82a5fd61a7cf5c293cec4bdff68f455398d685e9` | 类型检查、80 项测试、7 个 Web 场景、3 个 M6 场景 |

[官方 0.1.3-alpha.2 发布页](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.3-alpha.2)的发布时间为 2026-09-07 13:59:29 UTC。该版本的 CLI/API 包已在 npm 发布，`alpha` 指向 alpha.2；`latest` / `next` 仍为 rc.1。开发依赖和锁文件精确固定 alpha.2，peerDependencies 显式接受三个已验证的预发布版本。

alpha.2 改善长会话加载、Web 断线恢复和自动滚动，调整消息队列及反馈界面。破坏性变更涉及 persona 注入字段、常量和普通 subprocess handle 的 `pid`；Explain 不使用这些接口。Session 的持久化种子所有权类型也有调整，但 Explain 只消费公开事件读取接口、夹具通过宿主持久化 API 写入，无需另加运行时兼容分支。这些上游改进不等同于 Explain 已做性能或真实教学效果评测。

## 安装

```sh
npx @deepseek-ai/dsh@0.1.3-alpha.2 plugin --profile web add github:yuezengwu/dsh-explain
npx @deepseek-ai/dsh@0.1.3-alpha.2 --profile web
```

如继续使用 npm 默认渠道的 rc.1，将两条命令中的版本均替换为 `0.1.2-rc.1`。Explain 当前 GitHub 安装使用 `main`；最新标签仍为 `v0.2.0`，尚未发布 `v0.3.0`。宿主的 Session 格式迁移与插件 SQLite 分开管理：升级前保留 DSH 数据备份；三个版本的独立验收不表示新版 Session 文件能降级给旧宿主读取。

## 兼容实现

- Explain 继续只消费 `Session.seq`、`eventAt()`、`snapshotEvents()` 和 settled `assistant/message`，不依赖已移除的 durable chunk 事件。
- alpha.1/alpha.2 使用 Session format 2。测试中的合成 settled assistant 事件补充 `stream: []`；旧版宿主兼容此额外字段。
- 真实 Web 夹具通过对应宿主自己的 `llm-replay` 解析和迁移旧日志。format 2 写入使用 `SessionHandle.append/flush/close`，rc.1 使用原持久化接口。这层分支仅在测试夹具中。
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

CI 检查锁定的 alpha.2 发布包，并对三个固定源码提交运行完整组装矩阵。上表是本地运行证据；对应提交的 CI 结果见 [Actions](https://github.com/yuezengwu/dsh-explain/actions/workflows/ci.yml)。Web/M6 使用临时 Session、数据库和无密钥夹具；本轮不构成真实模型教学效果评估。现有 Demo 媒体仍明确标注 rc.1。

## 修复后的学习行为

1. 同一 context/activity generation 的空闲压缩失败后停止布置零延时定时器；新活动或新可压缩内容再触发。
2. 活跃讲解独立读取，不会因历史超过 30 条而隐藏；历史游标保持原语义。
3. 全局模型请求只含有界 Topic 提示。重讲带目标最新正文和至多三个旧标题，所有历史 revision 仍保存在本地。
4. partial/forgotten 立即反映为 learning，统一用于 UI、统计、模型提示和自主选题。重新讲解取消旧题，避免在学习中重复测验。
5. 来源摘要、模型出入文本和公开导出过滤常见凭证与路径格式；历史数据不被破坏性改写。该过滤不保证识别任意私人文本，界面明确说明辅助 provider 会收到有界来源文本。
6. 题型按每个概念自己的复习历史推进，成功进入下一题型，失败重复当前题型。
