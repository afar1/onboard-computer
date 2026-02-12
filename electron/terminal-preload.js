const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terminalAPI', {
  onOutput: (callback) => {
    ipcRenderer.on('terminal:output', (_event, data, stream) => {
      callback(data, stream);
    });
  },
});
