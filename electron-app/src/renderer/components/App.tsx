// electron-app/src/renderer/components/App.tsx
// Copilot-style floating assistant.
//
// Concurrency / error-handling rewrite:
//  • Every capture (auto OR manual) now carries a "generation" number from
//    main. The renderer only accepts ai-response / analysis-status events
//    whose generation === the latest generation it has seen — this is what
//    stops a late-arriving auto-capture response from overwriting state
//    after the user has switched to manual.
//  • handleToggleAutoCapture is now async and AWAITS
//    toggleAutoCaptureSync(...) before doing anything else. While that
//    await is pending the toggle button is disabled, so you cannot fire a
//    manual capture into an interval that main hasn't finished stopping yet.
//  • A watchdog timer clears a stuck "capturing"/"analyzing" status if no
//    event arrives within 75s, surfacing a retryable error instead of an
//    infinite spinner.
//  • StatusIndicator now renders an error banner with Retry / Dismiss.
//  • Added a top-bar model selector (cosmetic — value is sent to main as
//    `modelOverride` on every request).

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
import { ModelSelector } from "./ModelSelector";
import { useAIEvents } from "../hooks/useAIEvents";
import { useVoiceInput } from "../hooks/useVoiceInput";
import { DEFAULT_MODEL_ID } from "../config/models";

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

// How long we wait for an analysis-status / ai-response event before
// declaring the in-flight request stuck and surfacing a retryable error.
const WATCHDOG_TIMEOUT_MS = 75_000;

// Type of the last action, so the "Retry" button on an error banner
// knows what to re-run.
type LastAction =
  | { kind: "none" }
  | { kind: "analyze" }
  | { kind: "askWithScreen"; question: string }
  | { kind: "askFromHistory"; question: string }
  | { kind: "voice"; transcript: string };

export function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [view, setView] = useState<View>("collapsed");
  const [currentResponse, setCurrentResponse] =
    useState<AIResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);

  const [autoCapture, setAutoCapture] = useState(false);
  const [captureIntervalSec, setCaptureIntervalSec] = useState(20);
  const [toggleBusy, setToggleBusy] = useState(false);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [sessionDocs, setSessionDocs] = useState<SessionDoc[]>([]);
  const [sessionActive, setSessionActive] = useState(true);
  const [sessionId, setSessionId] = useState<string>("");
  const [historyCount, setHistoryCount] = useState(0);

  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL_ID);

  // ── Concurrency tracking ────────────────────────────────────────────────
  // The generation of the request we're currently "caring about". Any
  // ai-response / analysis-status event whose generation is OLDER than this
  // is from a stale (pre-mode-switch) capture and gets dropped.
  const currentGenerationRef = useRef<number>(0);
  // Watchdog: if no event arrives within WATCHDOG_TIMEOUT_MS of starting a
  // request, we clear the spinner and show a retryable error.
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What to re-run if the user hits "Retry" on the error banner.
  const lastActionRef = useRef<LastAction>({ kind: "none" });
  // Ref mirror of `!sessionActive`, kept in sync via the effect below, so
  // handleToggleAutoCapture can read the latest value without needing
  // `sessionActive` in its dependency array (avoids recreating the callback
  // — and re-triggering its disabled/title bindings — on every session
  // status change while still always checking the current value).
  const sessionStoppedRef = useRef(false);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const armWatchdog = useCallback((generation: number) => {
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      // Only fire if we're still on the same generation (i.e. nothing
      // resolved/superseded this request in the meantime).
      if (currentGenerationRef.current === generation) {
        setStatus("error");
        setErrorCode("TIMEOUT");
        setErrorMsg(
          "No response after 75s — the request may have stalled. You can retry or switch modes."
        );
      }
    }, WATCHDOG_TIMEOUT_MS);
  }, [clearWatchdog]);

  // Bump the generation we're tracking and arm the watchdog. Call this
  // whenever we KICK OFF a request whose response should be tracked.
  const beginTrackedRequest = useCallback(() => {
    const next = currentGenerationRef.current + 1;
    currentGenerationRef.current = next;
    armWatchdog(next);
    return next;
  }, [armWatchdog]);

  // Initialise session + capture info
  useEffect(() => {
    window.electronAPI.getSessionInfo().then((info) => {
      setSessionId(info.sessionId);
      setSessionActive(info.isActive);
      setAutoCapture(!!info.isAutoCapturing);
    });
  }, []);

  // Cleanup watchdog on unmount
  useEffect(() => () => clearWatchdog(), [clearWatchdog]);

  // ── Subscribe to events from main process ───────────────────────────────
  useAIEvents({
    onResponse: (response) => {
      const gen = response.generation;
      // Drop stale responses: if this event has a generation and it's not
      // the one we're currently tracking, it's from a previous (e.g.
      // auto-capture) request that the user already moved past.
      if (gen != null && gen !== currentGenerationRef.current) {
        console.warn(
          `[App] Dropping stale ai-response (gen ${gen}, current ${currentGenerationRef.current})`
        );
        return;
      }

      clearWatchdog();
      setCurrentResponse(response);
      setStatus("done");
      setErrorMsg("");
      setErrorCode(undefined);
      lastActionRef.current = { kind: "none" };

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
      const gen = s.generation;
      if (gen != null && gen !== currentGenerationRef.current) {
        console.warn(
          `[App] Dropping stale analysis-status "${s.status}" (gen ${gen}, current ${currentGenerationRef.current})`
        );
        return;
      }

      if (s.status === "error") {
        clearWatchdog();
        setStatus("error");
        setErrorCode(s.code);
        setErrorMsg(s.message || "Unknown error");
        return;
      }

      if (s.status === "done") {
        clearWatchdog();
      }

      setStatus(s.status as Status);
      if (s.status !== "error") {
        setErrorMsg("");
        setErrorCode(undefined);
      }
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
        // Clear local state for new session, and invalidate any in-flight
        // generation so late responses from the previous session are dropped.
        clearWatchdog();
        currentGenerationRef.current += 1;
        setHistory([]);
        setHistoryCount(0);
        setSessionDocs([]);
        setCurrentResponse(null);
        setStatus("idle");
        setErrorMsg("");
        setErrorCode(undefined);
        setView("collapsed");
        lastActionRef.current = { kind: "none" };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Voice input hook
  const { isListening, startListening, stopListening, error: voiceError } =
    useVoiceInput({
      onTranscript: async (transcript) => {
        if (!sessionActive) return;
        lastActionRef.current = { kind: "voice", transcript };
        beginTrackedRequest();
        setStatus("analyzing");
        setView("guidance");
        await window.electronAPI.askQuestionWithScreen(transcript);
      },
    });

  // Surface voice-recognition errors through the same error banner.
  useEffect(() => {
    if (voiceError) {
      setStatus("error");
      setErrorCode("VOICE_ERROR");
      setErrorMsg(voiceError);
    }
  }, [voiceError]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleAnalyzeNow = useCallback(async () => {
    if (!sessionActive) return;
    lastActionRef.current = { kind: "analyze" };
    beginTrackedRequest();
    setStatus("capturing");
    setErrorMsg("");
    setErrorCode(undefined);
    try {
      await window.electronAPI.analyzeNow();
    } catch (err: any) {
      clearWatchdog();
      setStatus("error");
      setErrorCode("IPC_ERROR");
      setErrorMsg(err?.message || "Failed to start capture.");
    }
  }, [sessionActive, beginTrackedRequest, clearWatchdog]);

  const handleAskQuestion = useCallback(
    async (question: string, withScreen: boolean) => {
      if (!sessionActive) return;
      setErrorMsg("");
      setErrorCode(undefined);

      if (withScreen) {
        lastActionRef.current = { kind: "askWithScreen", question };
        beginTrackedRequest();
        setStatus("analyzing");
        setView("guidance");
        try {
          const result = await window.electronAPI.askQuestionWithScreen(question);
          if (!result?.success) {
            clearWatchdog();
            setStatus("error");
            setErrorCode("ASK_ERROR");
            setErrorMsg(result?.error || "Failed to ask question.");
          }
          // On success, the actual response arrives via useAIEvents.
        } catch (err: any) {
          clearWatchdog();
          setStatus("error");
          setErrorCode("IPC_ERROR");
          setErrorMsg(err?.message || "Failed to ask question.");
        }
        return;
      }

      // Question-from-history path doesn't go through the capture
      // generation system (no screenshot involved), but we still want the
      // watchdog + error banner for a hung/failed request.
      lastActionRef.current = { kind: "askFromHistory", question };
      const gen = beginTrackedRequest();
      setStatus("analyzing");
      setView("guidance");
      try {
        const result = await window.electronAPI.askQuestion(question);
        // Guard against this resolving after a newer action superseded it.
        if (currentGenerationRef.current !== gen) return;

        if (result?.success) {
          clearWatchdog();
          setCurrentResponse(result.response);
          setStatus("done");
          setErrorMsg("");
          setErrorCode(undefined);
          lastActionRef.current = { kind: "none" };
          setHistory((prev) => [
            ...prev,
            {
              timestamp: Date.now(),
              screenSummary: result.response.summary,
              response: result.response,
            },
          ]);
          setHistoryCount((n) => n + 1);
        } else {
          clearWatchdog();
          setStatus("error");
          setErrorCode("ASK_ERROR");
          setErrorMsg(result?.error || "Failed to get an answer.");
        }
      } catch (err: any) {
        if (currentGenerationRef.current !== gen) return;
        clearWatchdog();
        setStatus("error");
        setErrorCode("IPC_ERROR");
        setErrorMsg(err?.message || "Failed to ask question.");
      }
    },
    [sessionActive, beginTrackedRequest, clearWatchdog]
  );

  // The core fix: this is now async and AWAITS the main process confirming
  // the previous mode has fully stopped before flipping local state. While
  // toggleBusy is true, the toggle button (and the manual capture button)
  // are disabled — closing the window where a manual click could race an
  // auto-capture that main hasn't stopped yet.
  const handleToggleAutoCapture = useCallback(async () => {
    if (toggleBusy || sessionStoppedRef.current) return;

    const next = !autoCapture;
    setToggleBusy(true);
    setErrorMsg("");
    setErrorCode(undefined);

    try {
      const result = await window.electronAPI.toggleAutoCaptureSync(
        next,
        captureIntervalSec * 1000
      );

      if (!result?.success) {
        setStatus("error");
        setErrorCode("TOGGLE_ERROR");
        setErrorMsg(result?.error || "Failed to change capture mode.");
        // Reflect whatever main reports as the actual state, rather than
        // assuming our optimistic `next` took effect.
        setAutoCapture(!!result?.enabled);
        return;
      }

      setAutoCapture(result.enabled);

      // Switching to manual: if a capture from auto-mode was mid-flight,
      // stopAutoCapture() on the main side bumped the generation, so any
      // late response for it will now be dropped by our generation check.
      // We also invalidate our tracked generation here defensively, and
      // clear any stale "capturing/analyzing" status left over from it.
      if (!next) {
        currentGenerationRef.current += 1;
        clearWatchdog();
        if (status === "capturing" || status === "analyzing") {
          setStatus("idle");
        }
      }
    } catch (err: any) {
      setStatus("error");
      setErrorCode("TOGGLE_ERROR");
      setErrorMsg(err?.message || "Failed to change capture mode.");
    } finally {
      setToggleBusy(false);
    }
  }, [toggleBusy, autoCapture, captureIntervalSec, status, clearWatchdog]);

  // Keep sessionStoppedRef in sync with sessionActive (declared at the top
  // of the component, alongside the other refs, so it's available before
  // handleToggleAutoCapture is defined).
  useEffect(() => {
    sessionStoppedRef.current = !sessionActive;
  }, [sessionActive]);

  const handleFileUpload = useCallback(async () => {
    try {
      const result = await window.electronAPI.openFilePicker();
      if (!result.success && !result.canceled) {
        setErrorCode("UPLOAD_ERROR");
        setErrorMsg(result.error || "File upload failed.");
        setStatus("error");
      }
    } catch (err: any) {
      setErrorCode("UPLOAD_ERROR");
      setErrorMsg(err?.message || "File upload failed.");
      setStatus("error");
    }
  }, []);

  const handleRemoveDoc = useCallback(async (docId: string) => {
    try {
      const result = await window.electronAPI.removeDocument(docId);
      if (result?.success === false) {
        setErrorCode("REMOVE_DOC_ERROR");
        setErrorMsg("Failed to remove document from session.");
        setStatus("error");
        return;
      }
      setSessionDocs((prev) => prev.filter((d) => d.id !== docId));
    } catch (err: any) {
      setErrorCode("REMOVE_DOC_ERROR");
      setErrorMsg(err?.message || "Failed to remove document.");
      setStatus("error");
    }
  }, []);

  const handleStopSession = useCallback(async () => {
    clearWatchdog();
    currentGenerationRef.current += 1; // invalidate anything in flight
    try {
      await window.electronAPI.stopSession();
    } catch (err: any) {
      setErrorCode("SESSION_ERROR");
      setErrorMsg(err?.message || "Failed to stop session.");
      setStatus("error");
      return;
    }
    setSessionActive(false);
    setView("collapsed");
  }, [clearWatchdog]);

  const handleNewSession = useCallback(async () => {
    try {
      await window.electronAPI.newSession();
    } catch (err: any) {
      setErrorCode("SESSION_ERROR");
      setErrorMsg(err?.message || "Failed to start a new session.");
      setStatus("error");
      return;
    }
    // UI reset handled in onSessionStatus listener.
    // Default to manual mode on a fresh session; the user can re-enable
    // auto-capture from the title bar if desired.
    setAutoCapture(false);
  }, []);

  const handleVoiceToggle = () => {
    if (isListening) {
      stopListening();
    } else {
      setErrorMsg("");
      setErrorCode(undefined);
      startListening();
    }
  };

  // Retry the last action that produced the current error.
  const handleRetry = useCallback(() => {
    setErrorMsg("");
    setErrorCode(undefined);
    setStatus("idle");

    const action = lastActionRef.current;
    switch (action.kind) {
      case "analyze":
        handleAnalyzeNow();
        break;
      case "askWithScreen":
        handleAskQuestion(action.question, true);
        break;
      case "askFromHistory":
        handleAskQuestion(action.question, false);
        break;
      case "voice":
        // Re-send the same transcript with a fresh screenshot.
        lastActionRef.current = { kind: "voice", transcript: action.transcript };
        beginTrackedRequest();
        setStatus("analyzing");
        setView("guidance");
        window.electronAPI.askQuestionWithScreen(action.transcript);
        break;
      case "none":
      default:
        // Nothing to retry — just clear the error (already done above).
        break;
    }
  }, [handleAnalyzeNow, handleAskQuestion, beginTrackedRequest]);

  const handleDismissError = useCallback(() => {
    setErrorMsg("");
    setErrorCode(undefined);
    if (status === "error") setStatus("idle");
  }, [status]);

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
  const busy = status === "capturing" || status === "analyzing";

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
          <span style={styles.titleText}>HeroPilot</span>
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
              opacity: sessionStopped || toggleBusy ? 0.5 : 1,
              cursor: sessionStopped || toggleBusy ? "default" : "pointer",
            }}
            onClick={handleToggleAutoCapture}
            disabled={sessionStopped || toggleBusy}
            title={
              toggleBusy
                ? "Switching mode…"
                : autoCapture
                ? "Auto-capture ON — click to switch to Manual"
                : "Manual mode — click to enable Auto"
            }
          >
            {toggleBusy ? "⋯" : autoCapture ? "⟳ Auto" : "◎ Manual"}
          </button>

          {/* Manual capture (visible in manual mode or as refresh) */}
          {!autoCapture && (
            <button
              style={{
                ...styles.iconBtn,
                opacity: sessionStopped || toggleBusy || busy ? 0.4 : 1,
              }}
              onClick={handleAnalyzeNow}
              disabled={sessionStopped || toggleBusy || busy}
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

      <div style={styles.statusBarandModelSelector}>
             {/* ── Status bar (with retryable error banner) ───────────────── */}
      <StatusIndicator
        status={status}
        errorMsg={errorMsg}
        errorCode={errorCode}
        canRetry={lastActionRef.current.kind !== "none"}
        onRetry={handleRetry}
        onDismiss={handleDismissError}
      />
      {/* Model selector */}
          <ModelSelector 
            value={selectedModel}
            onChange={setSelectedModel}
            disabled={sessionStopped}
          />
      </div>

     

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
                toggleBusy={toggleBusy}
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
                  if (autoCapture && !toggleBusy) {
                    // Re-apply the new interval to the running auto-capture.
                    window.electronAPI
                      .toggleAutoCaptureSync(true, s * 1000)
                      .catch((err) => {
                        setStatus("error");
                        setErrorCode("TOGGLE_ERROR");
                        setErrorMsg(
                          err?.message || "Failed to update capture interval."
                        );
                      });
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
                toggleBusy={toggleBusy}
                onAnalyze={handleAnalyzeNow}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sub-views ────────────────────────────────────────────────────────────────

function EmptyGuidanceView({
  status,
  autoCapture,
  toggleBusy,
  onAnalyze,
}: {
  status: string;
  autoCapture: boolean;
  toggleBusy: boolean;
  onAnalyze: () => void;
}) {
  return (
    <div style={styles.emptyState}>
      <div style={styles.emptyIcon}>◈</div>
      <p style={styles.emptyTitle}>
        {toggleBusy
          ? "Switching mode..."
          : status === "idle"
          ? autoCapture
            ? "Auto-monitoring your screen"
            : "Manual capture mode"
          : status === "capturing"
          ? "Capturing screen..."
          : status === "analyzing"
          ? "Analyzing..."
          : status === "error"
          ? "Something went wrong"
          : "Ready"}
      </p>
      <p style={styles.emptyHint}>
        {autoCapture
          ? "AI will automatically analyze your screen and guide you."
          : "Press the capture button or ask a question to get started."}
      </p>
      {!autoCapture && (
        <button
          style={{
            ...styles.analyzeBtn,
            opacity: toggleBusy || status === "capturing" || status === "analyzing" ? 0.5 : 1,
            cursor:
              toggleBusy || status === "capturing" || status === "analyzing"
                ? "default"
                : "pointer",
          }}
          onClick={onAnalyze}
          disabled={toggleBusy || status === "capturing" || status === "analyzing"}
        >
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
    gap: "8px",
  },
  titleLeft: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: 0,
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
    whiteSpace: "nowrap",
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
    whiteSpace: "nowrap",
  },
  titleRight: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    WebkitAppRegion: "no-drag",
    flexShrink: 0,
  },
  statusBarandModelSelector: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "2px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(160, 17, 17, 0.02)",
  },
  captureToggleBtn: {
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "6px",
    fontSize: "11px",
    fontWeight: 600,
    transition: "all 0.2s",
    padding: "3px 8px",
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
// // Full redesign — Copilot-style floating assistant with:
// //   • Auto/manual capture toggle
// //   • Voice input
// //   • Document upload
// //   • Session stop / new session
// //   • Full-answer display (not just intent prediction)
// //   • History panel
// //   • Settings panel

// import React, {
//   useState,
//   useEffect,
//   useCallback,
//   useRef,
// } from "react";
// import type { AIResponse } from "../../shared/types";
// import { GuidancePanel } from "./GuidancePanel";
// import { ChatInput } from "./ChatInput";
// import { StatusIndicator } from "./StatusIndicator";
// import { HistoryPanel, HistoryEntry } from "./HistoryPanel";
// import { SettingsPanel } from "./SettingsPanel";
// import { DocumentsPanel } from "./DocumentsPanel";
// import { useAIEvents } from "../hooks/useAIEvents";
// import { useVoiceInput } from "../hooks/useVoiceInput";

// type Status = "idle" | "capturing" | "analyzing" | "done" | "error";
// type View =
//   | "collapsed"
//   | "guidance"
//   | "chat"
//   | "history"
//   | "settings"
//   | "documents";

// interface SessionDoc {
//   id: string;
//   name: string;
// }

// export function App() {
//   const [status, setStatus] = useState<Status>("idle");
//   const [view, setView] = useState<View>("collapsed");
//   const [currentResponse, setCurrentResponse] =
//     useState<AIResponse | null>(null);
//   const [errorMsg, setErrorMsg] = useState<string>("");
//   const [autoCapture, setAutoCapture] = useState(true);
//   const [captureIntervalSec, setCaptureIntervalSec] = useState(20);
//   const [history, setHistory] = useState<HistoryEntry[]>([]);
//   const [sessionDocs, setSessionDocs] = useState<SessionDoc[]>([]);
//   const [sessionActive, setSessionActive] = useState(true);
//   const [sessionId, setSessionId] = useState<string>("");
//   const [historyCount, setHistoryCount] = useState(0);

//   // Initialise session info
//   useEffect(() => {
//     window.electronAPI.getSessionInfo().then((info) => {
//       setSessionId(info.sessionId);
//       setSessionActive(info.isActive);
//     });
//   }, []);

//   // Subscribe to events from main process
//   useAIEvents({
//     onResponse: (response) => {
//       setCurrentResponse(response);
//       setStatus("done");
//       // Push to local history
//       setHistory((prev) => [
//         ...prev,
//         {
//           timestamp: Date.now(),
//           screenSummary: response.summary,
//           response,
//         },
//       ]);
//       setHistoryCount((n) => n + 1);
//       if (view === "collapsed") setView("guidance");
//     },
//     onStatus: (s) => {
//       setStatus(s.status as Status);
//       if (s.status === "error") setErrorMsg(s.message || "Unknown error");
//     },
//   });

//   // Listen for document uploads and session status
//   useEffect(() => {
//     const unsubDoc = window.electronAPI.onDocumentUploaded((info) => {
//       setSessionDocs((prev) => {
//         if (prev.find((d) => d.id === info.documentId)) return prev;
//         return [...prev, { id: info.documentId, name: info.name }];
//       });
//     });
//     const unsubSession = window.electronAPI.onSessionStatus((s) => {
//       setSessionActive(s.status !== "stopped");
//       setSessionId(s.sessionId);
//       if (s.status === "new") {
//         // Clear local state for new session
//         setHistory([]);
//         setHistoryCount(0);
//         setSessionDocs([]);
//         setCurrentResponse(null);
//         setStatus("idle");
//         setView("collapsed");
//       }
//     });
//     const unsubContext = window.electronAPI.onContextUpdate((ctx) => {
//       if (ctx.history) setHistoryCount(ctx.history.length);
//       if (ctx.uploadedDocuments) {
//         setSessionDocs(
//           ctx.uploadedDocuments.map((d) => ({ id: d.id, name: d.name }))
//         );
//       }
//     });
//     return () => {
//       unsubDoc();
//       unsubSession();
//       unsubContext();
//     };
//   }, []);

//   // Voice input hook
//   const { isListening, startListening, stopListening, error: voiceError } =
//     useVoiceInput({
//       onTranscript: async (transcript) => {
//         setStatus("analyzing");
//         setView("guidance");
//         await window.electronAPI.askQuestionWithScreen(transcript);
//       },
//     });

//   // ── Handlers ──────────────────────────────────────────────────────────

//   const handleAnalyzeNow = useCallback(async () => {
//     if (!sessionActive) return;
//     setStatus("capturing");
//     await window.electronAPI.analyzeNow();
//   }, [sessionActive]);

//   const handleAskQuestion = useCallback(
//     async (question: string, withScreen: boolean) => {
//       if (!sessionActive) return;
//       setStatus("analyzing");
//       setView("guidance");
//       const result = withScreen
//         ? await window.electronAPI.askQuestionWithScreen(question)
//         : await window.electronAPI.askQuestion(question);

//       if (!withScreen && result?.success) {
//         setCurrentResponse(result.response);
//         setStatus("done");
//         setHistory((prev) => [
//           ...prev,
//           {
//             timestamp: Date.now(),
//             screenSummary: result.response.summary,
//             response: result.response,
//           },
//         ]);
//       } else if (!withScreen && !result?.success) {
//         setStatus("error");
//         setErrorMsg(result?.error || "Failed");
//       }
//       // If withScreen, events come through useAIEvents
//     },
//     [sessionActive]
//   );

//   const handleToggleAutoCapture = () => {
//     const next = !autoCapture;
//     setAutoCapture(next);
//     window.electronAPI.toggleAutoCapture(next, captureIntervalSec * 1000);
//   };

//   const handleFileUpload = useCallback(async () => {
//     const result = await window.electronAPI.openFilePicker();
//     if (!result.success && !result.canceled) {
//       console.error("File upload error:", result.error);
//     }
//   }, []);

//   const handleRemoveDoc = useCallback(async (docId: string) => {
//     await window.electronAPI.removeDocument(docId);
//     setSessionDocs((prev) => prev.filter((d) => d.id !== docId));
//   }, []);

//   const handleStopSession = useCallback(async () => {
//     await window.electronAPI.stopSession();
//     setSessionActive(false);
//     setView("collapsed");
//     captureManager_stopUI();
//   }, []);

//   const handleNewSession = useCallback(async () => {
//     await window.electronAPI.newSession();
//     // UI reset handled in onSessionStatus listener
//     window.electronAPI.toggleAutoCapture(true, captureIntervalSec * 1000);
//     setAutoCapture(true);
//   }, [captureIntervalSec]);

//   const handleVoiceToggle = () => {
//     if (isListening) {
//       stopListening();
//     } else {
//       startListening();
//     }
//   };

//   // ── Layout helpers ─────────────────────────────────────────────────────

//   const navBtn = (
//     icon: string,
//     targetView: View,
//     label: string,
//     badge?: number
//   ) => (
//     <button
//       style={{
//         ...styles.navBtn,
//         background:
//           view === targetView
//             ? "rgba(99,102,241,0.2)"
//             : "transparent",
//         color: view === targetView ? "#a5b4fc" : "#64748b",
//       }}
//       onClick={() =>
//         setView((v) => (v === targetView ? "collapsed" : targetView))
//       }
//       title={label}
//     >
//       {icon}
//       {badge != null && badge > 0 && (
//         <span style={styles.badge}>{badge > 99 ? "99+" : badge}</span>
//       )}
//     </button>
//   );

//   const sessionStopped = !sessionActive;

//   return (
//     <div style={styles.root}>
//       {/* ── Title bar / drag handle ───────────────────────────── */}
//       <div style={styles.titleBar} className="drag-region">
//         <div style={styles.titleLeft}>
//           <div
//             style={{
//               ...styles.logo,
//               animation: status === "analyzing" ? "pulse 1s infinite" : "none",
//             }}
//           >
//             ◈
//           </div>
//           <span style={styles.titleText}>HeroPilot</span>
//           {sessionStopped && (
//             <span style={styles.stoppedBadge}>STOPPED</span>
//           )}
//         </div>

//         <div style={styles.titleRight}>
//           {/* Auto/Manual capture toggle */}
//           <button
//             style={{
//               ...styles.captureToggleBtn,
//               background: autoCapture
//                 ? "rgba(34,197,94,0.15)"
//                 : "rgba(99,102,241,0.15)",
//               color: autoCapture ? "#22c55e" : "#818cf8",
//               opacity: sessionStopped ? 0.4 : 1,
//             }}
//             onClick={handleToggleAutoCapture}
//             disabled={sessionStopped}
//             title={autoCapture ? "Auto-capture ON — click to switch to Manual" : "Manual mode — click to enable Auto"}
//           >
//             {autoCapture ? "⟳ Auto" : "◎ Manual"}
//           </button>

//           {/* Manual capture (visible in manual mode or as refresh) */}
//           {!autoCapture && (
//             <button
//               style={styles.iconBtn}
//               onClick={handleAnalyzeNow}
//               disabled={sessionStopped || status === "capturing"}
//               title="Capture & analyze now (Ctrl+Shift+A)"
//             >
//               📸
//             </button>
//           )}

//           {/* Voice input */}
//           <button
//             style={{
//               ...styles.iconBtn,
//               color: isListening ? "#ef4444" : "#94a3b8",
//               background: isListening ? "rgba(239,68,68,0.1)" : "transparent",
//             }}
//             onClick={handleVoiceToggle}
//             disabled={sessionStopped}
//             title={isListening ? "Stop voice input" : "Start voice input"}
//           >
//             {isListening ? "🔴" : "🎤"}
//           </button>

//           {/* Ask question */}
//           <button
//             style={{
//               ...styles.iconBtn,
//               color: view === "chat" ? "#a5b4fc" : "#94a3b8",
//             }}
//             onClick={() => setView((v) => (v === "chat" ? "guidance" : "chat"))}
//             disabled={sessionStopped}
//             title="Ask a question"
//           >
//             ✎
//           </button>

//           {/* Hide */}
//           <button
//             style={styles.iconBtn}
//             onClick={() => window.electronAPI.hideWindow()}
//             title="Hide (Ctrl+Shift+H)"
//           >
//             ✕
//           </button>
//         </div>
//       </div>

//       {/* ── Status bar ───────────────────────────────────────────── */}
//       <StatusIndicator status={status} errorMsg={errorMsg} />

//       {/* ── Bottom nav ───────────────────────────────────────────── */}
//       <div style={styles.navBar}>
//         {navBtn("◈", "guidance", "Guidance")}
//         {navBtn("✎", "chat", "Chat")}
//         {navBtn("📁", "documents", "Documents", sessionDocs.length)}
//         {navBtn("🕐", "history", "History", historyCount)}
//         {navBtn("⚙", "settings", "Settings")}
//       </div>

//       {/* ── Content area ─────────────────────────────────────────── */}
//       <div style={styles.content}>
//         {sessionStopped ? (
//           <SessionStoppedView onNewSession={handleNewSession} />
//         ) : (
//           <>
//             {view === "guidance" && currentResponse && (
//               <GuidancePanel response={currentResponse} />
//             )}
//             {view === "guidance" && !currentResponse && (
//               <EmptyGuidanceView
//                 status={status}
//                 autoCapture={autoCapture}
//                 onAnalyze={handleAnalyzeNow}
//               />
//             )}
//             {view === "chat" && (
//               <ChatInput
//                 onSubmit={handleAskQuestion}
//                 isLoading={status === "analyzing"}
//               />
//             )}
//             {view === "documents" && (
//               <DocumentsPanel
//                 documents={sessionDocs}
//                 onUpload={handleFileUpload}
//                 onRemove={handleRemoveDoc}
//               />
//             )}
//             {view === "history" && (
//               <HistoryPanel
//                 history={history}
//                 onRestore={(entry) => {
//                   setCurrentResponse(entry.response);
//                   setView("guidance");
//                 }}
//               />
//             )}
//             {view === "settings" && (
//               <SettingsPanel
//                 captureIntervalSec={captureIntervalSec}
//                 onIntervalChange={(s) => {
//                   setCaptureIntervalSec(s);
//                   if (autoCapture) {
//                     window.electronAPI.toggleAutoCapture(true, s * 1000);
//                   }
//                 }}
//                 onClose={() => setView("guidance")}
//                 onStopSession={handleStopSession}
//                 onNewSession={handleNewSession}
//                 sessionId={sessionId}
//               />
//             )}
//             {view === "collapsed" && (
//               <EmptyGuidanceView
//                 status={status}
//                 autoCapture={autoCapture}
//                 onAnalyze={handleAnalyzeNow}
//               />
//             )}
//           </>
//         )}
//       </div>
//     </div>
//   );
// }

// // Small helper so stopSession handler can disable UI without calling captureManager directly
// function captureManager_stopUI() {
//   // This is called client-side — the IPC call already happened
// }

// // ─── Sub-views ────────────────────────────────────────────────────────────────

// function EmptyGuidanceView({
//   status,
//   autoCapture,
//   onAnalyze,
// }: {
//   status: string;
//   autoCapture: boolean;
//   onAnalyze: () => void;
// }) {
//   return (
//     <div style={styles.emptyState}>
//       <div style={styles.emptyIcon}>◈</div>
//       <p style={styles.emptyTitle}>
//         {status === "idle"
//           ? autoCapture
//             ? "Auto-monitoring your screen"
//             : "Manual capture mode"
//           : status === "capturing"
//           ? "Capturing screen..."
//           : status === "analyzing"
//           ? "Analyzing..."
//           : "Ready"}
//       </p>
//       <p style={styles.emptyHint}>
//         {autoCapture
//           ? "AI will automatically analyze your screen and guide you."
//           : "Press the capture button or ask a question to get started."}
//       </p>
//       {!autoCapture && (
//         <button style={styles.analyzeBtn} onClick={onAnalyze}>
//           📸 Capture & Analyze
//         </button>
//       )}
//     </div>
//   );
// }

// function SessionStoppedView({ onNewSession }: { onNewSession: () => void }) {
//   return (
//     <div style={styles.emptyState}>
//       <div style={{ ...styles.emptyIcon, color: "#ef4444" }}>⏹</div>
//       <p style={styles.emptyTitle}>Session Stopped</p>
//       <p style={styles.emptyHint}>
//         Start a new session to continue using the assistant.
//       </p>
//       <button
//         style={{ ...styles.analyzeBtn, background: "linear-gradient(135deg, #10b981, #059669)" }}
//         onClick={onNewSession}
//       >
//         ▶ Start New Session
//       </button>
//     </div>
//   );
// }

// // ─── Styles ───────────────────────────────────────────────────────────────────

// type ElStyle = React.CSSProperties & { WebkitAppRegion?: string };

// const styles: Record<string, ElStyle> = {
//   root: {
//     width: "100%",
//     height: "100vh",
//     background: "rgba(10, 11, 18, 0.95)",
//     backdropFilter: "blur(24px)",
//     borderRadius: "14px",
//     border: "1px solid rgba(255,255,255,0.08)",
//     display: "flex",
//     flexDirection: "column",
//     overflow: "hidden",
//     color: "#e2e8f0",
//     boxShadow: "0 32px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.1)",
//     fontFamily: "'SF Pro Display', 'Segoe UI', system-ui, sans-serif",
//   },
//   titleBar: {
//     display: "flex",
//     alignItems: "center",
//     justifyContent: "space-between",
//     padding: "10px 14px",
//     borderBottom: "1px solid rgba(255,255,255,0.06)",
//     cursor: "grab",
//     WebkitAppRegion: "drag",
//     flexShrink: 0,
//     background: "rgba(255,255,255,0.02)",
//   },
//   titleLeft: {
//     display: "flex",
//     alignItems: "center",
//     gap: "8px",
//   },
//   logo: {
//     fontSize: "18px",
//     color: "#6366f1",
//   },
//   titleText: {
//     fontSize: "13px",
//     fontWeight: 700,
//     color: "#e2e8f0",
//     letterSpacing: "0.04em",
//   },
//   stoppedBadge: {
//     fontSize: "9px",
//     fontWeight: 700,
//     color: "#ef4444",
//     background: "rgba(239,68,68,0.1)",
//     border: "1px solid rgba(239,68,68,0.3)",
//     borderRadius: "4px",
//     padding: "2px 5px",
//     letterSpacing: "0.05em",
//   },
//   titleRight: {
//     display: "flex",
//     alignItems: "center",
//     gap: "2px",
//     WebkitAppRegion: "no-drag",
//   },
//   captureToggleBtn: {
//     border: "1px solid rgba(255,255,255,0.08)",
//     borderRadius: "6px",
//     fontSize: "11px",
//     fontWeight: 600,
//     cursor: "pointer",
//     padding: "3px 8px",
//     transition: "all 0.2s",
//     lineHeight: 1.4,
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
//   navBar: {
//     display: "flex",
//     alignItems: "center",
//     gap: "2px",
//     padding: "6px 10px",
//     borderBottom: "1px solid rgba(255,255,255,0.05)",
//     flexShrink: 0,
//     WebkitAppRegion: "no-drag",
//   },
//   navBtn: {
//     position: "relative",
//     background: "transparent",
//     border: "none",
//     fontSize: "14px",
//     cursor: "pointer",
//     padding: "5px 8px",
//     borderRadius: "7px",
//     transition: "all 0.15s",
//     flex: 1,
//     textAlign: "center" as const,
//   },
//   badge: {
//     position: "absolute",
//     top: "1px",
//     right: "2px",
//     background: "#6366f1",
//     color: "#fff",
//     fontSize: "8px",
//     fontWeight: 700,
//     borderRadius: "8px",
//     padding: "1px 3px",
//     lineHeight: 1.2,
//   },
//   content: {
//     flex: 1,
//     overflow: "hidden",
//     display: "flex",
//     flexDirection: "column",
//   },
//   emptyState: {
//     flex: 1,
//     display: "flex",
//     flexDirection: "column",
//     alignItems: "center",
//     justifyContent: "center",
//     gap: "12px",
//     padding: "32px 20px",
//   },
//   emptyIcon: {
//     fontSize: "36px",
//     color: "#334155",
//   },
//   emptyTitle: {
//     fontSize: "14px",
//     fontWeight: 600,
//     color: "#94a3b8",
//     textAlign: "center",
//   },
//   emptyHint: {
//     fontSize: "12px",
//     color: "#475569",
//     textAlign: "center",
//     lineHeight: 1.6,
//     maxWidth: "280px",
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
//     marginTop: "8px",
//   },
// };
