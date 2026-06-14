// electron-app/src/renderer/components/StatusIndicator.tsx
// Now renders a retryable error banner instead of just a one-line status
// when status === "error". Maps known error codes (from captureManager's
// CaptureErrorCode union) to friendlier messages.

import React from "react";

type Status = "idle" | "capturing" | "analyzing" | "done" | "error";

interface StatusIndicatorProps {
  status: Status;
  errorMsg?: string;
  errorCode?: string;
  canRetry?: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
}

// Friendlier copy for known error codes. Falls back to errorMsg / generic text.
const ERROR_CODE_LABELS: Record<string, string> = {
  SESSION_STOPPED: "Session stopped",
  CAPTURE_FAILED: "Screen capture failed",
  NETWORK_TIMEOUT: "Request timed out",
  NETWORK_ERROR: "Can't reach backend",
  SERVER_ERROR: "Server error",
  UPLOAD_ERROR: "Upload failed",
  ALREADY_CAPTURING: "Capture already in progress",
  TOGGLE_ERROR: "Couldn't change capture mode",
  TIMEOUT: "Request timed out",
  ASK_ERROR: "Couldn't get an answer",
  IPC_ERROR: "Internal communication error",
  VOICE_ERROR: "Voice input error",
  UPLOAD_DOC_ERROR: "Document upload failed",
  REMOVE_DOC_ERROR: "Couldn't remove document",
  SESSION_ERROR: "Session action failed",
  UNKNOWN: "Unexpected error",
};

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  status,
  errorMsg,
  errorCode,
  canRetry,
  onRetry,
  onDismiss,
}) => {
  const getStatusText = () => {
    switch (status) {
      case "idle":
        return "Idle";
      case "capturing":
        return "Capturing screen...";
      case "analyzing":
        return "Analyzing...";
      case "done":
        return "Ready";
      case "error":
        return errorCode ? ERROR_CODE_LABELS[errorCode] || "Error occurred" : "Error occurred";
      default:
        return "";
    }
  };

  const getColor = () => {
    switch (status) {
      case "idle":
        return "#64748b";
      case "capturing":
        return "#facc15";
      case "analyzing":
        return "#38bdf8";
      case "done":
        return "#22c55e";
      case "error":
        return "#ef4444";
      default:
        return "#64748b";
    }
  };

  if (status === "error") {
    return (
      <div style={styles.errorContainer}>
        <div style={styles.errorTop}>
          <div style={{ ...styles.dot, background: getColor(), marginTop: "2px" }} />
          <div style={styles.errorTextBlock}>
            <span style={styles.errorTitle}>{getStatusText()}</span>
            {errorMsg && <span style={styles.errorDetail}>{errorMsg}</span>}
          </div>
        </div>
        <div style={styles.errorActions}>
          {canRetry && onRetry && (
            <button style={styles.retryBtn} onClick={onRetry}>
              ↻ Retry
            </button>
          )}
          {onDismiss && (
            <button style={styles.dismissBtn} onClick={onDismiss}>
              Dismiss
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={{ ...styles.dot, background: getColor() }} />
      <span style={styles.text}>{getStatusText()}</span>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    fontSize: "12px",
  },
  dot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    flexShrink: 0,
  },
  text: {
    color: "#cbd5f5",
  },
  errorContainer: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "10px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    background: "rgba(239,68,68,0.08)",
  },
  errorTop: {
    display: "flex",
    gap: "8px",
    alignItems: "flex-start",
  },
  errorTextBlock: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  },
  errorTitle: {
    fontSize: "12px",
    fontWeight: 600,
    color: "#fca5a5",
  },
  errorDetail: {
    fontSize: "11px",
    color: "#94a3b8",
    lineHeight: 1.5,
    wordBreak: "break-word" as const,
  },
  errorActions: {
    display: "flex",
    gap: "6px",
    paddingLeft: "16px",
  },
  retryBtn: {
    background: "rgba(99,102,241,0.15)",
    border: "1px solid rgba(99,102,241,0.3)",
    borderRadius: "6px",
    color: "#a5b4fc",
    fontSize: "11px",
    fontWeight: 600,
    padding: "4px 10px",
    cursor: "pointer",
  },
  dismissBtn: {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "6px",
    color: "#94a3b8",
    fontSize: "11px",
    fontWeight: 600,
    padding: "4px 10px",
    cursor: "pointer",
  },
};







// // electron-app/src/renderer/components/StatusIndicator.tsx

// import React from "react";

// type Status = "idle" | "capturing" | "analyzing" | "done" | "error";

// interface StatusIndicatorProps {
//   status: Status;
//   errorMsg?: string;
// }

// export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
//   status,
//   errorMsg,
// }) => {
//   const getStatusText = () => {
//     switch (status) {
//       case "idle":
//         return "Idle";
//       case "capturing":
//         return "Capturing screen...";
//       case "analyzing":
//         return "Analyzing...";
//       case "done":
//         return "Ready";
//       case "error":
//         return errorMsg || "Error occurred";
//       default:
//         return "";
//     }
//   };

//   const getColor = () => {
//     switch (status) {
//       case "idle":
//         return "#64748b";
//       case "capturing":
//         return "#facc15";
//       case "analyzing":
//         return "#38bdf8";
//       case "done":
//         return "#22c55e";
//       case "error":
//         return "#ef4444";
//       default:
//         return "#64748b";
//     }
//   };

//   return (
//     <div style={styles.container}>
//       <div style={{ ...styles.dot, background: getColor() }} />
//       <span style={styles.text}>{getStatusText()}</span>
//     </div>
//   );
// };

// const styles: Record<string, React.CSSProperties> = {
//   container: {
//     display: "flex",
//     alignItems: "center",
//     gap: "8px",
//     padding: "8px 12px",
//     borderBottom: "1px solid rgba(255,255,255,0.05)",
//     fontSize: "12px",
//   },
//   dot: {
//     width: "8px",
//     height: "8px",
//     borderRadius: "50%",
//   },
//   text: {
//     color: "#cbd5f5",
//   },
// };