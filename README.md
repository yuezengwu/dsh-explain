**English** | [简体中文](README.zh-CN.md)

# dsh-explain — Learning mode for DSH

> ✅ **Status: the M6 Explain Host protocol is implemented and passes the automated gates. Optional consumer integrations are still in progress. The current minimum supported DSH version is `0.0.1-rc.2`.**
> See the [product requirements](docs/PRD.md) and [technical architecture](docs/ARCHITECTURE.md) for the full design. The detailed design documents are currently written in Chinese.

`dsh-explain` turns useful material from multiple [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) work sessions into one private, local-first learning thread. It keeps at most one active explanation per source session and continuously adapts explanations to the user's knowledge, preferences, and learning progress.

## Core behavior

- A `$DSH_HOME` contains exactly one local learning thread. Work sessions, resumes, and forks do not copy its state.
- Each top-level source session may have one explanation awaiting feedback, or none. While one remains open, that source cannot generate another; other sources may continue independently.
- Enter `/explain <learning request>` in the composer of an established or empty session to request an explanation. `/explain on`, `/explain off`, and `/explain status` manage the feature.
- Manual explanations, autonomous explanations, rephrases, and compaction share one global scheduler. At most one auxiliary model request runs at a time.
- Autonomous evaluation defaults to 50 requests per rolling 24-hour window. Usage survives restarts; failures and retries count, while manual explanations, rephrases, and compaction do not.
- A private global `ExplainContext` summarizes conversation preferences, knowledge level, and learning progress. It is sent only to the auxiliary model and is never injected into the primary agent.
- Auxiliary history is compacted after new structured observations or closed explanations remain untouched for 30 minutes, or before a request would exceed 50% of the selected model's context window. User-visible history is never deleted.
- The primary model does not know that Explain exists. Explain does not write to the primary session log, modify the primary model context, or block the primary turn.
- Learning history, active-source state, compaction checkpoints, and `ExplainContext` are stored in `$DSH_HOME/dsh-explain/v1/thread.sqlite`. Enablement and model settings use `$DSH_HOME/settings.yaml`.
- The first entry of an explanation stores a restricted source summary of up to 2,000 characters for later rephrasing. Rephrasing still works after the source session is deleted, and the summary is not exposed through the learning-view API.
- The learning thread appears in the first-party `conversation.view` slot as a **Learning** tab. Configuration and diagnostics use the first-party `settings.section`; no external UI host is required.
- The Learning tab is session-scoped, but every tab reads the same global client store and typed Remote. All work sessions therefore display the same learning thread.
- The settings page controls the auxiliary model, enablement, and rolling autonomous-request budget, and reports routing, budget recovery, context pressure, and the latest compaction.
- If a source still exists in the current session inventory, its explanation can open it directly. Deleted sources remain readable and are marked unavailable.
- P0 never switches views automatically. Empty Hero sessions do not display view tabs, and the work-session composer remains available while the Learning view is open.
- P0 has no external UI dependency and does not bundle or require `better-sidebar`.

## Why

- DSH can complete complex work, but a result alone may not teach the concepts, tradeoffs, or common pitfalls involved.
- Explain turns ordinary work sessions into learning material without requiring users to know what to ask in advance.
- Learning state needs to remain coherent across work sessions, so all material enters one global thread while source-specific active explanations preserve local continuity.

## Progress

- [x] Product overlap review: no direct duplicate was found; related plugins provide implementation references only.
- [x] P0 PRD: one global thread, per-source active explanations, an autonomous-call budget, two compaction triggers, global `ExplainContext`, and automatable acceptance criteria.
- [x] Architecture v9: the v8 manual-learning semantics plus a closed Host protocol for selections and suggested replies, exact source resolution, and persisted origin labels.
- [x] UI path: first-party `conversation.view` registration following the `ui-trajectory` view-ring pattern, with no external UI dependency.
- [x] M1 infrastructure: standalone plugin build, local SQLite schema, entity-level CAS, pagination, long polling, and generated typed Remotes.
- [x] M2 implementation: source observation, single-flight auxiliary scheduling, durable budgets, rephrasing, dual-trigger compaction, `ExplainContext`, and the Learning view.
- [x] M2 real DSH Web/model flow and GIF acceptance evidence.
- [x] M3 release gates: P0 acceptance matrix, keyless assembled-Web snapshot, and installation/composition smoke tests.
- [x] M4 configuration and diagnostics: settings UI without YAML editing, concurrent-setting convergence, source navigation and missing-source fallback, shared diagnostics store, and expanded assembled-Web snapshot.
- [x] M5 manual learning command: `/explain <learning request>`, explicit-request scheduling, source labels, durable rephrase summaries, and stable failure results.
- [x] M6.1 Explain Host protocol: `--selection` and `--suggested <turn>` source resolution, origin persistence, rephrase propagation, and stable failures.
- [ ] M6 P1 optional integrations: selected text, suggested-reply learning actions, and visible Advisor suggestions enter the same learning loop through an editable `/explain` draft.

M1 established persistence and Host/Client RPC. M2 completed the learning loop. M3 added release gates. M4 made configuration, diagnostics, and source navigation available in the UI. M5 added user-initiated learning from the composer. M6 connects the same command protocol to optional plugin workflows. See the [acceptance matrix](docs/ACCEPTANCE.md) for automated evidence.

## Current iteration

M6 integrates `dsh-selection-chat`, `dsh-suggested-replies`, and `dsh-advisor` through the public DSH command catalog and composer-write path. It does not read private data owned by those plugins or add automatic model calls. The scope, cross-repository order, design review, and acceptance criteria are recorded in [docs/NEXT.md](docs/NEXT.md).

## Local development

The repository links DSH runtime packages from a built DSH source checkout instead of resolving them from npm. Prepare that checkout, install the public build dependencies, and create the local links:

```sh
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm install
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run dsh:link:check
pnpm run test
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run test:web
pnpm run typecheck
pnpm run build
```

The minimum development baseline is DSH `0.0.1-rc.2`. The plugin does not include the rc.1 TypeRT gateway compatibility layer.

`test:web` starts a real keyless DSH Web composition with a fresh temporary `$DSH_HOME`, a durable session fixture, and a pre-seeded Explain database. It compares the Learning and Settings ARIA output against golden snapshots and verifies native settings revisions, source navigation, and the missing-source fallback. To intentionally update the UI output, run `DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run test:web:refresh` and review the snapshot diff.

Install the development checkout directly rather than through npm:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-explain
dsh --profile web --dump-config
dsh --profile web
```

## Related design survey

The product goal has no direct duplicate. The following projects informed individual implementation choices but do not define this project's data model.

| Project | Reused idea | Deliberately not reused |
|---|---|---|
| `dsh-auto-blame` | Background model calls after a turn and client feedback patterns | External custom session events and projections are not used for Explain persistence |
| `dsh-advisor` | Transcript deltas, isolated model calls, emission guards, and configuration gateways | Advisor injects suggestions into the primary agent; Explain never injects the primary model |
| `dsh-memory` | Repository naming covers the long-term-memory direction | The placeholder contains no reusable service or protocol |
| `dsh-memory-evolve` | Cross-session layered memory, low-frequency snapshots, and user-visible management | Its snapshots enter the primary agent; Explain neither depends on nor reads its private files |
| DSH `compact-basic`, `token-meter`, and LLM model info | Capacity thresholds, deterministic token estimates, and routed `contextWindow` values | Native compaction modifies one session surface; Explain needs its own global SQLite compactor |
| DSH third-party memory MCP example | Optional interoperability reference for cross-session persistence | Model-initiated tool calls and an external provider do not fit automatic P0 `ExplainContext` updates |
| DSH `ui-trajectory` | `conversation.view` registration, session-header tabs, and active-only rendering | Trajectory uses a session-event view model; learning facts remain in Explain SQLite and Remotes |
| `DSH-better-sidebar` | Side-workbench interaction reference | P0 does not require simultaneous work and learning views, so it adds no sidebar service or dependency tree |
| `official-plugins-port` `claude/learning-output-style` and `claude/explanatory-output-style` | Learning and explanation prompt references | A system prompt alone cannot provide isolated scheduling, durable history, or a feedback loop |
| `dsh-edu` | Possible future knowledge-artifact formats | P0 does not implement courses, quizzes, cards, or spaced review |

## License

[MIT](LICENSE)
