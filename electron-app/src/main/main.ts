// electron-app/src/main/main.ts
// Electron main process — creates the always-on-top overlay window

import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  Tray,
  Menu,
  nativeImage,
} from "electron";
import * as path from "path";
import { config } from "dotenv";
import { captureManager } from "./captureManager";
import { ipcHandlers } from "./ipcHandlers";
import { smartTrigger } from "./smartTrigger";

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

config({ path: path.join(__dirname, "../../.env") });

let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// ─── Create the floating overlay window ───────────────────────────────────────

function createOverlayWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  overlayWindow = new BrowserWindow({
    width: 380,
    height: 600,
    x: width - 400,
    y: height - 650,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  overlayWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  if (process.env.NODE_ENV === "development") {
    overlayWindow.webContents.openDevTools({ mode: "detach" });
  }

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });

  overlayWindow.setMovable(true);
  smartTrigger.init(overlayWindow);
}

// ─── System Tray ──────────────────────────────────────────────────────────────

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show / Hide",
      click: () => {
        overlayWindow?.isVisible() ? overlayWindow.hide() : overlayWindow?.show();
      },
    },
    {
      label: "Analyze Now",
      click: () => captureManager.captureNow(overlayWindow),
    },
    { type: "separator" },
    {
      label: "New Session",
      click: async () => captureManager.startNewSession(overlayWindow),
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip("AI Desktop Assistant");
  tray.on("click", () => {
    overlayWindow?.isVisible() ? overlayWindow.hide() : overlayWindow?.show();
  });
}

// ─── Global Shortcuts ─────────────────────────────────────────────────────────

function registerShortcuts() {
  // Ctrl+Shift+A — Capture & analyze now
  globalShortcut.register("CommandOrControl+Shift+A", () => {
    captureManager.captureNow(() => overlayWindow);
    overlayWindow?.show();
  });

  // Ctrl+Shift+H — Toggle visibility
  globalShortcut.register("CommandOrControl+Shift+H", () => {
    overlayWindow?.isVisible() ? overlayWindow.hide() : overlayWindow?.show();
  });
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

function registerIPC() {
  ipcMain.handle("capture-screen", async () => {
    return await captureManager.captureScreen();
  });

  ipcMain.handle("analyze-now", async () => {
    await captureManager.captureNow(() => overlayWindow);
  });

  ipcMain.on("resize-window", (_, { width, height }: { width: number; height: number }) => {
    overlayWindow?.setSize(width, height);
  });

  ipcMain.on("hide-window", () => overlayWindow?.hide());
  ipcMain.on("show-window", () => overlayWindow?.show());

  ipcHandlers.register(ipcMain, () => overlayWindow);
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

process.on("unhandledRejection", (reason: any) => {
  console.error("UNHANDLED REJECTION", reason);
  if (reason?.errors) {
    reason.errors.forEach((e: any) => console.error(e));
  }
});

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION", err);
});

app.whenReady().then(() => {
  createOverlayWindow();
  createTray();
  registerShortcuts();
  registerIPC();

  const intervalMs = parseInt(
    process.env.CAPTURE_INTERVAL_MS || "20000",
    10
  );
  captureManager.startAutoCapture(() => overlayWindow, intervalMs);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createOverlayWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  captureManager.stopAutoCapture();
  smartTrigger.destroy();
});



// // electron-app/src/main/main.ts
// // Electron main process — creates the always-on-top overlay window

// import {
//   app,
//   BrowserWindow,
//   globalShortcut,
//   ipcMain,
//   screen,
//   Tray,
//   Menu,
//   nativeImage,
// } from "electron";
// import * as path from "path";
// import { config } from "dotenv";
// import { captureManager } from "./captureManager";
// import { ipcHandlers } from "./ipcHandlers";
// import { smartTrigger } from "./smartTrigger";


// // Forge+webpack injects these globals at build time.
// // They must match the entry point name ("main_window") in forge.config.js.
// declare const MAIN_WINDOW_WEBPACK_ENTRY: string;         // renderer HTML URL
// declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string; // preload script path

// config({ path: path.join(__dirname, "../../.env") });

// let overlayWindow: BrowserWindow | null = null;
// let tray: Tray | null = null;

// // ─── Create the floating overlay window ───────────────────────────────────────

// function createOverlayWindow() {
//   const { width, height } = screen.getPrimaryDisplay().workAreaSize;

//   overlayWindow = new BrowserWindow({
//     width: 380,
//     height: 600,
//     x: width - 400,
//     y: height - 650,
//     frame: false,
//     transparent: true,
//     alwaysOnTop: true,
//     resizable: true,
//     skipTaskbar: true,
//     webPreferences: {
//       // forge+webpack provides this path via the declared constant
//       preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
//       contextIsolation: true,
//       nodeIntegration: false,
//       sandbox: false, // must be false for contextBridge preload to work
//     },
//   });

//   // forge+webpack serves the renderer and injects MAIN_WINDOW_WEBPACK_ENTRY
//   overlayWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

//   if (process.env.NODE_ENV === "development") {
//     overlayWindow.webContents.openDevTools({ mode: "detach" });
//   }

//   overlayWindow.on("closed", () => {
//     overlayWindow = null;
//   });

//   overlayWindow.setMovable(true);

//   // Initialise smart trigger now that we have the window reference
//   smartTrigger.init(overlayWindow);
// }

// // ─── System Tray Icon ─────────────────────────────────────────────────────────

// function createTray() {
//   const icon = nativeImage.createEmpty();
//   tray = new Tray(icon);

//   const contextMenu = Menu.buildFromTemplate([
//     {
//       label: "Show / Hide Assistant",
//       click: () => {
//         overlayWindow?.isVisible() ? overlayWindow.hide() : overlayWindow?.show();
//       },
//     },
//     {
//       label: "Analyze Now",
//       click: () => captureManager.captureNow(overlayWindow),
//     },
//     { type: "separator" },
//     { label: "Quit", click: () => app.quit() },
//   ]);

//   tray.setContextMenu(contextMenu);
//   tray.setToolTip("AI Desktop Assistant");
//   tray.on("click", () => {
//     overlayWindow?.isVisible() ? overlayWindow.hide() : overlayWindow?.show();
//   });
// }

// // ─── Global Shortcuts ─────────────────────────────────────────────────────────

// function registerShortcuts() {
//   globalShortcut.register("CommandOrControl+Shift+A", () => {
//     captureManager.captureNow(overlayWindow);
//     overlayWindow?.show();
//   });

//   globalShortcut.register("CommandOrControl+Shift+H", () => {
//     overlayWindow?.isVisible() ? overlayWindow.hide() : overlayWindow?.show();
//   });
// }

// // ─── IPC Handlers ────────────────────────────────────────────────────────────

// function registerIPC() {
//   ipcMain.handle("capture-screen", async () => {
//     return await captureManager.captureScreen();
//   });

//   ipcMain.handle("analyze-now", async () => {
//     // Pass a getter so captureNow always gets the current window reference
//     await captureManager.captureNow(overlayWindow);
//   });

//   ipcMain.on("resize-window", (_, { width, height }: { width: number; height: number }) => {
//     overlayWindow?.setSize(width, height);
//   });

//   ipcMain.on("hide-window", () => overlayWindow?.hide());
//   ipcMain.on("show-window", () => overlayWindow?.show());

//   // Pass a window getter instead of a stale reference so ipcHandlers
//   // always routes to the live window even after it has been recreated.
//   ipcHandlers.register(ipcMain, () => overlayWindow);
// }

// // ─── App Lifecycle ────────────────────────────────────────────────────────────

// app.whenReady().then(() => {
//   createOverlayWindow();
//   createTray();
//   registerShortcuts();
//   registerIPC();

//   const intervalMs = parseInt(process.env.CAPTURE_INTERVAL_MS || "5000", 10);
//   captureManager.startAutoCapture(() => overlayWindow, intervalMs);

//   app.on("activate", () => {
//     if (BrowserWindow.getAllWindows().length === 0) createOverlayWindow();
//   });
// });

// app.on("window-all-closed", () => {
//   if (process.platform !== "darwin") app.quit();
// });

// app.on("will-quit", () => {
//   globalShortcut.unregisterAll();
//   captureManager.stopAutoCapture();
//   smartTrigger.destroy();
// });