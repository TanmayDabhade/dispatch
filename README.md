# Dispatch

Mission control for coding agents. Create a task, dispatch an agent, watch it
work — runs, review, and merge in one desktop app.

<!-- TODO(asset): docs/assets/dispatch-hero.gif — task → dispatch → review loop -->

- **Your repo stays yours.** `.dispatch/` holds config you would want to commit
  anyway. Point a project at the daemon's database (`dispatch init --db`) and
  `dispatchd` owns the tasks, findings and history outright, writing them to a
  git-versioned receipt log _outside_ your repo — a full audit trail with no
  churn in your own diffs. Or keep the default and have every task be a markdown
  file in `.dispatch/tasks/*.md`, synced by git.
- **Agents run with guardrails.** A task declares the paths it may write before
  the agent starts; runs carry budget and turn caps, verify gates, and
  human-gated scope escalation.
- **Everything is on the record.** Findings, decisions, evidence, and
  transcripts from every run are kept — reviewable, not scrolled past.
- **Local-first.** Runs on your machine, against your checkout, with your API
  key. No account, no server, nothing uploaded.

## Install

Desktop app for macOS via Homebrew:

    brew install --cask wsoule/tap/dispatch

Or grab an installer from the
[latest release](https://github.com/wsoule/dispatch/releases/latest): macOS DMGs
(Apple Silicon and Intel) and Linux `.deb`/`.rpm`/`.AppImage`. macOS builds are
signed and notarized (Developer ID).

On macOS, installing the app also puts the `dispatch` CLI on your `PATH` (the
cask links the binary bundled inside `Dispatch.app`).

## Quickstart

In any git repo:

    dispatch init
    dispatch task create "My first task" --priority high
    dispatch task list
    dispatch task next
    dispatch doctor

To keep the tasks in the daemon's database instead of markdown files, use
`dispatch init --db` (and start `dispatch serve` before creating tasks — only
the daemon may open the database). See [How it works](#how-it-works).

Then open the Dispatch app and point it at the repo: the board shows your tasks,
and dispatching one hands it to a coding agent in an isolated git worktree —
live output, review, and merge all happen in the app.

Every read command accepts `--json` for agent/script consumption.

`dispatch init` also registers Dispatch's MCP server in the project's
`.mcp.json`, so tools like Claude Code can read and write the same tasks — see
[MCP server](#mcp-server).

## How it works

A task carries frontmatter — status, priority, `blocked-by`, declared `writes`
paths, and more — and a human-readable body. The CLI, the desktop app, the MCP
server and the orchestrator all reach the same task through `dispatchd`, which
is the single writer.

Where that state lives is a per-project choice, recorded in
`.dispatch/storage.json`:

- **Files** (the default) keeps every task as markdown in
  `.dispatch/tasks/*.md`, committed to your repo. Git is both the sync layer and
  the history, and the CLI can read the board with no daemon running.
- **Database** (`dispatch init --db`, or `dispatch migrate` for a project you
  already have) keeps them in a SQLite database only `dispatchd` may open. Your
  `.dispatch/` shrinks to `config.yml`, `team.yml` and the marker; the database
  is gitignored, and the audit trail reaches git as a _receipt log_ — a
  standalone repository under `~/.dispatch/projects/<id>/receipts` that the
  daemon commits to as things change. Because that log is laid out exactly like
  a file-backed project, restoring it needs no special tooling: copy its
  `.dispatch/` into a repo and it is a working board again.

  On this backend `dispatch task` commands go through the daemon, so start one
  (`dispatch serve`) before creating tasks.

Dispatching a task runs a coding agent in an isolated git worktree, scoped to
the task's declared `writes`. Touching anything else requires a human-gated
scope request at runtime; runs carry budget (`maxBudgetUsd`) and turn caps, and
verify gates check exit criteria before review. Findings, rulings, evidence, and
decisions from each run are recorded alongside the tasks.

`dispatchd`, a local daemon, watches the repo and feeds the app live runs,
review, and merge. It is local HTTP only — nothing leaves the machine.

### Moving a project to the database

An existing project moves in two deliberate steps, with the daemon stopped:

    dispatch migrate --dry-run    # rehearse: report what would move, write nothing
    dispatch migrate              # import tasks, findings and ledger into the database

The import is additive — it copies, never moves, so it is safe to re-run and
your markdown is untouched if anything goes wrong. Once the daemon has been up
long enough to export a receipt log, retire the copies it left behind:

    dispatch migrate --retire --dry-run
    dispatch migrate --retire

`--retire` deletes only what the receipt log already contains, checked record by
record, and reports anything it kept and why. Three files stay behind on
purpose: `fix-loops.jsonl`, `notes.json` and `inbox/` have no table in the
database yet, so the daemon still writes them as ordinary files and the receipt
log does not carry them. On the database backend they are gitignored rather than
committed.

## Working in the app

Beyond the board and review, the app carries the surfaces you would otherwise
leave it for.

**Terminals.** Shells on the repo or on a run's worktree, split any number of
ways. The child runs under a real pty, so prompts, colour and full-screen
programs behave normally, and scrollback is kept on disk — closing the window,
or restarting `dispatchd`, does not lose what a session printed. A session the
daemon inherits from a previous process comes back readable but not writable.

**Files.** Browse and edit a checkout — the project's, or one run's worktree —
with an editor that saves as you type and previews for Markdown, images, PDFs,
audio and video. `⌘P` is fuzzy quick open across everything `git ls-files` knows
about, so build output and dependencies stay out of the results.

**Design.** Open your app in a browser Dispatch drives, click the element that
is wrong, and get its selector, markup, computed styles and a cropped screenshot
as text to hand an agent. Needs a Chromium-based browser (Chrome, Chromium, Edge
or Brave) on the machine; set `CHROME_PATH` if it is somewhere unusual.

    dispatch browser open http://localhost:5173
    dispatch browser pick <id> --out element.png
    dispatch browser snapshot <id> --out page.png

**Worktrees and remotes.**

    dispatch worktree create feature/login
    dispatch worktree list --json
    dispatch remote list
    dispatch remote exec build-box -- pnpm test
    dispatch remote forward build-box 5173

Remotes are declared in `.dispatch/config.yml`; everything else about the
connection comes from your own `~/.ssh/config`:

    remotes:
      build-box:
        host: build-box
        path: /srv/repo

Terminals can be opened on a remote. Agent runs cannot — the orchestrator works
in local worktree paths throughout.

## Running more than one agent

Dispatch ships native executors for Claude and Codex. Any other coding agent
that takes a prompt on the command line can be declared and dispatched:

    executors:
      gemini:
        command:
          run: [gemini, '-p', '{prompt}']

`{prompt}` and `{model}` are substituted before the process starts; an argv with
no `{prompt}` gets the prompt on stdin instead. Well-known agents already on
your `PATH` are offered without any config at all. A CLI agent has no approval
protocol, so runs on one are refused under permission modes that imply a human
gate, and neither cost nor turns are reported.

To try the same work several ways at once:

    dispatch fanout <taskId> --executors claude,codex,gemini

Each agent gets its own clone of the task, its own worktree and its own branch,
so comparing them is the review you already do — one diff each — and merging the
winner is merging that task.

## Sharing a run

    dispatch share r-abc123
    dispatch share r-abc123 --out review.html

Writes a self-contained HTML page of one run — summary, diff, findings,
decisions, evidence and transcript — with no scripts, no remote assets and no
link back to the project. It is a file you can attach to a ticket, hand to a
reviewer who has never installed Dispatch, or keep as the receipt for what an
agent did. `--json` prints the assembled data instead, for feeding a different
template.

## Previewing a run

A run's work is a diff until you can look at it. `dispatch serve` will start a
dev server inside a finished run's own worktree and proxy it at
`/preview/<runId>/`, which the desktop app shows in the task's **Preview** tab.
The command is detected from the worktree's `package.json` (`dev`, else
`start`); set `preview.command` in `.dispatch/config.yml` to name one yourself,
and `preview.installCommand` for a fresh worktree that needs dependencies first:

    preview:
      enabled: true
      command: pnpm run dev
      installCommand: pnpm install
      readyTimeoutSec: 180
      idleTimeoutSec: 900

Previews start only when asked for, stop with the daemon, and are swept once
they have had no request for `idleTimeoutSec`.

## Working as a team on one daemon

A daemon is yours by default: it binds `127.0.0.1` and nothing else can reach
it. Team-local mode lets teammates on your network use the same board from a
browser, each as themselves.

    moonx desktop:build                     # the bundle teammates are served
    dispatch serve --host 0.0.0.0           # prints the address to share
    dispatch team invite ada@example.com    # prints Ada's token, once

Ada opens the printed address, pastes her token, and is signed in. From then on
her findings, notes, scope decisions and dispatched runs are credited to
`human:ada`, not to you; the status strip shows who is connected and what each
is running; the Inbox badge counts only what is yours to answer, with teammates'
asks under **Teammates**; and the dispatch dialog warns, by name, before you
start work on files someone else's live run has claimed.

    dispatch team invite ada --tier decide  # let Ada approve, too
    dispatch team tokens                    # who holds a credential
    dispatch team revoke ada                # her token stops working at once

Each teammate holds one token at one tier, and each tier includes the ones below
it:

| Tier       | Adds                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------- |
| `request`  | The board, dispatching runs, reviewing and merging them, reading files                    |
| `decide`   | Approving tool calls and assistant actions, scope decisions, previews, inviting teammates |
| `operator` | Terminals, the driven browser, writing files, and git on this checkout — all as you       |

A new teammate gets `request`. Grant `operator` only to someone you would hand a
shell on this machine, because that is what it is. Nobody can grant, replace or
revoke a tier above their own, so a `decide` lead can invite reviewers but not
mint a shell. Inviting someone again replaces their token, which is also how you
change their tier.

Tokens are stored only as hashes, outside the repo, and are shown once — lose
one and issue a new one. Every `team` command needs the daemon's app token
(`--token` or `DISPATCH_APP_TOKEN`), or a teammate token at `decide` or above.

What changes when the daemon is shared, and why:

- **No token is ever put in the served page.** On loopback the page carries the
  daemon's agent token; on a shared bind that would hand it to anyone who can
  reach the port, so teammates sign in with their own.
- **Only the daemon's own address is a trusted origin**, never whatever a Host
  header claims, so a DNS-rebinding page cannot pass for a teammate.
- **Live previews stay on your machine.** A preview has no credential of its
  own, so it is served only to loopback; teammates see the diff and can be sent
  a `dispatch share` page instead.
- `--host` accepts `127.0.0.1` or `0.0.0.0` only. A single interface address
  would stop the daemon answering on loopback, where the CLI, MCP server and app
  reach it.

This is plain HTTP on your network, like any dev server — run it on a network
you trust, or put it behind a TLS-terminating proxy and name that origin with
`--public-origin`.

## MCP server

`dispatch init` registers a stdio MCP server in the project's `.mcp.json`
(created or merged — existing servers and keys are preserved):

    {
      "mcpServers": {
        "dispatch": { "command": "dispatch", "args": ["mcp"] }
      }
    }

Pass `--no-mcp` to skip this. Start the server directly with `dispatch mcp`
(reads the current directory) or the standalone `dispatch-mcp --root <dir>`
binary from `@dispatch/mcp`.

On the file backend the five `task_*` tools operate directly on
`.dispatch/tasks/*.md` and need no daemon (a running `dispatchd` picks up their
file changes through its watcher like any other edit); on the database backend
they go through the daemon like everything else. The other nine always talk to
`dispatchd` over its local HTTP API, and return a clear error when it isn't
running.

Tools (server name `dispatch`):

| Tool              | Input                                                                                                        | Output                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `task_list`       | `{ status?, kind?, parent? }`                                                                                | `{ tasks: TaskSummary[], problems: string[] }` |
| `task_get`        | `{ id }`                                                                                                     | `{ meta, body }`                               |
| `task_save`       | `{ id?, title?, status?, kind?, parent?, blockedBy?, labels?, priority?, assignee?, description?, writes? }` | `{ meta, body }`                               |
| `task_comment`    | `{ id, text }`                                                                                               | `{ meta }`                                     |
| `task_next`       | `{}`                                                                                                         | `{ tasks: TaskSummary[], problems: string[] }` |
| `run_list`        | `{}`                                                                                                         | `{ runs, note? }`                              |
| `agent_message`   | `{ runId? \| taskId?, text }`                                                                                | `{ ok, runId }`                                |
| `message_user`    | `{ text }`                                                                                                   | `{ ok, runId }`                                |
| `ask_user`        | `{ question, options? }`                                                                                     | `{ answer }`                                   |
| `request_scope`   | `{ paths, reason }`                                                                                          | `{ granted, reason }`                          |
| `dispatch_note`   | `{ kind, title, body? }`                                                                                     | `{ ok, id }`                                   |
| `record_decision` | `{ kind, title, detail, appliesTo? }`                                                                        | `{ ok, id }`                                   |
| `record_evidence` | `{ command, exitCode, durationMs, summary }`                                                                 | `{ ok }`                                       |
| `record_mutation` | `{ guard, file, testsFailed }`                                                                               | `{ ok }`                                       |

`task_save` creates when `id` is omitted (title required) and updates only the
given fields otherwise; `kind` and `description` take effect on create only.
`ask_user` and `request_scope` block until a human answers or the wait times
out. A `workflow://onboarding` resource briefs a connecting agent on the same
conventions. See `docs/archive/plans/2026-07-20-phase-3-mcp-server.md` for the
original design.

## Dependency graph with Carto (optional)

Dispatch can use [Carto](https://github.com/theanshsonkar/carto) to compute
which files a change can break, which narrows code-review scope to the actual
blast radius instead of just the changed files. Without it, Dispatch falls back
to a built-in scanner that only understands TypeScript/TSX — on a Go, Python, or
Rust repo it finds nothing, and review scope silently shrinks to the changed
files alone. `dispatch doctor` reports which backend is in use, including a
warning when there's neither carto nor TypeScript to work from.

    npm install -g carto-md

`carto.enabled` in `.dispatch/config.yml` controls the policy (default `on`):
`on` builds a carto container if one is missing, `detect` uses one only if it
already exists, and `off` sticks to the built-in scanner. `on` is a build
policy, not a requirement — a missing `carto` binary always degrades to the
scanner rather than failing. Whatever builds the container — `dispatch init` or
the daemon on a project that upgraded into this — adds the `.carto/` build
output to `.gitignore` automatically.

<details>
<summary>Troubleshooting the Carto install</summary>

carto's native dependencies (`better-sqlite3`, `tree-sitter`) don't build on
every Node version: in our testing only `npm install -g` under Node 22 LTS
produced a working install; newer Node lines failed to compile the bindings, and
`bun install -g` did not produce a working native build. A half-built install is
easy to miss, because `carto --version` answers fine without loading a single
native module — `dispatch doctor` runs carto's own `doctor` to catch it.

carto's MCP server (`carto serve`) is wired into dispatched agents' tool config
from carto 2.1.4 onward. Earlier releases started the server without connecting
its transport ([carto#9](https://github.com/theanshsonkar/carto/issues/9)), so
Dispatch withholds the MCP entry below that version rather than spawning one
that answers nothing. Blast radius is unaffected either way: that path reads the
container as a library, not over MCP.

</details>

## Development

All six roadmap phases are complete — tracker core, CLI, `dispatchd`, the MCP
server, the desktop app, and the orchestrator. Roadmap:
`docs/archive/plans/2026-07-13-dispatch-roadmap.md`.

To run the CLI from a checkout instead of the installed app:

    proto use && pnpm install && moon run :build
    node packages/cli/dist/cli.js init
    node packages/cli/dist/cli.js doctor

pnpm + moon monorepo (dependency catalog in `pnpm-workspace.yaml`, tsdown
builds, `bun test`, oxlint/oxfmt). From anywhere in the repo: `moon run :build`,
`moon run :test`, `moonx <project>:typecheck`, `moon run root:format`,
`moon run root:lint`. Agent conventions live in `AGENTS.md` and
`.agents/skills/`.

### Daemon + web UI

`apps/desktop` is the product's UI and where frontend work happens;
`packages/web` is frozen as a browser fallback.

Run the daemon and the web UI's dev server side by side for live-reloading
frontend work:

    bun packages/server/src/bin.ts --root <path-to-a-dispatch-repo> --port 4771
    moonx web:dev

`moonx web:dev` proxies `/api` and `/ws` to `http://127.0.0.1:4771` (see
`packages/web/vite.config.ts`), so the Vite dev server on its own port talks to
a real dispatchd. For a production-style check, `moonx web:build` builds the web
UI into `packages/web/dist`, then dispatchd serves it directly — no separate
frontend server needed. `dispatch serve` / `dispatch ui` (from `@dispatch/cli`)
wrap this daemon for end users.

## Design docs

- **Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** — what the
  system is today. Start here.
- Historical plans, specs, and research live in
  [`docs/archive/`](docs/archive/README.md). They record why decisions were made
  and are not maintained; where they disagree with `ARCHITECTURE.md`, the
  architecture doc is the checked one.

## License

Dispatch is open core — see [`LICENSING.md`](LICENSING.md) for the
plain-language map:

- **MIT** — the integration surface: `@dispatch/core`, `@dispatch/client`,
  `@dispatch/cli`, `@dispatch/mcp`. Build on the task model, drive the daemon,
  or embed the MCP tools without a license review.
- **[FSL-1.1-ALv2](LICENSE)** — the desktop app and the daemon/orchestrator.
  Source-available, not OSI open source: read, build, modify, self-host, and
  redistribute for any purpose except shipping a competing product or service.
  Internal use, non-commercial education and research, and professional services
  you deliver to a licensee are all explicitly permitted. **Each release
  converts to Apache-2.0 two years after it ships**, irrevocably.
- **Commercial** — team features (presence, claims, shared run visibility, web
  dashboard, audit) live in the team server, a separate private repo
  ([direction](docs/TEAM-SERVER.md)). The solo app is complete without it.

Versions up to and including v0.13.1 were published under Apache-2.0 and remain
Apache-2.0 forever.
