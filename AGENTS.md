# AGENTS.md

### Overview

Flow Browser is an Electron-based web browser built with React 19, TypeScript, Vite, and TailwindCSS 4. It uses an embedded SQLite database (via `better-sqlite3` / Drizzle ORM) and has no external backend services.

### Prerequisites

- **Node.js v22+** (see `.nvmrc`)
- **Bun v1.2.0+** (package manager; lockfile is `bun.lock`)
- **build-essential** and **python3** (for native module compilation via node-gyp)

### Key commands

Standard dev commands are in `package.json`. Quick reference:

| Task           | Command         |
| -------------- | --------------- |
| Install deps   | `bun install`   |
| Lint           | `bun lint`      |
| Typecheck      | `bun typecheck` |
| Dev mode       | `bun dev`       |
| Dev with watch | `bun dev:watch` |
| Format         | `bun format`    |

### Running the Electron app in headless / cloud environments

- The `postinstall` script (`electron-builder install-app-deps`) rebuilds native modules automatically during `bun install`.

### Before pushing changes

- Make sure to run `bun run lint`, `bun run typecheck`, `bun run format` and address any issues, or the CI might fail.

### Gotchas

- The `electron` dependency is installed from a Castlabs fork (`@castlabs/electron-releases`) for Widevine DRM support. This is normal and expected.
- There are no automated test suites (no `test` script in `package.json`). Validation is done via `bun lint` and `bun typecheck`.
- Animation imports use `motion/react` (not `framer-motion`).

### `src/main/blocklist/blocklist.json` is user-owned

Each user supplies their own blocklist, so the tracked copy in the repo is only a placeholder. Two things make this work, and both are easy to break:

- **It must stay tracked.** `src/main/blocklist/blocker.ts` imports it statically, so the file has to exist or the build fails. That is why it appears in `.gitignore` anyway: the entry is there to document intent, not to untrack the file.
- **It must be a valid JSON array of strings** (`["example.com"]` or `[]`). A bare string such as `example.com` is not valid JSON and breaks the build for fresh clones.

Local edits are protected with git's `skip-worktree` flag, because `.gitignore` alone does nothing for a tracked file — a rebase or pull will silently overwrite the local list. Check it with `git ls-files -v src/main/blocklist/blocklist.json` (a leading `S` means it is skipped).

```sh
# Normal case: just edit the file, git ignores it.
# Before pulling a change to this path from upstream, temporarily unskip it:
git update-index --no-skip-worktree src/main/blocklist/blocklist.json
git pull
git update-index --skip-worktree src/main/blocklist/blocklist.json
```

Do not commit a populated blocklist by accident. If that happens, restore the placeholder with `git checkout HEAD -- src/main/blocklist/blocklist.json`.

### Measuring memory usage

Tab renderers dominate RAM, and source inspection cannot quantify that. Start the app with `FLOW_MEMORY_MONITOR=1` to print a periodic report that correlates `app.getAppMetrics()` pids with tab web contents, showing per-process-type totals plus the largest individual processes with their tab URLs and awake/asleep counts. It is opt-in and costs nothing when the variable is unset. See `src/main/modules/memory-monitor.ts`.

## Cursor Cloud specific instructions (Ignore if not running on Cursor Cloud)

- The VM already has a display at `DISPLAY=:1`. Run `bun dev` directly; no `xvfb-run` wrapper is needed.
- GLib-GObject and D-Bus warnings in the Electron stderr output are harmless on headless Linux and can be ignored.
- On first launch, Flow Browser shows an onboarding wizard that must be completed before the main browser window appears.
