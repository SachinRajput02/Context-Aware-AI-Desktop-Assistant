// electron-app/src/main/captureManager.ts
// Updated: auto-capture is OFF by default (manual mode only).
//          Improved error handling with typed error codes and renderer notifications.
//          Added isCapturing() getter + a monotonically increasing "capture
//          generation" sent with every analysis-status/ai-response event so
//          the renderer can detect and discard stale (e.g. auto-capture)
//          responses that resolve after the user has switched to manual.

import { desktopCapturer, BrowserWindow } from "electron";
import axios, { AxiosError } from "axios";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import type { UploadedDocument } from "../shared/types";

dotenv.config();

const BACKEND_URL =
  process.env.BACKEND_URL ||
  "https://sds9n3ijta.execute-api.ap-south-1.amazonaws.com/prod2";
console.log("[captureManager] BACKEND_URL =", BACKEND_URL);

// ─── Session state — lives in the main process ────────────────────────────────
let SESSION_ID = uuidv4();
let SESSION_ACTIVE = true;
const USER_ID = `user_${process.env.USERNAME || process.env.USER || "local"}`;

// Auto-capture is intentionally NOT started on init.
// Call captureManager.startAutoCapture() explicitly to enable it.
let autoInterval: NodeJS.Timeout | null = null;
let isCapturingFlag = false;

// Monotonically increasing token — incremented every time a capture begins.
// Sent with every event so the renderer can ignore results from a capture
// that started before the user switched modes / stopped auto-capture.
let captureGeneration = 0;

type WindowGetter = () => BrowserWindow | null;

// ─── Typed error helper ───────────────────────────────────────────────────────

type CaptureErrorCode =
  | "SESSION_STOPPED"
  | "CAPTURE_FAILED"
  | "NETWORK_TIMEOUT"
  | "NETWORK_ERROR"
  | "SERVER_ERROR"
  | "UPLOAD_ERROR"
  | "ALREADY_CAPTURING"
  | "UNKNOWN";

function buildErrorPayload(code: CaptureErrorCode, message: string, generation?: number) {
  return { status: "error" as const, code, message, generation };
}

function classifyAxiosError(err: AxiosError): { code: CaptureErrorCode; message: string } {
  if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
    return { code: "NETWORK_TIMEOUT", message: "Request timed out. The backend may be under load — please try again." };
  }
  if (!err.response) {
    return { code: "NETWORK_ERROR", message: `Cannot reach backend (${BACKEND_URL}). Check your connection or BACKEND_URL.` };
  }
  const status = err.response.status;
  if (status >= 500) {
    return { code: "SERVER_ERROR", message: `Server error ${status}. Check backend logs.` };
  }
  if (status === 401 || status === 403) {
    return { code: "SERVER_ERROR", message: `Auth error ${status}. Check your API key / IAM policy.` };
  }
  return { code: "SERVER_ERROR", message: `Unexpected response ${status}: ${err.message}` };
}

// ─── captureManager ───────────────────────────────────────────────────────────

export const captureManager = {

  // ── Screen capture ─────────────────────────────────────────────────────────

  async captureScreen(): Promise<{ imageBase64: string } | null> {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 960, height: 540 },
      });
      const primary = sources[0];
      if (!primary) {
        console.error("[captureManager] No screen source found.");
        return null;
      }
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
    options: { userQuestion?: string; selectedText?: string; modelOverride?: string } = {}
  ): Promise<void> {
    const win = typeof getWindow === "function" ? getWindow() : getWindow;

    // Guard: already capturing — notify renderer instead of silently dropping,
    // so the UI doesn't get stuck thinking a click did nothing.
    if (isCapturingFlag) {
      console.warn("[captureManager] captureNow skipped — already in progress.");
      win?.webContents.send(
        "analysis-status",
        buildErrorPayload(
          "ALREADY_CAPTURING",
          "A capture is already in progress. Please wait for it to finish.",
          captureGeneration
        )
      );
      return;
    }

    // Guard: session stopped
    if (!SESSION_ACTIVE) {
      win?.webContents.send(
        "analysis-status",
        buildErrorPayload("SESSION_STOPPED", "Session is stopped. Start a new session to continue.", captureGeneration)
      );
      return;
    }

    if (!win) {
      console.warn("[captureManager] captureNow skipped — no window.");
      return;
    }

    // Start a new generation for this capture.
    const myGeneration = ++captureGeneration;
    isCapturingFlag = true;

    try {
      win.webContents.send("analysis-status", { status: "capturing", generation: myGeneration });

      const capture = await captureManager.captureScreen();
      if (!capture) {
        win.webContents.send(
          "analysis-status",
          buildErrorPayload("CAPTURE_FAILED", "Screen capture failed. Grant screen recording permission and retry.", myGeneration)
        );
        return;
      }

      win.webContents.send("analysis-status", { status: "analyzing", generation: myGeneration });

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
        modelOverride: options.modelOverride,
      };

      let response;
      try {
        response = await axios.post(
          `${BACKEND_URL}/api/orchestrate`,
          payload,
          {
            timeout: 60_000,
            headers: { "Content-Type": "application/json" },
            maxContentLength: 20 * 1024 * 1024,
          }
        );
      } catch (err: any) {
        const { code, message } = err.isAxiosError
          ? classifyAxiosError(err as AxiosError)
          : { code: "UNKNOWN" as CaptureErrorCode, message: String(err.message || err) };
        console.error(`[captureManager] captureNow ${code}:`, message);
        win.webContents.send("analysis-status", buildErrorPayload(code, message, myGeneration));
        return;
      }

      if (response.data.success) {
        win.webContents.send("ai-response", { ...response.data.response, generation: myGeneration });
        win.webContents.send("analysis-status", { status: "done", generation: myGeneration });
        win.webContents.send("context-update", response.data.updatedContext);
      } else {
        win.webContents.send(
          "analysis-status",
          buildErrorPayload("SERVER_ERROR", response.data.error || "Backend returned an unknown error.", myGeneration)
        );
      }
    } catch (err: any) {
      // Catch-all — should rarely reach here given the inner try/catch above
      console.error("[captureManager] captureNow unexpected error:", err);
      win?.webContents.send(
        "analysis-status",
        buildErrorPayload("UNKNOWN", String(err.message || err), myGeneration)
      );
    } finally {
      isCapturingFlag = false;
    }
  },

  // ── Document upload ────────────────────────────────────────────────────────

  async uploadDocument(
    win: BrowserWindow | null,
    document: Omit<UploadedDocument, "id" | "uploadedAt" | "sessionId">
  ): Promise<{ success: boolean; documentId?: string; error?: string }> {
    try {
      const response = await axios.post(
        `${BACKEND_URL}/api/orchestrate/upload-document`,
        { sessionId: SESSION_ID, userId: USER_ID, document },
        { timeout: 60_000, headers: { "Content-Type": "application/json" } }
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
      const msg = err.isAxiosError
        ? classifyAxiosError(err as AxiosError).message
        : String(err.message || err);
      console.error("[captureManager] uploadDocument error:", msg);
      win?.webContents.send(
        "analysis-status",
        buildErrorPayload("UPLOAD_ERROR", `Document upload failed: ${msg}`)
      );
      return { success: false, error: msg };
    }
  },

  async removeDocument(documentId: string): Promise<boolean> {
    try {
      await axios.delete(
        `${BACKEND_URL}/api/orchestrate/document/${SESSION_ID}/${documentId}`,
        { params: { userId: USER_ID }, timeout: 10_000 }
      );
      return true;
    } catch (err: any) {
      console.error("[captureManager] removeDocument error:", err.message);
      return false;
    }
  },

  // ── Session control ────────────────────────────────────────────────────────

  async stopSession(win: BrowserWindow | null): Promise<void> {
    SESSION_ACTIVE = false;
    captureManager.stopAutoCapture();
    try {
      await axios.post(
        `${BACKEND_URL}/api/session/${SESSION_ID}/stop`,
        {},
        { timeout: 10_000 }
      );
    } catch (err: any) {
      // Non-fatal; log and continue
      console.warn("[captureManager] stopSession backend call failed:", err.message);
    }
    win?.webContents.send("session-status", { status: "stopped", sessionId: SESSION_ID });
  },

  async startNewSession(win: BrowserWindow | null): Promise<string> {
    const oldSessionId = SESSION_ID;
    try {
      const response = await axios.post(
        `${BACKEND_URL}/api/session/new`,
        { userId: USER_ID, currentSessionId: oldSessionId },
        { timeout: 10_000 }
      );
      SESSION_ID = response.data.sessionId;
    } catch (err: any) {
      // Fallback: generate a session ID locally
      console.warn("[captureManager] startNewSession backend call failed, using local ID:", err.message);
      SESSION_ID = uuidv4();
    }
    SESSION_ACTIVE = true;
    // Bump generation so any late-arriving response from the old session
    // (e.g. an in-flight auto-capture from before "new session" was clicked)
    // is recognised as stale by the renderer.
    captureGeneration += 1;
    win?.webContents.send("session-status", { status: "new", sessionId: SESSION_ID });
    return SESSION_ID;
  },

  // ── Auto capture — OFF by default ─────────────────────────────────────────
  // Call startAutoCapture() explicitly from main.ts only when the user enables it.

  startAutoCapture(getWindow: WindowGetter, intervalMs: number) {
    if (autoInterval) {
      clearInterval(autoInterval);
    }
    autoInterval = setInterval(
      () => captureManager.captureNow(getWindow),
      Math.max(intervalMs, 10_000) // enforce 10s floor to avoid accidental hammering
    );
    console.log(`[captureManager] Auto-capture started — interval ${intervalMs}ms`);
  },

  stopAutoCapture() {
    if (autoInterval) {
      clearInterval(autoInterval);
      autoInterval = null;
      console.log("[captureManager] Auto-capture stopped.");
    }
    // Bump generation so an in-flight captureNow that started under auto-mode
    // is recognised as stale once it resolves, even though isCapturingFlag
    // is still true at this exact moment.
    captureGeneration += 1;
  },

  isAutoCapturing(): boolean {
    return autoInterval !== null;
  },

  isCapturing(): boolean {
    return isCapturingFlag;
  },

  getCurrentGeneration(): number {
    return captureGeneration;
  },

  // ── Getters ────────────────────────────────────────────────────────────────

  getSessionId(): string  { return SESSION_ID; },
  getUserId(): string     { return USER_ID; },
  isSessionActive(): boolean { return SESSION_ACTIVE; },
};




// // electron-app/src/main/captureManager.ts
// // Updated: auto-capture is OFF by default (manual mode only).
// //          Improved error handling with typed error codes and renderer notifications.

// import { desktopCapturer, BrowserWindow } from "electron";
// import axios, { AxiosError } from "axios";
// import { v4 as uuidv4 } from "uuid";
// import dotenv from "dotenv";
// import type { UploadedDocument } from "../shared/types";

// dotenv.config();

// const BACKEND_URL =
//   process.env.BACKEND_URL ||
//   "https://sds9n3ijta.execute-api.ap-south-1.amazonaws.com/prod2";
// console.log("[captureManager] BACKEND_URL =", BACKEND_URL);

// // ─── Session state — lives in the main process ────────────────────────────────
// let SESSION_ID = uuidv4();
// let SESSION_ACTIVE = true;
// const USER_ID = `user_${process.env.USERNAME || process.env.USER || "local"}`;

// // Auto-capture is intentionally NOT started on init.
// // Call captureManager.startAutoCapture() explicitly to enable it.
// let autoInterval: NodeJS.Timeout | null = null;
// let isCapturing = false;

// type WindowGetter = () => BrowserWindow | null;

// // ─── Typed error helper ───────────────────────────────────────────────────────

// type CaptureErrorCode =
//   | "SESSION_STOPPED"
//   | "CAPTURE_FAILED"
//   | "NETWORK_TIMEOUT"
//   | "NETWORK_ERROR"
//   | "SERVER_ERROR"
//   | "UPLOAD_ERROR"
//   | "UNKNOWN";

// function buildErrorPayload(code: CaptureErrorCode, message: string) {
//   return { status: "error" as const, code, message };
// }

// function classifyAxiosError(err: AxiosError): { code: CaptureErrorCode; message: string } {
//   if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
//     return { code: "NETWORK_TIMEOUT", message: "Request timed out. The backend may be under load — please try again." };
//   }
//   if (!err.response) {
//     return { code: "NETWORK_ERROR", message: `Cannot reach backend (${BACKEND_URL}). Check your connection or BACKEND_URL.` };
//   }
//   const status = err.response.status;
//   if (status >= 500) {
//     return { code: "SERVER_ERROR", message: `Server error ${status}. Check backend logs.` };
//   }
//   if (status === 401 || status === 403) {
//     return { code: "SERVER_ERROR", message: `Auth error ${status}. Check your API key / IAM policy.` };
//   }
//   return { code: "SERVER_ERROR", message: `Unexpected response ${status}: ${err.message}` };
// }

// // ─── captureManager ───────────────────────────────────────────────────────────

// export const captureManager = {

//   // ── Screen capture ─────────────────────────────────────────────────────────

//   async captureScreen(): Promise<{ imageBase64: string } | null> {
//     try {
//       const sources = await desktopCapturer.getSources({
//         types: ["screen"],
//         thumbnailSize: { width: 960, height: 540 },
//       });
//       const primary = sources[0];
//       if (!primary) {
//         console.error("[captureManager] No screen source found.");
//         return null;
//       }
//       const imageBuffer = primary.thumbnail.toJPEG(75);
//       const imageBase64 = imageBuffer.toString("base64");
//       return { imageBase64 };
//     } catch (err: any) {
//       console.error("[captureManager] captureScreen error:", err.message);
//       return null;
//     }
//   },

//   async captureNow(
//     getWindow: WindowGetter | BrowserWindow | null,
//     options: { userQuestion?: string; selectedText?: string } = {}
//   ): Promise<void> {
//     // Guard: already capturing
//     if (isCapturing) {
//       console.warn("[captureManager] captureNow skipped — already in progress.");
//       return;
//     }

//     const win = typeof getWindow === "function" ? getWindow() : getWindow;

//     // Guard: session stopped
//     if (!SESSION_ACTIVE) {
//       win?.webContents.send(
//         "analysis-status",
//         buildErrorPayload("SESSION_STOPPED", "Session is stopped. Start a new session to continue.")
//       );
//       return;
//     }

//     if (!win) {
//       console.warn("[captureManager] captureNow skipped — no window.");
//       return;
//     }

//     isCapturing = true;
//     try {
//       win.webContents.send("analysis-status", { status: "capturing" });

//       const capture = await captureManager.captureScreen();
//       if (!capture) {
//         win.webContents.send(
//           "analysis-status",
//           buildErrorPayload("CAPTURE_FAILED", "Screen capture failed. Grant screen recording permission and retry.")
//         );
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
//         userQuestion: options.userQuestion,
//         selectedText: options.selectedText,
//       };

//       let response;
//       try {
//         response = await axios.post(
//           `${BACKEND_URL}/api/orchestrate`,
//           payload,
//           {
//             timeout: 60_000,
//             headers: { "Content-Type": "application/json" },
//             maxContentLength: 20 * 1024 * 1024,
//           }
//         );
//       } catch (err: any) {
//         const { code, message } = err.isAxiosError
//           ? classifyAxiosError(err as AxiosError)
//           : { code: "UNKNOWN" as CaptureErrorCode, message: String(err.message || err) };
//         console.error(`[captureManager] captureNow ${code}:`, message);
//         win.webContents.send("analysis-status", buildErrorPayload(code, message));
//         return;
//       }

//       if (response.data.success) {
//         win.webContents.send("ai-response", response.data.response);
//         win.webContents.send("analysis-status", { status: "done" });
//         win.webContents.send("context-update", response.data.updatedContext);
//       } else {
//         win.webContents.send(
//           "analysis-status",
//           buildErrorPayload("SERVER_ERROR", response.data.error || "Backend returned an unknown error.")
//         );
//       }
//     } catch (err: any) {
//       // Catch-all — should rarely reach here given the inner try/catch above
//       console.error("[captureManager] captureNow unexpected error:", err);
//       win?.webContents.send(
//         "analysis-status",
//         buildErrorPayload("UNKNOWN", String(err.message || err))
//       );
//     } finally {
//       isCapturing = false;
//     }
//   },

//   // ── Document upload ────────────────────────────────────────────────────────

//   async uploadDocument(
//     win: BrowserWindow | null,
//     document: Omit<UploadedDocument, "id" | "uploadedAt" | "sessionId">
//   ): Promise<{ success: boolean; documentId?: string; error?: string }> {
//     try {
//       const response = await axios.post(
//         `${BACKEND_URL}/api/orchestrate/upload-document`,
//         { sessionId: SESSION_ID, userId: USER_ID, document },
//         { timeout: 60_000, headers: { "Content-Type": "application/json" } }
//       );

//       if (response.data.success) {
//         win?.webContents.send("document-uploaded", {
//           documentId: response.data.documentId,
//           name: document.name,
//         });
//         win?.webContents.send("context-update", response.data.updatedContext);
//       }

//       return {
//         success: response.data.success,
//         documentId: response.data.documentId,
//         error: response.data.error,
//       };
//     } catch (err: any) {
//       const msg = err.isAxiosError
//         ? classifyAxiosError(err as AxiosError).message
//         : String(err.message || err);
//       console.error("[captureManager] uploadDocument error:", msg);
//       win?.webContents.send(
//         "analysis-status",
//         buildErrorPayload("UPLOAD_ERROR", `Document upload failed: ${msg}`)
//       );
//       return { success: false, error: msg };
//     }
//   },

//   async removeDocument(documentId: string): Promise<boolean> {
//     try {
//       await axios.delete(
//         `${BACKEND_URL}/api/orchestrate/document/${SESSION_ID}/${documentId}`,
//         { params: { userId: USER_ID }, timeout: 10_000 }
//       );
//       return true;
//     } catch (err: any) {
//       console.error("[captureManager] removeDocument error:", err.message);
//       return false;
//     }
//   },

//   // ── Session control ────────────────────────────────────────────────────────

//   async stopSession(win: BrowserWindow | null): Promise<void> {
//     SESSION_ACTIVE = false;
//     captureManager.stopAutoCapture();
//     try {
//       await axios.post(
//         `${BACKEND_URL}/api/session/${SESSION_ID}/stop`,
//         {},
//         { timeout: 10_000 }
//       );
//     } catch (err: any) {
//       // Non-fatal; log and continue
//       console.warn("[captureManager] stopSession backend call failed:", err.message);
//     }
//     win?.webContents.send("session-status", { status: "stopped", sessionId: SESSION_ID });
//   },

//   async startNewSession(win: BrowserWindow | null): Promise<string> {
//     const oldSessionId = SESSION_ID;
//     try {
//       const response = await axios.post(
//         `${BACKEND_URL}/api/session/new`,
//         { userId: USER_ID, currentSessionId: oldSessionId },
//         { timeout: 10_000 }
//       );
//       SESSION_ID = response.data.sessionId;
//     } catch (err: any) {
//       // Fallback: generate a session ID locally
//       console.warn("[captureManager] startNewSession backend call failed, using local ID:", err.message);
//       SESSION_ID = uuidv4();
//     }
//     SESSION_ACTIVE = true;
//     win?.webContents.send("session-status", { status: "new", sessionId: SESSION_ID });
//     return SESSION_ID;
//   },

//   // ── Auto capture — OFF by default ─────────────────────────────────────────
//   // Call startAutoCapture() explicitly from main.ts only when the user enables it.

//   startAutoCapture(getWindow: WindowGetter, intervalMs: number) {
//     if (autoInterval) {
//       clearInterval(autoInterval);
//     }
//     autoInterval = setInterval(
//       () => captureManager.captureNow(getWindow),
//       Math.max(intervalMs, 10_000) // enforce 10s floor to avoid accidental hammering
//     );
//     console.log(`[captureManager] Auto-capture started — interval ${intervalMs}ms`);
//   },

//   stopAutoCapture() {
//     if (autoInterval) {
//       clearInterval(autoInterval);
//       autoInterval = null;
//       console.log("[captureManager] Auto-capture stopped.");
//     }
//   },

//   isAutoCapturing(): boolean {
//     return autoInterval !== null;
//   },

//   // ── Getters ────────────────────────────────────────────────────────────────

//   getSessionId(): string  { return SESSION_ID; },
//   getUserId(): string     { return USER_ID; },
//   isSessionActive(): boolean { return SESSION_ACTIVE; },
// };


