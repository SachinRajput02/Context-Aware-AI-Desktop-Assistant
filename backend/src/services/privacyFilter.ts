// backend/src/services/privacyFilter.ts
// MOVED FROM ELECTRON — privacy filtering now runs server-side after OCR.
// The Electron privacyFilter.ts (which used 'sharp') can be deleted.
//
// Order of operations in the pipeline:
//   captureScreen() → imageBase64 → [network] → ocrService.extractText()
//                                             → privacyFilter.sanitizeOCRText()
//                                             → visionService / llmService

export interface PrivacyOptions {
  enabled: boolean;
  redactCreditCards: boolean;
  redactEmails: boolean;
  blurPasswords: boolean;
}

export const DEFAULT_PRIVACY_OPTIONS: PrivacyOptions = {
  enabled: true,
  redactCreditCards: true,
  redactEmails: false,   // conservative default — emails appear in many normal contexts
  blurPasswords: true,
};

export const privacyFilter = {
  /**
   * Remove sensitive patterns from OCR text before it reaches the AI models.
   * Returns the sanitized string.
   */
  sanitizeOCRText(text: string, options: PrivacyOptions): string {
    if (!options.enabled) return text;

    let out = text;

    if (options.redactCreditCards) {
      out = out.replace(/\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g, "[CARD REDACTED]");
    }

    if (options.redactEmails) {
      out = out.replace(
        /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Z]{2,}\b/gi,
        "[EMAIL REDACTED]"
      );
    }

    if (options.blurPasswords) {
      // Drop any line that contains a password-style label followed by a value
      out = out
        .split("\n")
        .filter((line) => !/\b(password|passwd|secret|token|api[_\s]?key)\b.*:/i.test(line))
        .join("\n");
      // Also redact bearer tokens
      out = out.replace(/bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi, "bearer [REDACTED]");
    }

    // Always redact SSN-like patterns
    out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN REDACTED]");

    return out;
  },

  /**
   * Quick check — does this text contain anything sensitive?
   * Useful for logging / audit purposes.
   */
  hasSensitiveContent(text: string): boolean {
    return (
      /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/.test(text) ||
      /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Z]{2,}\b/i.test(text) ||
      /\b(password|passwd|secret)\b.*:/i.test(text)
    );
  },
};