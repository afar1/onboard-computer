---
name: onboard-computer
description: Use when the user wants to generate a .onboard file from a codebase, scan a repo for dependencies, create an onboard config, bootstrap an onboard setup, or says "onboard-computer". Triggers on "onboard computer", "onboard-computer", "generate onboard", "make onboard", "scan dependencies", "onboard file", "create onboard".
version: 2.0.0
argument-hint: [name] [--minimal]
---

# Create Onboard Config

Scan the current repository and generate a `.onboard` YAML config file that captures all the dependencies (and optionally apps) needed to develop on this project.

## When This Skill Applies

- User says `/create-onboard` or asks to generate an onboard config
- User wants to capture a project's dev environment as an `.onboard` file
- User wants to make it easy for others to set up this codebase

## How It Works

### Phase 1: Scan the Codebase

Search for these signals in the current working directory to detect the stack:

**Package/dependency files** (search for all of these):
| File | Signals |
|------|---------|
| `package.json` | Node.js, npm; check for `yarn.lock`/`pnpm-lock.yaml`/`bun.lockb` to detect package manager |
| `requirements.txt` / `pyproject.toml` / `setup.py` / `Pipfile` / `poetry.lock` | Python |
| `Cargo.toml` | Rust |
| `go.mod` | Go |
| `Gemfile` | Ruby |
| `composer.json` | PHP |
| `build.gradle` / `pom.xml` | Java/Kotlin |
| `Package.swift` | Swift |
| `mix.exs` | Elixir |
| `pubspec.yaml` | Flutter/Dart |

**Infrastructure & tools** (search for all of these):
| File/Pattern | Signals |
|-------------|---------|
| `Dockerfile` / `docker-compose.yml` / `docker-compose.yaml` | Docker |
| `.github/` directory | GitHub CLI useful |
| `.terraform/` / `*.tf` | Terraform |
| `serverless.yml` | Serverless Framework |
| `.env.example` / `.env.sample` | Check **variable names only** for service references (DATABASE_URL → PostgreSQL, REDIS_URL → Redis). **NEVER read `.env` — it contains secrets.** Only read `.env.example` or `.env.sample`. |

**Database signals** (grep dependency manifests like `package.json`, `requirements.txt`, `Gemfile` — never `.env`):
- PostgreSQL: references to `pg`, `psycopg`, `postgres` in dependency names
- MySQL: references to `mysql`, `mysql2` in dependency names
- Redis: references to `redis`, `ioredis` in dependency names
- MongoDB: references to `mongodb`, `mongoose` in dependency names
- SQLite: references to `sqlite`, `better-sqlite3` in dependency names

### Phase 2: Build the Dependency Tree

Every `.onboard` file should include these **foundational dependencies** (they're always needed on macOS):

```yaml
# Always include these first:
- xcode-cli    # Foundation for all dev tools
- homebrew     # Package manager (depends on xcode-cli)
- git          # Version control (depends on homebrew)
```

Then add **project-specific dependencies** based on what was detected. Common mappings:

| Detected | Dependency ID | Name | Check | Install | Icon |
|----------|--------------|------|-------|---------|------|
| Node.js | `node` | Node.js | `which node` | `brew install node` | icon_img: nodejs.svg, icon_bg: "#333" |
| Python | `python` | Python 3 | `which python3` | `brew install python` | icon_img: python.svg, icon_bg: "#306998" |
| Rust | `rust` | Rust | `which rustc` | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` | icon: "🦀", icon_bg: "#CE422B" |
| Go | `go` | Go | `which go` | `brew install go` | icon: "🔵", icon_bg: "#00ADD8" |
| Ruby | `ruby` | Ruby | `which ruby` | `brew install ruby` | icon: "💎", icon_bg: "#CC342D" |
| PHP | `php` | PHP | `which php` | `brew install php` | icon: "🐘", icon_bg: "#777BB4" |
| Java | `java` | Java | `which java` | `brew install openjdk` | icon: "☕", icon_bg: "#ED8B00" |
| Elixir | `elixir` | Elixir | `which elixir` | `brew install elixir` | icon: "💧", icon_bg: "#6E4A7E" |
| Dart/Flutter | `flutter` | Flutter | `which flutter` | `brew install --cask flutter` | icon: "🦋", icon_bg: "#02569B" |
| Bun | `bun` | Bun | `which bun` | `brew install oven-sh/bun/bun` | icon_img: bun.svg, icon_bg: "#fbf0df" |
| Yarn | `yarn` | Yarn | `which yarn` | `brew install yarn` | icon: "📦", icon_bg: "#2C8EBB" |
| pnpm | `pnpm` | pnpm | `which pnpm` | `brew install pnpm` | icon: "📦", icon_bg: "#F69220" |
| pipx | `pipx` | pipx | `which pipx` | `brew install pipx && pipx ensurepath` | icon: "📦", icon_bg: "#3775A9" |
| GitHub CLI | `gh` | GitHub CLI | `which gh` | `brew install gh` | icon_img: github.png, icon_bg: "#24292e" |
| Terraform | `terraform` | Terraform | `which terraform` | `brew install terraform` | icon: "🏗", icon_bg: "#7B42BC" |
| Serverless | `serverless` | Serverless Framework | `which serverless` | `brew install serverless` | icon: "⚡", icon_bg: "#FD5750" |

All project-specific dependencies should have `depends_on: homebrew` (except Rust which installs via rustup).

### Phase 3: Interactive Review

**Do not proceed to generation yet.** Before presenting, scan the user's machine for installed apps:

```bash
# List GUI apps in /Applications
ls /Applications/ 2>/dev/null | grep '\.app$' | sed 's/\.app$//' | sort

# List Homebrew cask apps (gives us exact cask names for install commands)
brew list --cask 2>/dev/null
```

From the installed apps, identify developer-relevant tools using this reference table:

| App Name (in /Applications) | Cask Name | Category |
|------------------------------|-----------|----------|
| Cursor | cursor | Editor |
| Visual Studio Code | visual-studio-code | Editor |
| Zed | zed | Editor |
| iTerm | iterm2 | Terminal |
| Warp | warp | Terminal |
| Docker | docker | Infrastructure |
| Postman | postman | API |
| Insomnia | insomnia | API |
| Alfred 5 | alfred | Productivity |
| Raycast | raycast | Productivity |
| Rectangle | rectangle | Productivity |
| Caffeine | caffeine | Productivity |
| Figma | figma | Design |
| Sketch | sketch | Design |
| Slack | slack | Communication |
| Discord | discord | Communication |
| 1Password 7 | 1password | Security |
| Field Theory | fieldtheory | Productivity |
| Claude | claude | AI |
| TablePlus | tableplus | Database |
| Postico 2 | postico | Database |
| Proxyman | proxyman | Networking |
| Charles | charles | Networking |

For apps found in `/Applications/` that are NOT in this table and NOT in the `brew list --cask` output, use `brew search --cask <name>` to find the correct cask name. Only recommend apps where you can confidently generate a `brew install --cask` command. Do not guess cask names. Skip system default apps (Safari, Calendar, Mail, etc.) and non-developer apps.

**Now present everything in one message:**

> Here's what I detected in this codebase:
>
> **Dependencies to include:**
> - Xcode CLI Tools (foundation)
> - Homebrew (package manager)
> - Git (version control)
> - Node.js (detected: package.json)
> - Python 3 (detected: requirements.txt)
> - [etc.]
>
> I also found these developer apps on your machine:
>
> **Editors:** Cursor, VS Code
> **Terminals:** iTerm
> **Productivity:** Alfred, Rectangle
> **Other:** Docker, Slack
>
> Are there any dependencies or apps you'd like to add, remove, or change?

**This is the only pause point.** One question, one wait. The user can:
- Confirm as-is ("looks good")
- Modify dependencies (add/remove)
- Pick apps to include (e.g., "add Cursor and iTerm")
- Decline apps entirely (just don't mention them)
- Add apps NOT on their machine — warn them: "[App Name] doesn't appear to be installed on your machine. Are you sure?" If confirmed, use `brew search --cask <name>` to verify the cask exists.

**Rules:**
- List every dependency with the detection reason in parentheses
- Group dependencies: foundational first, then project-specific
- Categorize discovered apps by type
- If the user adds a dependency not in the mapping table, ask them for the check and install commands
- If the user removes a dependency that others depend on, warn about the dependency chain
- Once confirmed, proceed to Phase 4

**Building app entries:**

For each app the user selects, construct:
- `id`: lowercase, no spaces (e.g., `cursor`, `vscode`, `iterm`)
- `name`: Display name as it appears in /Applications
- `icon`: Use emoji. Use `icon_img` only for well-known tools with SVG/PNG assets in the Onboard app
- `icon_bg`: Pick a color matching the app's brand
- `desc`: One sentence describing what the app does
- `check`: `ls /Applications/App\ Name.app` (escape spaces with backslash)
- `install`: `brew install --cask <cask-name>`
- `depends_on`: `homebrew`

### Phase 4: Generate and Write

Construct the YAML:

```yaml
schema_version: 1
name: "Config Name"
description: "Short description of what this setup is for"

dependencies:
  # ... foundational deps first, then project-specific
```

If the user selected apps in Phase 3, add the apps section:

```yaml
apps:
  # ... selected apps
```

If the user declined apps or selected none, **omit the `apps:` key entirely** from the YAML. Do not write an empty `apps: []`.

**Naming rules:**
- If the user provided a name argument, use it
- Otherwise, derive from the repo/directory name
- The `name` field should be human-friendly (e.g., "My Project" not "my-project")
- The `description` should mention the key technologies (e.g., "Node.js + React development environment")

**File naming:**
- Save as `<project-name>.onboard` in the project root directory
- Use kebab-case for the filename (e.g., `my-project.onboard`)

After generating:
1. Write the file to the project root
2. Show a summary of what was included
3. Display the generated YAML
4. **Always show the full absolute path** to the generated file so the user can find it
5. Tell them: "Open this with the Onboard app, or share it with your team."

## Good Practices

- **Use the mapping table** for install commands — don't copy install commands from repo files. The table ensures consistent, correct output. If a dependency isn't in the table, use the pattern `brew install <well-known-package-name>` or ask the user.
- **Skip `.env` files** — read `.env.example` or `.env.sample` instead (same structural info, no secrets). Only look at variable names, not values.
- **Don't include secrets or credentials** in the generated file.

## Important Rules

- **Always include xcode-cli → homebrew → git** as the foundation chain
- **Respect `depends_on`** chains — everything installed via brew depends on homebrew
- **Use `icon_img`** for well-known tools where SVG/PNG assets likely exist in the Onboard app (node, python, git, homebrew, github). Use emoji `icon` for everything else.
- **Keep descriptions short** — one sentence, focused on what it does for THIS project
- **Quote install commands** in single quotes when they contain special shell characters (dollar signs, exclamation marks, subshells)
- **--minimal flag**: Only include the foundational deps + the primary language runtime. Skip app discovery entirely.
- **Don't over-include**: Only add dependencies that are actually needed for THIS project. A Python project doesn't need Node.js unless there's evidence of it.
- **Check commands must be reliable**: `which <binary>` for CLI tools, `ls /Applications/Name.app` for apps
- **Apps are interactive and optional**: Always ask the user. Only recommend apps actually installed on their machine. Never silently bundle apps the user doesn't use.
- **Don't guess cask names**: If you can't confidently map an app to a Homebrew cask, skip it or ask the user.
