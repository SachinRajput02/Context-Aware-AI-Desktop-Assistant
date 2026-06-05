// electron-app/src/main/ipcHandlers.ts
// Extended: document upload, session stop/new, voice transcript forwarding.

import { IpcMain, clipboard, dialog } from "electron";
import type { BrowserWindow } from "electron";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import { captureManager } from "./captureManager";
import dotenv from "dotenv";

dotenv.config();

const BACKEND_URL =
  process.env.BACKEND_URL ||
  "https://sds9n3ijta.execute-api.ap-south-1.amazonaws.com/prod2";

type WindowGetter = () => BrowserWindow | null;

// Text MIME types — we read these as UTF-8
const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/html",
  "text/css",
  "text/javascript",
  "application/json",
  "application/xml",
  "text/xml",
  "text/csv",
  "application/typescript",
]);

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return [
    ".txt", ".md", ".json", ".js", ".ts", ".tsx", ".jsx",
    ".py", ".go", ".rs", ".java", ".cpp", ".c", ".h",
    ".css", ".html", ".xml", ".csv", ".yaml", ".yml",
    ".sh", ".bash", ".env", ".toml", ".ini", ".conf",
  ].includes(ext);
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".js": "text/javascript",
    ".ts": "application/typescript",
    ".tsx": "application/typescript",
    ".jsx": "text/javascript",
    ".py": "text/x-python",
    ".html": "text/html",
    ".css": "text/css",
    ".csv": "text/csv",
    ".xml": "text/xml",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  };
  return map[ext] || "application/octet-stream";
}

export const ipcHandlers = {
  register(ipcMain: IpcMain, getWindow: WindowGetter) {
    // ── Ask a question without a new screenshot ─────────────────────────
    ipcMain.handle("ask-question", async (_, question: string) => {
      try {
        const response = await axios.post(
          `${BACKEND_URL}/api/orchestrate/question`,
          {
            sessionId: captureManager.getSessionId(),
            userId: captureManager.getUserId(),
            question,
          },
          { timeout: 30000 }
        );
        return response.data;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    // ── Ask with current screenshot attached ────────────────────────────
    ipcMain.handle(
      "ask-question-with-screen",
      async (_, question: string) => {
        const win = getWindow();
        await captureManager.captureNow(win, { userQuestion: question });
        return { success: true };
      }
    );

    // ── Clipboard / selected text ────────────────────────────────────────
    ipcMain.handle("get-selected-text", () => {
      return clipboard.readText("selection") || clipboard.readText();
    });

    // ── Auto-capture toggle ──────────────────────────────────────────────
    ipcMain.on(
      "toggle-auto-capture",
      (_, { enabled, intervalMs }: { enabled: boolean; intervalMs?: number }) => {
        if (enabled) {
          captureManager.startAutoCapture(getWindow, intervalMs || 20000);
        } else {
          captureManager.stopAutoCapture();
        }
      }
    );

    // ── Manual capture now ───────────────────────────────────────────────
    ipcMain.handle("capture-now", async () => {
      await captureManager.captureNow(getWindow);
      return { success: true };
    });

    // ── Document upload via file picker ──────────────────────────────────
    ipcMain.handle("open-file-picker", async () => {
      const win = getWindow();
      if (!win) return { success: false, error: "No window" };

      const result = await dialog.showOpenDialog(win, {
        title: "Upload document to session",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Documents & Code",
            extensions: [
              "txt", "md", "json", "js", "ts", "tsx", "jsx",
              "py", "go", "rs", "java", "cpp", "c", "h",
              "css", "html", "xml", "csv", "yaml", "yml",
              "pdf", "png", "jpg", "jpeg",
            ],
          },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const uploadResults = [];
      for (const filePath of result.filePaths) {
        try {
          const name = path.basename(filePath);
          const mimeType = getMimeType(filePath);
          const textFile = isTextFile(filePath);
          const fileBuffer = fs.readFileSync(filePath);

          const content = textFile
            ? fileBuffer.toString("utf-8")
            : fileBuffer.toString("base64");

          const uploadResult = await captureManager.uploadDocument(win, {
            name,
            type: mimeType,
            content,
            isText: textFile,
          });

          uploadResults.push({
            name,
            ...uploadResult,
          });
        } catch (err: any) {
          uploadResults.push({
            name: path.basename(filePath),
            success: false,
            error: err.message,
          });
        }
      }

      return { success: true, results: uploadResults };
    });

    // ── Document upload via drag-and-drop / renderer-provided data ───────
    ipcMain.handle(
      "upload-document-data",
      async (
        _,
        data: { name: string; type: string; content: string; isText: boolean }
      ) => {
        const win = getWindow();
        const result = await captureManager.uploadDocument(win, data);
        return result;
      }
    );

    // ── Remove a document ────────────────────────────────────────────────
    ipcMain.handle("remove-document", async (_, documentId: string) => {
      const success = await captureManager.removeDocument(documentId);
      return { success };
    });

    // ── Session: stop ────────────────────────────────────────────────────
    ipcMain.handle("stop-session", async () => {
      const win = getWindow();
      await captureManager.stopSession(win);
      return { success: true };
    });

    // ── Session: start new ───────────────────────────────────────────────
    ipcMain.handle("new-session", async () => {
      const win = getWindow();
      const newSessionId = await captureManager.startNewSession(win);
      return { success: true, sessionId: newSessionId };
    });

    // ── Session info ─────────────────────────────────────────────────────
    ipcMain.handle("get-session-info", () => ({
      sessionId: captureManager.getSessionId(),
      userId: captureManager.getUserId(),
      isActive: captureManager.isSessionActive(),
    }));

    // ── Voice transcript → treat as a question ───────────────────────────
    ipcMain.handle(
      "voice-transcript",
      async (_, transcript: string) => {
        if (!transcript?.trim()) return { success: false };
        const win = getWindow();
        // Capture screen + attach the voice transcript as the question
        await captureManager.captureNow(win, { userQuestion: transcript });
        return { success: true };
      }
    );
  },
};






// // electron-app/src/main/ipcHandlers.ts
// // Additional IPC event handlers for the main process.
// // Takes a window GETTER so it always operates on the live window reference,
// // not a stale closure captured at registration time.

// import { IpcMain, clipboard } from "electron";
// import type { BrowserWindow } from "electron";
// import axios from "axios";
// import { captureManager } from "./captureManager";
// import dotenv from "dotenv";

// dotenv.config();

// const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";

// type WindowGetter = () => BrowserWindow | null;

// export const ipcHandlers = {
//   register(ipcMain: IpcMain, getWindow: WindowGetter) {
//     // ── Ask a question without a new screenshot ───────────────────────────
//     ipcMain.handle("ask-question", async (_, question: string) => {
//       try {
//         const response = await axios.post(
//           `${BACKEND_URL}/api/orchestrate/question`,
//           {
//             sessionId: captureManager.getSessionId(),
//             userId: captureManager.getUserId(),
//             question,
//           },
//           { timeout: 20000 }
//         );
//         return response.data;
//       } catch (err: any) {
//         return { success: false, error: err.message };
//       }
//     });

//     // ── Clipboard / selected text ─────────────────────────────────────────
//     ipcMain.handle("get-selected-text", () => {
//       // "selection" clipboard is Linux/X11 only; falls back to main clipboard
//       return clipboard.readText("selection") || clipboard.readText();
//     });

//     // ── Auto-capture toggle ───────────────────────────────────────────────
//     ipcMain.on("toggle-auto-capture", (_, { enabled, intervalMs }: { enabled: boolean; intervalMs?: number }) => {
//       if (enabled) {
//         captureManager.startAutoCapture(getWindow, intervalMs || 5000);
//       } else {
//         captureManager.stopAutoCapture();
//       }
//     });

//     // ── Session info ──────────────────────────────────────────────────────
//     ipcMain.handle("get-session-info", () => ({
//       sessionId: captureManager.getSessionId(),
//       userId: captureManager.getUserId(),
//     }));
//   },
// };