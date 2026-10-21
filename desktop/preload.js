'use strict';
// Ponte mínima: o renderer (UI servida pela API) continua sem Node e sem acesso ao sistema.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('minhaiaDesktop', {
  chooseFolder: () => ipcRenderer.invoke('desktop:choose-folder'),
  openSecretsFolder: () => ipcRenderer.invoke('desktop:open-secrets'),
  minimizeWindow: () => ipcRenderer.invoke('desktop:minimize-window'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('desktop:toggle-maximize-window'),
  closeWindow: () => ipcRenderer.invoke('desktop:close-window'),
});
