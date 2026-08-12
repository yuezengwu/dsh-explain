# Vendored dsh-better-sidebar(fork 副本)

`dsh-explain` 的 P0 学习界面依赖 `ctx.betterSidebar` 服务。为隔离上游删除、停止维护或 API 漂移的风险,该依赖以 **fork 副本**形式保存在本仓库 `vendor/dsh-better-sidebar/`(对齐主仓库 `vendor/` 的 pinned-source-copy 惯例)。

## Upstream

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/dsh-external/DSH-better-sidebar |
| 版本 | v0.7.0 |
| **pinned SHA** | `96b83ae3b87c03d196d4a162e1e863422ad42aa2` |
| 许可证 | MIT(副本内 LICENSE 原样保留) |
| 引入日期 | 2026-08-12 |

## 本地修改

当前**无**本地修改。任何对副本源码的改动必须记录在此(原因 + 日期),并保持 LICENSE 与上游署名。

## 同步流程(上游发版时)

1. `git fetch` 上游仓库,对比 `96b83ae…` 之后的新提交。
2. 评估变更面:是否触及 explain 依赖的 API(`ctx.betterSidebar` 服务、`registerTab`、`openTab`、`TabComponentProps.visible`)。
3. 决定采纳后:复制新版本到 `vendor/dsh-better-sidebar/`(保留 LICENSE),更新本文件 Upstream 表。
4. **重新验证 API 兼容**(更新架构文档的验证矩阵):registerTab / openTab / TabComponentProps 签名逐项对照;组合 smoke(恰好一个 `betterSidebar` 服务)重跑。
5. 未触及的 API 变更可推迟采纳;触及则必须在同一次提交内完成验证。

## 组合约束

- 安装了 `dsh-explain` 即随包安装本 vendored 副本;**不要再单独安装上游 DSH-better-sidebar**(同包名 `dsh-better-sidebar`,profile 依赖解析下二者互斥)。
- 组合 smoke 必须断言:profile 中 `betterSidebar` 服务恰好一个实例。
- 副本的 `pnpm-workspace.yaml` 已并入仓库根(allowBuilds / minimumReleaseAgeExclude),本目录不保留嵌套 workspace 文件。
