// electron-app/src/main/smartTrigger.ts
// Fixes:
//  1. Raised INACTIVITY_THRESHOLD_MS to 120s (was 30s) — with Gemma taking
//     22–39s per call, 30s meant every cold-start triggered a re-fire before
//     the previous one resolved, flooding the backend.
//  2. Added TRIGGER_COOLDOWN_MS (90s): after any trigger fires, the watcher
//     won't fire again for at least 90s regardless of the idle timer. This
//     prevents the "already in progress" cascade when network is slow.
//  3. lastActivityTime is now reset after every trigger so the inactivity
//     clock restarts from the moment we kicked off the capture, not from when
//     the user last moved the mouse.
//  4. Repeated-click threshold kept at 4 clicks / 4s but added its own
//     cooldown so a stuck UI doesn't hammer the backend every 4 clicks.

import { BrowserWindow, ipcMain } from "electron";
import { captureManager } from "./captureManager";
import type { SmartTriggerEvent } from "../shared/types";

interface ClickRecord {
  x: number;
  y: number;
  timestamp: number;
}

// ── Tuned constants ────────────────────────────────────────────────────────────
// Inactivity: wait 2 minutes of true silence before auto-triggering.
const INACTIVITY_THRESHOLD_MS = 120_000;
// After any trigger (click-storm or inactivity), don't fire again for 90s.
// Gemma p99 latency observed at ~40s; 90s gives breathing room.
const TRIGGER_COOLDOWN_MS = 90_000;
// How often the inactivity watcher ticks (keep at 10s — low CPU cost).
const INACTIVITY_POLL_MS = 10_000;

const REPEATED_CLICK_THRESHOLD = 4;
const REPEATED_CLICK_WINDOW_MS = 4_000;
const ZONE_RADIUS_PX = 80;

class SmartTriggerManager {
  private clickHistory: ClickRecord[] = [];
  private lastActivityTime = Date.now();
  private lastTriggerTime = 0; // timestamp of last fired trigger
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

  private inCooldown(): boolean {
    return Date.now() - this.lastTriggerTime < TRIGGER_COOLDOWN_MS;
  }

  private recordClick(x: number, y: number) {
    const now = Date.now();
    this.lastActivityTime = now;
    this.clickHistory.push({ x, y, timestamp: now });

    // Evict clicks outside the detection window
    this.clickHistory = this.clickHistory.filter(
      (c) => now - c.timestamp < REPEATED_CLICK_WINDOW_MS
    );

    if (this.inCooldown()) return; // don't pile on if we just triggered

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
      if (this.inCooldown()) return; // already triggered recently, wait

      const idle = Date.now() - this.lastActivityTime;
      if (idle > INACTIVITY_THRESHOLD_MS) {
        this.trigger({
          type: "long_inactivity",
          details: `No activity for ${Math.round(idle / 1000)}s`,
          timestamp: Date.now(),
        });
        // Reset activity clock so we don't re-fire immediately after cooldown
        this.lastActivityTime = Date.now();
      }
    }, INACTIVITY_POLL_MS);
  }

  private trigger(event: SmartTriggerEvent) {
    if (!this.enabled || !this.window) return;

    // Double-check cooldown (click path and inactivity path both funnel here)
    if (this.inCooldown()) {
      console.log(`[SmartTrigger] Suppressed ${event.type} — in cooldown.`);
      return;
    }

    console.log(`[SmartTrigger] ${event.type} — ${event.details}`);
    this.lastTriggerTime = Date.now();

    this.window.webContents.send("smart-trigger", event);
    captureManager.captureNow(this.window);
    if (!this.window.isVisible()) this.window.show();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  destroy() {
    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }
}

export const smartTrigger = new SmartTriggerManager();





// // electron-app/src/main/smartTrigger.ts
// // Detects patterns that suggest the user needs help:
// //   1. Repeated clicks in same region (user is confused)
// //   2. Long inactivity after an error screen

// import { BrowserWindow, ipcMain } from "electron";
// import { captureManager } from "./captureManager";
// // Use @shared alias (resolved by webpack + tsconfig paths)
// import type { SmartTriggerEvent } from "../shared/types";

// interface ClickRecord {
//   x: number;
//   y: number;
//   timestamp: number;
// }

// const REPEATED_CLICK_THRESHOLD = 4;
// const REPEATED_CLICK_WINDOW_MS = 4000;
// const INACTIVITY_THRESHOLD_MS  = 30000;
// const ZONE_RADIUS_PX            = 80;

// class SmartTriggerManager {
//   private clickHistory: ClickRecord[] = [];
//   private lastActivityTime = Date.now();
//   private inactivityTimer: NodeJS.Timeout | null = null;
//   private window: BrowserWindow | null = null;
//   private enabled = true;

//   init(win: BrowserWindow) {
//     this.window = win;
//     this.startInactivityWatcher();

//     ipcMain.on("mouse-click", (_, { x, y }: { x: number; y: number }) => {
//       this.recordClick(x, y);
//     });

//     ipcMain.on("user-activity", () => {
//       this.lastActivityTime = Date.now();
//     });
//   }

//   private recordClick(x: number, y: number) {
//     const now = Date.now();
//     this.lastActivityTime = now;
//     this.clickHistory.push({ x, y, timestamp: now });

//     // Evict clicks outside the detection window
//     this.clickHistory = this.clickHistory.filter(
//       (c) => now - c.timestamp < REPEATED_CLICK_WINDOW_MS
//     );

//     const recent = this.clickHistory.slice(-REPEATED_CLICK_THRESHOLD);
//     if (recent.length >= REPEATED_CLICK_THRESHOLD) {
//       const allInZone = recent.every(
//         (c) => Math.abs(c.x - x) < ZONE_RADIUS_PX && Math.abs(c.y - y) < ZONE_RADIUS_PX
//       );
//       if (allInZone) {
//         this.trigger({
//           type: "repeated_clicks",
//           details: `${REPEATED_CLICK_THRESHOLD} clicks near (${x}, ${y})`,
//           timestamp: now,
//         });
//         this.clickHistory = [];
//       }
//     }
//   }

//   private startInactivityWatcher() {
//     this.inactivityTimer = setInterval(() => {
//       if (!this.enabled) return;
//       const idle = Date.now() - this.lastActivityTime;
//       if (idle > INACTIVITY_THRESHOLD_MS) {
//         this.trigger({
//           type: "long_inactivity",
//           details: `No activity for ${Math.round(idle / 1000)}s`,
//           timestamp: Date.now(),
//         });
//         this.lastActivityTime = Date.now(); // prevent immediate re-fire
//       }
//     }, 10_000);
//   }

//   private trigger(event: SmartTriggerEvent) {
//     if (!this.enabled || !this.window) return;
//     console.log(`[SmartTrigger] ${event.type} — ${event.details}`);
//     this.window.webContents.send("smart-trigger", event);
//     captureManager.captureNow(this.window);
//     if (!this.window.isVisible()) this.window.show();
//   }

//   setEnabled(enabled: boolean) { this.enabled = enabled; }

//   destroy() {
//     if (this.inactivityTimer) {
//       clearInterval(this.inactivityTimer);
//       this.inactivityTimer = null;
//     }
//   }
// }

// export const smartTrigger = new SmartTriggerManager();