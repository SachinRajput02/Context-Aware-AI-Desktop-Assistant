// electron-app/src/renderer/components/SettingsPanel.tsx
// Redesigned settings: session control, capture interval, user level, privacy.

import React, { useState } from "react";

interface Props {
  captureIntervalSec: number;
  onIntervalChange: (sec: number) => void;
  onClose: () => void;
  onStopSession: () => void;
  onNewSession: () => void;
  sessionId: string;
}

type UserLevel = "beginner" | "intermediate" | "expert";

interface Settings {
  privacyMode: boolean;
  userLevel: UserLevel;
  smartTriggerEnabled: boolean;
  voiceLanguage: string;
}

const DEFAULT_SETTINGS: Settings = {
  privacyMode: true,
  userLevel: "intermediate",
  smartTriggerEnabled: true,
  voiceLanguage: "en-US",
};

export function SettingsPanel({
  captureIntervalSec,
  onIntervalChange,
  onClose,
  onStopSession,
  onNewSession,
  sessionId,
}: Props) {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const saved = localStorage.getItem("ai-assistant-settings");
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);

  const update = (key: keyof Settings, value: any) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem("ai-assistant-settings", JSON.stringify(next));
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>Settings</span>
        <button style={styles.closeBtn} onClick={onClose}>✕</button>
      </div>

      <div style={styles.body}>
        {/* Session info + control */}
        <Section label="Session">
          <InfoRow label="Session ID" value={sessionId.slice(0, 18) + "..."} />
          <div style={styles.sessionBtns}>
            {!confirmNew ? (
              <button
                style={styles.dangerBtn}
                onClick={() => setConfirmNew(true)}
              >
                ▶ New Session
              </button>
            ) : (
              <div style={styles.confirmRow}>
                <span style={styles.confirmText}>Start new? History will be cleared.</span>
                <button
                  style={{ ...styles.dangerBtn, background: "#10b981" }}
                  onClick={() => {
                    setConfirmNew(false);
                    onNewSession();
                  }}
                >
                  Yes
                </button>
                <button
                  style={styles.cancelBtn}
                  onClick={() => setConfirmNew(false)}
                >
                  No
                </button>
              </div>
            )}

            {!confirmStop ? (
              <button
                style={{ ...styles.dangerBtn, background: "rgba(239,68,68,0.15)", color: "#ef4444", borderColor: "rgba(239,68,68,0.3)" }}
                onClick={() => setConfirmStop(true)}
              >
                ⏹ Stop Session
              </button>
            ) : (
              <div style={styles.confirmRow}>
                <span style={styles.confirmText}>Stop session?</span>
                <button
                  style={{ ...styles.dangerBtn, background: "#ef4444", color: "#fff" }}
                  onClick={() => {
                    setConfirmStop(false);
                    onStopSession();
                  }}
                >
                  Stop
                </button>
                <button
                  style={styles.cancelBtn}
                  onClick={() => setConfirmStop(false)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </Section>

        {/* Screen analysis */}
        <Section label="Screen Analysis">
          <SliderRow
            label="Auto-capture interval"
            hint={`Every ${captureIntervalSec}s`}
            value={captureIntervalSec}
            min={5}
            max={60}
            step={5}
            onChange={onIntervalChange}
          />
          <ToggleRow
            label="Smart trigger"
            hint="Auto-activate when you seem stuck"
            value={settings.smartTriggerEnabled}
            onChange={(v) => update("smartTriggerEnabled", v)}
          />
        </Section>

        {/* Privacy */}
        <Section label="Privacy">
          <ToggleRow
            label="Privacy mode"
            hint="Redact passwords, card numbers, SSNs"
            value={settings.privacyMode}
            onChange={(v) => update("privacyMode", v)}
          />
        </Section>

        {/* Voice */}
        <Section label="Voice Input">
          <div style={styles.row}>
            <div>
              <p style={styles.rowLabel}>Language</p>
              <p style={styles.rowHint}>Recognition language</p>
            </div>
            <select
              style={styles.select}
              value={settings.voiceLanguage}
              onChange={(e) => update("voiceLanguage", e.target.value)}
            >
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="hi-IN">Hindi</option>
              <option value="es-ES">Spanish</option>
              <option value="fr-FR">French</option>
              <option value="de-DE">German</option>
              <option value="ja-JP">Japanese</option>
              <option value="zh-CN">Chinese (Simplified)</option>
            </select>
          </div>
        </Section>

        {/* AI behavior */}
        <Section label="AI Behavior">
          <div style={styles.row}>
            <div>
              <p style={styles.rowLabel}>Skill level</p>
              <p style={styles.rowHint}>Adjusts explanation detail</p>
            </div>
            <select
              style={styles.select}
              value={settings.userLevel}
              onChange={(e) => update("userLevel", e.target.value as UserLevel)}
            >
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="expert">Expert</option>
            </select>
          </div>
        </Section>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={styles.section}>
      <p style={styles.sectionLabel}>{label}</p>
      <div style={styles.sectionBody}>{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.row}>
      <p style={styles.rowLabel}>{label}</p>
      <p style={{ ...styles.rowHint, fontFamily: "monospace", color: "#6366f1" }}>
        {value}
      </p>
    </div>
  );
}

function ToggleRow({
  label, hint, value, onChange,
}: {
  label: string; hint: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div style={styles.row}>
      <div>
        <p style={styles.rowLabel}>{label}</p>
        <p style={styles.rowHint}>{hint}</p>
      </div>
      <button
        style={{
          ...styles.toggle,
          background: value ? "#6366f1" : "rgba(255,255,255,0.08)",
        }}
        onClick={() => onChange(!value)}
      >
        <span
          style={{
            ...styles.toggleThumb,
            transform: value ? "translateX(16px)" : "translateX(2px)",
          }}
        />
      </button>
    </div>
  );
}

function SliderRow({
  label, hint, value, min, max, step, onChange, disabled,
}: {
  label: string; hint: string; value: number; min: number; max: number;
  step: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div style={{ ...styles.row, opacity: disabled ? 0.4 : 1 }}>
      <div>
        <p style={styles.rowLabel}>{label}</p>
        <p style={styles.rowHint}>{hint}</p>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "80px", accentColor: "#6366f1" }}
      />
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    flexShrink: 0,
  },
  title: {
    fontSize: "13px",
    fontWeight: 700,
    color: "#e2e8f0",
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "#64748b",
    fontSize: "14px",
    cursor: "pointer",
    padding: "2px 6px",
    borderRadius: "4px",
  },
  body: {
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    overflowY: "auto",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "5px",
  },
  sectionLabel: {
    fontSize: "10px",
    fontWeight: 700,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    paddingBottom: "2px",
    margin: 0,
  },
  sectionBody: {
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: "10px",
    overflow: "hidden",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "9px 13px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
  },
  rowLabel: {
    fontSize: "12px",
    color: "#e2e8f0",
    fontWeight: 500,
    margin: 0,
  },
  rowHint: {
    fontSize: "11px",
    color: "#475569",
    marginTop: "2px",
    margin: 0,
  },
  sessionBtns: {
    display: "flex",
    gap: "6px",
    padding: "9px 13px",
    flexWrap: "wrap" as const,
  },
  dangerBtn: {
    background: "rgba(99,102,241,0.15)",
    border: "1px solid rgba(99,102,241,0.3)",
    borderRadius: "7px",
    color: "#818cf8",
    fontSize: "11px",
    fontWeight: 600,
    padding: "6px 12px",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  cancelBtn: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "7px",
    color: "#94a3b8",
    fontSize: "11px",
    fontWeight: 600,
    padding: "6px 10px",
    cursor: "pointer",
  },
  confirmRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap" as const,
  },
  confirmText: {
    fontSize: "11px",
    color: "#94a3b8",
  },
  toggle: {
    width: "36px",
    height: "20px",
    borderRadius: "10px",
    border: "none",
    cursor: "pointer",
    position: "relative",
    transition: "background 0.2s",
    flexShrink: 0,
  },
  toggleThumb: {
    position: "absolute",
    top: "2px",
    width: "16px",
    height: "16px",
    borderRadius: "50%",
    background: "#fff",
    transition: "transform 0.2s",
    display: "block",
  },
  select: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "6px",
    color: "#e2e8f0",
    fontSize: "11px",
    padding: "4px 8px",
    cursor: "pointer",
    outline: "none",
  },
};




// // electron-app/src/renderer/components/SettingsPanel.tsx
// // User settings: auto-capture interval, voice, privacy mode, model choice

// import React, { useState, useEffect } from "react";

// interface Settings {
//   autoCaptureEnabled: boolean;
//   captureIntervalSec: number;
//   voiceEnabled: boolean;
//   privacyMode: boolean;
//   smartTriggerEnabled: boolean;
//   userLevel: "beginner" | "intermediate" | "expert";
// }

// const DEFAULT_SETTINGS: Settings = {
//   autoCaptureEnabled: true,
//   captureIntervalSec: 5,
//   voiceEnabled: false,
//   privacyMode: true,
//   smartTriggerEnabled: true,
//   userLevel: "intermediate",
// };

// interface Props {
//   onClose: () => void;
//   onSettingsChange: (settings: Settings) => void;
// }

// export function SettingsPanel({ onClose, onSettingsChange }: Props) {
//   const [settings, setSettings] = useState<Settings>(() => {
//     try {
//       const saved = localStorage.getItem("ai-assistant-settings");
//       return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
//     } catch {
//       return DEFAULT_SETTINGS;
//     }
//   });

//   const update = (key: keyof Settings, value: any) => {
//     const next = { ...settings, [key]: value };
//     setSettings(next);
//     localStorage.setItem("ai-assistant-settings", JSON.stringify(next));
//     onSettingsChange(next);

//     // Apply immediately
//     if (key === "autoCaptureEnabled" || key === "captureIntervalSec") {
//       window.electronAPI.toggleAutoCapture(
//         next.autoCaptureEnabled,
//         next.captureIntervalSec * 1000
//       );
//     }
//   };

//   return (
//     <div style={styles.container}>
//       <div style={styles.header}>
//         <span style={styles.title}>Settings</span>
//         <button style={styles.closeBtn} onClick={onClose}>✕</button>
//       </div>

//       <div style={styles.body}>
//         {/* Auto Capture */}
//         <Section label="Screen Analysis">
//           <ToggleRow
//             label="Auto-capture"
//             hint="Analyze screen automatically"
//             value={settings.autoCaptureEnabled}
//             onChange={(v) => update("autoCaptureEnabled", v)}
//           />
//           <SliderRow
//             label="Interval"
//             hint={`Every ${settings.captureIntervalSec}s`}
//             value={settings.captureIntervalSec}
//             min={3}
//             max={30}
//             step={1}
//             onChange={(v) => update("captureIntervalSec", v)}
//             disabled={!settings.autoCaptureEnabled}
//           />
//           <ToggleRow
//             label="Smart trigger"
//             hint="Auto-activate when you seem stuck"
//             value={settings.smartTriggerEnabled}
//             onChange={(v) => update("smartTriggerEnabled", v)}
//           />
//         </Section>

//         {/* Voice */}
//         <Section label="Voice">
//           <ToggleRow
//             label="Voice output"
//             hint="Read guidance aloud"
//             value={settings.voiceEnabled}
//             onChange={(v) => update("voiceEnabled", v)}
//           />
//         </Section>

//         {/* Privacy */}
//         <Section label="Privacy">
//           <ToggleRow
//             label="Privacy mode"
//             hint="Redact passwords & card numbers"
//             value={settings.privacyMode}
//             onChange={(v) => update("privacyMode", v)}
//           />
//         </Section>

//         {/* User Level */}
//         <Section label="AI Behavior">
//           <div style={styles.row}>
//             <div>
//               <p style={styles.rowLabel}>Skill level</p>
//               <p style={styles.rowHint}>Adjusts explanation detail</p>
//             </div>
//             <select
//               style={styles.select}
//               value={settings.userLevel}
//               onChange={(e) => update("userLevel", e.target.value as any)}
//             >
//               <option value="beginner">Beginner</option>
//               <option value="intermediate">Intermediate</option>
//               <option value="expert">Expert</option>
//             </select>
//           </div>
//         </Section>
//       </div>
//     </div>
//   );
// }

// // ─── Sub-components ───────────────────────────────────────────────────────────

// function Section({ label, children }: { label: string; children: React.ReactNode }) {
//   return (
//     <div style={styles.section}>
//       <p style={styles.sectionLabel}>{label}</p>
//       <div style={styles.sectionBody}>{children}</div>
//     </div>
//   );
// }

// function ToggleRow({
//   label, hint, value, onChange,
// }: {
//   label: string; hint: string; value: boolean; onChange: (v: boolean) => void;
// }) {
//   return (
//     <div style={styles.row}>
//       <div>
//         <p style={styles.rowLabel}>{label}</p>
//         <p style={styles.rowHint}>{hint}</p>
//       </div>
//       <button
//         style={{
//           ...styles.toggle,
//           background: value ? "#6366f1" : "rgba(255,255,255,0.1)",
//         }}
//         onClick={() => onChange(!value)}
//       >
//         <span
//           style={{
//             ...styles.toggleThumb,
//             transform: value ? "translateX(16px)" : "translateX(2px)",
//           }}
//         />
//       </button>
//     </div>
//   );
// }

// function SliderRow({
//   label, hint, value, min, max, step, onChange, disabled,
// }: {
//   label: string; hint: string; value: number; min: number; max: number;
//   step: number; onChange: (v: number) => void; disabled?: boolean;
// }) {
//   return (
//     <div style={{ ...styles.row, opacity: disabled ? 0.4 : 1 }}>
//       <div>
//         <p style={styles.rowLabel}>{label}</p>
//         <p style={styles.rowHint}>{hint}</p>
//       </div>
//       <input
//         type="range"
//         min={min}
//         max={max}
//         step={step}
//         value={value}
//         disabled={disabled}
//         onChange={(e) => onChange(Number(e.target.value))}
//         style={{ width: "80px", accentColor: "#6366f1" }}
//       />
//     </div>
//   );
// }

// // ─── Styles ───────────────────────────────────────────────────────────────────

// const styles: Record<string, React.CSSProperties> = {
//   container: {
//     flex: 1,
//     display: "flex",
//     flexDirection: "column",
//     overflowY: "auto",
//   },
//   header: {
//     display: "flex",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: "12px 16px",
//     borderBottom: "1px solid rgba(255,255,255,0.07)",
//     flexShrink: 0,
//   },
//   title: {
//     fontSize: "13px",
//     fontWeight: 600,
//     color: "#e2e8f0",
//   },
//   closeBtn: {
//     background: "transparent",
//     border: "none",
//     color: "#64748b",
//     fontSize: "14px",
//     cursor: "pointer",
//     padding: "2px 6px",
//     borderRadius: "4px",
//   },
//   body: {
//     padding: "12px",
//     display: "flex",
//     flexDirection: "column",
//     gap: "16px",
//     overflowY: "auto",
//   },
//   section: {
//     display: "flex",
//     flexDirection: "column",
//     gap: "6px",
//   },
//   sectionLabel: {
//     fontSize: "10px",
//     fontWeight: 600,
//     color: "#475569",
//     textTransform: "uppercase",
//     letterSpacing: "0.08em",
//     paddingBottom: "4px",
//   },
//   sectionBody: {
//     background: "rgba(255,255,255,0.03)",
//     border: "1px solid rgba(255,255,255,0.07)",
//     borderRadius: "10px",
//     overflow: "hidden",
//   },
//   row: {
//     display: "flex",
//     justifyContent: "space-between",
//     alignItems: "center",
//     padding: "10px 14px",
//     borderBottom: "1px solid rgba(255,255,255,0.05)",
//   },
//   rowLabel: {
//     fontSize: "12px",
//     color: "#e2e8f0",
//     fontWeight: 500,
//   },
//   rowHint: {
//     fontSize: "11px",
//     color: "#475569",
//     marginTop: "2px",
//   },
//   toggle: {
//     width: "36px",
//     height: "20px",
//     borderRadius: "10px",
//     border: "none",
//     cursor: "pointer",
//     position: "relative",
//     transition: "background 0.2s",
//     flexShrink: 0,
//   },
//   toggleThumb: {
//     position: "absolute",
//     top: "2px",
//     width: "16px",
//     height: "16px",
//     borderRadius: "50%",
//     background: "#fff",
//     transition: "transform 0.2s",
//     display: "block",
//   },
//   select: {
//     background: "rgba(255,255,255,0.08)",
//     border: "1px solid rgba(255,255,255,0.12)",
//     borderRadius: "6px",
//     color: "#e2e8f0",
//     fontSize: "12px",
//     padding: "4px 8px",
//     cursor: "pointer",
//     outline: "none",
//   },
// };