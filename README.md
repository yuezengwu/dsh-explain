<div align="right">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</div>

<h1 align="center">dsh-explain</h1>

<p align="center"><strong>Turn everyday DSH work into a private, continuous learning loop.</strong></p>

<p align="center">
  <img alt="DSH 0.1.1-rc.2" src="https://img.shields.io/badge/DSH-0.1.1--rc.2-4c8bf5">
  <a href="https://github.com/yuezengwu/dsh-explain/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/yuezengwu/dsh-explain/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/yuezengwu/dsh-explain/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/yuezengwu/dsh-explain"></a>
  <img alt="Local first" src="https://img.shields.io/badge/data-local--first-2ea44f">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

`dsh-explain` is a learning-mode plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It turns useful concepts from completed work sessions into structured explanations, keeps them in one global learning thread, and adapts future explanations to what the user already knows.

The primary agent stays untouched: Explain uses its own model calls, scheduler, context, and local SQLite database.

## See it in action

![Select a DSH answer, create an Explain request, review the learning card, and mark it mastered](https://github.com/yuezengwu/dsh-explain/blob/m6-owned-shortcuts-assets/m6-owned-shortcuts-real.gif?raw=true)

Select text or choose **Learn from this answer**, review the editable `/explain` draft, generate a learning card, then mark it understood. This demonstration used real DSH Web sessions and real DeepSeek main-agent and Explain model rounds; the exact commits and recording conditions are preserved in [PR #16](https://github.com/yuezengwu/dsh-explain/pull/16#user-content-real-model-gui-evidence).

## Quick start

The published Explain release currently targets DSH `0.1.1-rc.2`. This compatibility branch validates DSH `0.1.2-alpha.3` without replacing that RC.2 release line.

```sh
npx @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web add github:yuezengwu/dsh-explain
npx @deepseek-ai/dsh@0.1.1-rc.2 web
```

Then open **Settings → Learning**, select an auxiliary provider and model, enable learning mode, and save. Explain observes only future completed top-level turns; it does not scan existing history.

Git-hosted plugins build during installation. If pnpm requests build approval, add the printed `dsh-explain` entry to the profile's `pnpm-workspace.yaml`, then repeat the install command.

## Ways to learn

| Entry point | What happens |
|---|---|
| `/explain <request>` | Requests an explanation using the current session as bounded source context. |
| `/review` | Starts or resumes a local review round in the Learning tab. |
| **Explain selected text** | Creates an editable `/explain --selection …` draft from visible text. It never submits automatically. |
| **Learn from this answer** | Creates an editable draft tied to the exact finalized assistant turn. |
| Automatic evaluation | After an eligible completed turn, Explain may add one useful explanation within the configured budget. |

Use `/explain on`, `/explain off`, and `/explain status` to control or inspect the runtime without leaving the composer.

Each learning card answers three questions:

- **What is it?** A concise explanation of the concept.
- **Why does it matter?** The practical reason it matters in the source work.
- **What is the common pitfall?** A mistake or misconception to avoid.

Choose **Got it** to close the card, or **Not yet** to request a different explanation. Rephrasing remains available even if the source session is later deleted.

## Review what you learned

Concepts marked **Got it** enter a local review schedule the next day. **Learning → Today's review** selects up to three due concepts and asks recall, application, and distinction questions. The auxiliary model evaluates answers as **Mastered**, **Partial**, or **Forgotten**, gives concise feedback, links back to the source session, and schedules the next review at a deterministic interval. Review calls share the global single-flight scheduler and do not consume the autonomous-evaluation budget.

## One learning thread, many work sessions

Every `$DSH_HOME` owns exactly one Explain learning thread. Individual work sessions contribute material, but resumes and forks never copy the learning state.

- Each source session has at most one explanation awaiting feedback.
- All work sessions display the same global history in the first-party **Learning** tab.
- One global scheduler serializes manual explanations, reviews, autonomous evaluation, rephrases, and compaction.
- The default autonomous budget is 50 requests per rolling 24 hours and survives restarts.
- A private `ExplainContext` tracks explanation preferences, knowledge level, and learning progress.
- When structured observations or closed explanations are pending, auxiliary history compacts after 30 minutes without an Explain action, or before a request would exceed 50% of the selected model's context window.

## Own your learning data

Open **Settings → Learning → Data management** to download `dsh-explain-backup-v2.json`. The versioned backup contains learning cards, Topic state, review schedules and outcomes, and the public `ExplainContext` projection; it excludes full source sessions, private source summaries, credentials, and absolute host paths.

The same page can clear all learned content after you type `CLEAR`. Explain first cancels and fences in-flight generation, then removes the learning thread and context in one SQLite transaction. Auxiliary-model settings, the enabled state, and the current rolling 24-hour autonomous-usage count are deliberately preserved.

## Local-first by design

| Data | Behavior |
|---|---|
| Learning thread | Stored in `$DSH_HOME/dsh-explain/v1/thread.sqlite`. |
| Enablement and model settings | Stored through DSH settings in `$DSH_HOME/settings.yaml`. |
| Source material | Reduced to bounded capsules; rephrasing retains at most a 2,000-character restricted source summary. |
| Global learning context | Sent only to the auxiliary Explain model, never to the primary agent. |
| Primary session | Never receives Explain events, prompts, or learning context. Primary turns are not blocked. |

Explain uses first-party DSH `conversation.view`, composer, assistant-action, and settings extension points. It does not require `better-sidebar` or patches to other plugins.

## Compatibility and verification

- Published compatibility line: DSH `0.1.1-rc.2`.
- Compatibility-branch target: DSH `0.1.2-alpha.3`.
- Unit suite: 70 tests.
- Assembled DSH Web acceptance: 5 scenarios.
- Explain-owned shortcut acceptance: 3 M6 scenarios.
- Real-model workflow evidence: [PR #16](https://github.com/yuezengwu/dsh-explain/pull/16).
- Detailed acceptance matrix: [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).

DSH is still a developer preview. Explain follows the current public API line and does not retain compatibility layers for earlier private-preview packages.

## Local development

On this compatibility branch, the default development install uses the published 0.1.2-alpha.3 API packages. Assembled-Web tests also need a built DSH 0.1.2-alpha.3 source checkout:

```sh
pnpm install
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run dsh:link
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run dsh:link:check
pnpm run typecheck
pnpm test
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run test:web
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run test:m6
pnpm run build
```

Install this checkout directly for manual development:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-explain
dsh --profile web --dump-config
dsh --profile web
```

`test:web` starts a fresh keyless DSH Web composition and verifies the Learning view, settings, source navigation, and missing-source fallback. `test:m6` installs only Explain and verifies both editable-draft shortcuts plus clean unload and reinstall behavior.

## Documentation

| Document | Purpose |
|---|---|
| [Product requirements](docs/PRD.md) | User model, scope, policies, and acceptance criteria. |
| [Architecture](docs/ARCHITECTURE.md) | Persistence, scheduling, RPC, UI integration, and failure behavior. |
| [Acceptance matrix](docs/ACCEPTANCE.md) | Automated and real-flow evidence. |
| [Iteration plan](docs/NEXT.md) | Current follow-up work and sequencing. |

The detailed design documents are currently written in Chinese.

## License

[MIT](LICENSE)
