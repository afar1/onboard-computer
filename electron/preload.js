// preload.js — Secure bridge between Electron main process and the renderer.
// The renderer addresses config items by id; no shell command strings cross
// this boundary in either direction.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// ─── Event routing (one listener per channel, swappable callbacks) ──

const callbacks = {
  streamOutput: null,
  itemStatus: null,
  orchestrateProgress: null,
  deviceCode: null,
  fileOpened: null,
  terminalWindowClosed: null,
};

ipcRenderer.on('shell:streamOutput', (_event, payload) => {
  if (callbacks.streamOutput) callbacks.streamOutput(payload);
});
ipcRenderer.on('item:status', (_event, payload) => {
  if (callbacks.itemStatus) callbacks.itemStatus(payload);
});
ipcRenderer.on('orchestrate:progress', (_event, payload) => {
  if (callbacks.orchestrateProgress) callbacks.orchestrateProgress(payload);
});
ipcRenderer.on('setup:deviceCode', (_event, payload) => {
  if (callbacks.deviceCode) callbacks.deviceCode(payload);
});
ipcRenderer.on('config:fileOpened', (_event, filePath) => {
  if (callbacks.fileOpened) callbacks.fileOpened(filePath);
});
ipcRenderer.on('terminal:windowClosed', (_event, id) => {
  if (callbacks.terminalWindowClosed) callbacks.terminalWindowClosed(id);
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
  // ─── Config loading ──────────────────────────────────────────────
  loadConfigFile: (filePath) => ipcRenderer.invoke('config:loadFile', filePath),
  loadConfigURL: (url) => ipcRenderer.invoke('config:loadURL', url),
  loadBundledConfig: (name) => ipcRenderer.invoke('config:loadBundled', name),
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  getFilePath: (file) => webUtils.getPathForFile(file),
  homedir: () => ipcRenderer.invoke('fs:homedir'),
  onFileOpened: (cb) => { callbacks.fileOpened = cb; },

  // ─── Items (resolved by id in the main process) ──────────────────
  checkAll: () => ipcRenderer.invoke('items:checkAll'),
  checkItem: (id) => ipcRenderer.invoke('items:check', id),
  installItem: (id) => ipcRenderer.invoke('items:install', id),
  uninstallItem: (id) => ipcRenderer.invoke('items:uninstall', id),
  upgradeItem: (id) => ipcRenderer.invoke('items:upgrade', id),
  cancelItem: (id) => ipcRenderer.invoke('items:cancel', id),
  openItemApp: (id) => ipcRenderer.invoke('items:openApp', id),
  revealItem: (id) => ipcRenderer.invoke('items:reveal', id),

  // ─── Setup steps ─────────────────────────────────────────────────
  runSetupAction: (id) => ipcRenderer.invoke('setup:action', id),
  submitSetupInput: (id, values) => ipcRenderer.invoke('setup:input', id, values),
  openSetupUrl: (id) => ipcRenderer.invoke('setup:openUrl', id),
  runInTerminal: (id) => ipcRenderer.invoke('setup:terminal', id),
  setupPollStart: () => ipcRenderer.invoke('setup:pollStart'),
  setupPollStop: () => ipcRenderer.invoke('setup:pollStop'),

  // ─── Orchestration ("Set up my Mac") ─────────────────────────────
  getPlan: () => ipcRenderer.invoke('orchestrate:getPlan'),
  runAll: () => ipcRenderer.invoke('orchestrate:run'),
  cancelAll: () => ipcRenderer.invoke('orchestrate:cancel'),

  // ─── Events ──────────────────────────────────────────────────────
  onStreamOutput: (cb) => { callbacks.streamOutput = cb; },
  onItemStatus: (cb) => { callbacks.itemStatus = cb; },
  onOrchestrateProgress: (cb) => { callbacks.orchestrateProgress = cb; },
  onDeviceCode: (cb) => { callbacks.deviceCode = cb; },

  // ─── Misc ────────────────────────────────────────────────────────
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Terminal pop-out windows
  openTerminalWindow: (id, name, existingOutput) => ipcRenderer.invoke('terminal:openWindow', id, name, existingOutput),
  sendToTerminalWindow: (id, data, stream) => ipcRenderer.invoke('terminal:sendOutput', id, data, stream),
  onTerminalWindowClosed: (cb) => { callbacks.terminalWindowClosed = cb; },
});
