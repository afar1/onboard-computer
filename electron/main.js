// main.js — Electron main process.
// Creates the onboarding window and handles all shell execution
// via IPC so the renderer never touches Node directly.

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

// ─── Window Setup ──────────────────────────────────────────────────
// The window is centered and takes up ~38% of the screen.
// Dense, focused, not full-screen — like a setup wizard.

function createWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;

  const winWidth = Math.min(Math.round(screenW * 0.38), 580);
  const winHeight = Math.round(screenH * 0.75);

  const win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    minWidth: 480,
    minHeight: 500,
    maxWidth: 580,
    center: true,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile('index.html');
  return win;
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

// ─── Shell Helpers ─────────────────────────────────────────────────
// All shell commands run through these. The renderer asks via IPC,
// the main process executes and returns results.

// Build a shell env that includes common paths (Homebrew, nvm, etc.)
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

// ─── IPC Handlers ──────────────────────────────────────────────────
// Each handler corresponds to a specific onboarding action.
// The renderer calls these through the preload bridge.

// Run an arbitrary shell command and return the result.
ipcMain.handle('shell:run', async (_event, command) => {
  return runCommand(command);
});

// Check if a tool is installed by running `which <tool>` and optionally a version command.
ipcMain.handle('tool:check', async (_event, toolId) => {
  const checks = {
    'xcode-cli': { which: 'xcode-select', version: 'xcode-select -p >/dev/null 2>&1 && echo "installed" || echo ""' },
    homebrew: { which: 'brew', version: 'brew --version | head -1' },
    git: { which: 'git', version: 'git --version' },
    node: { which: 'node', version: 'node --version' },
    npm: { which: 'npm', version: 'npm --version' },
    python: { which: 'python3', version: 'python3 --version' },
    claude: { which: 'claude', version: 'claude --version 2>/dev/null || echo "installed"' },
    bun: { which: 'bun', version: 'bun --version' },
    gh: { which: 'gh', version: 'gh --version | head -1' },
    'cursor-cli': { which: 'cursor', version: 'cursor --version 2>/dev/null || echo "installed"' },
  };

  const check = checks[toolId];
  if (!check) return { installed: false, version: null };

  const whichResult = await runCommand(`which ${check.which}`);
  if (!whichResult.succeeded) {
    return { installed: false, version: null, path: null };
  }

  const versionResult = await runCommand(check.version);
  return {
    installed: true,
    version: versionResult.stdout || versionResult.stderr || 'unknown',
    path: whichResult.stdout,
  };
});

// Open a URL in the user's default browser.
ipcMain.handle('shell:openExternal', async (_event, url) => {
  await shell.openExternal(url);
});

// Check if a directory exists.
ipcMain.handle('fs:dirExists', async (_event, dirPath) => {
  const resolved = dirPath.replace(/^~/, os.homedir());
  return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
});

// Create a directory (recursive).
ipcMain.handle('fs:mkdir', async (_event, dirPath) => {
  const resolved = dirPath.replace(/^~/, os.homedir());
  try {
    fs.mkdirSync(resolved, { recursive: true });
    return { success: true, path: resolved };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Get home directory.
ipcMain.handle('fs:homedir', async () => {
  return os.homedir();
});

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
