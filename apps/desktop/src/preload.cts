import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("umtDesktop", {
  status: () => ipcRenderer.invoke("umt:status"),
  start: () => ipcRenderer.invoke("umt:start"),
  stop: () => ipcRenderer.invoke("umt:stop"),
  cleanup: () => ipcRenderer.invoke("umt:cleanup"),
});
