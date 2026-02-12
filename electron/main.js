// main.js — Electron main process.
// Creates the onboarding window and handles all shell execution
// via IPC so the renderer never touches Node directly.

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const yaml = require('js-yaml');
const { autoUpdater } = require('electron-updater');

// Configure auto-updater
autoUpdater.autoDownload = false;
autoUpdater.allowPrerelease = true;
autoUpdater.setFeedURL({ provider: 'github', owner: 'afar1', repo: 'onboard-releases' });

// Track pending update state
let pendingUpdateInfo = null;

// ─── Window Setup ──────────────────────────────────────────────────

let mainWindow = null;
let pendingFilePath = null;
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

  // Handle pending file open (from double-click before app was ready)
  if (pendingFilePath) {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('config:fileOpened', pendingFilePath);
      pendingFilePath = null;
    });
  }

  return mainWindow;
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
  if (mainWindow) {
    mainWindow.webContents.send('config:fileOpened', filePath);
  } else {
    pendingFilePath = filePath;
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
    `${homeDir}/.nvm/versions/node/*/bin`,
    `${homeDir}/.local/bin`,
    `${homeDir}/.cargo/bin`,
  ];
  return {
    ...process.env,
    PATH: extraPaths.join(':') + ':' + (process.env.PATH || ''),
  };
}

function runCommand(command) {
  return new Promise((resolve) => {
    exec(command, {
      shell: '/bin/bash',
      env: getShellEnv(),
      timeout: 30000,
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

// ─── Config Validation ─────────────────────────────────────────────

function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Invalid config: not an object');
  }
  if (!config.name) {
    throw new Error('Config missing "name"');
  }
  if (!Array.isArray(config.dependencies)) {
    throw new Error('Config missing "dependencies" array');
  }
  if (!Array.isArray(config.apps)) {
    throw new Error('Config missing "apps" array');
  }

  const validateItem = (item, section, index) => {
    if (!item.id) throw new Error(`Item ${index} in ${section} missing "id"`);
    if (!item.name) throw new Error(`Item "${item.id}" missing "name"`);
    if (!item.check) throw new Error(`Item "${item.id}" missing "check"`);
    if (!item.install) throw new Error(`Item "${item.id}" missing "install"`);
  };

  config.dependencies.forEach((d, i) => validateItem(d, 'dependencies', i));
  config.apps.forEach((a, i) => validateItem(a, 'apps', i));

  return config;
}

// ─── IPC Handlers ──────────────────────────────────────────────────

// Run an arbitrary shell command and return the result.
ipcMain.handle('shell:run', async (_event, command) => {
  return runCommand(command);
});

// Open a URL in the user's default browser.
ipcMain.handle('shell:openExternal', async (_event, url) => {
  await shell.openExternal(url);
});

// Get home directory.
ipcMain.handle('fs:homedir', async () => {
  return os.homedir();
});

// Track active processes for cancellation
const activeProcesses = new Map();

// Run a long-lived command with streaming output (for installs, clones, etc.)
ipcMain.handle('shell:runStreaming', async (event, command) => {
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', ['-c', command], {
      env: getShellEnv(),
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      event.sender.send('shell:streamOutput', { data: data.toString(), stream: 'stdout' });
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      event.sender.send('shell:streamOutput', { data: data.toString(), stream: 'stderr' });
    });

    child.on('close', (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
        succeeded: code === 0,
      });
    });

    child.on('error', (err) => {
      resolve({
        stdout,
        stderr: err.message,
        exitCode: 1,
        succeeded: false,
      });
    });
  });
});

// Run a command with streaming output, trackable by ID for cancellation
ipcMain.handle('shell:runStreamingWithId', async (event, command, id) => {
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', ['-c', command], {
      env: getShellEnv(),
    });

    activeProcesses.set(id, { child, cancelled: false });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      event.sender.send('shell:streamOutput', { data: data.toString(), stream: 'stdout', id });
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      event.sender.send('shell:streamOutput', { data: data.toString(), stream: 'stderr', id });
    });

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
});

// Cancel a running process by ID
ipcMain.handle('shell:cancelProcess', async (_event, id) => {
  const processInfo = activeProcesses.get(id);
  if (processInfo) {
    processInfo.cancelled = true;
    processInfo.child.kill('SIGTERM');
    return true;
  }
  return false;
});

// Open a path with the default application
ipcMain.handle('shell:openPath', async (_event, filePath) => {
  return shell.openPath(filePath);
});

// ─── Config Loading ────────────────────────────────────────────────

// Load config from a local file
ipcMain.handle('config:loadFile', async (_event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const config = yaml.load(content);
    return validateConfig(config);
  } catch (err) {
    return { error: err.message };
  }
});

// Load config from a URL
ipcMain.handle('config:loadURL', async (_event, url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const content = await response.text();
    const config = yaml.load(content);
    return validateConfig(config);
  } catch (err) {
    return { error: err.message };
  }
});

// Load the bundled default config
ipcMain.handle('config:loadBundled', async () => {
  try {
    // In development, load from examples/; in production, from Resources
    const devPath = path.join(__dirname, 'examples', 'default.onboard');
    const prodPath = path.join(process.resourcesPath, 'default.onboard');
    const filePath = fs.existsSync(devPath) ? devPath : prodPath;
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content); // Bundled config assumed valid
  } catch (err) {
    return { error: err.message };
  }
});

// Open a file dialog to select a .onboard file
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Onboard Config', extensions: ['onboard'] },
      { name: 'YAML Files', extensions: ['yaml', 'yml'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:windowClosed', id);
    }
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
  if (app.isPackaged) {
    autoUpdater.checkForUpdates();
  } else {
    broadcastToAllWindows('updater:updateNotAvailable');
  }
});
ipcMain.handle('updater:downloadUpdate', () => autoUpdater.downloadUpdate());
ipcMain.handle('updater:installUpdate', () => autoUpdater.quitAndInstall());
ipcMain.handle('updater:dismissUpdate', () => { pendingUpdateInfo = null; });

app.whenReady().then(() => {
  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates(), 5000);
    setInterval(() => autoUpdater.checkForUpdates(), 30 * 60 * 1000);
  }
});
