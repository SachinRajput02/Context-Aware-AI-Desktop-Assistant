// backend/src/services/contextService.ts
// Manages user session state in DynamoDB — the "memory" of the assistant.
// Now supports: uploaded documents, session stop/new, richer history.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  SessionContext,
  ContextHistoryEntry,
  UploadedDocument,
} from "../shared/types";
import { logger } from "../utils/logger";
import { v4 as uuidv4 } from "uuid";

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
  ...(process.env.NODE_ENV === "development" && {
    endpoint: process.env.DYNAMODB_ENDPOINT || undefined,
  }),
});

const docClient = DynamoDBDocumentClient.from(client);
const TABLE = process.env.AWS_DYNAMODB_TABLE_SESSIONS || "ai-assistant-sessions-prod2";

// In-memory fallback for local dev without DynamoDB
const memoryStore = new Map<string, SessionContext>();

export const contextService = {
  async getOrCreateSession(
    sessionId: string,
    userId: string
  ): Promise<SessionContext> {
    // Try DynamoDB first
    try {
      const result = await docClient.send(
        new GetCommand({ TableName: TABLE, Key: { sessionId } })
      );
      if (result.Item) {
        return result.Item as SessionContext;
      }
    } catch (err: any) {
      logger.warn("DynamoDB get failed, using memory store:", err.message);
      if (memoryStore.has(sessionId)) {
        return memoryStore.get(sessionId)!;
      }
    }

    // Create new session
    const newSession: SessionContext = {
      sessionId,
      userId,
      history: [],
      currentGoal: undefined,
      userLevel: "intermediate",
      uploadedDocuments: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isActive: true,
    };

    await contextService.saveSession(newSession);
    return newSession;
  },

  async saveSession(context: SessionContext): Promise<void> {
    memoryStore.set(context.sessionId, context);
    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE,
          Item: {
            ...context,
            ttl: Math.floor(Date.now() / 1000) + 86400 * 7, // 7 day TTL
          },
        })
      );
    } catch (err: any) {
      logger.warn("DynamoDB put failed, using memory only:", err.message);
    }
  },

  async updateSession(
    context: SessionContext,
    newEntry: ContextHistoryEntry
  ): Promise<SessionContext> {
    const MAX_HISTORY = 30; // Increased: richer history for better LLM context

    const updatedContext: SessionContext = {
      ...context,
      history: [...context.history, newEntry].slice(-MAX_HISTORY),
      currentGoal: inferGoal(context, newEntry),
      updatedAt: Date.now(),
    };

    await contextService.saveSession(updatedContext);
    return updatedContext;
  },

  /**
   * Add or replace a document in the session's document store.
   * If a document with the same name already exists it is replaced.
   */
  async addDocument(
    context: SessionContext,
    document: UploadedDocument
  ): Promise<SessionContext> {
    const existing = context.uploadedDocuments || [];
    const filtered = existing.filter((d) => d.id !== document.id);

    const updatedContext: SessionContext = {
      ...context,
      uploadedDocuments: [...filtered, document],
      updatedAt: Date.now(),
    };

    await contextService.saveSession(updatedContext);
    return updatedContext;
  },

  /**
   * Remove a document from the session.
   */
  async removeDocument(
    context: SessionContext,
    documentId: string
  ): Promise<SessionContext> {
    const updatedContext: SessionContext = {
      ...context,
      uploadedDocuments: (context.uploadedDocuments || []).filter(
        (d) => d.id !== documentId
      ),
      updatedAt: Date.now(),
    };

    await contextService.saveSession(updatedContext);
    return updatedContext;
  },

  /**
   * Stop the current session (marks as inactive, does NOT delete).
   */
  async stopSession(sessionId: string): Promise<void> {
    const existing = memoryStore.get(sessionId);
    if (existing) {
      const stopped: SessionContext = {
        ...existing,
        isActive: false,
        updatedAt: Date.now(),
      };
      await contextService.saveSession(stopped);
    } else {
      // Try DynamoDB
      try {
        const result = await docClient.send(
          new GetCommand({ TableName: TABLE, Key: { sessionId } })
        );
        if (result.Item) {
          const stopped: SessionContext = {
            ...(result.Item as SessionContext),
            isActive: false,
            updatedAt: Date.now(),
          };
          await contextService.saveSession(stopped);
        }
      } catch (err: any) {
        logger.warn("DynamoDB stop session failed:", err.message);
      }
    }
  },

  /**
   * Create a completely new session for the same user.
   */
  async createNewSession(userId: string): Promise<SessionContext> {
    const newSessionId = uuidv4();
    return contextService.getOrCreateSession(newSessionId, userId);
  },

  async clearSession(sessionId: string): Promise<void> {
    memoryStore.delete(sessionId);
    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE,
          Item: {
            sessionId,
            history: [],
            uploadedDocuments: [],
            isActive: true,
            updatedAt: Date.now(),
          },
        })
      );
    } catch {
      // Non-fatal
    }
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferGoal(
  context: SessionContext,
  newEntry: ContextHistoryEntry
): string | undefined {
  const combined = [
    context.currentGoal || "",
    newEntry.screenSummary,
    newEntry.action || "",
    newEntry.userQuestion || "",
  ]
    .join(" ")
    .toLowerCase();

  if (combined.includes("lambda") || combined.includes("deploy")) {
    return "Deploying a serverless function";
  }
  if (
    combined.includes("debug") ||
    combined.includes("error") ||
    combined.includes("exception")
  ) {
    return "Debugging an error";
  }
  if (
    combined.includes("git") ||
    combined.includes("commit") ||
    combined.includes("push")
  ) {
    return "Working with Git version control";
  }
  if (
    combined.includes("database") ||
    combined.includes("sql") ||
    combined.includes("dynamo")
  ) {
    return "Working with a database";
  }
  if (combined.includes("docker") || combined.includes("container")) {
    return "Working with Docker containers";
  }
  if (combined.includes("install") || combined.includes("npm") || combined.includes("pip")) {
    return "Installing dependencies";
  }
  if (combined.includes("test") || combined.includes("jest") || combined.includes("pytest")) {
    return "Running or writing tests";
  }

  return context.currentGoal;
}

