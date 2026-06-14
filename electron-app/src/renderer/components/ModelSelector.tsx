// electron-app/src/renderer/components/ModelSelector.tsx

import React, { useEffect, useRef, useState } from "react";
import { MODEL_OPTIONS } from "../config/models";

interface Props {
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}

export function ModelSelector({
  value,
  onChange,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selected =
    MODEL_OPTIONS.find((m) => m.id === value) ?? MODEL_OPTIONS[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      style={{
        ...styles.container,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        style={styles.trigger}
        title="Model used for analysis"
      >
        <span>{selected.label}</span>
        <span
          style={{
            ...styles.arrow,
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          ▼
        </span>
      </button>

      {open && !disabled && (
        <div style={styles.menu}>
          {MODEL_OPTIONS.map((model) => {
            const isSelected = model.id === value;

            return (
              <button
                key={model.id}
                type="button"
                onClick={() => {
                  onChange(model.id);
                  setOpen(false);
                }}
                style={{
                  ...styles.option,
                  ...(isSelected ? styles.optionSelected : {}),
                }}
              >
                {model.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type StyleWithDrag = React.CSSProperties & {
  WebkitAppRegion?: string;
};

const styles: Record<string, StyleWithDrag> = {
  container: {
    position: "relative",
    WebkitAppRegion: "no-drag",
  },

  trigger: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",

    minWidth: "150px",
    height: "25px",

    padding: "0 10px",

    background: "rgba(15,23,42,0.9)",
    border: "1px solid rgba(99,102,241,0.25)",
    borderRadius: "8px",

    color: "#e2e8f0",
    fontSize: "12px",
    fontWeight: 600,

    cursor: "pointer",

    backdropFilter: "blur(12px)",

    transition: "all 0.2s ease",
  },

  arrow: {
    fontSize: "10px",
    color: "#94a3b8",
    transition: "transform 0.2s ease",
  },

  menu: {
    position: "absolute",
    top: "34px",
    right: 0,

    width: "190px",

    background: "rgba(15,23,42,0.98)",

    border: "1px solid rgba(99,102,241,0.2)",

    borderRadius: "10px",

    backdropFilter: "blur(20px)",

    boxShadow: "0 12px 40px rgba(0,0,0,0.45)",

    overflow: "hidden",

    zIndex: 9999,
  },

  option: {
    width: "100%",

    padding: "5px 8px",

    background: "transparent",

    border: "none",

    textAlign: "left",

    color: "#cbd5e1",

    fontSize: "12px",

    fontWeight: 400,

    cursor: "pointer",

    transition: "all 0.15s ease",
  },

  optionSelected: {
    background: "rgba(99,102,241,0.2)",
    color: "#a5b4fc",
    fontWeight: 600,
  },
};