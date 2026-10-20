export interface DesktopWindowOptions {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  title: string;
  backgroundColor: string;
  show: boolean;
  webPreferences: {
    nodeIntegration: boolean;
    contextIsolation: boolean;
    sandbox: boolean;
    preload: string;
  };
}

export function createWindowOptions(preloadPath: string): DesktopWindowOptions {
  return {
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    title: "Universal Manga Translator 桌面控制台",
    backgroundColor: "#f4f7fb",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: preloadPath,
    },
  };
}
