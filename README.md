# onboard.computer

A macOS app that automates developer environment setup. Define your tools in a YAML config, share it with your team, and get everyone to a working setup in minutes.

**[Download](https://onboard.computer)** · **[Create Config](#config-format)**

---

## What it does

1. You write a `.onboard` file listing your dependencies, apps, and setup steps
2. Someone opens it (drag-and-drop, double-click, a URL, or an `onboard://` link)
3. They press **Set up my Mac** — one admin password prompt, then everything
   installs in dependency order, ending with a live checklist for the human
   steps (Connect GitHub, sign in to Claude Code, …) that ticks itself off
   as they complete them

No more "clone the repo and follow the README" where half the steps are outdated.

## New Mac, one line

```bash
curl -fsSL https://onboard.computer/install | sh
```

That downloads the latest release, installs it to /Applications, and opens it.
Teams can preload their config:

```bash
ONBOARD_CONFIG=https://onboard.computer/builder.onboard \
  curl -fsSL https://onboard.computer/install | sh
```

Or share a deep link in Slack — `onboard://load?url=https://…/team.onboard`
opens the app with the config loaded.

## Config format

The easiest way to write a config is the **shorthand**: list Homebrew
formulae, casks, and setup steps by name, and onboard.computer derives
everything else (id, display name, icon, check/install/uninstall/upgrade
commands).

```yaml
name: "My Team Setup"
description: "Everything needed for frontend development"

brew: [git, gh, node]                        # formulae -> Dependencies
cask: [rectangle, visual-studio-code]        # casks -> Apps
setup: [github, git-identity]                # setup steps, by recipe name
```

`xcode-cli` and `homebrew` are automatically added to the front of the list
whenever `brew:` or `cask:` is used — you don't need to list them yourself.

An entry can also be an object to override any derived field:

```yaml
brew:
  - git
  - pkg: pipx
    desc: Install Python CLI tools in isolated environments.
    install: brew install pipx && pipx ensurepath
```

### Built-in setup recipes

`setup:` accepts these recipe names out of the box:

- `github` — sign in and authenticate the GitHub CLI
- `git-identity` — prompts for your name/email and sets `git config --global`
- `claude` — opens Terminal to sign in to Claude Code
- `codex-auth` — opens Terminal to sign in to Codex

You can also inline a fully custom setup step by giving it an `id` plus
`check` (and whatever else it needs — `url`, `action`, `terminal`, `input`,
etc.):

```yaml
setup:
  - github
  - id: fieldtheory
    name: Field Theory
    desc: "Local voice transcripts and context management. Download the app and drag it to Applications."
    url: https://fieldtheory.com
    icon_img: fieldtheory-icon.png
    icon_bg: "#1a1a2e"
    check: ls "/Applications/Field Theory.app"
```

### Long form

The original long form still works, and can be mixed with shorthand in the
same file — handy when a tool needs a custom check/install the shorthand
can't derive:

```yaml
dependencies:
  - id: homebrew
    name: Homebrew
    desc: Package manager for macOS
    check: which brew
    install: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'

  - id: node
    name: Node.js
    desc: JavaScript runtime
    check: which node
    install: brew install node
    depends_on: homebrew

apps:
  - id: vscode
    name: VS Code
    desc: Code editor
    check: ls /Applications/Visual\ Studio\ Code.app
    install: brew install --cask visual-studio-code
    depends_on: homebrew
```

Each item needs:
- `id` — unique identifier
- `name` — display name
- `check` — shell command that succeeds (exit 0) if installed
- `install` — shell command to install it

Optional:
- `desc` — short description
- `depends_on` — id of another item that must be installed first
- `icon_img` — URL or filename in `assets/`
- `icon_bg` — hex color for icon background

### Derived checks

For shorthand formulae and casks, the `check` command is derived for you:
it looks for the binary on `PATH` (or the `.app` bundle for known casks)
and falls back to `brew list --versions` / `brew list --cask --versions`,
so an item still shows as installed even if it's not on PATH yet.

### Brewfile import

Point onboard.computer at an existing `Brewfile` and it's imported the same
way as a shorthand config: `brew "pkg"` and `cask "pkg"` lines become
Dependencies/Apps, and `tap "..."` lines add a step that runs `brew tap`
first. Unrecognized lines are ignored.

## Running locally

```bash
cd electron
npm install
npm run dev
```

## Building

```bash
cd electron
npm run package
```

Output goes to `electron/dist/`. Requires macOS and valid code signing credentials for distribution.

## Architecture

Vanilla Electron. No frameworks, no build step, no TypeScript.

```
electron/
├── main.js         # Main process — window, IPC, all shell execution
├── orchestrator.js # "Set up my Mac" engine — plan, elevated bootstrap, phases
├── config.js       # Pure config parsing/normalization (long form + shorthand)
├── brew.js         # Pure Homebrew command builders and output parsers
├── preload.js      # Bridge — exposes window.onboard API
├── renderer.js     # UI — state, rendering, user interactions
├── index.html      # Structure
├── styles.css      # Styles
└── examples/       # Sample .onboard configs
```

The renderer never touches Node directly — and it never sends shell commands
either. It addresses items by id over IPC; the main process holds the
validated config and is the only place commands are resolved and executed.

## How installs work

Per-item "Install" runs the item's `install` command with streaming output to
an inline terminal (or pop-out window), then re-runs `check` to verify.

**Set up my Mac** runs the whole config: if Xcode CLI Tools or Homebrew are
missing, one macOS admin prompt authorizes a bootstrap script that installs
the CLT headlessly and pre-creates the Homebrew prefix — after that, nothing
needs sudo. Missing formulae install as a single batched `brew install`,
casks install one at a time for per-item progress, custom items run in
`depends_on` (topological) order, and failures mark their dependents as
skipped instead of silently stalling. Setup steps then poll their `check`
until you've finished them.

Run `npm test` in `electron/` for the config/brew unit tests.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).

## Assisted setup preview

The app opens with support-call essentials: choose ChatGPT or Claude, inspect
installed applications, and continue with a state-aware prompt. Builder remains
available as an optional configuration. Existing user-selected configurations
continue to reopen normally.

The Field Theory preview app owns account, permissions, recording preferences,
and Parakeet readiness. Onboard reads its authenticated loopback setup API using
`~/.fieldtheory/browser-helper.json`; connection credentials never enter the
renderer or copied prompt. Old app versions and unavailable helpers remain
unknown. A real call recording and host computer-use test are still required.

`shared/setup-prompt.js` is the canonical prompt. Its browser and Electron copies
are `website/setup-prompt.js` and `electron/setup-prompt.js`; update all three
together. Official marketplace listings are not published; the site states this
and offers native setup as the fallback. Preview app versions do not check the
production auto-update feed.
