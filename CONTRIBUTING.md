# Contributing to dsh-explain

Thanks for helping improve Explain. Small, focused pull requests with a clear user outcome are easiest to review.

## Before changing behavior

- Search existing issues and pull requests first.
- Open an issue before a large feature, persistence-format change, new model call, or user-data behavior change.
- Never include real DSH sessions, credentials, absolute user paths, or private learning databases in an issue, fixture, screenshot, or commit.

## Local setup

Use Node.js 24 and the pnpm version declared in `package.json`:

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

The assembled Web and M6 suites require a built checkout of the matching official DSH source:

```sh
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm dsh:link
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm test:web
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm test:m6
```

## Pull requests

Keep the Host, typed Remote, browser store, UI, tests, and documentation consistent. In the pull request, explain:

- the user problem and the chosen boundary;
- privacy, cost, persistence, and concurrency effects;
- the exact verification commands run;
- the DSH version used for source-composed tests.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## 中文说明

提交前请先搜索已有 Issue/PR；涉及持久化格式、模型调用、用户数据或较大功能时先开 Issue 对齐范围。任何测试、截图和提交都不得包含真实 DSH 会话、凭证、用户绝对路径或私有学习数据库。PR 请说明用户问题、隐私/成本/并发影响、验证命令与实际测试的 DSH 版本。
