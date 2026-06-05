// electron-app/src/renderer/components/GuidancePanel.tsx
// Enhanced: shows fullAnswer (the complete fix/response) prominently,
// with code block rendering, collapsible steps, and better layout.

import React, { useState } from "react";
import type { AIResponse, GuidanceStep } from "../../shared/types";

interface Props {
  response: AIResponse;
}

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  action:  { bg: "rgba(99,102,241,0.12)",  text: "#a5b4fc", border: "rgba(99,102,241,0.25)" },
  info:    { bg: "rgba(56,189,248,0.08)",  text: "#7dd3fc", border: "rgba(56,189,248,0.2)"  },
  warning: { bg: "rgba(251,146,60,0.1)",   text: "#fb923c", border: "rgba(251,146,60,0.25)" },
  tip:     { bg: "rgba(34,197,94,0.08)",   text: "#86efac", border: "rgba(34,197,94,0.2)"   },
  code:    { bg: "rgba(15,23,42,0.8)",     text: "#38bdf8", border: "rgba(56,189,248,0.2)"  },
};

const TYPE_ICONS: Record<string, string> = {
  action: "→",
  info: "ℹ",
  warning: "⚠",
  tip: "💡",
  code: "</>",
};

export function GuidancePanel({ response }: Props) {
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [showSteps, setShowSteps] = useState(true);
  const [copied, setCopied] = useState(false);

  const toggleStep = (step: number) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      next.has(step) ? next.delete(step) : next.add(step);
      return next;
    });
  };

  const copyAnswer = () => {
    if (response.fullAnswer) {
      navigator.clipboard.writeText(response.fullAnswer);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div style={styles.container}>
      {/* ── Summary ──────────────────────────────────────────── */}
      <div style={styles.summary}>
        <span style={styles.summaryIcon}>◈</span>
        <p style={styles.summaryText}>{response.summary}</p>
      </div>

      {/* ── Goal badge ───────────────────────────────────────── */}
      {response.intentPrediction && (
        <div style={styles.intentBadge}>
          <span style={styles.intentLabel}>Goal:</span>
          <span style={styles.intentText}>{response.intentPrediction}</span>
          <span style={styles.confidence}>
            {Math.round(response.confidence * 100)}%
          </span>
        </div>
      )}

      {/* ── Full Answer (the important part) ─────────────────── */}
      {response.fullAnswer && (
        <div style={styles.fullAnswerCard}>
          <div style={styles.fullAnswerHeader}>
            <span style={styles.fullAnswerLabel}>◈ Complete Answer</span>
            <button style={styles.copyBtn} onClick={copyAnswer}>
              {copied ? "✓ Copied" : "⎘ Copy"}
            </button>
          </div>
          <div style={styles.fullAnswerBody}>
            <AnswerContent text={response.fullAnswer} />
          </div>
        </div>
      )}

      {/* ── Step-by-step guide ───────────────────────────────── */}
      {response.guidance.length > 0 && (
        <div>
          <button
            style={styles.stepsToggle}
            onClick={() => setShowSteps((v) => !v)}
          >
            {showSteps ? "▾" : "▸"} Steps ({response.guidance.length})
          </button>

          {showSteps && (
            <div style={styles.stepsContainer}>
              {response.guidance.map((step) => (
                <StepCard
                  key={step.step}
                  step={step}
                  completed={completedSteps.has(step.step)}
                  onToggle={() => toggleStep(step.step)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────── */}
      <div style={styles.footer}>
        <span style={styles.footerText}>
          {response.modelUsed} · {response.tokensUsed} tokens
        </span>
        <span style={styles.footerRight}>
          {completedSteps.size}/{response.guidance.length} done
        </span>
      </div>
    </div>
  );
}

// ─── Answer content renderer (handles code blocks) ───────────────────────────

function AnswerContent({ text }: { text: string }) {
  // Split on code fences  ```lang ... ```
  const parts = text.split(/(```[\w]*\n[\s\S]*?```)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const lines = part.split("\n");
          const lang = lines[0].replace("```", "").trim();
          const code = lines.slice(1, -1).join("\n");
          return (
            <pre key={i} style={styles.codeBlock}>
              {lang && <span style={styles.codeLang}>{lang}</span>}
              <code style={styles.codeText}>{code}</code>
            </pre>
          );
        }
        // Inline code: `word`
        const inlineParts = part.split(/(`[^`]+`)/g);
        return (
          <span key={i}>
            {inlineParts.map((ip, j) => {
              if (ip.startsWith("`") && ip.endsWith("`")) {
                return (
                  <code key={j} style={styles.inlineCode}>
                    {ip.slice(1, -1)}
                  </code>
                );
              }
              return <span key={j} style={styles.answerText}>{ip}</span>;
            })}
          </span>
        );
      })}
    </>
  );
}

// ─── Step card ────────────────────────────────────────────────────────────────

function StepCard({
  step,
  completed,
  onToggle,
}: {
  step: GuidanceStep;
  completed: boolean;
  onToggle: () => void;
}) {
  const colors = TYPE_COLORS[step.type] || TYPE_COLORS.info;
  const icon = TYPE_ICONS[step.type] || "→";
  const [showCode, setShowCode] = useState(false);

  return (
    <div
      style={{
        ...styles.stepCard,
        background: completed ? "rgba(255,255,255,0.02)" : colors.bg,
        border: `1px solid ${completed ? "rgba(255,255,255,0.05)" : colors.border}`,
        opacity: completed ? 0.5 : 1,
      }}
    >
      <div style={styles.stepTop} onClick={onToggle}>
        <div
          style={{
            ...styles.stepNumber,
            color: completed ? "#334155" : colors.text,
          }}
        >
          {completed ? "✓" : step.step}
        </div>
        <div style={styles.stepContent}>
          <div style={styles.stepHeader}>
            <span style={{ ...styles.stepTypeIcon, color: colors.text }}>
              {icon}
            </span>
            <span
              style={{
                ...styles.stepTitle,
                textDecoration: completed ? "line-through" : "none",
                color: completed ? "#334155" : "#e2e8f0",
              }}
            >
              {step.title}
            </span>
          </div>
          <p style={styles.stepDesc}>{step.description}</p>
        </div>
      </div>

      {/* Code snippet toggle */}
      {step.codeSnippet && (
        <div style={styles.codeSnippetWrapper}>
          <button
            style={styles.showCodeBtn}
            onClick={() => setShowCode((v) => !v)}
          >
            {showCode ? "▾ Hide code" : "▸ Show code"}
          </button>
          {showCode && (
            <pre style={styles.stepCodeBlock}>
              <code>{step.codeSnippet}</code>
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    overflowY: "auto",
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  summary: {
    display: "flex",
    gap: "8px",
    alignItems: "flex-start",
    padding: "10px 12px",
    background: "rgba(99,102,241,0.07)",
    borderRadius: "10px",
    border: "1px solid rgba(99,102,241,0.15)",
  },
  summaryIcon: {
    color: "#6366f1",
    fontSize: "14px",
    flexShrink: 0,
    marginTop: "1px",
  },
  summaryText: {
    fontSize: "13px",
    color: "#c7d2fe",
    lineHeight: 1.5,
    margin: 0,
  },
  intentBadge: {
    display: "flex",
    gap: "6px",
    alignItems: "center",
    padding: "5px 10px",
    background: "rgba(255,255,255,0.03)",
    borderRadius: "7px",
    border: "1px solid rgba(255,255,255,0.06)",
    flexWrap: "wrap" as const,
  },
  intentLabel: {
    fontSize: "10px",
    color: "#475569",
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  intentText: {
    fontSize: "11px",
    color: "#7dd3fc",
    flex: 1,
  },
  confidence: {
    fontSize: "10px",
    color: "#334155",
  },
  fullAnswerCard: {
    borderRadius: "10px",
    border: "1px solid rgba(99,102,241,0.2)",
    background: "rgba(10,11,18,0.6)",
    overflow: "hidden",
  },
  fullAnswerHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(99,102,241,0.08)",
  },
  fullAnswerLabel: {
    fontSize: "11px",
    fontWeight: 700,
    color: "#818cf8",
    letterSpacing: "0.03em",
  },
  copyBtn: {
    background: "rgba(99,102,241,0.2)",
    border: "1px solid rgba(99,102,241,0.3)",
    borderRadius: "5px",
    color: "#a5b4fc",
    fontSize: "10px",
    fontWeight: 600,
    padding: "3px 8px",
    cursor: "pointer",
  },
  fullAnswerBody: {
    padding: "12px",
    fontSize: "12.5px",
    lineHeight: 1.7,
    color: "#cbd5e1",
    overflowX: "auto",
    overflowY: "auto",
    maxHeight: "400px",
  },
  answerText: {
    color: "#cbd5e1",
    whiteSpace: "pre-wrap" as const,
  },
  codeBlock: {
    background: "rgba(0,0,0,0.5)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "8px",
    padding: "12px",
    margin: "8px 0",
    overflowX: "auto",
    fontSize: "12px",
    lineHeight: 1.6,
  },
  codeLang: {
    display: "block",
    fontSize: "10px",
    color: "#64748b",
    marginBottom: "6px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
  },
  codeText: {
    color: "#38bdf8",
    fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
    fontSize: "12px",
    whiteSpace: "pre" as const,
  },
  inlineCode: {
    background: "rgba(56,189,248,0.1)",
    color: "#38bdf8",
    borderRadius: "4px",
    padding: "1px 5px",
    fontSize: "11.5px",
    fontFamily: "'Cascadia Code', 'Fira Code', monospace",
  },
  stepsToggle: {
    background: "transparent",
    border: "none",
    color: "#475569",
    fontSize: "11px",
    fontWeight: 600,
    cursor: "pointer",
    padding: "4px 0",
    textAlign: "left" as const,
    width: "100%",
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
  },
  stepsContainer: {
    display: "flex",
    flexDirection: "column",
    gap: "5px",
    marginTop: "4px",
  },
  stepCard: {
    borderRadius: "9px",
    transition: "opacity 0.2s",
    overflow: "hidden",
  },
  stepTop: {
    display: "flex",
    gap: "10px",
    padding: "9px 11px",
    cursor: "pointer",
  },
  stepNumber: {
    width: "20px",
    height: "20px",
    fontSize: "11px",
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  stepContent: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "3px",
  },
  stepHeader: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  stepTypeIcon: {
    fontSize: "11px",
    flexShrink: 0,
  },
  stepTitle: {
    fontSize: "12.5px",
    fontWeight: 600,
    lineHeight: 1.3,
  },
  stepDesc: {
    fontSize: "11.5px",
    color: "#94a3b8",
    lineHeight: 1.5,
    paddingLeft: "17px",
    margin: 0,
  },
  codeSnippetWrapper: {
    padding: "0 11px 9px 11px",
  },
  showCodeBtn: {
    background: "transparent",
    border: "none",
    color: "#38bdf8",
    fontSize: "10px",
    fontWeight: 600,
    cursor: "pointer",
    padding: "0",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
  stepCodeBlock: {
    background: "rgba(0,0,0,0.4)",
    border: "1px solid rgba(56,189,248,0.15)",
    borderRadius: "7px",
    padding: "10px",
    marginTop: "6px",
    fontSize: "11px",
    color: "#38bdf8",
    overflowX: "auto",
    fontFamily: "'Cascadia Code', 'Fira Code', monospace",
    lineHeight: 1.5,
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "6px 0 2px 0",
    borderTop: "1px solid rgba(255,255,255,0.05)",
    marginTop: "4px",
  },
  footerText: {
    fontSize: "10px",
    color: "#1e293b",
  },
  footerRight: {
    fontSize: "10px",
    color: "#334155",
  },
};




// // electron-app/src/renderer/components/GuidancePanel.tsx
// // Displays the AI-generated step-by-step guidance

// import React, { useState } from "react";
// import type { AIResponse, GuidanceStep } from "../../shared/types";

// interface Props {
//   response: AIResponse;
// }

// const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
//   action:  { bg: "rgba(99,102,241,0.15)",  text: "#a5b4fc", border: "rgba(99,102,241,0.3)"  },
//   info:    { bg: "rgba(56,189,248,0.1)",   text: "#7dd3fc", border: "rgba(56,189,248,0.25)" },
//   warning: { bg: "rgba(251,146,60,0.12)",  text: "#fb923c", border: "rgba(251,146,60,0.3)"  },
//   tip:     { bg: "rgba(34,197,94,0.1)",    text: "#86efac", border: "rgba(34,197,94,0.25)"  },
// };

// const TYPE_ICONS: Record<string, string> = {
//   action: "→",
//   info: "ℹ",
//   warning: "⚠",
//   tip: "💡",
// };

// export function GuidancePanel({ response }: Props) {
//   const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

//   const toggleStep = (step: number) => {
//     setCompletedSteps((prev) => {
//       const next = new Set(prev);
//       next.has(step) ? next.delete(step) : next.add(step);
//       return next;
//     });
//   };

//   return (
//     <div style={styles.container}>
//       {/* Summary */}
//       <div style={styles.summary}>
//         <span style={styles.summaryIcon}>✦</span>
//         <p style={styles.summaryText}>{response.summary}</p>
//       </div>

//       {/* Intent prediction badge */}
//       {response.intentPrediction && (
//         <div style={styles.intentBadge}>
//           <span style={styles.intentLabel}>Goal detected:</span>
//           <span style={styles.intentText}>{response.intentPrediction}</span>
//         </div>
//       )}

//       {/* Steps */}
//       <div style={styles.stepsContainer}>
//         {response.guidance.map((step) => (
//           <StepCard
//             key={step.step}
//             step={step}
//             completed={completedSteps.has(step.step)}
//             onToggle={() => toggleStep(step.step)}
//           />
//         ))}
//       </div>

//       {/* Footer */}
//       <div style={styles.footer}>
//         <span style={styles.footerText}>
//           via {response.modelUsed} · {response.tokensUsed} tokens
//         </span>
//         <span style={styles.confidence}>
//           {Math.round(response.confidence * 100)}% confidence
//         </span>
//       </div>
//     </div>
//   );
// }

// function StepCard({
//   step,
//   completed,
//   onToggle,
// }: {
//   step: GuidanceStep;
//   completed: boolean;
//   onToggle: () => void;
// }) {
//   const colors = TYPE_COLORS[step.type] || TYPE_COLORS.info;
//   const icon = TYPE_ICONS[step.type] || "→";

//   return (
//     <div
//       style={{
//         ...styles.stepCard,
//         background: completed ? "rgba(255,255,255,0.03)" : colors.bg,
//         border: `1px solid ${completed ? "rgba(255,255,255,0.06)" : colors.border}`,
//         opacity: completed ? 0.5 : 1,
//       }}
//       onClick={onToggle}
//     >
//       <div style={styles.stepLeft}>
//         <div
//           style={{
//             ...styles.stepNumber,
//             color: completed ? "#475569" : colors.text,
//             textDecoration: completed ? "line-through" : "none",
//           }}
//         >
//           {completed ? "✓" : step.step}
//         </div>
//       </div>
//       <div style={styles.stepContent}>
//         <div style={styles.stepHeader}>
//           <span style={{ ...styles.stepType, color: colors.text }}>{icon}</span>
//           <span
//             style={{
//               ...styles.stepTitle,
//               textDecoration: completed ? "line-through" : "none",
//               color: completed ? "#475569" : "#e2e8f0",
//             }}
//           >
//             {step.title}
//           </span>
//         </div>
//         <p style={styles.stepDesc}>{step.description}</p>
//       </div>
//     </div>
//   );
// }

// const styles: Record<string, React.CSSProperties> = {
//   container: {
//     flex: 1,
//     overflowY: "auto",
//     padding: "12px",
//     display: "flex",
//     flexDirection: "column",
//     gap: "10px",
//   },
//   summary: {
//     display: "flex",
//     gap: "8px",
//     alignItems: "flex-start",
//     padding: "10px 12px",
//     background: "rgba(99,102,241,0.08)",
//     borderRadius: "10px",
//     border: "1px solid rgba(99,102,241,0.2)",
//   },
//   summaryIcon: {
//     color: "#818cf8",
//     fontSize: "14px",
//     flexShrink: 0,
//     marginTop: "1px",
//   },
//   summaryText: {
//     fontSize: "13px",
//     color: "#c7d2fe",
//     lineHeight: 1.5,
//   },
//   intentBadge: {
//     display: "flex",
//     gap: "6px",
//     alignItems: "center",
//     padding: "6px 10px",
//     background: "rgba(255,255,255,0.04)",
//     borderRadius: "8px",
//     border: "1px solid rgba(255,255,255,0.07)",
//   },
//   intentLabel: {
//     fontSize: "11px",
//     color: "#64748b",
//     fontWeight: 600,
//     textTransform: "uppercase",
//     letterSpacing: "0.05em",
//   },
//   intentText: {
//     fontSize: "12px",
//     color: "#94a3b8",
//   },
//   stepsContainer: {
//     display: "flex",
//     flexDirection: "column",
//     gap: "6px",
//   },
//   stepCard: {
//     display: "flex",
//     gap: "10px",
//     padding: "10px 12px",
//     borderRadius: "10px",
//     cursor: "pointer",
//     transition: "opacity 0.2s",
//   },
//   stepLeft: {
//     flexShrink: 0,
//     paddingTop: "1px",
//   },
//   stepNumber: {
//     width: "20px",
//     height: "20px",
//     fontSize: "12px",
//     fontWeight: 700,
//     display: "flex",
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   stepContent: {
//     flex: 1,
//     display: "flex",
//     flexDirection: "column",
//     gap: "3px",
//   },
//   stepHeader: {
//     display: "flex",
//     alignItems: "center",
//     gap: "6px",
//   },
//   stepType: {
//     fontSize: "12px",
//     flexShrink: 0,
//   },
//   stepTitle: {
//     fontSize: "13px",
//     fontWeight: 600,
//     lineHeight: 1.3,
//   },
//   stepDesc: {
//     fontSize: "12px",
//     color: "#94a3b8",
//     lineHeight: 1.5,
//     paddingLeft: "18px",
//   },
//   footer: {
//     display: "flex",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: "6px 0",
//     borderTop: "1px solid rgba(255,255,255,0.06)",
//     marginTop: "4px",
//   },
//   footerText: {
//     fontSize: "10px",
//     color: "#334155",
//   },
//   confidence: {
//     fontSize: "10px",
//     color: "#334155",
//   },
// };