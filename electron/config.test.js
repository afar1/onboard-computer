'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeConfig, parseBrewfile, topoSort, BUILTIN_RECIPES } = require('./config');

// ─── Fixtures ────────────────────────────────────────────────────────

// Snapshot of the pre-shorthand builder.onboard (v1 long form), used to
// prove long-form configs keep parsing after the shorthand rewrite.
const LONG_FORM_FIXTURE = `
schema_version: 1
name: "Builder Basics"
description: "Everything you need to start building"

dependencies:
  - id: xcode-cli
    name: Xcode CLI Tools
    icon_img: https://developer.apple.com/assets/elements/icons/xcode/xcode-96x96.png
    icon_bg: "#1c7ed6"
    desc: Apple's command line developer tools. Compilers, git, and build essentials.
    check: xcode-select -p
    install: xcode-select --install

  - id: homebrew
    name: Homebrew
    icon_img: homebrew.svg
    icon_bg: "#fbb040"
    desc: The package manager for macOS. Installs everything else.
    check: which brew
    install: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    depends_on: xcode-cli

  - id: git
    name: Git
    icon_img: git.png
    icon_bg: "#f0f0f0"
    desc: Version control. Track changes, collaborate, push to GitHub.
    check: which git
    install: brew install git
    depends_on: homebrew

apps:
  - id: alfred
    name: Alfred
    icon_img: Alfred-5.png
    icon_bg: "#5c2d91"
    desc: Productivity launcher and workflows.
    check: ls /Applications/Alfred\\ 5.app || ls /Applications/Alfred\\ 4.app || ls /Applications/Alfred.app
    install: brew install --cask alfred
    depends_on: homebrew
`;

// ─── Long form ───────────────────────────────────────────────────────

test('long form (v1) config still parses', () => {
  const result = normalizeConfig(LONG_FORM_FIXTURE);
  assert.equal(result.name, 'Builder Basics');
  assert.equal(result.description, 'Everything you need to start building');

  const byId = Object.fromEntries(result.items.map((i) => [i.id, i]));
  assert.ok(byId['xcode-cli']);
  assert.equal(byId['xcode-cli'].kind, 'tool');
  assert.deepEqual(byId['xcode-cli'].depends_on, []);

  assert.ok(byId['homebrew']);
  // scalar depends_on normalized to array
  assert.deepEqual(byId['homebrew'].depends_on, ['xcode-cli']);

  assert.ok(byId['git']);
  assert.equal(byId['git'].kind, 'tool');

  assert.ok(byId['alfred']);
  assert.equal(byId['alfred'].kind, 'app');

  // ordering: tools (dependencies) before apps
  const kinds = result.items.map((i) => i.kind);
  const lastToolIdx = kinds.lastIndexOf('tool');
  const firstAppIdx = kinds.indexOf('app');
  assert.ok(lastToolIdx < firstAppIdx);
});

test('long form: missing required field throws', () => {
  const bad = `
name: Bad Config
dependencies:
  - id: foo
    name: Foo
`;
  assert.throws(() => normalizeConfig(bad), /missing "check"/);
});

// ─── Shorthand: formula / cask derivation ───────────────────────────

test('shorthand formula derives id/check/install/uninstall/upgrade', () => {
  const cfg = `
name: Test
brew: [git]
`;
  const result = normalizeConfig(cfg);
  const git = result.items.find((i) => i.id === 'git');
  assert.ok(git);
  assert.equal(git.kind, 'tool');
  assert.deepEqual(git.brew, { pkg: 'git', cask: false });
  assert.deepEqual(git.depends_on, ['homebrew']);
  assert.equal(git.check, 'command -v git >/dev/null 2>&1 || brew list --versions git >/dev/null 2>&1');
  assert.equal(git.install, 'brew install git');
  assert.equal(git.uninstall, 'brew uninstall git');
  assert.equal(git.upgrade, 'brew upgrade git');
  assert.equal(git.name, 'Git');
  assert.equal(git.icon_img, 'git.png');
});

test('shorthand formula uses BIN_MAP for check binary (python -> python3)', () => {
  const cfg = `
name: Test
brew: [python]
`;
  const result = normalizeConfig(cfg);
  const python = result.items.find((i) => i.id === 'python');
  assert.match(python.check, /command -v python3/);
});

test('shorthand cask derives id/check/install with APP_MAP', () => {
  const cfg = `
name: Test
cask: [cursor]
`;
  const result = normalizeConfig(cfg);
  const cursor = result.items.find((i) => i.id === 'cursor');
  assert.ok(cursor);
  assert.equal(cursor.kind, 'app');
  assert.deepEqual(cursor.brew, { pkg: 'cursor', cask: true });
  assert.equal(cursor.check, 'ls "/Applications/Cursor.app" >/dev/null 2>&1 || brew list --cask --versions cursor >/dev/null 2>&1');
  assert.equal(cursor.install, 'brew install --cask cursor');
  assert.equal(cursor.uninstall, 'brew uninstall --cask cursor');
});

test('shorthand cask with no APP_MAP/BIN_MAP entry falls back to brew list check', () => {
  const cfg = `
name: Test
cask: [some-unknown-cask]
`;
  const result = normalizeConfig(cfg);
  const item = result.items.find((i) => i.id === 'some-unknown-cask');
  assert.equal(item.check, 'brew list --cask --versions some-unknown-cask >/dev/null 2>&1');
  assert.equal(item.name, 'Some Unknown Cask');
});

test('shorthand entry object overrides derived fields', () => {
  const cfg = `
name: Test
brew:
  - pkg: node
    name: Node LTS
    desc: Custom desc
`;
  const result = normalizeConfig(cfg);
  const node = result.items.find((i) => i.id === 'node');
  assert.equal(node.name, 'Node LTS');
  assert.equal(node.desc, 'Custom desc');
  // still derived
  assert.equal(node.install, 'brew install node');
});

// ─── xcode-cli / homebrew auto-prepend ──────────────────────────────

test('brew: list auto-prepends xcode-cli and homebrew', () => {
  const cfg = `
name: Test
brew: [git]
`;
  const result = normalizeConfig(cfg);
  const ids = result.items.map((i) => i.id);
  assert.ok(ids.includes('xcode-cli'));
  assert.ok(ids.includes('homebrew'));
  assert.ok(ids.indexOf('xcode-cli') < ids.indexOf('homebrew'));
  assert.ok(ids.indexOf('homebrew') < ids.indexOf('git'));
});

test('cask: list alone also auto-prepends xcode-cli/homebrew', () => {
  const cfg = `
name: Test
cask: [cursor]
`;
  const result = normalizeConfig(cfg);
  const ids = result.items.map((i) => i.id);
  assert.ok(ids.includes('xcode-cli'));
  assert.ok(ids.includes('homebrew'));
});

test('does not duplicate xcode-cli/homebrew if already present in long form', () => {
  const cfg = `
name: Test
dependencies:
  - id: xcode-cli
    name: Xcode CLI Tools
    check: xcode-select -p
    install: xcode-select --install
brew: [git]
`;
  const result = normalizeConfig(cfg);
  const xcodeItems = result.items.filter((i) => i.id === 'xcode-cli');
  assert.equal(xcodeItems.length, 1);
});

test('no brew/cask lists means no auto-prepend', () => {
  const cfg = `
name: Test
setup: [git-identity]
`;
  const result = normalizeConfig(cfg);
  const ids = result.items.map((i) => i.id);
  assert.ok(!ids.includes('xcode-cli'));
  assert.ok(!ids.includes('homebrew'));
});

// ─── Setup recipes ───────────────────────────────────────────────────

test('setup recipe by name: github without gh present has empty depends_on', () => {
  const cfg = `
name: Test
setup: [github]
`;
  const result = normalizeConfig(cfg);
  const github = result.items.find((i) => i.id === 'github');
  assert.ok(github);
  assert.equal(github.kind, 'setup');
  assert.deepEqual(github.depends_on, []);
  assert.equal(github.url, 'https://github.com/signup');
});

test('setup recipe by name: github with gh present depends on gh', () => {
  const cfg = `
name: Test
brew: [gh]
setup: [github]
`;
  const result = normalizeConfig(cfg);
  const github = result.items.find((i) => i.id === 'github');
  assert.deepEqual(github.depends_on, ['gh']);
});

test('setup recipe by name: claude depends on claude-code when cask present', () => {
  const cfg = `
name: Test
cask: [claude-code]
setup: [claude]
`;
  const result = normalizeConfig(cfg);
  const claude = result.items.find((i) => i.id === 'claude');
  assert.deepEqual(claude.depends_on, ['claude-code']);
  assert.equal(claude.terminal, 'claude');
});

test('setup recipe by name: codex-auth depends on codex when brew present', () => {
  const cfg = `
name: Test
brew: [codex]
setup: [codex-auth]
`;
  const result = normalizeConfig(cfg);
  const codexAuth = result.items.find((i) => i.id === 'codex-auth');
  assert.deepEqual(codexAuth.depends_on, ['codex']);
});

test('setup recipe: git-identity has input fields', () => {
  const cfg = `
name: Test
setup: [git-identity]
`;
  const result = normalizeConfig(cfg);
  const gi = result.items.find((i) => i.id === 'git-identity');
  assert.ok(gi.input);
  assert.equal(gi.input.fields.length, 2);
  assert.equal(gi.input.fields[0].key, 'name');
});

test('unknown setup recipe name throws', () => {
  const cfg = `
name: Test
setup: [not-a-real-recipe]
`;
  assert.throws(() => normalizeConfig(cfg), /Unknown setup recipe/);
});

test('inline setup object requires id and check', () => {
  const cfg = `
name: Test
setup:
  - id: fieldtheory
    name: Field Theory
    desc: Local voice transcripts and context management.
    url: https://fieldtheory.com
    icon_img: fieldtheory-icon.png
    icon_bg: "#1a1a2e"
    check: ls "/Applications/Field Theory.app"
`;
  const result = normalizeConfig(cfg);
  const ft = result.items.find((i) => i.id === 'fieldtheory');
  assert.ok(ft);
  assert.equal(ft.kind, 'setup');
  assert.equal(ft.url, 'https://fieldtheory.com');
  assert.equal(ft.icon_bg, '#1a1a2e');
});

test('inline setup object missing id throws', () => {
  const cfg = `
name: Test
setup:
  - name: No Id
    check: "true"
`;
  assert.throws(() => normalizeConfig(cfg), /missing "id"/);
});

test('BUILTIN_RECIPES exports the six built-in recipe factories', () => {
  assert.ok(BUILTIN_RECIPES['xcode-cli']);
  assert.ok(BUILTIN_RECIPES['homebrew']);
  assert.ok(BUILTIN_RECIPES['github']);
  assert.ok(BUILTIN_RECIPES['git-identity']);
  assert.ok(BUILTIN_RECIPES['claude']);
  assert.ok(BUILTIN_RECIPES['codex-auth']);
});

// ─── Sanitization ────────────────────────────────────────────────────

test('sanitization: bad icon_bg becomes null', () => {
  const cfg = `
name: Test
dependencies:
  - id: foo
    name: Foo
    check: "true"
    install: "true"
    icon_bg: "not-a-color"
`;
  const result = normalizeConfig(cfg);
  assert.equal(result.items[0].icon_bg, null);
});

test('sanitization: bad id throws', () => {
  const cfg = `
name: Test
dependencies:
  - id: "Bad Id With Spaces!"
    name: Foo
    check: "true"
    install: "true"
`;
  assert.throws(() => normalizeConfig(cfg), /Invalid item id/);
});

test('sanitization: javascript: url on setup item becomes null', () => {
  const cfg = `
name: Test
setup:
  - id: evil
    name: Evil
    check: "true"
    url: "javascript:alert(1)"
`;
  const result = normalizeConfig(cfg);
  const item = result.items.find((i) => i.id === 'evil');
  assert.equal(item.url, null);
});

test('sanitization: icon_img must be http(s) or a plain filename', () => {
  const cfg = `
name: Test
dependencies:
  - id: foo
    name: Foo
    check: "true"
    install: "true"
    icon_img: "javascript:alert(1)"
`;
  const result = normalizeConfig(cfg);
  assert.equal(result.items[0].icon_img, null);
});

test('sanitization: valid http(s) icon_img and plain filename both pass', () => {
  const cfg = `
name: Test
dependencies:
  - id: foo
    name: Foo
    check: "true"
    install: "true"
    icon_img: "https://example.com/icon.png"
  - id: bar
    name: Bar
    check: "true"
    install: "true"
    icon_img: "bar-icon.png"
    depends_on: foo
`;
  const result = normalizeConfig(cfg);
  assert.equal(result.items[0].icon_img, 'https://example.com/icon.png');
  assert.equal(result.items[1].icon_img, 'bar-icon.png');
});

test('duplicate ids across config throw', () => {
  const cfg = `
name: Test
dependencies:
  - id: dup
    name: Dup
    check: "true"
    install: "true"
apps:
  - id: dup
    name: Dup2
    check: "true"
    install: "true"
`;
  assert.throws(() => normalizeConfig(cfg), /Duplicate item id/);
});

// ─── topoSort ────────────────────────────────────────────────────────

test('topoSort produces stable order preserving input order among ties', () => {
  const items = [
    { id: 'a', depends_on: [] },
    { id: 'b', depends_on: [] },
    { id: 'c', depends_on: [] },
  ];
  const sorted = topoSort(items);
  assert.deepEqual(sorted.map((i) => i.id), ['a', 'b', 'c']);
});

test('topoSort orders dependencies before dependents', () => {
  const items = [
    { id: 'node', depends_on: ['homebrew'] },
    { id: 'homebrew', depends_on: ['xcode-cli'] },
    { id: 'xcode-cli', depends_on: [] },
  ];
  const sorted = topoSort(items);
  const idx = Object.fromEntries(sorted.map((i, n) => [i.id, n]));
  assert.ok(idx['xcode-cli'] < idx['homebrew']);
  assert.ok(idx['homebrew'] < idx['node']);
});

test('topoSort throws on cycle', () => {
  const items = [
    { id: 'a', depends_on: ['b'] },
    { id: 'b', depends_on: ['a'] },
  ];
  assert.throws(() => topoSort(items), /cycle/i);
});

test('topoSort drops unknown depends_on ids but keeps the item', () => {
  const items = [
    { id: 'a', depends_on: ['ghost'] },
  ];
  const sorted = topoSort(items);
  assert.deepEqual(sorted.map((i) => i.id), ['a']);
});

// ─── Brewfile import ─────────────────────────────────────────────────

test('parseBrewfile imports brew/cask/tap lines and skips garbage', () => {
  const brewfile = `
# This is a Brewfile
tap "homebrew/cask-fonts"
brew "git"
brew "node"
cask "cursor"
this is not a valid line
brew
cask ""
`;
  const result = parseBrewfile(brewfile);
  assert.equal(result.name, 'Imported Brewfile');

  const ids = result.items.map((i) => i.id);
  assert.ok(ids.includes('git'));
  assert.ok(ids.includes('node'));
  assert.ok(ids.includes('cursor'));
  assert.ok(ids.includes('tap-homebrew-cask-fonts'));

  const git = result.items.find((i) => i.id === 'git');
  assert.equal(git.kind, 'tool');
  const cursor = result.items.find((i) => i.id === 'cursor');
  assert.equal(cursor.kind, 'app');

  // auto-prepended bootstrap tools should still be present
  assert.ok(ids.includes('xcode-cli'));
  assert.ok(ids.includes('homebrew'));
});

test('parseBrewfile skips invalid tap names silently', () => {
  const brewfile = `
tap "invalid tap name!"
brew "git"
`;
  const result = parseBrewfile(brewfile);
  const tapItems = result.items.filter((i) => i.id.startsWith('tap-'));
  assert.equal(tapItems.length, 0);
});

// ─── Example fixtures normalize without throwing ────────────────────

test('bundled example configs normalize without throwing', () => {
  const examplesDir = path.join(__dirname, 'examples');
  const files = ['builder.onboard', 'web-dev.onboard', 'data-science.onboard'];
  for (const file of files) {
    const text = fs.readFileSync(path.join(examplesDir, file), 'utf8');
    assert.doesNotThrow(() => normalizeConfig(text), `${file} should normalize without throwing`);
  }
});

test('example.onboard.yml at repo root normalizes without throwing', () => {
  const filePath = path.join(__dirname, '..', 'example.onboard.yml');
  const text = fs.readFileSync(filePath, 'utf8');
  assert.doesNotThrow(() => normalizeConfig(text));
});
