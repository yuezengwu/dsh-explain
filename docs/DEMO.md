# dsh-explain product demo

This document keeps the repository showcase reproducible and separates real product evidence from decorative artwork.

## Visitor story

The demo follows one compact learning loop:

1. **Capture** — turn a finalized DSH answer into an editable `/explain --answer` draft without submitting it automatically.
2. **Review** — open the global learning thread, see a scheduled review and inspect a structured explanation card.
3. **Adapt** — mark a concept understood, correct one inferred explanation preference, and export the local learning data.

The final caption is the product promise: **Work once. Learn continuously.**

## Recording contract

- DSH source: built `0.1.2-rc.1` checkout supplied through `DSH_SOURCE_DIR`.
- Version gate: the recorder rejects a source checkout whose root package version is not exactly `0.1.2-rc.1`.
- Surface: real assembled DSH Web with the local `dsh-explain` checkout installed as a plugin.
- Data: deterministic English fixture content created under a temporary `DSH_HOME`; no personal sessions, paths, credentials, or network model calls.
- Model route: a keyless route-only replay catalog so the real runtime is enabled without transmitting data.
- Presentation: browser interactions are real. The recording script adds only captions and a temporary focus ring; it does not replace or synthesize product UI.
- Cleanup: the temporary DSH home, workspace, replay fixture, authenticated URL, and raw recording are removed after export.

## Outputs

| Asset | Purpose |
|---|---|
| `docs/assets/dsh-explain-demo.mp4` | Full high-quality demo linked from the README. |
| `docs/assets/dsh-explain-demo.gif` | Autoplaying README preview. |
| `docs/assets/demo-capture.png` | Real answer-to-draft state. |
| `docs/assets/demo-learning.png` | Real review and learning-thread state. |
| `docs/assets/demo-profile.png` | Real corrected learner-profile state. |
| `docs/assets/demo-data.png` | Real local data-management state. |
| `docs/assets/showcase-hero.png` | README hero composed from the real UI and decorative background. |
| `docs/assets/social-preview.png` | 1280×640 GitHub social preview candidate. |

## Commands

The recorder requires the repository dependencies, a Playwright Chromium install, `ffmpeg`, and a built DSH `0.1.2-rc.1` source checkout.

```sh
DSH_SOURCE_DIR=/absolute/path/to/deepseek-harness pnpm demo:record
pnpm demo:showcase
```

`demo:record` rebuilds the plugin, starts DSH with `--no-open`, records the flow, and exports the video, GIF, and four evidence stills. `demo:showcase` renders the README hero and social preview locally from `demo-profile.png`.

## Decorative background provenance

The file `docs/assets/learning-loop-background.png` was generated with the built-in image generation tool and this prompt:

> A refined abstract visual representing a private continuous learning loop, with three softly glowing nodes connected by one elegant orbit; deep charcoal and midnight-blue matte background; restrained cobalt and cyan light; extra-wide composition with negative space; no text, logos, people, devices, screens, UI, or watermark.

The generated background is decorative only. Every visible application screen comes from the real recording described above.

## GitHub presentation copy

- About: `Private, local-first continuous learning for DeepSeek Harness: capture, review, and correct what Explain learns.`
- Homepage: `https://dsh-hub.org/plugins/yuezengwu-dsh-explain`
- Topics: retain `deepseek`, `deepseek-harness`, `dsh`, `dsh-plugin`, `learning`, `local-first`, `sqlite`; add `spaced-repetition`; remove the implementation-only `typescript` topic.
- Release boundary: the showcase does not publish `v0.3.0`; release creation remains a separate approval.
