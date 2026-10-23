// main.js — Electron main process.
// Holds the active (validated) config and ALL shell-execution authority.
// The renderer addresses items by id over IPC; raw command strings never
// cross the bridge in either direction.

const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, net } = require('electron');
const path = require('path');
const { exec, spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const { autoUpdater } = require('electron-updater');
const config = require('./config');
const brew = require('./brew');
const orchestrator = require('./orchestrator');
const assistedSetup = require('./assisted-setup');
assistedSetup.register({ ipcMain, shell, clipboard, isInstallerBusy: () => orchestrateRunning || activeProcesses.size > 0 });

// Make credentials: 'omit' exclude TLS client certificates, including cached identities.
const clientCertOmissionDisabled = app.commandLine.getSwitchValue('disable-features')
  .split(',').some((feature) => feature.split(/[<:]/)[0].trim() === 'OmitCorsClientCert');
app.commandLine.appendSwitch('enable-features', [
  app.commandLine.getSwitchValue('enable-features'), 'OmitCorsClientCert',
].filter(Boolean).join(','));

// Configure auto-updater
autoUpdater.autoDownload = false;
autoUpdater.allowPrerelease = false;
autoUpdater.setFeedURL({ provider: 'github', owner: 'afar1', repo: 'onboard-releases' });

// Track pending update state
let pendingUpdateInfo = null;

// ─── Window Setup ──────────────────────────────────────────────────

let mainWindow = null;
let pendingOpenSource = null; // file path or https URL waiting for the window
let terminalWindows = new Map(); // Track terminal pop-out windows by ID

function createWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;

  const winWidth = Math.min(Math.round(screenW * 0.45), 720);
  const winHeight = Math.round(screenH * 0.78);

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    minWidth: 580,
    minHeight: 520,
    maxWidth: 900,
    center: true,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');

  // Handle pending open (double-clicked file or onboard:// link before ready)
  if (pendingOpenSource) {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('config:fileOpened', pendingOpenSource);
      pendingOpenSource = null;
    });
  }

  return mainWindow;
}

function sendToMain(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function deliverOpenSource(source) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    sendToMain('config:fileOpened', source);
  } else {
    pendingOpenSource = source;
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Handle file open events (double-click on .onboard file)
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  deliverOpenSource(filePath);
});

// Handle onboard://load?url=<https config url> deep links
app.setAsDefaultProtocolClient('onboard');
app.on('open-url', (event, rawUrl) => {
  event.preventDefault();
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'onboard:') return;
    const target = parsed.searchParams.get('url');
    if (target && /^https?:\/\//i.test(target)) {
      deliverOpenSource(target);
    }
  } catch {
    // Malformed deep link — ignore.
  }
});

// ─── Shell Helpers ─────────────────────────────────────────────────

function getShellEnv() {
  const homeDir = os.homedir();
  const extraPaths = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    `${homeDir}/.local/bin`,
    `${homeDir}/.cargo/bin`,
  ];
  return {
    ...process.env,
    PATH: extraPaths.join(':') + ':' + (process.env.PATH || ''),
    HOMEBREW_NO_ENV_HINTS: '1',
  };
}

function runCommand(command, timeout = 30000) {
  return new Promise((resolve) => {
    exec(command, {
      shell: '/bin/bash',
      env: getShellEnv(),
      timeout,
    }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.trim() || '',
        stderr: stderr?.trim() || '',
        exitCode: error ? error.code || 1 : 0,
        succeeded: !error,
      });
    });
  });
}

// Track active processes for cancellation and terminal stdin routing
const activeProcesses = new Map();
const MAX_CAPTURE = 200 * 1024; // cap captured output per stream

// Run a long-lived command with streaming output, keyed by item id.
function runStreamingItem(id, command, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', ['-c', command], {
      env: getShellEnv(),
    });

    activeProcesses.set(id, { child, cancelled: false });

    let stdout = '';
    let stderr = '';
    let deviceCodeSent = false;

    const handleData = (stream) => (data) => {
      const text = data.toString();
      if (stream === 'stdout') {
        stdout = (stdout + text).slice(-MAX_CAPTURE);
      } else {
        stderr = (stderr + text).slice(-MAX_CAPTURE);
      }
      // Surface one-time device codes (e.g. GitHub's XXXX-XXXX) to the UI.
      if (opts.scanDeviceCode && !deviceCodeSent) {
        const match = (stdout + '\n' + stderr).match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/);
        if (match) {
          deviceCodeSent = true;
          sendToMain('setup:deviceCode', { id, code: match[1] });
        }
      }
      sendToMain('shell:streamOutput', { id, data: text, stream });
    };

    child.stdout.on('data', handleData('stdout'));
    child.stderr.on('data', handleData('stderr'));

    child.on('close', (code) => {
      const processInfo = activeProcesses.get(id);
      const cancelled = processInfo?.cancelled || false;
      activeProcesses.delete(id);
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
        succeeded: code === 0,
        cancelled,
      });
    });

    child.on('error', (err) => {
      activeProcesses.delete(id);
      resolve({
        stdout,
        stderr: err.message,
        exitCode: 1,
        succeeded: false,
        cancelled: false,
      });
    });
  });
}

function cancelProcess(id) {
  const processInfo = activeProcesses.get(id);
  if (processInfo) {
    processInfo.cancelled = true;
    processInfo.child.kill('SIGTERM');
    return true;
  }
  return false;
}

// Run a command in a fresh Terminal.app window (for interactive sign-ins).
function runInTerminalApp(command) {
  const esc = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  execFile('osascript', [
    '-e', 'tell application "Terminal" to activate',
    '-e', `tell application "Terminal" to do script "${esc}"`,
  ], () => {});
}

// ─── Active Config & Item State ────────────────────────────────────

let activeConfig = null; // { name, description, items, byId: Map }
const itemStatus = new Map(); // id -> { installed, version, latest, hasUpdate }

function getItem(id) {
  return (activeConfig && activeConfig.byId.get(id)) || null;
}

function statusObject() {
  const out = {};
  for (const [id, s] of itemStatus) out[id] = s;
  return out;
}

function emitItemStatus(id) {
  const s = itemStatus.get(id);
  if (s) sendToMain('item:status', { id, ...s });
}

function setActiveConfig(normalized) {
  // Backfill brew metadata (and uninstall/upgrade) for long-form items whose
  // install command is a plain `brew install`.
  for (const item of normalized.items) {
    if (!item.brew && item.install) {
      try {
        const parsed = brew.parseBrewInstall(item.install);
        if (parsed) {
          item.brew = parsed;
          if (!item.uninstall) item.uninstall = brew.uninstallCommand(parsed.pkg, { cask: parsed.cask });
          if (!item.upgrade) item.upgrade = brew.upgradeCommand(parsed.pkg, { cask: parsed.cask });
        }
      } catch {
        // Package name failed validation — leave the item without brew metadata.
      }
    }
  }
  activeConfig = {
    name: normalized.name,
    description: normalized.description,
    items: normalized.items,
    byId: new Map(normalized.items.map((i) => [i.id, i])),
  };
  itemStatus.clear();
  stopSetupPolling();
  orchestrateAwaitingSetup = false;
  return { name: activeConfig.name, description: activeConfig.description, items: activeConfig.items };
}

function looksLikeBrewfile(content) {
  return /^\s*(tap|brew|cask)\s+["']/m.test(content);
}

function parseAnyConfig(content, filename = '') {
  if (/^Brewfile(\..+)?$/.test(filename)) return config.parseBrewfile(content);
  try {
    return config.normalizeConfig(content);
  } catch (err) {
    if (looksLikeBrewfile(content)) return config.parseBrewfile(content);
    throw err;
  }
}

// ─── Checking & Version Enrichment ─────────────────────────────────

async function checkItemNow(item) {
  const res = await runCommand(item.check);
  const prev = itemStatus.get(item.id) || {};
  itemStatus.set(item.id, {
    installed: res.succeeded,
    version: prev.version || null,
    latest: prev.latest || null,
    hasUpdate: prev.hasUpdate || false,
  });
  return res.succeeded;
}

function matchByPkg(map, pkg) {
  return map[pkg] !== undefined ? map[pkg] : map[pkg.split('/').pop()];
}

// One batched pass: brew outdated once, brew list --versions once per kind,
// app-bundle versions from Info.plist. Replaces the old per-item calls.
async function enrichVersions() {
  if (!activeConfig) return;
  const items = activeConfig.items;
  const installed = (i) => itemStatus.get(i.id)?.installed;

  const formulae = items.filter((i) => i.brew && !i.brew.cask && installed(i));
  const casks = items.filter((i) => i.brew && i.brew.cask && installed(i));
  const plainApps = items.filter((i) => i.kind === 'app' && !i.brew && installed(i));

  let outdated = {};
  if (formulae.length || casks.length) {
    const res = await runCommand(brew.outdatedCommand(), 120000);
    outdated = brew.parseOutdated(res.stdout);
  }

  async function applyBatch(group, cask) {
    if (!group.length) return;
    const cmd = brew.listVersionsCommand(group.map((i) => i.brew.pkg), { cask });
    const res = await runCommand(cmd, 60000);
    const versions = brew.parseListVersions(res.stdout);
    for (const item of group) {
      const s = itemStatus.get(item.id);
      if (!s) continue;
      const version = matchByPkg(versions, item.brew.pkg) || null;
      const upd = matchByPkg(outdated, item.brew.pkg) || null;
      itemStatus.set(item.id, {
        ...s,
        version,
        latest: upd ? upd.latest || null : null,
        hasUpdate: !!upd,
      });
    }
  }

  await applyBatch(formulae, false);
  await applyBatch(casks, true);

  // Cask-installed apps may also have a readable bundle version as fallback,
  // and plain apps only have their bundle.
  for (const item of [...plainApps, ...casks]) {
    const s = itemStatus.get(item.id);
    if (!s || s.version) continue;
    const appPath = resolveAppPath(item);
    if (!appPath) continue;
    const res = await runCommand(`defaults read "${appPath}/Contents/Info" CFBundleShortVersionString`);
    if (res.succeeded && res.stdout) {
      itemStatus.set(item.id, { ...s, version: res.stdout.trim() });
    }
  }
}

// Extract "/Applications/Foo.app" style paths from an item's check command.
function resolveAppPath(item) {
  const checkCmd = item.check || '';
  const match = checkCmd.match(/ls\s+(.+\.app)/);
  if (match) {
    const segments = match[1].split('||').map((p) =>
      p.trim().replace(/^ls\s+/, '').replace(/^["']|["']$/g, '').replace(/\\ /g, ' '));
    for (const segment of segments) {
      if (segment && fs.existsSync(segment)) return segment;
    }
  }
  const fallback = `/Applications/${item.name}.app`;
  return fs.existsSync(fallback) ? fallback : null;
}

// ─── IPC: Config Loading ───────────────────────────────────────────

ipcMain.handle('config:loadFile', async (_event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return setActiveConfig(parseAnyConfig(content, path.basename(filePath)));
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('config:loadURL', async (_event, url) => {
  try {
    if (clientCertOmissionDisabled) throw new Error('Remote config loading is unavailable with TLS client certificate omission disabled');
    const parsedURL = new URL(url);
    if (parsedURL.protocol !== 'http:' && parsedURL.protocol !== 'https:') {
      throw new Error('Config URLs must be http(s)');
    }
    const response = await net.fetch(url, {
      credentials: 'omit',
      cache: 'no-store',
      bypassCustomProtocolHandlers: true,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const content = await response.text();
    if (content.length > 512 * 1024) throw new Error('Config too large');
    return setActiveConfig(parseAnyConfig(content, url.split('/').pop() || ''));
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('config:loadBundled', async (_event, name) => {
  try {
    const filename = (typeof name === 'string' && /^[a-z0-9-]+$/i.test(name) ? name : 'builder') + '.onboard';
    // In development, load from examples/; in production, from Resources
    const devPath = path.join(__dirname, 'examples', filename);
    const prodPath = path.join(process.resourcesPath, filename);
    const filePath = fs.existsSync(devPath) ? devPath : prodPath;
    const content = fs.readFileSync(filePath, 'utf8');
    return setActiveConfig(config.normalizeConfig(content));
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Onboard Config', extensions: ['onboard'] },
      { name: 'YAML Files', extensions: ['yaml', 'yml'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('fs:homedir', async () => {
  return os.homedir();
});

// ─── IPC: Items ────────────────────────────────────────────────────

ipcMain.handle('items:checkAll', async () => {
  if (!activeConfig) return {};
  await Promise.all(activeConfig.items.map((item) => checkItemNow(item)));
  const snapshot = statusObject();
  // Version enrichment is slower — run it after returning the fast pass,
  // pushing updates over item:status events.
  enrichVersions().then(() => {
    for (const item of activeConfig?.items || []) emitItemStatus(item.id);
  }).catch(() => {});
  return snapshot;
});

ipcMain.handle('items:check', async (_event, id) => {
  const item = getItem(id);
  if (!item) return null;
  await checkItemNow(item);
  return { id, ...itemStatus.get(id) };
});

ipcMain.handle('items:install', async (_event, id) => {
  if (assistedSetup.isInstalling()) return { error: 'An assistant installation is running. Wait for it to finish.' };
  const item = getItem(id);
  if (!item || !item.install) return { succeeded: false, stderr: 'No install command for this item' };
  const res = await runStreamingItem(id, item.install);
  if (!res.cancelled) {
    await checkItemNow(item);
    await enrichVersions().catch(() => {});
    emitItemStatus(id);
  }
  return res;
});

ipcMain.handle('items:uninstall', async (_event, id) => {
  const item = getItem(id);
  if (!item || !item.uninstall) return { succeeded: false, stderr: 'No uninstall command available' };
  const res = await runStreamingItem(id, item.uninstall);
  await checkItemNow(item);
  emitItemStatus(id);
  return res;
});

ipcMain.handle('items:upgrade', async (_event, id) => {
  const item = getItem(id);
  if (!item || !item.upgrade) return { succeeded: false, stderr: 'No upgrade command available' };
  const res = await runStreamingItem(id, item.upgrade);
  if (res.succeeded) {
    await checkItemNow(item);
    await enrichVersions().catch(() => {});
  }
  emitItemStatus(id);
  return res;
});

ipcMain.handle('items:cancel', async (_event, id) => {
  return cancelProcess(id);
});

ipcMain.handle('items:openApp', async (_event, id) => {
  const item = getItem(id);
  if (!item) return false;
  const appPath = resolveAppPath(item);
  if (appPath) await shell.openPath(appPath);
  return !!appPath;
});

ipcMain.handle('items:reveal', async (_event, id) => {
  const item = getItem(id);
  if (!item) return false;
  const appPath = resolveAppPath(item);
  if (appPath) shell.showItemInFolder(appPath);
  return !!appPath;
});

// ─── IPC: Setup Steps ──────────────────────────────────────────────

ipcMain.handle('setup:action', async (_event, id) => {
  const item = getItem(id);
  if (!item || !item.action) return { succeeded: false, stderr: 'No action for this step' };
  const res = await runStreamingItem(id, item.action, { scanDeviceCode: true });
  if (res.succeeded && item.post_action) {
    await runCommand(item.post_action, 120000);
  }
  await checkItemNow(item);
  emitItemStatus(id);
  return res;
});

ipcMain.handle('setup:input', async (_event, id, values) => {
  const item = getItem(id);
  if (!item || item.special !== 'git-identity' || !values || typeof values !== 'object') {
    return { succeeded: false, stderr: 'Unsupported input step' };
  }
  const name = String(values.name || '').trim();
  const email = String(values.email || '').trim();
  if (!name || !email || name.length > 200 || email.length > 200 ||
      /[\x00-\x1f\x7f]/.test(name + email)) {
    return { succeeded: false, stderr: 'Enter a valid name and email' };
  }
  // execFile with an args array — values never touch a shell.
  const gitConfig = (key, value) => new Promise((resolve) => {
    execFile('git', ['config', '--global', key, value], { env: getShellEnv() }, (err) => resolve(!err));
  });
  const ok = (await gitConfig('user.name', name)) && (await gitConfig('user.email', email));
  await checkItemNow(item);
  emitItemStatus(id);
  return { succeeded: ok, stderr: ok ? '' : 'git config failed — is git installed?' };
});

ipcMain.handle('setup:openUrl', async (_event, id) => {
  const item = getItem(id);
  if (item && item.url) await shell.openExternal(item.url);
});

ipcMain.handle('setup:terminal', async (_event, id) => {
  const item = getItem(id);
  if (!item || !item.terminal) return false;
  runInTerminalApp(item.terminal);
  startSetupPolling();
  return true;
});

// ─── Setup Polling ─────────────────────────────────────────────────

let setupPollTimer = null;
let setupPollBusy = false;
let orchestrateAwaitingSetup = false;

function startSetupPolling() {
  if (setupPollTimer || !activeConfig) return;
  setupPollTimer = setInterval(async () => {
    if (setupPollBusy || !activeConfig) return;
    setupPollBusy = true;
    try {
      const pending = activeConfig.items.filter(
        (i) => i.kind === 'setup' && !itemStatus.get(i.id)?.installed);
      if (!pending.length) {
        stopSetupPolling();
        if (orchestrateAwaitingSetup) {
          orchestrateAwaitingSetup = false;
          sendToMain('orchestrate:progress', { phase: 'done', itemId: null, status: 'done', message: null });
        }
        return;
      }
      for (const item of pending) {
        const was = itemStatus.get(item.id)?.installed;
        const now = await checkItemNow(item);
        if (now !== was) emitItemStatus(item.id);
      }
    } finally {
      setupPollBusy = false;
    }
  }, 3000);
}

function stopSetupPolling() {
  if (setupPollTimer) {
    clearInterval(setupPollTimer);
    setupPollTimer = null;
  }
}

ipcMain.handle('setup:pollStart', () => { startSetupPolling(); });
ipcMain.handle('setup:pollStop', () => { stopSetupPolling(); });

// ─── IPC: Orchestration ("Set up my Mac") ──────────────────────────

let orchestrateRunning = false;
let orchestrateCancelled = false;

ipcMain.handle('orchestrate:getPlan', async () => {
  if (!activeConfig) return { error: 'No config loaded' };
  await Promise.all(activeConfig.items.map((item) => checkItemNow(item)));
  for (const item of activeConfig.items) emitItemStatus(item.id);
  return orchestrator.computePlan(activeConfig.items, statusObject());
});

ipcMain.handle('orchestrate:run', async () => {
  if (!activeConfig) return { error: 'No config loaded' };
  if (orchestrateRunning || assistedSetup.isInstalling()) return { error: 'An installation is already running. Wait for it to finish.' };
  orchestrateRunning = true;
  orchestrateCancelled = false;
  try {
    const ctx = {
      getItems: () => activeConfig.items,
      checkItem: async (item) => {
        const ok = await checkItemNow(item);
        emitItemStatus(item.id);
        return ok;
      },
      getStatus: () => statusObject(),
      runStreamingItem,
      runInTerminal: runInTerminalApp,
      sendProgress: (p) => sendToMain('orchestrate:progress', p),
      startSetupPolling: () => {
        orchestrateAwaitingSetup = true;
        startSetupPolling();
      },
      isCancelled: () => orchestrateCancelled,
    };
    const result = await orchestrator.runAll(ctx);
    enrichVersions().then(() => {
      for (const item of activeConfig?.items || []) emitItemStatus(item.id);
    }).catch(() => {});
    return result;
  } catch (err) {
    return { error: err.message };
  } finally {
    orchestrateRunning = false;
  }
});

ipcMain.handle('orchestrate:cancel', async () => {
  orchestrateCancelled = true;
  orchestrateAwaitingSetup = false;
  for (const id of activeProcesses.keys()) cancelProcess(id);
  return true;
});

// ─── IPC: Misc ─────────────────────────────────────────────────────

ipcMain.handle('shell:openExternal', async (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
  }
});

// ─── Terminal Pop-out Windows ───────────────────────────────────────

ipcMain.handle('terminal:openWindow', async (_event, id, name, existingOutput) => {
  // Close existing window for this ID if any
  if (terminalWindows.has(id)) {
    terminalWindows.get(id).close();
  }

  const terminalWindow = new BrowserWindow({
    width: 600,
    height: 400,
    minWidth: 400,
    minHeight: 200,
    title: `Terminal — ${name}`,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'terminal-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  terminalWindow.loadFile('terminal.html');

  // Send existing output once the window is ready
  terminalWindow.webContents.on('did-finish-load', () => {
    if (existingOutput) {
      terminalWindow.webContents.send('terminal:output', existingOutput, 'stdout');
    }
  });

  // Notify main window when this terminal window closes
  terminalWindow.on('closed', () => {
    terminalWindows.delete(id);
    sendToMain('terminal:windowClosed', id);
  });

  terminalWindows.set(id, terminalWindow);
  return true;
});

ipcMain.handle('terminal:sendOutput', async (_event, id, data, stream) => {
  const terminalWindow = terminalWindows.get(id);
  if (terminalWindow && !terminalWindow.isDestroyed()) {
    terminalWindow.webContents.send('terminal:output', data, stream);
  }
});

// Route typed input from a pop-out terminal to its process's stdin.
ipcMain.on('terminal:stdin', (event, data) => {
  if (typeof data !== 'string' || data.length > 10000) return;
  for (const [id, win] of terminalWindows) {
    if (!win.isDestroyed() && win.webContents === event.sender) {
      const processInfo = activeProcesses.get(id);
      if (processInfo && processInfo.child.stdin.writable) {
        processInfo.child.stdin.write(data);
      }
      return;
    }
  }
});

// ─── Auto-Updater ───────────────────────────────────────────────────

function broadcastToAllWindows(channel, ...args) {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(channel, ...args);
  });
}

autoUpdater.on('checking-for-update', () => {
  broadcastToAllWindows('updater:checkingForUpdate');
});

autoUpdater.on('update-available', (info) => {
  pendingUpdateInfo = { status: 'available', version: info.version };
  broadcastToAllWindows('updater:updateAvailable', { version: info.version });
});

autoUpdater.on('update-not-available', () => {
  pendingUpdateInfo = null;
  broadcastToAllWindows('updater:updateNotAvailable');
});

autoUpdater.on('error', (err) => {
  if (err.message?.includes('net::') || err.message?.includes('ENOTFOUND')) {
    return;
  }
  broadcastToAllWindows('updater:error', err.message);
});

autoUpdater.on('download-progress', (progressObj) => {
  const percent = Math.round(progressObj.percent);
  broadcastToAllWindows('updater:downloadProgress', percent);
});

autoUpdater.on('update-downloaded', (info) => {
  pendingUpdateInfo = { status: 'ready', version: info.version };
  broadcastToAllWindows('updater:updateDownloaded', { version: info.version });
});

ipcMain.handle('updater:getVersion', () => app.getVersion());
ipcMain.handle('updater:getStatus', () => pendingUpdateInfo);
ipcMain.handle('updater:checkForUpdates', () => {
  if (app.isPackaged && !app.getVersion().includes('-')) {
    autoUpdater.checkForUpdates();
  } else {
    broadcastToAllWindows('updater:updateNotAvailable');
  }
});
ipcMain.handle('updater:downloadUpdate', () => autoUpdater.downloadUpdate());
ipcMain.handle('updater:installUpdate', () => autoUpdater.quitAndInstall());
ipcMain.handle('updater:dismissUpdate', () => { pendingUpdateInfo = null; });

app.whenReady().then(() => {
  if (app.isPackaged && !app.getVersion().includes('-')) {
    setTimeout(() => autoUpdater.checkForUpdates(), 5000);
    setInterval(() => autoUpdater.checkForUpdates(), 30 * 60 * 1000);
  }
});
