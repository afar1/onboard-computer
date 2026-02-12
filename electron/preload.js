// preload.js — Secure bridge between Electron main process and the renderer.
// Exposes a clean API on window.onboard without giving the renderer
// direct access to Node.js or Electron internals.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Track the current stream listener so we can swap it out
// between streaming commands (prevents listener accumulation).
let currentStreamCallback = null;

function streamRouter(_event, data) {
  if (currentStreamCallback) currentStreamCallback(data);
}

// Register exactly one listener on the channel. The callback
// is swapped via setStreamCallback below.
ipcRenderer.on('shell:streamOutput', streamRouter);

// Track file open callback (for double-click on .onboard files)
let fileOpenedCallback = null;
ipcRenderer.on('config:fileOpened', (_event, filePath) => {
  if (fileOpenedCallback) fileOpenedCallback(filePath);
});

// Track terminal window close callbacks
let terminalWindowClosedCallback = null;
ipcRenderer.on('terminal:windowClosed', (_event, id) => {
  if (terminalWindowClosedCallback) terminalWindowClosedCallback(id);
});

// ─── Updater Event Callbacks ────────────────────────────────────────
let updaterCallbacks = {
  onCheckingForUpdate: null,
  onUpdateAvailable: null,
  onUpdateNotAvailable: null,
  onDownloadProgress: null,
  onUpdateDownloaded: null,
  onError: null,
};

ipcRenderer.on('updater:checkingForUpdate', () => {
  if (updaterCallbacks.onCheckingForUpdate) updaterCallbacks.onCheckingForUpdate();
});
ipcRenderer.on('updater:updateAvailable', (_event, info) => {
  if (updaterCallbacks.onUpdateAvailable) updaterCallbacks.onUpdateAvailable(info);
});
ipcRenderer.on('updater:updateNotAvailable', () => {
  if (updaterCallbacks.onUpdateNotAvailable) updaterCallbacks.onUpdateNotAvailable();
});
ipcRenderer.on('updater:downloadProgress', (_event, percent) => {
  if (updaterCallbacks.onDownloadProgress) updaterCallbacks.onDownloadProgress(percent);
});
ipcRenderer.on('updater:updateDownloaded', (_event, info) => {
  if (updaterCallbacks.onUpdateDownloaded) updaterCallbacks.onUpdateDownloaded(info);
});
ipcRenderer.on('updater:error', (_event, error) => {
  if (updaterCallbacks.onError) updaterCallbacks.onError(error);
});

contextBridge.exposeInMainWorld('updaterAPI', {
  getVersion: () => ipcRenderer.invoke('updater:getVersion'),
  getStatus: () => ipcRenderer.invoke('updater:getStatus'),
  checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),
  downloadUpdate: () => ipcRenderer.invoke('updater:downloadUpdate'),
  installUpdate: () => ipcRenderer.invoke('updater:installUpdate'),
  dismissUpdate: () => ipcRenderer.invoke('updater:dismissUpdate'),
  onCheckingForUpdate: (cb) => { updaterCallbacks.onCheckingForUpdate = cb; return () => { updaterCallbacks.onCheckingForUpdate = null; }; },
  onUpdateAvailable: (cb) => { updaterCallbacks.onUpdateAvailable = cb; return () => { updaterCallbacks.onUpdateAvailable = null; }; },
  onUpdateNotAvailable: (cb) => { updaterCallbacks.onUpdateNotAvailable = cb; return () => { updaterCallbacks.onUpdateNotAvailable = null; }; },
  onDownloadProgress: (cb) => { updaterCallbacks.onDownloadProgress = cb; return () => { updaterCallbacks.onDownloadProgress = null; }; },
  onUpdateDownloaded: (cb) => { updaterCallbacks.onUpdateDownloaded = cb; return () => { updaterCallbacks.onUpdateDownloaded = null; }; },
  onError: (cb) => { updaterCallbacks.onError = cb; return () => { updaterCallbacks.onError = null; }; },
});

contextBridge.exposeInMainWorld('onboard', {
  // Run a shell command and get back { stdout, stderr, exitCode, succeeded }.
  run: (command) => ipcRenderer.invoke('shell:run', command),

  // Open a URL in the default browser.
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Get the user's home directory.
  homedir: () => ipcRenderer.invoke('fs:homedir'),

  // Run a command with streaming output (for long installs).
  runStreaming: (command) => ipcRenderer.invoke('shell:runStreaming', command),

  // Run a command with streaming output and process ID for cancellation.
  runStreamingWithId: (command, id) => ipcRenderer.invoke('shell:runStreamingWithId', command, id),

  // Cancel a running process by ID.
  cancelProcess: (id) => ipcRenderer.invoke('shell:cancelProcess', id),

  // Open a path (app, file, or folder) with the default handler.
  openPath: (path) => ipcRenderer.invoke('shell:openPath', path),

  // Set the callback that receives streaming output chunks.
  setStreamCallback: (callback) => {
    currentStreamCallback = callback;
  },

  // Clear the stream callback (call after streaming is done).
  clearStreamCallback: () => {
    currentStreamCallback = null;
  },

  // ─── Config Loading ────────────────────────────────────────────────

  // Load config from a local file path.
  loadConfigFile: (filePath) => ipcRenderer.invoke('config:loadFile', filePath),

  // Load config from a URL.
  loadConfigURL: (url) => ipcRenderer.invoke('config:loadURL', url),

  // Load the bundled default config.
  loadBundledConfig: () => ipcRenderer.invoke('config:loadBundled'),

  // Set callback for when a .onboard file is opened (double-click).
  onFileOpened: (callback) => {
    fileOpenedCallback = callback;
  },

  // Get the file path from a dropped file (needed with contextIsolation)
  getFilePath: (file) => webUtils.getPathForFile(file),

  // Open a file dialog to select a .onboard file.
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),

  // Terminal window functions
  openTerminalWindow: (id, name, existingOutput) => ipcRenderer.invoke('terminal:openWindow', id, name, existingOutput),
  sendToTerminalWindow: (id, data, stream) => ipcRenderer.invoke('terminal:sendOutput', id, data, stream),
  onTerminalWindowClosed: (callback) => {
    terminalWindowClosedCallback = callback;
  },
});
