import { app, BrowserWindow, ipcMain, Menu } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBackendManager, defaultBackendUrl } from "./backend-manager.js";
import { createDesktopShellHtml } from "./app-shell.js";
import { createWindowOptions } from "./window-config.js";

let mainWindow: BrowserWindow | undefined;
const backendUrl = defaultBackendUrl();
const backendManager = createBackendManager({ backendUrl });
const __dirname = dirname(fileURLToPath(import.meta.url));

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow(createWindowOptions(join(__dirname, "preload.cjs")));
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = undefined; });
  await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createDesktopShellHtml())}`);
}

ipcMain.handle("umt:status", () => backendManager.getStatus());
ipcMain.handle("umt:start", async () => (await backendManager.startBackend()).status);
ipcMain.handle("umt:stop", async () => {
  backendManager.stopOwnedBackend();
  return backendManager.getStatus();
});
ipcMain.handle("umt:cleanup", async () => (await backendManager.cleanupExistingBackend()).status);

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  void createMainWindow();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});


