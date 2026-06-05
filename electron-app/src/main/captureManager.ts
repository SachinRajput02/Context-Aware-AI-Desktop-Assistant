// electron-app/src/main/captureManager.ts
// Updated: document upload, session stop/new, voice-ready payload structure.
// OCR still runs on backend; payload is imageBase64 only.

import { desktopCapturer, BrowserWindow } from "electron";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import type { UploadedDocument } from "../shared/types";

dotenv.config();

const BACKEND_URL =
  process.env.BACKEND_URL ||
  "https://sds9n3ijta.execute-api.ap-south-1.amazonaws.com/prod2";
console.log("BACKEND_URL =", BACKEND_URL);

// Session state — lives in the main process
let SESSION_ID = uuidv4();
let SESSION_ACTIVE = true;
const USER_ID = `user_${process.env.USERNAME || process.env.USER || "local"}`;

let autoInterval: NodeJS.Timeout | null = null;
let isCapturing = false;

type WindowGetter = () => BrowserWindow | null;

export const captureManager = {
  // ─── Screen capture ─────────────────────────────────────────────────────

  async captureScreen(): Promise<{ imageBase64: string } | null> {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 960, height: 540 },
      });
      const primary = sources[0];
      if (!primary) return null;

      const imageBuffer = primary.thumbnail.toJPEG(75);
      const imageBase64 = imageBuffer.toString("base64");
      return { imageBase64 };
    } catch (err: any) {
      console.error("[captureManager] captureScreen error:", err.message);
      return null;
    }
  },

  async captureNow(
    getWindow: WindowGetter | BrowserWindow | null,
    options: { userQuestion?: string; selectedText?: string } = {}
  ): Promise<void> {
    if (isCapturing) return;
    if (!SESSION_ACTIVE) {
      const win =
        typeof getWindow === "function" ? getWindow() : getWindow;
      win?.webContents.send("analysis-status", {
        status: "error",
        message: "Session is stopped. Start a new session.",
      });
      return;
    }

    const win =
      typeof getWindow === "function" ? getWindow() : getWindow;
    if (!win) return;

    isCapturing = true;
    try {
      win.webContents.send("analysis-status", { status: "capturing" });

      const capture = await captureManager.captureScreen();
      if (!capture) {
        win.webContents.send("analysis-status", {
          status: "error",
          message: "Screen capture failed",
        });
        return;
      }

      win.webContents.send("analysis-status", { status: "analyzing" });

      const payload = {
        imageBase64: capture.imageBase64,
        // ocrText intentionally absent — backend runs OCR
        activeApp: "desktop",
        windowTitle: "Unknown",
        timestamp: Date.now(),
        sessionId: SESSION_ID,
        userId: USER_ID,
        userQuestion: options.userQuestion,
        selectedText: options.selectedText,
      };

      const response = await axios.post(
        `${BACKEND_URL}/api/orchestrate`,
        payload,
        {
          timeout: 60000, // 60s: OCR + vision + LLM
          headers: { "Content-Type": "application/json" },
          maxContentLength: 20 * 1024 * 1024,
        }
      );

      if (response.data.success) {
        win.webContents.send("ai-response", response.data.response);
        win.webContents.send("analysis-status", { status: "done" });
        // Relay updated context (history length etc) to renderer
        win.webContents.send("context-update", response.data.updatedContext);
      } else {
        win.webContents.send("analysis-status", {
          status: "error",
          message: response.data.error,
        });
      }
    } catch (err: any) {
      console.error("[captureManager] captureNow FULL ERROR:", err);
      win?.webContents.send("analysis-status", {
        status: "error",
        message: String(err.message || err),
      });
    } finally {
      isCapturing = false;
    }
  },

  // ─── Document upload ─────────────────────────────────────────────────────

  async uploadDocument(
    win: BrowserWindow | null,
    document: Omit<UploadedDocument, "id" | "uploadedAt" | "sessionId">
  ): Promise<{ success: boolean; documentId?: string; error?: string }> {
    try {
      const response = await axios.post(
        `${BACKEND_URL}/api/orchestrate/upload-document`,
        {
          sessionId: SESSION_ID,
          userId: USER_ID,
          document,
        },
        { timeout: 60000, headers: { "Content-Type": "application/json" } }
      );

      if (response.data.success) {
        win?.webContents.send("document-uploaded", {
          documentId: response.data.documentId,
          name: document.name,
        });
        win?.webContents.send("context-update", response.data.updatedContext);
      }

      return {
        success: response.data.success,
        documentId: response.data.documentId,
        error: response.data.error,
      };
    } catch (err: any) {
      console.error("[captureManager] uploadDocument error:", err.message);
      return { success: false, error: err.message };
    }
  },

  async removeDocument(documentId: string): Promise<boolean> {
    try {
      await axios.delete(
        `${BACKEND_URL}/api/orchestrate/document/${SESSION_ID}/${documentId}`,
        { params: { userId: USER_ID }, timeout: 60000 }
      );
      return true;
    } catch {
      return false;
    }
  },

  // ─── Session control ─────────────────────────────────────────────────────

  async stopSession(win: BrowserWindow | null): Promise<void> {
    SESSION_ACTIVE = false;
    captureManager.stopAutoCapture();
    try {
      await axios.post(
        `${BACKEND_URL}/api/session/${SESSION_ID}/stop`,
        {},
        { timeout: 10000 }
      );
    } catch {
      // Non-fatal
    }
    win?.webContents.send("session-status", {
      status: "stopped",
      sessionId: SESSION_ID,
    });
  },

  async startNewSession(win: BrowserWindow | null): Promise<string> {
    const oldSessionId = SESSION_ID;
    try {
      const response = await axios.post(
        `${BACKEND_URL}/api/session/new`,
        { userId: USER_ID, currentSessionId: oldSessionId },
        { timeout: 10000 }
      );
      SESSION_ID = response.data.sessionId;
    } catch {
      // Fallback: generate locally
      SESSION_ID = uuidv4();
    }
    SESSION_ACTIVE = true;
    win?.webContents.send("session-status", {
      status: "new",
      sessionId: SESSION_ID,
    });
    return SESSION_ID;
  },

  // ─── Auto capture ────────────────────────────────────────────────────────

  startAutoCapture(getWindow: WindowGetter, intervalMs: number) {
    if (autoInterval) clearInterval(autoInterval);
    autoInterval = setInterval(
      () => captureManager.captureNow(getWindow),
      intervalMs
    );
  },

  stopAutoCapture() {
    if (autoInterval) {
      clearInterval(autoInterval);
      autoInterval = null;
    }
  },

  isAutoCapturing(): boolean {
    return autoInterval !== null;
  },

  // ─── Getters ─────────────────────────────────────────────────────────────

  getSessionId(): string {
    return SESSION_ID;
  },
  getUserId(): string {
    return USER_ID;
  },
  isSessionActive(): boolean {
    return SESSION_ACTIVE;
  },
};





// // electron-app/src/main/captureManager.ts
// // OCR SHIFTED TO BACKEND:
// //   - captureScreen() returns imageBase64 only — no ocrText
// //   - Tesseract.js fully removed from Electron
// //   - Privacy filtering moved to backend (runs after server-side OCR)
// //   - Payload sent: { imageBase64, activeApp, windowTitle, ... }

// import { desktopCapturer, BrowserWindow } from "electron";
// import axios from "axios";
// import { v4 as uuidv4 } from "uuid";
// import dotenv from "dotenv";

// dotenv.config();

// const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";

// const SESSION_ID = uuidv4();
// const USER_ID = `user_${process.env.USERNAME || process.env.USER || "local"}`;

// let autoInterval: NodeJS.Timeout | null = null;
// let isCapturing = false;

// type WindowGetter = () => BrowserWindow | null;

// export const captureManager = {
//   async captureScreen(): Promise<{ imageBase64: string } | null> {
//     try {
//       const sources = await desktopCapturer.getSources({
//         types: ["screen"],
//         thumbnailSize: { width: 1280, height: 720 },
//       });
//       const primary = sources[0];
//       if (!primary) return null;

//       const imageBuffer = primary.thumbnail.toJPEG(75);
//       const imageBase64 = imageBuffer.toString("base64");
//       return { imageBase64 };
//     } catch (err: any) {
//       console.error("[captureManager] captureScreen error:", err.message);
//       return null;
//     }
//   },

//   async captureNow(getWindow: WindowGetter | BrowserWindow | null): Promise<void> {
//     if (isCapturing) return;
//     const win = typeof getWindow === "function" ? getWindow() : getWindow;
//     if (!win) return;

//     isCapturing = true;
//     try {
//       win.webContents.send("analysis-status", { status: "capturing" });

//       const capture = await captureManager.captureScreen();
//       if (!capture) {
//         win.webContents.send("analysis-status", { status: "error", message: "Screen capture failed" });
//         return;
//       }

//       win.webContents.send("analysis-status", { status: "analyzing" });

//       const payload = {
//         imageBase64: capture.imageBase64,
//         // ocrText intentionally absent — backend runs OCR
//         activeApp: "desktop",
//         windowTitle: "Unknown",
//         timestamp: Date.now(),
//         sessionId: SESSION_ID,
//         userId: USER_ID,
//       };

//       const response = await axios.post(`${BACKEND_URL}/api/orchestrate`, payload, {
//         timeout: 45000,                       // +15s: backend now does OCR too
//         headers: { "Content-Type": "application/json" },
//         maxContentLength: 20 * 1024 * 1024,  // 20 MB: raw image is larger than OCR text
//       });

//       if (response.data.success) {
//         win.webContents.send("ai-response", response.data.response);
//         win.webContents.send("analysis-status", { status: "done" });
//       } else {
//         win.webContents.send("analysis-status", { status: "error", message: response.data.error });
//       }
//     } catch (err: any) {
//       console.error("[captureManager] captureNow FULL ERROR:", err);
//       win?.webContents.send("analysis-status", { status: "error", message: String(err) });
//     } finally {
//       isCapturing = false;
//     }
//   },

//   startAutoCapture(getWindow: WindowGetter, intervalMs: number) {
//     if (autoInterval) return;
//     autoInterval = setInterval(() => captureManager.captureNow(getWindow), intervalMs);
//   },

//   stopAutoCapture() {
//     if (autoInterval) { clearInterval(autoInterval); autoInterval = null; }
//   },

//   getSessionId(): string { return SESSION_ID; },
//   getUserId(): string    { return USER_ID; },
// };