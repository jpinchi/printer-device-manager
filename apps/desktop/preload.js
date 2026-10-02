// Puente seguro entre la interfaz web (renderer) y el proceso principal de
// Electron. Expone SOLO lo necesario para mostrar la versión y disparar la
// búsqueda de actualizaciones desde la propia app.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pdmDesktop", {
  isDesktop: true,
  getVersion: () => ipcRenderer.invoke("pdm:version"),
  checkForUpdates: () => ipcRenderer.invoke("pdm:check-updates"),
});
