// backend/src/tests/services.test.ts
// Run: npm test

import { privacyFilter } from "../../electron-app/src/main/privacyFilter";

// ─── Mock external deps before importing services ─────────────────────────────

jest.mock("openai", () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  screenDescription: "User is on AWS Lambda creation page",
                  uiType: "aws-console",
                  detectedActions: ["button: Create Function", "dropdown: Runtime"],
                  errorDetected: false,
                  errorDescription: null,
                  confidence: 0.9,
                }),
              },
            },
          ],
          usage: { total_tokens: 200 },
        }),
      },
    },
  }));
});

jest.mock("@anthropic-ai/sdk", () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                summary: "You are creating a Lambda function on AWS.",
                guidance: [
                  {
                    step: 1,
                    title: "Choose runtime",
                    description: "Select Node.js 18.x from the Runtime dropdown.",
                    type: "action",
                  },
                  {
                    step: 2,
                    title: "Upload code",
                    description: "Click Upload from and select your .zip file.",
                    type: "action",
                  },
                ],
                intentPrediction: "Deploying a serverless function",
                confidence: 0.88,
              }),
            },
          ],
          usage: { input_tokens: 350, output_tokens: 150 },
        }),
      },
    })),
  };
});

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({}) },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
  UpdateCommand: jest.fn(),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { visionService } from "../services/visionService";
import { llmService } from "../services/llmService";
import { contextService } from "../services/contextService";
import { intentPredictionService } from "../services/intentPredictionService";

// ─── Vision Service Tests ─────────────────────────────────────────────────────

describe("visionService", () => {
  const mockInput = {
    imageBase64: "abc123".repeat(100), // Fake base64
    ocrText: "Create Lambda Function\nRuntime: Node.js\nHandler: index.handler",
    windowTitle: "Create function - Lambda - AWS Console",
    activeApp: "chrome",
  };

  test("analyzeScreen returns structured result", async () => {
    const result = await visionService.analyzeScreen(mockInput);

    expect(result).toHaveProperty("screenDescription");
    expect(result).toHaveProperty("uiType");
    expect(result).toHaveProperty("detectedActions");
    expect(result).toHaveProperty("errorDetected");
    expect(result).toHaveProperty("confidence");
    expect(typeof result.confidence).toBe("number");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  test("analyzeScreen handles API failure gracefully", async () => {
    // Override mock to throw
    const OpenAI = require("openai");
    OpenAI.mockImplementationOnce(() => ({
      chat: { completions: { create: jest.fn().mockRejectedValue(new Error("API down")) } },
    }));

    const result = await visionService.analyzeScreen(mockInput);
    // Should return fallback result, not throw
    expect(result).toHaveProperty("screenDescription");
    expect(result.confidence).toBeLessThanOrEqual(0.5); // Low confidence fallback
  });
});

// ─── LLM Service Tests ────────────────────────────────────────────────────────

describe("llmService", () => {
  const mockVisionResult = {
    screenDescription: "User is on AWS Lambda creation page",
    uiType: "aws-console",
    detectedActions: ["button: Create Function"],
    errorDetected: false,
    confidence: 0.9,
  };

  const mockContext = {
    sessionId: "test-session-123",
    userId: "test-user",
    history: [],
    currentGoal: "Deploying a Lambda function",
    userLevel: "intermediate" as const,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const mockIntent = {
    predictedGoal: "Deploy a serverless function",
    predictedAction: "viewing Lambda console",
    confidence: 0.8,
  };

  test("generateGuidance returns valid AIResponse", async () => {
    const response = await llmService.generateGuidance({
      visionResult: mockVisionResult,
      intentPrediction: mockIntent,
      context: mockContext,
      windowTitle: "Create function - Lambda",
      activeApp: "chrome",
    });

    expect(response).toHaveProperty("summary");
    expect(response).toHaveProperty("guidance");
    expect(Array.isArray(response.guidance)).toBe(true);
    expect(response.guidance.length).toBeGreaterThan(0);
    expect(response.guidance[0]).toHaveProperty("step");
    expect(response.guidance[0]).toHaveProperty("title");
    expect(response.guidance[0]).toHaveProperty("description");
    expect(response.guidance[0]).toHaveProperty("type");
    expect(response).toHaveProperty("modelUsed");
    expect(response).toHaveProperty("tokensUsed");
  });

  test("guidance step types are valid", async () => {
    const response = await llmService.generateGuidance({
      visionResult: mockVisionResult,
      intentPrediction: mockIntent,
      context: mockContext,
      windowTitle: "Lambda",
      activeApp: "chrome",
    });

    const validTypes = ["action", "info", "warning", "tip"];
    for (const step of response.guidance) {
      expect(validTypes).toContain(step.type);
    }
  });
});

// ─── Context Service Tests ────────────────────────────────────────────────────

describe("contextService", () => {
  test("getOrCreateSession creates new session when none exists", async () => {
    const sessionId = "new-session-" + Date.now();
    const context = await contextService.getOrCreateSession(sessionId, "test-user");

    expect(context.sessionId).toBe(sessionId);
    expect(context.userId).toBe("test-user");
    expect(context.history).toEqual([]);
    expect(typeof context.createdAt).toBe("number");
  });

  test("getOrCreateSession returns existing session", async () => {
    const sessionId = "existing-session-" + Date.now();

    // Create first
    await contextService.getOrCreateSession(sessionId, "user-a");

    // Retrieve second — should be same session
    const context2 = await contextService.getOrCreateSession(sessionId, "user-a");
    expect(context2.sessionId).toBe(sessionId);
  });

  test("updateSession adds to history and caps at 20", async () => {
    const sessionId = "history-test-" + Date.now();
    let context = await contextService.getOrCreateSession(sessionId, "user");

    // Add 25 history entries
    for (let i = 0; i < 25; i++) {
      context = await contextService.updateSession(context, {
        timestamp: Date.now() + i,
        screenSummary: `Screen ${i}`,
        appName: "chrome",
      });
    }

    expect(context.history.length).toBeLessThanOrEqual(20);
  });

  test("clearSession empties history", async () => {
    const sessionId = "clear-test-" + Date.now();
    let context = await contextService.getOrCreateSession(sessionId, "user");

    context = await contextService.updateSession(context, {
      timestamp: Date.now(),
      screenSummary: "Some screen",
      appName: "vscode",
    });

    await contextService.clearSession(sessionId);

    const fresh = await contextService.getOrCreateSession(sessionId, "user");
    expect(fresh.history).toEqual([]);
  });
});

// ─── Intent Prediction Tests ──────────────────────────────────────────────────

describe("intentPredictionService", () => {
  const baseContext = {
    sessionId: "test",
    userId: "user",
    history: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  test("predicts AWS Lambda intent", async () => {
    const result = await intentPredictionService.predict({
      visionResult: {
        screenDescription: "AWS Lambda function creation page",
        uiType: "aws-console",
        detectedActions: [],
        errorDetected: false,
        confidence: 0.9,
      },
      context: baseContext,
    });

    expect(result.predictedGoal.toLowerCase()).toContain("lambda");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test("predicts error resolution intent", async () => {
    const result = await intentPredictionService.predict({
      visionResult: {
        screenDescription: "Error: Cannot read property of undefined",
        uiType: "vscode",
        detectedActions: [],
        errorDetected: true,
        errorDescription: "TypeError",
        confidence: 0.85,
      },
      context: baseContext,
    });

    expect(result.predictedGoal.toLowerCase()).toContain("error");
  });

  test("falls back to context goal when no pattern matches", async () => {
    const result = await intentPredictionService.predict({
      visionResult: {
        screenDescription: "Random unrecognized screen",
        uiType: "other",
        detectedActions: [],
        errorDetected: false,
        confidence: 0.3,
      },
      context: { ...baseContext, currentGoal: "Working on database migration" },
    });

    expect(result.predictedGoal).toBe("Working on database migration");
  });
});