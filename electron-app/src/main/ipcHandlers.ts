// electron-app/src/main/ipcHandlers.ts
// Extended: document upload, session stop/new, voice transcript forwarding,
// AND an awaited auto-capture toggle (toggle-auto-capture-sync) that the
// renderer can `await` to know the interval has actually been started/stopped
// before issuing a manual capture — eliminating the auto→manual race.

import { IpcMain, clipboard, dialog } from "electron";
import type { BrowserWindow } from "electron";
import * as fs from "fs";
import * as path from "path";
import axios, { AxiosError } from "axios";
import { captureManager } from "./captureManager";
import dotenv from "dotenv";

dotenv.config();

const BACKEND_URL =
  process.env.BACKEND_URL ||
  "https://sds9n3ijta.execute-api.ap-south-1.amazonaws.com/prod2";

type WindowGetter = () => BrowserWindow | null;

// ─── File-type helpers ────────────────────────────────────────────────────────

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
    ".txt":  "text/plain",
    ".md":   "text/markdown",
    ".json": "application/json",
    ".js":   "text/javascript",
    ".ts":   "application/typescript",
    ".tsx":  "application/typescript",
    ".jsx":  "text/javascript",
    ".py":   "text/x-python",
    ".html": "text/html",
    ".css":  "text/css",
    ".csv":  "text/csv",
    ".xml":  "text/xml",
    ".yaml": "text/yaml",
    ".yml":  "text/yaml",
    ".pdf":  "application/pdf",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
  };
  return map[ext] || "application/octet-stream";
}

// ─── Error helper ─────────────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    if (!err.response) return `Cannot reach backend (${BACKEND_URL}): ${err.message}`;
    return `Server error ${err.response.status}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

// ─── Handler registration ─────────────────────────────────────────────────────

export const ipcHandlers = {
  register(ipcMain: IpcMain, getWindow: WindowGetter) {

    // ── Ask a question without a new screenshot ─────────────────────────────
    ipcMain.handle("ask-question", async (_, question: string) => {
      if (!question?.trim()) return { success: false, error: "Empty question." };
      try {
        const response = await axios.post(
          `${BACKEND_URL}/api/orchestrate/question`,
          {
            sessionId: captureManager.getSessionId(),
            userId: captureManager.getUserId(),
            question,
          },
          { timeout: 30_000 }
        );
        return response.data;
      } catch (err) {
        const msg = errorMessage(err);
        console.error("[ipcHandlers] ask-question error:", msg);
        return { success: false, error: msg };
      }
    });

    // ── Ask with current screenshot attached ────────────────────────────────
    ipcMain.handle("ask-question-with-screen", async (_, question: string) => {
      if (!question?.trim()) return { success: false, error: "Empty question." };
      try {
        const win = getWindow();
        await captureManager.captureNow(win, { userQuestion: question });
        return { success: true };
      } catch (err) {
        const msg = errorMessage(err);
        console.error("[ipcHandlers] ask-question-with-screen error:", msg);
        return { success: false, error: msg };
      }
    });

    // ── Clipboard / selected text ────────────────────────────────────────────
    ipcMain.handle("get-selected-text", () => {
      try {
        return clipboard.readText("selection") || clipboard.readText();
      } catch (err) {
        console.error("[ipcHandlers] get-selected-text error:", errorMessage(err));
        return "";
      }
    });

    // ── Manual capture now ───────────────────────────────────────────────────
    ipcMain.handle("capture-now", async () => {
      try {
        await captureManager.captureNow(getWindow);
        return { success: true };
      } catch (err) {
        const msg = errorMessage(err);
        console.error("[ipcHandlers] capture-now error:", msg);
        return { success: false, error: msg };
      }
    });

    // ── Document upload via file picker ──────────────────────────────────────
    ipcMain.handle("open-file-picker", async () => {
      const win = getWindow();
      if (!win) return { success: false, error: "No window available." };

      let result;
      try {
        result = await dialog.showOpenDialog(win, {
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
      } catch (err) {
        const msg = errorMessage(err);
        console.error("[ipcHandlers] open-file-picker dialog error:", msg);
        return { success: false, error: msg };
      }

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const uploadResults = [];
      for (const filePath of result.filePaths) {
        const name = path.basename(filePath);
        try {
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

          uploadResults.push({ name, ...uploadResult });
        } catch (err) {
          const msg = errorMessage(err);
          console.error(`[ipcHandlers] open-file-picker upload error (${name}):`, msg);
          uploadResults.push({ name, success: false, error: msg });
        }
      }

      return { success: true, results: uploadResults };
    });

    // ── Document upload via drag-and-drop / renderer-provided data ───────────
    ipcMain.handle(
      "upload-document-data",
      async (_, data: { name: string; type: string; content: string; isText: boolean }) => {
        if (!data?.name || !data?.content) {
          return { success: false, error: "Invalid document data." };
        }
        try {
          const win = getWindow();
          return await captureManager.uploadDocument(win, data);
        } catch (err) {
          const msg = errorMessage(err);
          console.error("[ipcHandlers] upload-document-data error:", msg);
          return { success: false, error: msg };
        }
      }
    );

    // ── Remove a document ────────────────────────────────────────────────────
    ipcMain.handle("remove-document", async (_, documentId: string) => {
      if (!documentId) return { success: false, error: "No documentId provided." };
      try {
        const success = await captureManager.removeDocument(documentId);
        return { success };
      } catch (err) {
        const msg = errorMessage(err);
        console.error("[ipcHandlers] remove-document error:", msg);
        return { success: false, error: msg };
      }
    });

    // ── Session: stop ────────────────────────────────────────────────────────
    ipcMain.handle("stop-session", async () => {
      try {
        const win = getWindow();
        await captureManager.stopSession(win);
        return { success: true };
      } catch (err) {
        const msg = errorMessage(err);
        console.error("[ipcHandlers] stop-session error:", msg);
        return { success: false, error: msg };
      }
    });

    // ── Session: start new ───────────────────────────────────────────────────
    ipcMain.handle("new-session", async () => {
      try {
        const win = getWindow();
        const newSessionId = await captureManager.startNewSession(win);
        return { success: true, sessionId: newSessionId };
      } catch (err) {
        const msg = errorMessage(err);
        console.error("[ipcHandlers] new-session error:", msg);
        return { success: false, error: msg };
      }
    });

    // ── Session info ─────────────────────────────────────────────────────────
    ipcMain.handle("get-session-info", () => {
      try {
        return {
          sessionId: captureManager.getSessionId(),
          userId: captureManager.getUserId(),
          isActive: captureManager.isSessionActive(),
          isAutoCapturing: captureManager.isAutoCapturing(),
        };
      } catch (err) {
        console.error("[ipcHandlers] get-session-info error:", errorMessage(err));
        return { sessionId: null, userId: null, isActive: false, isAutoCapturing: false };
      }
    });

    // ── Voice transcript → treat as a question with screenshot ───────────────
    ipcMain.handle("voice-transcript", async (_, transcript: string) => {
      if (!transcript?.trim()) {
        return { success: false, error: "Empty transcript." };
      }
      try {
        const win = getWindow();
        await captureManager.captureNow(win, { userQuestion: transcript });
        return { success: true };
      } catch (err) {
        const msg = errorMessage(err);
        console.error("[ipcHandlers] voice-transcript error:", msg);
        return { success: false, error: msg };
      }
    });

    // ── Auto-capture toggle (AWAITED) ─────────────────────────────────────────
    // Unlike the fire-and-forget "toggle-auto-capture" send/on pair in main.ts,
    // this is a request/response handler. The renderer awaits this BEFORE
    // performing a manual capture, guaranteeing the previous interval (and any
    // capture it kicked off) is fully stopped first — this is what closes the
    // auto→manual race condition.
    ipcMain.handle(
      "toggle-auto-capture-sync",
      async (_, { enabled, intervalMs }: { enabled: boolean; intervalMs?: number }) => {
        try {
          const interval =
            intervalMs || parseInt(process.env.CAPTURE_INTERVAL_MS || "20000", 10);

          if (enabled) {
            captureManager.startAutoCapture(getWindow, interval);
          } else {
            captureManager.stopAutoCapture();
            // Give any in-flight captureNow a tick to observe the stopped
            // state / finish its finally{} block before we report back.
            await new Promise((resolve) => setTimeout(resolve, 50));
          }

          return {
            success: true,
            enabled: captureManager.isAutoCapturing(),
            intervalMs: interval,
          };
        } catch (err) {
          const msg = errorMessage(err);
          console.error("[ipcHandlers] toggle-auto-capture-sync error:", msg);
          return { success: false, error: msg, enabled: captureManager.isAutoCapturing() };
        }
      }
    );

    // ── Capture status (lets renderer poll/recover if events get dropped) ────
    ipcMain.handle("get-capture-status", () => {
      try {
        return {
          isCapturing: captureManager.isCapturing(),
          isAutoCapturing: captureManager.isAutoCapturing(),
          sessionActive: captureManager.isSessionActive(),
        };
      } catch (err) {
        console.error("[ipcHandlers] get-capture-status error:", errorMessage(err));
        return { isCapturing: false, isAutoCapturing: false, sessionActive: false };
      }
    });
  },
};





// // electron-app/src/main/ipcHandlers.ts
// // Extended: document upload, session stop/new, voice transcript forwarding.
// // All handlers have typed try/catch; errors are surfaced to the renderer.

// import { IpcMain, clipboard, dialog } from "electron";
// import type { BrowserWindow } from "electron";
// import * as fs from "fs";
// import * as path from "path";
// import axios, { AxiosError } from "axios";
// import { captureManager } from "./captureManager";
// import dotenv from "dotenv";

// dotenv.config();

// const BACKEND_URL =
//   process.env.BACKEND_URL ||
//   "https://sds9n3ijta.execute-api.ap-south-1.amazonaws.com/prod2";

// type WindowGetter = () => BrowserWindow | null;

// // ─── File-type helpers ────────────────────────────────────────────────────────

// function isTextFile(filePath: string): boolean {
//   const ext = path.extname(filePath).toLowerCase();
//   return [
//     ".txt", ".md", ".json", ".js", ".ts", ".tsx", ".jsx",
//     ".py", ".go", ".rs", ".java", ".cpp", ".c", ".h",
//     ".css", ".html", ".xml", ".csv", ".yaml", ".yml",
//     ".sh", ".bash", ".env", ".toml", ".ini", ".conf",
//   ].includes(ext);
// }

// function getMimeType(filePath: string): string {
//   const ext = path.extname(filePath).toLowerCase();
//   const map: Record<string, string> = {
//     ".txt":  "text/plain",
//     ".md":   "text/markdown",
//     ".json": "application/json",
//     ".js":   "text/javascript",
//     ".ts":   "application/typescript",
//     ".tsx":  "application/typescript",
//     ".jsx":  "text/javascript",
//     ".py":   "text/x-python",
//     ".html": "text/html",
//     ".css":  "text/css",
//     ".csv":  "text/csv",
//     ".xml":  "text/xml",
//     ".yaml": "text/yaml",
//     ".yml":  "text/yaml",
//     ".pdf":  "application/pdf",
//     ".png":  "image/png",
//     ".jpg":  "image/jpeg",
//     ".jpeg": "image/jpeg",
//   };
//   return map[ext] || "application/octet-stream";
// }

// // ─── Error helper ─────────────────────────────────────────────────────────────

// function errorMessage(err: unknown): string {
//   if (err instanceof AxiosError) {
//     if (!err.response) return `Cannot reach backend (${BACKEND_URL}): ${err.message}`;
//     return `Server error ${err.response.status}: ${err.message}`;
//   }
//   if (err instanceof Error) return err.message;
//   return String(err);
// }

// // ─── Handler registration ─────────────────────────────────────────────────────

// export const ipcHandlers = {
//   register(ipcMain: IpcMain, getWindow: WindowGetter) {

//     // ── Ask a question without a new screenshot ─────────────────────────────
//     ipcMain.handle("ask-question", async (_, question: string) => {
//       if (!question?.trim()) return { success: false, error: "Empty question." };
//       try {
//         const response = await axios.post(
//           `${BACKEND_URL}/api/orchestrate/question`,
//           {
//             sessionId: captureManager.getSessionId(),
//             userId: captureManager.getUserId(),
//             question,
//           },
//           { timeout: 30_000 }
//         );
//         return response.data;
//       } catch (err) {
//         const msg = errorMessage(err);
//         console.error("[ipcHandlers] ask-question error:", msg);
//         return { success: false, error: msg };
//       }
//     });

//     // ── Ask with current screenshot attached ────────────────────────────────
//     ipcMain.handle("ask-question-with-screen", async (_, question: string) => {
//       if (!question?.trim()) return { success: false, error: "Empty question." };
//       try {
//         const win = getWindow();
//         await captureManager.captureNow(win, { userQuestion: question });
//         return { success: true };
//       } catch (err) {
//         const msg = errorMessage(err);
//         console.error("[ipcHandlers] ask-question-with-screen error:", msg);
//         return { success: false, error: msg };
//       }
//     });

//     // ── Clipboard / selected text ────────────────────────────────────────────
//     ipcMain.handle("get-selected-text", () => {
//       try {
//         return clipboard.readText("selection") || clipboard.readText();
//       } catch (err) {
//         console.error("[ipcHandlers] get-selected-text error:", errorMessage(err));
//         return "";
//       }
//     });

//     // ── Manual capture now ───────────────────────────────────────────────────
//     ipcMain.handle("capture-now", async () => {
//       try {
//         await captureManager.captureNow(getWindow);
//         return { success: true };
//       } catch (err) {
//         const msg = errorMessage(err);
//         console.error("[ipcHandlers] capture-now error:", msg);
//         return { success: false, error: msg };
//       }
//     });

//     // ── Document upload via file picker ──────────────────────────────────────
//     ipcMain.handle("open-file-picker", async () => {
//       const win = getWindow();
//       if (!win) return { success: false, error: "No window available." };

//       let result;
//       try {
//         result = await dialog.showOpenDialog(win, {
//           title: "Upload document to session",
//           properties: ["openFile", "multiSelections"],
//           filters: [
//             {
//               name: "Documents & Code",
//               extensions: [
//                 "txt", "md", "json", "js", "ts", "tsx", "jsx",
//                 "py", "go", "rs", "java", "cpp", "c", "h",
//                 "css", "html", "xml", "csv", "yaml", "yml",
//                 "pdf", "png", "jpg", "jpeg",
//               ],
//             },
//             { name: "All Files", extensions: ["*"] },
//           ],
//         });
//       } catch (err) {
//         const msg = errorMessage(err);
//         console.error("[ipcHandlers] open-file-picker dialog error:", msg);
//         return { success: false, error: msg };
//       }

//       if (result.canceled || result.filePaths.length === 0) {
//         return { success: false, canceled: true };
//       }

//       const uploadResults = [];
//       for (const filePath of result.filePaths) {
//         const name = path.basename(filePath);
//         try {
//           const mimeType = getMimeType(filePath);
//           const textFile = isTextFile(filePath);
//           const fileBuffer = fs.readFileSync(filePath);
//           const content = textFile
//             ? fileBuffer.toString("utf-8")
//             : fileBuffer.toString("base64");

//           const uploadResult = await captureManager.uploadDocument(win, {
//             name,
//             type: mimeType,
//             content,
//             isText: textFile,
//           });

//           uploadResults.push({ name, ...uploadResult });
//         } catch (err) {
//           const msg = errorMessage(err);
//           console.error(`[ipcHandlers] open-file-picker upload error (${name}):`, msg);
//           uploadResults.push({ name, success: false, error: msg });
//         }
//       }

//       return { success: true, results: uploadResults };
//     });

//     // ── Document upload via drag-and-drop / renderer-provided data ───────────
//     ipcMain.handle(
//       "upload-document-data",
//       async (_, data: { name: string; type: string; content: string; isText: boolean }) => {
//         if (!data?.name || !data?.content) {
//           return { success: false, error: "Invalid document data." };
//         }
//         try {
//           const win = getWindow();
//           return await captureManager.uploadDocument(win, data);
//         } catch (err) {
//           const msg = errorMessage(err);
//           console.error("[ipcHandlers] upload-document-data error:", msg);
//           return { success: false, error: msg };
//         }
//       }
//     );

//     // ── Remove a document ────────────────────────────────────────────────────
//     ipcMain.handle("remove-document", async (_, documentId: string) => {
//       if (!documentId) return { success: false, error: "No documentId provided." };
//       try {
//         const success = await captureManager.removeDocument(documentId);
//         return { success };
//       } catch (err) {
//         const msg = errorMessage(err);
//         console.error("[ipcHandlers] remove-document error:", msg);
//         return { success: false, error: msg };
//       }
//     });

//     // ── Session: stop ────────────────────────────────────────────────────────
//     ipcMain.handle("stop-session", async () => {
//       try {
//         const win = getWindow();
//         await captureManager.stopSession(win);
//         return { success: true };
//       } catch (err) {
//         const msg = errorMessage(err);
//         console.error("[ipcHandlers] stop-session error:", msg);
//         return { success: false, error: msg };
//       }
//     });

//     // ── Session: start new ───────────────────────────────────────────────────
//     ipcMain.handle("new-session", async () => {
//       try {
//         const win = getWindow();
//         const newSessionId = await captureManager.startNewSession(win);
//         return { success: true, sessionId: newSessionId };
//       } catch (err) {
//         const msg = errorMessage(err);
//         console.error("[ipcHandlers] new-session error:", msg);
//         return { success: false, error: msg };
//       }
//     });

//     // ── Session info ─────────────────────────────────────────────────────────
//     ipcMain.handle("get-session-info", () => {
//       try {
//         return {
//           sessionId: captureManager.getSessionId(),
//           userId: captureManager.getUserId(),
//           isActive: captureManager.isSessionActive(),
//           isAutoCapturing: captureManager.isAutoCapturing(),
//         };
//       } catch (err) {
//         console.error("[ipcHandlers] get-session-info error:", errorMessage(err));
//         return { sessionId: null, userId: null, isActive: false, isAutoCapturing: false };
//       }
//     });

//     // ── Voice transcript → treat as a question with screenshot ───────────────
//     ipcMain.handle("voice-transcript", async (_, transcript: string) => {
//       if (!transcript?.trim()) {
//         return { success: false, error: "Empty transcript." };
//       }
//       try {
//         const win = getWindow();
//         await captureManager.captureNow(win, { userQuestion: transcript });
//         return { success: true };
//       } catch (err) {
//         const msg = errorMessage(err);
//         console.error("[ipcHandlers] voice-transcript error:", msg);
//         return { success: false, error: msg };
//       }
//     });
//   },
// };

