// // backend/src/routes/orchestrator.ts
// // Enhanced: screenshot differencing, OCR text dedup, streaming Gemini (via services)

// import { Router, Request, Response, NextFunction } from "express";
// import { z } from "zod";
// import { visionService } from "../services/visionService";
// import { llmService } from "../services/llmService";
// import { contextService } from "../services/contextService";
// import { ocrService } from "../services/ocrService";
// import { intentPredictionService } from "../services/intentPrediction";
// import { s3Service } from "../services/s3Service";
// import { privacyFilter, DEFAULT_PRIVACY_OPTIONS } from "../services/privacyFilter";
// import { logger } from "../utils/logger";
// import type {
//   ScreenCapturePayload,
//   OrchestratorResponse,
//   SessionContext,
//   UploadedDocument,
// } from "../shared/types";
// import { v4 as uuidv4 } from "uuid";

// export const orchestratorRouter = Router();

// // ─── Per-session response cache (used to return instantly on screen-unchanged) ─
// const lastResponseCache = new Map<string, OrchestratorResponse>();

// // ─── Validation schemas ───────────────────────────────────────────────────────

// const captureSchema = z.object({
//   imageBase64: z.string().min(100),
//   ocrText: z.string().optional(),
//   activeApp: z.string(),
//   windowTitle: z.string(),
//   timestamp: z.number(),
//   sessionId: z.string().uuid(),
//   userId: z.string(),
//   mousePosition: z.object({ x: z.number(), y: z.number() }).optional(),
//   selectedText: z.string().optional(),
//   userQuestion: z.string().optional(),
// });

// const documentSchema = z.object({
//   sessionId: z.string().uuid(),
//   userId: z.string(),
//   document: z.object({
//     name: z.string(),
//     type: z.string(),
//     content: z.string(),
//     isText: z.boolean(),
//   }),
// });

// // ─── POST /api/orchestrate ────────────────────────────────────────────────────

// orchestratorRouter.post(
//   "/",
//   async (req: Request, res: Response, next: NextFunction) => {
//     try {
//       const parseResult = captureSchema.safeParse(req.body);
//       if (!parseResult.success) {
//         return res.status(400).json({
//           success: false,
//           error: "Invalid request: " + parseResult.error.message,
//         });
//       }
//       const capture = parseResult.data as ScreenCapturePayload;

//       logger.info(`Orchestrate: session=${capture.sessionId} app=${capture.activeApp}`);

//       // 1. Load session context
//       const context: SessionContext = await contextService.getOrCreateSession(
//         capture.sessionId,
//         capture.userId
//       );

//       // Guard: do not process if session is stopped
//       if (!context.isActive) {
//         return res.status(400).json({
//           success: false,
//           error: "Session is stopped. Start a new session to continue.",
//         });
//       }

//       // ── FAST PATH: skip everything if screen pixel-diff says unchanged ──────
//       // Only skip when there's no user question/selected text driving a fresh answer
//       const hasUserInput = !!(capture.userQuestion?.trim() || capture.selectedText?.trim());
//       if (!hasUserInput && ocrService.isScreenUnchanged(capture.imageBase64, capture.sessionId)) {
//         const cached = lastResponseCache.get(capture.sessionId);
//         if (cached) {
//           logger.info(`[orchestrator] Screen unchanged — returning cached response (session=${capture.sessionId})`);
//           return res.json({ ...cached, cached: true });
//         }
//       }

//       // 2. Optional S3 screenshot archival (non-blocking)
//       if (process.env.ENABLE_S3_STORAGE === "true") {
//         s3Service
//           .uploadScreenshot(capture.imageBase64, capture.sessionId, capture.timestamp)
//           .catch((e) => logger.warn("S3 upload failed (non-fatal):", e.message));
//       }

//       // 3. OCR — server-side with diff caching, or use client-provided text
//       let ocrText: string;
//       let ocrSkipped = false;

//       if (capture.ocrText && capture.ocrText.trim().length > 0) {
//         // Client already ran OCR (e.g. Electron frontend)
//         ocrText = capture.ocrText;
//         logger.info("OCR text received from client");
//       } else {
//         logger.info("Running server-side OCR...");
//         const ocrResult = await ocrService.extractText(
//           capture.imageBase64,
//           capture.sessionId
//         );
//         ocrSkipped = ocrResult.skipped;
//         ocrText = privacyFilter.sanitizeOCRText(ocrResult.text, DEFAULT_PRIVACY_OPTIONS);
//         logger.info(`Server OCR: ${ocrText.length} chars extracted (skipped=${ocrSkipped})`);
//       }

//       // ── FAST PATH: skip Vision + LLM if OCR text barely changed ─────────────
//       // hasUserInput bypasses this — a direct question always gets a fresh answer
//       if (
//         !hasUserInput &&
//         ocrSkipped === false && // only check if OCR actually ran
//         ocrService.isOcrTextUnchanged(ocrText, capture.sessionId, 0.9)
//       ) {
//         const cached = lastResponseCache.get(capture.sessionId);
//         if (cached) {
//           logger.info(`[orchestrator] OCR text ~unchanged — skipping Vision + LLM (session=${capture.sessionId})`);
//           return res.json({ ...cached, cached: true });
//         }
//       }

//       // 4. Vision AI — full image analysis, or lightweight OCR-only classify
//       //    Use classifyFromOcrOnly when OCR was skipped (screen identical) but
//       //    we still need a visionResult shape for intentPrediction downstream.
//       const visionResult = ocrSkipped
//         ? visionService.classifyFromOcrOnly({
//             ocrText,
//             windowTitle: capture.windowTitle,
//             activeApp: capture.activeApp,
//           })
//         : await visionService.analyzeScreen({
//             imageBase64: capture.imageBase64,
//             ocrText,
//             windowTitle: capture.windowTitle,
//             activeApp: capture.activeApp,
//           });

//       // 5. Intent prediction (always fast — rule-based, no API call)
//       const intentPrediction = await intentPredictionService.predict({
//         visionResult,
//         context,
//         userQuestion: capture.userQuestion,
//         selectedText: capture.selectedText,
//       });

//       // 6. LLM guidance — full answer with complete session history (streaming internally)
//       const aiResponse = await llmService.generateGuidance({
//         visionResult,
//         intentPrediction,
//         context,
//         userQuestion: capture.userQuestion,
//         selectedText: capture.selectedText,
//         windowTitle: capture.windowTitle,
//         activeApp: capture.activeApp,
//       });

//       // 7. Update session context with new history entry
//       const updatedContext = await contextService.updateSession(context, {
//         timestamp: capture.timestamp,
//         screenSummary: visionResult.screenDescription,
//         appName: capture.activeApp,
//         action: intentPrediction.predictedAction,
//         userQuestion: capture.userQuestion,
//         aiSummary: aiResponse.summary,
//       });

//       const response: OrchestratorResponse = {
//         success: true,
//         response: aiResponse,
//         updatedContext,
//       };

//       // Cache this response for potential future screen-unchanged fast-paths
//       lastResponseCache.set(capture.sessionId, response);

//       return res.json(response);
//     } catch (error) {
//       next(error);
//     }
//   }
// );

// // ─── POST /api/orchestrate/question ──────────────────────────────────────────
// // Direct question without screenshot — always runs fresh (no diff skipping)

// orchestratorRouter.post(
//   "/question",
//   async (req: Request, res: Response, next: NextFunction) => {
//     try {
//       const { sessionId, userId, question } = req.body;
//       if (!sessionId || !question) {
//         return res
//           .status(400)
//           .json({ success: false, error: "Missing sessionId or question" });
//       }

//       const context = await contextService.getOrCreateSession(sessionId, userId);

//       if (!context.isActive) {
//         return res
//           .status(400)
//           .json({ success: false, error: "Session is stopped." });
//       }

//       const aiResponse = await llmService.answerQuestion({ question, context });

//       const updatedContext = await contextService.updateSession(context, {
//         timestamp: Date.now(),
//         screenSummary: "User asked a question (no screenshot)",
//         appName: "chat",
//         userQuestion: question,
//         aiSummary: aiResponse.summary,
//       });

//       // Update cache so the next screen capture benefits from this Q&A history
//       const response: OrchestratorResponse = {
//         success: true,
//         response: aiResponse,
//         updatedContext,
//       };
//       lastResponseCache.set(sessionId, response);

//       return res.json(response);
//     } catch (error) {
//       next(error);
//     }
//   }
// );

// // ─── POST /api/orchestrate/upload-document ───────────────────────────────────

// orchestratorRouter.post(
//   "/upload-document",
//   async (req: Request, res: Response, next: NextFunction) => {
//     try {
//       const parseResult = documentSchema.safeParse(req.body);
//       if (!parseResult.success) {
//         return res.status(400).json({
//           success: false,
//           error: "Invalid request: " + parseResult.error.message,
//         });
//       }

//       const { sessionId, userId, document } = parseResult.data;
//       const context = await contextService.getOrCreateSession(sessionId, userId);

//       if (!context.isActive) {
//         return res
//           .status(400)
//           .json({ success: false, error: "Session is stopped." });
//       }

//       const newDoc: UploadedDocument = {
//         ...document,
//         id: uuidv4(),
//         uploadedAt: Date.now(),
//         sessionId,
//       };

//       const updatedContext = await contextService.addDocument(context, newDoc);
//       logger.info(
//         `Document "${document.name}" added to session ${sessionId}. Total: ${updatedContext.uploadedDocuments.length}`
//       );

//       // Bust the response cache — document context has changed, next capture needs fresh LLM call
//       lastResponseCache.delete(sessionId);

//       return res.json({
//         success: true,
//         documentId: newDoc.id,
//         updatedContext,
//       });
//     } catch (error) {
//       next(error);
//     }
//   }
// );

// // ─── DELETE /api/orchestrate/document/:sessionId/:documentId ─────────────────

// orchestratorRouter.delete(
//   "/document/:sessionId/:documentId",
//   async (req: Request, res: Response, next: NextFunction) => {
//     try {
//       const { sessionId, documentId } = req.params;
//       const { userId = "anonymous" } = req.query;

//       const context = await contextService.getOrCreateSession(
//         sessionId,
//         userId as string
//       );
//       const updatedContext = await contextService.removeDocument(context, documentId);

//       // Bust cache — document list changed
//       lastResponseCache.delete(sessionId);

//       return res.json({ success: true, updatedContext });
//     } catch (error) {
//       next(error);
//     }
//   }
// );

// // ─── POST /api/orchestrate/session/stop ──────────────────────────────────────

// orchestratorRouter.post(
//   "/session/stop",
//   async (req: Request, res: Response, next: NextFunction) => {
//     try {
//       const { sessionId } = req.body;
//       if (!sessionId) {
//         return res.status(400).json({ success: false, error: "Missing sessionId" });
//       }
//       await contextService.stopSession(sessionId);
//       // Clear all caches for this session on stop
//       lastResponseCache.delete(sessionId);
//       ocrService.clearSession(sessionId);
//       logger.info(`Session stopped and caches cleared: ${sessionId}`);
//       return res.json({ success: true });
//     } catch (error) {
//       next(error);
//     }
//   }
// );

// // ─── POST /api/orchestrate/session/new ───────────────────────────────────────

// orchestratorRouter.post(
//   "/session/new",
//   async (req: Request, res: Response, next: NextFunction) => {
//     try {
//       const { userId } = req.body;
//       if (!userId) {
//         return res.status(400).json({ success: false, error: "Missing userId" });
//       }
//       const newSession = await contextService.createNewSession(userId);
//       logger.info(`New session created: ${newSession.sessionId} for user ${userId}`);
//       return res.json({ success: true, session: newSession });
//     } catch (error) {
//       next(error);
//     }
//   }
// );





// backend/src/routes/orchestrator.ts
// Enhanced: document upload endpoint, full-answer mode, session context in questions

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { visionService } from "../services/visionService";
import { llmService } from "../services/llmService";
import { contextService } from "../services/contextService";
import { ocrService } from "../services/ocrService";
import { intentPredictionService } from "../services/intentPrediction";
import { s3Service } from "../services/s3Service";
import { privacyFilter, DEFAULT_PRIVACY_OPTIONS } from "../services/privacyFilter";
import { logger } from "../utils/logger";
import type {
  ScreenCapturePayload,
  OrchestratorResponse,
  SessionContext,
  UploadedDocument,
} from "../shared/types";
import { v4 as uuidv4 } from "uuid";

export const orchestratorRouter = Router();

// ─── Validation schemas ───────────────────────────────────────────────────────

const captureSchema = z.object({
  imageBase64: z.string().min(100),
  ocrText: z.string().optional(),
  activeApp: z.string(),
  windowTitle: z.string(),
  timestamp: z.number(),
  sessionId: z.string().uuid(),
  userId: z.string(),
  mousePosition: z.object({ x: z.number(), y: z.number() }).optional(),
  selectedText: z.string().optional(),
  userQuestion: z.string().optional(),
});

const documentSchema = z.object({
  sessionId: z.string().uuid(),
  userId: z.string(),
  document: z.object({
    name: z.string(),
    type: z.string(),
    content: z.string(),
    isText: z.boolean(),
  }),
});

// ─── POST /api/orchestrate ────────────────────────────────────────────────────

orchestratorRouter.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parseResult = captureSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          success: false,
          error: "Invalid request: " + parseResult.error.message,
        });
      }
      const capture = parseResult.data as ScreenCapturePayload;

      logger.info(`Orchestrate: session=${capture.sessionId} app=${capture.activeApp}`);

      // 1. Load session context
      const context: SessionContext = await contextService.getOrCreateSession(
        capture.sessionId,
        capture.userId
      );

      // Guard: do not process if session is stopped
      if (!context.isActive) {
        return res.status(400).json({
          success: false,
          error: "Session is stopped. Start a new session to continue.",
        });
      }

      // 2. Optional S3 screenshot archival
      if (process.env.ENABLE_S3_STORAGE === "true") {
        await s3Service
          .uploadScreenshot(
            capture.imageBase64,
            capture.sessionId,
            capture.timestamp
          )
          .catch((e) => logger.warn("S3 upload failed (non-fatal):", e.message));
      }

      // 3. Server-side OCR (or use client-provided text)
      let ocrText: string;
      if (capture.ocrText && capture.ocrText.trim().length > 0) {
        ocrText = capture.ocrText;
        logger.info("OCR text received from client");
      } else {
        logger.info("Running server-side OCR...");
        const raw = await ocrService.extractText(capture.imageBase64);
        ocrText = privacyFilter.sanitizeOCRText(raw, DEFAULT_PRIVACY_OPTIONS);
        logger.info(`Server OCR: ${ocrText.length} chars extracted`);
      }

      // 4. Vision AI — understand the screen
      const visionResult = await visionService.analyzeScreen({
        imageBase64: capture.imageBase64,
        ocrText,
        windowTitle: capture.windowTitle,
        activeApp: capture.activeApp,
      });

      // 5. Intent prediction
      const intentPrediction = await intentPredictionService.predict({
        visionResult,
        context,
        userQuestion: capture.userQuestion,
        selectedText: capture.selectedText,
      });

      // 6. LLM guidance — full answer with complete session history
      const aiResponse = await llmService.generateGuidance({
        visionResult,
        intentPrediction,
        context,
        userQuestion: capture.userQuestion,
        selectedText: capture.selectedText,
        windowTitle: capture.windowTitle,
        activeApp: capture.activeApp,
      });

      // 7. Update session context with new history entry
      const updatedContext = await contextService.updateSession(context, {
        timestamp: capture.timestamp,
        screenSummary: visionResult.screenDescription,
        appName: capture.activeApp,
        action: intentPrediction.predictedAction,
        userQuestion: capture.userQuestion,
        aiSummary: aiResponse.summary,
      });

      const response: OrchestratorResponse = {
        success: true,
        response: aiResponse,
        updatedContext,
      };

      return res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

// ─── POST /api/orchestrate/question ──────────────────────────────────────────
// Question without screenshot — uses full session history for context

orchestratorRouter.post(
  "/question",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId, userId, question } = req.body;
      if (!sessionId || !question) {
        return res
          .status(400)
          .json({ success: false, error: "Missing sessionId or question" });
      }

      const context = await contextService.getOrCreateSession(sessionId, userId);

      if (!context.isActive) {
        return res
          .status(400)
          .json({ success: false, error: "Session is stopped." });
      }

      const aiResponse = await llmService.answerQuestion({ question, context });

      // Record in history so future questions have this context too
      const updatedContext = await contextService.updateSession(context, {
        timestamp: Date.now(),
        screenSummary: "User asked a question (no screenshot)",
        appName: "chat",
        userQuestion: question,
        aiSummary: aiResponse.summary,
      });

      return res.json({
        success: true,
        response: aiResponse,
        updatedContext,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ─── POST /api/orchestrate/upload-document ───────────────────────────────────
// Upload a document to the session's context

orchestratorRouter.post(
  "/upload-document",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parseResult = documentSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          success: false,
          error: "Invalid request: " + parseResult.error.message,
        });
      }

      const { sessionId, userId, document } = parseResult.data;
      const context = await contextService.getOrCreateSession(sessionId, userId);

      if (!context.isActive) {
        return res
          .status(400)
          .json({ success: false, error: "Session is stopped." });
      }

      const newDoc: UploadedDocument = {
        ...document,
        id: uuidv4(),
        uploadedAt: Date.now(),
        sessionId,
      };

      const updatedContext = await contextService.addDocument(context, newDoc);
      logger.info(
        `Document "${document.name}" added to session ${sessionId}. Total: ${updatedContext.uploadedDocuments.length}`
      );

      return res.json({
        success: true,
        documentId: newDoc.id,
        updatedContext,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ─── DELETE /api/orchestrate/document/:sessionId/:documentId ─────────────────

orchestratorRouter.delete(
  "/document/:sessionId/:documentId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId, documentId } = req.params;
      const { userId = "anonymous" } = req.query;
      const context = await contextService.getOrCreateSession(
        sessionId,
        userId as string
      );
      const updatedContext = await contextService.removeDocument(
        context,
        documentId
      );
      return res.json({ success: true, updatedContext });
    } catch (error) {
      next(error);
    }
  }
);

