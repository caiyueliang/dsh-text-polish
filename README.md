# dsh-text-polish

A composer button for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that rewrites your draft **in place** with the model you already selected: ordinary prose is polished, and a task-like draft is expanded into a detailed, ready-to-send request.

English | [中文](./README.zh.md)

## What it does

Type a rough message in the composer and press **润色 / Polish** in the composer tool row (left of the send button, next to the mode chips):

- **A task, instruction, or request** — `帮我看看这个报错` — is expanded and refined: goal and context, deliverable and format, constraints and boundaries, acceptance criteria, ordered steps where useful.
- **Ordinary prose, questions, or chat** — `今天开会说到下个季度的目标 大概就是提升转化` — is only polished: typos, grammar, punctuation, CJK/Latin spacing, filler, and word order. It is not padded out to look longer.

Either way the result replaces the draft; nothing is sent until you send it.

## Install

```sh
# from npm (prebuilt artifacts)
dsh plugin add dsh-text-polish

# from a git host (this package is plain JavaScript, so there is no build
# script and no pnpm build allowlist to approve)
dsh plugin add github:caiyueliang/dsh-text-polish

# from a tarball
pnpm pack && dsh plugin add ./dsh-text-polish-1.0.0.tgz
```

Add `--profile <name>` to target a profile other than the default one:

```sh
dsh plugin --profile web add dsh-text-polish
```

The bundle inserts one plugin row. A **running** `dsh` process loads the host half only at startup, so restart it after installing; an already open page picks up the browser half by itself.

## Use

1. Type a message in the composer.
2. Click **润色 / Polish**.
3. The draft is replaced by the rewrite — read it, edit it if you like, then send.

The same rewrite is available as a command, which is handy from other clients:

```
/polish 帮我看看这个报错
```

The command returns the rewritten text as its result; when invoked from the composer button, that text is written back into the draft.

## Behaviour details

- **Model**: whatever the model selector currently shows (`agentDefaultModel.currentSelection()`), falling back to the first registered provider and its first model. There is no per-plugin model setting.
- **Language and content**: the original language, intent, tone, and identity are preserved. Facts the draft never mentioned — names, paths, numbers, dates, amounts, versions — are not invented. Code, commands, paths, URLs, proper nouns, and Markdown structure pass through unchanged.
- **Concurrency safety**: the rewrite never overwrites edits you made while it was running. If the draft changed, you get `输入框内容已变化，未替换` and your newer text stays.
- **Input cap**: drafts longer than 8000 characters are refused before any model call.
- **Session log**: the text being rewritten is never written to the session log (the command declares `recordInput: false`). A small `/polish` command row still appears in the conversation, because the browser half reaches the host through the shipped command registry and every resolved command logs a `command/run` / `command/done` pair; that row's summary is the rewrite.

## Scope

This plugin is deliberately minimal: one button, one command, no dialog, no preview, no undo, no cache, no configuration, no extra service. The whole rewrite policy is a single prompt you can read and edit ([`SYSTEM_PROMPT`](./index.js)).

If you want a guided flow with clarification questions, editable previews, multiple providers, and a settings page, the community already has richer prompt-optimizer plugins — see the [community registry](https://github.com/vbarter/dsh-plugin-registry).

## Compatibility

Developed and verified against DeepSeek Harness `0.2.1-alpha.1` (web profile). It depends on the shipped `commands` registry and `llm` service, and the browser half targets the web client.

## Files

| File | Role |
|---|---|
| `index.js` | Host half: the rewrite policy, the `/polish` command, and the single model call. |
| `client.js` | Browser half: the button registered into `conversation.input.left`. |
| `cordis.patch.yml` | The bundle layer that inserts the plugin row. |
| `locale/en.json`, `locale/zh.json` | Plugin Manager title and description. |
| `icon.svg` | Plugin artwork. |

### Local development

```sh
dsh plugin add /absolute/path/to/this/checkout
```

- Editing `index.js` (the prompt, the command) requires restarting `dsh`.
- Editing `client.js` (the button) reloads in an open page by itself.

## Known limitations

- Web client only; there is no TUI entry point.
- One `/polish` command row is added to the conversation per rewrite.
- No preview, no undo, and no result cache, by design.
- 8000-character input cap and no attachment handling.

## License

[MIT](./LICENSE). Not affiliated with DeepSeek.
