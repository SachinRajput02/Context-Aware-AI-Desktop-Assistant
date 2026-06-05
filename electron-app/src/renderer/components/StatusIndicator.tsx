// electron-app/src/renderer/components/StatusIndicator.tsx

import React from "react";

type Status = "idle" | "capturing" | "analyzing" | "done" | "error";

interface StatusIndicatorProps {
  status: Status;
  errorMsg?: string;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  status,
  errorMsg,
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
        return errorMsg || "Error occurred";
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
  },
  text: {
    color: "#cbd5f5",
  },
};