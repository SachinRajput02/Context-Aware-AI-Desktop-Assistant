// // backend/src/services/ocrService.ts
// // OCR with screenshot differencing — skips OCR + Gemini when screen hasn't changed.

// import Tesseract, { createWorker } from "tesseract.js";
// import { createHash } from "crypto";
// import { logger } from "../utils/logger";

// let worker: Tesseract.Worker | null = null;
// let workerInitialising = false;

// // ─── Screenshot diff state ────────────────────────────────────────────────────
// // Stored per-session: hash of last screenshot + last OCR result
// const screenshotCache = new Map<string, { hash: string; ocrText: string }>();

// /**
//  * Compare two base64 images by a fast pixel-sample diff.
//  * Takes 64 evenly-spaced bytes from each buffer — cheap enough to run every tick.
//  * Returns a similarity score 0.0–1.0 (1.0 = identical).
//  */
// function quickImageSimilarity(a: string, b: string): number {
//   if (a === b) return 1.0;
//   // Use length difference as a first cheap check
//   if (Math.abs(a.length - b.length) / Math.max(a.length, b.length) > 0.05) {
//     return 0.0;
//   }
//   // Sample 64 chars spread across the string
//   const step = Math.floor(a.length / 64);
//   let matches = 0;
//   for (let i = 0; i < 64; i++) {
//     if (a[i * step] === b[i * step]) matches++;
//   }
//   return matches / 64;
// }

// function hashImage(imageBase64: string): string {
//   // Hash first 4KB — fast, catches most changes
//   return createHash("md5").update(imageBase64.slice(0, 4096)).digest("hex");
// }

// async function getWorker(): Promise<Tesseract.Worker> {
//   if (worker) return worker;
//   if (workerInitialising) {
//     await new Promise((r) => setTimeout(r, 600));
//     return getWorker();
//   }
//   workerInitialising = true;
//   try {
//     worker = await createWorker("eng", 1, { logger: () => {} });
//     logger.info("[ocrService] Tesseract worker ready");
//   } finally {
//     workerInitialising = false;
//   }
//   return worker!;
// }

// getWorker().catch((e) => logger.warn("[ocrService] Worker pre-warm failed:", e.message));

// export const ocrService = {
//   /**
//    * Extract text from a base64 screenshot.
//    * Skips OCR entirely if the screen hasn't meaningfully changed since last call.
//    * Pass sessionId to enable per-session caching (pass "global" for single-user).
//    */
//   async extractText(imageBase64: string, sessionId = "global"): Promise<{
//     text: string;
//     skipped: boolean; // true = returned cached result, OCR was not run
//   }> {
//     const newHash = hashImage(imageBase64);
//     const cached = screenshotCache.get(sessionId);

//     // Fast hash check first
//     if (cached && cached.hash === newHash) {
//       logger.debug("[ocrService] Identical screenshot hash — skipping OCR");
//       return { text: cached.ocrText, skipped: true };
//     }

//     // Similarity check for near-identical screenshots (e.g. cursor blink)
//     if (cached) {
//       const similarity = quickImageSimilarity(imageBase64, cached.hash);
//       if (similarity > 0.97) {
//         logger.debug(`[ocrService] Screenshot similarity ${(similarity * 100).toFixed(1)}% — skipping OCR`);
//         return { text: cached.ocrText, skipped: true };
//       }
//     }

//     // Run OCR
//     try {
//       const w = await getWorker();
//       const buffer = Buffer.from(imageBase64, "base64");
//       const { data } = await w.recognize(buffer);
//       const text = data.text.trim().slice(0, 3000);

//       // Cache result for this session
//       screenshotCache.set(sessionId, { hash: newHash, ocrText: text });

//       return { text, skipped: false };
//     } catch (err: any) {
//       logger.error("[ocrService] extractText error:", err.message);
//       return { text: "", skipped: false };
//     }
//   },

//   /**
//    * Check if this screenshot is similar enough to the last one to skip ALL processing.
//    * Use this BEFORE OCR and before calling Gemini.
//    */
//   isScreenUnchanged(imageBase64: string, sessionId = "global"): boolean {
//     const cached = screenshotCache.get(sessionId);
//     if (!cached) return false;

//     if (hashImage(imageBase64) === cached.hash) return true;

//     const similarity = quickImageSimilarity(imageBase64, cached.hash);
//     return similarity > 0.97;
//   },

//   /**
//    * Compare OCR text similarity to decide if Gemini call is worth making.
//    * Call after OCR — if text barely changed, skip the LLM round-trip.
//    */
//   isOcrTextUnchanged(newText: string, sessionId = "global", threshold = 0.9): boolean {
//     const cached = screenshotCache.get(sessionId);
//     if (!cached || !cached.ocrText || !newText) return false;

//     // Jaccard similarity on word sets — fast and good enough for UI text
//     const setA = new Set(cached.ocrText.split(/\s+/));
//     const setB = new Set(newText.split(/\s+/));
//     const intersection = [...setA].filter((w) => setB.has(w)).length;
//     const union = new Set([...setA, ...setB]).size;
//     const similarity = union === 0 ? 1 : intersection / union;

//     if (similarity > threshold) {
//       logger.debug(`[ocrService] OCR text similarity ${(similarity * 100).toFixed(1)}% > ${threshold * 100}% — skip Gemini`);
//       return true;
//     }
//     return false;
//   },

//   async hasText(imageBase64: string): Promise<boolean> {
//     const { text } = await ocrService.extractText(imageBase64);
//     return text.length > 20;
//   },

//   clearSession(sessionId: string): void {
//     screenshotCache.delete(sessionId);
//   },

//   async terminate(): Promise<void> {
//     if (worker) {
//       await worker.terminate();
//       worker = null;
//       logger.info("[ocrService] Tesseract worker terminated");
//     }
//   },
// };




// backend/src/services/ocrService.ts
// OCR SHIFTED HERE — now the primary OCR path (not just a fallback).
// Runs Tesseract.js on the server, accepting a base64-encoded JPEG.
//
// Why Tesseract on the server and not a cloud OCR API?
//   - Zero extra cost (no Google Vision / AWS Textract billing)
//   - Good enough for UI text extraction
//   - Easy swap: replace createWorker with a cloud call if accuracy needs upgrading

import Tesseract, { createWorker } from "tesseract.js";
import { logger } from "../utils/logger";

// Singleton worker — initialised once on first call, reused for every request.
// Initialising a new worker per request adds ~500ms cold-start.
let worker: Tesseract.Worker | null = null;
let workerInitialising = false;

async function getWorker(): Promise<Tesseract.Worker> {
  if (worker) return worker;
  if (workerInitialising) {
    // Busy-wait with back-off (rare race on first request)
    await new Promise((r) => setTimeout(r, 600));
    return getWorker();
  }
  workerInitialising = true;
  try {
    worker = await createWorker("eng", 1, { logger: () => {} });
    logger.info("[ocrService] Tesseract worker ready");
  } finally {
    workerInitialising = false;
  }
  return worker!;
}

// Pre-warm the worker when the server starts (avoids cold-start on first request)
getWorker().catch((e) => logger.warn("[ocrService] Worker pre-warm failed:", e.message));

export const ocrService = {
  /**
   * Extract text from a base64-encoded JPEG/PNG screenshot.
   * Returns raw text, trimmed and capped at 3000 chars.
   * The caller (orchestrator) is responsible for privacy filtering.
   */
  async extractText(imageBase64: string): Promise<string> {
    try {
      const w = await getWorker();
      const buffer = Buffer.from(imageBase64, "base64");
      const { data } = await w.recognize(buffer);
      const text = data.text.trim().slice(0, 3000);
      return text;
    } catch (err: any) {
      logger.error("[ocrService] extractText error:", err.message);
      return ""; // Non-fatal: vision AI can still run on the image alone
    }
  },

  /**
   * Lightweight check: does this image likely contain meaningful text?
   * Use as a short-circuit before spending time on full OCR.
   */
  async hasText(imageBase64: string): Promise<boolean> {
    const text = await ocrService.extractText(imageBase64);
    return text.length > 20;
  },

  /**
   * Gracefully shut down the singleton worker on process exit.
   * Call from server shutdown handler.
   */
  async terminate(): Promise<void> {
    if (worker) {
      await worker.terminate();
      worker = null;
      logger.info("[ocrService] Tesseract worker terminated");
    }
  },
};