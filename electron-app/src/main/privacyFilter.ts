// electron-app/src/main/privacyFilter.ts
// Before sending screenshots to the backend, detect and redact sensitive regions:
//   - Password fields (detected via OCR keywords)
//   - Credit card numbers (regex pattern)
//   - Email addresses
//   - Any region the user explicitly marked as private

// import sharp from "sharp";

// Regex patterns for sensitive data in OCR text
const SENSITIVE_PATTERNS = [
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,  // Credit card
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi, // Email
  /password|passwd|secret|token|api.?key|bearer/gi,      // Password fields
  /\b\d{3}-\d{2}-\d{4}\b/g,                             // SSN pattern
];

export interface PrivacyOptions {
  enabled: boolean;
  blurPasswords: boolean;
  redactEmails: boolean;
  redactCreditCards: boolean;
  customBlockedRegions: Array<{ x: number; y: number; width: number; height: number }>;
}

export const DEFAULT_PRIVACY_OPTIONS: PrivacyOptions = {
  enabled: true,
  blurPasswords: true,
  redactEmails: false,     // Conservative default
  redactCreditCards: true,
  customBlockedRegions: [],
};

export const privacyFilter = {
  /**
   * Filter OCR text — remove sensitive patterns before sending to AI
   */
  sanitizeOCRText(text: string, options: PrivacyOptions): string {
    if (!options.enabled) return text;

    let sanitized = text;

    if (options.redactCreditCards) {
      sanitized = sanitized.replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, "[CARD REDACTED]");
    }

    if (options.redactEmails) {
      sanitized = sanitized.replace(
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi,
        "[EMAIL REDACTED]"
      );
    }

    if (options.blurPasswords) {
      // Remove lines containing password-related keywords
      sanitized = sanitized
        .split("\n")
        .filter((line) => !/password|passwd|secret.*:/i.test(line))
        .join("\n");
    }

    return sanitized;
  },

  /**
   * Apply blur to sensitive regions of the screenshot image
   */
  // async blurSensitiveRegions(
  //   imageBuffer: Buffer,
  //   regions: Array<{ x: number; y: number; width: number; height: number }>
  // ): Promise<Buffer> {
  //   if (regions.length === 0) return imageBuffer;

  //   try {
  //     let img = sharp(imageBuffer);
  //     const metadata = await img.metadata();
  //     const imgWidth = metadata.width || 1280;
  //     const imgHeight = metadata.height || 720;

  //     // Create blur overlays for each sensitive region
  //     const compositeOps = regions.map((r) => ({
  //       input: Buffer.from(
  //         `<svg width="${r.width}" height="${r.height}">
  //           <rect width="${r.width}" height="${r.height}" fill="black"/>
  //         </svg>`
  //       ),
  //       left: Math.min(r.x, imgWidth - r.width),
  //       top: Math.min(r.y, imgHeight - r.height),
  //     }));

  //     return await img.composite(compositeOps).jpeg({ quality: 75 }).toBuffer();
  //   } catch {
  //     // If blur fails, return original (non-fatal)
  //     return imageBuffer;
  //   }
  // },

  async blurSensitiveRegions(
  imageBuffer: Buffer,
  regions: Array<{ x: number; y: number; width: number; height: number }>
): Promise<Buffer> {
  // Temporary fallback:
  // sharp removed because native module fails in Electron runtime

  if (regions.length > 0) {
    console.warn(
      "[PrivacyFilter] Sensitive regions detected but image blurring is temporarily disabled."
    );
  }

  return imageBuffer;
},

  /**
   * Quick scan: does this OCR text look like it contains sensitive data?
   */
  hasSensitiveContent(ocrText: string): boolean {
    return SENSITIVE_PATTERNS.some((pattern) => {
      pattern.lastIndex = 0; // Reset regex state
      return pattern.test(ocrText);
    });
  },
};