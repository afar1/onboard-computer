// orchestrator.js — the "Set up my Mac" engine.
// Computes an install plan from the active config, runs a single elevated
// bootstrap (one admin prompt) for Xcode CLT + the Homebrew prefix, then
// installs everything in dependency order and hands off to setup polling.
//
// Security notes:
// - The elevated script is generated here from constants only; the single
//   interpolated value (the console username) is strictly validated.
// - Nothing config-derived ever enters the elevated script.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const brew = require('./brew');
const { topoSort } = require('./config');

// ─── Plan ──────────────────────────────────────────────────────────

// items: normalized items; status: { [id]: { installed } }
function computePlan(items, status) {
  const installed = (id) => !!status[id]?.installed;
  const bootstrap = [];
  const tools = [];
  const apps = [];
  const setup = [];
  const done = [];

  for (const item of items) {
    if (installed(item.id)) {
      done.push(item.id);
      continue;
    }
    if (item.special === 'xcode-cli' || item.special === 'homebrew') {
      bootstrap.push(item.id);
    } else if (item.kind === 'tool') {
      tools.push(item.id);
    } else if (item.kind === 'app') {
      apps.push(item.id);
    } else {
      setup.push(item.id);
    }
  }

  // Admin is only needed when the machine is missing the bootstrap layer.
  const needsAdmin = bootstrap.length > 0;
  return { bootstrap, tools, apps, setup, done, needsAdmin };
}

// ─── Elevated bootstrap (one admin prompt) ─────────────────────────

function buildBootstrapScript(username) {
  if (!/^[A-Za-z0-9._-]+$/.test(username)) {
    throw new Error('Refusing to build bootstrap script: invalid username');
  }
  return `#!/bin/bash
set -eu

# 1. Xcode Command Line Tools, headless (no GUI dialog).
if ! /usr/bin/xcode-select -p >/dev/null 2>&1; then
  /usr/bin/touch /tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress
  LABEL=$(/usr/sbin/softwareupdate -l 2>/dev/null | /usr/bin/grep -o 'Command Line Tools for Xcode-[0-9.]*' | /usr/bin/sort -V | /usr/bin/tail -n1)
  if [ -n "$LABEL" ]; then
    /usr/sbin/softwareupdate -i "$LABEL" --verbose
  fi
  /bin/rm -f /tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress
  /usr/bin/xcode-select -p >/dev/null 2>&1 || exit 10
fi

# 2. Pre-create the Homebrew prefix so the NONINTERACTIVE installer
#    never needs sudo of its own (Apple Silicon only).
if [ "$(/usr/bin/uname -m)" = "arm64" ] && [ ! -x /opt/homebrew/bin/brew ]; then
  /bin/mkdir -p /opt/homebrew
  /usr/sbin/chown -R '${username}':admin /opt/homebrew
fi
`;
}

// Runs the bootstrap script as root via a single macOS admin prompt.
// Resolves { succeeded, cancelled, message }.
function runElevatedBootstrap() {
  return new Promise((resolve) => {
    let scriptPath;
    try {
      const script = buildBootstrapScript(os.userInfo().username);
      scriptPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'onboard-')), 'bootstrap.sh');
      fs.writeFileSync(scriptPath, script, { mode: 0o700 });
    } catch (err) {
      resolve({ succeeded: false, cancelled: false, message: err.message });
      return;
    }

    // AppleScript string: the path contains no user input, but escape anyway.
    const escaped = scriptPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const appleScript =
      `with timeout of 7200 seconds\n` +
      `do shell script "/bin/bash \\"${escaped}\\"" with administrator privileges\n` +
      `end timeout`;

    execFile('osascript', ['-e', appleScript], { timeout: 7200 * 1000 }, (error, _stdout, stderr) => {
      try { fs.rmSync(path.dirname(scriptPath), { recursive: true, force: true }); } catch { /* best effort */ }
      if (!error) {
        resolve({ succeeded: true, cancelled: false, message: null });
        return;
      }
      const cancelled = /-128/.test(stderr || '') || /User canceled/i.test(stderr || '');
      const cltFailed = error.code === 10;
      resolve({
        succeeded: false,
        cancelled,
        message: cancelled
          ? 'Administrator authorization was declined.'
          : cltFailed
            ? 'Xcode Command Line Tools did not finish installing. Run "xcode-select --install" manually, then try again.'
            : (stderr || error.message || 'Bootstrap failed').trim(),
      });
    });
  });
}

// ─── Run everything ────────────────────────────────────────────────

// ctx contract (provided by main.js):
//   getItems() -> Item[]                         (normalized config items)
//   checkItem(item) -> Promise<boolean>          (run item.check, update status, emit item:status)
//   getStatus() -> { [id]: { installed } }
//   runStreamingItem(id, command) -> Promise<{succeeded, cancelled, stderr}>
//   runInTerminal(command) -> void               (Terminal.app fallback)
//   sendProgress({ phase, itemId, status, message })
//   startSetupPolling() -> void
//   isCancelled() -> boolean

async function runAll(ctx) {
  const progress = (phase, itemId, status, message = null) =>
    ctx.sendProgress({ phase, itemId, status, message });

  const summary = { installed: [], failed: [], skipped: [], manual: [] };
  const failed = new Set();

  const items = topoSort(ctx.getItems());
  const byId = new Map(items.map((i) => [i.id, i]));

  // Fresh reality check before planning.
  for (const item of items) await ctx.checkItem(item);
  const plan = computePlan(items, ctx.getStatus());

  const isInstalled = (id) => !!ctx.getStatus()[id]?.installed;
  const depsBlocked = (item) =>
    item.depends_on.find((dep) => byId.has(dep) && !isInstalled(dep));

  const markFailed = (id, phase, message) => {
    failed.add(id);
    summary.failed.push(id);
    progress(phase, id, 'failed', message);
  };
  const markSkipped = (id, phase, message) => {
    summary.skipped.push(id);
    progress(phase, id, 'skipped', message);
  };

  // Installs one non-batched item; returns true when it ends up installed.
  async function installOne(item, phase) {
    if (ctx.isCancelled()) { markSkipped(item.id, phase, 'Cancelled'); return false; }
    const blocker = depsBlocked(item);
    if (blocker) {
      markSkipped(item.id, phase, `Needs ${byId.get(blocker)?.name || blocker}`);
      return false;
    }
    progress(phase, item.id, 'running');
    const res = await ctx.runStreamingItem(item.id, item.install);
    if (res.cancelled) { markSkipped(item.id, phase, 'Cancelled'); return false; }
    const ok = res.succeeded && (await ctx.checkItem(item));
    if (ok) {
      summary.installed.push(item.id);
      progress(phase, item.id, 'done');
      return true;
    }
    markFailed(item.id, phase, (res.stderr || 'Install failed').slice(0, 400));
    return false;
  }

  // ── Bootstrap: one admin prompt covers CLT + Homebrew prefix ─────
  const needCLT = plan.bootstrap.some((id) => byId.get(id)?.special === 'xcode-cli');
  const needBrew = plan.bootstrap.some((id) => byId.get(id)?.special === 'homebrew');
  const arm64 = os.arch() === 'arm64';

  if (needCLT || (needBrew && arm64)) {
    progress('bootstrap', null, 'start',
      needCLT
        ? 'Installing Xcode Command Line Tools — this needs your password once and can take a few minutes.'
        : 'Preparing Homebrew — this needs your password once.');
    const boot = await runElevatedBootstrap();
    if (!boot.succeeded) {
      const bootIds = plan.bootstrap;
      bootIds.forEach((id) => markFailed(id, 'bootstrap', boot.message));
      [...plan.tools, ...plan.apps].forEach((id) =>
        markSkipped(id, 'bootstrap', 'Skipped — bootstrap did not finish'));
      summary.manual = plan.setup;
      progress('done', null, 'failed', boot.message);
      return { summary };
    }
    const clt = items.find((i) => i.special === 'xcode-cli');
    if (clt) {
      const ok = await ctx.checkItem(clt);
      if (ok && plan.bootstrap.includes(clt.id)) {
        summary.installed.push(clt.id);
        progress('bootstrap', clt.id, 'done');
      }
    }
  }

  if (needBrew && !ctx.isCancelled()) {
    const brewItem = items.find((i) => i.special === 'homebrew');
    if (brewItem) {
      if (arm64) {
        progress('bootstrap', brewItem.id, 'running', 'Installing Homebrew…');
        const res = await ctx.runStreamingItem(brewItem.id, brewItem.install);
        if (res.succeeded && (await ctx.checkItem(brewItem))) {
          summary.installed.push(brewItem.id);
          progress('bootstrap', brewItem.id, 'done');
        } else if (!res.cancelled) {
          markFailed(brewItem.id, 'bootstrap', (res.stderr || 'Homebrew install failed').slice(0, 400));
        }
      } else {
        // Intel: the official installer manages /usr/local itself and wants an
        // interactive sudo — run it in Terminal.app and wait for brew to appear.
        progress('bootstrap', brewItem.id, 'running',
          'Opening Terminal to install Homebrew — enter your password there.');
        ctx.runInTerminal(brewItem.install);
        const deadline = Date.now() + 30 * 60 * 1000;
        while (Date.now() < deadline && !ctx.isCancelled()) {
          await new Promise((r) => setTimeout(r, 5000));
          if (await ctx.checkItem(brewItem)) break;
        }
        if (await ctx.checkItem(brewItem)) {
          summary.installed.push(brewItem.id);
          progress('bootstrap', brewItem.id, 'done');
        } else {
          markFailed(brewItem.id, 'bootstrap', 'Homebrew did not finish installing in Terminal.');
        }
      }
    }
  }

  const brewReady = () => {
    const brewItem = items.find((i) => i.special === 'homebrew');
    return !brewItem || isInstalled(brewItem.id);
  };

  // ── Tools: batch the missing formulae, then customs in topo order ─
  const missingTools = plan.tools.map((id) => byId.get(id)).filter(Boolean)
    .filter((i) => !isInstalled(i.id));
  const formulae = missingTools.filter((i) => i.brew && !i.brew.cask);
  const customTools = missingTools.filter((i) => !i.brew || i.brew.cask);

  if (missingTools.length && !ctx.isCancelled()) {
    progress('tools', null, 'start');
    if (formulae.length) {
      if (!brewReady()) {
        formulae.forEach((i) => markSkipped(i.id, 'tools', 'Needs Homebrew'));
      } else {
        formulae.forEach((i) => progress('tools', i.id, 'running'));
        const cmd = brew.installCommand(formulae.map((i) => i.brew.pkg), { cask: false });
        const res = await ctx.runStreamingItem('__batch__', cmd);
        for (const item of formulae) {
          if (await ctx.checkItem(item)) {
            summary.installed.push(item.id);
            progress('tools', item.id, 'done');
          } else if (res.cancelled) {
            markSkipped(item.id, 'tools', 'Cancelled');
          } else {
            markFailed(item.id, 'tools', (res.stderr || 'brew install failed').slice(0, 400));
          }
        }
      }
    }
    for (const item of customTools) await installOne(item, 'tools');
  }

  // ── Apps: one at a time for real per-item progress ────────────────
  const missingApps = plan.apps.map((id) => byId.get(id)).filter(Boolean)
    .filter((i) => !isInstalled(i.id));
  if (missingApps.length && !ctx.isCancelled()) {
    progress('apps', null, 'start');
    for (const item of missingApps) await installOne(item, 'apps');
  }

  // ── Setup: hand off to the human checklist ───────────────────────
  const pendingSetup = [];
  for (const id of plan.setup) {
    const item = byId.get(id);
    if (item && !(await ctx.checkItem(item))) pendingSetup.push(id);
  }
  summary.manual = pendingSetup;
  if (pendingSetup.length) {
    progress('setup', null, 'start', 'Waiting on you — finish the setup steps below.');
    ctx.startSetupPolling();
  } else {
    progress('done', null, 'done');
  }

  return { summary };
}

module.exports = { computePlan, buildBootstrapScript, runElevatedBootstrap, runAll };
