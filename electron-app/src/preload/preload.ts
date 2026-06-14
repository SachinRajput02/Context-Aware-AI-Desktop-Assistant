// electron-app/src/preload/preload.ts
// Secure contextBridge — exposes ONLY the listed methods to the React renderer.
//
// Added:
//  - toggleAutoCaptureSync: AWAITED replacement for the old fire-and-forget
//    toggleAutoCapture send(). Resolves only once main has actually started
//    or stopped the interval.
//  - getCaptureStatus: lets the renderer recover/poll if it ever suspects
//    its local state has drifted from main's (e.g. after a missed event).
//  - generation field on AIResponse / analysis-status payloads so the
//    renderer can discard stale results from a capture that started before
//    a mode switch.

import { contextBridge, ipcRenderer } from "electron";
import type { AIResponse, SessionContext } from "../shared/types";

contextBridge.exposeInMainWorld("electronAPI", {
  // ── Screen analysis ────────────────────────────────────────────────────
  analyzeNow: () => ipcRenderer.invoke("analyze-now"),
  askQuestion: (q: string) => ipcRenderer.invoke("ask-question", q),
  askQuestionWithScreen: (q: string) =>
    ipcRenderer.invoke("ask-question-with-screen", q),
  getSelectedText: () => ipcRenderer.invoke("get-selected-text"),

  // ── Document management ────────────────────────────────────────────────
  openFilePicker: () => ipcRenderer.invoke("open-file-picker"),
  uploadDocumentData: (data: {
    name: string;
    type: string;
    content: string;
    isText: boolean;
  }) => ipcRenderer.invoke("upload-document-data", data),
  removeDocument: (documentId: string) =>
    ipcRenderer.invoke("remove-document", documentId),

  // ── Session control ────────────────────────────────────────────────────
  stopSession: () => ipcRenderer.invoke("stop-session"),
  newSession: () => ipcRenderer.invoke("new-session"),
  getSessionInfo: () => ipcRenderer.invoke("get-session-info"),

  // ── Voice input ────────────────────────────────────────────────────────
  sendVoiceTranscript: (transcript: string) =>
    ipcRenderer.invoke("voice-transcript", transcript),

  // ── Window controls ────────────────────────────────────────────────────
  hideWindow: () => ipcRenderer.send("hide-window"),
  showWindow: () => ipcRenderer.send("show-window"),
  resizeWindow: (w: number, h: number) =>
    ipcRenderer.send("resize-window", { width: w, height: h }),

  // ── Auto-capture (AWAITED — replaces old fire-and-forget toggle) ────────
  toggleAutoCaptureSync: (enabled: boolean, intervalMs?: number) =>
    ipcRenderer.invoke("toggle-auto-capture-sync", { enabled, intervalMs }),

  // ── Capture status recovery ─────────────────────────────────────────────
  getCaptureStatus: () => ipcRenderer.invoke("get-capture-status"),

  // ── Activity reporting (feeds smartTrigger) ────────────────────────────
  reportClick: (x: number, y: number) =>
    ipcRenderer.send("mouse-click", { x, y }),
  reportActivity: () => ipcRenderer.send("user-activity"),

  // ── Events pushed from main → renderer ────────────────────────────────
  onAIResponse: (callback: (r: AIResponse & { generation?: number }) => void) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      response: AIResponse & { generation?: number }
    ) => callback(response);
    ipcRenderer.on("ai-response", listener);
    return () => ipcRenderer.removeListener("ai-response", listener);
  },

  onAnalysisStatus: (
    callback: (s: {
      status: string;
      message?: string;
      code?: string;
      generation?: number;
    }) => void
  ) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      s: { status: string; message?: string; code?: string; generation?: number }
    ) => callback(s);
    ipcRenderer.on("analysis-status", listener);
    return () => ipcRenderer.removeListener("analysis-status", listener);
  },

  onSmartTrigger: (
    callback: (e: { type: string; details: string }) => void
  ) => {
    const listener = (_: Electron.IpcRendererEvent, e: any) => callback(e);
    ipcRenderer.on("smart-trigger", listener);
    return () => ipcRenderer.removeListener("smart-trigger", listener);
  },

  onContextUpdate: (callback: (ctx: Partial<SessionContext>) => void) => {
    const listener = (_: Electron.IpcRendererEvent, ctx: Partial<SessionContext>) =>
      callback(ctx);
    ipcRenderer.on("context-update", listener);
    return () => ipcRenderer.removeListener("context-update", listener);
  },

  onDocumentUploaded: (
    callback: (info: { documentId: string; name: string }) => void
  ) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      info: { documentId: string; name: string }
    ) => callback(info);
    ipcRenderer.on("document-uploaded", listener);
    return () => ipcRenderer.removeListener("document-uploaded", listener);
  },

  onSessionStatus: (
    callback: (s: { status: string; sessionId: string }) => void
  ) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      s: { status: string; sessionId: string }
    ) => callback(s);
    ipcRenderer.on("session-status", listener);
    return () => ipcRenderer.removeListener("session-status", listener);
  },
});

// ─── TypeScript global declaration (used by renderer components) ─────────────

declare global {
  interface Window {
    electronAPI: {
      analyzeNow: () => Promise<void>;
      askQuestion: (q: string) => Promise<any>;
      askQuestionWithScreen: (q: string) => Promise<any>;
      getSelectedText: () => Promise<string>;

      openFilePicker: () => Promise<any>;
      uploadDocumentData: (data: {
        name: string;
        type: string;
        content: string;
        isText: boolean;
      }) => Promise<any>;
      removeDocument: (documentId: string) => Promise<any>;

      stopSession: () => Promise<any>;
      newSession: () => Promise<any>;
      getSessionInfo: () => Promise<{
        sessionId: string;
        userId: string;
        isActive: boolean;
        isAutoCapturing: boolean;
      }>;

      sendVoiceTranscript: (transcript: string) => Promise<any>;

      hideWindow: () => void;
      showWindow: () => void;
      resizeWindow: (w: number, h: number) => void;

      toggleAutoCaptureSync: (
        enabled: boolean,
        intervalMs?: number
      ) => Promise<{ success: boolean; enabled: boolean; intervalMs: number; error?: string }>;
      getCaptureStatus: () => Promise<{
        isCapturing: boolean;
        isAutoCapturing: boolean;
        sessionActive: boolean;
      }>;

      reportClick: (x: number, y: number) => void;
      reportActivity: () => void;

      onAIResponse: (
        cb: (r: AIResponse & { generation?: number }) => void
      ) => () => void;
      onAnalysisStatus: (
        cb: (s: {
          status: string;
          message?: string;
          code?: string;
          generation?: number;
        }) => void
      ) => () => void;
      onSmartTrigger: (
        cb: (e: { type: string; details: string }) => void
      ) => () => void;
      onContextUpdate: (
        cb: (ctx: Partial<import("../shared/types").SessionContext>) => void
      ) => () => void;
      onDocumentUploaded: (
        cb: (info: { documentId: string; name: string }) => void
      ) => () => void;
      onSessionStatus: (
        cb: (s: { status: string; sessionId: string }) => void
      ) => () => void;
    };
  }
}




// // electron-app/src/preload/preload.ts
// // Secure contextBridge — exposes ONLY the listed methods to the React renderer.

// import { contextBridge, ipcRenderer } from "electron";
// import type { AIResponse, SessionContext } from "../shared/types";

// contextBridge.exposeInMainWorld("electronAPI", {
//   // ── Screen analysis ────────────────────────────────────────────────────
//   analyzeNow: () => ipcRenderer.invoke("analyze-now"),
//   askQuestion: (q: string) => ipcRenderer.invoke("ask-question", q),
//   askQuestionWithScreen: (q: string) =>
//     ipcRenderer.invoke("ask-question-with-screen", q),
//   getSelectedText: () => ipcRenderer.invoke("get-selected-text"),

//   // ── Document management ────────────────────────────────────────────────
//   openFilePicker: () => ipcRenderer.invoke("open-file-picker"),
//   uploadDocumentData: (data: {
//     name: string;
//     type: string;
//     content: string;
//     isText: boolean;
//   }) => ipcRenderer.invoke("upload-document-data", data),
//   removeDocument: (documentId: string) =>
//     ipcRenderer.invoke("remove-document", documentId),

//   // ── Session control ────────────────────────────────────────────────────
//   stopSession: () => ipcRenderer.invoke("stop-session"),
//   newSession: () => ipcRenderer.invoke("new-session"),
//   getSessionInfo: () => ipcRenderer.invoke("get-session-info"),

//   // ── Voice input ────────────────────────────────────────────────────────
//   sendVoiceTranscript: (transcript: string) =>
//     ipcRenderer.invoke("voice-transcript", transcript),

//   // ── Window controls ────────────────────────────────────────────────────
//   hideWindow: () => ipcRenderer.send("hide-window"),
//   showWindow: () => ipcRenderer.send("show-window"),
//   resizeWindow: (w: number, h: number) =>
//     ipcRenderer.send("resize-window", { width: w, height: h }),

//   // ── Auto-capture ───────────────────────────────────────────────────────
//   toggleAutoCapture: (enabled: boolean, intervalMs?: number) =>
//     ipcRenderer.send("toggle-auto-capture", { enabled, intervalMs }),

//   // ── Activity reporting (feeds smartTrigger) ────────────────────────────
//   reportClick: (x: number, y: number) =>
//     ipcRenderer.send("mouse-click", { x, y }),
//   reportActivity: () => ipcRenderer.send("user-activity"),

//   // ── Events pushed from main → renderer ────────────────────────────────
//   onAIResponse: (callback: (r: AIResponse) => void) => {
//     const listener = (_: Electron.IpcRendererEvent, response: AIResponse) =>
//       callback(response);
//     ipcRenderer.on("ai-response", listener);
//     return () => ipcRenderer.removeListener("ai-response", listener);
//   },

//   onAnalysisStatus: (
//     callback: (s: { status: string; message?: string }) => void
//   ) => {
//     const listener = (
//       _: Electron.IpcRendererEvent,
//       s: { status: string; message?: string }
//     ) => callback(s);
//     ipcRenderer.on("analysis-status", listener);
//     return () => ipcRenderer.removeListener("analysis-status", listener);
//   },

//   onSmartTrigger: (
//     callback: (e: { type: string; details: string }) => void
//   ) => {
//     const listener = (_: Electron.IpcRendererEvent, e: any) => callback(e);
//     ipcRenderer.on("smart-trigger", listener);
//     return () => ipcRenderer.removeListener("smart-trigger", listener);
//   },

//   onContextUpdate: (callback: (ctx: Partial<SessionContext>) => void) => {
//     const listener = (_: Electron.IpcRendererEvent, ctx: Partial<SessionContext>) =>
//       callback(ctx);
//     ipcRenderer.on("context-update", listener);
//     return () => ipcRenderer.removeListener("context-update", listener);
//   },

//   onDocumentUploaded: (
//     callback: (info: { documentId: string; name: string }) => void
//   ) => {
//     const listener = (
//       _: Electron.IpcRendererEvent,
//       info: { documentId: string; name: string }
//     ) => callback(info);
//     ipcRenderer.on("document-uploaded", listener);
//     return () => ipcRenderer.removeListener("document-uploaded", listener);
//   },

//   onSessionStatus: (
//     callback: (s: { status: string; sessionId: string }) => void
//   ) => {
//     const listener = (
//       _: Electron.IpcRendererEvent,
//       s: { status: string; sessionId: string }
//     ) => callback(s);
//     ipcRenderer.on("session-status", listener);
//     return () => ipcRenderer.removeListener("session-status", listener);
//   },
// });

// // ─── TypeScript global declaration (used by renderer components) ─────────────

// declare global {
//   interface Window {
//     electronAPI: {
//       analyzeNow: () => Promise<void>;
//       askQuestion: (q: string) => Promise<any>;
//       askQuestionWithScreen: (q: string) => Promise<any>;
//       getSelectedText: () => Promise<string>;

//       openFilePicker: () => Promise<any>;
//       uploadDocumentData: (data: {
//         name: string;
//         type: string;
//         content: string;
//         isText: boolean;
//       }) => Promise<any>;
//       removeDocument: (documentId: string) => Promise<any>;

//       stopSession: () => Promise<any>;
//       newSession: () => Promise<any>;
//       getSessionInfo: () => Promise<{
//         sessionId: string;
//         userId: string;
//         isActive: boolean;
//       }>;

//       sendVoiceTranscript: (transcript: string) => Promise<any>;

//       hideWindow: () => void;
//       showWindow: () => void;
//       resizeWindow: (w: number, h: number) => void;

//       toggleAutoCapture: (enabled: boolean, intervalMs?: number) => void;
//       reportClick: (x: number, y: number) => void;
//       reportActivity: () => void;

//       onAIResponse: (cb: (r: AIResponse) => void) => () => void;
//       onAnalysisStatus: (
//         cb: (s: { status: string; message?: string }) => void
//       ) => () => void;
//       onSmartTrigger: (
//         cb: (e: { type: string; details: string }) => void
//       ) => () => void;
//       onContextUpdate: (
//         cb: (ctx: Partial<import("../shared/types").SessionContext>) => void
//       ) => () => void;
//       onDocumentUploaded: (
//         cb: (info: { documentId: string; name: string }) => void
//       ) => () => void;
//       onSessionStatus: (
//         cb: (s: { status: string; sessionId: string }) => void
//       ) => () => void;
//     };
//   }
// }


