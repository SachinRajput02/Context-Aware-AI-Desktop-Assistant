// electron-app/src/renderer/components/HistoryPanel.tsx
// Displays the session history — past screens and what the AI said

import React from "react";
import type { AIResponse } from "../../shared/types";

export interface HistoryEntry {
  timestamp: number;
  screenSummary: string;
  response: AIResponse;
}

interface Props {
  history: HistoryEntry[];
  onRestore: (entry: HistoryEntry) => void;
}

export function HistoryPanel({ history, onRestore }: Props) {
  if (history.length === 0) {
    return (
      <div style={styles.empty}>
        <p style={styles.emptyText}>No history yet this session.</p>
        <p style={styles.emptyHint}>Each screen analysis will appear here.</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <p style={styles.header}>Session history ({history.length})</p>
      <div style={styles.list}>
        {[...history].reverse().map((entry, i) => (
          <HistoryCard key={i} entry={entry} onRestore={() => onRestore(entry)} />
        ))}
      </div>
    </div>
  );
}

function HistoryCard({
  entry,
  onRestore,
}: {
  entry: HistoryEntry;
  onRestore: () => void;
}) {
  const time = new Date(entry.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div style={styles.card} onClick={onRestore}>
      <div style={styles.cardLeft}>
        <span style={styles.time}>{time}</span>
        <div style={styles.dot} />
      </div>
      <div style={styles.cardRight}>
        <p style={styles.summary}>{entry.response.summary}</p>
        <p style={styles.screen}>{entry.screenSummary}</p>
        <p style={styles.steps}>
          {entry.response.guidance.length} step
          {entry.response.guidance.length !== 1 ? "s" : ""}
          · {entry.response.modelUsed}
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    overflowY: "auto",
    padding: "12px",
  },
  header: {
    fontSize: "11px",
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    fontWeight: 600,
    marginBottom: "10px",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  card: {
    display: "flex",
    gap: "10px",
    padding: "10px",
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: "10px",
    cursor: "pointer",
    transition: "background 0.15s",
  },
  cardLeft: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
    flexShrink: 0,
    paddingTop: "2px",
  },
  time: {
    fontSize: "10px",
    color: "#475569",
  },
  dot: {
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    background: "#334155",
    flexShrink: 0,
  },
  cardRight: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "3px",
  },
  summary: {
    fontSize: "12px",
    color: "#e2e8f0",
    lineHeight: 1.4,
    fontWeight: 500,
  },
  screen: {
    fontSize: "11px",
    color: "#64748b",
    lineHeight: 1.3,
  },
  steps: {
    fontSize: "10px",
    color: "#334155",
    marginTop: "2px",
  },
  empty: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px",
    gap: "8px",
  },
  emptyText: {
    fontSize: "13px",
    color: "#475569",
  },
  emptyHint: {
    fontSize: "12px",
    color: "#334155",
    textAlign: "center",
  },
};