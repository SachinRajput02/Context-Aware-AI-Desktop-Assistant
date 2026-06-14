// backend/src/services/llmService.ts
// Optimised for speed:
//   - Model switched to gemini-2.0-flash (fast, free tier, reliable JSON)
//   - Prompt trimmed: shorter history window, smaller token budget
//   - Strict JSON mode enforced in prompt to eliminate parse errors
//   - Timeout guard added so Lambda never hits API Gateway's 29s wall

import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  SessionContext,
  AIResponse,
  GuidanceStep,
  UploadedDocument,
} from "../shared/types";
import type { VisionResult } from "./visionService";
import type { IntentPredictionResult } from "./intentPrediction";
import { logger } from "../utils/logger";
import "dotenv/config";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);

// ─── Model selection ──────────────────────────────────────────────────────────
// gemini-2.0-flash:  ~3-6s, free tier, supports systemInstruction, reliable JSON
// gemini-1.5-flash:  ~4-8s, free tier, fallback option
// gemma-4-27b-it:    25-56s, too slow for API Gateway 29s limit — DO NOT USE
const LLM_MODEL = process.env.LLM_MODEL || "gemini-2.5-flash";

interface GuidanceInput {
  visionResult: VisionResult;
  intentPrediction: IntentPredictionResult;
  context: SessionContext;
  userQuestion?: string;
  selectedText?: string;
  windowTitle: string;
  activeApp: string;
}

interface QuestionInput {
  question: string;
  context: SessionContext;
}

export const llmService = {
  async generateGuidance(input: GuidanceInput): Promise<AIResponse> {
    const systemPrompt = buildSystemPrompt(input.context);
    const userPrompt = buildGuidancePrompt(input);
    return await callGemini(systemPrompt, userPrompt);
  },

  async answerQuestion(input: QuestionInput): Promise<AIResponse> {
    const systemPrompt = buildSystemPrompt(input.context);
    const userPrompt = buildQuestionPrompt(input.question, input.context);
    return await callGemini(systemPrompt, userPrompt);
  },
};

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildSystemPrompt(context: SessionContext): string {
  // Keep history window small — large prompts = slower LLM responses
  const recentHistory = context.history
    .slice(-5)  // Only last 5 entries, not 20
    .map((h) => {
      const time = new Date(h.timestamp).toLocaleTimeString();
      const parts = [`[${time}] ${h.appName}: ${h.screenSummary}`];
      if (h.userQuestion) parts.push(`  Asked: ${h.userQuestion}`);
      if (h.aiSummary)    parts.push(`  AI: ${h.aiSummary}`);
      return parts.join("\n");
    })
    .join("\n");

  // Only include document names (not full content) in system prompt for speed
  // Full content is included only when user asks a question
  const docNames = (context.uploadedDocuments || [])
    .map((d) => `- ${d.name} (${d.type})`)
    .join("\n");

  return `You are an AI desktop assistant. Be concise and fast.

USER: skill=${context.userLevel || "intermediate"}, goal=${context.currentGoal || "unknown"}

RECENT HISTORY (last 5):
${recentHistory || "none"}

${docNames ? `UPLOADED FILES:\n${docNames}` : ""}

CRITICAL: Respond ONLY with valid JSON matching this exact schema. No markdown, no explanation, no code fences:
{"summary":"string","fullAnswer":"string or null","guidance":[{"step":1,"title":"string","description":"string","type":"action|info|warning|tip|code","codeSnippet":"string or null"}],"intentPrediction":"string","confidence":0.8}`;
}

function buildDocumentContext(docs: UploadedDocument[]): string {
  if (!docs || docs.length === 0) return "";
  const lines = ["DOCUMENT CONTENTS:"];
  for (const doc of docs) {
    if (doc.isText) {
      lines.push(`\n[${doc.name}]:\n${doc.content.slice(0, 800)}`);
    }
  }
  return lines.join("\n");
}

function buildGuidancePrompt(input: GuidanceInput): string {
  const parts = [
    `Screen: ${input.visionResult.screenDescription}`,
    `App: ${input.activeApp} | Window: "${input.windowTitle}"`,
    `UI type: ${input.visionResult.uiType}`,
  ];

  if (input.visionResult.errorDetected) {
    parts.push(`ERROR DETECTED: ${input.visionResult.errorDescription}`);
    parts.push(`Provide complete fix in fullAnswer.`);
  }

  if (input.intentPrediction?.predictedGoal) {
    parts.push(`Intent: ${input.intentPrediction.predictedGoal}`);
  }

  if (input.selectedText?.trim()) {
    parts.push(`Selected text: "${input.selectedText.slice(0, 400)}"`);
  }

  if (input.userQuestion?.trim()) {
    parts.push(`User question: "${input.userQuestion}"`);
    parts.push(`Give a COMPLETE answer with code/commands in fullAnswer.`);
    // Include document content only when user has a question
    const docContext = buildDocumentContext(input.context.uploadedDocuments || []);
    if (docContext) parts.push(docContext);
  }

  return parts.join("\n");
}

function buildQuestionPrompt(question: string, context: SessionContext): string {
  const docContext = buildDocumentContext(context.uploadedDocuments || []);
  return `Question: "${question}"
Goal: ${context.currentGoal || "general"}
${docContext}
Provide a complete, accurate answer with working code/commands if needed.`;
}

// ─── Gemini caller ────────────────────────────────────────────────────────────

async function callGemini(
  systemPrompt: string,
  userPrompt: string
): Promise<AIResponse> {
  // Hard timeout: 24s — safely under API Gateway's 29s limit
  // This gives the caller time to return a clean error instead of a 504
  const TIMEOUT_MS = 24_000;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("LLM_TIMEOUT: Gemini took longer than 24s")),
      TIMEOUT_MS
    )
  );

  const geminiPromise = callGeminiRaw(systemPrompt, userPrompt);

  try {
    return await Promise.race([geminiPromise, timeoutPromise]);
  } catch (err: any) {
    if (err.message?.startsWith("LLM_TIMEOUT")) {
      logger.warn("LLM timeout — returning fast fallback response");
      return timeoutFallback();
    }
    throw err;
  }
}

async function callGeminiRaw(
  systemPrompt: string,
  userPrompt: string
): Promise<AIResponse> {
  const model = genAI.getGenerativeModel({
    model: LLM_MODEL,
    // gemini-2.0-flash supports systemInstruction natively — much better JSON compliance
    systemInstruction: systemPrompt,
  });

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      maxOutputTokens: 1024,  // Reduced from 2048 — faster, still enough
      temperature: 0.1,       // Very low: maximises JSON compliance
      // responseMimeType enforces JSON output — eliminates parse errors
      responseMimeType: "application/json",
    },
  });

  const raw = result.response.text();
  const usage = result.response.usageMetadata;
  const tokens =
    (usage?.promptTokenCount || 0) + (usage?.candidatesTokenCount || 0);

  logger.info(`LLM done: ${tokens} tokens, model=${LLM_MODEL}`);
  return parseAIResponse(raw, LLM_MODEL, tokens);
}

function parseAIResponse(
  raw: string,
  model: string,
  tokens: number
): AIResponse {
  try {
    // Strip any accidental markdown fences
    const clean = raw.replace(/```json\s*|\s*```/g, "").trim();
    const parsed = JSON.parse(clean);

    return {
      summary: parsed.summary || "Analyzing...",
      fullAnswer: parsed.fullAnswer || undefined,
      guidance: (parsed.guidance || []).map(
        (g: any, i: number): GuidanceStep => ({
          step: g.step || i + 1,
          title: g.title || `Step ${i + 1}`,
          description: g.description || "",
          type: g.type || "info",
          codeSnippet: g.codeSnippet || undefined,
        })
      ),
      intentPrediction: parsed.intentPrediction,
      confidence: parsed.confidence || 0.5,
      modelUsed: model,
      tokensUsed: tokens,
    };
  } catch (err) {
    logger.warn("LLM parse error:", String(err));
    logger.warn("Raw LLM output:", raw.slice(0, 200));
    // Return the raw text as a guidance step so the user still gets something
    return {
      summary: "AI response received",
      fullAnswer: raw,
      guidance: [
        {
          step: 1,
          title: "AI Response",
          description: raw.slice(0, 150),
          type: "info",
        },
      ],
      confidence: 0.3,
      modelUsed: model,
      tokensUsed: tokens,
    };
  }
}

function timeoutFallback(): AIResponse {
  return {
    summary: "Response taking too long — try again in a moment",
    fullAnswer: null as any,
    guidance: [
      {
        step: 1,
        title: "AI is busy",
        description:
          "The AI model took too long. This usually resolves in a few seconds. Try again.",
        type: "warning",
      },
    ],
    confidence: 0,
    modelUsed: LLM_MODEL,
    tokensUsed: 0,
  };
}






// // backend/src/services/llmService.ts
// // Full answer mode: uses complete session history + uploaded documents
// // to give real, actionable answers (not just intent predictions).

// import { GoogleGenerativeAI } from "@google/generative-ai";
// import type {
//   SessionContext,
//   AIResponse,
//   GuidanceStep,
//   UploadedDocument,
// } from "../shared/types";
// import type { VisionResult } from "./visionService";
// import type { IntentPredictionResult } from "./intentPrediction";
// import { logger } from "../utils/logger";
// import "dotenv/config";

// const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);

// interface GuidanceInput {
//   visionResult: VisionResult;
//   intentPrediction: IntentPredictionResult;
//   context: SessionContext;
//   userQuestion?: string;
//   selectedText?: string;
//   windowTitle: string;
//   activeApp: string;
// }

// interface QuestionInput {
//   question: string;
//   context: SessionContext;
// }

// export const llmService = {
//   async generateGuidance(input: GuidanceInput): Promise<AIResponse> {
//     const systemPrompt = buildSystemPrompt(input.context);
//     const userPrompt = buildGuidancePrompt(input);
//     return await callGemini(systemPrompt, userPrompt);
//   },

//   async answerQuestion(input: QuestionInput): Promise<AIResponse> {
//     const systemPrompt = buildSystemPrompt(input.context);
//     const userPrompt = buildQuestionPrompt(input.question, input.context);
//     return await callGemini(systemPrompt, userPrompt);
//   },
// };

// // ─── Prompt builders ──────────────────────────────────────────────────────────

// function buildSystemPrompt(context: SessionContext): string {
//   // Full session history (up to 20 entries) — gives LLM complete picture
//   const historyLines = context.history
//     .slice(-20)
//     .map((h, i) => {
//       const time = new Date(h.timestamp).toLocaleTimeString();
//       const parts = [
//         `[${i + 1}] ${time} — App: ${h.appName}`,
//         `  Screen: ${h.screenSummary}`,
//       ];
//       if (h.action) parts.push(`  Action: ${h.action}`);
//       if (h.userQuestion) parts.push(`  User asked: ${h.userQuestion}`);
//       if (h.aiSummary) parts.push(`  AI responded: ${h.aiSummary}`);
//       return parts.join("\n");
//     })
//     .join("\n\n");

//   // Summarise uploaded documents
//   const docSummary = buildDocumentContext(context.uploadedDocuments || []);

//   return `You are an intelligent, always-on desktop assistant like GitHub Copilot — but for any app on the user's screen.

// USER PROFILE:
// - Skill level: ${context.userLevel || "intermediate"}
// - Current session goal: ${context.currentGoal || "not yet determined"}
// - Session started: ${new Date(context.createdAt).toLocaleTimeString()}

// FULL SESSION HISTORY (${context.history.length} entries, last 20 shown):
// ${historyLines || "— No history yet (first interaction)"}

// ${docSummary}

// YOUR ROLE:
// 1. Understand the FULL context of what the user has been doing, not just the current screen.
// 2. When the user asks a question or has an error, give a COMPLETE, WORKING answer — actual code fixes, exact commands, step-by-step resolution.
// 3. Use session history to give answers that make sense for WHERE the user is in their workflow.
// 4. Use uploaded documents (if any) as reference material for answers.
// 5. Be concise in steps, thorough in the actual fix. Quality over quantity.

// RESPONSE FORMAT — always respond in valid JSON, no markdown fences:
// {
//   "summary": "<1 sentence: what's happening / what the AI is doing>",
//   "fullAnswer": "<complete answer/fix — include actual code, commands, or detailed steps. This can be long. Use \\n for line breaks. Use null if this is just a passive screen observation.>",
//   "guidance": [
//     {
//       "step": 1,
//       "title": "<short action title>",
//       "description": "<what to do, keep under 25 words>",
//       "type": "action|info|warning|tip|code",
//       "codeSnippet": "<actual code snippet if type=code, else null>"
//     }
//   ],
//   "intentPrediction": "<what the user is likely trying to achieve>",
//   "confidence": <0.0-1.0>
// }`;
// }

// function buildDocumentContext(docs: UploadedDocument[]): string {
//   if (!docs || docs.length === 0) return "";

//   const lines = ["UPLOADED DOCUMENTS (available as reference):"];
//   for (const doc of docs) {
//     lines.push(`\n--- ${doc.name} (${doc.type}) ---`);
//     if (doc.isText) {
//       // Include first 1500 chars of text documents
//       const preview = doc.content.slice(0, 1500);
//       lines.push(preview);
//       if (doc.content.length > 1500) {
//         lines.push(`... [${doc.content.length - 1500} more characters truncated]`);
//       }
//     } else {
//       lines.push(`[Binary file — ${doc.type}]`);
//     }
//   }
//   return lines.join("\n");
// }

// function buildGuidancePrompt(input: GuidanceInput): string {
//   const lines = [
//     `CURRENT SCREEN:`,
//     `- Description: ${input.visionResult.screenDescription}`,
//     `- UI Type: ${input.visionResult.uiType}`,
//     `- Window: "${input.windowTitle}" in ${input.activeApp}`,
//     `- Visible actions: ${input.visionResult.detectedActions.join(", ") || "none"}`,
//   ];

//   if (input.visionResult.errorDetected) {
//     lines.push(
//       `\n⚠️ ERROR DETECTED: ${input.visionResult.errorDescription}`,
//       `Provide a COMPLETE FIX in fullAnswer — actual commands/code the user can run right now.`
//     );
//   }

//   if (input.intentPrediction?.predictedGoal) {
//     lines.push(`\nINFERRED INTENT: ${input.intentPrediction.predictedGoal}`);
//     if (input.intentPrediction.suggestedNextStep) {
//       lines.push(`SUGGESTED NEXT STEP: ${input.intentPrediction.suggestedNextStep}`);
//     }
//   }

//   if (input.selectedText?.trim()) {
//     lines.push(
//       `\nUSER SELECTED TEXT:\n"${input.selectedText.slice(0, 800)}"`,
//       `If this looks like an error or code problem, provide a complete fix in fullAnswer.`
//     );
//   }

//   if (input.userQuestion?.trim()) {
//     lines.push(
//       `\nUSER QUESTION: "${input.userQuestion}"`,
//       `Answer this COMPLETELY. Use session history for context. Provide actual code/commands.`
//     );
//   }

//   lines.push(`\nProvide helpful guidance. Each step title under 10 words, description under 25 words.`);
//   return lines.join("\n");
// }

// function buildQuestionPrompt(question: string, context: SessionContext): string {
//   return `The user asks: "${question}"

// Answer this question COMPLETELY and CORRECTLY using:
// 1. Full session history (provided in system prompt) for context about what they have been doing
// 2. Uploaded documents (if relevant)
// 3. What you know about their current goal: "${context.currentGoal || "general software usage"}"

// Rules:
// - If it's a code/error question: provide the ACTUAL FIX with working code in fullAnswer
// - If it's a how-to question: provide complete step-by-step instructions
// - If it's a conceptual question: give a clear, thorough explanation
// - guidance[] should contain the key steps (3-6 items)
// - fullAnswer should be the complete, copy-paste-ready answer

// Think carefully. Be accurate. Be complete.`;
// }

// // ─── Gemini caller ────────────────────────────────────────────────────────────

// async function callGemini(systemPrompt: string, userPrompt: string): Promise<AIResponse> {
//   const modelName = process.env.LLM_MODEL || "gemma-4-27b-it";

//   const model = genAI.getGenerativeModel({
//     model: modelName,
//     // NOTE: Gemma does not support systemInstruction — fold into combined prompt
//   });

//   const combined = `${systemPrompt}\n\n---\n\n${userPrompt}`;

//   const result = await model.generateContent({
//     contents: [{ role: "user", parts: [{ text: combined }] }],
//     generationConfig: {
//       maxOutputTokens: 2048, // Increased: need room for complete answers
//       temperature: 0.2,      // Lower for more accurate code/command output
//     },
//   });

//   const raw = result.response.text();
//   const usage = result.response.usageMetadata;
//   const tokens =
//     (usage?.promptTokenCount || 0) + (usage?.candidatesTokenCount || 0);

//   return parseAIResponse(raw, modelName, tokens);
// }

// function parseAIResponse(raw: string, model: string, tokens: number): AIResponse {
//   try {
//     const clean = raw.replace(/```json\s*|```\s*/g, "").trim();
//     // Handle potential trailing content after JSON
//     const jsonMatch = clean.match(/\{[\s\S]*\}/);
//     if (!jsonMatch) throw new Error("No JSON object found");

//     const parsed = JSON.parse(jsonMatch[0]);

//     return {
//       summary: parsed.summary || "Processing your screen...",
//       fullAnswer: parsed.fullAnswer || undefined,
//       guidance: (parsed.guidance || []).map(
//         (g: any, i: number): GuidanceStep => ({
//           step: g.step || i + 1,
//           title: g.title || `Step ${i + 1}`,
//           description: g.description || "",
//           type: g.type || "info",
//           codeSnippet: g.codeSnippet || undefined,
//         })
//       ),
//       intentPrediction: parsed.intentPrediction,
//       confidence: parsed.confidence || 0.5,
//       modelUsed: model,
//       tokensUsed: tokens,
//     };
//   } catch (err) {
//     logger.warn("LLM parse error, using fallback:", String(err));
//     return {
//       summary: raw.slice(0, 120),
//       fullAnswer: raw,
//       guidance: [
//         {
//           step: 1,
//           title: "AI Response",
//           description: raw.slice(0, 200),
//           type: "info",
//         },
//       ],
//       confidence: 0.3,
//       modelUsed: model,
//       tokensUsed: tokens,
//     };
//   }
// }