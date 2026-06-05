// electron-app/src/renderer/components/DocumentsPanel.tsx
// Manage documents uploaded to the current session.
// Supports drag-and-drop from the UI as well as the native file picker.

import React, { useCallback, useState } from "react";

interface SessionDoc {
  id: string;
  name: string;
}

interface Props {
  documents: SessionDoc[];
  onUpload: () => void;
  onRemove: (id: string) => void;
}

function fileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["js", "ts", "tsx", "jsx"].includes(ext)) return "📜";
  if (["py", "go", "rs", "java", "cpp", "c"].includes(ext)) return "⚙";
  if (["json", "yaml", "yml", "toml", "env"].includes(ext)) return "{}";
  if (["md", "txt"].includes(ext)) return "📄";
  if (["pdf"].includes(ext)) return "📕";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "🖼";
  if (["csv"].includes(ext)) return "📊";
  if (["html", "css"].includes(ext)) return "🌐";
  return "📎";
}

export function DocumentsPanel({ documents, onUpload, onRemove }: Props) {
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      for (const file of files) {
        const isText = file.type.startsWith("text/") || isTextMime(file.type);
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const raw = ev.target?.result;
          if (!raw) return;
          const content =
            typeof raw === "string"
              ? isText
                ? raw // raw text
                : raw.split(",")[1] // strip data:...;base64, prefix
              : "";
          await window.electronAPI.uploadDocumentData({
            name: file.name,
            type: file.type || "application/octet-stream",
            content,
            isText,
          });
        };
        if (isText) {
          reader.readAsText(file);
        } else {
          reader.readAsDataURL(file);
        }
      }
    },
    []
  );

  return (
    <div style={styles.container}>
      <p style={styles.header}>Session Documents</p>
      <p style={styles.hint}>
        Documents are available to the AI for all questions in this session.
      </p>

      {/* Drop zone */}
      <div
        style={{
          ...styles.dropZone,
          borderColor: dragOver
            ? "rgba(99,102,241,0.6)"
            : "rgba(255,255,255,0.1)",
          background: dragOver
            ? "rgba(99,102,241,0.08)"
            : "rgba(255,255,255,0.02)",
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={onUpload}
      >
        <span style={styles.dropIcon}>📁</span>
        <p style={styles.dropText}>
          Drop files here or <span style={styles.dropLink}>click to browse</span>
        </p>
        <p style={styles.dropHint}>
          Code, text, JSON, PDF, images — anything relevant
        </p>
      </div>

      {/* Document list */}
      {documents.length === 0 ? (
        <div style={styles.empty}>
          <p style={styles.emptyText}>No documents uploaded yet.</p>
        </div>
      ) : (
        <div style={styles.list}>
          {documents.map((doc) => (
            <div key={doc.id} style={styles.docItem}>
              <span style={styles.docIcon}>{fileIcon(doc.name)}</span>
              <span style={styles.docName} title={doc.name}>
                {doc.name}
              </span>
              <button
                style={styles.removeBtn}
                onClick={() => onRemove(doc.id)}
                title="Remove from session"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function isTextMime(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    [
      "application/json",
      "application/xml",
      "application/javascript",
      "application/typescript",
    ].includes(mime)
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    overflowY: "auto",
    padding: "14px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  header: {
    fontSize: "12px",
    fontWeight: 700,
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    margin: 0,
  },
  hint: {
    fontSize: "11px",
    color: "#475569",
    lineHeight: 1.5,
    margin: 0,
  },
  dropZone: {
    border: "1.5px dashed",
    borderRadius: "12px",
    padding: "20px",
    cursor: "pointer",
    transition: "all 0.2s",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
  },
  dropIcon: {
    fontSize: "24px",
  },
  dropText: {
    fontSize: "13px",
    color: "#94a3b8",
    margin: 0,
    textAlign: "center",
  },
  dropLink: {
    color: "#818cf8",
    textDecoration: "underline",
    cursor: "pointer",
  },
  dropHint: {
    fontSize: "11px",
    color: "#475569",
    margin: 0,
    textAlign: "center",
  },
  empty: {
    padding: "16px",
    textAlign: "center",
  },
  emptyText: {
    fontSize: "12px",
    color: "#334155",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "5px",
  },
  docItem: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "9px 12px",
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: "9px",
  },
  docIcon: {
    fontSize: "14px",
    flexShrink: 0,
  },
  docName: {
    flex: 1,
    fontSize: "12px",
    color: "#94a3b8",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  removeBtn: {
    background: "transparent",
    border: "none",
    color: "#475569",
    fontSize: "11px",
    cursor: "pointer",
    padding: "2px 5px",
    borderRadius: "4px",
    flexShrink: 0,
    transition: "color 0.15s",
  },
};