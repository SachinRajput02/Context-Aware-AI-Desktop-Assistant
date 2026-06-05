// backend/src/routes/health.ts
import { Router } from "express";
export const healthRouter = Router();
healthRouter.get("/", (_, res) => res.json({ status: "ok", ts: Date.now() }));