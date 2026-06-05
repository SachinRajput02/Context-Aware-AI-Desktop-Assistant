// backend/src/server.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { config } from "dotenv";
import rateLimit from "express-rate-limit";

import { orchestratorRouter } from "./routes/orchestrator.js";
import { sessionRouter } from "./routes/session";
import { healthRouter } from "./routes/health";
import { errorHandler } from "./middleware/errorHandler";
import { logger } from "./utils/logger";
import { ocrService } from "./services/ocrService"; // ← new: graceful shutdown

config();

const app = express();

app.set("trust proxy", 1);


const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(cors({
  origin: ["app://.", "http://localhost:*"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Session-Id"],
}));
app.use(express.json({ limit: "20mb" })); // ↑ from 10mb: raw image payloads are larger
app.use(express.urlencoded({ extended: true }));
app.use(morgan("combined", { stream: { write: (msg) => logger.info(msg.trim()) } }));

const limiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests."
  }
});
app.use("/api/", limiter);

app.use("/health",           healthRouter);
app.use("/api/orchestrate",  orchestratorRouter);
app.use("/api/session",      sessionRouter);
app.use(errorHandler);

const server = app.listen(PORT, () => {
  logger.info(`AI Orchestrator running on http://localhost:${PORT}`);
  logger.info(`OCR mode: server-side (Tesseract worker pre-warming...)`);
});

// Graceful shutdown — terminate the Tesseract worker cleanly
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down...");
  await ocrService.terminate();
  server.close(() => process.exit(0));
});

process.on("SIGINT", async () => {
  await ocrService.terminate();
  server.close(() => process.exit(0));
});

export default app;