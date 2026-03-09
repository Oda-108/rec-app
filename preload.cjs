const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  // Control window: listen for toggle-recording from main process
  onToggleRecording: (callback) => {
    ipcRenderer.on('toggle-recording', () => callback());
  },

  // Control window: notify main process of recording state
  notifyRecordingState: (isRecording) => {
    ipcRenderer.send('recording-state-changed', isRecording);
  },

  // Control window: notify main process that recording was saved
  notifyRecordingSaved: () => {
    ipcRenderer.send('recording-saved');
  },

  // Main window: listen for recording state changes
  onRecordingState: (callback) => {
    ipcRenderer.on('recording-state', (_event, state) => callback(state));
  },

  // Main window: listen for refresh-recordings
  onRefreshRecordings: (callback) => {
    ipcRenderer.on('refresh-recordings', () => callback());
  },

  // Main window: trigger recording start/stop
  triggerRecording: () => {
    ipcRenderer.send('trigger-recording');
  },

  // Show main window
  showMainWindow: () => {
    ipcRenderer.send('show-main-window');
  },
});
