const test = require('node:test');
const assert = require('node:assert');
const {
  parseBrewInstall,
  installCommand,
  uninstallCommand,
  upgradeCommand,
  listVersionsCommand,
  parseListVersions,
  outdatedCommand,
  parseOutdated,
} = require('./brew.js');

// ─── parseBrewInstall ───────────────────────────────────────────────

test('parseBrewInstall: plain formula', () => {
  assert.deepStrictEqual(parseBrewInstall('brew install node'), {
    pkg: 'node',
    cask: false,
  });
});

test('parseBrewInstall: cask flag', () => {
  assert.deepStrictEqual(parseBrewInstall('brew install --cask alfred'), {
    pkg: 'alfred',
    cask: true,
  });
});

test('parseBrewInstall: tapped formula path', () => {
  assert.deepStrictEqual(parseBrewInstall('brew install oven-sh/bun/bun'), {
    pkg: 'oven-sh/bun/bun',
    cask: false,
  });
});

test('parseBrewInstall: non-brew commands return null', () => {
  assert.strictEqual(parseBrewInstall('npm install express'), null);
  assert.strictEqual(parseBrewInstall('brew uninstall node'), null);
  assert.strictEqual(parseBrewInstall(''), null);
  assert.strictEqual(parseBrewInstall('brew install'), null);
});

// ─── Injection defense ──────────────────────────────────────────────

test('injection attempt throws in every builder', () => {
  const evil = 'node; rm -rf /';
  assert.throws(() => installCommand([evil]), /Invalid package name/);
  assert.throws(() => uninstallCommand(evil), /Invalid package name/);
  assert.throws(() => upgradeCommand(evil), /Invalid package name/);
  assert.throws(() => listVersionsCommand([evil]), /Invalid package name/);
});

test('injection attempt among otherwise-valid batch still throws', () => {
  const evil = 'node; rm -rf /';
  assert.throws(() => installCommand(['git', evil, 'gh']), /Invalid package name/);
  assert.throws(() => listVersionsCommand(['git', evil]), /Invalid package name/);
});

// ─── Command builders (happy path + batching) ───────────────────────

test('installCommand: single formula', () => {
  assert.strictEqual(installCommand(['node']), 'brew install node');
});

test('installCommand: batch joins multiple pkgs', () => {
  assert.strictEqual(
    installCommand(['git', 'gh', 'node']),
    'brew install git gh node'
  );
});

test('installCommand: cask option adds flag', () => {
  assert.strictEqual(
    installCommand(['alfred', 'cursor'], { cask: true }),
    'brew install --cask alfred cursor'
  );
});

test('uninstallCommand: formula and cask', () => {
  assert.strictEqual(uninstallCommand('node'), 'brew uninstall node');
  assert.strictEqual(
    uninstallCommand('alfred', { cask: true }),
    'brew uninstall --cask alfred'
  );
});

test('upgradeCommand: formula and cask', () => {
  assert.strictEqual(upgradeCommand('node'), 'brew upgrade node');
  assert.strictEqual(
    upgradeCommand('alfred', { cask: true }),
    'brew upgrade --cask alfred'
  );
});

test('listVersionsCommand: batches multiple pkgs', () => {
  assert.strictEqual(
    listVersionsCommand(['node', 'python']),
    'brew list --versions node python'
  );
  assert.strictEqual(
    listVersionsCommand(['alfred'], { cask: true }),
    'brew list --cask --versions alfred'
  );
});

test('outdatedCommand: fixed string', () => {
  assert.strictEqual(outdatedCommand(), 'brew outdated --json');
});

// ─── parseListVersions ──────────────────────────────────────────────

test('parseListVersions: realistic multi-line output', () => {
  const stdout = 'node 24.1.0\nalfred 5.5\n';
  assert.deepStrictEqual(parseListVersions(stdout), {
    node: '24.1.0',
    alfred: '5.5',
  });
});

test('parseListVersions: tolerates empty/garbage lines', () => {
  const stdout = 'node 24.1.0\n\n   \ngarbage\nalfred 5.5';
  assert.deepStrictEqual(parseListVersions(stdout), {
    node: '24.1.0',
    alfred: '5.5',
  });
});

test('parseListVersions: empty input', () => {
  assert.deepStrictEqual(parseListVersions(''), {});
  assert.deepStrictEqual(parseListVersions(undefined), {});
});

// ─── parseOutdated ──────────────────────────────────────────────────

test('parseOutdated: formulae and casks', () => {
  const stdout = JSON.stringify({
    formulae: [
      {
        name: 'node',
        installed_versions: ['23.0.0'],
        current_version: '24.1.0',
      },
    ],
    casks: [
      {
        name: 'alfred',
        installed_versions: ['5.4'],
        current_version: '5.5',
      },
    ],
  });
  assert.deepStrictEqual(parseOutdated(stdout), {
    node: { installed: '23.0.0', latest: '24.1.0', cask: false },
    alfred: { installed: '5.4', latest: '5.5', cask: true },
  });
});

test('parseOutdated: malformed JSON returns {}', () => {
  assert.deepStrictEqual(parseOutdated('{not json'), {});
  assert.deepStrictEqual(parseOutdated(''), {});
  assert.deepStrictEqual(parseOutdated(undefined), {});
});

test('parseOutdated: missing keys tolerated', () => {
  assert.deepStrictEqual(parseOutdated('{}'), {});
  assert.deepStrictEqual(parseOutdated(JSON.stringify({ formulae: [{}] })), {});
});

test('parseOutdated: never throws on unexpected shapes', () => {
  assert.doesNotThrow(() => parseOutdated('null'));
  assert.doesNotThrow(() => parseOutdated('42'));
  assert.doesNotThrow(() => parseOutdated('"string"'));
});
