// electron-app/src/renderer/components/ChatInput.tsx
// Chat input with two modes: question-only (uses history) and question+screen (captures)

import React, { useState, useRef, useEffect } from "react";

interface ChatInputProps {
  onSubmit: (question: string, withScreen: boolean) => void;
  isLoading: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSubmit,
  isLoading,
}) => {
  const [input, setInput] = useState("");
  const [withScreen, setWithScreen] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (!input.trim() || isLoading) return;
    onSubmit(input.trim(), withScreen);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div style={styles.container}>
      {/* Mode selector */}
      <div style={styles.modeRow}>
        <button
          style={{
            ...styles.modeBtn,
            background: withScreen
              ? "rgba(99,102,241,0.2)"
              : "rgba(255,255,255,0.04)",
            color: withScreen ? "#a5b4fc" : "#64748b",
            border: `1px solid ${withScreen ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.07)"}`,
          }}
          onClick={() => setWithScreen(true)}
        >
          📸 Ask with screenshot
        </button>
        <button
          style={{
            ...styles.modeBtn,
            background: !withScreen
              ? "rgba(99,102,241,0.2)"
              : "rgba(255,255,255,0.04)",
            color: !withScreen ? "#a5b4fc" : "#64748b",
            border: `1px solid ${!withScreen ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.07)"}`,
          }}
          onClick={() => setWithScreen(false)}
        >
          💬 Ask from history
        </button>
      </div>

      <p style={styles.modeHint}>
        {withScreen
          ? "Captures your screen + uses full session history for a complete answer."
          : "Uses only session history and uploaded documents (no new screenshot)."}
      </p>

      <textarea
        ref={textareaRef}
        style={styles.textarea}
        placeholder={
          withScreen
            ? "Describe your problem or ask about what's on screen..."
            : "Ask anything — I'll use your full session history to answer..."
        }
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isLoading}
        rows={4}
      />

      <div style={styles.footer}>
        <span style={styles.hint}>Enter to send · Shift+Enter for new line</span>
        <button
          style={{
            ...styles.button,
            opacity: isLoading || !input.trim() ? 0.5 : 1,
          }}
          onClick={handleSubmit}
          disabled={isLoading || !input.trim()}
        >
          {isLoading ? (
            <span style={styles.loadingDots}>●●●</span>
          ) : (
            "Send ↑"
          )}
        </button>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "14px",
    flex: 1,
    overflowY: "auto",
  },
  modeRow: {
    display: "flex",
    gap: "6px",
  },
  modeBtn: {
    flex: 1,
    padding: "7px 10px",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "11px",
    fontWeight: 600,
    transition: "all 0.15s",
    textAlign: "center" as const,
  },
  modeHint: {
    fontSize: "11px",
    color: "#475569",
    lineHeight: 1.5,
  },
  textarea: {
    width: "100%",
    borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.04)",
    color: "#e2e8f0",
    padding: "10px 12px",
    fontSize: "13px",
    resize: "none",
    outline: "none",
    lineHeight: 1.6,
    fontFamily: "inherit",
    boxSizing: "border-box" as const,
    transition: "border-color 0.15s",
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  hint: {
    fontSize: "10px",
    color: "#334155",
  },
  button: {
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    border: "none",
    borderRadius: "8px",
    color: "#fff",
    fontSize: "12px",
    fontWeight: 600,
    padding: "8px 16px",
    cursor: "pointer",
    transition: "opacity 0.15s",
  },
  loadingDots: {
    fontSize: "10px",
    letterSpacing: "2px",
    animation: "blink 1s infinite",
  },
};



// // electron-app/src/renderer/components/ChatInput.tsx

// import React, { useState } from "react";

// interface ChatInputProps {
//   onSubmit: (question: string) => void;
//   isLoading: boolean;
// }

// export const ChatInput: React.FC<ChatInputProps> = ({ onSubmit, isLoading }) => {
//   const [input, setInput] = useState("");

//   const handleSubmit = () => {
//     if (!input.trim() || isLoading) return;
//     onSubmit(input.trim());
//     setInput("");
//   };

//   return (
//     <div style={styles.container}>
//       <textarea
//         style={styles.textarea}
//         placeholder="Ask anything about your screen..."
//         value={input}
//         onChange={(e) => setInput(e.target.value)}
//         disabled={isLoading}
//       />

//       <button
//         style={{
//           ...styles.button,
//           opacity: isLoading ? 0.6 : 1,
//         }}
//         onClick={handleSubmit}
//       >
//         {isLoading ? "Thinking..." : "Ask"}
//       </button>
//     </div>
//   );
// };

// const styles: Record<string, React.CSSProperties> = {
//   container: {
//     display: "flex",
//     flexDirection: "column",
//     gap: "10px",
//     padding: "12px",
//   },
//   textarea: {
//     width: "100%",
//     minHeight: "80px",
//     borderRadius: "10px",
//     border: "1px solid rgba(255,255,255,0.1)",
//     background: "rgba(0,0,0,0.3)",
//     color: "#e2e8f0",
//     padding: "10px",
//     fontSize: "13px",
//     resize: "none",
//     outline: "none",
//   },
//   button: {
//     background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
//     border: "none",
//     borderRadius: "8px",
//     color: "#fff",
//     fontSize: "13px",
//     fontWeight: 600,
//     padding: "8px",
//     cursor: "pointer",
//   },
// };