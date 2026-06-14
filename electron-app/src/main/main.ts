// electron-app/src/main/main.ts
// Electron main process — creates the always-on-top overlay window.
// Auto-capture is OFF by default; the renderer controls it via the awaited
// "toggle-auto-capture-sync" IPC handler in ipcHandlers.ts (NOT a fire-and-forget
// send/on pair — that was removed because it raced with manual captures).

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

  // Tell the renderer the current auto-capture state (off) right after load
  overlayWindow.webContents.once("did-finish-load", () => {
    overlayWindow?.webContents.send("auto-capture-state", {
      enabled: false,
      intervalMs: parseInt(process.env.CAPTURE_INTERVAL_MS || "20000", 10),
    });
  });
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
  // Ctrl/Cmd+Shift+A — Capture & analyze now (manual trigger)
  globalShortcut.register("CommandOrControl+Shift+A", () => {
    captureManager.captureNow(() => overlayWindow);
    overlayWindow?.show();
  });

  // Ctrl/Cmd+Shift+H — Toggle overlay visibility
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

  // NOTE: the old fire-and-forget "toggle-auto-capture" (ipcMain.on) handler
  // was removed from here. It raced with manual captures because the renderer
  // could not know WHEN the interval had actually stopped before issuing the
  // next manual capture. It has been replaced by the AWAITED
  // "toggle-auto-capture-sync" ipcMain.handle in ipcHandlers.ts, which the
  // renderer calls via `await window.electronAPI.toggleAutoCaptureSync(...)`.

  ipcHandlers.register(ipcMain, () => overlayWindow);
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

process.on("unhandledRejection", (reason: any) => {
  console.error("[main] UNHANDLED REJECTION:", reason);
  if (reason?.errors) {
    reason.errors.forEach((e: any) => console.error(e));
  }
  // Forward to renderer if window is available
  overlayWindow?.webContents.send("analysis-status", {
    status: "error",
    code: "UNKNOWN",
    message: `Unhandled error: ${String(reason?.message || reason)}`,
  });
});

process.on("uncaughtException", (err) => {
  console.error("[main] UNCAUGHT EXCEPTION:", err);
  overlayWindow?.webContents.send("analysis-status", {
    status: "error",
    code: "UNKNOWN",
    message: `Uncaught exception: ${err.message}`,
  });
});

app.whenReady().then(() => {
  createOverlayWindow();
  createTray();
  registerShortcuts();
  registerIPC();

  // ⚠️  Auto-capture is NOT started here.
  // The renderer's title-bar toggle calls "toggle-auto-capture-sync" when the
  // user explicitly enables it. Default state is manual-only.

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
// // Electron main process — creates the always-on-top overlay window.
// // Auto-capture is OFF by default; the renderer controls it via IPC toggle.

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

// declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
// declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

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
//       preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
//       contextIsolation: true,
//       nodeIntegration: false,
//       sandbox: false,
//     },
//   });

//   overlayWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

//   if (process.env.NODE_ENV === "development") {
//     overlayWindow.webContents.openDevTools({ mode: "detach" });
//   }

//   overlayWindow.on("closed", () => {
//     overlayWindow = null;
//   });

//   overlayWindow.setMovable(true);
//   smartTrigger.init(overlayWindow);

//   // Tell the renderer the current auto-capture state (off) right after load
//   overlayWindow.webContents.once("did-finish-load", () => {
//     overlayWindow?.webContents.send("auto-capture-state", {
//       enabled: false,
//       intervalMs: parseInt(process.env.CAPTURE_INTERVAL_MS || "20000", 10),
//     });
//   });
// }

// // ─── System Tray ──────────────────────────────────────────────────────────────

// function createTray() {
//   const icon = nativeImage.createEmpty();
//   tray = new Tray(icon);

//   const contextMenu = Menu.buildFromTemplate([
//     {
//       label: "Show / Hide",
//       click: () => {
//         overlayWindow?.isVisible() ? overlayWindow.hide() : overlayWindow?.show();
//       },
//     },
//     {
//       label: "Analyze Now",
//       click: () => captureManager.captureNow(overlayWindow),
//     },
//     { type: "separator" },
//     {
//       label: "New Session",
//       click: async () => captureManager.startNewSession(overlayWindow),
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
//   // Ctrl/Cmd+Shift+A — Capture & analyze now (manual trigger)
//   globalShortcut.register("CommandOrControl+Shift+A", () => {
//     captureManager.captureNow(() => overlayWindow);
//     overlayWindow?.show();
//   });

//   // Ctrl/Cmd+Shift+H — Toggle overlay visibility
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
//     await captureManager.captureNow(() => overlayWindow);
//   });

//   ipcMain.on("resize-window", (_, { width, height }: { width: number; height: number }) => {
//     overlayWindow?.setSize(width, height);
//   });

//   ipcMain.on("hide-window", () => overlayWindow?.hide());
//   ipcMain.on("show-window", () => overlayWindow?.show());

//   // ── Auto-capture toggle — renderer controls this, not app startup ──────────
//   // Replaces the old hard-coded startAutoCapture() call in app.whenReady().
//   ipcMain.on(
//     "toggle-auto-capture",
//     (_, { enabled, intervalMs }: { enabled: boolean; intervalMs?: number }) => {
//       const interval = intervalMs || parseInt(process.env.CAPTURE_INTERVAL_MS || "20000", 10);
//       if (enabled) {
//         captureManager.startAutoCapture(() => overlayWindow, interval);
//       } else {
//         captureManager.stopAutoCapture();
//       }
//       // Acknowledge back to renderer
//       overlayWindow?.webContents.send("auto-capture-state", { enabled, intervalMs: interval });
//     }
//   );

//   ipcHandlers.register(ipcMain, () => overlayWindow);
// }

// // ─── App Lifecycle ────────────────────────────────────────────────────────────

// process.on("unhandledRejection", (reason: any) => {
//   console.error("[main] UNHANDLED REJECTION:", reason);
//   if (reason?.errors) {
//     reason.errors.forEach((e: any) => console.error(e));
//   }
//   // Forward to renderer if window is available
//   overlayWindow?.webContents.send("analysis-status", {
//     status: "error",
//     code: "UNKNOWN",
//     message: `Unhandled error: ${String(reason?.message || reason)}`,
//   });
// });

// process.on("uncaughtException", (err) => {
//   console.error("[main] UNCAUGHT EXCEPTION:", err);
//   overlayWindow?.webContents.send("analysis-status", {
//     status: "error",
//     code: "UNKNOWN",
//     message: `Uncaught exception: ${err.message}`,
//   });
// });

// app.whenReady().then(() => {
//   createOverlayWindow();
//   createTray();
//   registerShortcuts();
//   registerIPC();

//   // ⚠️  Auto-capture is NOT started here.
//   // The renderer's SettingsPanel sends "toggle-auto-capture" { enabled: true }
//   // when the user explicitly enables it. Default state is manual-only.

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
