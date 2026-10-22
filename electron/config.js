'use strict';

// ─── config.js ─────────────────────────────────────────────────────
// Pure module: parses .onboard YAML (long form + shorthand) and
// Brewfiles into a normalized item list. No child_process, no fs, no
// electron imports — this module never executes anything.

const yaml = require('js-yaml');

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const ICON_IMG_RE = /^[A-Za-z0-9._ -]+$/;
const ICON_BG_RE = /^#[0-9a-fA-F]{3,8}$/;
// Same rule brew.js enforces at its command builders — validating here too
// keeps shell metacharacters out of derived commands by construction.
const PKG_RE = /^[A-Za-z0-9@._/+-]+$/;

function validatePkg(pkg, section) {
  if (typeof pkg !== 'string' || !PKG_RE.test(pkg)) {
    throw new Error(`Invalid ${section} package name: ${JSON.stringify(pkg)}`);
  }
  return pkg;
}

// ─── Known-name maps ───────────────────────────────────────────────

const BIN_MAP = {
  gh: 'gh',
  git: 'git',
  node: 'node',
  python: 'python3',
  codex: 'codex',
  bun: 'bun',
  'claude-code': 'claude',
};

const APP_MAP = {
  alfred: 'Alfred 5.app',
  caffeine: 'Caffeine.app',
  rectangle: 'Rectangle.app',
  cursor: 'Cursor.app',
  'visual-studio-code': 'Visual Studio Code.app',
};

const NAME_MAP = {
  gh: 'GitHub CLI',
  git: 'Git',
  node: 'Node.js',
  python: 'Python 3',
  codex: 'Codex',
  'claude-code': 'Claude Code',
  bun: 'Bun',
  alfred: 'Alfred',
  caffeine: 'Caffeine',
  rectangle: 'Rectangle',
  cursor: 'Cursor',
  'visual-studio-code': 'VS Code',
};

const DESC_MAP = {
  gh: 'Interact with GitHub from your terminal.',
  git: 'Version control. Track changes, collaborate, push to GitHub.',
  node: 'JavaScript runtime. Runs JS outside the browser, powers npm.',
  python: 'Versatile scripting language. Used by many tools and AI libraries.',
  codex: "OpenAI's coding agent for the terminal.",
  'claude-code': 'AI coding assistant from Anthropic.',
  bun: 'Fast JavaScript runtime and package manager.',
  alfred: 'Productivity launcher and workflows.',
  caffeine: 'Keep your Mac awake during presentations or long tasks.',
  rectangle: 'Window management with keyboard shortcuts.',
  cursor: 'AI-powered code editor.',
  'visual-studio-code': 'Popular code editor from Microsoft.',
};

const ICON_MAP = {
  gh: 'github.png',
  github: 'github.png',
  git: 'git.png',
  node: 'nodejs.svg',
  python: 'python.svg',
  bun: 'bun.svg',
  homebrew: 'homebrew.svg',
  alfred: 'Alfred-5.png',
  caffeine: 'Caffeine.png',
  cursor: 'Cursor.png',
  rectangle: 'Rectangle.png',
  fieldtheory: 'fieldtheory-icon.png',
};

const ICON_BG_MAP = {
  homebrew: '#fbb040',
  bun: '#fbf0df',
  'claude-code': '#cc785c',
  gh: '#24292e',
  git: '#f0f0f0',
  node: '#333',
  python: '#306998',
  alfred: '#5c2d91',
  caffeine: '#4a3728',
  cursor: '#1a1a2e',
  rectangle: '#2ecc71',
  'xcode-cli': '#1c7ed6',
};

// ─── Built-in setup recipes ────────────────────────────────────────

function xcodeCliRecipe() {
  return {
    id: 'xcode-cli',
    kind: 'tool',
    name: 'Xcode CLI Tools',
    desc: "Apple's command line developer tools. Compilers, git, and build essentials.",
    check: 'xcode-select -p >/dev/null 2>&1',
    install: 'xcode-select --install',
    depends_on: [],
    icon_img: 'https://developer.apple.com/assets/elements/icons/xcode/xcode-96x96.png',
    icon_bg: '#1c7ed6',
    special: 'xcode-cli',
  };
}

function homebrewRecipe() {
  return {
    id: 'homebrew',
    kind: 'tool',
    name: 'Homebrew',
    desc: 'The package manager for macOS. Installs everything else.',
    check: 'command -v brew >/dev/null 2>&1',
    install:
      'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    depends_on: ['xcode-cli'],
    icon_img: 'homebrew.svg',
    icon_bg: '#fbb040',
    special: 'homebrew',
  };
}

function githubRecipe(hasIdGh) {
  return {
    id: 'github',
    kind: 'setup',
    name: 'Connect GitHub',
    desc: 'Sign in — or create an account — and authenticate the GitHub CLI so you can push code.',
    url: 'https://github.com/signup',
    action:
      "printf '\\n\\n\\n' | script -q /dev/null gh auth login --hostname github.com --git-protocol https --web",
    post_action: 'gh auth setup-git',
    check: 'gh auth status --hostname github.com >/dev/null 2>&1',
    depends_on: hasIdGh ? ['gh'] : [],
    icon_img: 'github.png',
    icon_bg: '#24292e',
  };
}

function gitIdentityRecipe() {
  return {
    id: 'git-identity',
    kind: 'setup',
    name: 'Set your Git identity',
    desc: 'Your name and email on every commit.',
    input: {
      fields: [
        { key: 'name', label: 'Full name', placeholder: 'Ada Lovelace' },
        { key: 'email', label: 'Email', placeholder: 'ada@example.com' },
      ],
    },
    check: 'git config --global user.name >/dev/null 2>&1 && git config --global user.email >/dev/null 2>&1',
    icon_img: 'git.png',
    icon_bg: '#f0f0f0',
    special: 'git-identity',
  };
}

function claudeRecipe(hasIdClaudeCode) {
  return {
    id: 'claude',
    kind: 'setup',
    name: 'Sign in to Claude Code',
    desc: 'Opens Terminal running claude — sign in with your Anthropic account.',
    terminal: 'claude',
    check:
      'security find-generic-password -s "Claude Code-credentials" >/dev/null 2>&1 || test -f "$HOME/.claude/.credentials.json"',
    depends_on: hasIdClaudeCode ? ['claude-code'] : [],
    icon_bg: '#cc785c',
    icon_img: 'https://www.anthropic.com/images/icons/apple-touch-icon.png',
  };
}

function codexAuthRecipe(hasIdCodex) {
  return {
    id: 'codex-auth',
    kind: 'setup',
    name: 'Sign in to Codex',
    desc: 'Opens Terminal running codex login — sign in with your OpenAI account.',
    terminal: 'codex login',
    check: 'test -f "$HOME/.codex/auth.json"',
    depends_on: hasIdCodex ? ['codex'] : [],
  };
}

// BUILTIN_RECIPES: factories, since 'github'/'claude'/'codex-auth' depend on
// the presence of other ids in the config being built.
const BUILTIN_RECIPES = {
  'xcode-cli': xcodeCliRecipe,
  homebrew: homebrewRecipe,
  github: githubRecipe,
  'git-identity': gitIdentityRecipe,
  claude: claudeRecipe,
  'codex-auth': codexAuthRecipe,
};

// ─── Shared item defaults / sanitization ───────────────────────────

function baseItem(kind) {
  return {
    id: null,
    kind,
    name: '',
    desc: '',
    icon_img: null,
    icon_bg: null,
    check: '',
    install: null,
    uninstall: null,
    upgrade: null,
    depends_on: [],
    brew: null,
    url: null,
    action: null,
    post_action: null,
    terminal: null,
    input: null,
    special: null,
    pollInterval: 3,
  };
}

function toStringOrEmpty(v) {
  if (v === undefined || v === null) return '';
  return String(v);
}

function normalizeDependsOn(v) {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [String(v)];
}

function sanitizeIconImg(v) {
  if (typeof v !== 'string' || !v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (ICON_IMG_RE.test(v)) return v;
  return null;
}

function sanitizeIconBg(v) {
  if (typeof v !== 'string') return null;
  return ICON_BG_RE.test(v) ? v : null;
}

function sanitizeUrl(v) {
  if (typeof v !== 'string' || !v) return null;
  return /^https?:\/\//i.test(v) ? v : null;
}

function validateId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new Error(`Invalid item id: "${id}" (must match /^[a-z0-9][a-z0-9_-]*$/i)`);
  }
  return id;
}

// Sanitize a fully-built item in place (called on every item before it's
// added to the result, long-form or shorthand alike).
function sanitizeItem(item) {
  validateId(item.id);
  item.name = toStringOrEmpty(item.name) || item.id;
  item.desc = toStringOrEmpty(item.desc);
  item.icon_img = sanitizeIconImg(item.icon_img);
  item.icon_bg = sanitizeIconBg(item.icon_bg);
  item.depends_on = normalizeDependsOn(item.depends_on);
  if (item.kind === 'setup') {
    item.url = sanitizeUrl(item.url);
  } else {
    item.url = null;
  }
  if (!item.check) {
    throw new Error(`Item "${item.id}" missing "check"`);
  }
  return item;
}

// ─── Long form (v1) parsing ─────────────────────────────────────────

function parseLongFormItem(raw, kind, index, section) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Item ${index} in ${section} is not an object`);
  }
  if (!raw.id) throw new Error(`Item ${index} in ${section} missing "id"`);
  if (!raw.name) throw new Error(`Item "${raw.id}" missing "name"`);
  if (!raw.check) throw new Error(`Item "${raw.id}" missing "check"`);

  const item = baseItem(kind);
  item.id = String(raw.id);
  item.name = raw.name;
  item.desc = raw.desc;
  item.check = raw.check;
  item.install = raw.install !== undefined ? raw.install : null;
  item.depends_on = raw.depends_on;
  item.icon_img = raw.icon_img !== undefined ? raw.icon_img : null;
  item.icon_bg = raw.icon_bg !== undefined ? raw.icon_bg : null;
  return sanitizeItem(item);
}

// ─── Shorthand parsing ──────────────────────────────────────────────

function titleCase(s) {
  return String(s)
    .split(/[-_]/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function shorthandEntryToObj(entry) {
  // Entry may be a bare string (pkg/recipe name) or an object override.
  if (typeof entry === 'string') return { pkg: entry };
  if (entry && typeof entry === 'object') return { ...entry };
  throw new Error(`Invalid shorthand entry: ${JSON.stringify(entry)}`);
}

function buildFormulaItem(entry) {
  const obj = shorthandEntryToObj(entry);
  const pkg = obj.pkg || obj.id;
  if (!pkg) throw new Error('brew entry missing package name');
  validatePkg(pkg, 'brew');
  const bin = BIN_MAP[pkg] || pkg;
  const item = baseItem('tool');
  item.id = obj.id || pkg;
  item.name = obj.name || NAME_MAP[pkg] || titleCase(pkg);
  item.desc = obj.desc !== undefined ? obj.desc : DESC_MAP[pkg] || '';
  item.brew = { pkg, cask: false };
  item.depends_on = obj.depends_on !== undefined ? obj.depends_on : ['homebrew'];
  item.check =
    obj.check !== undefined
      ? obj.check
      : `command -v ${bin} >/dev/null 2>&1 || brew list --versions ${pkg} >/dev/null 2>&1`;
  item.install = obj.install !== undefined ? obj.install : `brew install ${pkg}`;
  item.uninstall = obj.uninstall !== undefined ? obj.uninstall : `brew uninstall ${pkg}`;
  item.upgrade = obj.upgrade !== undefined ? obj.upgrade : `brew upgrade ${pkg}`;
  item.icon_img = obj.icon_img !== undefined ? obj.icon_img : iconFor(pkg);
  item.icon_bg = obj.icon_bg !== undefined ? obj.icon_bg : ICON_BG_MAP[pkg] || null;
  return sanitizeItem(item);
}

function buildCaskItem(entry) {
  const obj = shorthandEntryToObj(entry);
  const pkg = obj.pkg || obj.id;
  if (!pkg) throw new Error('cask entry missing package name');
  validatePkg(pkg, 'cask');
  const item = baseItem('app');
  item.id = obj.id || pkg;
  item.name = obj.name || NAME_MAP[pkg] || titleCase(pkg);
  item.desc = obj.desc !== undefined ? obj.desc : DESC_MAP[pkg] || '';
  item.brew = { pkg, cask: true };
  item.depends_on = obj.depends_on !== undefined ? obj.depends_on : ['homebrew'];

  if (obj.check !== undefined) {
    item.check = obj.check;
  } else if (APP_MAP[pkg]) {
    item.check = `ls "/Applications/${APP_MAP[pkg]}" >/dev/null 2>&1 || brew list --cask --versions ${pkg} >/dev/null 2>&1`;
  } else if (BIN_MAP[pkg]) {
    item.check = `command -v ${BIN_MAP[pkg]} >/dev/null 2>&1 || brew list --cask --versions ${pkg} >/dev/null 2>&1`;
  } else {
    item.check = `brew list --cask --versions ${pkg} >/dev/null 2>&1`;
  }

  item.install = obj.install !== undefined ? obj.install : `brew install --cask ${pkg}`;
  item.uninstall = obj.uninstall !== undefined ? obj.uninstall : `brew uninstall --cask ${pkg}`;
  item.upgrade = obj.upgrade !== undefined ? obj.upgrade : `brew upgrade --cask ${pkg}`;
  item.icon_img = obj.icon_img !== undefined ? obj.icon_img : iconFor(pkg);
  item.icon_bg = obj.icon_bg !== undefined ? obj.icon_bg : ICON_BG_MAP[pkg] || null;
  return sanitizeItem(item);
}

function iconFor(pkg) {
  return ICON_MAP[pkg] || null;
}

// Build a setup item from a shorthand entry: either a recipe name (string)
// matching BUILTIN_RECIPES, or an inline object with a required `id`.
function buildSetupItem(entry, ctx) {
  if (typeof entry === 'string') {
    const factory = BUILTIN_RECIPES[entry];
    if (!factory) {
      throw new Error(`Unknown setup recipe: "${entry}"`);
    }
    return buildRecipeItem(entry, factory, ctx);
  }
  if (entry && typeof entry === 'object') {
    if (!entry.id) throw new Error('Inline setup item missing "id"');
    // If the id matches a builtin recipe name, treat overrides as applied
    // on top of the recipe; otherwise it's a fully custom setup item.
    const factory = BUILTIN_RECIPES[entry.id];
    const item = baseItem('setup');
    if (factory) {
      const recipe = buildRecipeItem(entry.id, factory, ctx, /* skipSanitize */ true);
      Object.assign(item, recipe);
    }
    // Whitelist the keys an inline setup object may set — notably NOT
    // `special`, `kind`, or `brew`, which drive privileged main-process paths.
    const SETUP_KEYS = ['id', 'name', 'desc', 'icon_img', 'icon_bg', 'check',
      'install', 'uninstall', 'upgrade', 'url', 'action', 'post_action',
      'terminal', 'input', 'pollInterval'];
    for (const key of SETUP_KEYS) {
      if (entry[key] !== undefined) item[key] = entry[key];
    }
    item.depends_on = entry.depends_on !== undefined ? entry.depends_on : item.depends_on;
    if (!item.check) {
      throw new Error(`Item "${item.id}" missing "check"`);
    }
    return sanitizeItem(item);
  }
  throw new Error(`Invalid setup entry: ${JSON.stringify(entry)}`);
}

function buildRecipeItem(name, factory, ctx, skipSanitize) {
  let recipe;
  if (name === 'github') {
    recipe = factory(ctx.hasId('gh'));
  } else if (name === 'claude') {
    recipe = factory(ctx.hasId('claude-code'));
  } else if (name === 'codex-auth') {
    recipe = factory(ctx.hasId('codex'));
  } else {
    recipe = factory();
  }
  const item = { ...baseItem(recipe.kind), ...recipe };
  return skipSanitize ? item : sanitizeItem(item);
}

// ─── normalizeConfig ────────────────────────────────────────────────

function normalizeConfig(rawYamlText) {
  let doc;
  try {
    doc = yaml.load(rawYamlText);
  } catch (e) {
    throw new Error(`Invalid YAML: ${e.message}`);
  }
  if (!doc || typeof doc !== 'object') {
    throw new Error('Invalid config: not an object');
  }
  if (!doc.name) {
    throw new Error('Config missing "name"');
  }

  const name = String(doc.name);
  const description = doc.description !== undefined ? String(doc.description) : '';

  const tools = [];
  const apps = [];
  const setupItems = [];

  // ── Long form ──
  if (doc.dependencies !== undefined) {
    if (!Array.isArray(doc.dependencies)) {
      throw new Error('"dependencies" must be an array');
    }
    doc.dependencies.forEach((raw, i) => {
      tools.push(parseLongFormItem(raw, 'tool', i, 'dependencies'));
    });
  }
  if (doc.apps !== undefined) {
    if (!Array.isArray(doc.apps)) {
      throw new Error('"apps" must be an array');
    }
    doc.apps.forEach((raw, i) => {
      apps.push(parseLongFormItem(raw, 'app', i, 'apps'));
    });
  }

  // ── Shorthand ──
  const brewList = doc.brew !== undefined ? doc.brew : [];
  const caskList = doc.cask !== undefined ? doc.cask : [];
  const setupList = doc.setup !== undefined ? doc.setup : [];

  if (!Array.isArray(brewList)) throw new Error('"brew" must be an array');
  if (!Array.isArray(caskList)) throw new Error('"cask" must be an array');
  if (!Array.isArray(setupList)) throw new Error('"setup" must be an array');

  const hasId = (id) =>
    tools.some((i) => i.id === id) ||
    apps.some((i) => i.id === id) ||
    brewList.some((e) => (typeof e === 'string' ? e : e.id || e.pkg) === id) ||
    caskList.some((e) => (typeof e === 'string' ? e : e.id || e.pkg) === id);

  if ((brewList.length > 0 || caskList.length > 0)) {
    if (!hasId('xcode-cli') && !tools.some((i) => i.id === 'xcode-cli')) {
      tools.push(sanitizeItem(xcodeCliRecipe()));
    }
    if (!hasId('homebrew') && !tools.some((i) => i.id === 'homebrew')) {
      tools.push(sanitizeItem(homebrewRecipe()));
    }
  }

  brewList.forEach((entry) => tools.push(buildFormulaItem(entry)));
  caskList.forEach((entry) => apps.push(buildCaskItem(entry)));

  const ctx = {
    hasId: (id) =>
      tools.some((i) => i.id === id) || apps.some((i) => i.id === id),
  };
  setupList.forEach((entry) => setupItems.push(buildSetupItem(entry, ctx)));

  const items = [...tools, ...apps, ...setupItems];

  // Duplicate id check across the whole config.
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new Error(`Duplicate item id: "${item.id}"`);
    }
    seen.add(item.id);
  }

  return { name, description, items };
}

// ─── Brewfile import ────────────────────────────────────────────────

const TAP_NAME_RE = /^[A-Za-z0-9._/-]+$/;

function parseBrewfile(text) {
  const brew = [];
  const cask = [];
  const tapItems = [];

  const lines = String(text).split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    let m;
    if ((m = line.match(/^brew\s+["']([^"']+)["']/))) {
      brew.push(m[1]);
    } else if ((m = line.match(/^cask\s+["']([^"']+)["']/))) {
      cask.push(m[1]);
    } else if ((m = line.match(/^tap\s+["']([^"']+)["']/))) {
      const tapName = m[1];
      if (TAP_NAME_RE.test(tapName)) {
        const sanitized = tapName.replace(/[^A-Za-z0-9]+/g, '-');
        tapItems.push({
          id: `tap-${sanitized}`,
          kind: 'tool',
          name: `Tap ${tapName}`,
          check: `brew tap | grep -qx "${tapName}"`,
          install: `brew tap ${tapName}`,
        });
      }
      // invalid tap names are skipped silently
    }
    // any other line (comments, garbage) is skipped silently
  }

  const doc = {
    name: 'Imported Brewfile',
    brew,
    cask,
  };

  const yamlDoc = yaml.dump(doc);
  const result = normalizeConfig(yamlDoc);

  // Prepend tap tool items (before xcode-cli/homebrew/brew/cask items).
  const tapNormalized = tapItems.map((raw) => {
    const item = baseItem('tool');
    item.id = raw.id;
    item.name = raw.name;
    item.check = raw.check;
    item.install = raw.install;
    item.depends_on = [];
    return sanitizeItem(item);
  });

  return { ...result, items: [...tapNormalized, ...result.items] };
}

// ─── topoSort ───────────────────────────────────────────────────────

function topoSort(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const visited = new Set(); // fully processed
  const visiting = new Set(); // on current DFS stack
  const result = [];

  function visit(item) {
    if (visited.has(item.id)) return;
    if (visiting.has(item.id)) {
      throw new Error(`Dependency cycle detected involving "${item.id}"`);
    }
    visiting.add(item.id);
    for (const depId of item.depends_on || []) {
      const dep = byId.get(depId);
      if (dep) visit(dep);
      // unknown depends_on ids are silently dropped
    }
    visiting.delete(item.id);
    visited.add(item.id);
    result.push(item);
  }

  for (const item of items) {
    visit(item);
  }

  return result;
}

module.exports = {
  normalizeConfig,
  parseBrewfile,
  topoSort,
  BUILTIN_RECIPES,
};
