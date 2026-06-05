// electron-app/src/main/smartTrigger.ts
// Detects patterns that suggest the user needs help:
//   1. Repeated clicks in same region (user is confused)
//   2. Long inactivity after an error screen

import { BrowserWindow, ipcMain } from "electron";
import { captureManager } from "./captureManager";
// Use @shared alias (resolved by webpack + tsconfig paths)
import type { SmartTriggerEvent } from "../shared/types";

interface ClickRecord {
  x: number;
  y: number;
  timestamp: number;
}

const REPEATED_CLICK_THRESHOLD = 4;
const REPEATED_CLICK_WINDOW_MS = 4000;
const INACTIVITY_THRESHOLD_MS  = 30000;
const ZONE_RADIUS_PX            = 80;

class SmartTriggerManager {
  private clickHistory: ClickRecord[] = [];
  private lastActivityTime = Date.now();
  private inactivityTimer: NodeJS.Timeout | null = null;
  private window: BrowserWindow | null = null;
  private enabled = true;

  init(win: BrowserWindow) {
    this.window = win;
    this.startInactivityWatcher();

    ipcMain.on("mouse-click", (_, { x, y }: { x: number; y: number }) => {
      this.recordClick(x, y);
    });

    ipcMain.on("user-activity", () => {
      this.lastActivityTime = Date.now();
    });
  }

  private recordClick(x: number, y: number) {
    const now = Date.now();
    this.lastActivityTime = now;
    this.clickHistory.push({ x, y, timestamp: now });

    // Evict clicks outside the detection window
    this.clickHistory = this.clickHistory.filter(
      (c) => now - c.timestamp < REPEATED_CLICK_WINDOW_MS
    );

    const recent = this.clickHistory.slice(-REPEATED_CLICK_THRESHOLD);
    if (recent.length >= REPEATED_CLICK_THRESHOLD) {
      const allInZone = recent.every(
        (c) => Math.abs(c.x - x) < ZONE_RADIUS_PX && Math.abs(c.y - y) < ZONE_RADIUS_PX
      );
      if (allInZone) {
        this.trigger({
          type: "repeated_clicks",
          details: `${REPEATED_CLICK_THRESHOLD} clicks near (${x}, ${y})`,
          timestamp: now,
        });
        this.clickHistory = [];
      }
    }
  }

  private startInactivityWatcher() {
    this.inactivityTimer = setInterval(() => {
      if (!this.enabled) return;
      const idle = Date.now() - this.lastActivityTime;
      if (idle > INACTIVITY_THRESHOLD_MS) {
        this.trigger({
          type: "long_inactivity",
          details: `No activity for ${Math.round(idle / 1000)}s`,
          timestamp: Date.now(),
        });
        this.lastActivityTime = Date.now(); // prevent immediate re-fire
      }
    }, 10_000);
  }

  private trigger(event: SmartTriggerEvent) {
    if (!this.enabled || !this.window) return;
    console.log(`[SmartTrigger] ${event.type} — ${event.details}`);
    this.window.webContents.send("smart-trigger", event);
    captureManager.captureNow(this.window);
    if (!this.window.isVisible()) this.window.show();
  }

  setEnabled(enabled: boolean) { this.enabled = enabled; }

  destroy() {
    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }
}

export const smartTrigger = new SmartTriggerManager();