const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terminalAPI', {
  onOutput: (callback) => {
    ipcRenderer.on('terminal:output', (_event, data, stream) => {
      callback(data, stream);
    });
  },
  // Send a line of input to the process this terminal window is attached to.
  // Main routes it by window; the renderer never names a process directly.
  sendInput: (data) => {
    if (typeof data === 'string' && data.length <= 10000) {
      ipcRenderer.send('terminal:stdin', data);
    }
  },
});
