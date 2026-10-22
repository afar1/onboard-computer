// brew.js — pure helpers for building and parsing Homebrew commands.
// No child_process, no fs, no electron: this module only builds strings and
// parses output. Callers are responsible for actually running anything.

const PKG_NAME_RE = /^[A-Za-z0-9@._\/+-]+$/;

// ─── Validation ─────────────────────────────────────────────────────

function assertValidPkg(pkg) {
  if (typeof pkg !== 'string' || !PKG_NAME_RE.test(pkg)) {
    throw new Error(`Invalid package name: ${JSON.stringify(pkg)}`);
  }
}

function assertValidPkgs(pkgs) {
  if (!Array.isArray(pkgs) || pkgs.length === 0) {
    throw new Error('Expected a non-empty array of package names');
  }
  pkgs.forEach(assertValidPkg);
}

// ─── Command builders ───────────────────────────────────────────────

function parseBrewInstall(cmd) {
  if (typeof cmd !== 'string') return null;
  const match = cmd.match(/^\s*brew install\s+(--cask\s+)?(\S+)\s*$/);
  if (!match) return null;
  return { pkg: match[2], cask: !!match[1] };
}

function installCommand(pkgs, { cask } = {}) {
  assertValidPkgs(pkgs);
  const flag = cask ? '--cask ' : '';
  return `brew install ${flag}${pkgs.join(' ')}`;
}

function uninstallCommand(pkg, { cask } = {}) {
  assertValidPkg(pkg);
  const flag = cask ? '--cask ' : '';
  return `brew uninstall ${flag}${pkg}`;
}

function upgradeCommand(pkg, { cask } = {}) {
  assertValidPkg(pkg);
  const flag = cask ? '--cask ' : '';
  return `brew upgrade ${flag}${pkg}`;
}

function listVersionsCommand(pkgs, { cask } = {}) {
  assertValidPkgs(pkgs);
  const flag = cask ? '--cask ' : '';
  return `brew list ${flag}--versions ${pkgs.join(' ')}`;
}

function outdatedCommand() {
  return 'brew outdated --json';
}

// ─── Output parsers ─────────────────────────────────────────────────

function parseListVersions(stdout) {
  const result = {};
  if (typeof stdout !== 'string') return result;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [pkg, version] = trimmed.split(/\s+/);
    if (pkg && version) result[pkg] = version;
  }
  return result;
}

function parseOutdated(stdout) {
  const result = {};
  if (typeof stdout !== 'string' || !stdout.trim()) return result;

  let data;
  try {
    data = JSON.parse(stdout);
  } catch (e) {
    return {};
  }
  if (!data || typeof data !== 'object') return {};

  const addEntries = (entries, cask) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (!entry || typeof entry.name !== 'string') continue;
      const installed = Array.isArray(entry.installed_versions)
        ? entry.installed_versions[0] ?? null
        : null;
      const latest = entry.current_version ?? null;
      result[entry.name] = { installed, latest, cask };
    }
  };

  addEntries(data.formulae, false);
  addEntries(data.casks, true);

  return result;
}

module.exports = {
  parseBrewInstall,
  installCommand,
  uninstallCommand,
  upgradeCommand,
  listVersionsCommand,
  parseListVersions,
  outdatedCommand,
  parseOutdated,
};
