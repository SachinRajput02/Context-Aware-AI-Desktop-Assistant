
// backend/src/services/visionService.ts
// Uses gemini-2.0-flash for vision — fast multimodal model on free tier.

import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../utils/logger";
import "dotenv/config";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);

// gemini-2.0-flash supports vision and is much faster than gemini-3.1-flash-lite
const VISION_MODEL = process.env.VISION_MODEL || "gemini-3.1-flash-lite";

export interface VisionInput {
  imageBase64: string;
  ocrText: string;
  windowTitle: string;
  activeApp: string;
}

export interface VisionResult {
  screenDescription: string;
  uiType: string;
  detectedActions: string[];
  errorDetected: boolean;
  errorDescription?: string;
  confidence: number;
  ocrText?: string;
}

export const visionService = {
  async analyzeScreen(input: VisionInput): Promise<VisionResult> {
    try {
      const model = genAI.getGenerativeModel({ model: VISION_MODEL });
      const prompt = buildVisionPrompt(input);

      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: input.imageBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 512,   // Vision needs less tokens
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      });

      const rawText = result.response.text();
      return parseVisionResponse(rawText, input);
    } catch (error: any) {
      logger.error("Vision service error:", error.message);
      return fallbackVisionResult(input);
    }
  },
};

function buildVisionPrompt(input: VisionInput): string {
  return `Analyze this screenshot. Respond ONLY with this exact JSON, no extra text:
{"screenDescription":"<1 sentence what user is doing>","uiType":"<aws-console|gcp-console|vscode|browser|terminal|ide|dashboard|other>","detectedActions":["<visible button or field>"],"errorDetected":<true|false>,"errorDescription":"<error text or null>","confidence":<0.0-1.0>}

Window: "${input.windowTitle}" | App: ${input.activeApp}
OCR: "${input.ocrText.slice(0, 300)}"`;
}

function parseVisionResponse(rawText: string, input: VisionInput): VisionResult {
  try {
    const clean = rawText.replace(/```json\s*|\s*```/g, "").trim();
    const parsed = JSON.parse(clean);
    return {
      screenDescription: parsed.screenDescription || "Unknown screen",
      uiType: parsed.uiType || "other",
      detectedActions: parsed.detectedActions || [],
      errorDetected: !!parsed.errorDetected,
      errorDescription: parsed.errorDescription || undefined,
      confidence: parsed.confidence || 0.5,
    };
  } catch {
    return fallbackVisionResult(input);
  }
}

function fallbackVisionResult(input: VisionInput): VisionResult {
  const isError =
    input.ocrText.toLowerCase().includes("error") ||
    input.ocrText.toLowerCase().includes("exception") ||
    input.ocrText.toLowerCase().includes("failed");
  return {
    screenDescription: `User is in "${input.windowTitle}" (${input.activeApp})`,
    uiType: "other",
    detectedActions: [],
    errorDetected: isError,
    errorDescription: isError ? "Possible error in OCR text" : undefined,
    confidence: 0.3,
    ocrText: input.ocrText,
  };
}





// // backend/src/services/visionService.ts
// // CHANGED: GPT-4o Vision → Gemini 2.0 Flash (free tier)

// import { GoogleGenerativeAI } from "@google/generative-ai";
// import { logger } from "../utils/logger";
// import "dotenv/config";

// const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);

// export interface VisionInput {
//   imageBase64: string;
//   ocrText: string;
//   windowTitle: string;
//   activeApp: string;
// }

// export interface VisionResult {
//   screenDescription: string;
//   uiType: string;
//   detectedActions: string[];
//   errorDetected: boolean;
//   errorDescription?: string;
//   confidence: number;
//   ocrText?: string;
// }

// export const visionService = {
//   async analyzeScreen(input: VisionInput): Promise<VisionResult> {
//     try {
//       // gemini-2.0-flash is multimodal and on the free tier
//       const model = genAI.getGenerativeModel({
//   model: process.env.VISION_MODEL || "gemini-3.1-flash-lite",
// });

//       const prompt = buildVisionPrompt(input);

//       const result = await model.generateContent([
//         prompt,
//         {
//           inlineData: {
//             mimeType: "image/jpeg",
//             data: input.imageBase64,   // base64 string, no prefix needed
//           },
//         },
//       ]);

//       const rawText = result.response.text();
//       return parseVisionResponse(rawText, input);
//     } catch (error: any) {
//       logger.error("Vision service error:", error.message);
//       return fallbackVisionResult(input);
//     }
//   },
// };

// // ─── Helpers ─────────────────────────────────────────────────────────────────

// function buildVisionPrompt(input: VisionInput): string {
//   return `Analyze this screenshot and respond in JSON only. No markdown, no explanation.

// Window title: "${input.windowTitle}"
// Active app: "${input.activeApp}"
// OCR text found: "${input.ocrText.slice(0, 500)}"

// Respond with this exact JSON:
// {
//   "screenDescription": "<1 sentence: what is the user doing/looking at>",
//   "uiType": "<one of: aws-console | gcp-console | vscode | browser | terminal | ide | dashboard | other>",
//   "detectedActions": ["<clickable element or form field visible>"],
//   "errorDetected": <true|false>,
//   "errorDescription": "<describe error if any, else null>",
//   "confidence": <0.0-1.0>
// }`;
// }

// function parseVisionResponse(rawText: string, input: VisionInput): VisionResult {
//   try {
//     const clean = rawText.replace(/```json|```/g, "").trim();
//     const parsed = JSON.parse(clean);
//     return {
//       screenDescription: parsed.screenDescription || "Unknown screen",
//       uiType: parsed.uiType || "other",
//       detectedActions: parsed.detectedActions || [],
//       errorDetected: !!parsed.errorDetected,
//       errorDescription: parsed.errorDescription || undefined,
//       confidence: parsed.confidence || 0.5,
//     };
//   } catch {
//     return fallbackVisionResult(input);
//   }
// }

// function fallbackVisionResult(input: VisionInput): VisionResult {
//   const isError =
//     input.ocrText.toLowerCase().includes("error") ||
//     input.ocrText.toLowerCase().includes("exception") ||
//     input.ocrText.toLowerCase().includes("failed");
//   return {
//     screenDescription: `User is viewing "${input.windowTitle}" in ${input.activeApp}`,
//     uiType: "other",
//     detectedActions: [],
//     errorDetected: isError,
//     errorDescription: isError ? "Possible error detected from OCR text" : undefined,
//     confidence: 0.3,
//     ocrText: input.ocrText
//   };
// }

