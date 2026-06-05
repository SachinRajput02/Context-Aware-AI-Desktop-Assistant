// backend/src/routes/session.ts
// Session management: create, get, stop, new session

import { Router, Request, Response } from "express";
import { contextService } from "../services/contextService";
import { v4 as uuidv4 } from "uuid";

export const sessionRouter = Router();

// ─── Create or retrieve a session ────────────────────────────────────────────

sessionRouter.post("/create", async (req: Request, res: Response) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  const sessionId = uuidv4();
  const context = await contextService.getOrCreateSession(sessionId, userId);
  return res.json({ sessionId, context });
});

// ─── Create a brand-new session (discards current) ───────────────────────────

sessionRouter.post("/new", async (req: Request, res: Response) => {
  const { userId, currentSessionId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  // Stop current session if provided
  if (currentSessionId) {
    await contextService.stopSession(currentSessionId).catch(() => {});
  }

  const context = await contextService.createNewSession(userId);
  return res.json({
    sessionId: context.sessionId,
    context,
    message: "New session started",
  });
});

// ─── Stop the current session ────────────────────────────────────────────────

sessionRouter.post("/:sessionId/stop", async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  await contextService.stopSession(sessionId);
  return res.json({ success: true, message: "Session stopped" });
});

// ─── Get session context ──────────────────────────────────────────────────────

sessionRouter.get("/:sessionId", async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { userId = "anonymous" } = req.query;
  const context = await contextService.getOrCreateSession(
    sessionId,
    userId as string
  );
  return res.json({ context });
});

// ─── Clear session history (keeps session alive) ──────────────────────────────

sessionRouter.delete("/:sessionId", async (req: Request, res: Response) => {
  await contextService.clearSession(req.params.sessionId);
  return res.json({ success: true });
});





// // backend/src/routes/session.ts
// import { Router, Request, Response } from "express";
// import { contextService } from "../services/contextService";
// import { v4 as uuidv4 } from "uuid";

// export const sessionRouter = Router();

// // Create or retrieve a session
// sessionRouter.post("/create", async (req: Request, res: Response) => {
//   const { userId } = req.body;
//   if (!userId) return res.status(400).json({ error: "userId required" });

//   const sessionId = uuidv4();
//   const context = await contextService.getOrCreateSession(sessionId, userId);
//   return res.json({ sessionId, context });
// });

// // Get session context
// sessionRouter.get("/:sessionId", async (req: Request, res: Response) => {
//   const { sessionId } = req.params;
//   const { userId = "anonymous" } = req.query;
//   const context = await contextService.getOrCreateSession(sessionId, userId as string);
//   return res.json({ context });
// });

// // Clear session history
// sessionRouter.delete("/:sessionId", async (req: Request, res: Response) => {
//   await contextService.clearSession(req.params.sessionId);
//   return res.json({ success: true });
// });