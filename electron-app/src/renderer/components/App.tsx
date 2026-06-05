// electron-app/src/renderer/components/App.tsx
// Full redesign — Copilot-style floating assistant with:
//   • Auto/manual capture toggle
//   • Voice input
//   • Document upload
//   • Session stop / new session
//   • Full-answer display (not just intent prediction)
//   • History panel
//   • Settings panel

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import type { AIResponse } from "../../shared/types";
import { GuidancePanel } from "./GuidancePanel";
import { ChatInput } from "./ChatInput";
import { StatusIndicator } from "./StatusIndicator";
import { HistoryPanel, HistoryEntry } from "./HistoryPanel";
import { SettingsPanel } from "./SettingsPanel";
import { DocumentsPanel } from "./DocumentsPanel";
import { useAIEvents } from "../hooks/useAIEvents";
import { useVoiceInput } from "../hooks/useVoiceInput";

type Status = "idle" | "capturing" | "analyzing" | "done" | "error";
type View =
  | "collapsed"
  | "guidance"
  | "chat"
  | "history"
  | "settings"
  | "documents";

interface SessionDoc {
  id: string;
  name: string;
}

export function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [view, setView] = useState<View>("collapsed");
  const [currentResponse, setCurrentResponse] =
    useState<AIResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [autoCapture, setAutoCapture] = useState(true);
  const [captureIntervalSec, setCaptureIntervalSec] = useState(20);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [sessionDocs, setSessionDocs] = useState<SessionDoc[]>([]);
  const [sessionActive, setSessionActive] = useState(true);
  const [sessionId, setSessionId] = useState<string>("");
  const [historyCount, setHistoryCount] = useState(0);

  // Initialise session info
  useEffect(() => {
    window.electronAPI.getSessionInfo().then((info) => {
      setSessionId(info.sessionId);
      setSessionActive(info.isActive);
    });
  }, []);

  // Subscribe to events from main process
  useAIEvents({
    onResponse: (response) => {
      setCurrentResponse(response);
      setStatus("done");
      // Push to local history
      setHistory((prev) => [
        ...prev,
        {
          timestamp: Date.now(),
          screenSummary: response.summary,
          response,
        },
      ]);
      setHistoryCount((n) => n + 1);
      if (view === "collapsed") setView("guidance");
    },
    onStatus: (s) => {
      setStatus(s.status as Status);
      if (s.status === "error") setErrorMsg(s.message || "Unknown error");
    },
  });

  // Listen for document uploads and session status
  useEffect(() => {
    const unsubDoc = window.electronAPI.onDocumentUploaded((info) => {
      setSessionDocs((prev) => {
        if (prev.find((d) => d.id === info.documentId)) return prev;
        return [...prev, { id: info.documentId, name: info.name }];
      });
    });
    const unsubSession = window.electronAPI.onSessionStatus((s) => {
      setSessionActive(s.status !== "stopped");
      setSessionId(s.sessionId);
      if (s.status === "new") {
        // Clear local state for new session
        setHistory([]);
        setHistoryCount(0);
        setSessionDocs([]);
        setCurrentResponse(null);
        setStatus("idle");
        setView("collapsed");
      }
    });
    const unsubContext = window.electronAPI.onContextUpdate((ctx) => {
      if (ctx.history) setHistoryCount(ctx.history.length);
      if (ctx.uploadedDocuments) {
        setSessionDocs(
          ctx.uploadedDocuments.map((d) => ({ id: d.id, name: d.name }))
        );
      }
    });
    return () => {
      unsubDoc();
      unsubSession();
      unsubContext();
    };
  }, []);

  // Voice input hook
  const { isListening, startListening, stopListening, error: voiceError } =
    useVoiceInput({
      onTranscript: async (transcript) => {
        setStatus("analyzing");
        setView("guidance");
        await window.electronAPI.askQuestionWithScreen(transcript);
      },
    });

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleAnalyzeNow = useCallback(async () => {
    if (!sessionActive) return;
    setStatus("capturing");
    await window.electronAPI.analyzeNow();
  }, [sessionActive]);

  const handleAskQuestion = useCallback(
    async (question: string, withScreen: boolean) => {
      if (!sessionActive) return;
      setStatus("analyzing");
      setView("guidance");
      const result = withScreen
        ? await window.electronAPI.askQuestionWithScreen(question)
        : await window.electronAPI.askQuestion(question);

      if (!withScreen && result?.success) {
        setCurrentResponse(result.response);
        setStatus("done");
        setHistory((prev) => [
          ...prev,
          {
            timestamp: Date.now(),
            screenSummary: result.response.summary,
            response: result.response,
          },
        ]);
      } else if (!withScreen && !result?.success) {
        setStatus("error");
        setErrorMsg(result?.error || "Failed");
      }
      // If withScreen, events come through useAIEvents
    },
    [sessionActive]
  );

  const handleToggleAutoCapture = () => {
    const next = !autoCapture;
    setAutoCapture(next);
    window.electronAPI.toggleAutoCapture(next, captureIntervalSec * 1000);
  };

  const handleFileUpload = useCallback(async () => {
    const result = await window.electronAPI.openFilePicker();
    if (!result.success && !result.canceled) {
      console.error("File upload error:", result.error);
    }
  }, []);

  const handleRemoveDoc = useCallback(async (docId: string) => {
    await window.electronAPI.removeDocument(docId);
    setSessionDocs((prev) => prev.filter((d) => d.id !== docId));
  }, []);

  const handleStopSession = useCallback(async () => {
    await window.electronAPI.stopSession();
    setSessionActive(false);
    setView("collapsed");
    captureManager_stopUI();
  }, []);

  const handleNewSession = useCallback(async () => {
    await window.electronAPI.newSession();
    // UI reset handled in onSessionStatus listener
    window.electronAPI.toggleAutoCapture(true, captureIntervalSec * 1000);
    setAutoCapture(true);
  }, [captureIntervalSec]);

  const handleVoiceToggle = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  // ── Layout helpers ─────────────────────────────────────────────────────

  const navBtn = (
    icon: string,
    targetView: View,
    label: string,
    badge?: number
  ) => (
    <button
      style={{
        ...styles.navBtn,
        background:
          view === targetView
            ? "rgba(99,102,241,0.2)"
            : "transparent",
        color: view === targetView ? "#a5b4fc" : "#64748b",
      }}
      onClick={() =>
        setView((v) => (v === targetView ? "collapsed" : targetView))
      }
      title={label}
    >
      {icon}
      {badge != null && badge > 0 && (
        <span style={styles.badge}>{badge > 99 ? "99+" : badge}</span>
      )}
    </button>
  );

  const sessionStopped = !sessionActive;

  return (
    <div style={styles.root}>
      {/* ── Title bar / drag handle ───────────────────────────── */}
      <div style={styles.titleBar} className="drag-region">
        <div style={styles.titleLeft}>
          <div
            style={{
              ...styles.logo,
              animation: status === "analyzing" ? "pulse 1s infinite" : "none",
            }}
          >
            ◈
          </div>
          <span style={styles.titleText}>Copilot</span>
          {sessionStopped && (
            <span style={styles.stoppedBadge}>STOPPED</span>
          )}
        </div>

        <div style={styles.titleRight}>
          {/* Auto/Manual capture toggle */}
          <button
            style={{
              ...styles.captureToggleBtn,
              background: autoCapture
                ? "rgba(34,197,94,0.15)"
                : "rgba(99,102,241,0.15)",
              color: autoCapture ? "#22c55e" : "#818cf8",
              opacity: sessionStopped ? 0.4 : 1,
            }}
            onClick={handleToggleAutoCapture}
            disabled={sessionStopped}
            title={autoCapture ? "Auto-capture ON — click to switch to Manual" : "Manual mode — click to enable Auto"}
          >
            {autoCapture ? "⟳ Auto" : "◎ Manual"}
          </button>

          {/* Manual capture (visible in manual mode or as refresh) */}
          {!autoCapture && (
            <button
              style={styles.iconBtn}
              onClick={handleAnalyzeNow}
              disabled={sessionStopped || status === "capturing"}
              title="Capture & analyze now (Ctrl+Shift+A)"
            >
              📸
            </button>
          )}

          {/* Voice input */}
          <button
            style={{
              ...styles.iconBtn,
              color: isListening ? "#ef4444" : "#94a3b8",
              background: isListening ? "rgba(239,68,68,0.1)" : "transparent",
            }}
            onClick={handleVoiceToggle}
            disabled={sessionStopped}
            title={isListening ? "Stop voice input" : "Start voice input"}
          >
            {isListening ? "🔴" : "🎤"}
          </button>

          {/* Ask question */}
          <button
            style={{
              ...styles.iconBtn,
              color: view === "chat" ? "#a5b4fc" : "#94a3b8",
            }}
            onClick={() => setView((v) => (v === "chat" ? "guidance" : "chat"))}
            disabled={sessionStopped}
            title="Ask a question"
          >
            ✎
          </button>

          {/* Hide */}
          <button
            style={styles.iconBtn}
            onClick={() => window.electronAPI.hideWindow()}
            title="Hide (Ctrl+Shift+H)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* ── Status bar ───────────────────────────────────────────── */}
      <StatusIndicator status={status} errorMsg={errorMsg} />

      {/* ── Bottom nav ───────────────────────────────────────────── */}
      <div style={styles.navBar}>
        {navBtn("◈", "guidance", "Guidance")}
        {navBtn("✎", "chat", "Chat")}
        {navBtn("📁", "documents", "Documents", sessionDocs.length)}
        {navBtn("🕐", "history", "History", historyCount)}
        {navBtn("⚙", "settings", "Settings")}
      </div>

      {/* ── Content area ─────────────────────────────────────────── */}
      <div style={styles.content}>
        {sessionStopped ? (
          <SessionStoppedView onNewSession={handleNewSession} />
        ) : (
          <>
            {view === "guidance" && currentResponse && (
              <GuidancePanel response={currentResponse} />
            )}
            {view === "guidance" && !currentResponse && (
              <EmptyGuidanceView
                status={status}
                autoCapture={autoCapture}
                onAnalyze={handleAnalyzeNow}
              />
            )}
            {view === "chat" && (
              <ChatInput
                onSubmit={handleAskQuestion}
                isLoading={status === "analyzing"}
              />
            )}
            {view === "documents" && (
              <DocumentsPanel
                documents={sessionDocs}
                onUpload={handleFileUpload}
                onRemove={handleRemoveDoc}
              />
            )}
            {view === "history" && (
              <HistoryPanel
                history={history}
                onRestore={(entry) => {
                  setCurrentResponse(entry.response);
                  setView("guidance");
                }}
              />
            )}
            {view === "settings" && (
              <SettingsPanel
                captureIntervalSec={captureIntervalSec}
                onIntervalChange={(s) => {
                  setCaptureIntervalSec(s);
                  if (autoCapture) {
                    window.electronAPI.toggleAutoCapture(true, s * 1000);
                  }
                }}
                onClose={() => setView("guidance")}
                onStopSession={handleStopSession}
                onNewSession={handleNewSession}
                sessionId={sessionId}
              />
            )}
            {view === "collapsed" && (
              <EmptyGuidanceView
                status={status}
                autoCapture={autoCapture}
                onAnalyze={handleAnalyzeNow}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Small helper so stopSession handler can disable UI without calling captureManager directly
function captureManager_stopUI() {
  // This is called client-side — the IPC call already happened
}

// ─── Sub-views ────────────────────────────────────────────────────────────────

function EmptyGuidanceView({
  status,
  autoCapture,
  onAnalyze,
}: {
  status: string;
  autoCapture: boolean;
  onAnalyze: () => void;
}) {
  return (
    <div style={styles.emptyState}>
      <div style={styles.emptyIcon}>◈</div>
      <p style={styles.emptyTitle}>
        {status === "idle"
          ? autoCapture
            ? "Auto-monitoring your screen"
            : "Manual capture mode"
          : status === "capturing"
          ? "Capturing screen..."
          : status === "analyzing"
          ? "Analyzing..."
          : "Ready"}
      </p>
      <p style={styles.emptyHint}>
        {autoCapture
          ? "AI will automatically analyze your screen and guide you."
          : "Press the capture button or ask a question to get started."}
      </p>
      {!autoCapture && (
        <button style={styles.analyzeBtn} onClick={onAnalyze}>
          📸 Capture & Analyze
        </button>
      )}
    </div>
  );
}

function SessionStoppedView({ onNewSession }: { onNewSession: () => void }) {
  return (
    <div style={styles.emptyState}>
      <div style={{ ...styles.emptyIcon, color: "#ef4444" }}>⏹</div>
      <p style={styles.emptyTitle}>Session Stopped</p>
      <p style={styles.emptyHint}>
        Start a new session to continue using the assistant.
      </p>
      <button
        style={{ ...styles.analyzeBtn, background: "linear-gradient(135deg, #10b981, #059669)" }}
        onClick={onNewSession}
      >
        ▶ Start New Session
      </button>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

type ElStyle = React.CSSProperties & { WebkitAppRegion?: string };

const styles: Record<string, ElStyle> = {
  root: {
    width: "100%",
    height: "100vh",
    background: "rgba(10, 11, 18, 0.95)",
    backdropFilter: "blur(24px)",
    borderRadius: "14px",
    border: "1px solid rgba(255,255,255,0.08)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    color: "#e2e8f0",
    boxShadow: "0 32px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.1)",
    fontFamily: "'SF Pro Display', 'Segoe UI', system-ui, sans-serif",
  },
  titleBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    cursor: "grab",
    WebkitAppRegion: "drag",
    flexShrink: 0,
    background: "rgba(255,255,255,0.02)",
  },
  titleLeft: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  logo: {
    fontSize: "18px",
    color: "#6366f1",
  },
  titleText: {
    fontSize: "13px",
    fontWeight: 700,
    color: "#e2e8f0",
    letterSpacing: "0.04em",
  },
  stoppedBadge: {
    fontSize: "9px",
    fontWeight: 700,
    color: "#ef4444",
    background: "rgba(239,68,68,0.1)",
    border: "1px solid rgba(239,68,68,0.3)",
    borderRadius: "4px",
    padding: "2px 5px",
    letterSpacing: "0.05em",
  },
  titleRight: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    WebkitAppRegion: "no-drag",
  },
  captureToggleBtn: {
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "6px",
    fontSize: "11px",
    fontWeight: 600,
    cursor: "pointer",
    padding: "3px 8px",
    transition: "all 0.2s",
    lineHeight: 1.4,
  },
  iconBtn: {
    background: "transparent",
    border: "none",
    color: "#94a3b8",
    fontSize: "14px",
    cursor: "pointer",
    padding: "4px 6px",
    borderRadius: "6px",
    transition: "all 0.15s",
    lineHeight: 1,
  },
  navBar: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    padding: "6px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    flexShrink: 0,
    WebkitAppRegion: "no-drag",
  },
  navBtn: {
    position: "relative",
    background: "transparent",
    border: "none",
    fontSize: "14px",
    cursor: "pointer",
    padding: "5px 8px",
    borderRadius: "7px",
    transition: "all 0.15s",
    flex: 1,
    textAlign: "center" as const,
  },
  badge: {
    position: "absolute",
    top: "1px",
    right: "2px",
    background: "#6366f1",
    color: "#fff",
    fontSize: "8px",
    fontWeight: 700,
    borderRadius: "8px",
    padding: "1px 3px",
    lineHeight: 1.2,
  },
  content: {
    flex: 1,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  emptyState: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    padding: "32px 20px",
  },
  emptyIcon: {
    fontSize: "36px",
    color: "#334155",
  },
  emptyTitle: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#94a3b8",
    textAlign: "center",
  },
  emptyHint: {
    fontSize: "12px",
    color: "#475569",
    textAlign: "center",
    lineHeight: 1.6,
    maxWidth: "280px",
  },
  analyzeBtn: {
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    border: "none",
    borderRadius: "10px",
    color: "#fff",
    fontSize: "13px",
    fontWeight: 600,
    padding: "10px 20px",
    cursor: "pointer",
    transition: "opacity 0.15s",
    marginTop: "8px",
  },
};





// // electron-app/src/renderer/components/App.tsx
// // The main overlay UI — floating bubble + expandable panel

// import React, { useState, useEffect, useCallback } from "react";
// import type { AIResponse } from "../../shared/types";
// import { GuidancePanel } from "./GuidancePanel";
// import { ChatInput } from "./ChatInput";
// import { StatusIndicator } from "./StatusIndicator";
// import { useAIEvents } from "../hooks/useAIEvents";

// type Status = "idle" | "capturing" | "analyzing" | "done" | "error";
// type View = "collapsed" | "guidance" | "chat";

// export function App() {
//   const [status, setStatus] = useState<Status>("idle");
//   const [view, setView] = useState<View>("collapsed");
//   const [currentResponse, setCurrentResponse] = useState<AIResponse | null>(null);
//   const [errorMsg, setErrorMsg] = useState<string>("");
//   const [autoCapture, setAutoCapture] = useState(true);

//   // Subscribe to events from main process
//   useAIEvents({
//     onResponse: (response) => {
//       setCurrentResponse(response);
//       setStatus("done");
//       // Auto-expand to show guidance when new response arrives
//       if (view === "collapsed") setView("guidance");
//     },
//     onStatus: (s) => {
//       setStatus(s.status as Status);
//       if (s.status === "error") setErrorMsg(s.message || "Unknown error");
//     },
//   });

//   const handleAnalyzeNow = useCallback(async () => {
//     setStatus("capturing");
//     await window.electronAPI.analyzeNow();
//   }, []);

//   const handleAskQuestion = useCallback(async (question: string) => {
//     setStatus("analyzing");
//     const result = await window.electronAPI.askQuestion(question);
//     if (result.success) {
//       setCurrentResponse(result.response);
//       setStatus("done");
//       setView("guidance");
//     } else {
//       setStatus("error");
//       setErrorMsg(result.error);
//     }
//   }, []);

//   const toggleAutoCapture = () => {
//     const newVal = !autoCapture;
//     setAutoCapture(newVal);
//     window.electronAPI.toggleAutoCapture(newVal, 5000);
//   };

//   return (
//     <div style={styles.root}>
//       {/* ── Drag handle / title bar ─────────────────────────── */}
//       <div style={styles.titleBar} className="drag-region">
//         <div style={styles.titleLeft}>
//           <div style={styles.logo}>✦</div>
//           <span style={styles.titleText}>AI Assistant</span>
//           <div
//             style={{
//               ...styles.dot,
//               background: autoCapture ? "#22c55e" : "#6b7280",
//             }}
//             title={autoCapture ? "Auto-capture on" : "Auto-capture off"}
//           />
//         </div>
//         <div style={styles.titleRight}>
//           <button style={styles.iconBtn} onClick={toggleAutoCapture} title="Toggle auto-capture">
//             {autoCapture ? "⏸" : "▶"}
//           </button>
//           <button style={styles.iconBtn} onClick={handleAnalyzeNow} title="Analyze now (Ctrl+Shift+A)">
//             ⟳
//           </button>
//           <button
//             style={styles.iconBtn}
//             onClick={() => setView(view === "chat" ? "guidance" : "chat")}
//             title="Ask a question"
//           >
//             ✎
//           </button>
//           <button
//             style={styles.iconBtn}
//             onClick={() => window.electronAPI.hideWindow()}
//             title="Hide"
//           >
//             ✕
//           </button>
//         </div>
//       </div>

//       {/* ── Status bar ─────────────────────────────────────── */}
//       <StatusIndicator status={status} errorMsg={errorMsg} />

//       {/* ── Content area ───────────────────────────────────── */}
//       {view === "guidance" && currentResponse && (
//         <GuidancePanel response={currentResponse} />
//       )}

//       {view === "chat" && (
//         <ChatInput onSubmit={handleAskQuestion} isLoading={status === "analyzing"} />
//       )}

//       {view === "collapsed" && (
//         <div style={styles.emptyState}>
//           <p style={styles.emptyText}>
//             {status === "idle"
//               ? "Press ⟳ to analyze your screen or ask a question with ✎"
//               : "Waiting for analysis..."}
//           </p>
//           <button style={styles.analyzeBtn} onClick={handleAnalyzeNow}>
//             Analyze Screen Now
//           </button>
//         </div>
//       )}

//       {/* Toggle view between guidance ↔ collapsed */}
//       {view === "guidance" && (
//         <button style={styles.collapseBtn} onClick={() => setView("collapsed")}>
//           Collapse ▲
//         </button>
//       )}
//     </div>
//   );
// }

// // ─── Styles (inline for portability) ─────────────────────────────────────────

// type ElectronStyle = React.CSSProperties & { WebkitAppRegion?: string };

// const styles: Record<string, ElectronStyle> = {
//   root: {
//     width: "100%",
//     height: "100vh",
//     background: "rgba(15, 15, 20, 0.92)",
//     backdropFilter: "blur(20px)",
//     borderRadius: "16px",
//     border: "1px solid rgba(255,255,255,0.1)",
//     display: "flex",
//     flexDirection: "column",
//     overflow: "hidden",
//     color: "#e2e8f0",
//     boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
//   },
//   titleBar: {
//     display: "flex",
//     alignItems: "center",
//     justifyContent: "space-between",
//     padding: "12px 16px",
//     borderBottom: "1px solid rgba(255,255,255,0.07)",
//     cursor: "grab",
//     WebkitAppRegion: "drag",
//     flexShrink: 0,
//   },
//   titleLeft: {
//     display: "flex",
//     alignItems: "center",
//     gap: "8px",
//   },
//   logo: {
//     fontSize: "16px",
//     color: "#818cf8",
//   },
//   titleText: {
//     fontSize: "13px",
//     fontWeight: 600,
//     color: "#e2e8f0",
//     letterSpacing: "0.02em",
//   },
//   dot: {
//     width: "6px",
//     height: "6px",
//     borderRadius: "50%",
//     transition: "background 0.3s",
//   },
//   titleRight: {
//     display: "flex",
//     alignItems: "center",
//     gap: "4px",
//     WebkitAppRegion: "no-drag",
//   },
//   iconBtn: {
//     background: "transparent",
//     border: "none",
//     color: "#94a3b8",
//     fontSize: "14px",
//     cursor: "pointer",
//     padding: "4px 6px",
//     borderRadius: "6px",
//     transition: "all 0.15s",
//     lineHeight: 1,
//   },
//   emptyState: {
//     flex: 1,
//     display: "flex",
//     flexDirection: "column",
//     alignItems: "center",
//     justifyContent: "center",
//     gap: "16px",
//     padding: "24px",
//   },
//   emptyText: {
//     fontSize: "13px",
//     color: "#64748b",
//     textAlign: "center",
//     lineHeight: 1.5,
//   },
//   analyzeBtn: {
//     background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
//     border: "none",
//     borderRadius: "10px",
//     color: "#fff",
//     fontSize: "13px",
//     fontWeight: 600,
//     padding: "10px 20px",
//     cursor: "pointer",
//     transition: "opacity 0.15s",
//   },
//   collapseBtn: {
//     background: "transparent",
//     border: "none",
//     borderTop: "1px solid rgba(255,255,255,0.07)",
//     color: "#475569",
//     fontSize: "11px",
//     padding: "8px",
//     cursor: "pointer",
//     width: "100%",
//     flexShrink: 0,
//   },
// };